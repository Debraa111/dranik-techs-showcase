/**
 * bookings.create lead-time guard tests — exercises the actual tRPC router (via
 * appRouter.createCaller, same pattern as auth.logout.test.ts), not just the
 * timezone helper in isolation, so this proves the real enforcement a direct API
 * call would hit, not just that the math is right.
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
import { appRouter } from "../server/routers";
import type { TrpcContext } from "../server/_core/context";
import { bookings, categories, providerProfiles, services, users } from "../drizzle/schema";

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

/** Inverse of scheduledAtUtc: given a target UTC instant, produce the
 *  scheduledDate/scheduledTime wall-clock strings that map back to it. */
function toBookingDateTime(target: Date) {
  const wallClock = new Date(target.getTime() + 60 * 60 * 1000);
  return {
    scheduledDate: wallClock.toISOString().slice(0, 10),
    scheduledTime: wallClock.toISOString().slice(11, 16),
  };
}

function callerFor(userId: number, authUserId: string) {
  const ctx: TrpcContext = {
    user: {
      id: userId,
      authUserId,
      email: null,
      name: null,
      phone: null,
      avatarUrl: null,
      role: "user",
      appRole: "customer",
      status: "active",
      emailVerified: false,
      phoneVerified: false,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: {} as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
  return appRouter.createCaller(ctx);
}

d("E2E: bookings.create lead-time guard", () => {
  let customerAuthUserId = "";

  beforeAll(async () => {
    const dbi = await db.getDb();
    if (!dbi) throw new Error("no db");
    const customer = await makeUser(`e2elt-customer-${Date.now()}`, "E2ELT Customer");
    const providerUser = await makeUser(`e2elt-provider-${Date.now()}`, "E2ELT Provider");
    created.customerId = customer.id;
    created.providerUserId = providerUser.id;
    customerAuthUserId = customer.authUserId;

    created.providerId = await db.createProviderProfile({
      userId: providerUser.id,
      businessName: "E2ELT Services",
      bio: "Test provider",
      yearsOfExperience: 2,
      city: "Lagos",
      state: "Lagos",
    });

    const [catRow] = await dbi
      .insert(categories)
      .values({ name: `E2ELT Cat ${Date.now()}`, slug: `e2elt-cat-${Date.now()}`, icon: "build", sortOrder: 999 })
      .returning({ id: categories.id });
    created.categoryId = catRow?.id ?? 0;

    created.serviceId = await db.createService({
      providerId: created.providerId,
      categoryId: created.categoryId,
      title: "E2ELT Test Service",
      description: "Test service",
      basePrice: "10000.00",
      priceUnit: "fixed",
      isActive: true,
    });
  });

  afterAll(async () => {
    const dbi = await db.getDb();
    if (!dbi) return;
    if (created.bookingIds.length) await dbi.delete(bookings).where(inArray(bookings.id, created.bookingIds));
    if (created.serviceId) await dbi.delete(services).where(eq(services.id, created.serviceId));
    if (created.providerId) await dbi.delete(providerProfiles).where(eq(providerProfiles.id, created.providerId));
    if (created.categoryId) await dbi.delete(categories).where(eq(categories.id, created.categoryId));
    for (const uid of [created.customerId, created.providerUserId]) {
      if (!uid) continue;
      await dbi.delete(users).where(eq(users.id, uid));
    }
  });

  it("1. rejects a booking for a time already in the past", async () => {
    const caller = callerFor(created.customerId, customerAuthUserId);
    const { scheduledDate, scheduledTime } = toBookingDateTime(new Date(Date.now() - 30 * 60 * 1000));
    await expect(
      caller.bookings.create({ serviceId: created.serviceId, scheduledDate, scheduledTime }),
    ).rejects.toThrow(/at least an hour from now/);
  });

  it("2. rejects a booking less than the 60-minute lead time away", async () => {
    const caller = callerFor(created.customerId, customerAuthUserId);
    const { scheduledDate, scheduledTime } = toBookingDateTime(new Date(Date.now() + 20 * 60 * 1000));
    await expect(
      caller.bookings.create({ serviceId: created.serviceId, scheduledDate, scheduledTime }),
    ).rejects.toThrow(/at least an hour from now/);
  });

  it("3. accepts a booking at least 60 minutes out", async () => {
    const caller = callerFor(created.customerId, customerAuthUserId);
    const { scheduledDate, scheduledTime } = toBookingDateTime(new Date(Date.now() + 90 * 60 * 1000));
    const result = await caller.bookings.create({ serviceId: created.serviceId, scheduledDate, scheduledTime });
    expect(result.id).toBeGreaterThan(0);
    created.bookingIds.push(result.id);
  });

  it("4. a future date is unaffected even with an early clock-time value", async () => {
    const caller = callerFor(created.customerId, customerAuthUserId);
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const scheduledDate = tomorrow.toISOString().slice(0, 10);
    const result = await caller.bookings.create({ serviceId: created.serviceId, scheduledDate, scheduledTime: "08:00" });
    expect(result.id).toBeGreaterThan(0);
    created.bookingIds.push(result.id);
  });
});
