import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/tests/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
    // e2e tests do several sequential round-trips against a remote DB
    // (Supabase pooler) — the 5s default is too tight for that over a network.
    testTimeout: 20000,
    // Each e2e file opens its own pg Pool (default max 10 connections) against the
    // same Supabase transaction pooler. Running files in parallel workers (vitest's
    // default) stacks those pools concurrently and can exceed the pooler's own
    // connection cap, hanging beforeAll until it hits hookTimeout. Sequential file
    // execution keeps at most one file's pool open at a time.
    fileParallelism: false,
  },
});
