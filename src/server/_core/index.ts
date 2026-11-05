// Must run before any other import — several modules (sdk.ts, db.ts) read
// process.env at module-load time, so .env needs to be loaded first.
import "../../../scripts/load-env.js";

import path from "path";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { ENV } from "./env";
import { UPLOADS_DIR } from "../storage";
import { sendDueBookingReminders, autoAdvanceArrivalCheckpoints } from "../db";

const app = express();

// Trust exactly one hop (the ngrok tunnel in dev / reverse proxy in prod) so
// req.ip resolves from X-Forwarded-For correctly. Trusting *all* hops
// (`true`) would let a client spoof that header directly and defeat the
// per-IP rate limiter below.
app.set("trust proxy", 1);

const LOCALHOST_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

class CorsOriginError extends Error {}

app.use(
  // Using the per-request function form (not the plain options-object form)
  // so the origin check can see `req` — needed to recognize the admin
  // dashboard's own origin (see below).
  cors((req, callback) => {
    const origin = req.header("Origin");
    // No Origin header = non-browser client (native app, curl, server-to-server).
    // CORS is a browser-only mechanism, so these are never a spoofing risk here.
    if (!origin) return callback(null, { origin: true });
    if (LOCALHOST_ORIGIN.test(origin)) return callback(null, { origin: true });
    if (ENV.allowedOrigins.includes(origin)) return callback(null, { origin: true });
    // The admin dashboard (public/admin/*) is static files served by this
    // same Express server, reachable at whatever domain fronts it (localhost,
    // an ngrok tunnel in dev, a real domain later) — its own API calls to
    // /api/trpc always carry an Origin equal to that same host, so trust any
    // origin that matches the host this very request came in on. This isn't
    // hardcoding a domain, so it keeps working across tunnel restarts/redeploys.
    const requestOrigin = `${req.protocol}://${req.get("host")}`;
    if (origin === requestOrigin) return callback(null, { origin: true });
    callback(new CorsOriginError(`Origin ${origin} not allowed by CORS`));
  }),
);

// Without this, a rejected CORS origin falls through to Express's default
// error handler, which replies with a full server stack trace (file paths
// included) — a real information leak to anyone who tries a disallowed origin.
app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof CorsOriginError) {
    return res.status(403).json({ error: "Not allowed by CORS" });
  }
  next(err);
});

app.use(express.json({ limit: "10mb" }));
app.use("/uploads", express.static(UPLOADS_DIR));

// Internal admin dashboard — static HTML/CSS/JS, protected client-side (redirects
// to /admin/login.html without a session) and server-side by adminProcedure on
// every tRPC call it makes. See docs/ADMIN_ROADMAP.md.
app.use("/admin", express.static(path.join(process.cwd(), "public", "admin")));

// Global baseline: a circuit breaker against runaway scripts/scrapers hitting
// any endpoint (including unauthenticated public reads), on top of the
// tighter per-user limits on specific sensitive mutations (see rate-limit.ts
// and its use in routers.ts). Sized generously — the client already batches
// multiple queries per HTTP call, and its own polling runs every 20-30s.
app.use(
  "/api/trpc",
  rateLimit({
    windowMs: 5 * 60 * 1000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);

app.use(
  "/api/trpc",
  createExpressMiddleware({
    router: appRouter,
    createContext,
  }),
);

app.listen(ENV.port, () => {
  console.log(`[server] listening on http://localhost:${ENV.port}`);
});

// In-process scheduler for the "N before scheduled time" reminder notifications
// (1d/5h/1h/30m/10m — see sendDueBookingReminders in db.ts for the dedup logic that
// makes a ~5-minute poll interval safe). Chosen over pg_cron because this server is
// currently a single persistent process, not a scale-to-zero deployment — if that
// ever changes, sendDueBookingReminders is written to be called the same way from an
// HTTP-triggered endpoint instead, no logic changes needed.
const REMINDER_CHECK_INTERVAL_MS = 5 * 60 * 1000;
let reminderCheckRunning = false;
async function runReminderCheck() {
  if (reminderCheckRunning) return; // a slow run shouldn't overlap with the next tick
  reminderCheckRunning = true;
  try {
    const result = await sendDueBookingReminders();
    if (result.sent > 0) {
      console.log(`[reminders] sent ${result.sent} reminder(s) (${result.checked} confirmed booking(s) checked)`);
    }
  } catch (err) {
    console.error("[reminders] check failed:", err);
  } finally {
    reminderCheckRunning = false;
  }
}
setInterval(runReminderCheck, REMINDER_CHECK_INTERVAL_MS);
runReminderCheck();

// Auto-posts the "arrived" checkpoint 5 minutes after a booking starts, if the
// provider hasn't already posted it — see autoAdvanceArrivalCheckpoints in db.ts.
// Checked more often than reminders (1 min vs 5 min) since 5-minute precision
// matters more here than reminders' looser tolerance.
const ARRIVAL_CHECK_INTERVAL_MS = 60 * 1000;
let arrivalCheckRunning = false;
async function runArrivalCheck() {
  if (arrivalCheckRunning) return;
  arrivalCheckRunning = true;
  try {
    const result = await autoAdvanceArrivalCheckpoints();
    if (result.advanced > 0) {
      console.log(`[arrival] auto-advanced ${result.advanced} booking(s) (${result.checked} in-progress booking(s) checked)`);
    }
  } catch (err) {
    console.error("[arrival] check failed:", err);
  } finally {
    arrivalCheckRunning = false;
  }
}
setInterval(runArrivalCheck, ARRIVAL_CHECK_INTERVAL_MS);
runArrivalCheck();

export { app };
