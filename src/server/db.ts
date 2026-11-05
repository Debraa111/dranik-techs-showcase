import crypto from "crypto";
import { and, desc, eq, gte, inArray, like, lte, ne, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import {
  ADMIN_ROLES,
  addresses,
  adminRoleAssignments,
  auditLogs,
  BOOKING_STATUSES,
  bookingCancellationRequests,
  bookingProgressUpdates,
  bookingReminders,
  bookings,
  bookingStatusHistory,
  categories,
  conversations,
  coupons,
  devicePushTokens,
  InsertAddress,
  InsertBooking,
  InsertNotification,
  InsertPortfolioItem,
  InsertProviderBankAccount,
  InsertProviderBlockedDate,
  InsertProviderDocument,
  InsertProviderProfile,
  InsertReview,
  InsertService,
  InsertUser,
  messages,
  negotiationOffers,
  negotiations,
  NotificationPreference,
  notificationPreferences,
  notifications,
  payments,
  platformSettings,
  PlatformSettings,
  portfolioItems,
  providerBankAccounts,
  providerBlockedDates,
  providerDocuments,
  providerProfiles,
  providerWorkingHours,
  REMINDER_INTERVALS,
  reviews,
  services,
  supportTickets,
  transactions,
  User,
  users,
  wallets,
} from "../drizzle/schema";
import { ENV } from "./_core/env";
import { broadcastBookingUpdate } from "./realtime";
import { sendExpoPushNotifications } from "./push";

/**
 * Provider fields safe to hand to the other party (customers, or a provider's
 * counterpart in a conversation) — excludes phone plus legal/verification
 * identity documents (DOB, addresses, CAC number, rejection reason). All
 * in-app communication goes through the `messages` router instead; see the
 * "no direct phone number" rule enforced there and in the booking flow.
 * A provider's own profile view (e.g. `getProviderProfileByUserId`) is
 * unaffected — this projection is only for queries that cross the
 * customer/provider boundary.
 */
const publicProviderColumns = {
  id: providerProfiles.id,
  userId: providerProfiles.userId,
  businessName: providerProfiles.businessName,
  bio: providerProfiles.bio,
  yearsOfExperience: providerProfiles.yearsOfExperience,
  verificationStatus: providerProfiles.verificationStatus,
  verifiedAt: providerProfiles.verifiedAt,
  availabilityStatus: providerProfiles.availabilityStatus,
  averageRating: providerProfiles.averageRating,
  reviewCount: providerProfiles.reviewCount,
  completedJobs: providerProfiles.completedJobs,
  commissionRate: providerProfiles.commissionRate,
  city: providerProfiles.city,
  state: providerProfiles.state,
  latitude: providerProfiles.latitude,
  longitude: providerProfiles.longitude,
  serviceRadiusKm: providerProfiles.serviceRadiusKm,
  serviceAreas: providerProfiles.serviceAreas,
  skills: providerProfiles.skills,
  languages: providerProfiles.languages,
  certifications: providerProfiles.certifications,
  createdAt: providerProfiles.createdAt,
  updatedAt: providerProfiles.updatedAt,
};

/** Customer fields safe to hand to a provider (or a public review listing) — excludes phone. */
const publicCustomerColumns = {
  id: users.id,
  name: users.name,
  avatarUrl: users.avatarUrl,
};

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      const isLocal = /(localhost|127\.0\.0\.1)/.test(process.env.DATABASE_URL);
      const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        // Supabase (and most hosted Postgres) requires SSL; their cert chain
        // commonly fails strict validation from generic clients, so this is
        // the standard workaround. Skipped for local Postgres.
        ssl: isLocal ? undefined : { rejectUnauthorized: false },
        // TCP keepalive so a NAT/firewall/ISP that silently drops a quiet
        // connection gets caught and refreshed proactively, instead of only
        // being discovered the next time a query tries to use it.
        keepAlive: true,
        keepAliveInitialDelayMillis: 10_000,
        // Don't hang forever trying to reach Supabase during a network blip —
        // fail that one connection attempt reasonably fast so the pool can try
        // again, rather than a request stalling indefinitely.
        connectionTimeoutMillis: 10_000,
        // Recycle idle clients well before Supabase's own pooler (Supavisor)
        // would silently close them server-side — an idle client the server
        // has already dropped is exactly what triggers the pool 'error' below.
        idleTimeoutMillis: 30_000,
        max: 10,
      });
      // Required: a Pool emits 'error' when an already-idle client dies in the
      // background (network drop, or the DB/pooler closing an idle connection
      // server-side — both routine, not exceptional). With no listener, Node
      // treats that as an uncaught exception and kills the whole process —
      // this was very likely the real cause behind recurring "ngrok 502 /
      // ECONNRESET reaching Supabase" reports, not a local network issue.
      // Handling it here is sufficient: the pool discards the dead client and
      // transparently opens a fresh one for the next query — no reconnect loop
      // needed, that's what Pool already does internally.
      pool.on("error", (err) => {
        console.error("[Database] Idle pool client error (pool recovers automatically):", err.message);
      });
      _db = drizzle(pool);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db;
}

/**
 * In-memory fallback for the users table when no DATABASE_URL is configured.
 * This lets auth (and anything gated behind it) work end-to-end for local
 * testing without provisioning a real database. Resets on server restart —
 * every other table still requires a real DB via requireDb().
 */
const memoryUsers = new Map<string, User>();
let memoryUserIdSeq = 1;

function upsertMemoryUser(
  authUserId: string,
  info: { email?: string | null; name?: string | null; emailVerified?: boolean },
  overrides?: Partial<Pick<InsertUser, "role" | "appRole">>,
): User {
  const existing = memoryUsers.get(authUserId);
  const isOwner = !!info.email && info.email.toLowerCase() === ENV.ownerEmail.toLowerCase();
  const now = new Date();

  const merged: User = {
    id: existing?.id ?? memoryUserIdSeq++,
    authUserId,
    name: info.name ?? existing?.name ?? null,
    email: info.email ?? existing?.email ?? null,
    phone: existing?.phone ?? null,
    avatarUrl: existing?.avatarUrl ?? null,
    role: existing?.role ?? overrides?.role ?? (isOwner ? "admin" : "user"),
    appRole: existing?.appRole ?? overrides?.appRole ?? (isOwner ? "admin" : "customer"),
    status: existing?.status ?? "active",
    emailVerified: info.emailVerified ?? existing?.emailVerified ?? false,
    phoneVerified: existing?.phoneVerified ?? false,
    deletedAt: existing?.deletedAt ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    lastSignedIn: now,
  };

  memoryUsers.set(authUserId, merged);
  return merged;
}

/* ------------------------------ Users & Auth ------------------------------ */

/**
 * Looks up the app-side user row for a Supabase auth user (auth.users.id),
 * creating one on first sight. Called on every authenticated request — see
 * server/_core/sdk.ts, which verifies the Supabase-issued JWT and passes its
 * `sub` claim here.
 */
export async function getOrCreateUserByAuthId(
  authUserId: string,
  info: { email?: string | null; name?: string | null; emailVerified?: boolean },
  overrides?: Partial<Pick<InsertUser, "role" | "appRole">>,
): Promise<User> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] DATABASE_URL not set — using in-memory user store (resets on restart).");
    return upsertMemoryUser(authUserId, info, overrides);
  }

  const existing = await db.select().from(users).where(eq(users.authUserId, authUserId)).limit(1);
  if (existing[0]) {
    const now = new Date();
    // Synced from Supabase's own email_confirmed_at on every authenticated request
    // (see server/_core/sdk.ts) — cheap to re-set each time, and self-heals any row
    // created before this syncing existed.
    const emailVerified = info.emailVerified ?? existing[0].emailVerified;
    await db.update(users).set({ lastSignedIn: now, updatedAt: now, emailVerified }).where(eq(users.id, existing[0].id));

    // Backfill for accounts created before admin_role_assignments existed: the owner
    // account from an earlier session already has role: "admin" but was never given
    // a super_admin row (that only happened on first-ever creation, below). Without
    // this, the owner would be locked out of every adminPermissionProcedure check the
    // moment RBAC shipped. Cheap in practice — only ever true for the one owner email.
    const isOwnerAccount = !!existing[0].email && existing[0].email.toLowerCase() === ENV.ownerEmail.toLowerCase();
    if (isOwnerAccount) {
      await db.insert(adminRoleAssignments).values({ userId: existing[0].id, role: "super_admin" }).onConflictDoNothing();
    }

    return { ...existing[0], lastSignedIn: now, emailVerified };
  }

  const isOwner = !!info.email && info.email.toLowerCase() === ENV.ownerEmail.toLowerCase();
  const [inserted] = await db
    .insert(users)
    .values({
      authUserId,
      email: info.email ?? null,
      name: info.name ?? null,
      emailVerified: info.emailVerified ?? false,
      role: overrides?.role ?? (isOwner ? "admin" : "user"),
      appRole: overrides?.appRole ?? (isOwner ? "admin" : "customer"),
    })
    .returning();

  // OWNER_EMAIL's first-ever sign-in becomes Super Admin — the one bootstrap that
  // isn't granted through the Admin Users screen (nobody exists yet to grant it).
  if (isOwner) {
    await db.insert(adminRoleAssignments).values({ userId: inserted.id, role: "super_admin" }).onConflictDoNothing();
  }

  return inserted;
}

export async function getUserById(id: number) {
  const db = await requireDb();
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0];
}

export async function updateUserProfile(
  userId: number,
  data: Partial<Pick<InsertUser, "name" | "phone" | "avatarUrl" | "appRole">>,
) {
  const db = await requireDb();
  await db.update(users).set(data).where(eq(users.id, userId));
}

/* ------------------------------- Categories ------------------------------- */

export async function listCategories(includeInactive = false) {
  const db = await requireDb();
  const where = includeInactive ? undefined : eq(categories.isActive, true);
  return db.select().from(categories).where(where).orderBy(categories.sortOrder);
}

export async function countCategories() {
  const db = await requireDb();
  const rows = await db.select({ count: sql<number>`count(*)` }).from(categories);
  return Number(rows[0]?.count ?? 0);
}

/* -------------------------------- Providers ------------------------------- */

export async function getProviderProfileByUserId(userId: number) {
  const db = await requireDb();
  const rows = await db.select().from(providerProfiles).where(eq(providerProfiles.userId, userId)).limit(1);
  return rows[0];
}

export async function getProviderProfileById(id: number) {
  const db = await requireDb();
  const rows = await db.select().from(providerProfiles).where(eq(providerProfiles.id, id)).limit(1);
  return rows[0];
}

export async function createProviderProfile(data: InsertProviderProfile) {
  const db = await requireDb();
  const [inserted] = await db.insert(providerProfiles).values(data).returning({ id: providerProfiles.id });
  const insertId = inserted?.id ?? 0;
  await db.update(users).set({ appRole: "provider" }).where(eq(users.id, data.userId));
  return insertId;
}

export async function updateProviderProfile(id: number, data: Partial<InsertProviderProfile>) {
  const db = await requireDb();
  await db.update(providerProfiles).set(data).where(eq(providerProfiles.id, id));
}

/** Recompute denormalized rating aggregates from visible reviews. */
export async function recomputeProviderRating(providerId: number) {
  const db = await requireDb();
  const rows = await db
    .select({
      avg: sql<string>`COALESCE(AVG(${reviews.rating}), 0)`,
      count: sql<number>`COUNT(*)`,
    })
    .from(reviews)
    .where(and(eq(reviews.providerId, providerId), eq(reviews.isVisible, true)));
  const avg = Number(rows[0]?.avg ?? 0).toFixed(2);
  const count = Number(rows[0]?.count ?? 0);
  await db
    .update(providerProfiles)
    .set({ averageRating: avg, reviewCount: count })
    .where(eq(providerProfiles.id, providerId));
  return { averageRating: avg, reviewCount: count };
}

/* -------------------------------- Services -------------------------------- */

export type ServiceListFilters = {
  categoryId?: number;
  providerId?: number;
  search?: string;
  verifiedOnly?: boolean;
  limit?: number;
  offset?: number;
};

/** List active services joined with provider + category info for marketplace cards. */
export async function listServices(filters: ServiceListFilters = {}) {
  const db = await requireDb();
  const conditions = [eq(services.isActive, true)];
  if (filters.categoryId) conditions.push(eq(services.categoryId, filters.categoryId));
  if (filters.providerId) conditions.push(eq(services.providerId, filters.providerId));
  if (filters.verifiedOnly) conditions.push(eq(providerProfiles.verificationStatus, "verified"));
  if (filters.search) {
    const term = `%${filters.search}%`;
    conditions.push(
      or(
        like(services.title, term),
        like(services.description, term),
        like(providerProfiles.businessName, term),
        // Matches a provider-listed area (e.g. "GRA", "Okpanam") against the same
        // free-text search box — no separate area picker UI, reuses what's already
        // there. Cast-to-text + ILIKE on the jsonb array rather than exact
        // containment: simple substring matching is enough for "does this provider
        // serve somewhere named like what the customer typed."
        sql`${providerProfiles.serviceAreas}::text ILIKE ${term}`,
      )!,
    );
  }

  const bookingCounts = db
    .select({
      serviceId: bookings.serviceId,
      cnt: sql<number>`count(*)`.as("cnt"),
    })
    .from(bookings)
    .groupBy(bookings.serviceId)
    .as("bc");

  return db
    .select({
      service: services,
      provider: publicProviderColumns,
      category: categories,
      bookingCount: sql<number>`coalesce(${bookingCounts.cnt}, 0)`,
    })
    .from(services)
    .innerJoin(providerProfiles, eq(services.providerId, providerProfiles.id))
    .innerJoin(categories, eq(services.categoryId, categories.id))
    .leftJoin(bookingCounts, eq(bookingCounts.serviceId, services.id))
    .where(and(...conditions))
    .orderBy(desc(providerProfiles.averageRating))
    .limit(filters.limit ?? 50)
    .offset(filters.offset ?? 0);
}

export async function getServiceById(id: number) {
  const db = await requireDb();
  const rows = await db
    .select({
      service: services,
      provider: publicProviderColumns,
      category: categories,
      // providerProfiles has no avatar of its own — it lives on the linked user row.
      providerAvatarUrl: users.avatarUrl,
    })
    .from(services)
    .innerJoin(providerProfiles, eq(services.providerId, providerProfiles.id))
    .innerJoin(categories, eq(services.categoryId, categories.id))
    .innerJoin(users, eq(providerProfiles.userId, users.id))
    .where(eq(services.id, id))
    .limit(1);
  return rows[0];
}

export async function createService(data: InsertService) {
  const db = await requireDb();
  const [inserted] = await db.insert(services).values(data).returning({ id: services.id });
  return inserted?.id ?? 0;
}

export async function updateService(id: number, data: Partial<InsertService>) {
  const db = await requireDb();
  await db.update(services).set(data).where(eq(services.id, id));
}

/** Trending services: most-booked services (falls back to highest rated when no bookings). */
export async function listTrendingServices(limit = 10) {
  const db = await requireDb();
  const bookingCounts = db
    .select({
      serviceId: bookings.serviceId,
      cnt: sql<number>`count(*)`.as("cnt"),
    })
    .from(bookings)
    .groupBy(bookings.serviceId)
    .as("bc");

  return db
    .select({
      service: services,
      provider: publicProviderColumns,
      category: categories,
      bookingCount: sql<number>`coalesce(${bookingCounts.cnt}, 0)`,
    })
    .from(services)
    .innerJoin(providerProfiles, eq(services.providerId, providerProfiles.id))
    .innerJoin(categories, eq(services.categoryId, categories.id))
    .leftJoin(bookingCounts, eq(bookingCounts.serviceId, services.id))
    .where(eq(services.isActive, true))
    .orderBy(desc(sql`coalesce(${bookingCounts.cnt}, 0)`), desc(providerProfiles.averageRating))
    .limit(limit);
}

