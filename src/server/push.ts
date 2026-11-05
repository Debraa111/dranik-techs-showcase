const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";
/** Expo's own cap on messages per request. */
const CHUNK_SIZE = 100;

export interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/**
 * Sends to Expo's push API directly via fetch — no expo-server-sdk dependency needed
 * for this app's scale (one HTTP call per 100-message chunk, Expo's own batch cap).
 * Deliberately has no knowledge of the database: callers own persisting/pruning device
 * tokens, this just reports which ones Expo says are dead so the caller can decide.
 * Never throws — a push failure must never be allowed to break whatever mutation
 * triggered it (see the fire-and-forget call site in db.ts's createNotification).
 */
export async function sendExpoPushNotifications(messages: ExpoPushMessage[]): Promise<{ deadTokens: string[] }> {
  const deadTokens: string[] = [];
  for (let i = 0; i < messages.length; i += CHUNK_SIZE) {
    const chunk = messages.slice(i, i + CHUNK_SIZE);
    try {
      const res = await fetch(EXPO_PUSH_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(chunk.map((m) => ({ ...m, sound: "default" }))),
      });
      const json: any = await res.json().catch(() => null);
      const tickets = Array.isArray(json?.data) ? json.data : [];
      tickets.forEach((ticket: any, idx: number) => {
        if (ticket?.status === "error" && ticket?.details?.error === "DeviceNotRegistered") {
          deadTokens.push(chunk[idx].to);
        }
      });
    } catch (err) {
      console.error("[push] failed to send a batch to Expo's push API:", err);
    }
  }
  return { deadTokens };
}
