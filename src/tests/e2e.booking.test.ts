/**
 * End-to-end booking lifecycle integration tests.
 *
 * Verifies that every layer stays consistent: booking creation, status state
 * machine, status history audit trail, payments (mock gateway),
 * wallet/transactions, notifications, and reviews with provider rating
 * recomputation.
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
import {
  bookingStatusHistory,
  bookings,
  categories,
  notifications,
  payments,
  providerProfiles,
  reviews,
  services,
  transactions,
  users,
  wallets,
} from "../drizzle/schema";

const hasDb = Boolean(process.env.TEST_DATABASE_URL);
const d = describe.runIf(hasDb);

/** Fetch status history rows for a booking, oldest first. */
async function getHistory(bookingId: number) {
  const dbi = await db.getDb();
  if (!dbi) throw new Error("no db");
  const rows = await dbi
    .select()
    .from(bookingStatusHistory)
    .where(eq(bookingStatusHistory.bookingId, bookingId));
  return rows.sort((a: any, b: any) => a.id - b.id);
}

// IDs created during the test run (for cleanup)
const created = {
  customerId: 0,
  providerUserId: 0,
  providerId: 0,
  categoryId: 0,
  serviceId: 0,
  bookingIds: [] as number[],
};

async function makeUser(label: string, name: string, role: "user" | "admin" = "user") {
  return db.getOrCreateUserByAuthId(crypto.randomUUID(), { name, email: `${label}@test.dranik` }, { role });
}

