import { describe, expect, it } from "vitest";
import { appRouter } from "../server/routers";
import type { TrpcContext } from "../server/_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(): { ctx: TrpcContext } {
  const user: AuthenticatedUser = {
    id: 1,
    authUserId: "00000000-0000-0000-0000-000000000001",
    email: "sample@example.com",
    name: "Sample User",
    phone: null,
    avatarUrl: null,
    role: "user",
    appRole: "customer",
    status: "active",
    emailVerified: false,
    phoneVerified: false,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  const ctx: TrpcContext = {
    user,
    req: {} as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };

  return { ctx };
}

describe("auth.logout", () => {
  it("reports success (session teardown itself happens client-side via supabase.auth.signOut())", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.auth.logout();

    expect(result).toEqual({ success: true });
  });
});