/** Featured providers: verified, highest rated. */
export async function listFeaturedProviders(limit = 8) {
  const db = await requireDb();

  const minPrices = db
    .select({
      providerId: services.providerId,
      minPrice: sql<string>`min(${services.basePrice})`.as("minPrice"),
    })
    .from(services)
    .where(eq(services.isActive, true))
    .groupBy(services.providerId)
    .as("mp");

  // One representative category per provider (their earliest active service's category),
  // used as a "profession" label — e.g. "Electrician" — on provider cards.
  const primaryCategory = db
    .selectDistinctOn([services.providerId], {
      providerId: services.providerId,
      categoryName: categories.name,
    })
    .from(services)
    .innerJoin(categories, eq(services.categoryId, categories.id))
    .where(eq(services.isActive, true))
    .orderBy(services.providerId, services.id)
    .as("pc");

  return db
    .select({
      provider: publicProviderColumns,
      // providerProfiles has no avatar of its own — it lives on the linked user row.
      avatarUrl: users.avatarUrl,
      minPrice: minPrices.minPrice,
      profession: primaryCategory.categoryName,
    })
    .from(providerProfiles)
    .innerJoin(users, eq(providerProfiles.userId, users.id))
    .leftJoin(minPrices, eq(minPrices.providerId, providerProfiles.id))
    .leftJoin(primaryCategory, eq(primaryCategory.providerId, providerProfiles.id))
    .where(eq(providerProfiles.verificationStatus, "verified"))
    .orderBy(desc(providerProfiles.averageRating), desc(providerProfiles.reviewCount))
    .limit(limit);
}

/**
 * Rule-based recommendations: services in categories the customer has booked
 * before (sorted by provider rating), falling back to verified + top-rated
 * services for customers with no booking history yet. No fake personalization
 * claims — just a sensible, honest default.
 */
export async function listRecommendedServices(userId: number, limit = 10) {
  const db = await requireDb();

  const pastCategories = await db
    .selectDistinct({ categoryId: services.categoryId })
    .from(bookings)
    .innerJoin(services, eq(bookings.serviceId, services.id))
    .where(eq(bookings.customerId, userId));

  const categoryIds = pastCategories.map((c) => c.categoryId);

  return db
    .select({ service: services, provider: publicProviderColumns, category: categories })
    .from(services)
    .innerJoin(providerProfiles, eq(services.providerId, providerProfiles.id))
    .innerJoin(categories, eq(services.categoryId, categories.id))
    .where(
      categoryIds.length > 0
        ? and(eq(services.isActive, true), inArray(services.categoryId, categoryIds))
        : and(eq(services.isActive, true), eq(providerProfiles.verificationStatus, "verified")),
    )
    .orderBy(desc(providerProfiles.averageRating))
    .limit(limit);
}

/**
 * Public provider profile with stats for the customer-facing provider detail
 * screen. Uses `publicProviderColumns` (not a bare `select()`) so legal
 * identity fields (DOB, phone, email, addresses, CAC number, rejection
 * reason) never leave the server for this publicProcedure-backed query.
 */
export async function getProviderPublicProfile(providerId: number) {
  const db = await requireDb();
  const profileRows = await db
    .select({ ...publicProviderColumns, avatarUrl: users.avatarUrl })
    .from(providerProfiles)
    .innerJoin(users, eq(providerProfiles.userId, users.id))
    .where(eq(providerProfiles.id, providerId))
    .limit(1);
  const profile = profileRows[0];
  if (!profile) return null;

  const [completedRows, providerServices, providerReviews, workingHours, portfolio] = await Promise.all([
    db
      .select({ cnt: sql<number>`count(*)` })
      .from(bookings)
      .where(and(eq(bookings.providerId, providerId), eq(bookings.status, "completed"))),
    db
      .select({ service: services, category: categories })
      .from(services)
      .innerJoin(categories, eq(services.categoryId, categories.id))
      .where(and(eq(services.providerId, providerId), eq(services.isActive, true))),
    listReviewsForProvider(providerId, 10),
    getWorkingHours(providerId),
    listPortfolioItems(providerId),
  ]);

  return {
    profile,
    completedJobs: Number(completedRows[0]?.cnt ?? 0),
    services: providerServices,
    reviews: providerReviews,
    workingHours,
    portfolio,
  };
}

/** Most recent booking timestamp for a provider, for "Last booked X ago" — null if they have none yet. */
export async function getProviderActivity(providerId: number) {
  const db = await requireDb();
  const rows = await db
    .select({ createdAt: bookings.createdAt })
    .from(bookings)
    .where(eq(bookings.providerId, providerId))
    .orderBy(desc(bookings.createdAt))
    .limit(1);
  return { lastBookedAt: rows[0]?.createdAt ?? null };
}

/* -------------------------------- Addresses ------------------------------- */

export async function listAddresses(userId: number) {
  const db = await requireDb();
  return db.select().from(addresses).where(eq(addresses.userId, userId)).orderBy(desc(addresses.isDefault));
}

export async function createAddress(data: InsertAddress) {
  const db = await requireDb();
  if (data.isDefault) {
    await db.update(addresses).set({ isDefault: false }).where(eq(addresses.userId, data.userId));
  }
  const [inserted] = await db.insert(addresses).values(data).returning({ id: addresses.id });
  return inserted?.id ?? 0;
}

export async function deleteAddress(userId: number, addressId: number) {
  const db = await requireDb();
  await db.delete(addresses).where(and(eq(addresses.id, addressId), eq(addresses.userId, userId)));
}

/* -------------------------------- Bookings -------------------------------- */

/** Generate human-friendly booking reference: DRK-YYYYMMDD-XXXX. */
export function generateBookingReference(date = new Date()) {
  const ymd = date.toISOString().slice(0, 10).replace(/-/g, "");
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `DRK-${ymd}-${suffix}`;
}

export async function createBooking(data: Omit<InsertBooking, "reference">) {
  const db = await requireDb();
  const reference = generateBookingReference();
  const [inserted] = await db.insert(bookings).values({ ...data, reference }).returning({ id: bookings.id });
  const id = inserted?.id ?? 0;
  await db.insert(bookingStatusHistory).values({
    bookingId: id,
    fromStatus: null,
    toStatus: data.status ?? "pending",
    changedByUserId: data.customerId,
    note: "Booking created",
  });

  // Previously silent — a provider only found out about a new request by checking
  // the app themselves. type "new_booking_request" is deliberately its own type
  // (not "booking_update"), so this is the one booking-lifecycle event a provider
  // can control independently of general status-change notifications.
  const profile = await getProviderProfileById(data.providerId);
  if (profile) {
    const serviceRow = await getServiceById(data.serviceId);
    await createNotification({
      userId: profile.userId,
      type: "new_booking_request",
      title: "New booking request",
      body: serviceRow ? `You have a new request for ${serviceRow.service.title}.` : "You have a new booking request.",
      data: { bookingId: id },
    });
  }

  return { id, reference };
}

export async function getBookingById(id: number) {
  const db = await requireDb();
  const rows = await db
    .select({
      booking: bookings,
      service: services,
      provider: publicProviderColumns,
      customer: {
        id: users.id,
        name: users.name,
        email: users.email,
        avatarUrl: users.avatarUrl,
      },
      address: addresses,
    })
    .from(bookings)
    .innerJoin(services, eq(bookings.serviceId, services.id))
    .innerJoin(providerProfiles, eq(bookings.providerId, providerProfiles.id))
    .innerJoin(users, eq(bookings.customerId, users.id))
    .leftJoin(addresses, eq(bookings.addressId, addresses.id))
    .where(eq(bookings.id, id))
    .limit(1);
  return rows[0];
}

/** Real per-step timestamps for the tracking timeline — already recorded on every transition, just never queried until now. */
export async function getBookingStatusHistory(bookingId: number) {
  const db = await requireDb();
  return db
    .select()
    .from(bookingStatusHistory)
    .where(eq(bookingStatusHistory.bookingId, bookingId))
    .orderBy(bookingStatusHistory.createdAt);
}

const PROGRESS_NOTIFICATION_COPY: Record<string, string> = {
  on_the_way: "Your provider is on the way",
  arrived: "Your provider has arrived",
  waiting_for_customer: "Your provider is waiting for you",
};

/** Provider posts a lightweight progress checkpoint (on the way/arrived/waiting) — notifies the customer. */
export async function addBookingProgressUpdate(params: {
  bookingId: number;
  type: "on_the_way" | "arrived" | "waiting_for_customer";
  note?: string;
}) {
  const db = await requireDb();
  const rows = await db.select().from(bookings).where(eq(bookings.id, params.bookingId)).limit(1);
  const booking = rows[0];
  if (!booking) throw new Error("Booking not found");
  if (booking.status !== "confirmed" && booking.status !== "in_progress") {
    throw new Error("Progress updates can only be posted on an accepted, active booking");
  }

  const [inserted] = await db
    .insert(bookingProgressUpdates)
    .values({ bookingId: params.bookingId, type: params.type, note: params.note })
    .returning({ id: bookingProgressUpdates.id });

  await createNotification({
    userId: booking.customerId,
    type: "booking_update",
    title: PROGRESS_NOTIFICATION_COPY[params.type] ?? "Booking update",
    body: params.note ? `${PROGRESS_NOTIFICATION_COPY[params.type]}. ${params.note}` : `Booking ${booking.reference}.`,
    data: { bookingId: params.bookingId },
  });

  return { id: inserted?.id ?? 0 };
}

export async function listBookingProgressUpdates(bookingId: number) {
  const db = await requireDb();
  return db
    .select()
    .from(bookingProgressUpdates)
    .where(eq(bookingProgressUpdates.bookingId, bookingId))
    .orderBy(bookingProgressUpdates.createdAt);
}

const ARRIVAL_AUTO_ADVANCE_MS = 5 * 60 * 1000;

/**
 * Simplifies the provider's flow from two manual taps to one: "Start Job" (a real
 * status transition to `in_progress`) used to require a separate manual "Arrived"
 * checkpoint tap to complete the customer-facing tracker's 5th step. This job posts
 * that "arrived" checkpoint automatically 5 minutes after the status transition, if
 * the provider hasn't already posted it themselves — same checkpoint, same customer
 * notification, so nothing downstream needs to know whether it was manual or timed.
 *
 * No dedup ledger needed (unlike sendDueBookingReminders): the "arrived" checkpoint's
 * own existence is the completion marker. Skips bookings with a pending cancellation
 * request — an automated status change shouldn't appear on a booking an admin is
 * actively reviewing. Meant to be called on a periodic timer (see
 * server/_core/index.ts), not per-request.
 */
export async function autoAdvanceArrivalCheckpoints(): Promise<{ advanced: number; checked: number }> {
  const db = await requireDb();
  const now = Date.now();

  const inProgress = await db.select({ id: bookings.id, customerId: bookings.customerId }).from(bookings).where(eq(bookings.status, "in_progress"));
  if (!inProgress.length) return { advanced: 0, checked: 0 };
  const ids = inProgress.map((b) => b.id);

  const [transitions, arrivedRows, pendingCancellations] = await Promise.all([
    db
      .select({ bookingId: bookingStatusHistory.bookingId, createdAt: bookingStatusHistory.createdAt })
      .from(bookingStatusHistory)
      .where(and(inArray(bookingStatusHistory.bookingId, ids), eq(bookingStatusHistory.toStatus, "in_progress"))),
    db
      .select({ bookingId: bookingProgressUpdates.bookingId })
      .from(bookingProgressUpdates)
      .where(and(inArray(bookingProgressUpdates.bookingId, ids), eq(bookingProgressUpdates.type, "arrived"))),
    db
      .select({ bookingId: bookingCancellationRequests.bookingId })
      .from(bookingCancellationRequests)
      .where(and(inArray(bookingCancellationRequests.bookingId, ids), eq(bookingCancellationRequests.status, "pending"))),
  ]);

  // Only one confirmed→in_progress transition is possible per booking under the
  // current BOOKING_TRANSITIONS (in_progress only ever leads to completed/cancelled,
  // both terminal), so there's at most one row per booking here.
  const transitionAt = new Map(transitions.map((t) => [t.bookingId, t.createdAt.getTime()]));
  const alreadyArrived = new Set(arrivedRows.map((r) => r.bookingId));
  const pendingCancellation = new Set(pendingCancellations.map((r) => r.bookingId));

  let advanced = 0;
  for (const booking of inProgress) {
    if (alreadyArrived.has(booking.id) || pendingCancellation.has(booking.id)) continue;
    const startedAt = transitionAt.get(booking.id);
    if (!startedAt || now - startedAt < ARRIVAL_AUTO_ADVANCE_MS) continue;

    await addBookingProgressUpdate({ bookingId: booking.id, type: "arrived" });
    void broadcastBookingUpdate(booking.id);
    advanced++;
  }

  return { advanced, checked: inProgress.length };
}

type ReminderInterval = (typeof REMINDER_INTERVALS)[number];

const REMINDER_INTERVAL_MS: Record<ReminderInterval, number> = {
  "1d": 24 * 60 * 60 * 1000,
  "5h": 5 * 60 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "30m": 30 * 60 * 1000,
  "10m": 10 * 60 * 1000,
};

const REMINDER_COPY: Record<ReminderInterval, string> = {
  "1d": "tomorrow",
  "5h": "in 5 hours",
  "1h": "in 1 hour",
  "30m": "in 30 minutes",
  "10m": "in 10 minutes",
};

/**
 * Nigeria uses one fixed offset year-round (WAT, UTC+1, no DST) — `bookings` stores
 * scheduledDate/scheduledTime as plain wall-clock strings with no zone attached, so
 * this is the one place that turns them into a real instant to compare against `now`.
 * Deliberately not the server host's local time: nothing elsewhere in this codebase
 * assumes the server itself runs in any particular zone, and it shouldn't have to for
 * reminder timing to be correct. Date.UTC() normalizes out-of-range fields (e.g. an
 * hour of 0 minus 1) correctly, so no separate midnight-rollover handling is needed.
 */
export function scheduledAtUtc(scheduledDate: string, scheduledTime: string): Date {
  const [y, m, d] = scheduledDate.split("-").map(Number);
  const [hh, mm] = scheduledTime.split(":").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh - 1, mm));
}

/**
 * A booking must start at least this far in the future — enforced in bookings.create
 * (routers.ts), not just hidden by greying out past/near-term slots in the picker
 * (src/app/booking/new.tsx), so a direct API call can't bypass it either. The client
 * can't import this (it would pull server-only DB code into the mobile bundle), so
 * booking/new.tsx keeps its own mirrored constant — comments on both sides point here.
 */
export const BOOKING_MIN_LEAD_MS = 60 * 60 * 1000;

/**
 * Checks every confirmed, still-upcoming booking against the 5 reminder intervals and
 * fires any that are newly due. Meant to be called on a periodic timer (see
 * server/_core/index.ts), not per-request. Only `confirmed` bookings qualify —
 * `pending` hasn't been accepted yet (a countdown to an unconfirmed slot would be
 * misleading), and `in_progress`/`completed`/etc. are no longer "upcoming."
 *
 * Dedup: `bookingReminders` records every (bookingId, interval) this function has
 * already evaluated, so re-running on a ~5-minute tick never double-fires — a
 * unique index on (bookingId, interval) backs this up against a concurrent run. A
 * boundary missed entirely (server was down, or it fell between two ticks) still
 * gets caught on the next tick as long as `now` hasn't reached the appointment time
 * yet — but a reminder is never sent for a moment that's already passed.
 */
export async function sendDueBookingReminders(): Promise<{ sent: number; checked: number }> {
  const db = await requireDb();
  const now = Date.now();

  const upcoming = await db
    .select({
      id: bookings.id,
      customerId: bookings.customerId,
      reference: bookings.reference,
      scheduledDate: bookings.scheduledDate,
      scheduledTime: bookings.scheduledTime,
      serviceTitle: services.title,
    })
    .from(bookings)
    .innerJoin(services, eq(bookings.serviceId, services.id))
    .where(eq(bookings.status, "confirmed"));

  if (!upcoming.length) return { sent: 0, checked: 0 };

  const already = await db
    .select({ bookingId: bookingReminders.bookingId, interval: bookingReminders.interval })
    .from(bookingReminders)
    .where(
      inArray(
        bookingReminders.bookingId,
        upcoming.map((b) => b.id),
      ),
    );
  const alreadyFired = new Set(already.map((r) => `${r.bookingId}:${r.interval}`));

  let sent = 0;
  for (const booking of upcoming) {
    const scheduledAt = scheduledAtUtc(booking.scheduledDate, booking.scheduledTime).getTime();
    if (scheduledAt <= now) continue; // already happened — never send a stale reminder

    for (const interval of REMINDER_INTERVALS) {
      const key = `${booking.id}:${interval}`;
      if (alreadyFired.has(key)) continue;
      const dueAt = scheduledAt - REMINDER_INTERVAL_MS[interval];
      if (now < dueAt) continue; // not due yet

      alreadyFired.add(key); // guards this run against re-processing the same booking twice
      await db.insert(bookingReminders).values({ bookingId: booking.id, interval }).onConflictDoNothing();

      const prefs = await getNotificationPreferences(booking.customerId);
      if (prefs.serviceReminders) {
        await createNotification({
          userId: booking.customerId,
          type: "service_reminder",
          title: "Upcoming service reminder",
          body: `Your ${booking.serviceTitle} booking (${booking.reference}) is ${REMINDER_COPY[interval]}.`,
          data: { bookingId: booking.id, interval },
        });
        sent++;
      }
    }
  }

  return { sent, checked: upcoming.length };
}

