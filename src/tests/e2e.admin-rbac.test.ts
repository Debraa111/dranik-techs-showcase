/**
 * Admin RBAC and admin-management data-layer tests.
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
import { adminRoleAssignments, categories, users } from "../drizzle/schema";

const hasDb = Boolean(process.env.TEST_DATABASE_URL);
const d = describe.runIf(hasDb);

const created = {
  userIds: [] as number[],
  categoryIds: [] as number[],
};

async function makeUser(label: string, name: string) {
  const user = await db.getOrCreateUserByAuthId(crypto.randomUUID(), { name, email: `${label}@test.dranik` }, { role: "user" });
  created.userIds.push(user.id);
  return user;
}

d("E2E: admin RBAC", () => {
  afterAll(async () => {
    const dbi = await db.getDb();
    if (!dbi) return;
    if (created.userIds.length) {
      await dbi.delete(adminRoleAssignments).where(inArray(adminRoleAssignments.userId, created.userIds));
      await dbi.delete(users).where(inArray(users.id, created.userIds));
    }
    if (created.categoryIds.length) {
      await dbi.delete(categories).where(inArray(categories.id, created.categoryIds));
    }
  });

  it("1. a plain user has no admin roles and no permissions", async () => {
    const user = await makeUser("e2erbac-plain", "Plain User");
    expect(await db.getAdminRoles(user.id)).toEqual([]);
    expect(await db.hasAdminPermission(user.id, "users")).toBe(false);
    expect(await db.hasAdminPermission(user.id, "finance")).toBe(false);
  });

  it("2. assigning a role grants only its mapped resources, and flips role to admin", async () => {
    const user = await makeUser("e2erbac-finance", "Finance Admin User");
    const admin = await makeUser("e2erbac-super", "Super Admin User");
    await db.assignAdminRole({ targetUserId: user.id, role: "finance_admin", assignedByUserId: admin.id });

    expect(await db.hasAdminPermission(user.id, "finance")).toBe(true);
    expect(await db.hasAdminPermission(user.id, "users")).toBe(false);
    expect(await db.hasAdminPermission(user.id, "categories")).toBe(false);

    const updated = await db.getUserById(user.id);
    expect(updated!.role).toBe("admin");
  });

  it("3. super_admin bypasses every resource check, including ones not in the map", async () => {
    const user = await makeUser("e2erbac-super2", "Super Admin User 2");
    await db.assignAdminRole({ targetUserId: user.id, role: "super_admin", assignedByUserId: user.id });

    expect(await db.hasAdminPermission(user.id, "users")).toBe(true);
    expect(await db.hasAdminPermission(user.id, "finance")).toBe(true);
    expect(await db.hasAdminPermission(user.id, "categories")).toBe(true);
    expect(await db.hasAdminPermission(user.id, "some_future_resource")).toBe(true);
  });

  it("4. a user can hold multiple roles, and removing one leaves the other intact", async () => {
    const user = await makeUser("e2erbac-multi", "Multi Role User");
    await db.assignAdminRole({ targetUserId: user.id, role: "operations_admin", assignedByUserId: user.id });
    await db.assignAdminRole({ targetUserId: user.id, role: "content_admin", assignedByUserId: user.id });

    let roles = await db.getAdminRoles(user.id);
    expect(roles.sort()).toEqual(["content_admin", "operations_admin"].sort());
    expect(await db.hasAdminPermission(user.id, "bookings")).toBe(true);
    expect(await db.hasAdminPermission(user.id, "categories")).toBe(true);

    await db.removeAdminRole({ targetUserId: user.id, role: "operations_admin" });
    roles = await db.getAdminRoles(user.id);
    expect(roles).toEqual(["content_admin"]);
    expect(await db.hasAdminPermission(user.id, "bookings")).toBe(false);
    expect(await db.hasAdminPermission(user.id, "categories")).toBe(true);

    // Removing a role doesn't demote the account — it can still reach the dashboard,
    // just with fewer permissions (see setAdminAccountActive for full revocation).
    const stillAdmin = await db.getUserById(user.id);
    expect(stillAdmin!.role).toBe("admin");
  });

  it("5. deactivating admin access demotes the account and clears every role", async () => {
    const user = await makeUser("e2erbac-deactivate", "To Be Deactivated");
    await db.assignAdminRole({ targetUserId: user.id, role: "support_admin", assignedByUserId: user.id });
    await db.assignAdminRole({ targetUserId: user.id, role: "content_admin", assignedByUserId: user.id });
    expect((await db.getAdminRoles(user.id)).length).toBe(2);

    await db.setAdminAccountActive({ targetUserId: user.id, active: false });

    const demoted = await db.getUserById(user.id);
    expect(demoted!.role).toBe("user");
    expect(await db.getAdminRoles(user.id)).toEqual([]);

    // Reinstating starts from a clean slate — no stale roles resurrect.
    await db.setAdminAccountActive({ targetUserId: user.id, active: true });
    const reinstated = await db.getUserById(user.id);
    expect(reinstated!.role).toBe("admin");
    expect(await db.getAdminRoles(user.id)).toEqual([]);
  });

  it("6. assigning the same role twice doesn't duplicate it", async () => {
    const user = await makeUser("e2erbac-dup", "Dup Role User");
    await db.assignAdminRole({ targetUserId: user.id, role: "finance_admin", assignedByUserId: user.id });
    await db.assignAdminRole({ targetUserId: user.id, role: "finance_admin", assignedByUserId: user.id });
    expect(await db.getAdminRoles(user.id)).toEqual(["finance_admin"]);
  });

  it("7. listAdminUsers only returns accounts with role admin, each with their roles attached", async () => {
    const plain = await makeUser("e2erbac-list-plain", "Not An Admin");
    const admin = await makeUser("e2erbac-list-admin", "Is An Admin");
    await db.assignAdminRole({ targetUserId: admin.id, role: "content_admin", assignedByUserId: admin.id });

    const list = await db.listAdminUsers();
    const ids = list.map((a) => a.id);
    expect(ids).toContain(admin.id);
    expect(ids).not.toContain(plain.id);
    const found = list.find((a) => a.id === admin.id)!;
    expect(found.roles).toEqual(["content_admin"]);
  });

  it("8. suspending/reactivating a user persists status changes", async () => {
    const user = await makeUser("e2erbac-status", "Status Test User");
    expect((await db.getUserById(user.id))!.status).toBe("active");

    await db.setUserStatusAdmin({ userId: user.id, status: "suspended" });
    expect((await db.getUserById(user.id))!.status).toBe("suspended");

    await db.setUserStatusAdmin({ userId: user.id, status: "active" });
    expect((await db.getUserById(user.id))!.status).toBe("active");
  });

  it("9. audit log query filters by action prefix and entityType", async () => {
    const admin = await makeUser("e2erbac-audit", "Audit Actor");
    await db.logAudit({ userId: admin.id, action: "test.rbac.alpha", entityType: "widget", entityId: 1 });
    await db.logAudit({ userId: admin.id, action: "test.rbac.beta", entityType: "gadget", entityId: 2 });

    const byPrefix = await db.listAuditLogs({ action: "test.rbac.alpha" });
    expect(byPrefix.rows.some((r) => r.log.action === "test.rbac.alpha")).toBe(true);
    expect(byPrefix.rows.every((r) => r.log.action.startsWith("test.rbac.alpha"))).toBe(true);

    const byEntity = await db.listAuditLogs({ entityType: "gadget", userId: admin.id });
    expect(byEntity.rows.length).toBe(1);
    expect(byEntity.rows[0].log.action).toBe("test.rbac.beta");
    expect(byEntity.rows[0].actorName).toBe("Audit Actor");
  });

  it("10. category CRUD: create, update, deactivate, and active-service-count aggregation", async () => {
    const slug = `e2erbac-cat-${Date.now()}`;
    const id = await db.createCategoryAdmin({ name: "E2E RBAC Category", slug, sortOrder: 999 });
    created.categoryIds.push(id);

    let list = await db.listCategoriesAdmin();
    let row = list.find((c) => c.id === id)!;
    expect(row.isActive).toBe(true);
    expect(row.activeServiceCount).toBe(0); // no services created against it

    await db.updateCategoryAdmin(id, { name: "E2E RBAC Category Renamed", isActive: false });
    list = await db.listCategoriesAdmin();
    row = list.find((c) => c.id === id)!;
    expect(row.name).toBe("E2E RBAC Category Renamed");
    expect(row.isActive).toBe(false);
  });

  it("11. finance summary and user/booking browsers run and return well-shaped results", async () => {
    const summary = await db.getFinanceSummary();
    expect(typeof summary.gmv).toBe("number");
    expect(typeof summary.platformCommission).toBe("number");
    expect(typeof summary.providerEarnings).toBe("number");
    expect(typeof summary.refunds).toBe("number");
    expect(summary.payments).toHaveProperty("pending");
    expect(summary.payments).toHaveProperty("successful");

    const userList = await db.listUsersAdmin({ limit: 5, offset: 0 });
    expect(Array.isArray(userList.rows)).toBe(true);
    expect(typeof userList.total).toBe("number");

    const bookingList = await db.listBookingsAdmin({ limit: 5, offset: 0 });
    expect(Array.isArray(bookingList.rows)).toBe(true);
    expect(typeof bookingList.total).toBe("number");
  });
});
