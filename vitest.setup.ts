/**
 * Runs once before any test file is loaded (see vitest.config.ts setupFiles).
 *
 * server/db.ts — and every e2e test, which calls into it — connects using
 * whatever DATABASE_URL happens to be set. Historically that was always the
 * real Supabase database (there's no separate test database), so every e2e
 * run wrote real rows to it; if a run crashed or timed out before its afterAll
 * cleanup, those rows were left behind permanently (this is how the "E2E Cat
 * 1785609921573"-style junk categories ended up visible in the live app).
 *
 * To stop that: redirect DATABASE_URL to TEST_DATABASE_URL when one is
 * configured, or blank it out entirely otherwise. server/db.ts treats a blank
 * DATABASE_URL as "no database" and falls back to its in-memory store, and
 * each e2e suite's own hasDb check (on TEST_DATABASE_URL) skips it rather
 * than running against nothing. Either way, prod is never touched by tests.
 */
import "./scripts/load-env.js";

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
} else {
  process.env.DATABASE_URL = "";
}