/**
 * Once a booking is `in_progress`, cancelling stops being instant — it's a request
 * either party can file, which sits in the admin queue until reviewed (see
 * `decideCancellationRequest`). Notifies the other party immediately, but does NOT
 * touch `bookings.status` — the booking stays exactly as it was until an admin acts.
 */
export async function requestBookingCancellation(params: {
  bookingId: number;
  requestedByUserId: number;
  requestedByRole: "customer" | "provider";
  reason: string;
}) {
  const db = await requireDb();
  const rows = await db.select().from(bookings).where(eq(bookings.id, params.bookingId)).limit(1);
  const booking = rows[0];
  if (!booking) throw new Error("Booking not found");
  if (booking.status !== "in_progress") {
    throw new Error("Cancellation requests can only be filed on a booking that's in progress");
  }

  const existing = await db
    .select({ id: bookingCancellationRequests.id })
    .from(bookingCancellationRequests)
    .where(and(eq(bookingCancellationRequests.bookingId, params.bookingId), eq(bookingCancellationRequests.status, "pending")))
    .limit(1);
  if (existing[0]) throw new Error("A cancellation request is already pending review for this booking");

  const [inserted] = await db
    .insert(bookingCancellationRequests)
    .values({
      bookingId: params.bookingId,
      requestedByUserId: params.requestedByUserId,
      requestedByRole: params.requestedByRole,
      reason: params.reason,
    })
    .returning({ id: bookingCancellationRequests.id });

  // Notify the other party — the requester already knows they just requested this.
  if (params.requestedByRole === "customer") {
    const profile = await getProviderProfileById(booking.providerId);
    if (profile) {
      await createNotification({
        userId: profile.userId,
        type: "booking_update",
        title: "Cancellation requested",
        body: `The customer has requested to cancel booking ${booking.reference}. An admin will review this shortly.`,
        data: { bookingId: params.bookingId },
      });
    }
  } else {
    await createNotification({
      userId: booking.customerId,
      type: "booking_update",
      title: "Cancellation requested",
      body: `Your provider has requested to cancel booking ${booking.reference}. An admin will review this shortly.`,
      data: { bookingId: params.bookingId },
    });
  }

  return { id: inserted?.id ?? 0 };
}

/** For the booking-detail screens: is there a pending cancellation request on this booking right now? */
export async function getPendingCancellationRequest(bookingId: number) {
  const db = await requireDb();
  const rows = await db
    .select()
    .from(bookingCancellationRequests)
    .where(and(eq(bookingCancellationRequests.bookingId, bookingId), eq(bookingCancellationRequests.status, "pending")))
    .limit(1);
  return rows[0] ?? null;
}

/** Admin-visible queue: cancellation requests awaiting review (or, with a status filter, any). */
export async function listCancellationRequests(status: "pending" | "approved" | "rejected" = "pending") {
  const db = await requireDb();
  return db
    .select({
      request: bookingCancellationRequests,
      booking: bookings,
      service: services,
      provider: publicProviderColumns,
      customer: publicCustomerColumns,
    })
    .from(bookingCancellationRequests)
    .innerJoin(bookings, eq(bookingCancellationRequests.bookingId, bookings.id))
    .innerJoin(services, eq(bookings.serviceId, services.id))
    .innerJoin(providerProfiles, eq(bookings.providerId, providerProfiles.id))
    .innerJoin(users, eq(bookings.customerId, users.id))
    .where(eq(bookingCancellationRequests.status, status))
    .orderBy(bookingCancellationRequests.createdAt);
}

/**
 * Provider-facing view of cancellation requests on their own bookings — every
 * status, not just pending, so a provider can see how a past dispute was resolved.
 * Simple v1 of "dispute visibility": reuses the exact data the admin queue already
 * shows, just scoped to one provider. Deliberately doesn't touch support tickets
 * filed about a provider — that needs its own privacy decision first (raw complaint
 * text vs. a summary), not bundled in here.
 */
export async function listCancellationRequestsForProvider(providerId: number) {
  const db = await requireDb();
  return db
    .select({
      request: bookingCancellationRequests,
      booking: bookings,
      service: services,
      customer: publicCustomerColumns,
    })
    .from(bookingCancellationRequests)
    .innerJoin(bookings, eq(bookingCancellationRequests.bookingId, bookings.id))
    .innerJoin(services, eq(bookings.serviceId, services.id))
    .innerJoin(users, eq(bookings.customerId, users.id))
    .where(eq(bookings.providerId, providerId))
    .orderBy(desc(bookingCancellationRequests.createdAt));
}

export type DecideCancellationRequestResult =
  | { success: true; refundAmount: number; providerPayoutAmount: number }
  | { success: false; reason: "not_found" | "already_decided" | "booking_no_longer_in_progress" };

/**
 * Admin approves or rejects a pending cancellation request.
 *
 * On approve, the admin supplies the exact refund/payout amounts (not derived
 * automatically) — there's no completion photos or customer sign-off for a job that
 * never finished, so "how much work was actually done" is a judgment call, not a
 * formula. `refundAmount` is credited straight to the customer's wallet at face value
 * (category "refund"); `providerPayoutAmount` is credited straight to the provider's
 * wallet (category "booking_earning") at whatever amount the admin enters — unlike
 * `creditProviderEarning`, no commission is auto-deducted here, since the admin is
 * already deciding the exact number to pay out. The two must not sum to more than the
 * booking total. `bookings.paymentStatus` moves to "refunded" whenever any refund was
 * issued (the schema has no partial-refund state); `bookings.status` moves to
 * "cancelled" via the normal state machine either way.
 */
export async function decideCancellationRequest(params: {
  requestId: number;
  adminUserId: number;
  decision: "approve" | "reject";
  reviewNote?: string;
  refundAmount?: number;
  providerPayoutAmount?: number;
}): Promise<DecideCancellationRequestResult> {
  const db = await requireDb();
  const rows = await db
    .select()
    .from(bookingCancellationRequests)
    .where(eq(bookingCancellationRequests.id, params.requestId))
    .limit(1);
  const request = rows[0];
  if (!request) return { success: false, reason: "not_found" };
  if (request.status !== "pending") return { success: false, reason: "already_decided" };

  const bookingRows = await db.select().from(bookings).where(eq(bookings.id, request.bookingId)).limit(1);
  const booking = bookingRows[0];
  if (!booking) return { success: false, reason: "not_found" };

  if (params.decision === "reject") {
    await db
      .update(bookingCancellationRequests)
      .set({ status: "rejected", reviewedByAdminId: params.adminUserId, reviewNote: params.reviewNote, reviewedAt: new Date() })
      .where(eq(bookingCancellationRequests.id, params.requestId));

    await createNotification({
      userId: request.requestedByUserId,
      type: "booking_update",
      title: "Cancellation request declined",
      body: `Your cancellation request for booking ${booking.reference} was declined. The booking continues as normal.`,
      data: { bookingId: booking.id },
    });
    await logAudit({
      userId: params.adminUserId,
      action: "booking.cancellation_request.rejected",
      entityType: "booking",
      entityId: booking.id,
      detail: { requestId: params.requestId, note: params.reviewNote },
    });
    return { success: true, refundAmount: 0, providerPayoutAmount: 0 };
  }

  if (booking.status !== "in_progress") return { success: false, reason: "booking_no_longer_in_progress" };

  const refundAmount = Math.max(0, params.refundAmount ?? 0);
  const providerPayoutAmount = Math.max(0, params.providerPayoutAmount ?? 0);
  const total = Number(booking.total);
  if (refundAmount + providerPayoutAmount > total) {
    throw new Error("Refund + provider payout can't exceed the booking total");
  }

  const profile = await getProviderProfileById(booking.providerId);
  if (!profile) return { success: false, reason: "not_found" };

  if (refundAmount > 0) {
    await recordTransaction({
      userId: booking.customerId,
      type: "credit",
      category: "refund",
      amount: refundAmount,
      bookingId: booking.id,
      description: `Refund for cancelled booking ${booking.reference} (admin-approved cancellation)`,
    });
  }
  if (providerPayoutAmount > 0) {
    await recordTransaction({
      userId: profile.userId,
      type: "credit",
      category: "booking_earning",
      amount: providerPayoutAmount,
      bookingId: booking.id,
      description: `Partial payout for cancelled booking ${booking.reference} (admin-approved, work done before cancellation)`,
    });
  }

  await updateBookingStatus({
    bookingId: booking.id,
    toStatus: "cancelled",
    changedByUserId: params.adminUserId,
    cancelReason: request.reason,
  });
  if (refundAmount > 0) {
    await db.update(bookings).set({ paymentStatus: "refunded" }).where(eq(bookings.id, booking.id));
  }

  await db
    .update(bookingCancellationRequests)
    .set({
      status: "approved",
      reviewedByAdminId: params.adminUserId,
      reviewNote: params.reviewNote,
      refundAmount: refundAmount.toFixed(2),
      providerPayoutAmount: providerPayoutAmount.toFixed(2),
      reviewedAt: new Date(),
    })
    .where(eq(bookingCancellationRequests.id, params.requestId));

  await createNotification({
    userId: booking.customerId,
    type: "booking_update",
    title: "Booking cancelled",
    body:
      refundAmount > 0
        ? `Booking ${booking.reference} was cancelled. ₦${refundAmount.toLocaleString()} was refunded to your wallet.`
        : `Booking ${booking.reference} was cancelled.`,
    data: { bookingId: booking.id },
  });
  await createNotification({
    userId: profile.userId,
    type: "booking_update",
    title: "Booking cancelled",
    body:
      providerPayoutAmount > 0
        ? `Booking ${booking.reference} was cancelled. ₦${providerPayoutAmount.toLocaleString()} was credited to your wallet for work already done.`
        : `Booking ${booking.reference} was cancelled.`,
    data: { bookingId: booking.id },
  });
  await logAudit({
    userId: params.adminUserId,
    action: "booking.cancellation_request.approved",
    entityType: "booking",
    entityId: booking.id,
    detail: { requestId: params.requestId, refundAmount, providerPayoutAmount, note: params.reviewNote },
  });

  return { success: true, refundAmount, providerPayoutAmount };
}

export async function listBookingsForCustomer(customerId: number) {
  const db = await requireDb();
  return db
    .select({
      booking: bookings,
      service: services,
      provider: publicProviderColumns,
    })
    .from(bookings)
    .innerJoin(services, eq(bookings.serviceId, services.id))
    .innerJoin(providerProfiles, eq(bookings.providerId, providerProfiles.id))
    .where(eq(bookings.customerId, customerId))
    .orderBy(desc(bookings.createdAt));
}

export async function listBookingsForProvider(providerId: number) {
  const db = await requireDb();
  return db
    .select({
      booking: bookings,
      service: services,
      customer: publicCustomerColumns,
    })
    .from(bookings)
    .innerJoin(services, eq(bookings.serviceId, services.id))
    .innerJoin(users, eq(bookings.customerId, users.id))
    .where(eq(bookings.providerId, providerId))
    .orderBy(desc(bookings.createdAt));
}

/** Allowed booking status transitions (state machine). */
export const BOOKING_TRANSITIONS: Record<string, string[]> = {
  pending: ["confirmed", "rejected", "cancelled"],
  confirmed: ["in_progress", "cancelled"],
  in_progress: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
  rejected: [],
};

/** After this many wrong attempts, a release code locks — the booking falls into the admin "held payments" queue. */
export const RELEASE_CODE_MAX_ATTEMPTS = 5;
const RELEASE_CODE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function generateReleaseCode(): string {
  return String(crypto.randomInt(0, 100000)).padStart(5, "0");
}

const RELEASE_CODE_CIPHER_ALGO = "aes-256-gcm";

function releaseCodeKey(): Buffer {
  return Buffer.from(ENV.releaseCodePepper, "hex");
}

/**
 * Reversible (not a hash) — the customer needs to re-view their own code on demand
 * (bookings.releaseCode in routers.ts, customer-only), which a one-way hash can't
 * support. Still requires the server-only pepper to reverse, so a raw DB dump alone
 * doesn't recover the code. Stored as `iv:authTag:ciphertext`, all hex.
 */
function encryptReleaseCode(code: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(RELEASE_CODE_CIPHER_ALGO, releaseCodeKey(), iv);
  const encrypted = Buffer.concat([cipher.update(code, "utf8"), cipher.final()]);
  return `${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${encrypted.toString("hex")}`;
}

