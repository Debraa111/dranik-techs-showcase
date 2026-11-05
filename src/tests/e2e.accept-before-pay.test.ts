/**
 * Payment now happens after provider acceptance, not before — this suite exercises
 * the actual tRPC routers (via appRouter.createCaller, same pattern as
 * auth.logout.test.ts) for the reordered gates:
 *   - bookings.create leaves a booking pending/unpaid and notifies the provider.
 *   - payments.initialize refuses to run until the booking is "confirmed".
 *   - bookings.updateStatus now allows "confirmed" while unpaid, but refuses
 *     "in_progress" until paid — the gate moved, it didn't disappear, since the
 *     escrow/release-code logic on "completed" still assumes paid-before-in_progress.
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
import type { User } from "../drizzle/schema";
import { bookings, categories, notifications, payments, providerProfiles, services, transactions, users, wallets } from "../drizzle/schema";

const hasDb = Boolean(process.env.TEST_DATABASE_URL);
const d = describe.runIf(hasDb);

const created = {
  customerId: 0,
  customerAuthUserId: "",
  providerUserId: 0,
  providerAuthUserId: "",
  providerId: 0,
  categoryId: 0,
  serviceId: 0,
  bookingIds: [] as number[],
};

async function makeUser(label: string, name: string) {
  return db.getOrCreateUserByAuthId(crypto.randomUUID(), { name, email: `${label}@test.dranik` }, { role: "user" });
}

function baseUser(id: number, authUserId: string, appRole: "customer" | "provider"): User {
  return {
    id,
    authUserId,
    email: null,
    name: null,
    phone: null,
    avatarUrl: null,
    role: "user",
    appRole,
    status: "active",
    emailVerified: false,
    phoneVerified: false,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
}

function callerFor(user: User) {
  const ctx: TrpcContext = { user, req: {} as TrpcContext["req"], res: {} as TrpcContext["res"] };
  return appRouter.createCaller(ctx);
}

/** Comfortably past the 60-minute lead-time guard from a prior feature. */
function farEnoughOut() {
  const target = new Date(Date.now() + 3 * 60 * 60 * 1000);
  return { scheduledDate: target.toISOString().slice(0, 10), scheduledTime: target.toISOString().slice(11, 16) };
}

