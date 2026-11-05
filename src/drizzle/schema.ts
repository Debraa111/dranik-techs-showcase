import {
  boolean,
  decimal,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/* ============================================================================
 * D'RANIK TECHS - Production Database Schema
 * Service marketplace connecting customers with trusted service providers.
 *
 * Roles: customer | provider | admin
 * Money: stored as DECIMAL(12,2) in Nigerian Naira (NGN).
 * All FKs are plain int columns + relations declared in drizzle/relations.ts.
 *
 * Ported from MySQL to Postgres (Supabase). Notable differences from the
 * original MySQL schema:
 *  - `id` columns use Postgres `serial` instead of MySQL autoincrement.
 *  - Enum columns are `varchar` with a TS-level `enum` constraint instead of
 *    `mysqlEnum` (avoids needing globally-unique Postgres CREATE TYPE names
 *    for enum names that repeat across tables, e.g. "status").
 *  - `json` columns use Postgres `jsonb` (indexable, generally preferred).
 *  - MySQL's `.onUpdateNow()` (automatic `updatedAt` refresh on UPDATE) has
 *    no Postgres equivalent without a DB trigger — dropped here. Any code
 *    path that relies on `updatedAt` refreshing automatically on update must
 *    now set it explicitly (`updatedAt: new Date()`) in the `.set()` call.
 * ==========================================================================*/

/* ----------------------------- Users & Auth ------------------------------ */

export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    /** Links to Supabase's own auth.users(id). Supabase Auth handles credentials/sessions. */
    authUserId: uuid("auth_user_id").notNull().unique(),
    name: text("name"),
    email: varchar("email", { length: 320 }),
    phone: varchar("phone", { length: 32 }),
    avatarUrl: varchar("avatarUrl", { length: 512 }),
    /** Platform role. Providers also get a row in providerProfiles. */
    role: varchar("role", { length: 32, enum: ["user", "admin"] as const }).default("user").notNull(),
    appRole: varchar("appRole", { length: 32, enum: ["customer", "provider", "admin"] as const })
      .default("customer")
      .notNull(),
    /** "deleted" is the one-way terminal state from permanent delete — distinct from
     *  "deactivated" (reversible, data untouched) so a scrubbed account can never be
     *  offered "Reactivate" again. */
    status: varchar("status", { length: 32, enum: ["active", "suspended", "deactivated", "deleted"] as const })
      .default("active")
      .notNull(),
    emailVerified: boolean("emailVerified").default(false).notNull(),
    phoneVerified: boolean("phoneVerified").default(false).notNull(),
    /** Set only by a permanent delete — null otherwise, including for "deactivated". */
    deletedAt: timestamp("deletedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
    lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
  },
  (t) => [index("users_appRole_idx").on(t.appRole), index("users_status_idx").on(t.status)],
);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Role-based admin access control. `users.role === "admin"` (above) is still the
 * coarse gate — "can this account reach the admin dashboard at all" — kept as-is so
 * the existing `adminProcedure` check never breaks. This table layers granularity on
 * top: which specific admin resources (users/providers/bookings/finance/disputes/
 * categories/admin management) a given admin account can act on. One admin can hold
 * several roles at once (multiple rows), each independently revocable. `super_admin`
 * is checked as "grants everything" in code rather than listed in every resource's
 * allowed-roles set, so adding a new resource later can't accidentally forget it.
 */
export const ADMIN_ROLES = ["super_admin", "operations_admin", "finance_admin", "support_admin", "content_admin"] as const;

export const adminRoleAssignments = pgTable(
  "admin_role_assignments",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId").notNull(),
    role: varchar("role", { length: 32, enum: ADMIN_ROLES }).notNull(),
    /** Null for the very first super_admin (the OWNER_EMAIL bootstrap) — every later
     *  assignment is made by a real super_admin through the Admin Users screen. */
    assignedByUserId: integer("assignedByUserId"),
    assignedAt: timestamp("assignedAt").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("admin_role_assignments_user_role_idx").on(t.userId, t.role),
    index("admin_role_assignments_userId_idx").on(t.userId),
  ],
);

export type AdminRoleAssignment = typeof adminRoleAssignments.$inferSelect;

/**
 * Single-row platform config — currently just the default commission rate new
 * providers are seeded with at onboarding (see provider.onboard in routers.ts).
 * Deliberately a dedicated table with real columns, not a generic key/value store:
 * there's exactly one setting to hold today, and a KV table would be premature
 * abstraction for a need that doesn't exist yet. Add columns here as real settings
 * arrive rather than reaching for genericity in advance.
 *
 * Changing this value is forward-only by design: it seeds new provider profiles'
 * own `commissionRate` at creation time and never touches existing providers' rates
 * — those are already-independent stored values, not derived from this. Existing
 * providers, and any of their bookings whose payout hasn't been released yet, are
 * completely unaffected by a change here.
 */