function decryptReleaseCode(stored: string): string | null {
  try {
    const [ivHex, tagHex, dataHex] = stored.split(":");
    const decipher = crypto.createDecipheriv(RELEASE_CODE_CIPHER_ALGO, releaseCodeKey(), Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    return Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** Constant-time comparison so a provider can't infer digits from response timing. */
function codesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export async function updateBookingStatus(params: {
  bookingId: number;
  toStatus: "pending" | "confirmed" | "in_progress" | "completed" | "cancelled" | "rejected";
  changedByUserId: number;
  note?: string;
  cancelReason?: string;
  completionPhotos?: string[];
}) {
  const db = await requireDb();
  const rows = await db.select().from(bookings).where(eq(bookings.id, params.bookingId)).limit(1);
  const booking = rows[0];
  if (!booking) throw new Error("Booking not found");

  const allowed = BOOKING_TRANSITIONS[booking.status] ?? [];
  if (!allowed.includes(params.toStatus)) {
    throw new Error(`Cannot change booking from '${booking.status}' to '${params.toStatus}'`);
  }

  await db
    .update(bookings)
    .set({
      status: params.toStatus,
      cancelReason: params.cancelReason,
      completedAt: params.toStatus === "completed" ? new Date() : undefined,
      completionPhotos:
        params.toStatus === "completed" && params.completionPhotos ? params.completionPhotos : undefined,
    })
    .where(eq(bookings.id, params.bookingId));

  await db.insert(bookingStatusHistory).values({
    bookingId: params.bookingId,
    fromStatus: booking.status,
    toStatus: params.toStatus,
    changedByUserId: params.changedByUserId,
    note: params.note,
  });

  let releaseCode: string | undefined;
  if (params.toStatus === "completed") {
    await db
      .update(providerProfiles)
      .set({ completedJobs: sql`${providerProfiles.completedJobs} + 1` })
      .where(eq(providerProfiles.id, booking.providerId));

    // Completion no longer moves money directly — it puts the payout on hold behind a
    // handoff code. paymentStatus should always be "paid" by the time a booking reaches
    // "completed" (paid-before-confirm is already gated in the router), but this check
    // is a harmless no-op guard rather than an assumption.
    if (booking.paymentStatus === "paid") {
      releaseCode = generateReleaseCode();
      await db
        .update(bookings)
        .set({
          payoutStatus: "held",
          releaseCodeHash: encryptReleaseCode(releaseCode),
          releaseCodeGeneratedAt: new Date(),
          releaseCodeExpiresAt: new Date(Date.now() + RELEASE_CODE_TTL_MS),
          releaseCodeAttempts: 0,
        })
        .where(eq(bookings.id, params.bookingId));
    }
  }

  return { ...booking, status: params.toStatus, releaseCode };
}

/**
 * Credit the provider's wallet with the booking total minus platform commission.
 * This is the one place money actually moves — called either from confirmReleaseCode
 * (releasedBy = the provider's own userId) or releaseHeldPaymentByAdmin (releasedBy =
 * the admin's userId, note = their reason). Idempotent two ways: an explicit
 * payoutStatus check (fast path) plus the original existing-transaction check
 * (defense in depth, in case payoutStatus and the ledger ever disagree).
 */
export async function creditProviderEarning(
  bookingId: number,
  releasedBy: number,
  note?: string,
): Promise<{ earning: number; commission: number } | null> {
  const db = await requireDb();
  const rows = await db.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
  const booking = rows[0];
  if (!booking || booking.paymentStatus !== "paid") return null;
  if (booking.payoutStatus === "released") return null;

  const profileRows = await db
    .select()
    .from(providerProfiles)
    .where(eq(providerProfiles.id, booking.providerId))
    .limit(1);
  const profile = profileRows[0];
  if (!profile) return null;

  // Idempotency: check for an existing earning transaction for this booking.
  const wallet = await getOrCreateWallet(profile.userId);
  const existing = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(
      and(
        eq(transactions.walletId, wallet.id),
        eq(transactions.bookingId, bookingId),
        eq(transactions.category, "booking_earning"),
      ),
    )
    .limit(1);
  if (existing[0]) return null;

  // Commission is charged on the service amount only — the flat platform/booking
  // fee (if any) is separate platform revenue that was never the provider's to earn
  // a cut of, so it's excluded from the base before commission is applied.
  const serviceAmount = Number(booking.total) - Number(booking.platformFee);
  const commissionRate = Number(profile.commissionRate) / 100;
  const commission = Math.round(serviceAmount * commissionRate * 100) / 100;
  const earning = Math.round((serviceAmount - commission) * 100) / 100;

  const releaseMethod = note ? `released by admin: ${note}` : "released via handoff code";
  await recordTransaction({
    userId: profile.userId,
    type: "credit",
    category: "booking_earning",
    amount: earning,
    bookingId,
    description: `Earning for booking ${booking.reference} (₦${serviceAmount.toLocaleString()} − ${Number(profile.commissionRate)}% commission, ${releaseMethod})`,
  });

  await db
    .update(bookings)
    .set({
      payoutStatus: "released",
      payoutReleasedAt: new Date(),
      payoutReleasedBy: releasedBy,
      payoutReleaseNote: note ?? null,
    })
    .where(eq(bookings.id, bookingId));

  await createNotification({
    userId: profile.userId,
    type: "payment",
    title: "You earned ₦" + earning.toLocaleString(),
    body: `Payment for booking ${booking.reference} has been credited to your wallet.`,
    data: { bookingId },
  });

  return { earning, commission };
}

export type ConfirmReleaseCodeResult =
  | { success: true; earning: number; commission: number }
  | { success: false; reason: "not_held" | "expired" | "locked" | "wrong_code"; remainingAttempts?: number };

/**
 * Provider enters the 5-digit code the customer handed them in person. Correct code →
 * releases the held payout (same math/side-effects as an admin manual release, just
 * releasedBy = the provider's own userId, no note). Wrong code → increments the attempt
 * counter and logs it; after RELEASE_CODE_MAX_ATTEMPTS the code locks and the booking
 * needs an admin manual release (see releaseHeldPaymentByAdmin) — no regenerate/re-issue
 * flow in this pass, one fallback path covers both "code never handed over" and "locked
 * out from too many wrong guesses."
 */
export async function confirmReleaseCode(params: {
  bookingId: number;
  providerUserId: number;
  code: string;
}): Promise<ConfirmReleaseCodeResult> {
  const db = await requireDb();
  const rows = await db.select().from(bookings).where(eq(bookings.id, params.bookingId)).limit(1);
  const booking = rows[0];
  if (!booking || booking.payoutStatus !== "held") {
    return { success: false, reason: "not_held" };
  }
  if (booking.releaseCodeAttempts >= RELEASE_CODE_MAX_ATTEMPTS) {
    return { success: false, reason: "locked" };
  }
  if (!booking.releaseCodeExpiresAt || booking.releaseCodeExpiresAt.getTime() < Date.now()) {
    return { success: false, reason: "expired" };
  }

  const decrypted = booking.releaseCodeHash ? decryptReleaseCode(booking.releaseCodeHash) : null;
  const isMatch = decrypted != null && codesMatch(decrypted, params.code);
  if (!isMatch) {
    const attempts = booking.releaseCodeAttempts + 1;
    await db.update(bookings).set({ releaseCodeAttempts: attempts }).where(eq(bookings.id, params.bookingId));
    await logAudit({
      userId: params.providerUserId,
      action: "booking.release_code.wrong_attempt",
      entityType: "booking",
      entityId: params.bookingId,
      detail: { attempts },
    });
    if (attempts >= RELEASE_CODE_MAX_ATTEMPTS) {
      return { success: false, reason: "locked" };
    }
    return { success: false, reason: "wrong_code", remainingAttempts: RELEASE_CODE_MAX_ATTEMPTS - attempts };
  }

  const result = await creditProviderEarning(params.bookingId, params.providerUserId);
  if (!result) return { success: false, reason: "not_held" };

  await logAudit({
    userId: params.providerUserId,
    action: "booking.release_code.confirmed",
    entityType: "booking",
    entityId: params.bookingId,
  });

  return { success: true, earning: result.earning, commission: result.commission };
}

/**
 * Decrypts a booking's release code for redisplay — **caller must independently verify
 * the requester is the booking's customer** (see bookings.releaseCode in routers.ts).
 * This is the only place the plain code exists outside the original generation moment —
 * never call it, or expose its result, from anything the provider can reach.
 */
export async function getReleaseCodeForCustomer(bookingId: number) {
  const db = await requireDb();
  const rows = await db.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
  const booking = rows[0];
  if (!booking || booking.payoutStatus !== "held" || !booking.releaseCodeHash) return null;
  const code = decryptReleaseCode(booking.releaseCodeHash);
  if (!code) return null;
  return {
    code,
    expiresAt: booking.releaseCodeExpiresAt,
    attemptsRemaining: Math.max(0, RELEASE_CODE_MAX_ATTEMPTS - booking.releaseCodeAttempts),
  };
}

/** Admin-visible queue: completed bookings whose payout is still held. */
export async function listHeldPayments() {
  const db = await requireDb();
  return db
    .select({
      booking: bookings,
      provider: publicProviderColumns,
      customer: publicCustomerColumns,
      service: services,
    })
    .from(bookings)
    .innerJoin(providerProfiles, eq(bookings.providerId, providerProfiles.id))
    .innerJoin(users, eq(bookings.customerId, users.id))
    .innerJoin(services, eq(bookings.serviceId, services.id))
    .where(and(eq(bookings.status, "completed"), eq(bookings.payoutStatus, "held")))
    .orderBy(bookings.completedAt);
}

/**
 * Admin override for a held payment the code path never resolved (code never handed
 * over, expired, or locked out after too many wrong attempts) — bypasses the code
 * entirely, requires a reason for the audit trail.
 */
export async function releaseHeldPaymentByAdmin(params: { bookingId: number; adminUserId: number; note: string }) {
  const result = await creditProviderEarning(params.bookingId, params.adminUserId, params.note);
  if (!result) return null;

  await logAudit({
    userId: params.adminUserId,
    action: "booking.payout.admin_release",
    entityType: "booking",
    entityId: params.bookingId,
    detail: { note: params.note },
  });

  return result;
}

/* --------------------------- Provider dashboard --------------------------- */

/** Aggregated stats for the provider dashboard. */
export async function getProviderDashboardStats(providerId: number, providerUserId: number) {
  const db = await requireDb();
  const today = new Date().toISOString().slice(0, 10);

  const [statusCounts, todayRows, ratingRows, wallet] = await Promise.all([
    db
      .select({ status: bookings.status, cnt: sql<number>`COUNT(*)` })
      .from(bookings)
      .where(eq(bookings.providerId, providerId))
      .groupBy(bookings.status),
    db
      .select({ cnt: sql<number>`COUNT(*)` })
      .from(bookings)
      .where(
        and(
          eq(bookings.providerId, providerId),
          eq(bookings.scheduledDate, today),
          inArray(bookings.status, ["confirmed", "in_progress"]),
        ),
      ),
    db
      .select({ avg: providerProfiles.averageRating, count: providerProfiles.reviewCount, jobs: providerProfiles.completedJobs })
      .from(providerProfiles)
      .where(eq(providerProfiles.id, providerId))
      .limit(1),
    getOrCreateWallet(providerUserId),
  ]);

  const counts: Record<string, number> = {};
  for (const row of statusCounts) counts[row.status] = Number(row.cnt);

  // Sum of earnings this month
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const earningsRows = await db
    .select({ total: sql<string>`COALESCE(SUM(${transactions.amount}), 0)` })
    .from(transactions)
    .where(
      and(
        eq(transactions.walletId, wallet.id),
        eq(transactions.category, "booking_earning"),
        sql`${transactions.createdAt} >= ${monthStart}`,
      ),
    );

  return {
    pendingRequests: counts["pending"] ?? 0,
    confirmed: counts["confirmed"] ?? 0,
    inProgress: counts["in_progress"] ?? 0,
    completed: counts["completed"] ?? 0,
    jobsToday: Number(todayRows[0]?.cnt ?? 0),
    averageRating: Number(ratingRows[0]?.avg ?? 0),
    reviewCount: Number(ratingRows[0]?.count ?? 0),
    completedJobs: Number(ratingRows[0]?.jobs ?? 0),
    walletBalance: Number(wallet.balance),
    earningsThisMonth: Number(earningsRows[0]?.total ?? 0),
  };
}

/**
 * Provider-facing analytics — deliberately limited to metrics real data already
 * supports. Profile views, service views, and portfolio engagement are NOT included:
 * no view/click tracking exists anywhere in the schema for any of those, and this
 * returns real numbers only, never a fabricated placeholder. Adding those needs new
 * instrumentation (a views/events table wired into the customer-facing profile and
 * service detail pages) as its own follow-up, not a UI-only addition here.
 */
export async function getProviderAnalytics(providerId: number, providerUserId: number) {
  const db = await requireDb();
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const yearStart = new Date(now.getFullYear(), 0, 1);

  const [statusCounts, ratingRow, wallet, mostBookedRows, repeatCustomerRows] = await Promise.all([
    db
      .select({ status: bookings.status, cnt: sql<number>`COUNT(*)` })
      .from(bookings)
      .where(eq(bookings.providerId, providerId))
      .groupBy(bookings.status),
    db
      .select({ avg: providerProfiles.averageRating, count: providerProfiles.reviewCount })
      .from(providerProfiles)
      .where(eq(providerProfiles.id, providerId))
      .limit(1),
    getOrCreateWallet(providerUserId),
    db
      .select({ title: services.title, cnt: sql<number>`COUNT(*)`.as("cnt") })
      .from(bookings)
      .innerJoin(services, eq(bookings.serviceId, services.id))
      .where(eq(bookings.providerId, providerId))
      .groupBy(services.id, services.title)
      .orderBy(desc(sql`cnt`))
      .limit(1),
    db
      .select({ customerId: bookings.customerId, cnt: sql<number>`COUNT(*)` })
      .from(bookings)
      .where(eq(bookings.providerId, providerId))
      .groupBy(bookings.customerId)
      .having(sql`COUNT(*) > 1`),
  ]);

  const counts: Record<string, number> = {};
  let totalBookings = 0;
  for (const row of statusCounts) {
    counts[row.status] = Number(row.cnt);
    totalBookings += Number(row.cnt);
  }
  const completedBookings = counts["completed"] ?? 0;
  const cancelledBookings = counts["cancelled"] ?? 0;

  const [earningsAllTime, earningsThisMonth, earningsThisYear] = await Promise.all([
    db
      .select({ total: sql<string>`COALESCE(SUM(${transactions.amount}), 0)` })
      .from(transactions)
      .where(and(eq(transactions.walletId, wallet.id), eq(transactions.category, "booking_earning"))),
    db
      .select({ total: sql<string>`COALESCE(SUM(${transactions.amount}), 0)` })
      .from(transactions)
      .where(
        and(
          eq(transactions.walletId, wallet.id),
          eq(transactions.category, "booking_earning"),
          sql`${transactions.createdAt} >= ${monthStart}`,
        ),
      ),
    db
      .select({ total: sql<string>`COALESCE(SUM(${transactions.amount}), 0)` })
      .from(transactions)
      .where(
        and(
          eq(transactions.walletId, wallet.id),
          eq(transactions.category, "booking_earning"),
          sql`${transactions.createdAt} >= ${yearStart}`,
        ),
      ),
  ]);

  return {
    totalBookings,
    completedBookings,
    cancellationRate: totalBookings > 0 ? Math.round((cancelledBookings / totalBookings) * 1000) / 10 : 0,
    totalEarnings: Number(earningsAllTime[0]?.total ?? 0),
    earningsThisMonth: Number(earningsThisMonth[0]?.total ?? 0),
    earningsThisYear: Number(earningsThisYear[0]?.total ?? 0),
    averageRating: Number(ratingRow[0]?.avg ?? 0),
    reviewCount: Number(ratingRow[0]?.count ?? 0),
    mostBookedService: mostBookedRows[0]?.title ?? null,
    repeatCustomers: repeatCustomerRows.length,
  };
}

/** Earnings summary + recent earning transactions for the provider. */
export async function getProviderEarnings(providerUserId: number) {
  const db = await requireDb();
  const wallet = await getOrCreateWallet(providerUserId);

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay());
  weekStart.setHours(0, 0, 0, 0);

  const sumSince = async (since?: Date) => {
    const conditions = [eq(transactions.walletId, wallet.id), eq(transactions.category, "booking_earning" as const)];
    if (since) conditions.push(sql`${transactions.createdAt} >= ${since}` as never);
    const rows = await db
      .select({ total: sql<string>`COALESCE(SUM(${transactions.amount}), 0)` })
      .from(transactions)
      .where(and(...conditions));
    return Number(rows[0]?.total ?? 0);
  };

  const [allTime, thisMonth, thisWeek, recent] = await Promise.all([
    sumSince(),
    sumSince(monthStart),
    sumSince(weekStart),
    db
      .select()
      .from(transactions)
      .where(eq(transactions.walletId, wallet.id))
      .orderBy(desc(transactions.createdAt))
      .limit(50),
  ]);

  return {
    balance: Number(wallet.balance),
    allTime,
    thisMonth,
    thisWeek,
    transactions: recent,
  };
}

/* --------------------------- Provider documents --------------------------- */

export async function createProviderDocument(data: InsertProviderDocument) {
  const db = await requireDb();
  const [inserted] = await db.insert(providerDocuments).values(data).returning({ id: providerDocuments.id });
  return inserted?.id ?? 0;
}

export async function listProviderDocuments(providerId: number) {
  const db = await requireDb();
  return db
    .select()
    .from(providerDocuments)
    .where(eq(providerDocuments.providerId, providerId))
    .orderBy(desc(providerDocuments.createdAt));
}

export async function listProviderBankAccounts(providerId: number) {
  const db = await requireDb();
  return db
    .select()
    .from(providerBankAccounts)
    .where(eq(providerBankAccounts.providerId, providerId))
    .orderBy(desc(providerBankAccounts.isDefault), desc(providerBankAccounts.createdAt));
}

export async function createProviderBankAccount(data: InsertProviderBankAccount) {
  const db = await requireDb();
  if (data.isDefault) {
    await db.update(providerBankAccounts).set({ isDefault: false }).where(eq(providerBankAccounts.providerId, data.providerId));
  }
  const [inserted] = await db.insert(providerBankAccounts).values(data).returning({ id: providerBankAccounts.id });
  return inserted?.id ?? 0;
}

export async function deleteProviderBankAccount(providerId: number, accountId: number) {
  const db = await requireDb();
  await db
    .delete(providerBankAccounts)
    .where(and(eq(providerBankAccounts.id, accountId), eq(providerBankAccounts.providerId, providerId)));
}

export async function getWorkingHours(providerId: number) {
  const db = await requireDb();
  return db
    .select()
    .from(providerWorkingHours)
    .where(eq(providerWorkingHours.providerId, providerId))
    .orderBy(providerWorkingHours.dayOfWeek);
}

/** Upserts all 7 days at once — the settings screen always saves the full week together. */
export async function setWorkingHours(
  providerId: number,
  days: { dayOfWeek: number; isOpen: boolean; openTime?: string | null; closeTime?: string | null }[],
) {
  const db = await requireDb();
  for (const day of days) {
    const openTime = day.isOpen ? (day.openTime ?? null) : null;
    const closeTime = day.isOpen ? (day.closeTime ?? null) : null;
    await db
      .insert(providerWorkingHours)
      .values({ providerId, dayOfWeek: day.dayOfWeek, isOpen: day.isOpen, openTime, closeTime })
      .onConflictDoUpdate({
        target: [providerWorkingHours.providerId, providerWorkingHours.dayOfWeek],
        set: { isOpen: day.isOpen, openTime, closeTime, updatedAt: new Date() },
      });
  }
}

export async function listBlockedDates(providerId: number) {
  const db = await requireDb();
  return db
    .select()
    .from(providerBlockedDates)
    .where(eq(providerBlockedDates.providerId, providerId))
    .orderBy(providerBlockedDates.startDate);
}

export async function addBlockedDate(data: InsertProviderBlockedDate) {
  const db = await requireDb();
  const [inserted] = await db.insert(providerBlockedDates).values(data).returning({ id: providerBlockedDates.id });
  return inserted?.id ?? 0;
}

/** Default range used when a provider hasn't configured any working hours yet
 *  (true for every provider as of this writing) — matches the picker's old
 *  static list, so booking keeps working until a provider opts into real hours. */
const DEFAULT_SLOT_OPEN = "08:00";
const DEFAULT_SLOT_CLOSE = "18:00";
const SLOT_STEP_MINUTES = 30;

function slotsBetween(openTime: string, closeTime: string): string[] {
  const [oh, om] = openTime.split(":").map(Number);
  const [ch, cm] = closeTime.split(":").map(Number);
  const out: string[] = [];
  for (let mins = oh * 60 + om; mins <= ch * 60 + cm; mins += SLOT_STEP_MINUTES) {
    out.push(`${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`);
  }
  return out;
}

/** Time slots a provider is bookable at on a given calendar date, honoring their
 *  working hours and blocked dates. Doesn't apply the lead-time buffer (callers
 *  already grey/reject those separately — see BOOKING_MIN_LEAD_MS) or exclude
 *  already-booked slots (no double-booking guard exists yet, a separate gap). */
export async function getAvailableTimeSlots(providerId: number, dateIso: string): Promise<string[]> {
  const db = await requireDb();

  const blocked = await db
    .select({ id: providerBlockedDates.id })
    .from(providerBlockedDates)
    .where(
      and(
        eq(providerBlockedDates.providerId, providerId),
        lte(providerBlockedDates.startDate, dateIso),
        gte(providerBlockedDates.endDate, dateIso),
      ),
    )
    .limit(1);
  if (blocked.length) return [];

  const hours = await getWorkingHours(providerId);
  if (hours.length === 0) return slotsBetween(DEFAULT_SLOT_OPEN, DEFAULT_SLOT_CLOSE);

  // Calendar weekday for the date itself, not affected by timezone: parsing as
  // UTC midnight of a positive (Lagos, UTC+1) offset date never crosses a day
  // boundary. Matches providerWorkingHours.dayOfWeek's own "getDay()" comment.
  const dayOfWeek = new Date(`${dateIso}T00:00:00Z`).getUTCDay();
  const day = hours.find((h) => h.dayOfWeek === dayOfWeek);
  if (!day || !day.isOpen || !day.openTime || !day.closeTime) return [];
  return slotsBetween(day.openTime, day.closeTime);
}

export async function removeBlockedDate(providerId: number, blockedDateId: number) {
  const db = await requireDb();
  await db
    .delete(providerBlockedDates)
    .where(and(eq(providerBlockedDates.id, blockedDateId), eq(providerBlockedDates.providerId, providerId)));
}

/** Mark provider verification as pending after documents are submitted. */
export async function submitProviderForVerification(providerId: number) {
  const db = await requireDb();
  await db
    .update(providerProfiles)
    .set({ verificationStatus: "pending" })
    .where(and(eq(providerProfiles.id, providerId), eq(providerProfiles.verificationStatus, "unverified")));
}

/** Soft-delete a service (deactivate) — bookings keep their FK. */
export async function deactivateService(serviceId: number) {
  const db = await requireDb();
  await db.update(services).set({ isActive: false }).where(eq(services.id, serviceId));
}

/* --------------------------------- Reviews -------------------------------- */

export async function createReview(data: InsertReview) {
  const db = await requireDb();
  const [inserted] = await db.insert(reviews).values(data).returning({ id: reviews.id });
  const id = inserted?.id ?? 0;
  await recomputeProviderRating(data.providerId);
  return id;
}

export async function getReviewById(reviewId: number) {
  const db = await requireDb();
  const rows = await db.select().from(reviews).where(eq(reviews.id, reviewId)).limit(1);
  return rows[0] ?? null;
}

/** Provider replies to a review on their own profile. Returns the updated row, or null if not the owning provider. */
export async function respondToReview(reviewId: number, providerId: number, response: string) {
  const db = await requireDb();
  const rows = await db.select().from(reviews).where(eq(reviews.id, reviewId)).limit(1);
  const review = rows[0];
  if (!review || review.providerId !== providerId) return null;
  await db.update(reviews).set({ providerResponse: response }).where(eq(reviews.id, reviewId));
  return { ...review, providerResponse: response };
}

export async function listReviewsForProvider(providerId: number, limit = 20) {
  const db = await requireDb();
  return db
    .select({ review: reviews, customer: publicCustomerColumns })
    .from(reviews)
    .innerJoin(users, eq(reviews.customerId, users.id))
    .where(and(eq(reviews.providerId, providerId), eq(reviews.isVisible, true)))
    .orderBy(desc(reviews.createdAt))
    .limit(limit);
}

export async function updateReview(
  reviewId: number,
  customerId: number,
  data: { rating?: number; comment?: string | null },
) {
  const db = await requireDb();
  const rows = await db.select().from(reviews).where(eq(reviews.id, reviewId)).limit(1);
  const review = rows[0];
  if (!review || review.customerId !== customerId) return null;
  await db
    .update(reviews)
    .set({
      ...(data.rating ? { rating: data.rating } : {}),
      comment: data.comment !== undefined ? data.comment : review.comment,
    })
    .where(eq(reviews.id, reviewId));
  await recomputeProviderRating(review.providerId);
  return { ...review, ...data };
}

export async function deleteReview(reviewId: number, customerId: number) {
  const db = await requireDb();
  const rows = await db.select().from(reviews).where(eq(reviews.id, reviewId)).limit(1);
  const review = rows[0];
  if (!review || review.customerId !== customerId) return false;
  await db.delete(reviews).where(eq(reviews.id, reviewId));
  await recomputeProviderRating(review.providerId);
  return true;
}

export async function listMyReviews(customerId: number, limit = 50) {
  const db = await requireDb();
  return db
    .select({ review: reviews, provider: publicProviderColumns })
    .from(reviews)
    .innerJoin(providerProfiles, eq(reviews.providerId, providerProfiles.id))
    .where(eq(reviews.customerId, customerId))
    .orderBy(desc(reviews.createdAt))
    .limit(limit);
}

/* ------------------------------- Messaging -------------------------------- */

export async function getOrCreateConversation(params: {
  customerId: number;
  providerId: number;
  bookingId?: number | null;
}) {
  const db = await requireDb();
  const existing = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.customerId, params.customerId),
        eq(conversations.providerId, params.providerId),
      ),
    )
    .limit(1);
  if (existing[0]) return existing[0];

  const [inserted] = await db
    .insert(conversations)
    .values({
      customerId: params.customerId,
      providerId: params.providerId,
      bookingId: params.bookingId ?? null,
    })
    .returning({ id: conversations.id });
  const id = inserted?.id ?? 0;
  const rows = await db.select().from(conversations).where(eq(conversations.id, id)).limit(1);
  return rows[0];
}

