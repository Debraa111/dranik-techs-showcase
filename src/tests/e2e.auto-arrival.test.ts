/**
 * Auto-advance "arrived" checkpoint tests (autoAdvanceArrivalCheckpoints in db.ts).
 *
 * Requires a dedicated TEST_DATABASE_URL — skipped otherwise, so this suite
 * never writes to the real app database (see vitest.setup.ts, which
 * redirects DATABASE_URL to it for the duration of the test run).
 *
 * All rows created here are cleaned up in afterAll.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "dotenv/config";
import { and, eq, inArray } from "drizzle-orm";
import * as db from "../server/db";
import {
  bookingCancellationRequests,
  bookingProgressUpdates,
  bookings,
  bookingStatusHistory,
  categories,
  notifications,
  providerProfiles,
  services,
  users,
} from "../drizzle/schema";

const hasDb = Boolean(process.env.TEST_DATABASE_URL);
const d = describe.runIf(hasDb);

const SIX_MIN_AGO = new Date(Date.now() - 6 * 60 * 1000);
const TWO_MIN_AGO = new Date(Date.now() - 2 * 60 * 1000);

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

/** Creates a booking already in_progress, with its status-history row backdated so
 *  the job sees it as having started `startedAgo` ago instead of just now. */
async function makeInProgressBooking(startedAgo: Date) {
  const dbi = await db.getDb();
  const { id: bookingId } = await db.createBooking({
    customerId: created.customerId,
    providerId: created.providerId,
    serviceId: created.serviceId,
    scheduledDate: "2026-08-20",
    scheduledTime: "10:00",
    subtotal: "10000.00",
    discount: "0.00",
    total: "10000.00",
  });
  created.bookingIds.push(bookingId);
  await dbi!.update(bookings).set({ paymentStatus: "paid" }).where(eq(bookings.id, bookingId));
  await db.updateBookingStatus({ bookingId, toStatus: "confirmed", changedByUserId: created.providerUserId });
  await db.updateBookingStatus({ bookingId, toStatus: "in_progress", changedByUserId: created.providerUserId });
  await dbi!
    .update(bookingStatusHistory)
    .set({ createdAt: startedAgo })
    .where(and(eq(bookingStatusHistory.bookingId, bookingId), eq(bookingStatusHistory.toStatus, "in_progress")));
  return bookingId;
}

d("E2E: auto-advance arrival checkpoint", () => {
  beforeAll(async () => {
    const dbi = await db.getDb();
    if (!dbi) throw new Error("no db");
    const customer = await makeUser(`e2earr-customer-${Date.now()}`, "E2EArr Customer");
    const providerUser = await makeUser(`e2earr-provider-${Date.now()}`, "E2EArr Provider");
    created.customerId = customer.id;
    created.providerUserId = providerUser.id;

    created.providerId = await db.createProviderProfile({
      userId: providerUser.id,
      businessName: "E2EArr Services",
      bio: "Test provider",
      yearsOfExperience: 2,
      city: "Lagos",
      state: "Lagos",
    });

    const [catRow] = await dbi
      .insert(categories)
      .values({ name: `E2EArr Cat ${Date.now()}`, slug: `e2earr-cat-${Date.now()}`, icon: "build", sortOrder: 999 })
      .returning({ id: categories.id });
    created.categoryId = catRow?.id ?? 0;

    created.serviceId = await db.createService({
      providerId: created.providerId,
      categoryId: created.categoryId,
      title: "E2EArr Test Service",
      description: "Test service",
      basePrice: "10000.00",
      priceUnit: "fixed",
      isActive: true,
    });
  });

  afterAll(async () => {
    const dbi = await db.getDb();
    if (!dbi) return;
    if (created.bookingIds.length) {
      await dbi.delete(bookingProgressUpdates).where(inArray(bookingProgressUpdates.bookingId, created.bookingIds));
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

  it("1. does not advance a booking started less than 5 minutes ago", async () => {
    const bookingId = await makeInProgressBooking(TWO_MIN_AGO);
    await db.autoAdvanceArrivalCheckpoints();
    const dbi = await db.getDb();
    const rows = await dbi!.select().from(bookingProgressUpdates).where(eq(bookingProgressUpdates.bookingId, bookingId));
    expect(rows.length).toBe(0);
  });

  it("2. auto-posts the arrived checkpoint once a booking has been in_progress for 5+ minutes", async () => {
    const bookingId = await makeInProgressBooking(SIX_MIN_AGO);
    const result = await db.autoAdvanceArrivalCheckpoints();
    expect(result.advanced).toBeGreaterThanOrEqual(1);

    const dbi = await db.getDb();
    const rows = await dbi!.select().from(bookingProgressUpdates).where(eq(bookingProgressUpdates.bookingId, bookingId));
    expect(rows.length).toBe(1);
    expect(rows[0].type).toBe("arrived");

    // Re-running immediately must not double-post.
    await db.autoAdvanceArrivalCheckpoints();
    const rowsAgain = await dbi!.select().from(bookingProgressUpdates).where(eq(bookingProgressUpdates.bookingId, bookingId));
    expect(rowsAgain.length).toBe(1);
  });

  it("3. does not duplicate a checkpoint the provider already posted manually", async () => {
    const bookingId = await makeInProgressBooking(SIX_MIN_AGO);
    await db.addBookingProgressUpdate({ bookingId, type: "arrived", note: "Manually confirmed" });

    await db.autoAdvanceArrivalCheckpoints();

    const dbi = await db.getDb();
    const rows = await dbi!.select().from(bookingProgressUpdates).where(eq(bookingProgressUpdates.bookingId, bookingId));
    expect(rows.length).toBe(1);
    expect(rows[0].note).toBe("Manually confirmed");
  });

  it("4. skips a booking with a pending cancellation request", async () => {
    const bookingId = await makeInProgressBooking(SIX_MIN_AGO);
    await db.requestBookingCancellation({
      bookingId,
      requestedByUserId: created.customerId,
      requestedByRole: "customer",
      reason: "Testing the pending-cancellation skip",
    });

    await db.autoAdvanceArrivalCheckpoints();

    const dbi = await db.getDb();
    const rows = await dbi!.select().from(bookingProgressUpdates).where(eq(bookingProgressUpdates.bookingId, bookingId));
    expect(rows.length).toBe(0);
  });

  it("5. does not advance bookings that aren't in_progress", async () => {
    const dbi = await db.getDb();
    const { id: bookingId } = await db.createBooking({
      customerId: created.customerId,
      providerId: created.providerId,
      serviceId: created.serviceId,
      scheduledDate: "2026-08-20",
      scheduledTime: "11:00",
      subtotal: "10000.00",
      discount: "0.00",
      total: "10000.00",
    });
    created.bookingIds.push(bookingId);
    // Left "pending" — never confirmed/started.

    await db.autoAdvanceArrivalCheckpoints();
    const rows = await dbi!.select().from(bookingProgressUpdates).where(eq(bookingProgressUpdates.bookingId, bookingId));
    expect(rows.length).toBe(0);
  });
});
