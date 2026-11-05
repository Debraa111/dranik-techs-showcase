/**
 * Booking reminder job tests (sendDueBookingReminders in db.ts).
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
  bookingReminders,
  bookings,
  categories,
  notifications,
  providerProfiles,
  services,
  users,
} from "../drizzle/schema";

const hasDb = Boolean(process.env.TEST_DATABASE_URL);
const d = describe.runIf(hasDb);

/** Inverse of db.ts's scheduledAtUtc: given a target UTC instant, produce the
 *  scheduledDate/scheduledTime wall-clock strings that map back to it (Africa/Lagos,
 *  fixed UTC+1). */
function toBookingDateTime(target: Date) {
  const wallClock = new Date(target.getTime() + 60 * 60 * 1000);
  return {
    scheduledDate: wallClock.toISOString().slice(0, 10),
    scheduledTime: wallClock.toISOString().slice(11, 16),
  };
}

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

async function makeConfirmedBooking(scheduledAt: Date) {
  const { scheduledDate, scheduledTime } = toBookingDateTime(scheduledAt);
  const { id: bookingId } = await db.createBooking({
    customerId: created.customerId,
    providerId: created.providerId,
    serviceId: created.serviceId,
    scheduledDate,
    scheduledTime,
    subtotal: "10000.00",
    discount: "0.00",
    total: "10000.00",
  });
  created.bookingIds.push(bookingId);
  await db.updateBookingStatus({ bookingId, toStatus: "confirmed", changedByUserId: created.providerUserId });
  return bookingId;
}

d("E2E: booking reminders", () => {
  beforeAll(async () => {
    const dbi = await db.getDb();
    if (!dbi) throw new Error("no db");
    const customer = await makeUser(`e2er-customer-${Date.now()}`, "E2ER Customer");
    const providerUser = await makeUser(`e2er-provider-${Date.now()}`, "E2ER Provider");
    created.customerId = customer.id;
    created.providerUserId = providerUser.id;

    created.providerId = await db.createProviderProfile({
      userId: providerUser.id,
      businessName: "E2ER Services",
      bio: "Test provider",
      yearsOfExperience: 2,
      city: "Lagos",
      state: "Lagos",
    });

    const [catRow] = await dbi
      .insert(categories)
      .values({ name: `E2ER Cat ${Date.now()}`, slug: `e2er-cat-${Date.now()}`, icon: "build", sortOrder: 999 })
      .returning({ id: categories.id });
    created.categoryId = catRow?.id ?? 0;

    created.serviceId = await db.createService({
      providerId: created.providerId,
      categoryId: created.categoryId,
      title: "E2ER Reminder Test Service",
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
      await dbi.delete(bookingReminders).where(inArray(bookingReminders.bookingId, created.bookingIds));
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

  it("1. fires every interval already past due, in one run, and never re-fires them", async () => {
    // Scheduled 45 minutes out: the 1d/5h/1h thresholds are already behind "now",
    // the 30m/10m ones aren't yet.
    const bookingId = await makeConfirmedBooking(new Date(Date.now() + 45 * 60 * 1000));

    const first = await db.sendDueBookingReminders();
    expect(first.sent).toBeGreaterThanOrEqual(3); // this booking's 1d/5h/1h, plus whatever real data exists

    const dbi = await db.getDb();
    const fired = await dbi!.select().from(bookingReminders).where(eq(bookingReminders.bookingId, bookingId));
    const intervals = fired.map((f: any) => f.interval).sort();
    expect(intervals).toEqual(["1h", "5h", "1d"].sort());

    const notifs = await dbi!
      .select()
      .from(notifications)
      .where(eq(notifications.userId, created.customerId));
    expect(notifs.filter((n: any) => n.type === "service_reminder").length).toBe(3);

    // Re-running immediately must not double-fire the same intervals.
    const second = await db.sendDueBookingReminders();
    const firedAgain = await dbi!.select().from(bookingReminders).where(eq(bookingReminders.bookingId, bookingId));
    expect(firedAgain.length).toBe(3);
    void second;
  });

  it("2. does not fire an interval before its due time", async () => {
    const bookingId = await makeConfirmedBooking(new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)); // 3 days out
    await db.sendDueBookingReminders();
    const dbi = await db.getDb();
    const fired = await dbi!.select().from(bookingReminders).where(eq(bookingReminders.bookingId, bookingId));
    expect(fired.length).toBe(0);
  });

  it("3. never sends a reminder once the scheduled time has passed", async () => {
    const bookingId = await makeConfirmedBooking(new Date(Date.now() - 5 * 60 * 1000)); // 5 minutes ago
    await db.sendDueBookingReminders();
    const dbi = await db.getDb();
    const fired = await dbi!.select().from(bookingReminders).where(eq(bookingReminders.bookingId, bookingId));
    expect(fired.length).toBe(0);
  });

  it("4. skips bookings that aren't confirmed", async () => {
    const { scheduledDate, scheduledTime } = toBookingDateTime(new Date(Date.now() + 45 * 60 * 1000));
    const { id: bookingId } = await db.createBooking({
      customerId: created.customerId,
      providerId: created.providerId,
      serviceId: created.serviceId,
      scheduledDate,
      scheduledTime,
      subtotal: "10000.00",
      discount: "0.00",
      total: "10000.00",
    });
    created.bookingIds.push(bookingId);
    // Left as "pending" — never confirmed.

    await db.sendDueBookingReminders();
    const dbi = await db.getDb();
    const fired = await dbi!.select().from(bookingReminders).where(eq(bookingReminders.bookingId, bookingId));
    expect(fired.length).toBe(0);
  });

  it("5. records the interval as evaluated even when the customer has reminders turned off, but sends no notification", async () => {
    await db.updateNotificationPreferences(created.customerId, { serviceReminders: false });
    try {
      const bookingId = await makeConfirmedBooking(new Date(Date.now() + 4 * 60 * 60 * 1000)); // 4 hours out — only 1d/5h due
      await db.sendDueBookingReminders();

      const dbi = await db.getDb();
      const fired = await dbi!.select().from(bookingReminders).where(eq(bookingReminders.bookingId, bookingId));
      expect(fired.length).toBe(2); // 1d and 5h are both past due — still recorded as evaluated

      const notifs = await dbi!
        .select()
        .from(notifications)
        .where(eq(notifications.userId, created.customerId));
      // Scoped to this test's own booking — the customer already has service_reminder
      // notifications from test 1 above, reused on the same fixture customer.
      expect(notifs.some((n: any) => n.type === "service_reminder" && n.data?.bookingId === bookingId)).toBe(false);
    } finally {
      await db.updateNotificationPreferences(created.customerId, { serviceReminders: true });
    }
  });
});