export const platformSettings = pgTable("platform_settings", {
  id: serial("id").primaryKey(),
  defaultCommissionRate: decimal("defaultCommissionRate", { precision: 5, scale: 2 }).default("10.00").notNull(),
  /** Flat fee added to the customer's total at checkout, on top of the service
   *  price — separate platform revenue, never deducted from provider payout (see
   *  bookings.platformFee below and the commission-base fix in creditProviderEarning).
   *  Forward-only, same as the commission rate: this only affects bookings created
   *  after a change, never retroactively touches one already placed. */
  bookingFeeEnabled: boolean("bookingFeeEnabled").default(true).notNull(),
  bookingFeeAmount: decimal("bookingFeeAmount", { precision: 10, scale: 2 }).default("500.00").notNull(),
  updatedByUserId: integer("updatedByUserId"),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type PlatformSettings = typeof platformSettings.$inferSelect;

/* --------------------------- Provider Profiles --------------------------- */

export const providerProfiles = pgTable(
  "provider_profiles",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId").notNull(),
    businessName: varchar("businessName", { length: 255 }).notNull(),
    bio: text("bio"),
    yearsOfExperience: integer("yearsOfExperience").default(0).notNull(),
    verificationStatus: varchar("verificationStatus", {
      length: 32,
      enum: ["unverified", "pending", "verified", "rejected"] as const,
    })
      .default("unverified")
      .notNull(),
    verifiedAt: timestamp("verifiedAt"),
    availabilityStatus: varchar("availabilityStatus", {
      length: 32,
      enum: ["available", "busy", "offline"] as const,
    })
      .default("offline")
      .notNull(),
    /** Aggregates denormalized for fast listing; recomputed on review/booking writes. */
    averageRating: decimal("averageRating", { precision: 3, scale: 2 }).default("0.00").notNull(),
    reviewCount: integer("reviewCount").default(0).notNull(),
    completedJobs: integer("completedJobs").default(0).notNull(),
    /** Platform commission percentage applied to this provider's bookings. */
    commissionRate: decimal("commissionRate", { precision: 5, scale: 2 }).default("10.00").notNull(),
    city: varchar("city", { length: 128 }),
    state: varchar("state", { length: 128 }),
    latitude: decimal("latitude", { precision: 10, scale: 7 }),
    longitude: decimal("longitude", { precision: 10, scale: 7 }),
    /** How far beyond city/state the provider is willing to travel for a job. */
    serviceRadiusKm: integer("serviceRadiusKm"),
    /** Named districts/areas covered, e.g. ["Lekki", "Ajah", "VI"] — distinct from the single city/state pair above. */
    serviceAreas: jsonb("serviceAreas").$type<string[]>(),
    skills: jsonb("skills").$type<string[]>(),
    languages: jsonb("languages").$type<string[]>(),
    certifications: jsonb("certifications").$type<{ title: string; issuer?: string; year?: number }[]>(),
    /** Service mode — independent of serviceAreas/serviceRadiusKm (where), these say
     *  how the job actually happens (does the provider go to the customer, or vice
     *  versa). Not mutually exclusive; most home-service providers only travel. */
    travelsToCustomer: boolean("travelsToCustomer").default(true).notNull(),
    customerComesToProvider: boolean("customerComesToProvider").default(false).notNull(),
    /* ---- Legal identity (mandatory for verification) ---- */
    firstName: varchar("firstName", { length: 128 }),
    lastName: varchar("lastName", { length: 128 }),
    /** YYYY-MM-DD */
    dateOfBirth: varchar("dateOfBirth", { length: 10 }),
    phone: varchar("phone", { length: 32 }),
    email: varchar("email", { length: 320 }),
    residentialAddress: varchar("residentialAddress", { length: 512 }),
    businessAddress: varchar("businessAddress", { length: 512 }),
    cacRegistrationNumber: varchar("cacRegistrationNumber", { length: 64 }),
    /** Set by admin when verification is rejected; shown to the provider. */
    rejectionReason: text("rejectionReason"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("provider_profiles_userId_idx").on(t.userId),
    index("provider_profiles_verification_idx").on(t.verificationStatus),
    index("provider_profiles_city_idx").on(t.city),
  ],
);

export type ProviderProfile = typeof providerProfiles.$inferSelect;
export type InsertProviderProfile = typeof providerProfiles.$inferInsert;

/** Verification documents uploaded by providers (gov ID, certificates, portfolio). */
export const providerDocuments = pgTable(
  "provider_documents",
  {
    id: serial("id").primaryKey(),
    providerId: integer("providerId").notNull(),
    type: varchar("type", {
      length: 32,
      enum: ["government_id", "certificate", "portfolio", "selfie", "address_proof", "other"] as const,
    }).notNull(),
    fileKey: varchar("fileKey", { length: 512 }).notNull(),
    fileUrl: varchar("fileUrl", { length: 512 }).notNull(),
    fileName: varchar("fileName", { length: 255 }),
    mimeType: varchar("mimeType", { length: 128 }),
    status: varchar("status", { length: 32, enum: ["pending", "approved", "rejected"] as const })
      .default("pending")
      .notNull(),
    reviewNote: text("reviewNote"),
    /** Which government ID was uploaded (required when type = government_id). */
    idType: varchar("idType", {
      length: 32,
      enum: ["nin", "drivers_licence", "international_passport", "voters_card"] as const,
    }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [index("provider_documents_providerId_idx").on(t.providerId)],
);

export type ProviderDocument = typeof providerDocuments.$inferSelect;
export type InsertProviderDocument = typeof providerDocuments.$inferInsert;

/**
 * A provider's recurring weekly availability — one row per weekday (0=Sunday
 * .. 6=Saturday), one open/close range each. Provider-side data only this
 * phase: the customer's booking date/time picker doesn't read this table yet
 * (see docs/PROVIDER_ROADMAP.md P4b), so this doesn't constrain what a
 * customer can currently book.
 */
export const providerWorkingHours = pgTable(
  "provider_working_hours",
  {
    id: serial("id").primaryKey(),
    providerId: integer("providerId").notNull(),
    /** 0 = Sunday .. 6 = Saturday, matches JS Date#getDay(). */
    dayOfWeek: integer("dayOfWeek").notNull(),
    isOpen: boolean("isOpen").default(true).notNull(),
    /** HH:mm, null when isOpen is false. */
    openTime: varchar("openTime", { length: 5 }),
    closeTime: varchar("closeTime", { length: 5 }),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("provider_working_hours_provider_day_idx").on(t.providerId, t.dayOfWeek)],
);

export type ProviderWorkingHours = typeof providerWorkingHours.$inferSelect;
export type InsertProviderWorkingHours = typeof providerWorkingHours.$inferInsert;

/**
 * A date range a provider has blocked off — a single unavailable day and a
 * multi-week vacation are the same mechanism here, just different range
 * lengths (no separate "vacation mode" concept, deliberately).
 */
export const providerBlockedDates = pgTable(
  "provider_blocked_dates",
  {
    id: serial("id").primaryKey(),
    providerId: integer("providerId").notNull(),
    startDate: varchar("startDate", { length: 10 }).notNull(),
    endDate: varchar("endDate", { length: 10 }).notNull(),
    reason: varchar("reason", { length: 255 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [index("provider_blocked_dates_providerId_idx").on(t.providerId)],
);

export type ProviderBlockedDate = typeof providerBlockedDates.$inferSelect;
export type InsertProviderBlockedDate = typeof providerBlockedDates.$inferInsert;

/** A provider's bank account — the destination for wallet withdrawals. */
export const providerBankAccounts = pgTable(
  "provider_bank_accounts",
  {
    id: serial("id").primaryKey(),
    providerId: integer("providerId").notNull(),
    bankName: varchar("bankName", { length: 128 }).notNull(),
    /** Nigerian bank code (e.g. Paystack's), ready for real Transfer Recipient API integration later. */
    bankCode: varchar("bankCode", { length: 16 }),
    accountNumber: varchar("accountNumber", { length: 20 }).notNull(),
    accountName: varchar("accountName", { length: 255 }).notNull(),
    isDefault: boolean("isDefault").default(false).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [index("provider_bank_accounts_providerId_idx").on(t.providerId)],
);

export type ProviderBankAccount = typeof providerBankAccounts.$inferSelect;
export type InsertProviderBankAccount = typeof providerBankAccounts.$inferInsert;

/* -------------------------- Categories & Services ------------------------ */

export const categories = pgTable(
  "categories",
  {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 128 }).notNull(),
    slug: varchar("slug", { length: 128 }).notNull(),
    description: text("description"),
    /** Material icon name used by the mobile client icon system. */
    icon: varchar("icon", { length: 64 }).default("category").notNull(),
    imageUrl: varchar("imageUrl", { length: 512 }),
    sortOrder: integer("sortOrder").default(0).notNull(),
    isActive: boolean("isActive").default(true).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("categories_slug_idx").on(t.slug), index("categories_active_idx").on(t.isActive)],
);

export type Category = typeof categories.$inferSelect;
export type InsertCategory = typeof categories.$inferInsert;

export const services = pgTable(
  "services",
  {
    id: serial("id").primaryKey(),
    providerId: integer("providerId").notNull(),
    categoryId: integer("categoryId").notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description"),
    /** Starting price in NGN. */
    basePrice: decimal("basePrice", { precision: 12, scale: 2 }).notNull(),
    priceUnit: varchar("priceUnit", { length: 32, enum: ["fixed", "hourly", "per_session"] as const })
      .default("fixed")
      .notNull(),
    durationMinutes: integer("durationMinutes").default(60).notNull(),
    /** Cover photo — always images[0] when images is set. Kept for the many places that show one thumbnail. */
    imageUrl: varchar("imageUrl", { length: 512 }),
    /** Full gallery for the Service Detail page carousel. */
    images: jsonb("images").$type<string[]>(),
    /** fixed_price = book instantly at basePrice; request_quote = customer must request a quotation. */
    pricingMode: varchar("pricingMode", { length: 32, enum: ["fixed_price", "request_quote"] as const })
      .default("fixed_price")
      .notNull(),
    /** What's included checklist shown on the service detail page. Array of short strings. */
    included: jsonb("included").$type<string[]>(),
    materials: jsonb("materials").$type<string[]>(),
    isEmergency: boolean("isEmergency").default(false).notNull(),
    tags: jsonb("tags").$type<string[]>(),
    isActive: boolean("isActive").default(true).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (t) => [
    index("services_providerId_idx").on(t.providerId),
    index("services_categoryId_idx").on(t.categoryId),
    index("services_active_idx").on(t.isActive),
  ],
);

export type Service = typeof services.$inferSelect;
export type InsertService = typeof services.$inferInsert;

/* ------------------------------- Addresses ------------------------------- */

export const addresses = pgTable(
  "addresses",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId").notNull(),
    label: varchar("label", { length: 64 }).default("Home").notNull(),
    addressLine1: varchar("addressLine1", { length: 255 }).notNull(),
    addressLine2: varchar("addressLine2", { length: 255 }),
    city: varchar("city", { length: 128 }).notNull(),
    state: varchar("state", { length: 128 }).notNull(),
    country: varchar("country", { length: 128 }).default("Nigeria").notNull(),
    /** Geo coordinates for maps / distance search (Google Maps-ready). */
    latitude: decimal("latitude", { precision: 10, scale: 7 }),
    longitude: decimal("longitude", { precision: 10, scale: 7 }),
    isDefault: boolean("isDefault").default(false).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [index("addresses_userId_idx").on(t.userId)],
);

export type Address = typeof addresses.$inferSelect;
export type InsertAddress = typeof addresses.$inferInsert;

/* -------------------------------- Bookings ------------------------------- */

export const BOOKING_STATUSES = [
  "pending",
  "confirmed",
  "in_progress",
  "completed",
  "cancelled",
  "rejected",
] as const;

export const bookings = pgTable(
  "bookings",
  {
    id: serial("id").primaryKey(),
    /** Human-friendly reference, e.g. DRK-20260723-A1B2. */
    reference: varchar("reference", { length: 32 }).notNull(),
    customerId: integer("customerId").notNull(),
    providerId: integer("providerId").notNull(),
    serviceId: integer("serviceId").notNull(),
    addressId: integer("addressId"),
    status: varchar("status", { length: 32, enum: BOOKING_STATUSES }).default("pending").notNull(),
    scheduledDate: varchar("scheduledDate", { length: 10 }).notNull(), // YYYY-MM-DD
    scheduledTime: varchar("scheduledTime", { length: 5 }).notNull(), // HH:mm
    notes: text("notes"),
    /** Price snapshot at booking time. */
    subtotal: decimal("subtotal", { precision: 12, scale: 2 }).notNull(),
    discount: decimal("discount", { precision: 12, scale: 2 }).default("0.00").notNull(),
    /** Flat platform/booking fee, frozen from platformSettings.bookingFeeAmount at
     *  creation time (0 if the fee was disabled then) — never a live lookup, so a
     *  later admin change can't retroactively touch an existing booking. Included in
     *  `total` (what the customer actually pays) but explicitly excluded from
     *  commission math — see creditProviderEarning's own comment. */
    platformFee: decimal("platformFee", { precision: 10, scale: 2 }).default("0.00").notNull(),
    total: decimal("total", { precision: 12, scale: 2 }).notNull(),
    couponId: integer("couponId"),
    paymentStatus: varchar("paymentStatus", { length: 32, enum: ["unpaid", "paid", "refunded"] as const })
      .default("unpaid")
      .notNull(),
    cancelReason: text("cancelReason"),
    completedAt: timestamp("completedAt"),
    /** Photos the provider attaches when marking the job complete. */
    completionPhotos: jsonb("completionPhotos").$type<string[]>(),
    /**
     * Escrow-style payout release. Marking a booking "completed" no longer credits the
     * provider's wallet directly — it sets this to "held" and generates a release code
     * the customer hands the provider in person. Null until the booking is completed.
     */
    payoutStatus: varchar("payoutStatus", { length: 16, enum: ["held", "released"] as const }),
    /**
     * AES-256-GCM ciphertext of the 5-digit code (keyed with ENV.releaseCodePepper) — not
     * a plain hash. The customer needs to re-view their own code on demand (a dedicated,
     * customer-only query decrypts it — see bookings.releaseCode in routers.ts), which a
     * one-way hash can't support; a keyed cipher still means a raw DB dump alone can't
     * recover the code without also having the server-only pepper. Physical column name
     * kept from an earlier hash-based draft — see this comment for what it actually holds.
     */
    releaseCodeHash: varchar("releaseCodeHash", { length: 128 }),
    releaseCodeExpiresAt: timestamp("releaseCodeExpiresAt"),
    releaseCodeGeneratedAt: timestamp("releaseCodeGeneratedAt"),
    /** Locked out (see BOOKING_RELEASE_CODE_MAX_ATTEMPTS in db.ts) once this hits the cap. */
    releaseCodeAttempts: integer("releaseCodeAttempts").default(0).notNull(),
    payoutReleasedAt: timestamp("payoutReleasedAt"),
    /** The provider's own userId for a code-confirmed release, or the admin's userId for a manual one. */
    payoutReleasedBy: integer("payoutReleasedBy"),
    /** Admin's reason — always set for a manual release, always null for a code-confirmed one. */
    payoutReleaseNote: text("payoutReleaseNote"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("bookings_reference_idx").on(t.reference),
    index("bookings_customerId_idx").on(t.customerId),
    index("bookings_providerId_idx").on(t.providerId),
    index("bookings_status_idx").on(t.status),
    index("bookings_date_idx").on(t.scheduledDate),
    index("bookings_payoutStatus_idx").on(t.payoutStatus),
  ],
);

export type Booking = typeof bookings.$inferSelect;
export type InsertBooking = typeof bookings.$inferInsert;

/** Immutable audit trail of booking status transitions. */
export const bookingStatusHistory = pgTable(
  "booking_status_history",
  {
    id: serial("id").primaryKey(),
    bookingId: integer("bookingId").notNull(),
    fromStatus: varchar("fromStatus", { length: 32 }),
    toStatus: varchar("toStatus", { length: 32 }).notNull(),
    changedByUserId: integer("changedByUserId"),
    note: text("note"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [index("bsh_bookingId_idx").on(t.bookingId)],
);

export type BookingStatusHistory = typeof bookingStatusHistory.$inferSelect;

export const BOOKING_PROGRESS_TYPES = ["on_the_way", "arrived", "waiting_for_customer"] as const;

/**
 * Lightweight, additive-only checkpoints a provider can post while a booking
 * is confirmed/in_progress (e.g. "on the way", "arrived"). Deliberately NOT
 * part of the booking status machine — BOOKING_STATUSES/BOOKING_TRANSITIONS
 * stay exactly as they are, so the payment gate, wallet-crediting on
 * completion, and every other status-driven rule are untouched. "Work
 * started" isn't a checkpoint type here because it's already the existing
 * `in_progress` status. Each checkpoint notifies the customer.
 */
export const bookingProgressUpdates = pgTable(
  "booking_progress_updates",
  {
    id: serial("id").primaryKey(),
    bookingId: integer("bookingId").notNull(),
    type: varchar("type", { length: 32, enum: BOOKING_PROGRESS_TYPES }).notNull(),
    note: text("note"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [index("booking_progress_updates_bookingId_idx").on(t.bookingId)],
);

export type BookingProgressUpdate = typeof bookingProgressUpdates.$inferSelect;
export type InsertBookingProgressUpdate = typeof bookingProgressUpdates.$inferInsert;

export const CANCELLATION_REQUEST_ROLES = ["customer", "provider"] as const;
export const CANCELLATION_REQUEST_STATUSES = ["pending", "approved", "rejected"] as const;

/**
 * Once a booking is `in_progress`, cancelling stops being instant for either party —
 * it becomes a request an admin reviews (see `admin.cancellationRequests` in
 * routers.ts), same pattern as held-payment release. `bookings.status` only moves to
 * `cancelled` on admin approval; a pending/rejected request leaves the booking exactly
 * as it was. `refundAmount`/`providerPayoutAmount` are set by the admin at approval
 * time (not derived automatically) — see `decideCancellationRequest` in db.ts for why.
 */
export const bookingCancellationRequests = pgTable(
  "booking_cancellation_requests",
  {
    id: serial("id").primaryKey(),
    bookingId: integer("bookingId").notNull(),
    requestedByUserId: integer("requestedByUserId").notNull(),
    requestedByRole: varchar("requestedByRole", { length: 16, enum: CANCELLATION_REQUEST_ROLES }).notNull(),
    reason: text("reason").notNull(),
    status: varchar("status", { length: 16, enum: CANCELLATION_REQUEST_STATUSES }).default("pending").notNull(),
    reviewedByAdminId: integer("reviewedByAdminId"),
    reviewNote: text("reviewNote"),
    refundAmount: decimal("refundAmount", { precision: 12, scale: 2 }),
    providerPayoutAmount: decimal("providerPayoutAmount", { precision: 12, scale: 2 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    reviewedAt: timestamp("reviewedAt"),
  },
  (t) => [
    index("bcr_bookingId_idx").on(t.bookingId),
    index("bcr_status_idx").on(t.status),
  ],
);

export type BookingCancellationRequest = typeof bookingCancellationRequests.$inferSelect;
export type InsertBookingCancellationRequest = typeof bookingCancellationRequests.$inferInsert;

/**
 * Nigeria has one fixed offset (WAT, UTC+1, no DST) — see `scheduledAtUtc` in db.ts,
 * which is the only place these intervals get compared against real time.
 */
export const REMINDER_INTERVALS = ["1d", "5h", "1h", "30m", "10m"] as const;

/**
 * One row per (booking, interval) the reminder job has already evaluated — the
 * dedup ledger that keeps a ~5-minute polling loop from re-firing (or double-firing
 * across overlapping runs) the same reminder. Written whether or not a notification
 * was actually sent (e.g. the customer has serviceReminders off) — the point is "the
 * job already decided what to do about this interval," not "a notification went out."
 */
export const bookingReminders = pgTable(
  "booking_reminders",
  {
    id: serial("id").primaryKey(),
    bookingId: integer("bookingId").notNull(),
    interval: varchar("interval", { length: 8, enum: REMINDER_INTERVALS }).notNull(),
    firedAt: timestamp("firedAt").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("booking_reminders_booking_interval_idx").on(t.bookingId, t.interval),
    index("booking_reminders_bookingId_idx").on(t.bookingId),
  ],
);

export type BookingReminder = typeof bookingReminders.$inferSelect;
export type InsertBookingReminder = typeof bookingReminders.$inferInsert;

/* -------------------------------- Reviews -------------------------------- */

export const reviews = pgTable(
  "reviews",
  {
    id: serial("id").primaryKey(),
    bookingId: integer("bookingId").notNull(),
    customerId: integer("customerId").notNull(),
    providerId: integer("providerId").notNull(),
    rating: integer("rating").notNull(), // 1..5, validated at API layer
    comment: text("comment"),
    /** Array of photo URLs the customer attached to the review. */
    images: jsonb("images").$type<string[]>(),
    providerResponse: text("providerResponse"),
    isVisible: boolean("isVisible").default(true).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("reviews_bookingId_idx").on(t.bookingId),
    index("reviews_providerId_idx").on(t.providerId),
  ],
);

export type Review = typeof reviews.$inferSelect;
export type InsertReview = typeof reviews.$inferInsert;

/* ----------------------------- Notifications ----------------------------- */

export const NOTIFICATION_TYPES = [
  "booking_update",
  "message",
  "promotion",
  "service_reminder",
  "payment",
  "review",
  "system",
  /** A customer just created a booking for a provider — split from "booking_update"
   *  specifically so providers can control it separately (see newBookingRequests
   *  below). Every other booking-lifecycle event (accepted/declined/cancelled) stays
   *  under "booking_update". */
  "new_booking_request",
] as const;

export const notifications = pgTable(
  "notifications",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId").notNull(),
    type: varchar("type", { length: 32, enum: NOTIFICATION_TYPES }).notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    body: text("body"),
    /** Optional deep-link data, e.g. { bookingId: 12 }. */
    data: jsonb("data"),
    isRead: boolean("isRead").default(false).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [index("notifications_userId_idx").on(t.userId), index("notifications_read_idx").on(t.isRead)],
);

export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = typeof notifications.$inferInsert;

/** Per-user notification channel/type preferences. */
export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId").notNull(),
    pushEnabled: boolean("pushEnabled").default(true).notNull(),
    emailEnabled: boolean("emailEnabled").default(true).notNull(),
    smsEnabled: boolean("smsEnabled").default(false).notNull(),
    bookingUpdates: boolean("bookingUpdates").default(true).notNull(),
    messages: boolean("messages").default(true).notNull(),
    promotions: boolean("promotions").default(false).notNull(),
    serviceReminders: boolean("serviceReminders").default(true).notNull(),
    /** Provider-only in practice (a pure customer never triggers this), but lives on
     *  the same per-account row as everything else here rather than a separate table
     *  — one settings row per user stays the simpler model. */
    newBookingRequests: boolean("newBookingRequests").default(true).notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("notification_prefs_userId_idx").on(t.userId)],
);

export type NotificationPreference = typeof notificationPreferences.$inferSelect;

/**
 * One row per device/app-install (not per user — the same user can have several).
 * Unique on the token itself, not (userId, token): a token belongs to exactly one
 * physical install, so if it resurfaces under a different account (device passed
 * along, or a shared device logging into a new account) re-registering reassigns
 * `userId` via upsert rather than creating a stale duplicate that still points at
 * the previous account.
 */
export const devicePushTokens = pgTable(
  "device_push_tokens",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId").notNull(),
    expoPushToken: varchar("expoPushToken", { length: 255 }).notNull(),
    platform: varchar("platform", { length: 16, enum: ["ios", "android", "web"] as const }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    lastSeenAt: timestamp("lastSeenAt").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("device_push_tokens_token_idx").on(t.expoPushToken),
    index("device_push_tokens_userId_idx").on(t.userId),
  ],
);

export type DevicePushToken = typeof devicePushTokens.$inferSelect;
export type InsertDevicePushToken = typeof devicePushTokens.$inferInsert;

/* --------------------------- Wallets & Payments --------------------------- */

export const wallets = pgTable(
  "wallets",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId").notNull(),
    balance: decimal("balance", { precision: 14, scale: 2 }).default("0.00").notNull(),
    currency: varchar("currency", { length: 3 }).default("NGN").notNull(),
    isLocked: boolean("isLocked").default(false).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("wallets_userId_idx").on(t.userId)],
);

export type Wallet = typeof wallets.$inferSelect;

/**
 * Payment intents. Gateway-agnostic: `gateway` + `gatewayReference` columns are
 * ready for Paystack (or any other processor) without schema changes.
 */
export const payments = pgTable(
  "payments",
  {
    id: serial("id").primaryKey(),
    bookingId: integer("bookingId"),
    userId: integer("userId").notNull(),
    amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
    currency: varchar("currency", { length: 3 }).default("NGN").notNull(),
    method: varchar("method", { length: 32, enum: ["card", "bank_transfer", "wallet"] as const })
      .default("card")
      .notNull(),
    gateway: varchar("gateway", { length: 32 }).default("paystack").notNull(),
    gatewayReference: varchar("gatewayReference", { length: 128 }),
    status: varchar("status", {
      length: 32,
      enum: ["pending", "successful", "failed", "refunded"] as const,
    })
      .default("pending")
      .notNull(),
    metadata: jsonb("metadata"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (t) => [
    index("payments_bookingId_idx").on(t.bookingId),
    index("payments_userId_idx").on(t.userId),
    index("payments_status_idx").on(t.status),
  ],
);

export type Payment = typeof payments.$inferSelect;

/** Double-entry style wallet ledger. Every balance change gets a row. */
export const transactions = pgTable(
  "transactions",
  {
    id: serial("id").primaryKey(),
    walletId: integer("walletId").notNull(),
    type: varchar("type", { length: 16, enum: ["credit", "debit"] as const }).notNull(),
    category: varchar("category", {
      length: 32,
      enum: [
        "booking_payment",
        "booking_earning",
        "commission",
        "withdrawal",
        "refund",
        "topup",
        "adjustment",
      ] as const,
    }).notNull(),
    amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
    balanceAfter: decimal("balanceAfter", { precision: 14, scale: 2 }).notNull(),
    bookingId: integer("bookingId"),
    paymentId: integer("paymentId"),
    description: varchar("description", { length: 255 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [index("transactions_walletId_idx").on(t.walletId), index("transactions_bookingId_idx").on(t.bookingId)],
);

export type Transaction = typeof transactions.$inferSelect;

/* -------------------------------- Coupons -------------------------------- */

export const coupons = pgTable(
  "coupons",
  {
    id: serial("id").primaryKey(),
    code: varchar("code", { length: 32 }).notNull(),
    description: varchar("description", { length: 255 }),
    discountType: varchar("discountType", { length: 16, enum: ["percentage", "fixed"] as const }).notNull(),
    discountValue: decimal("discountValue", { precision: 12, scale: 2 }).notNull(),
    maxUses: integer("maxUses"),
    usedCount: integer("usedCount").default(0).notNull(),
    minOrderAmount: decimal("minOrderAmount", { precision: 12, scale: 2 }).default("0.00").notNull(),
    startsAt: timestamp("startsAt"),
    expiresAt: timestamp("expiresAt"),
    isActive: boolean("isActive").default(true).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("coupons_code_idx").on(t.code)],
);

export type Coupon = typeof coupons.$inferSelect;

/* -------------------------------- Messages ------------------------------- */

export const conversations = pgTable(
  "conversations",
  {
    id: serial("id").primaryKey(),
    customerId: integer("customerId").notNull(),
    providerId: integer("providerId").notNull(),
    bookingId: integer("bookingId"),
    lastMessageAt: timestamp("lastMessageAt").defaultNow().notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [
    index("conversations_customerId_idx").on(t.customerId),
    index("conversations_providerId_idx").on(t.providerId),
  ],
);

export type Conversation = typeof conversations.$inferSelect;

export const messages = pgTable(
  "messages",
  {
    id: serial("id").primaryKey(),
    conversationId: integer("conversationId").notNull(),
    senderId: integer("senderId").notNull(),
    content: text("content").notNull(),
    attachmentUrl: varchar("attachmentUrl", { length: 512 }),
    isRead: boolean("isRead").default(false).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [index("messages_conversationId_idx").on(t.conversationId)],
);

export type Message = typeof messages.$inferSelect;

/* ----------------------------- Support Tickets ---------------------------- */

export const supportTickets = pgTable(
  "support_tickets",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId").notNull(),
    subject: varchar("subject", { length: 255 }).notNull(),
    description: text("description").notNull(),
    category: varchar("category", {
      length: 32,
      enum: ["booking", "payment", "account", "provider", "other"] as const,
    })
      .default("other")
      .notNull(),
    status: varchar("status", { length: 32, enum: ["open", "in_progress", "resolved", "closed"] as const })
      .default("open")
      .notNull(),
    priority: varchar("priority", { length: 16, enum: ["low", "medium", "high", "urgent"] as const })
      .default("medium")
      .notNull(),
    assignedToUserId: integer("assignedToUserId"),
    /** Admin-only triage notes — not visible to the customer who filed the ticket. */
    internalNotes: text("internalNotes"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (t) => [index("support_tickets_userId_idx").on(t.userId), index("support_tickets_status_idx").on(t.status)],
);

export type SupportTicket = typeof supportTickets.$inferSelect;

/* ------------------------------- Audit Logs ------------------------------- */

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId"),
    action: varchar("action", { length: 128 }).notNull(),
    entityType: varchar("entityType", { length: 64 }),
    entityId: integer("entityId"),
    detail: jsonb("detail"),
    ipAddress: varchar("ipAddress", { length: 64 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [index("audit_logs_userId_idx").on(t.userId), index("audit_logs_action_idx").on(t.action)],
);

export type AuditLog = typeof auditLogs.$inferSelect;

/* ------------------------------ Portfolio -------------------------------- */

/**
 * Provider portfolio: previous work items with photo galleries, browsable by
 * customers on the provider's public profile.
 */
export const portfolioItems = pgTable(
  "portfolio_items",
  {
    id: serial("id").primaryKey(),
    providerId: integer("providerId").notNull(),
    categoryId: integer("categoryId"),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description"),
    /** Array of { url, kind: "before" | "after" | "general" }. */
    images: jsonb("images").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (t) => [
    index("portfolio_items_providerId_idx").on(t.providerId),
    index("portfolio_items_categoryId_idx").on(t.categoryId),
  ],
);

export type PortfolioItem = typeof portfolioItems.$inferSelect;
export type InsertPortfolioItem = typeof portfolioItems.$inferInsert;

/* ------------------------------ Negotiations ------------------------------- */
/* Physical tables stay named quote_requests/quote_offers in Postgres (renaming
 * them needs a migration and isn't visible to anyone) — only the TS bindings,
 * types, and every function/route/variable built on top are renamed to match
 * the product's actual name: price negotiation, not quote requesting. */

export const NEGOTIATION_STATUSES = ["open", "negotiating", "accepted", "rejected", "expired", "cancelled"] as const;

/** A customer's price negotiation with a provider over a service. */
export const negotiations = pgTable(
  "quote_requests",
  {
    id: serial("id").primaryKey(),
    /** Human-friendly reference, e.g. NEG-20260724-A1B2. */
    reference: varchar("reference", { length: 32 }).notNull(),
    customerId: integer("customerId").notNull(),
    providerId: integer("providerId").notNull(),
    serviceId: integer("serviceId").notNull(),
    /** Optional context — the primary flow is just an offer amount + message, not a job description. */
    description: text("description"),
    /** Array of photo URLs, if the customer attached any. */
    photos: jsonb("photos").$type<string[]>(),
    suggestedBudget: decimal("suggestedBudget", { precision: 12, scale: 2 }),
    preferredDate: varchar("preferredDate", { length: 10 }),
    preferredTime: varchar("preferredTime", { length: 5 }),
    addressId: integer("addressId"),
    status: varchar("status", { length: 32, enum: NEGOTIATION_STATUSES }).default("open").notNull(),
    /** Locked-in price once an offer is accepted. */
    agreedPrice: decimal("agreedPrice", { precision: 12, scale: 2 }),
    /** Booking created from the accepted negotiation. */
    bookingId: integer("bookingId"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("quote_requests_reference_idx").on(t.reference),
    index("quote_requests_customerId_idx").on(t.customerId),
    index("quote_requests_providerId_idx").on(t.providerId),
    index("quote_requests_status_idx").on(t.status),
  ],
);

export type Negotiation = typeof negotiations.$inferSelect;
export type InsertNegotiation = typeof negotiations.$inferInsert;

/** One offer/counter-offer round within a negotiation. */
export const negotiationOffers = pgTable(
  "quote_offers",
  {
    id: serial("id").primaryKey(),
    quoteRequestId: integer("quoteRequestId").notNull(),
    byRole: varchar("byRole", { length: 16, enum: ["customer", "provider"] as const }).notNull(),
    byUserId: integer("byUserId").notNull(),
    amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
    note: text("note"),
    status: varchar("status", {
      length: 16,
      enum: ["pending", "accepted", "rejected", "countered", "expired"] as const,
    })
      .default("pending")
      .notNull(),
    /** Providers can set a validity window (e.g. 24/48h). */
    expiresAt: timestamp("expiresAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [index("quote_offers_requestId_idx").on(t.quoteRequestId)],
);

export type NegotiationOffer = typeof negotiationOffers.$inferSelect;
export type InsertNegotiationOffer = typeof negotiationOffers.$inferInsert;
