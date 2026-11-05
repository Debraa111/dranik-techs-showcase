// Talks to Supabase Auth's REST API directly (no SDK) — the mobile app uses
// @supabase/supabase-js for the same thing, but pulling that in here would
// mean a build step for a two-page internal tool. The password-grant and
// refresh-token endpoints are simple enough to call with plain fetch.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const ACCESS_KEY = "drk_admin_access_token";
const REFRESH_KEY = "drk_admin_refresh_token";
const EXPIRES_KEY = "drk_admin_expires_at";

function storeSession(data) {
  localStorage.setItem(ACCESS_KEY, data.access_token);
  localStorage.setItem(REFRESH_KEY, data.refresh_token);
  localStorage.setItem(EXPIRES_KEY, String(Date.now() + data.expires_in * 1000));
}

export function clearSession() {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(EXPIRES_KEY);
}

export async function signIn(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error_description || data.msg || "Invalid email or password");
  }
  storeSession(data);
  return data;
}

async function refreshSession(refreshToken) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error("Session expired");
  storeSession(data);
  return data;
}

/** Returns a valid access token, refreshing first if it's near expiry. Null if not logged in. */
export async function getAccessToken() {
  const accessToken = localStorage.getItem(ACCESS_KEY);
  const refreshToken = localStorage.getItem(REFRESH_KEY);
  const expiresAt = Number(localStorage.getItem(EXPIRES_KEY) || 0);
  if (!accessToken || !refreshToken) return null;

  if (Date.now() > expiresAt - 30_000) {
    try {
      const data = await refreshSession(refreshToken);
      return data.access_token;
    } catch {
      clearSession();
      return null;
    }
  }
  return accessToken;
}

/** Decodes the email claim out of the stored access token (no network round-trip). */
export function getStoredEmail() {
  const token = localStorage.getItem(ACCESS_KEY);
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.email ?? null;
  } catch {
    return null;
  }
}

export function signOut() {
  clearSession();
  window.location.href = "/admin/login.html";
}

/** Call at the top of every protected page. Redirects to login if not authenticated. */
export async function requireAuth() {
  const token = await getAccessToken();
  if (!token) {
    window.location.href = "/admin/login.html";
    return null;
  }
  return token;
}