/** List conversations for a user (as customer or as provider user), with counterpart info. */
export async function listConversationsForUser(userId: number) {
  const db = await requireDb();
  const providerProfile = await getProviderProfileByUserId(userId);

  const conds = [eq(conversations.customerId, userId)];
  if (providerProfile) conds.push(eq(conversations.providerId, providerProfile.id));

  const rows = await db
    .select({
      conversation: conversations,
      provider: publicProviderColumns,
      customer: publicCustomerColumns,
    })
    .from(conversations)
    .innerJoin(providerProfiles, eq(conversations.providerId, providerProfiles.id))
    .innerJoin(users, eq(conversations.customerId, users.id))
    .where(or(...conds))
    .orderBy(desc(conversations.lastMessageAt));

  const result = [];
  for (const row of rows) {
    const lastMsgRows = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, row.conversation.id))
      .orderBy(desc(messages.createdAt))
      .limit(1);
    const unreadRows = await db
      .select({ cnt: sql<number>`count(*)` })
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, row.conversation.id),
          eq(messages.isRead, false),
          ne(messages.senderId, userId),
        ),
      );
    result.push({
      ...row,
      lastMessage: lastMsgRows[0] ?? null,
      unreadCount: Number(unreadRows[0]?.cnt ?? 0),
    });
  }
  return result;
}

export async function getConversationById(id: number) {
  const db = await requireDb();
  const rows = await db.select().from(conversations).where(eq(conversations.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function listMessages(conversationId: number, limit = 100) {
  const db = await requireDb();
  return db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(messages.createdAt)
    .limit(limit);
}

export async function createMessage(params: {
  conversationId: number;
  senderId: number;
  content: string;
  attachmentUrl?: string | null;
}) {
  const db = await requireDb();
  const [inserted] = await db
    .insert(messages)
    .values({
      conversationId: params.conversationId,
      senderId: params.senderId,
      content: params.content,
      attachmentUrl: params.attachmentUrl ?? null,
    })
    .returning({ id: messages.id });
  await db
    .update(conversations)
    .set({ lastMessageAt: new Date() })
    .where(eq(conversations.id, params.conversationId));
  return inserted?.id ?? 0;
}

export async function markMessagesRead(conversationId: number, readerId: number) {
  const db = await requireDb();
  await db
    .update(messages)
    .set({ isRead: true })
    .where(
      and(
        eq(messages.conversationId, conversationId),
        ne(messages.senderId, readerId),
        eq(messages.isRead, false),
      ),
    );
}

/* ----------------------------- Booking extras ------------------------------ */

export async function rescheduleBooking(params: {
  bookingId: number;
  customerId: number;
  scheduledDate: string;
  scheduledTime: string;
}) {
  const db = await requireDb();
  const booking = await getBookingById(params.bookingId);
  if (!booking || booking.booking.customerId !== params.customerId) return null;
  if (!["pending", "confirmed"].includes(booking.booking.status)) return null;

  await db
    .update(bookings)
    .set({
      scheduledDate: params.scheduledDate,
      scheduledTime: params.scheduledTime,
      status: "pending",
    })
    .where(eq(bookings.id, params.bookingId));
  await db.insert(bookingStatusHistory).values({
    bookingId: params.bookingId,
    fromStatus: booking.booking.status,
    toStatus: "pending",
    changedByUserId: params.customerId,
    note: `Rescheduled to ${params.scheduledDate} ${params.scheduledTime}`,
  });
  return getBookingById(params.bookingId);
}

/* ------------------------------ Account extras ----------------------------- */

export async function deleteUserAccount(userId: number) {
  const db = await requireDb();
  await db
    .update(users)
    .set({
      name: "Deleted User",
      email: null,
      phone: null,
      avatarUrl: null,
    })
    .where(eq(users.id, userId));
}

/* ------------------------------ Notifications ----------------------------- */

/** Only these 4 types have a dedicated preference toggle (see notificationPreferences
 *  in schema.ts) — payment/review/system notifications are gated by pushEnabled alone. */
const NOTIFICATION_TYPE_TO_PREF: Partial<Record<InsertNotification["type"], keyof NotificationPreference>> = {
  booking_update: "bookingUpdates",
  message: "messages",
  promotion: "promotions",
  service_reminder: "serviceReminders",
  new_booking_request: "newBookingRequests",
};

/**
 * Best-effort push delivery for a notification that was just written to the DB.
 * Never awaited by its caller (createNotification) — a push send is a real network
 * call to Expo's API with no benefit to making the triggering mutation (booking
 * update, message send, etc.) wait on it. Mirrors the lesson learned from the
 * booking-update Realtime broadcast: fire-and-forget, errors swallowed internally.
 */
async function pushForNotification(data: InsertNotification): Promise<void> {
  try {
    const prefs = await getNotificationPreferences(data.userId);
    if (!prefs.pushEnabled) return;
    const specificKey = NOTIFICATION_TYPE_TO_PREF[data.type];
    if (specificKey && !prefs[specificKey]) return;

    const tokens = await listDevicePushTokensForUser(data.userId);
    if (!tokens.length) return;

    const { deadTokens } = await sendExpoPushNotifications(
      tokens.map((token) => ({
        to: token,
        title: data.title,
        body: data.body ?? "",
        data: (data.data as Record<string, unknown>) ?? {},
      })),
    );
    if (deadTokens.length) await removeDevicePushTokens(deadTokens);
  } catch (err) {
    console.error("[push] failed to deliver push for a notification:", err);
  }
}

export async function createNotification(data: InsertNotification) {
  const db = await requireDb();
  const [inserted] = await db.insert(notifications).values(data).returning({ id: notifications.id });
  void pushForNotification(data);
  return inserted?.id ?? 0;
}

/** Upserts by token: the same physical device re-registering (app reopen, or a new
 *  account logging into a device that previously belonged to someone else) reassigns
 *  ownership rather than accumulating stale duplicate rows. */
export async function registerDevicePushToken(params: {
  userId: number;
  token: string;
  platform: "ios" | "android" | "web";
}) {
  const db = await requireDb();
  await db
    .insert(devicePushTokens)
    .values({ userId: params.userId, expoPushToken: params.token, platform: params.platform })
    .onConflictDoUpdate({
      target: devicePushTokens.expoPushToken,
      set: { userId: params.userId, platform: params.platform, lastSeenAt: new Date() },
    });
}

export async function unregisterDevicePushToken(token: string) {
  const db = await requireDb();
  await db.delete(devicePushTokens).where(eq(devicePushTokens.expoPushToken, token));
}

async function listDevicePushTokensForUser(userId: number): Promise<string[]> {
  const db = await requireDb();
  const rows = await db
    .select({ token: devicePushTokens.expoPushToken })
    .from(devicePushTokens)
    .where(eq(devicePushTokens.userId, userId));
  return rows.map((r) => r.token);
}

async function removeDevicePushTokens(tokens: string[]) {
  if (!tokens.length) return;
  const db = await requireDb();
  await db.delete(devicePushTokens).where(inArray(devicePushTokens.expoPushToken, tokens));
}

export async function listNotifications(userId: number, limit = 50) {
  const db = await requireDb();
  return db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
}

export async function markNotificationRead(userId: number, notificationId: number) {
  const db = await requireDb();
  await db
    .update(notifications)
    .set({ isRead: true })
    .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId)));
}

export async function markAllNotificationsRead(userId: number) {
  const db = await requireDb();
  await db.update(notifications).set({ isRead: true }).where(eq(notifications.userId, userId));
}

export async function getNotificationPreferences(userId: number) {
  const db = await requireDb();
  const rows = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId))
    .limit(1);
  if (rows[0]) return rows[0];
  await db.insert(notificationPreferences).values({ userId });
  const created = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId))
    .limit(1);
  return created[0];
}

export async function updateNotificationPreferences(
  userId: number,
  data: Partial<{
    pushEnabled: boolean;
    emailEnabled: boolean;
    smsEnabled: boolean;
    bookingUpdates: boolean;
    messages: boolean;
    promotions: boolean;
    serviceReminders: boolean;
    newBookingRequests: boolean;
  }>,
) {
  const db = await requireDb();
  await getNotificationPreferences(userId); // ensure row exists
  await db.update(notificationPreferences).set(data).where(eq(notificationPreferences.userId, userId));
}

/* ------------------------------ Wallets & Money --------------------------- */

export async function getOrCreateWallet(userId: number) {
  const db = await requireDb();
  const rows = await db.select().from(wallets).where(eq(wallets.userId, userId)).limit(1);
  if (rows[0]) return rows[0];
  await db.insert(wallets).values({ userId });
  const created = await db.select().from(wallets).where(eq(wallets.userId, userId)).limit(1);
  return created[0];
}

