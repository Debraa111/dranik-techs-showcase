/**
 * Provider dashboard v2 tests: analytics, provider-scoped dispute visibility,
 * the new-booking-request notification, service-area search matching, and the
 * travel-mode fields.
 *
 * Requires a dedicated TEST_DATABASE_URL — skipped otherwise, so this suite
 * never writes to the real app database (see vitest.setup.ts, which
 * redirects DATABASE_URL to it for the duration of the test run).
 *
 * All rows created here are cleaned up in afterAll.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "dotenv/config";
import { eq, inArray } from "drizzle-orm";
import * as db from "../server/db";
import { bookingCancellationRequests, bookings, categories, notifications, providerProfiles, services, users } from "../drizzle/schema";

const hasDb = Boolean(process.env.TEST_DATABASE_URL);
const d = describe.runIf(hasDb);

const created = {
  customerId: 0,
  providerUserId: 0,
  providerId: 0,
  categoryId: 0,
  serviceId: 0,
  bookingIds: [] as number[],
};

async function makeUser(label: string, name: string) {
  return db.getOrCreateUserByAuthId(crypto.randomUUID(), { name, email: `${label}@test.dranik` }, { role: "user" });
}

d("E2E: provider dashboard v2", () => {
  beforeAll(async () => {
    const dbi = await db.getDb();
    if (!dbi) throw new Error("no db");
    const customer = await makeUser(`e2epv2-customer-${Date.now()}`, "E2EPv2 Customer");
    const providerUser = await makeUser(`e2epv2-provider-${Date.now()}`, "E2EPv2 Provider");
    created.customerId = customer.id;
    created.providerUserId = providerUser.id;

    created.providerId = await db.createProviderProfile({
      userId: providerUser.id,
      businessName: "E2EPv2 Services",
      bio: "Test provider",
      yearsOfExperience: 3,
      city: "Asaba",
      state: "Delta",
    });

    const [catRow] = await dbi
      .insert(categories)
      .values({ name: `E2EPv2 Cat ${Date.now()}`, slug: `e2epv2-cat-${Date.now()}`, icon: "build", sortOrder: 999 })
      .returning({ id: categories.id });
    created.categoryId = catRow?.id ?? 0;

    created.serviceId = await db.createService({
      providerId: created.providerId,
      categoryId: created.categoryId,
      title: "E2EPv2 GRA Wiring",
      description: "Test service",
      basePrice: "15000.00",
      priceUnit: "fixed",
      isActive: true,
    });
  });

  afterAll(async () => {
    const dbi = await db.getDb();
    if (!dbi) return;
    if (created.bookingIds.length) {
      await dbi.delete(bookingCancellationRequests).where(inArray(bookingCancellationRequests.bookingId, created.bookingIds));
      await dbi.delete(bookings).where(inArray(bookings.id, created.bookingIds));
    }
    if (created.serviceId) await dbi.delete(services).where(eq(services.id, created.serviceId));
    if (created.providerId) await dbi.delete(providerProfiles).where(eq(providerProfiles.id, created.providerId));
    if (created.categoryId) await dbi.delete(categories).where(eq(categories.id, created.categoryId));
    for (const uid of [created.customerId, created.providerUserId]) {
      if (!uid) continue;
      await dbi.delete(notifications).where(eq(notifications.userId, uid));
      await dbi.delete(users).where(eq(users.id, uid));
    }
  });

  it("1. creating a booking notifies the provider with a new_booking_request notification", async () => {
    const { id: bookingId } = await db.createBooking({
      customerId: created.customerId,
      providerId: created.providerId,
      serviceId: created.serviceId,
      scheduledDate: "2026-08-22",
      scheduledTime: "10:00",
      subtotal: "15000.00",
      discount: "0.00",
      total: "15000.00",
    });
    created.bookingIds.push(bookingId);

    const dbi = await db.getDb();
    const notifs = await dbi!.select().from(notifications).where(eq(notifications.userId, created.providerUserId));
    const match = notifs.find((n) => n.type === "new_booking_request" && (n.data as any)?.bookingId === bookingId);
    expect(match).toBeTruthy();
    expect(match!.title).toBe("New booking request");
  });

  it("2. travelsToCustomer/customerComesToProvider persist via updateProviderProfile", async () => {
    await db.updateProviderProfile(created.providerId, { travelsToCustomer: false, customerComesToProvider: true });
    const profile = await db.getProviderProfileByUserId(created.providerUserId);
    expect(profile!.travelsToCustomer).toBe(false);
    expect(profile!.customerComesToProvider).toBe(true);

    // Restore defaults for the rest of the suite.
    await db.updateProviderProfile(created.providerId, { travelsToCustomer: true, customerComesToProvider: false });
  });

  it("3. search matches a provider's serviceAreas, not just title/description/business name", async () => {
    await db.updateProviderProfile(created.providerId, { serviceAreas: ["Okpanam", "GRA"] });

    const byArea = await db.listServices({ search: "Okpanam" });
    expect(byArea.some((r) => r.service.id === created.serviceId)).toBe(true);

    const byUnrelatedArea = await db.listServices({ search: "Lekki-Nonexistent-Area-Zzz" });
    expect(byUnrelatedArea.some((r) => r.service.id === created.serviceId)).toBe(false);
  });

  it("4. cancellation requests are visible per-provider, scoped correctly, any status", async () => {
    const { id: bookingId } = await db.createBooking({
      customerId: created.customerId,
      providerId: created.providerId,
      serviceId: created.serviceId,
      scheduledDate: "2026-08-23",
      scheduledTime: "09:00",
      subtotal: "15000.00",
      discount: "0.00",
      total: "15000.00",
    });
    created.bookingIds.push(bookingId);

    const dbi = await db.getDb();
    await dbi!.update(bookings).set({ paymentStatus: "paid" }).where(eq(bookings.id, bookingId));
    await db.updateBookingStatus({ bookingId, toStatus: "confirmed", changedByUserId: created.providerUserId });
    await db.updateBookingStatus({ bookingId, toStatus: "in_progress", changedByUserId: created.providerUserId });

    await db.requestBookingCancellation({
      bookingId,
      requestedByUserId: created.customerId,
      requestedByRole: "customer",
      reason: "Testing provider dispute visibility",
    });

    const providerView = await db.listCancellationRequestsForProvider(created.providerId);
    expect(providerView.some((r) => r.booking.id === bookingId)).toBe(true);
    const entry = providerView.find((r) => r.booking.id === bookingId)!;
    expect(entry.request.status).toBe("pending");
    expect(entry.request.reason).toBe("Testing provider dispute visibility");

    // Some other provider should see nothing for this booking.
    const otherProviderUser = await makeUser(`e2epv2-other-${Date.now()}`, "Other Provider");
    const otherProviderId = await db.createProviderProfile({
      userId: otherProviderUser.id,
      businessName: "Other Provider Co",
      bio: "Test",
      yearsOfExperience: 1,
      city: "Asaba",
      state: "Delta",
    });
    const otherView = await db.listCancellationRequestsForProvider(otherProviderId);
    expect(otherView.some((r) => r.booking.id === bookingId)).toBe(false);

    // Cleanup for the extra provider created just for this test.
    await dbi!.delete(providerProfiles).where(eq(providerProfiles.id, otherProviderId));
    await dbi!.delete(users).where(eq(users.id, otherProviderUser.id));
  });

  it("5. analytics reflects real bookings, cancellation rate, and most booked service", async () => {
    const analytics = await db.getProviderAnalytics(created.providerId, created.providerUserId);
    expect(analytics.totalBookings).toBeGreaterThanOrEqual(2); // from tests 1 and 4
    expect(analytics.mostBookedService).toBe("E2EPv2 GRA Wiring");
    expect(typeof analytics.cancellationRate).toBe("number");
    expect(analytics.cancellationRate).toBeGreaterThanOrEqual(0);
    expect(typeof analytics.totalEarnings).toBe("number");
    expect(typeof analytics.repeatCustomers).toBe("number");
  });
});
