/**
 * Commission management tests (platformSettings, updateDefaultCommissionRate,
 * listCommissionLedger in db.ts).
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
import { bookings, categories, providerProfiles, services, users } from "../drizzle/schema";

const hasDb = Boolean(process.env.TEST_DATABASE_URL);
const d = describe.runIf(hasDb);

const created = {
  userIds: [] as number[],
  providerIds: [] as number[],
  categoryId: 0,
  serviceIds: [] as number[],
  bookingIds: [] as number[],
};

async function makeUser(label: string, name: string) {
  const user = await db.getOrCreateUserByAuthId(crypto.randomUUID(), { name, email: `${label}@test.dranik` }, { role: "user" });
  created.userIds.push(user.id);
  return user;
}

d("E2E: commission management", () => {
  let originalDefaultRate = "10.00";

  beforeAll(async () => {
    const dbi = await db.getDb();
    if (!dbi) throw new Error("no db");
    const settings = await db.getPlatformSettings();
    originalDefaultRate = settings.defaultCommissionRate;

    const [catRow] = await dbi
      .insert(categories)
      .values({ name: `E2EComm Cat ${Date.now()}`, slug: `e2ecomm-cat-${Date.now()}`, icon: "build", sortOrder: 999 })
      .returning({ id: categories.id });
    created.categoryId = catRow?.id ?? 0;
  });

  afterAll(async () => {
    const dbi = await db.getDb();
    if (!dbi) return;
    // Restore whatever the default rate was before this suite touched it.
    await db.updateDefaultCommissionRate({ rate: Number(originalDefaultRate), updatedByUserId: created.userIds[0] ?? 0 });

    if (created.bookingIds.length) await dbi.delete(bookings).where(inArray(bookings.id, created.bookingIds));
    if (created.serviceIds.length) await dbi.delete(services).where(inArray(services.id, created.serviceIds));
    if (created.providerIds.length) await dbi.delete(providerProfiles).where(inArray(providerProfiles.id, created.providerIds));
    if (created.categoryId) await dbi.delete(categories).where(eq(categories.id, created.categoryId));
    if (created.userIds.length) await dbi.delete(users).where(inArray(users.id, created.userIds));
  });

  it("1. getPlatformSettings lazily creates a single settings row with the schema default", async () => {
    const settings = await db.getPlatformSettings();
    expect(settings.id).toBeGreaterThan(0);
    expect(Number(settings.defaultCommissionRate)).toBeGreaterThanOrEqual(0);

    const again = await db.getPlatformSettings();
    expect(again.id).toBe(settings.id); // same row, not a new one each call
  });

  it("2. updateDefaultCommissionRate persists the change and reports from/to", async () => {
    const admin = await makeUser("e2ecomm-admin", "Commission Admin");
    await db.updateDefaultCommissionRate({ rate: 12, updatedByUserId: admin.id });

    const settings = await db.getPlatformSettings();
    expect(Number(settings.defaultCommissionRate)).toBe(12);
    expect(settings.updatedByUserId).toBe(admin.id);

    const result = await db.updateDefaultCommissionRate({ rate: 15, updatedByUserId: admin.id });
    expect(result).toEqual({ from: 12, to: 15 });
  });

  it("3. a new provider is seeded from the current default rate, not the schema's own default", async () => {
    const admin = await makeUser("e2ecomm-admin2", "Commission Admin 2");
    await db.updateDefaultCommissionRate({ rate: 17.5, updatedByUserId: admin.id });

    const providerUser = await makeUser("e2ecomm-provider", "Rate Test Provider");
    // Mirrors what provider.onboard (routers.ts) actually does: fetch the current
    // setting, pass it explicitly rather than relying on the column default.
    const { defaultCommissionRate } = await db.getPlatformSettings();
    const providerId = await db.createProviderProfile({
      userId: providerUser.id,
      businessName: "E2EComm Test Provider",
      bio: "Test",
      yearsOfExperience: 1,
      city: "Lagos",
      state: "Lagos",
      commissionRate: defaultCommissionRate,
    });
    created.providerIds.push(providerId);

    const profile = await db.getProviderProfileByUserId(providerUser.id);
    expect(Number(profile!.commissionRate)).toBe(17.5);
  });

  it("4. changing the default rate never touches an existing provider's own rate", async () => {
    const admin = await makeUser("e2ecomm-admin3", "Commission Admin 3");
    await db.updateDefaultCommissionRate({ rate: 8, updatedByUserId: admin.id });

    const providerUser = await makeUser("e2ecomm-existing", "Existing Provider");
    const providerId = await db.createProviderProfile({
      userId: providerUser.id,
      businessName: "E2EComm Existing Provider",
      bio: "Test",
      yearsOfExperience: 1,
      city: "Lagos",
      state: "Lagos",
      commissionRate: "8.00",
    });
    created.providerIds.push(providerId);

    // The default changes again — this provider's own rate must stay exactly as set.
    await db.updateDefaultCommissionRate({ rate: 20, updatedByUserId: admin.id });
    const profile = await db.getProviderProfileByUserId(providerUser.id);
    expect(Number(profile!.commissionRate)).toBe(8);
  });

  it("5. commission ledger reflects real released payouts with correct math", async () => {
    const customer = await makeUser("e2ecomm-customer", "E2EComm Customer");
    const providerUser = await makeUser("e2ecomm-ledger-provider", "Ledger Provider");
    const providerId = await db.createProviderProfile({
      userId: providerUser.id,
      businessName: "E2EComm Ledger Provider",
      bio: "Test",
      yearsOfExperience: 1,
      city: "Lagos",
      state: "Lagos",
      commissionRate: "10.00",
    });
    created.providerIds.push(providerId);

    const serviceId = await db.createService({
      providerId,
      categoryId: created.categoryId,
      title: "E2EComm Ledger Service",
      description: "Test",
      basePrice: "20000.00",
      priceUnit: "fixed",
      isActive: true,
    });
    created.serviceIds.push(serviceId);

    const { id: bookingId } = await db.createBooking({
      customerId: customer.id,
      providerId,
      serviceId,
      scheduledDate: "2026-08-21",
      scheduledTime: "09:00",
      subtotal: "20000.00",
      discount: "0.00",
      total: "20000.00",
    });
    created.bookingIds.push(bookingId);

    const dbi = await db.getDb();
    await dbi!.update(bookings).set({ paymentStatus: "paid" }).where(eq(bookings.id, bookingId));
    await db.updateBookingStatus({ bookingId, toStatus: "confirmed", changedByUserId: providerUser.id });
    await db.updateBookingStatus({ bookingId, toStatus: "in_progress", changedByUserId: providerUser.id });
    const completeResult = await db.updateBookingStatus({ bookingId, toStatus: "completed", changedByUserId: providerUser.id });
    await db.confirmReleaseCode({ bookingId, providerUserId: providerUser.id, code: completeResult.releaseCode! });

    const ledger = await db.listCommissionLedger({});
    const entry = ledger.rows.find((r) => r.bookingId === bookingId);
    expect(entry).toBeTruthy();
    expect(entry!.total).toBe(20000);
    expect(entry!.commission).toBe(2000); // 10% of 20000
    expect(entry!.earning).toBe(18000);
  });
});
