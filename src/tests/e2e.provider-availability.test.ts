/**
 * bookings.availableSlots — the query the booking picker now calls instead of a
 * static client-side list. Covers the fallback default range (every provider as
 * of this writing has no working hours configured), an explicitly-set open day,
 * a day marked closed, and a blocked date overriding an otherwise-open day.
 *
 * Requires a dedicated TEST_DATABASE_URL — skipped otherwise, so this suite
 * never writes to the real app database (see vitest.setup.ts, which
 * redirects DATABASE_URL to it for the duration of the test run).
 *
 * All rows created here are cleaned up in afterAll.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "dotenv/config";
import { eq } from "drizzle-orm";
import * as db from "../server/db";
import { appRouter } from "../server/routers";
import type { TrpcContext } from "../server/_core/context";
import { categories, providerBlockedDates, providerProfiles, providerWorkingHours, users } from "../drizzle/schema";

const hasDb = Boolean(process.env.TEST_DATABASE_URL);
const d = describe.runIf(hasDb);

const created = {
  providerUserId: 0,
  providerId: 0,
};

function callerFor() {
  const ctx: TrpcContext = { user: null, req: {} as TrpcContext["req"], res: {} as TrpcContext["res"] };
  return appRouter.createCaller(ctx);
}

/** Next date that falls on the given JS Date#getDay() weekday, as YYYY-MM-DD. */
function nextDateOnWeekday(dayOfWeek: number): string {
  const d = new Date();
  d.setDate(d.getDate() + 1); // start from tomorrow so lead-time never confuses this
  while (d.getDay() !== dayOfWeek) d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

d("E2E: bookings.availableSlots (provider working hours + blocked dates)", () => {
  beforeAll(async () => {
    const dbi = await db.getDb();
    if (!dbi) throw new Error("no db");
    const providerUser = await db.getOrCreateUserByAuthId(
      crypto.randomUUID(),
      { name: "E2EAvail Provider", email: `e2eavail-provider-${Date.now()}@test.dranik` },
      { role: "user" },
    );
    created.providerUserId = providerUser.id;
    created.providerId = await db.createProviderProfile({
      userId: providerUser.id,
      businessName: "E2EAvail Services",
      bio: "Test provider",
      yearsOfExperience: 2,
      city: "Lagos",
      state: "Lagos",
    });
  });

  afterAll(async () => {
    const dbi = await db.getDb();
    if (!dbi) return;
    await dbi.delete(providerBlockedDates).where(eq(providerBlockedDates.providerId, created.providerId));
    await dbi.delete(providerWorkingHours).where(eq(providerWorkingHours.providerId, created.providerId));
    if (created.providerId) await dbi.delete(providerProfiles).where(eq(providerProfiles.id, created.providerId));
    if (created.providerUserId) await dbi.delete(users).where(eq(users.id, created.providerUserId));
  });

  it("1. falls back to the default 08:00-18:00, 30-min range when no working hours are set", async () => {
    const caller = callerFor();
    const date = nextDateOnWeekday(3);
    const slots = await caller.bookings.availableSlots({ providerId: created.providerId, date });
    expect(slots[0]).toBe("08:00");
    expect(slots[slots.length - 1]).toBe("18:00");
    expect(slots).toContain("08:30");
    expect(slots.length).toBe(21);
  });

  it("2. once working hours are set, only that day's window is returned", async () => {
    await db.setWorkingHours(created.providerId, [
      { dayOfWeek: 0, isOpen: false },
      { dayOfWeek: 1, isOpen: true, openTime: "09:00", closeTime: "12:00" },
      { dayOfWeek: 2, isOpen: true, openTime: "09:00", closeTime: "12:00" },
      { dayOfWeek: 3, isOpen: true, openTime: "09:00", closeTime: "12:00" },
      { dayOfWeek: 4, isOpen: true, openTime: "09:00", closeTime: "12:00" },
      { dayOfWeek: 5, isOpen: true, openTime: "09:00", closeTime: "12:00" },
      { dayOfWeek: 6, isOpen: false },
    ]);

    const caller = callerFor();
    const openDate = nextDateOnWeekday(3); // Wednesday, open 09:00-12:00
    const slots = await caller.bookings.availableSlots({ providerId: created.providerId, date: openDate });
    expect(slots).toEqual(["09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00"]);
  });

  it("3. a day marked closed returns no slots", async () => {
    const caller = callerFor();
    const closedDate = nextDateOnWeekday(0); // Sunday, isOpen: false
    const slots = await caller.bookings.availableSlots({ providerId: created.providerId, date: closedDate });
    expect(slots).toEqual([]);
  });

  it("4. a blocked date returns no slots even though that weekday is otherwise open", async () => {
    const openDate = nextDateOnWeekday(3); // Wednesday, open per test 2
    await db.addBlockedDate({ providerId: created.providerId, startDate: openDate, endDate: openDate, reason: "Test block" });

    const caller = callerFor();
    const slots = await caller.bookings.availableSlots({ providerId: created.providerId, date: openDate });
    expect(slots).toEqual([]);
  });
});