/** Record a wallet ledger entry and update balance atomically. */
export async function recordTransaction(params: {
  userId: number;
  type: "credit" | "debit";
  category:
    | "booking_payment"
    | "booking_earning"
    | "commission"
    | "withdrawal"
    | "refund"
    | "topup"
    | "adjustment";
  amount: number;
  bookingId?: number;
  paymentId?: number;
  description?: string;
}) {
  const db = await requireDb();
  const wallet = await getOrCreateWallet(params.userId);
  const current = Number(wallet.balance);
  const delta = params.type === "credit" ? params.amount : -params.amount;
  const newBalance = current + delta;
  if (newBalance < 0) throw new Error("Insufficient wallet balance");

  await db.update(wallets).set({ balance: newBalance.toFixed(2) }).where(eq(wallets.id, wallet.id));
  await db.insert(transactions).values({
    walletId: wallet.id,
    type: params.type,
    category: params.category,
    amount: params.amount.toFixed(2),
    balanceAfter: newBalance.toFixed(2),
    bookingId: params.bookingId,
    paymentId: params.paymentId,
    description: params.description,
  });
  return { balance: newBalance.toFixed(2) };
}

export async function listTransactions(userId: number, limit = 50) {
  const db = await requireDb();
  const wallet = await getOrCreateWallet(userId);
  return db
    .select()
    .from(transactions)
    .where(eq(transactions.walletId, wallet.id))
    .orderBy(desc(transactions.createdAt))
    .limit(limit);
}

export async function createPayment(params: {
  bookingId?: number;
  userId: number;
  amount: number;
  method?: "card" | "bank_transfer" | "wallet";
  gatewayReference?: string;
}) {
  const db = await requireDb();
  const [inserted] = await db
    .insert(payments)
    .values({
      bookingId: params.bookingId,
      userId: params.userId,
      amount: params.amount.toFixed(2),
      method: params.method ?? "card",
      gatewayReference: params.gatewayReference,
    })
    .returning({ id: payments.id });
  return inserted?.id ?? 0;
}

export async function updatePaymentStatus(
  paymentId: number,
  status: "pending" | "successful" | "failed" | "refunded",
  gatewayReference?: string,
) {
  const db = await requireDb();
  await db.update(payments).set({ status, gatewayReference }).where(eq(payments.id, paymentId));
}

/* --------------------------------- Coupons -------------------------------- */

export async function validateCoupon(code: string, orderAmount: number) {
  const db = await requireDb();
  const rows = await db.select().from(coupons).where(eq(coupons.code, code.toUpperCase())).limit(1);
  const coupon = rows[0];
  if (!coupon || !coupon.isActive) return { valid: false as const, reason: "Invalid coupon code" };
  const now = new Date();
  if (coupon.startsAt && coupon.startsAt > now) return { valid: false as const, reason: "Coupon not yet active" };
  if (coupon.expiresAt && coupon.expiresAt < now) return { valid: false as const, reason: "Coupon has expired" };
  if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses)
    return { valid: false as const, reason: "Coupon usage limit reached" };
  if (orderAmount < Number(coupon.minOrderAmount))
    return { valid: false as const, reason: `Minimum order is ₦${Number(coupon.minOrderAmount).toLocaleString()}` };

  const discount =
    coupon.discountType === "percentage"
      ? (orderAmount * Number(coupon.discountValue)) / 100
      : Number(coupon.discountValue);
  return { valid: true as const, coupon, discount: Math.min(discount, orderAmount) };
}

export async function incrementCouponUse(couponId: number) {
  const db = await requireDb();
  await db
    .update(coupons)
    .set({ usedCount: sql`${coupons.usedCount} + 1` })
    .where(eq(coupons.id, couponId));
}

/* ----------------------------- Support Tickets ---------------------------- */

export async function createSupportTicket(params: {
  userId: number;
  subject: string;
  description: string;
  category?: "booking" | "payment" | "account" | "provider" | "other";
}) {
  const db = await requireDb();
  const [inserted] = await db.insert(supportTickets).values(params).returning({ id: supportTickets.id });
  return inserted?.id ?? 0;
}

export async function listSupportTickets(userId: number) {
  const db = await requireDb();
  return db
    .select()
    .from(supportTickets)
    .where(eq(supportTickets.userId, userId))
    .orderBy(desc(supportTickets.createdAt));
}

/* -------------------------------- Audit Log -------------------------------- */

export async function logAudit(params: {
  userId?: number;
  action: string;
  entityType?: string;
  entityId?: number;
  detail?: unknown;
  ipAddress?: string;
}) {
  try {
    const db = await requireDb();
    await db.insert(auditLogs).values({
      userId: params.userId,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      detail: params.detail as object,
      ipAddress: params.ipAddress,
    });
  } catch (error) {
    // Audit logging must never break the main flow.
    console.warn("[Audit] Failed to write audit log:", error);
  }
}

/* -------------------------------- Portfolio ------------------------------- */

export async function createPortfolioItem(data: InsertPortfolioItem) {
  const db = await requireDb();
  const [inserted] = await db.insert(portfolioItems).values(data).returning({ id: portfolioItems.id });
  return inserted?.id ?? 0;
}

export async function listPortfolioItems(providerId: number) {
  const db = await requireDb();
  return db
    .select({
      id: portfolioItems.id,
      providerId: portfolioItems.providerId,
      categoryId: portfolioItems.categoryId,
      title: portfolioItems.title,
      description: portfolioItems.description,
      images: portfolioItems.images,
      createdAt: portfolioItems.createdAt,
      categoryName: categories.name,
    })
    .from(portfolioItems)
    .leftJoin(categories, eq(portfolioItems.categoryId, categories.id))
    .where(eq(portfolioItems.providerId, providerId))
    .orderBy(desc(portfolioItems.createdAt));
}

export async function deletePortfolioItem(itemId: number, providerId: number) {
  const db = await requireDb();
  const result = await db
    .delete(portfolioItems)
    .where(and(eq(portfolioItems.id, itemId), eq(portfolioItems.providerId, providerId)));
  return (result.rowCount ?? 0) > 0;
}

/* --------------------------------- Negotiations ---------------------------- */

export function generateNegotiationReference(date = new Date()) {
  const ymd = date.toISOString().slice(0, 10).replace(/-/g, "");
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `NEG-${ymd}-${suffix}`;
}

/** Expire pending offers whose validity window has passed (lazy, on read/write). */
async function expireStaleOffers(negotiationId: number) {
  const db = await requireDb();
  await db
    .update(negotiationOffers)
    .set({ status: "expired" })
    .where(
      and(
        eq(negotiationOffers.quoteRequestId, negotiationId),
        eq(negotiationOffers.status, "pending"),
        sql`${negotiationOffers.expiresAt} IS NOT NULL AND ${negotiationOffers.expiresAt} < NOW()`,
      ),
    );
  // If the negotiation is active but has no pending offers and had at least
  // one expired offer, keep status as-is (either party can still make a new offer).
}

/**
 * Start a price negotiation: the customer's offer amount is the opening move,
 * created atomically with the negotiation itself (an offer is never optional —
 * this is "make an offer on a price," not "request a quote").
 */
export async function createNegotiation(params: {
  customerId: number;
  providerId: number;
  serviceId: number;
  offerAmount: number;
  message?: string;
  photos?: string[];
  preferredDate?: string;
  preferredTime?: string;
  addressId?: number;
}) {
  const db = await requireDb();
  const reference = generateNegotiationReference();
  const [inserted] = await db
    .insert(negotiations)
    .values({
      reference,
      customerId: params.customerId,
      providerId: params.providerId,
      serviceId: params.serviceId,
      photos: params.photos ?? [],
      suggestedBudget: params.offerAmount.toFixed(2),
      preferredDate: params.preferredDate,
      preferredTime: params.preferredTime,
      addressId: params.addressId,
      status: "negotiating",
    })
    .returning({ id: negotiations.id });
  const id = inserted?.id ?? 0;

  await db.insert(negotiationOffers).values({
    quoteRequestId: id,
    byRole: "customer",
    byUserId: params.customerId,
    amount: params.offerAmount.toFixed(2),
    note: params.message,
    status: "pending",
  });

  // Notify the provider of the new offer.
  const profile = await getProviderProfileById(params.providerId);
  if (profile) {
    await createNotification({
      userId: profile.userId,
      type: "booking_update",
      title: "New price offer",
      body: `A customer offered ₦${params.offerAmount.toLocaleString()} on your service. Respond to win the job.`,
      data: { negotiationId: id },
    });
  }
  return { id, reference };
}

export async function getNegotiationById(id: number) {
  const db = await requireDb();
  await expireStaleOffers(id);
  const rows = await db
    .select({
      negotiation: negotiations,
      serviceTitle: services.title,
      serviceImage: services.imageUrl,
      serviceBasePrice: services.basePrice,
      customerName: users.name,
      customerAvatar: users.avatarUrl,
      providerBusinessName: providerProfiles.businessName,
      providerUserId: providerProfiles.userId,
    })
    .from(negotiations)
    .leftJoin(services, eq(negotiations.serviceId, services.id))
    .leftJoin(users, eq(negotiations.customerId, users.id))
    .leftJoin(providerProfiles, eq(negotiations.providerId, providerProfiles.id))
    .where(eq(negotiations.id, id))
    .limit(1);
  if (!rows[0]) return null;
  const offers = await db
    .select()
    .from(negotiationOffers)
    .where(eq(negotiationOffers.quoteRequestId, id))
    .orderBy(negotiationOffers.createdAt);
  return { ...rows[0], offers };
}

export async function listNegotiationsForCustomer(customerId: number) {
  const db = await requireDb();
  return db
    .select({
      negotiation: negotiations,
      serviceTitle: services.title,
      providerBusinessName: providerProfiles.businessName,
    })
    .from(negotiations)
    .leftJoin(services, eq(negotiations.serviceId, services.id))
    .leftJoin(providerProfiles, eq(negotiations.providerId, providerProfiles.id))
    .where(eq(negotiations.customerId, customerId))
    .orderBy(desc(negotiations.updatedAt));
}

export async function listNegotiationsForProvider(providerId: number) {
  const db = await requireDb();
  return db
    .select({
      negotiation: negotiations,
      serviceTitle: services.title,
      customerName: users.name,
    })
    .from(negotiations)
    .leftJoin(services, eq(negotiations.serviceId, services.id))
    .leftJoin(users, eq(negotiations.customerId, users.id))
    .where(eq(negotiations.providerId, providerId))
    .orderBy(desc(negotiations.updatedAt));
}

/**
 * Make a counter-offer within an active negotiation.
 * Marks the previous pending offer as countered and notifies the other party.
 */
export async function addNegotiationOffer(params: {
  negotiationId: number;
  byRole: "customer" | "provider";
  byUserId: number;
  amount: number;
  note?: string;
  expiresInHours?: number;
}) {
  const db = await requireDb();
  await expireStaleOffers(params.negotiationId);

  const rows = await db.select().from(negotiations).where(eq(negotiations.id, params.negotiationId)).limit(1);
  const negotiation = rows[0];
  if (!negotiation) throw new Error("Negotiation not found");
  if (negotiation.status !== "open" && negotiation.status !== "negotiating") {
    throw new Error(`This negotiation is ${negotiation.status} and can no longer be negotiated`);
  }

  // Supersede the current pending offer (if any).
  await db
    .update(negotiationOffers)
    .set({ status: "countered" })
    .where(and(eq(negotiationOffers.quoteRequestId, params.negotiationId), eq(negotiationOffers.status, "pending")));

  const expiresAt =
    params.expiresInHours != null ? new Date(Date.now() + params.expiresInHours * 3_600_000) : null;

  const [inserted] = await db
    .insert(negotiationOffers)
    .values({
      quoteRequestId: params.negotiationId,
      byRole: params.byRole,
      byUserId: params.byUserId,
      amount: params.amount.toFixed(2),
      note: params.note,
      expiresAt,
      status: "pending",
    })
    .returning({ id: negotiationOffers.id });
  const offerId = inserted?.id ?? 0;

  await db
    .update(negotiations)
    .set({ status: "negotiating" })
    .where(eq(negotiations.id, params.negotiationId));

  // Notify the other party.
  const profile = await getProviderProfileById(negotiation.providerId);
  const recipientUserId = params.byRole === "provider" ? negotiation.customerId : profile?.userId;
  if (recipientUserId) {
    await createNotification({
      userId: recipientUserId,
      type: "booking_update",
      title: params.byRole === "provider" ? "Provider countered your offer" : "Customer countered your offer",
      body: `New offer: ₦${params.amount.toLocaleString()}. Open the negotiation to respond.`,
      data: { negotiationId: params.negotiationId },
    });
  }

  return { offerId };
}

/**
 * Accept the other party's pending offer: locks the agreed price and creates a
 * booking at that price (subtotal = total = agreedPrice, no coupon).
 */
export async function acceptNegotiationOffer(params: {
  negotiationId: number;
  acceptedByRole: "customer" | "provider";
  acceptedByUserId: number;
}) {
  const db = await requireDb();
  await expireStaleOffers(params.negotiationId);

  const rows = await db.select().from(negotiations).where(eq(negotiations.id, params.negotiationId)).limit(1);
  const negotiation = rows[0];
  if (!negotiation) throw new Error("Negotiation not found");
  if (negotiation.status !== "open" && negotiation.status !== "negotiating") {
    throw new Error(`This negotiation is ${negotiation.status} and can no longer be accepted`);
  }

  const pendingRows = await db
    .select()
    .from(negotiationOffers)
    .where(and(eq(negotiationOffers.quoteRequestId, params.negotiationId), eq(negotiationOffers.status, "pending")))
    .orderBy(desc(negotiationOffers.createdAt))
    .limit(1);
  const pending = pendingRows[0];
  if (!pending) throw new Error("There is no pending offer to accept");
  if (pending.byRole === params.acceptedByRole) {
    throw new Error("You cannot accept your own offer — wait for the other party to respond");
  }

  const agreedPrice = Number(pending.amount);

  // Create the booking at the agreed price.
  const scheduledDate = negotiation.preferredDate ?? new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const scheduledTime = negotiation.preferredTime ?? "09:00";
  const bookingResult = await createBooking({
    customerId: negotiation.customerId,
    providerId: negotiation.providerId,
    serviceId: negotiation.serviceId,
    addressId: negotiation.addressId ?? undefined,
    status: "confirmed",
    scheduledDate,
    scheduledTime,
    notes: `Booked via negotiated offer ${negotiation.reference}.`,
    subtotal: agreedPrice.toFixed(2),
    discount: "0.00",
    total: agreedPrice.toFixed(2),
  });

  await db.update(negotiationOffers).set({ status: "accepted" }).where(eq(negotiationOffers.id, pending.id));
  await db
    .update(negotiations)
    .set({ status: "accepted", agreedPrice: agreedPrice.toFixed(2), bookingId: bookingResult.id })
    .where(eq(negotiations.id, params.negotiationId));

  // Notify both parties.
  const profile = await getProviderProfileById(negotiation.providerId);
  const notifyIds = [negotiation.customerId, profile?.userId].filter(
    (uid): uid is number => uid != null && uid !== params.acceptedByUserId,
  );
  for (const uid of notifyIds) {
    await createNotification({
      userId: uid,
      type: "booking_update",
      title: "Offer accepted — booking confirmed",
      body: `Price locked at ₦${agreedPrice.toLocaleString()}. Booking ${bookingResult.reference} is confirmed.`,
      data: { negotiationId: params.negotiationId, bookingId: bookingResult.id },
    });
  }

  return { agreedPrice, bookingId: bookingResult.id, bookingReference: bookingResult.reference };
}

/** Reject (provider) or withdraw (customer) an active negotiation. */
export async function closeNegotiation(params: {
  negotiationId: number;
  byRole: "customer" | "provider";
  byUserId: number;
  reason?: string;
}) {
  const db = await requireDb();
  const rows = await db.select().from(negotiations).where(eq(negotiations.id, params.negotiationId)).limit(1);
  const negotiation = rows[0];
  if (!negotiation) throw new Error("Negotiation not found");
  if (negotiation.status !== "open" && negotiation.status !== "negotiating") {
    throw new Error(`This negotiation is already ${negotiation.status}`);
  }

  const newStatus = params.byRole === "provider" ? "rejected" : "cancelled";
  await db.update(negotiations).set({ status: newStatus }).where(eq(negotiations.id, params.negotiationId));
  await db
    .update(negotiationOffers)
    .set({ status: "rejected" })
    .where(and(eq(negotiationOffers.quoteRequestId, params.negotiationId), eq(negotiationOffers.status, "pending")));

  const profile = await getProviderProfileById(negotiation.providerId);
  const recipientUserId = params.byRole === "provider" ? negotiation.customerId : profile?.userId;
  if (recipientUserId) {
    await createNotification({
      userId: recipientUserId,
      type: "booking_update",
      title: params.byRole === "provider" ? "Offer rejected" : "Offer withdrawn",
      body: params.reason ?? "The negotiation has been closed.",
      data: { negotiationId: params.negotiationId },
    });
  }

  return { status: newStatus };
}

