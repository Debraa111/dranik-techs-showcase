import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "@/server/routers";
import { getApiBaseUrl } from "@/constants/api";
import { supabase } from "@/lib/supabase";

/**
 * tRPC React client for type-safe API calls.
 *
 * IMPORTANT (tRPC v11): the `transformer` must be inside `httpBatchLink`,
 * not at the root `createClient` level, so client and server agree on
 * serialization (superjson).
 */
export const trpc = createTRPCReact<AppRouter>();

/** Creates the tRPC client. Call this once in the app's root layout. */
export function createTRPCClient() {
  return trpc.createClient({
    links: [
      httpBatchLink({
        url: `${getApiBaseUrl()}/api/trpc`,
        transformer: superjson,
        async headers() {
          const { data } = await supabase.auth.getSession();
          const token = data.session?.access_token;
          return {
            // Dev tunnels (ngrok free tier) show an HTML "you're about to visit an
            // ngrok tunnel" interstitial to requests it heuristically flags as coming
            // from a browser — the client then fails to JSON.parse that HTML as a
            // tRPC response ("Unexpected character: <"). This header is ngrok's
            // documented bypass; harmless against any other host (unrecognized header,
            // ignored).
            "ngrok-skip-browser-warning": "true",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          };
        },
      }),
    ],
  });
}
