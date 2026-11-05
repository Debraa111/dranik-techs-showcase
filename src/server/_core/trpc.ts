import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from "../../shared/const.js";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;
export const middleware = t.middleware;

const requireUser = t.middleware(async (opts) => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure.use(requireUser);

export const adminProcedure = t.procedure.use(
  t.middleware(async (opts) => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);

/**
 * Role-gated admin procedure — layers a specific-resource check on top of
 * `adminProcedure`'s "is this account an admin at all" gate. `resource` matches a
 * key in `RESOURCE_ROLES` (db.ts): "users" | "providers" | "bookings" | "disputes" |
 * "finance" | "categories". Omit `resource` for a super_admin-only endpoint (audit
 * logs, admin/role management) — there's no resource key for those on purpose, so
 * only the always-allowed super_admin check passes them.
 *
 * Dynamic import of db.ts (not a top-level import) is deliberate: this file
 * (_core/trpc.ts) is the foundation every router builds on, and db.ts is a large
 * module — importing it at module-load time here would mean it's always loaded
 * before the tRPC primitives exist, which risks a load-order circular import as
 * more admin logic moves into db.ts. Resolving it lazily, inside the middleware
 * closure, sidesteps that entirely.
 */
export function adminPermissionProcedure(resource?: string) {
  return adminProcedure.use(
    t.middleware(async (opts) => {
      const { ctx, next } = opts;
      // Redundant at runtime (adminProcedure's own middleware already checked this),
      // but chaining a second .use() doesn't carry adminProcedure's non-null narrowing
      // of ctx.user through to this middleware's own view of ctx — TS sees the base
      // context type here, not the refined one. Re-asserting it is what fixes that,
      // for this middleware and for whatever resolver runs after it.
      if (!ctx.user) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
      }
      const { hasAdminPermission, getAdminRoles } = await import("../db");
      const allowed = resource
        ? await hasAdminPermission(ctx.user.id, resource)
        : (await getAdminRoles(ctx.user.id)).includes("super_admin");
      if (!allowed) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Your admin role doesn't include access to this." });
      }
      // Explicitly restating `user` (not just spreading ctx) is what lets TS carry
      // the non-null narrowing through to the next link in the chain — same pattern
      // adminProcedure's own middleware uses just above.
      return next({ ctx: { ...ctx, user: ctx.user } });
    }),
  );
}

/**
 * Provider-only procedure. The user must be authenticated AND have the
 * `provider` app role (set when they complete provider onboarding), or be an admin.
 */
export const providerProcedure = t.procedure.use(
  t.middleware(async (opts) => {
    const { ctx, next } = opts;

    if (!ctx.user) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
    }
    const isProvider = ctx.user.appRole === "provider" || ctx.user.appRole === "admin" || ctx.user.role === "admin";
    if (!isProvider) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Provider account required" });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);
