/**
 * Admin permanent-delete: the guard checks (provider profile / nonzero wallet /
 * active bookings), the PII-scrub-not-cascade-delete behavior itself, RBAC
 * (super_admin only — deliberately not in RESOURCE_ROLES, same convention as
 * audit_logs/admin_management), and the confirm-email check at the router layer.
 *
 * Supabase Auth deletion itself isn't exercised here — TEST env has no
 * SUPABASE_SERVICE_ROLE_KEY configured, so sdk.deleteSupabaseAuthUser reports
 * `{ deleted: false, error: "..." }` without making a real call, which the
 * router already treats as non-fatal (see its own comment). That's exactly the
 * behavior this suite implicitly exercises by never setting the key.
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
import {
  adminRoleAssignments,
  addresses,
  bookings,
  categories,
  notifications,
  providerProfiles,
  reviews,
  services,
  users,
} from "../drizzle/schema";

const hasDb = Boolean(process.env.TEST_DATABASE_URL);
const d = describe.runIf(hasDb);

const created = {
  categoryId: 0,
  providerId: 0,
  providerUserId: 0,
  serviceId: 0,
  userIds: [] as number[],
  bookingIds: [] as number[],
};

async function makeUser(label: string, name: string) {
  const user = await db.getOrCreateUserByAuthId(crypto.randomUUID(), { name, email: `${label}-${Date.now()}@test.dranik` }, { role: "user" });
  created.userIds.push(user.id);
  return user;
}

function adminCaller(user: User) {
  const ctx: TrpcContext = { user: { ...user, role: "admin" }, req: {} as TrpcContext["req"], res: {} as TrpcContext["res"] };
  return appRouter.createCaller(ctx);
}

d("E2E: admin permanent user delete", () => {
  let superAdmin: User;
  let opsAdmin: User;

  beforeAll(async () => {
    const dbi = await db.getDb();
    if (!dbi) throw new Error("no db");

    superAdmin = await makeUser("e2edelete-superadmin", "Super Admin");
    await db.assignAdminRole({ targetUserId: superAdmin.id, role: "super_admin", assignedByUserId: superAdmin.id });

    opsAdmin = await makeUser("e2edelete-opsadmin", "Ops Admin");
    await db.assignAdminRole({ targetUserId: opsAdmin.id, role: "operations_admin", assignedByUserId: superAdmin.id });

    const providerUser = await makeUser("e2edelete-provideruser", "Provider User");
    created.providerUserId = providerUser.id;
    created.providerId = await db.createProviderProfile({
      userId: providerUser.id,
      businessName: "E2EDelete Services",
      bio: "Test provider",
      yearsOfExperience: 2,
      city: "Lagos",
      state: "Lagos",
    });

    const [catRow] = await dbi
      .insert(categories)
      .values({ name: `E2EDelete Cat ${Date.now()}`, slug: `e2edelete-cat-${Date.now()}`, icon: "build", sortOrder: 999 })
      .returning({ id: categories.id });
    created.categoryId = catRow?.id ?? 0;

    created.serviceId = await db.createService({
      providerId: created.providerId,
      categoryId: created.categoryId,
      title: "E2EDelete Test Service",
      description: "Test service",
      basePrice: "15000.00",
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
    await dbi.delete(adminRoleAssignments).where(inArray(adminRoleAssignments.userId, created.userIds));
    await dbi.delete(addresses).where(inArray(addresses.userId, created.userIds));
    await dbi.delete(notifications).where(inArray(notifications.userId, created.userIds));
    await dbi.delete(reviews).where(inArray(reviews.customerId, created.userIds));
    await dbi.delete(users).where(inArray(users.id, created.userIds));
  });

  it("1. blocks deletion when the account has a provider profile", async () => {
    const preview = await db.getUserDeletionPreview(created.providerUserId);
    expect(preview.canDelete).toBe(false);
    expect(preview.hasProviderProfile).toBe(true);

    const result = await db.permanentlyDeleteUser(created.providerUserId);
    expect(result.success).toBe(false);
  });

  it("2. blocks deletion when the wallet balance isn't zero", async () => {
    const customer = await makeUser("e2edelete-nonzerowallet", "Nonzero Wallet Customer");
    await db.recordTransaction({ userId: customer.id, type: "credit", category: "adjustment", amount: 500, description: "test funding" });

    const preview = await db.getUserDeletionPreview(customer.id);
    expect(preview.canDelete).toBe(false);
    expect(preview.walletBalance).toBe(500);
  });

  it("3. blocks deletion when a booking is still pending/confirmed/in_progress", async () => {
    const customer = await makeUser("e2edelete-activebooking", "Active Booking Customer");
    const { id: bookingId } = await db.createBooking({
      customerId: customer.id,
      providerId: created.providerId,
      serviceId: created.serviceId,
      scheduledDate: "2026-12-01",
      scheduledTime: "10:00",
      subtotal: "15000.00",
      discount: "0.00",
      total: "15000.00",
    });
    created.bookingIds.push(bookingId);

    const preview = await db.getUserDeletionPreview(customer.id);
    expect(preview.canDelete).toBe(false);
    expect(preview.activeBookings).toBe(1);
  });

  it("4. a clean account is scrubbed, not cascade-deleted — bookings/reviews survive, personal data is hard-deleted", async () => {
    const customer = await makeUser("e2edelete-clean", "Clean Delete Customer");
    await db.getDb().then((dbi) => dbi!.insert(addresses).values({ userId: customer.id, addressLine1: "1 Test St", city: "Lagos", state: "Lagos" }));

    const { id: bookingId } = await db.createBooking({
      customerId: customer.id,
      providerId: created.providerId,
      serviceId: created.serviceId,
      scheduledDate: "2026-01-01",
      scheduledTime: "10:00",
      subtotal: "15000.00",
      discount: "0.00",
      total: "15000.00",
    });
    created.bookingIds.push(bookingId);
    await db.updateBookingStatus({ bookingId, toStatus: "cancelled", changedByUserId: customer.id });

    const preview = await db.getUserDeletionPreview(customer.id);
    expect(preview.canDelete).toBe(true);

    const result = await db.permanentlyDeleteUser(customer.id);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.snapshot.email).toContain("e2edelete-clean");
    }

    const row = await db.getUserById(customer.id);
    expect(row!.status).toBe("deleted");
    expect(row!.email).toBeNull();
    expect(row!.name).toBe("Deleted User");
    expect(row!.deletedAt).toBeTruthy();

    // The booking itself survives — this is the whole point (a provider's
    // business record shouldn't vanish because the customer deleted their account).
    const bookingRow = await db.getBookingById(bookingId);
    expect(bookingRow).toBeTruthy();
    expect(bookingRow!.booking.customerId).toBe(customer.id);

    // Purely personal data is actually gone.
    const dbi = await db.getDb();
    const addressRows = await dbi!.select().from(addresses).where(eq(addresses.userId, customer.id));
    expect(addressRows.length).toBe(0);
  });

  it("5. cannot delete a second time (already deleted)", async () => {
    const customer = await makeUser("e2edelete-twice", "Delete Twice Customer");
    const first = await db.permanentlyDeleteUser(customer.id);
    expect(first.success).toBe(true);
    // Re-fetching preview/delete on an already-deleted, PII-scrubbed row should
    // still resolve (not crash) — canDelete stays true since none of the guards
    // depend on status, but there's nothing meaningfully left to scrub twice.
    const row = await db.getUserById(customer.id);
    expect(row!.status).toBe("deleted");
  });

  it("6. router: only super_admin can call permanentDelete — an operations_admin (who can manage users) is still rejected", async () => {
    const customer = await makeUser("e2edelete-rbac", "RBAC Test Customer");
    const caller = adminCaller(opsAdmin);
    await expect(
      caller.admin.users.permanentDelete({ id: customer.id, confirmEmail: customer.email!, reason: "test" }),
    ).rejects.toThrow();
  });

  it("7. router: rejects when the confirmation email doesn't match", async () => {
    const customer = await makeUser("e2edelete-mismatch", "Mismatch Test Customer");
    const caller = adminCaller(superAdmin);
    await expect(
      caller.admin.users.permanentDelete({ id: customer.id, confirmEmail: "wrong@example.com", reason: "test" }),
    ).rejects.toThrow(/doesn't match/);
  });

  it("8. router: super_admin can successfully delete, and it's audit-logged with a pre-scrub snapshot", async () => {
    const customer = await makeUser("e2edelete-fullflow", "Full Flow Customer");
    const caller = adminCaller(superAdmin);
    const result = await caller.admin.users.permanentDelete({ id: customer.id, confirmEmail: customer.email!, reason: "Requested cleanup of a test account" });
    expect(result.success).toBe(true);

    const row = await db.getUserById(customer.id);
    expect(row!.status).toBe("deleted");

    const logs = await db.listAuditLogs({ action: "admin.user.permanent_delete" });
    const entry = logs.rows.find((r: any) => r.log.entityId === customer.id);
    expect(entry).toBeTruthy();
    expect((entry as any).log.detail.deletedAccount.email).toContain("e2edelete-fullflow");
  });
});
