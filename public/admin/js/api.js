// Minimal tRPC-over-HTTP client — no @trpc/client, since this is a two-page
// static tool and a raw fetch against the wire format is enough. Same
// endpoint the mobile app talks to (/api/trpc), same superjson envelope.
import { getAccessToken, signOut } from "./auth.js";

const BASE = "/api/trpc";

function encodeInput(input) {
  return encodeURIComponent(JSON.stringify({ json: input === undefined ? null : input }));
}

async function handleResponse(res) {
  const body = await res.json().catch(() => null);
  if (!res.ok || !body || body.error) {
    const message = body?.error?.json?.message || `Request failed (${res.status})`;
    const code = body?.error?.json?.data?.code;
    if (code === "UNAUTHORIZED") {
      signOut();
    }
    const err = new Error(message);
    err.code = code;
    throw err;
  }
  return body.result.data.json;
}

export async function apiQuery(procedure, input) {
  const token = await getAccessToken();
  if (!token) {
    signOut();
    throw new Error("Not signed in");
  }
  const url = input === undefined ? `${BASE}/${procedure}` : `${BASE}/${procedure}?input=${encodeInput(input)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, "ngrok-skip-browser-warning": "true" } });
  return handleResponse(res);
}

export async function apiMutate(procedure, input) {
  const token = await getAccessToken();
  if (!token) {
    signOut();
    throw new Error("Not signed in");
  }
  const res = await fetch(`${BASE}/${procedure}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "ngrok-skip-browser-warning": "true" },
    body: JSON.stringify({ json: input === undefined ? null : input }),
  });
  return handleResponse(res);
}
