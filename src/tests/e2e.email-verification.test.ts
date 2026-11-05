/**
 * getOrCreateUserByAuthId's emailVerified syncing — the field sdk.ts populates from
 * Supabase's real email_confirmed_at on every authenticated request (see its own
 * comment in server/_core/sdk.ts). Session issuance itself is gated by Supabase's
 * project-level "Confirm email" setting, which isn't something this suite can
 * exercise (it would require hitting real Supabase Auth) — this covers the one
 * piece of that flow that lives in this codebase: the sync into our own `users` row.
 *
 * Requires a dedicated TEST_DATABASE_URL — skipped otherwise, so this suite
 * never writes to the real app database (see vitest.setup.ts, which
 * redirects DATABASE_URL to it for the duration of the test run).
 *
 * All rows created here are cleaned up in afterAll.
 */
import { afterAll, describe, expect, it } from "vitest";
import "dotenv/config";
import { eq } from "drizzle-orm";
import * as db from "../server/db";
import { users } from "../drizzle/schema";

const hasDb = Boolean(process.env.TEST_DATABASE_URL);
const d = describe.runIf(hasDb);

d("E2E: email verification syncing", () => {
  const authUserId = crypto.randomUUID();
  const createdUserIds: number[] = [];

  afterAll(async () => {
    const dbi = await db.getDb();
    if (!dbi) return;
    for (const id of createdUserIds) {
      await dbi.delete(users).where(eq(users.id, id));
    }
  });

  it("1. a brand-new user is created with emailVerified false when Supabase reports no confirmation yet", async () => {
    const user = await db.getOrCreateUserByAuthId(authUserId, {
      name: "Email Verify Test",
      email: `e2eemailverify-${Date.now()}@test.dranik`,
      emailVerified: false,
    });
    createdUserIds.push(user.id);
    expect(user.emailVerified).toBe(false);
  });

  it("2. a later sign-in with a now-confirmed email flips the stored flag to true", async () => {
    const user = await db.getOrCreateUserByAuthId(authUserId, {
      name: "Email Verify Test",
      email: `e2eemailverify-${Date.now()}@test.dranik`,
      emailVerified: true,
    });
    expect(user.emailVerified).toBe(true);

    const dbi = await db.getDb();
    const row = (await dbi!.select().from(users).where(eq(users.id, user.id)))[0];
    expect(row.emailVerified).toBe(true);
  });

  it("3. omitting emailVerified on a later call preserves the already-confirmed state", async () => {
    const user = await db.getOrCreateUserByAuthId(authUserId, {
      name: "Email Verify Test",
      email: `e2eemailverify-${Date.now()}@test.dranik`,
    });
    expect(user.emailVerified).toBe(true);
  });
});
