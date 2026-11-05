/**
 * Platform booking fee tests: itemization at creation, forward-only settings
 * changes, and — critically — that commission is calculated on the service amount
 * only, never on the flat fee (creditProviderEarning, getBookingCommissionBreakdown,
 * getFinanceSummary, listCommissionLedger all touch this).
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
  customerAuthUserId: "",
  providerUserId: 0,
  providerId: 0,
  categoryId: 0,
  serviceId: 0,
  bookingIds: [] as number[],
};

async function makeUser(label: string, name: string) {
  return db.getOrCreateUserByAuthId(crypto.randomUUID(), { name, email: `${label}@test.dranik` }, { role: "user" });
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

/** Comfortably past the 60-minute lead-time guard from a prior feature. */
function farEnoughOut() {
  const target = new Date(Date.now() + 3 * 60 * 60 * 1000);
  return { scheduledDate: target.toISOString().slice(0, 10), scheduledTime: target.toISOString().slice(11, 16) };
}

d("E2E: platform booking fee", () => {
  let originalEnabled = true;
  let originalAmount = "500.00";
  let releasedBookingId = 0;

  beforeAll(async () => {
    const dbi = await db.getDb();
    if (!dbi) throw new Error("no db");
    const settings = await db.getPlatformSettings();
    originalEnabled = settings.bookingFeeEnabled;
    originalAmount = settings.bookingFeeAmount;

    const customer = await makeUser(`e2efee-customer-${Date.now()}`, "E2EFee Customer");
    const providerUser = await makeUser(`e2efee-provider-${Date.now()}`, "E2EFee Provider");
    created.customerId = customer.id;
    created.customerAuthUserId = customer.authUserId;
    created.providerUserId = providerUser.id;

    created.providerId = await db.createProviderProfile({
      userId: providerUser.id,
      businessName: "E2EFee Services",
      bio: "Test provider",
      yearsOfExperience: 2,
      city: "Lagos",
      state: "Lagos",
      commissionRate: "10.00",
    });

    const [catRow] = await dbi
      .insert(categories)
      .values({ name: `E2EFee Cat ${Date.now()}`, slug: `e2efee-cat-${Date.now()}`, icon: "build", sortOrder: 999 })
      .returning({ id: categories.id });
    created.categoryId = catRow?.id ?? 0;

    created.serviceId = await db.createService({
      providerId: created.providerId,
      categoryId: created.categoryId,
      title: "E2EFee Test Service",
      description: "Test service",
      basePrice: "20000.00",
      priceUnit: "fixed",
      isActive: true,
    });
  });

  afterAll(async () => {
    const dbi = await db.getDb();
    if (!dbi) return;
    // Restore whatever the fee settings were before this suite touched them.
    await db.updateBookingFeeSettings({ enabled: originalEnabled, amount: Number(originalAmount), updatedByUserId: created.customerId || 0 });

    if (created.bookingIds.length) await dbi.delete(bookings).where(inArray(bookings.id, created.bookingIds));
    if (created.serviceId) await dbi.delete(services).where(eq(services.id, created.serviceId));
    if (created.providerId) await dbi.delete(providerProfiles).where(eq(providerProfiles.id, created.providerId));
    if (created.categoryId) await dbi.delete(categories).where(eq(categories.id, created.categoryId));
    for (const uid of [created.customerId, created.providerUserId]) {
      if (!uid) continue;
      await dbi.delete(users).where(eq(users.id, uid));
    }
  });

  it("1. a new booking is charged the current fee, itemized in subtotal/platformFee/total", async () => {
    await db.updateBookingFeeSettings({ enabled: true, amount: 500, updatedByUserId: created.customerId });
    const caller = callerFor(created.customerId, created.customerAuthUserId);
    const { scheduledDate, scheduledTime } = farEnoughOut();
    const { id } = await caller.bookings.create({ serviceId: created.serviceId, scheduledDate, scheduledTime });
    created.bookingIds.push(id);

    const dbi = await db.getDb();
    const row = (await dbi!.select().from(bookings).where(eq(bookings.id, id)))[0];
    expect(Number(row.subtotal)).toBe(20000);
    expect(Number(row.platformFee)).toBe(500);
    expect(Number(row.total)).toBe(20500);
  });

  it("2. disabling the fee means new bookings get platformFee 0, but the earlier booking is untouched", async () => {
    const earlierBookingId = created.bookingIds[0];
    await db.updateBookingFeeSettings({ enabled: false, amount: 500, updatedByUserId: created.customerId });

    const caller = callerFor(created.customerId, created.customerAuthUserId);
    const { scheduledDate, scheduledTime } = farEnoughOut();
    const { id } = await caller.bookings.create({ serviceId: created.serviceId, scheduledDate, scheduledTime });
    created.bookingIds.push(id);

    const dbi = await db.getDb();
    const newRow = (await dbi!.select().from(bookings).where(eq(bookings.id, id)))[0];
    expect(Number(newRow.platformFee)).toBe(0);
    expect(Number(newRow.total)).toBe(20000);

    // Forward-only: the earlier booking (created while the fee was enabled) keeps
    // its own frozen fee — disabling later doesn't retroactively strip it.
    const earlierRow = (await dbi!.select().from(bookings).where(eq(bookings.id, earlierBookingId)))[0];
    expect(Number(earlierRow.platformFee)).toBe(500);
  });

  it("3. changing the fee amount doesn't retroactively change an already-placed booking", async () => {
    await db.updateBookingFeeSettings({ enabled: true, amount: 500, updatedByUserId: created.customerId });
    const caller = callerFor(created.customerId, created.customerAuthUserId);
    const { scheduledDate, scheduledTime } = farEnoughOut();
    const { id } = await caller.bookings.create({ serviceId: created.serviceId, scheduledDate, scheduledTime });
    created.bookingIds.push(id);

    await db.updateBookingFeeSettings({ enabled: true, amount: 1500, updatedByUserId: created.customerId });

    const dbi = await db.getDb();
    const row = (await dbi!.select().from(bookings).where(eq(bookings.id, id)))[0];
    expect(Number(row.platformFee)).toBe(500); // unchanged, frozen at creation
  });

  it("4. commission is calculated on the service amount only, excluding the platform fee", async () => {
    await db.updateBookingFeeSettings({ enabled: true, amount: 500, updatedByUserId: created.customerId });
    const caller = callerFor(created.customerId, created.customerAuthUserId);
    const { scheduledDate, scheduledTime } = farEnoughOut();
    const { id: bookingId } = await caller.bookings.create({ serviceId: created.serviceId, scheduledDate, scheduledTime });
    created.bookingIds.push(bookingId);
    releasedBookingId = bookingId;

    const dbi = await db.getDb();
    await dbi!.update(bookings).set({ paymentStatus: "paid" }).where(eq(bookings.id, bookingId));
    await db.updateBookingStatus({ bookingId, toStatus: "confirmed", changedByUserId: created.providerUserId });
    await db.updateBookingStatus({ bookingId, toStatus: "in_progress", changedByUserId: created.providerUserId });
    const completeResult = await db.updateBookingStatus({ bookingId, toStatus: "completed", changedByUserId: created.providerUserId });

    const before = await db.getOrCreateWallet(created.providerUserId);
    const result = await db.confirmReleaseCode({ bookingId, providerUserId: created.providerUserId, code: completeResult.releaseCode! });
    expect(result.success).toBe(true);
    // total = 20500 (20000 service + 500 fee). Commission base must be 20000, not
    // 20500 — 10% of 20000 = 2000, earning = 18000. If the fee leaked into the base,
    // this would come out to 18450 instead.
    if (result.success) expect(result.earning).toBe(18000);

    const after = await db.getOrCreateWallet(created.providerUserId);
    expect(Number(after.balance)).toBe(Number(before.balance) + 18000);

    const breakdown = await db.getBookingCommissionBreakdown(bookingId);
    expect(breakdown!.commission).toBe(2000);
    expect(breakdown!.providerEarning).toBe(18000);
    expect(breakdown!.platformFee).toBe(500);
  });

  it("5. finance summary and commission ledger both exclude the fee from commission, and report it separately", async () => {
    const summary = await db.getFinanceSummary();
    expect(summary.bookingFeesCollected).toBeGreaterThanOrEqual(500);
    expect(typeof summary.platformCommission).toBe("number");

    const ledger = await db.listCommissionLedger({});
    const entry = ledger.rows.find((r) => r.bookingId === releasedBookingId);
    expect(entry).toBeTruthy();
    expect(entry!.total).toBe(20500);
    expect(entry!.commission).toBe(2000);
  });
});
