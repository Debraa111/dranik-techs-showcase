import { TRPCError } from "@trpc/server";
import { middleware } from "./trpc";

/**
 * Per-user rate limiting for specific tRPC mutations. Express-level rate
 * limiting can't isolate individual procedures because the client batches
 * multiple calls into one HTTP request (httpBatchLink) — this runs inside
 * the tRPC middleware chain instead, per procedure invocation. Must be
 * chained after `protectedProcedure` (or similar) so `ctx.user` exists.
 *
 * In-memory only: fine for this single-process deployment, but limits reset
 * on restart and won't work if the server is ever scaled to multiple
 * processes (would need a shared store like Redis at that point).
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export function userRateLimit({ windowMs, max, label }: { windowMs: number; max: number; label: string }) {
  return middleware(async ({ ctx, next }) => {
    if (!ctx.user) {
      // Shouldn't happen when chained after protectedProcedure — fail open to
      // the auth check downstream rather than throwing a confusing error here.
      return next();
    }

    const key = `${label}:${ctx.user.id}`;
    const now = Date.now();

    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;

    if (bucket.count > max) {
      const retryAfterSeconds = Math.ceil((bucket.resetAt - now) / 1000);
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: `Too many requests. Try again in ${retryAfterSeconds}s.`,
      });
    }

    return next();
  });
}