d("E2E: booking lifecycle", () => {
  beforeAll(async () => {
    const dbi = await db.getDb();
    if (!dbi) throw new Error("no db");

    // 1. Create test customer + provider user
    const customer = await makeUser(`e2e-customer-${Date.now()}`, "E2E Customer");
    const providerUser = await makeUser(`e2e-provider-${Date.now()}`, "E2E Provider");
    created.customerId = customer.id;
    created.providerUserId = providerUser.id;

    // 2. Create category, provider profile, service
    const [catRow] = await dbi
      .insert(categories)
      .values({ name: `E2E Cat ${Date.now()}`, slug: `e2e-cat-${Date.now()}`, icon: "build", sortOrder: 999 })
      .returning({ id: categories.id });
    created.categoryId = catRow?.id ?? 0;

    const [provRow] = await dbi
      .insert(providerProfiles)
      .values({
        userId: providerUser.id,
        businessName: "E2E Plumbing Co",
        bio: "Test provider",
        verificationStatus: "verified",
        city: "Lagos",
        state: "Lagos",
      })
      .returning({ id: providerProfiles.id });
    created.providerId = provRow?.id ?? 0;

    const [svcRow] = await dbi
      .insert(services)
      .values({
        providerId: created.providerId,
        categoryId: created.categoryId,
        title: "E2E Pipe Repair",
        description: "Test service",
        basePrice: "15000.00",
        priceUnit: "fixed",
        isActive: true,
      })
      .returning({ id: services.id });
    created.serviceId = svcRow?.id ?? 0;
  });

  afterAll(async () => {
    const dbi = await db.getDb();
    if (!dbi) return;
    // Clean up in FK-safe order
    if (created.bookingIds.length) {
      await dbi.delete(reviews).where(inArray(reviews.bookingId, created.bookingIds));
      await dbi.delete(payments).where(inArray(payments.bookingId, created.bookingIds));
      await dbi.delete(bookingStatusHistory).where(inArray(bookingStatusHistory.bookingId, created.bookingIds));
      await dbi.delete(bookings).where(inArray(bookings.id, created.bookingIds));
    }
    if (created.serviceId) await dbi.delete(services).where(eq(services.id, created.serviceId));
    if (created.providerId) await dbi.delete(providerProfiles).where(eq(providerProfiles.id, created.providerId));
    if (created.categoryId) await dbi.delete(categories).where(eq(categories.id, created.categoryId));
    for (const uid of [created.customerId, created.providerUserId]) {
      if (!uid) continue;
      await dbi.delete(notifications).where(eq(notifications.userId, uid));
      const walletRows = await dbi.select().from(wallets).where(eq(wallets.userId, uid));
      for (const w of walletRows) {
        await dbi.delete(transactions).where(eq(transactions.walletId, w.id));
      }
      await dbi.delete(wallets).where(eq(wallets.userId, uid));
      await dbi.delete(users).where(eq(users.id, uid));
    }
  });

  it("1. customer creates a booking and it is stored correctly", async () => {
    const { id, reference } = await db.createBooking({
      customerId: created.customerId,
      providerId: created.providerId,
      serviceId: created.serviceId,
      scheduledDate: "2026-08-01",
      scheduledTime: "10:00",
      notes: "E2E test booking",
      subtotal: "15000.00",
      discount: "0.00",
      total: "15000.00",
    });
    created.bookingIds.push(id);

    expect(id).toBeGreaterThan(0);
    expect(reference).toMatch(/^DRK-\d{8}-[A-Z0-9]{4}$/);

    const row = await db.getBookingById(id);
    expect(row).toBeTruthy();
    expect(row!.booking.customerId).toBe(created.customerId);
    expect(row!.booking.providerId).toBe(created.providerId);
    expect(row!.booking.status).toBe("pending");
    expect(row!.booking.paymentStatus).toBe("unpaid");
    expect(Number(row!.booking.total)).toBe(15000);
    expect(row!.service.title).toBe("E2E Pipe Repair");
    expect(row!.provider.businessName).toBe("E2E Plumbing Co");
  });

  it("2. booking creation writes an initial status history entry", async () => {
    const bookingId = created.bookingIds[0];
    const history = await getHistory(bookingId);
    expect(history.length).toBe(1);
    expect(history[0].toStatus).toBe("pending");
    expect(history[0].fromStatus).toBeNull();
  });

  it("3. full happy path: pending → confirmed → in_progress → completed", async () => {
    const bookingId = created.bookingIds[0];

    await db.updateBookingStatus({ bookingId, toStatus: "confirmed", changedByUserId: created.providerUserId });
    let row = await db.getBookingById(bookingId);
    expect(row!.booking.status).toBe("confirmed");

    await db.updateBookingStatus({ bookingId, toStatus: "in_progress", changedByUserId: created.providerUserId });
    row = await db.getBookingById(bookingId);
    expect(row!.booking.status).toBe("in_progress");

    await db.updateBookingStatus({ bookingId, toStatus: "completed", changedByUserId: created.providerUserId });
    row = await db.getBookingById(bookingId);
    expect(row!.booking.status).toBe("completed");
    expect(row!.booking.completedAt).toBeTruthy();

    // History has all 4 entries in order
    const history = await getHistory(bookingId);
    expect(history.map((h: any) => h.toStatus)).toEqual(["pending", "confirmed", "in_progress", "completed"]);

    // Provider completedJobs incremented
    const profile = await db.getProviderProfileByUserId(created.providerUserId);
    expect(profile!.completedJobs).toBe(1);
  });

  it("4. invalid status transitions are rejected", async () => {
    const bookingId = created.bookingIds[0]; // now completed (terminal)
    await expect(
      db.updateBookingStatus({ bookingId, toStatus: "confirmed", changedByUserId: created.providerUserId }),
    ).rejects.toThrow(/Cannot change booking/);
    await expect(
      db.updateBookingStatus({ bookingId, toStatus: "cancelled", changedByUserId: created.customerId }),
    ).rejects.toThrow(/Cannot change booking/);
  });

  it("5. cancel flow works from pending with a reason", async () => {
    const { id } = await db.createBooking({
      customerId: created.customerId,
      providerId: created.providerId,
      serviceId: created.serviceId,
      scheduledDate: "2026-08-02",
      scheduledTime: "14:00",
      subtotal: "15000.00",
      discount: "0.00",
      total: "15000.00",
    });
    created.bookingIds.push(id);

    await db.updateBookingStatus({
      bookingId: id,
      toStatus: "cancelled",
      changedByUserId: created.customerId,
      cancelReason: "Changed my mind",
    });
    const row = await db.getBookingById(id);
    expect(row!.booking.status).toBe("cancelled");
    expect(row!.booking.cancelReason).toBe("Changed my mind");
  });

  it("6. reschedule works for pending/confirmed and resets status to pending", async () => {
    const { id } = await db.createBooking({
      customerId: created.customerId,
      providerId: created.providerId,
      serviceId: created.serviceId,
      scheduledDate: "2026-08-03",
      scheduledTime: "09:00",
      subtotal: "15000.00",
      discount: "0.00",
      total: "15000.00",
    });
    created.bookingIds.push(id);

    await db.updateBookingStatus({ bookingId: id, toStatus: "confirmed", changedByUserId: created.providerUserId });
    const updated = await db.rescheduleBooking({
      bookingId: id,
      customerId: created.customerId,
      scheduledDate: "2026-08-05",
      scheduledTime: "11:00",
    });
    expect(updated).toBeTruthy();
    expect(updated!.booking.status).toBe("pending");
    expect(String(updated!.booking.scheduledDate)).toContain("2026-08-05");

    // Rescheduling someone else's booking fails
    const stranger = await db.rescheduleBooking({
      bookingId: id,
      customerId: created.providerUserId, // not the customer
      scheduledDate: "2026-08-06",
      scheduledTime: "12:00",
    });
    expect(stranger).toBeNull();
  });

  it("7. payment record + wallet transactions stay consistent", async () => {
    const bookingId = created.bookingIds[0];
    const paymentId = await db.createPayment({
      bookingId,
      userId: created.customerId,
      amount: 15000,
      gatewayReference: `PAY-E2E-${Date.now()}`,
    });
    expect(paymentId).toBeGreaterThan(0);
    await db.updatePaymentStatus(paymentId, "successful");

    // Wallet top-up ledger consistency
    const before = await db.getOrCreateWallet(created.customerId);
    await db.recordTransaction({
      userId: created.customerId,
      type: "credit",
      category: "topup",
      amount: 5000,
      description: "E2E top-up",
    });
    const after = await db.getOrCreateWallet(created.customerId);
    expect(Number(after.balance)).toBe(Number(before.balance) + 5000);

    const txs = await db.listTransactions(created.customerId);
    expect(txs.length).toBeGreaterThan(0);
    expect(txs[0].category).toBe("topup");
  });

  it("8. notifications are created and marked read", async () => {
    await db.createNotification({
      userId: created.customerId,
      type: "booking_update",
      title: "E2E booking update",
      body: "Your booking was confirmed.",
      data: { bookingId: created.bookingIds[0] },
    });
    const list = await db.listNotifications(created.customerId);
    expect(list.length).toBeGreaterThan(0);
    const first = list[0];
    expect(first.isRead).toBe(false);
    await db.markNotificationRead(created.customerId, first.id);
    const after = await db.listNotifications(created.customerId);
    expect(after.find((n: any) => n.id === first.id)!.isRead).toBe(true);
  });

  it("9. review on completed booking updates the provider rating", async () => {
    const bookingId = created.bookingIds[0]; // completed in test 3
    const reviewId = await db.createReview({
      bookingId,
      customerId: created.customerId,
      providerId: created.providerId,
      rating: 5,
      comment: "Excellent E2E service!",
    });
    expect(reviewId).toBeGreaterThan(0);

    const dbi = await db.getDb();
    const profRows = await dbi!
      .select()
      .from(providerProfiles)
      .where(eq(providerProfiles.id, created.providerId))
      .limit(1);
    expect(Number(profRows[0].averageRating)).toBe(5);
    expect(profRows[0].reviewCount).toBe(1);
  });

  it("10. data stays consistent across all layers for the lifecycle booking", async () => {
    const bookingId = created.bookingIds[0];
    const row = await db.getBookingById(bookingId);
    const history = await getHistory(bookingId);
    const custBookings = await db.listBookingsForCustomer(created.customerId);
    const provBookings = await db.listBookingsForProvider(created.providerId);

    // Same booking visible from both sides
    expect(custBookings.some((b: any) => b.booking.id === bookingId)).toBe(true);
    expect(provBookings.some((b: any) => b.booking.id === bookingId)).toBe(true);
    // Terminal state + full audit trail
    expect(row!.booking.status).toBe("completed");
    expect(history.length).toBe(4);
    // Money math: subtotal - discount = total
    expect(Number(row!.booking.subtotal) - Number(row!.booking.discount)).toBe(Number(row!.booking.total));
  });
});