d("E2E: payment only opens up after the provider accepts", () => {
  let bookingId = 0;

  beforeAll(async () => {
    const dbi = await db.getDb();
    if (!dbi) throw new Error("no db");

    const customer = await makeUser(`e2eaccept-customer-${Date.now()}`, "E2EAccept Customer");
    const providerUser = await makeUser(`e2eaccept-provider-${Date.now()}`, "E2EAccept Provider");
    created.customerId = customer.id;
    created.customerAuthUserId = customer.authUserId;
    created.providerUserId = providerUser.id;
    created.providerAuthUserId = providerUser.authUserId;

    created.providerId = await db.createProviderProfile({
      userId: providerUser.id,
      businessName: "E2EAccept Services",
      bio: "Test provider",
      yearsOfExperience: 2,
      city: "Lagos",
      state: "Lagos",
      verificationStatus: "verified",
    });

    const [catRow] = await dbi
      .insert(categories)
      .values({ name: `E2EAccept Cat ${Date.now()}`, slug: `e2eaccept-cat-${Date.now()}`, icon: "build", sortOrder: 999 })
      .returning({ id: categories.id });
    created.categoryId = catRow?.id ?? 0;

    created.serviceId = await db.createService({
      providerId: created.providerId,
      categoryId: created.categoryId,
      title: "E2EAccept Test Service",
      description: "Test service",
      basePrice: "12000.00",
      priceUnit: "fixed",
      isActive: true,
    });
  });

  afterAll(async () => {
    const dbi = await db.getDb();
    if (!dbi) return;
    if (created.bookingIds.length) {
      await dbi.delete(payments).where(inArray(payments.bookingId, created.bookingIds));
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

  it("1. creating a booking leaves it pending/unpaid and notifies the provider", async () => {
    const customerCaller = callerFor(baseUser(created.customerId, created.customerAuthUserId, "customer"));
    const { scheduledDate, scheduledTime } = farEnoughOut();
    const { id } = await customerCaller.bookings.create({ serviceId: created.serviceId, scheduledDate, scheduledTime });
    bookingId = id;
    created.bookingIds.push(id);

    const row = await db.getBookingById(id);
    expect(row!.booking.status).toBe("pending");
    expect(row!.booking.paymentStatus).toBe("unpaid");

    const dbi = await db.getDb();
    const notifs = await dbi!.select().from(notifications).where(eq(notifications.userId, created.providerUserId));
    expect(notifs.some((n) => n.type === "new_booking_request")).toBe(true);
  });

  it("2. the customer cannot pay while the booking is still pending", async () => {
    const customerCaller = callerFor(baseUser(created.customerId, created.customerAuthUserId, "customer"));
    await expect(customerCaller.payments.initialize({ bookingId, method: "wallet" })).rejects.toThrow(
      /must be accepted by the provider/,
    );
  });

  it("3. the provider can accept an unpaid booking", async () => {
    const providerCaller = callerFor(baseUser(created.providerUserId, created.providerAuthUserId, "provider"));
    await providerCaller.bookings.updateStatus({ id: bookingId, status: "confirmed" });
    const row = await db.getBookingById(bookingId);
    expect(row!.booking.status).toBe("confirmed");
    expect(row!.booking.paymentStatus).toBe("unpaid");
  });

  it("4. the provider cannot start the job before it's paid", async () => {
    const providerCaller = callerFor(baseUser(created.providerUserId, created.providerAuthUserId, "provider"));
    await expect(providerCaller.bookings.updateStatus({ id: bookingId, status: "in_progress" })).rejects.toThrow(
      /hasn't been paid for yet and can't be started/,
    );
  });

  it("5. now that it's confirmed, the customer can pay", async () => {
    const customerCaller = callerFor(baseUser(created.customerId, created.customerAuthUserId, "customer"));
    // Fund the wallet so a wallet payment actually succeeds.
    await db.recordTransaction({ userId: created.customerId, type: "credit", category: "adjustment", amount: 20000, description: "test funding" });
    const result = await customerCaller.payments.initialize({ bookingId, method: "wallet" });
    expect(result.mock).toBe(false);

    const row = await db.getBookingById(bookingId);
    expect(row!.booking.paymentStatus).toBe("paid");
  });

  it("6. paying twice is rejected", async () => {
    const customerCaller = callerFor(baseUser(created.customerId, created.customerAuthUserId, "customer"));
    await expect(customerCaller.payments.initialize({ bookingId, method: "wallet" })).rejects.toThrow(/already paid/);
  });

  it("7. the provider can now start the job, and the escrow release-code invariant still holds through completion", async () => {
    const providerCaller = callerFor(baseUser(created.providerUserId, created.providerAuthUserId, "provider"));
    await providerCaller.bookings.updateStatus({ id: bookingId, status: "in_progress" });
    let row = await db.getBookingById(bookingId);
    expect(row!.booking.status).toBe("in_progress");

    await providerCaller.bookings.updateStatus({ id: bookingId, status: "completed" });
    row = await db.getBookingById(bookingId);
    expect(row!.booking.status).toBe("completed");
    // The whole point of moving the gate rather than dropping it: paid-before-in_progress
    // still holds by the time "completed" is reached, so the payout hold + release code
    // still generate exactly as before this change.
    expect(row!.booking.payoutStatus).toBe("held");
    expect(row!.booking.releaseCodeHash).toBeTruthy();
  });

  it("8. a provider can decline a pending, unpaid booking outright — nothing was ever paid, so there's nothing to refund", async () => {
    const customerCaller = callerFor(baseUser(created.customerId, created.customerAuthUserId, "customer"));
    const { scheduledDate, scheduledTime } = farEnoughOut();
    const { id } = await customerCaller.bookings.create({ serviceId: created.serviceId, scheduledDate, scheduledTime });
    created.bookingIds.push(id);

    const providerCaller = callerFor(baseUser(created.providerUserId, created.providerAuthUserId, "provider"));
    await providerCaller.bookings.updateStatus({ id, status: "rejected", note: "Fully booked" });

    const row = await db.getBookingById(id);
    expect(row!.booking.status).toBe("rejected");
    expect(row!.booking.paymentStatus).toBe("unpaid");
  });
});
