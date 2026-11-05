/**
 * Central place to read process.env. Server-only — never import this from
 * client code (it may read secrets).
 */
export const ENV = {
  databaseUrl: process.env.DATABASE_URL ?? "",

  // Supabase Auth: same public URL/key the client uses (see src/lib/supabase.ts).
  // The anon key is not secret — it's meant to be shipped client-side too.
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "",
  /** Secret — full Auth Admin API access (can delete any user's Supabase identity).
   *  Only used for admin.users.permanentDelete; optional, so the app still boots and
   *  every other feature works without it — that one action just clearly reports it
   *  couldn't remove the Supabase Auth identity if this isn't configured. */
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",

  /** Email that gets bootstrapped as an admin on first sign-in. */
  ownerEmail: process.env.OWNER_EMAIL ?? "",
  ownerName: process.env.OWNER_NAME ?? "",

  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",

  paystackSecretKey: process.env.PAYSTACK_SECRET_KEY ?? "",
  paymentGateway: process.env.PAYMENT_GATEWAY ?? "mock",

  /** Keys the HMAC used to hash escrow release codes — never store the pepper client-side. */
  releaseCodePepper: process.env.RELEASE_CODE_PEPPER ?? "",

  port: Number(process.env.PORT ?? 3000),

  /**
   * Extra CORS origins to allow beyond localhost/127.0.0.1 and requests with
   * no Origin header (native apps, curl). Comma-separated, e.g. a tunnel URL
   * you're testing the web build against: ALLOWED_ORIGINS=https://foo.ngrok-free.dev
   */
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
} as const;
