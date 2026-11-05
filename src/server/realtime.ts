import { createClient } from "@supabase/supabase-js";
import { ENV } from "./_core/env";

/**
 * Same public URL/anon key the client uses (src/lib/supabase.ts) — broadcast is a
 * pub/sub relay with no RLS involved, so no service-role key is needed to send one.
 */
const supabase = createClient(ENV.supabaseUrl, ENV.supabaseAnonKey);

/**
 * Fire-and-forget signal that a booking changed — same Broadcast pattern chat and
 * the provider app use (src/app/chat/[id].tsx, src/app/provider-app/booking/[id].tsx),
 * just triggered here from a background scheduled job instead of a client's own
 * mutation.
 *
 * ONLY call this from background jobs (see server/_core/index.ts's interval
 * checks), never from a request-handling mutation. That was tried earlier for every
 * booking status change and reverted: a real network round-trip (~1-2s observed)
 * has no business blocking a user-facing request's response, and in one isolated
 * test it even crashed the process on exit with a libuv handle-not-closed
 * assertion. Neither concern applies to a background job — nothing is waiting on a
 * fast response, and this server process never calls process.exit(). The client-
 * driven pattern (the actor's own screen pings after its own mutation) still covers
 * every user-initiated change; this exists only for changes nobody's screen causes.
 */
export async function broadcastBookingUpdate(bookingId: number): Promise<void> {
  const channel = supabase.channel(`booking-${bookingId}`);
  try {
    await channel.httpSend("update", {}, { timeout: 5000 });
  } catch (err) {
    console.error(`[realtime] failed to broadcast booking-${bookingId} update:`, err);
  } finally {
    supabase.removeChannel(channel);
  }
}