/* ------------------------- Commission transparency ------------------------ */

/**
 * Commission breakdown for a booking: gross, platform commission at the
 * provider's rate, and net provider earning.
 */
export async function getBookingCommissionBreakdown(bookingId: number) {
  const db = await requireDb();
  const rows = await db
    .select({ booking: bookings, profile: providerProfiles })
    .from(bookings)
    .innerJoin(providerProfiles, eq(bookings.providerId, providerProfiles.id))
    .where(eq(bookings.id, bookingId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const total = Number(row.booking.total);
  const platformFee = Number(row.booking.platformFee);
  const serviceAmount = total - platformFee;
  const rate = Number(row.profile.commissionRate);
  const commission = Math.round(serviceAmount * (rate / 100) * 100) / 100;
  const providerEarning = Math.round((serviceAmount - commission) * 100) / 100;
  return {
    subtotal: Number(row.booking.subtotal),
    discount: Number(row.booking.discount),
    platformFee,
    total,
    commissionRate: rate,
    commission,
    providerEarning,
    paymentStatus: row.booking.paymentStatus,
  };
}

/* ------------------------- Admin verification tools ------------------------ */

export async function listProvidersByVerificationStatus(
  status: "unverified" | "pending" | "verified" | "rejected",
) {
  const db = await requireDb();

  // One representative category per provider (their earliest active service's
  // category) — same "profession label" pattern used for featured providers.
  // A provider can apply before adding any service, so this may be null.
  const primaryCategory = db
    .selectDistinctOn([services.providerId], {
      providerId: services.providerId,
      categoryName: categories.name,
    })
    .from(services)
    .innerJoin(categories, eq(services.categoryId, categories.id))
    .orderBy(services.providerId, services.id)
    .as("pc");

  return db
    .select({
      profile: providerProfiles,
      user: users,
      category: primaryCategory.categoryName,
    })
    .from(providerProfiles)
    .innerJoin(users, eq(providerProfiles.userId, users.id))
    .leftJoin(primaryCategory, eq(primaryCategory.providerId, providerProfiles.id))
    .where(eq(providerProfiles.verificationStatus, status))
    .orderBy(desc(providerProfiles.updatedAt));
}

/** Admin: message a provider for more info without changing their verification status. */
export async function requestProviderVerificationInfo(params: { providerId: number; message: string }) {
  const db = await requireDb();
  const profile = await getProviderProfileById(params.providerId);
  if (!profile) throw new Error("Provider not found");

  await createNotification({
    userId: profile.userId,
    type: "system",
    title: "More information needed",
    body: params.message,
    data: { providerId: params.providerId },
  });

  return { success: true } as const;
}

/** Platform-wide counts for the admin dashboard summary cards. */
export async function getAdminStats() {
  const db = await requireDb();
  const [customerRows, providerRows, pendingRows, verifiedRows, bookingRows] = await Promise.all([
    db.select({ cnt: sql<number>`count(*)` }).from(users).where(eq(users.appRole, "customer")),
    db.select({ cnt: sql<number>`count(*)` }).from(providerProfiles),
    db.select({ cnt: sql<number>`count(*)` }).from(providerProfiles).where(eq(providerProfiles.verificationStatus, "pending")),
    db.select({ cnt: sql<number>`count(*)` }).from(providerProfiles).where(eq(providerProfiles.verificationStatus, "verified")),
    db.select({ cnt: sql<number>`count(*)` }).from(bookings),
  ]);

  return {
    totalCustomers: Number(customerRows[0]?.cnt ?? 0),
    totalProviders: Number(providerRows[0]?.cnt ?? 0),
    pendingApplications: Number(pendingRows[0]?.cnt ?? 0),
    approvedProviders: Number(verifiedRows[0]?.cnt ?? 0),
    totalBookings: Number(bookingRows[0]?.cnt ?? 0),
  };
}

/* ============================== Admin: RBAC ============================== */

export type AdminRole = (typeof ADMIN_ROLES)[number];

/** Which roles grant access to a resource, beyond `super_admin` (always allowed —
 *  checked separately so a newly-added resource can't accidentally omit it). */
const RESOURCE_ROLES: Record<string, AdminRole[]> = {
  users: ["operations_admin", "support_admin"],
  providers: ["operations_admin", "support_admin"],
  bookings: ["operations_admin", "support_admin"],
  disputes: ["operations_admin", "support_admin"],
  finance: ["finance_admin"],
  categories: ["content_admin"],
  // audit_logs / admin_management / users.permanent_delete: super_admin only,
  // intentionally not listed here.
};

export async function getAdminRoles(userId: number): Promise<AdminRole[]> {
  const db = await requireDb();
  const rows = await db.select({ role: adminRoleAssignments.role }).from(adminRoleAssignments).where(eq(adminRoleAssignments.userId, userId));
  return rows.map((r) => r.role);
}

export async function hasAdminPermission(userId: number, resource: string): Promise<boolean> {
  const roles = await getAdminRoles(userId);
  if (roles.includes("super_admin")) return true;
  return (RESOURCE_ROLES[resource] ?? []).some((r) => roles.includes(r));
}

/** All accounts with dashboard access (`role === "admin"`), with their assigned roles. */
export async function listAdminUsers() {
  const db = await requireDb();
  const [admins, assignments] = await Promise.all([
    db.select().from(users).where(eq(users.role, "admin")).orderBy(desc(users.createdAt)),
    db.select().from(adminRoleAssignments),
  ]);
  const rolesByUser = new Map<number, AdminRole[]>();
  for (const a of assignments) {
    if (!rolesByUser.has(a.userId)) rolesByUser.set(a.userId, []);
    rolesByUser.get(a.userId)!.push(a.role);
  }
  return admins.map((u) => ({ ...u, roles: rolesByUser.get(u.id) ?? [] }));
}

/** Grants a role — also flips the account to `role: "admin"` if it wasn't already,
 *  since holding a role with no dashboard access would be meaningless. */
export async function assignAdminRole(params: { targetUserId: number; role: AdminRole; assignedByUserId: number }) {
  const db = await requireDb();
  await db.update(users).set({ role: "admin" }).where(eq(users.id, params.targetUserId));
  await db
    .insert(adminRoleAssignments)
    .values({ userId: params.targetUserId, role: params.role, assignedByUserId: params.assignedByUserId })
    .onConflictDoNothing();
}

/** Removes one role. Doesn't revoke dashboard access by itself — an admin can hold
 *  zero specific-resource roles and still sign in (just see nothing but the
 *  dashboard shell); see setAdminAccountActive for actually revoking access. */
export async function removeAdminRole(params: { targetUserId: number; role: AdminRole }) {
  const db = await requireDb();
  await db
    .delete(adminRoleAssignments)
    .where(and(eq(adminRoleAssignments.userId, params.targetUserId), eq(adminRoleAssignments.role, params.role)));
}

/** Fully revokes (or restores) admin dashboard access. Revoking also clears every
 *  role assignment — reinstating later starts from a clean slate, not stale roles. */
export async function setAdminAccountActive(params: { targetUserId: number; active: boolean }) {
  const db = await requireDb();
  await db.update(users).set({ role: params.active ? "admin" : "user" }).where(eq(users.id, params.targetUserId));
  if (!params.active) {
    await db.delete(adminRoleAssignments).where(eq(adminRoleAssignments.userId, params.targetUserId));
  }
}

export async function findUserByEmail(email: string) {
  const db = await requireDb();
  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return rows[0] ?? null;
}

/* ============================ Admin: Audit Logs ============================ */

export async function listAuditLogs(params: {
  action?: string;
  entityType?: string;
  userId?: number;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}) {
  const db = await requireDb();
  const conditions = [
    params.action ? like(auditLogs.action, `${params.action}%`) : undefined,
    params.entityType ? eq(auditLogs.entityType, params.entityType) : undefined,
    params.userId ? eq(auditLogs.userId, params.userId) : undefined,
    params.from ? gte(auditLogs.createdAt, params.from) : undefined,
    params.to ? lte(auditLogs.createdAt, params.to) : undefined,
  ].filter((c): c is NonNullable<typeof c> => !!c);
  const where = conditions.length ? and(...conditions) : undefined;

  const [rows, countRows] = await Promise.all([
    db
      .select({ log: auditLogs, actorName: users.name, actorEmail: users.email })
      .from(auditLogs)
      .leftJoin(users, eq(auditLogs.userId, users.id))
      .where(where)
      .orderBy(desc(auditLogs.createdAt))
      .limit(params.limit ?? 50)
      .offset(params.offset ?? 0),
    db.select({ cnt: sql<number>`count(*)` }).from(auditLogs).where(where),
  ]);
  return { rows, total: Number(countRows[0]?.cnt ?? 0) };
}

export async function listDistinctAuditActions(): Promise<string[]> {
  const db = await requireDb();
  const rows = await db.selectDistinct({ action: auditLogs.action }).from(auditLogs).orderBy(auditLogs.action);
  return rows.map((r) => r.action);
}

/* =========================== Admin: User management ========================= */

export async function listUsersAdmin(params: {
  search?: string;
  status?: "active" | "suspended" | "deactivated" | "deleted";
  appRole?: "customer" | "provider" | "admin";
  limit?: number;
  offset?: number;
}) {
  const db = await requireDb();
  const conditions = [
    params.search
      ? or(
          like(users.name, `%${params.search}%`),
          like(users.email, `%${params.search}%`),
          like(users.phone, `%${params.search}%`),
        )
      : undefined,
    params.status ? eq(users.status, params.status) : undefined,
    params.appRole ? eq(users.appRole, params.appRole) : undefined,
  ].filter((c): c is NonNullable<typeof c> => !!c);
  const where = conditions.length ? and(...conditions) : undefined;

  const [rows, countRows] = await Promise.all([
    db.select().from(users).where(where).orderBy(desc(users.createdAt)).limit(params.limit ?? 50).offset(params.offset ?? 0),
    db.select({ cnt: sql<number>`count(*)` }).from(users).where(where),
  ]);
  return { rows, total: Number(countRows[0]?.cnt ?? 0) };
}

/** Full profile for the admin User Detail view: bookings, transactions, reviews,
 *  support tickets, and provider profile if they have one — everything the spec
 *  asks a single user's page to show, from tables that already exist. */
export async function getUserDetailAdmin(userId: number) {
  const db = await requireDb();
  const userRows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const user = userRows[0];
  if (!user) return null;

  const [bookingsAsCustomer, reviewsWritten, walletRow, tickets, providerProfileRow] = await Promise.all([
    db
      .select({ booking: bookings, service: services })
      .from(bookings)
      .innerJoin(services, eq(bookings.serviceId, services.id))
      .where(eq(bookings.customerId, userId))
      .orderBy(desc(bookings.createdAt))
      .limit(25),
    db.select().from(reviews).where(eq(reviews.customerId, userId)).orderBy(desc(reviews.createdAt)).limit(25),
    db.select().from(wallets).where(eq(wallets.userId, userId)).limit(1),
    db.select().from(supportTickets).where(eq(supportTickets.userId, userId)).orderBy(desc(supportTickets.createdAt)),
    db.select().from(providerProfiles).where(eq(providerProfiles.userId, userId)).limit(1),
  ]);

  const walletTransactions = walletRow[0]
    ? await db
        .select()
        .from(transactions)
        .where(eq(transactions.walletId, walletRow[0].id))
        .orderBy(desc(transactions.createdAt))
        .limit(30)
    : [];

  return {
    user,
    bookings: bookingsAsCustomer,
    reviews: reviewsWritten,
    wallet: walletRow[0] ?? null,
    transactions: walletTransactions,
    supportTickets: tickets,
    providerProfile: providerProfileRow[0] ?? null,
  };
}

/** The one real lever admin "suspend/deactivate/reactivate" has: enforced at the
 *  auth layer (see server/_core/sdk.ts), not just a status label. */
export async function setUserStatusAdmin(params: { userId: number; status: "active" | "suspended" | "deactivated" }) {
  const db = await requireDb();
  await db.update(users).set({ status: params.status }).where(eq(users.id, params.userId));
}

const NON_TERMINAL_BOOKING_STATUSES = ["pending", "confirmed", "in_progress"] as const;

/** Pre-delete summary for the admin confirmation screen — also doubles as the
 *  guard-check data source for permanentlyDeleteUser itself, so the UI and the
 *  enforcement can never disagree about what would block a delete. */
export async function getUserDeletionPreview(userId: number) {
  const db = await requireDb();
  const [bookingRows, activeBookingRows, reviewRows, walletRow, providerRow] = await Promise.all([
    db.select({ cnt: sql<number>`count(*)` }).from(bookings).where(eq(bookings.customerId, userId)),
    db
      .select({ cnt: sql<number>`count(*)` })
      .from(bookings)
      .where(and(eq(bookings.customerId, userId), inArray(bookings.status, NON_TERMINAL_BOOKING_STATUSES))),
    db.select({ cnt: sql<number>`count(*)` }).from(reviews).where(eq(reviews.customerId, userId)),
    db.select().from(wallets).where(eq(wallets.userId, userId)).limit(1),
    db.select({ id: providerProfiles.id }).from(providerProfiles).where(eq(providerProfiles.userId, userId)).limit(1),
  ]);

  const walletBalance = Number(walletRow[0]?.balance ?? 0);
  const hasProviderProfile = !!providerRow[0];
  const activeBookings = Number(activeBookingRows[0]?.cnt ?? 0);

  const blockedReasons: string[] = [];
  if (hasProviderProfile) blockedReasons.push("This account has a provider profile — permanent delete isn't supported for provider accounts yet.");
  if (walletBalance !== 0) blockedReasons.push(`Wallet balance is ₦${walletBalance.toLocaleString()}, not zero — resolve it first.`);
  if (activeBookings > 0) blockedReasons.push(`${activeBookings} booking${activeBookings === 1 ? " is" : "s are"} still pending/confirmed/in progress.`);

  return {
    totalBookings: Number(bookingRows[0]?.cnt ?? 0),
    activeBookings,
    totalReviews: Number(reviewRows[0]?.cnt ?? 0),
    walletBalance,
    hasProviderProfile,
    canDelete: blockedReasons.length === 0,
    blockedReasons,
  };
}

export type DeleteUserResult =
  | { success: true; snapshot: { email: string | null; name: string | null; appRole: string } }
  | { success: false; reason: "not_found" | "blocked"; blockedReasons?: string[] };

/**
 * Irreversible PII purge, not a row-deletion cascade — see the accompanying admin
 * feature discussion: with zero FK constraints in this schema, and bookings/
 * reviews/transactions being records other parties (providers, financial
 * reporting) legitimately still need, the safe design is to scrub the `users` row
 * and anything purely personal to them, while leaving shared/historical records
 * (bookings, reviews, payments, transactions, messages, support tickets) fully
 * intact — they just resolve to an anonymized "Deleted User" from here on.
 * Removing the matching Supabase Auth identity is a separate step the router
 * orchestrates (see sdk.ts's deleteSupabaseAuthUser) — this function only ever
 * touches our own database.
 */
export async function permanentlyDeleteUser(userId: number): Promise<DeleteUserResult> {
  const db = await requireDb();
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const user = rows[0];
  if (!user) return { success: false, reason: "not_found" };

  const preview = await getUserDeletionPreview(userId);
  if (!preview.canDelete) return { success: false, reason: "blocked", blockedReasons: preview.blockedReasons };

  const snapshot = { email: user.email, name: user.name, appRole: user.appRole };

  await db
    .update(users)
    .set({ name: "Deleted User", email: null, phone: null, avatarUrl: null, status: "deleted", deletedAt: new Date() })
    .where(eq(users.id, userId));

  // Purely personal, no other party has a stake in these — hard-deleted outright.
  // Everything else (bookings, reviews, payments/transactions, messages, support
  // tickets) is deliberately left alone; see this function's own comment above.
  await Promise.all([
    db.delete(addresses).where(eq(addresses.userId, userId)),
    db.delete(devicePushTokens).where(eq(devicePushTokens.userId, userId)),
    db.delete(notificationPreferences).where(eq(notificationPreferences.userId, userId)),
    db.delete(notifications).where(eq(notifications.userId, userId)),
  ]);

  return { success: true, snapshot };
}

/* ========================= Admin: Booking management ========================= */

export async function listBookingsAdmin(params: {
  status?: (typeof BOOKING_STATUSES)[number];
  search?: string;
  limit?: number;
  offset?: number;
}) {
  const db = await requireDb();
  const conditions = [
    params.status ? eq(bookings.status, params.status) : undefined,
    params.search
      ? or(
          like(bookings.reference, `%${params.search}%`),
          like(users.name, `%${params.search}%`),
          like(providerProfiles.businessName, `%${params.search}%`),
        )
      : undefined,
  ].filter((c): c is NonNullable<typeof c> => !!c);
  const where = conditions.length ? and(...conditions) : undefined;

  const baseQuery = () =>
    db
      .select({ booking: bookings, service: services, provider: providerProfiles, customer: users })
      .from(bookings)
      .innerJoin(services, eq(bookings.serviceId, services.id))
      .innerJoin(providerProfiles, eq(bookings.providerId, providerProfiles.id))
      .innerJoin(users, eq(bookings.customerId, users.id));

  const [rows, countRows] = await Promise.all([
    baseQuery().where(where).orderBy(desc(bookings.createdAt)).limit(params.limit ?? 50).offset(params.offset ?? 0),
    db
      .select({ cnt: sql<number>`count(*)` })
      .from(bookings)
      .innerJoin(providerProfiles, eq(bookings.providerId, providerProfiles.id))
      .innerJoin(users, eq(bookings.customerId, users.id))
      .where(where),
  ]);
  return { rows, total: Number(countRows[0]?.cnt ?? 0) };
}

/** Everything the admin Booking Detail view needs in one call: the booking itself
 *  plus its full status history, progress checkpoints, payment record, and any
 *  cancellation request — all from tables that already exist and are already the
 *  real source of truth (no separate admin-only booking record). */
export async function getBookingDetailAdmin(bookingId: number) {
  const db = await requireDb();
  const rows = await db
    .select({ booking: bookings, service: services, provider: providerProfiles, customer: users })
    .from(bookings)
    .innerJoin(services, eq(bookings.serviceId, services.id))
    .innerJoin(providerProfiles, eq(bookings.providerId, providerProfiles.id))
    .innerJoin(users, eq(bookings.customerId, users.id))
    .where(eq(bookings.id, bookingId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  const [history, progress, paymentRows, cancellationRows] = await Promise.all([
    db.select().from(bookingStatusHistory).where(eq(bookingStatusHistory.bookingId, bookingId)).orderBy(bookingStatusHistory.createdAt),
    db.select().from(bookingProgressUpdates).where(eq(bookingProgressUpdates.bookingId, bookingId)).orderBy(bookingProgressUpdates.createdAt),
    db.select().from(payments).where(eq(payments.bookingId, bookingId)).orderBy(desc(payments.createdAt)),
    db.select().from(bookingCancellationRequests).where(eq(bookingCancellationRequests.bookingId, bookingId)).orderBy(desc(bookingCancellationRequests.createdAt)),
  ]);

  return { ...row, history, progress, payments: paymentRows, cancellationRequests: cancellationRows };
}

/* ============================ Admin: Categories ============================ */

/** Includes each category's active-service count so the UI can warn before a
 *  deactivate ("12 active services use this category") rather than doing it blind. */
export async function listCategoriesAdmin() {
  const db = await requireDb();
  const rows = await db
    .select({ category: categories, serviceCount: sql<number>`count(${services.id})` })
    .from(categories)
    .leftJoin(services, and(eq(services.categoryId, categories.id), eq(services.isActive, true)))
    .groupBy(categories.id)
    .orderBy(categories.sortOrder);
  return rows.map((r) => ({ ...r.category, activeServiceCount: Number(r.serviceCount) }));
}

export async function createCategoryAdmin(params: {
  name: string;
  slug: string;
  description?: string;
  icon?: string;
  imageUrl?: string;
  sortOrder?: number;
}) {
  const db = await requireDb();
  const [inserted] = await db.insert(categories).values(params).returning({ id: categories.id });
  return inserted?.id ?? 0;
}

export async function updateCategoryAdmin(
  id: number,
  data: Partial<{ name: string; slug: string; description: string; icon: string; imageUrl: string; sortOrder: number; isActive: boolean }>,
) {
  const db = await requireDb();
  await db.update(categories).set(data).where(eq(categories.id, id));
}

/* ============================== Admin: Finance ============================== */

/**
 * Derived, not stored: no code path ever writes a `category: "commission"`
 * transaction (there's no platform wallet) — commission only exists implicitly as
 * `booking.total - the booking_earning transaction's amount` at release time. This
 * mirrors the exact math `creditProviderEarning` already uses, just aggregated.
 */
export async function getFinanceSummary(params?: { from?: Date; to?: Date }) {
  const db = await requireDb();
  const bookingDateFilter = params?.from && params?.to
    ? and(gte(bookings.createdAt, params.from), lte(bookings.createdAt, params.to))
    : params?.from
      ? gte(bookings.createdAt, params.from)
      : params?.to
        ? lte(bookings.createdAt, params.to)
        : undefined;
  const txDateFilter = params?.from && params?.to
    ? and(gte(transactions.createdAt, params.from), lte(transactions.createdAt, params.to))
    : params?.from
      ? gte(transactions.createdAt, params.from)
      : params?.to
        ? lte(transactions.createdAt, params.to)
        : undefined;

  const [gmvRow, earningsRow, commissionRow, bookingFeesRow, refundsRow, paymentStatusRows] = await Promise.all([
    db.select({ sum: sql<string>`COALESCE(SUM(${bookings.total}), 0)` }).from(bookings).where(and(eq(bookings.paymentStatus, "paid"), bookingDateFilter)),
    db
      .select({ sum: sql<string>`COALESCE(SUM(${transactions.amount}), 0)` })
      .from(transactions)
      .where(and(eq(transactions.category, "booking_earning"), txDateFilter)),
    // Derived, not stored (same reason platform fees are, just below): no platform
    // wallet exists to attach a literal "commission" transaction to. Excludes
    // platformFee from the base — that's separate revenue, not a commission source.
    db
      .select({ sum: sql<string>`COALESCE(SUM((${bookings.total} - ${bookings.platformFee}) - ${transactions.amount}), 0)` })
      .from(transactions)
      .innerJoin(bookings, eq(transactions.bookingId, bookings.id))
      .where(and(eq(transactions.category, "booking_earning"), txDateFilter)),
    // Also derived rather than a real transaction — there's no platform wallet to
    // credit it to, same constraint as commission. bookings.platformFee is the
    // frozen-at-creation source of truth (see its own schema comment).
    db
      .select({ sum: sql<string>`COALESCE(SUM(${bookings.platformFee}), 0)` })
      .from(bookings)
      .where(and(eq(bookings.paymentStatus, "paid"), bookingDateFilter)),
    db
      .select({ sum: sql<string>`COALESCE(SUM(${transactions.amount}), 0)` })
      .from(transactions)
      .where(and(eq(transactions.category, "refund"), txDateFilter)),
    db.select({ status: payments.status, cnt: sql<number>`count(*)` }).from(payments).groupBy(payments.status),
  ]);

  const paymentCounts: Record<string, number> = { pending: 0, successful: 0, failed: 0, refunded: 0 };
  for (const row of paymentStatusRows) paymentCounts[row.status] = Number(row.cnt);

  return {
    gmv: Number(gmvRow[0]?.sum ?? 0),
    providerEarnings: Number(earningsRow[0]?.sum ?? 0),
    platformCommission: Number(commissionRow[0]?.sum ?? 0),
    bookingFeesCollected: Number(bookingFeesRow[0]?.sum ?? 0),
    refunds: Number(refundsRow[0]?.sum ?? 0),
    payments: paymentCounts,
  };
}

export async function listPaymentsAdmin(params: {
  status?: "pending" | "successful" | "failed" | "refunded";
  limit?: number;
  offset?: number;
}) {
  const db = await requireDb();
  const where = params.status ? eq(payments.status, params.status) : undefined;
  const [rows, countRows] = await Promise.all([
    db
      .select({ payment: payments, booking: bookings, customer: users })
      .from(payments)
      .leftJoin(bookings, eq(payments.bookingId, bookings.id))
      .leftJoin(users, eq(payments.userId, users.id))
      .where(where)
      .orderBy(desc(payments.createdAt))
      .limit(params.limit ?? 50)
      .offset(params.offset ?? 0),
    db.select({ cnt: sql<number>`count(*)` }).from(payments).where(where),
  ]);
  return { rows, total: Number(countRows[0]?.cnt ?? 0) };
}

/* ========================= Admin: Commission management ========================= */

/** Creates the single settings row on first read if it doesn't exist yet — same
 *  lazy-init pattern as getNotificationPreferences/getOrCreateWallet. */
export async function getPlatformSettings(): Promise<PlatformSettings> {
  const db = await requireDb();
  const rows = await db.select().from(platformSettings).limit(1);
  if (rows[0]) return rows[0];
  const [inserted] = await db.insert(platformSettings).values({}).returning();
  return inserted;
}

/** Forward-only: seeds new providers' own commissionRate at onboarding (see
 *  provider.onboard in routers.ts). Never touches existing providers' rates —
 *  those are already independent stored values on each provider's own row. */
export async function updateDefaultCommissionRate(params: {
  rate: number;
  updatedByUserId: number;
}): Promise<{ from: number; to: number }> {
  const db = await requireDb();
  const current = await getPlatformSettings();
  const from = Number(current.defaultCommissionRate);
  await db
    .update(platformSettings)
    .set({ defaultCommissionRate: params.rate.toFixed(2), updatedByUserId: params.updatedByUserId, updatedAt: new Date() })
    .where(eq(platformSettings.id, current.id));
  return { from, to: params.rate };
}

/** Forward-only, same as the commission rate: only affects bookings created after
 *  the change (see bookings.create in routers.ts, which snapshots the current value
 *  onto bookings.platformFee) — never touches a booking already placed. */
export async function updateBookingFeeSettings(params: {
  enabled: boolean;
  amount: number;
  updatedByUserId: number;
}): Promise<{ fromEnabled: boolean; fromAmount: number; toEnabled: boolean; toAmount: number }> {
  const db = await requireDb();
  const current = await getPlatformSettings();
  const fromEnabled = current.bookingFeeEnabled;
  const fromAmount = Number(current.bookingFeeAmount);
  await db
    .update(platformSettings)
    .set({
      bookingFeeEnabled: params.enabled,
      bookingFeeAmount: params.amount.toFixed(2),
      updatedByUserId: params.updatedByUserId,
      updatedAt: new Date(),
    })
    .where(eq(platformSettings.id, current.id));
  return { fromEnabled, fromAmount, toEnabled: params.enabled, toAmount: params.amount };
}

/**
 * Real, per-booking commission ledger — derived from released `booking_earning`
 * transactions (booking.total − released earning), same math as getFinanceSummary's
 * aggregate commission figure, just itemized. Only covers bookings whose payout has
 * actually been released: a held or not-yet-completed booking has no fixed
 * commission yet (see the "computed live at release time" note on
 * updateDefaultCommissionRate above), so it has nothing real to list here.
 */
export async function listCommissionLedger(params: { from?: Date; to?: Date; limit?: number; offset?: number }) {
  const db = await requireDb();
  const dateFilter =
    params.from && params.to
      ? and(gte(transactions.createdAt, params.from), lte(transactions.createdAt, params.to))
      : params.from
        ? gte(transactions.createdAt, params.from)
        : params.to
          ? lte(transactions.createdAt, params.to)
          : undefined;
  const where = dateFilter ? and(eq(transactions.category, "booking_earning"), dateFilter) : eq(transactions.category, "booking_earning");

  const [rows, countRows] = await Promise.all([
    db
      .select({ transaction: transactions, booking: bookings, service: services, provider: providerProfiles })
      .from(transactions)
      .innerJoin(bookings, eq(transactions.bookingId, bookings.id))
      .innerJoin(services, eq(bookings.serviceId, services.id))
      .innerJoin(providerProfiles, eq(bookings.providerId, providerProfiles.id))
      .where(where)
      .orderBy(desc(transactions.createdAt))
      .limit(params.limit ?? 50)
      .offset(params.offset ?? 0),
    db
      .select({ cnt: sql<number>`count(*)` })
      .from(transactions)
      .innerJoin(bookings, eq(transactions.bookingId, bookings.id))
      .where(where),
  ]);

  const ledgerRows = rows.map((r) => {
    const total = Number(r.booking.total);
    const platformFee = Number(r.booking.platformFee);
    const earning = Number(r.transaction.amount);
    return {
      bookingId: r.booking.id,
      reference: r.booking.reference,
      service: r.service.title,
      provider: r.provider.businessName,
      total,
      earning,
      // Excludes platformFee from the base, same fix as creditProviderEarning —
      // otherwise this would silently count the flat booking fee as commission.
      commission: Math.round((total - platformFee - earning) * 100) / 100,
      releasedAt: r.transaction.createdAt,
    };
  });

  return { rows: ledgerRows, total: Number(countRows[0]?.cnt ?? 0) };
}

/* ========================= Admin: Support ticket triage ========================= */

export async function listSupportTicketsAdmin(params: {
  status?: "open" | "in_progress" | "resolved" | "closed";
  priority?: "low" | "medium" | "high" | "urgent";
  assignedToUserId?: number;
  limit?: number;
  offset?: number;
}) {
  const db = await requireDb();
  const conditions = [
    params.status ? eq(supportTickets.status, params.status) : undefined,
    params.priority ? eq(supportTickets.priority, params.priority) : undefined,
    params.assignedToUserId ? eq(supportTickets.assignedToUserId, params.assignedToUserId) : undefined,
  ].filter((c): c is NonNullable<typeof c> => !!c);
  const where = conditions.length ? and(...conditions) : undefined;

  const [rows, countRows] = await Promise.all([
    db
      .select({ ticket: supportTickets, submittedBy: users })
      .from(supportTickets)
      .innerJoin(users, eq(supportTickets.userId, users.id))
      .where(where)
      .orderBy(desc(supportTickets.createdAt))
      .limit(params.limit ?? 50)
      .offset(params.offset ?? 0),
    db.select({ cnt: sql<number>`count(*)` }).from(supportTickets).where(where),
  ]);
  return { rows, total: Number(countRows[0]?.cnt ?? 0) };
}

export async function updateSupportTicketAdmin(
  id: number,
  data: Partial<{
    status: "open" | "in_progress" | "resolved" | "closed";
    priority: "low" | "medium" | "high" | "urgent";
    assignedToUserId: number | null;
    internalNotes: string;
  }>,
) {
  const db = await requireDb();
  await db.update(supportTickets).set({ ...data, updatedAt: new Date() }).where(eq(supportTickets.id, id));
}

/** Admin decision on a provider's verification, with notification. */
export async function decideProviderVerification(params: {
  providerId: number;
  decision: "verified" | "rejected";
  rejectionReason?: string;
}) {
  const db = await requireDb();
  const profile = await getProviderProfileById(params.providerId);
  if (!profile) throw new Error("Provider not found");

  await db
    .update(providerProfiles)
    .set(
      params.decision === "verified"
        ? { verificationStatus: "verified", verifiedAt: new Date(), rejectionReason: null }
        : { verificationStatus: "rejected", rejectionReason: params.rejectionReason ?? "Verification rejected" },
    )
    .where(eq(providerProfiles.id, params.providerId));

  await db
    .update(providerDocuments)
    .set({ status: params.decision === "verified" ? "approved" : "rejected" })
    .where(and(eq(providerDocuments.providerId, params.providerId), eq(providerDocuments.status, "pending")));

  await createNotification({
    userId: profile.userId,
    type: "system",
    title: params.decision === "verified" ? "Identity verified" : "Verification rejected",
    body:
      params.decision === "verified"
        ? "Your identity has been verified. You can now accept bookings and send quotations."
        : `Your verification was rejected: ${params.rejectionReason ?? "please re-submit valid documents"}.`,
    data: { providerId: params.providerId },
  });

  return { status: params.decision };
}
