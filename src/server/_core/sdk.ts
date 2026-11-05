import type { Request } from "express";
import { createClient } from "@supabase/supabase-js";
import { getOrCreateUserByAuthId } from "../db";
import { ENV } from "./env";
import type { User } from "../../drizzle/schema";

/**
 * Verifies Supabase-issued session tokens. Sign-up/sign-in/session-refresh
 * all happen client-side via @supabase/supabase-js talking directly to
 * Supabase's hosted Auth API (src/lib/supabase.ts) — this server only ever
 * verifies the resulting access token on incoming requests.
 *
 * Uses supabase.auth.getUser(token) rather than manually verifying the JWT
 * signature: newer Supabase projects (using the sb_publishable_/sb_secret_
 * key format) can sign session tokens asymmetrically, so there's no single
 * shared HS256 secret to check against locally. Calling getUser() asks
 * Supabase to do the verification, which works regardless of signing scheme
 * at the cost of a network round-trip per request.
 */
const supabaseAdmin = createClient(ENV.supabaseUrl, ENV.supabaseAnonKey);

function extractToken(req: Request): string | null {
  const authHeader = req.headers.authorization ?? req.headers.Authorization;
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length).trim();
  }
  return null;
}

async function authenticateRequest(req: Request): Promise<User> {
  if (!ENV.supabaseUrl || !ENV.supabaseAnonKey) {
    throw new Error("EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY are not set — cannot verify sessions.");
  }

  const token = extractToken(req);
  if (!token) {
    throw new Error("No session token present");
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) {
    throw new Error("Invalid or expired session token");
  }

  const user = await getOrCreateUserByAuthId(data.user.id, {
    email: data.user.email ?? null,
    name: (data.user.user_metadata?.name ?? data.user.user_metadata?.full_name ?? null) as string | null,
    // A session only exists here at all if Supabase already required email
    // confirmation before issuing it — so this is realistically always true by
    // the time a request reaches this point. Synced anyway rather than assumed,
    // so it stays correct if that project setting is ever loosened.
    emailVerified: !!data.user.email_confirmed_at,
  });

  // Enforced here, not just hidden in the UI — a suspended/deactivated/deleted
  // account's Supabase session is still technically valid, so every request must
  // be checked, not just login. Without this, admin "suspend user" (or a
  // permanent delete that couldn't also remove the Supabase Auth identity, e.g.
  // no service_role key configured) would be a label with no actual effect.
  if (user.status !== "active") {
    throw new Error(
      user.status === "suspended"
        ? "Your account has been suspended. Contact support if you believe this is a mistake."
        : user.status === "deleted"
          ? "This account has been deleted."
          : "Your account has been deactivated.",
    );
  }

  return user;
}

/**
 * Full Auth Admin API access (service_role key) — only for actions that need it,
 * like deleting a Supabase Auth identity outright. Deliberately a separate client
 * from the anon-key one above, which is scoped to verifying tokens only. Lazily
 * created so importing this module never requires the key to be set.
 */
let _supabaseServiceRole: ReturnType<typeof createClient> | null = null;
function supabaseServiceRole() {
  if (!ENV.supabaseServiceRoleKey) return null;
  if (!_supabaseServiceRole) {
    _supabaseServiceRole = createClient(ENV.supabaseUrl, ENV.supabaseServiceRoleKey);
  }
  return _supabaseServiceRole;
}

/**
 * Permanently removes a user's Supabase Auth identity — used by
 * admin.users.permanentDelete. A false result (missing key, or a Supabase-side
 * failure) is reported back to the caller rather than swallowed, but deliberately
 * doesn't block the rest of the delete flow: the account is already fully inert
 * via `users.status = "deleted"` (enforced above) regardless of whether the
 * Supabase-side identity is also gone.
 */
async function deleteSupabaseAuthUser(authUserId: string): Promise<{ deleted: boolean; error?: string }> {
  const client = supabaseServiceRole();
  if (!client) {
    return { deleted: false, error: "SUPABASE_SERVICE_ROLE_KEY is not configured." };
  }
  const { error } = await client.auth.admin.deleteUser(authUserId);
  if (error) return { deleted: false, error: error.message };
  return { deleted: true };
}

export const sdk = {
  authenticateRequest,
  deleteSupabaseAuthUser,
};
