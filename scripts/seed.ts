/**
 * Seeds realistic sample data for local testing: categories, providers
 * (with profiles), services (with "what's included" checklists), fake
 * customers, and real completed bookings + reviews — all based in Asaba,
 * Delta State.
 *
 * Review ratings/counts are NOT set directly — they're computed from real
 * review rows via the same recomputeProviderRating() the live app uses
 * (see server/db.ts createReview), so the numbers shown in the app are
 * always backed by real review content, never a bare aggregate.
 *
 * Idempotent: safe to re-run. Categories are matched by slug, providers/
 * customers by email, services by (providerId, title); review seeding is
 * skipped per-provider once they already have at least one real review.
 *
 * Usage: npx tsx scripts/seed.ts
 */
import "./load-env.js";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { categories, providerProfiles, reviews, services, users } from "../src/drizzle/schema";
import * as appDb from "../src/server/db";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set (checked .env / .env.local / real env vars).");
  process.exit(1);
}

const isLocal = /(localhost|127\.0\.0\.1)/.test(process.env.DATABASE_URL);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? undefined : { rejectUnauthorized: false },
});
const db = drizzle(pool);

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/* --------------------------------- Data ---------------------------------- */

const CATEGORIES = [
  {
    name: "Home Services",
    slug: "home-services",
    icon: "home-repair-service",
    description: "Cleaning, plumbing, electrical, repairs and maintenance for your home.",
  },
  {
    name: "Beauty",
    slug: "beauty",
    icon: "content-cut",
    description: "Hair styling, makeup, nails and spa treatments.",
  },
  {
    name: "Healthcare",
    slug: "healthcare",
    icon: "local-hospital",
    description: "Home nursing, physiotherapy and wellness checks.",
  },
  {
    name: "Events",
    slug: "events",
    icon: "celebration",
    description: "Event planning, decoration and catering for every occasion.",
  },
] as const;

type SeedService = {
  title: string;
  description: string;
  basePrice: string;
  priceUnit: "fixed" | "hourly" | "per_session";
  durationMinutes: number;
  pricingMode?: "fixed_price" | "request_quote";
  imageSeed: string;
};

type SeedProvider = {
  name: string;
  email: string;
  phone: string;
  businessName: string;
  bio: string;
  yearsOfExperience: number;
  completedJobs: number;
  availabilityStatus: "available" | "busy" | "offline";
  categorySlug: string;
  lat: number;
  lng: number;
  avatarImg: number;
  services: SeedService[];
};

// Asaba city center ~6.1985 N, 6.6902 E — small offsets per provider for spread.
const PROVIDERS: SeedProvider[] = [
  {
    name: "Chukwuemeka Okafor",
    email: "emeka.okafor@example.com",
    phone: "+2348031234501",
    businessName: "Emeka's Home Repairs",
    bio: "Licensed plumber and general repairs technician with 8 years fixing homes across Asaba and Delta State. Fast, reliable, and no job too small.",
    yearsOfExperience: 8,
    completedJobs: 210,
    availabilityStatus: "available",
    categorySlug: "home-services",
    lat: 6.2015,
    lng: 6.6935,
    avatarImg: 13,
    services: [
      {
        title: "Plumbing Repair & Installation",
        description: "General plumbing repairs, pipe fitting and fixture installation.",
        basePrice: "8000.00",
        priceUnit: "fixed",
        durationMinutes: 90,
        imageSeed: "plumbing-repair",
      },
      {
        title: "Leaking Pipe Fix",
        description: "Quick diagnosis and repair of leaking or burst pipes.",
        basePrice: "5000.00",
        priceUnit: "fixed",
        durationMinutes: 60,
        imageSeed: "leaking-pipe",
      },
      {
        title: "Water Heater Installation",
        description: "Supply and installation of electric or gas water heaters.",
        basePrice: "25000.00",
        priceUnit: "fixed",
        durationMinutes: 120,
        imageSeed: "water-heater",
      },
    ],
  },
  {
    name: "Ngozi Adeyemi",
    email: "ngozi.adeyemi@example.com",
    phone: "+2348031234502",
    businessName: "Ngozi Cleaning Services",
    bio: "Professional home and office cleaning team serving Asaba since 2019. We bring our own equipment and eco-friendly products.",
    yearsOfExperience: 5,
    completedJobs: 380,
    availabilityStatus: "available",
    categorySlug: "home-services",
    lat: 6.1958,
    lng: 6.6871,
    avatarImg: 25,
    services: [
      {
        title: "Standard Home Cleaning (3 Bedroom)",
        description: "Full sweep, mop, dusting and bathroom cleaning for a 3-bedroom home.",
        basePrice: "10000.00",
        priceUnit: "fixed",
        durationMinutes: 180,
        imageSeed: "home-cleaning",
      },
      {
        title: "Deep Cleaning",
        description: "Thorough top-to-bottom clean including hard-to-reach areas.",
        basePrice: "18000.00",
        priceUnit: "fixed",
        durationMinutes: 240,
        imageSeed: "deep-cleaning",
      },
      {
        title: "Office Cleaning (Per Visit)",
        description: "Cleaning for small to medium office spaces.",
        basePrice: "15000.00",
        priceUnit: "fixed",
        durationMinutes: 180,
        imageSeed: "office-cleaning",
      },
    ],
  },
  {
    name: "Ifeanyi Obi",
    email: "ifeanyi.obi@example.com",
    phone: "+2348031234503",
    businessName: "Obi Electricals",
    bio: "Certified electrician specializing in wiring, installations and emergency repairs. Available for same-day callouts.",
    yearsOfExperience: 10,
    completedJobs: 190,
    availabilityStatus: "busy",
    categorySlug: "home-services",
    lat: 6.2072,
    lng: 6.7011,
    avatarImg: 33,
    services: [
      {
        title: "Electrical Wiring Inspection",
        description: "Safety inspection and diagnostics of household electrical wiring.",
        basePrice: "6000.00",
        priceUnit: "fixed",
        durationMinutes: 60,
        imageSeed: "wiring-inspection",
      },
      {
        title: "Socket & Switch Installation",
        description: "Installation or replacement of sockets, switches and outlets.",
        basePrice: "4000.00",
        priceUnit: "fixed",
        durationMinutes: 45,
        imageSeed: "socket-install",
      },
      {
        title: "Generator Repair & Servicing",
        description: "Diagnostics and repair for home generators. Price varies by fault.",
        basePrice: "12000.00",
        priceUnit: "fixed",
        durationMinutes: 90,
        pricingMode: "request_quote",
        imageSeed: "generator-repair",
      },
    ],
  },
  {
    name: "Chiamaka Nwosu",
    email: "chiamaka.nwosu@example.com",
    phone: "+2348031234504",
    businessName: "Chiamaka's Beauty Bar",
    bio: "Bridal makeup artist and beauty specialist with a passion for making every client glow. Trained in Lagos, based in Asaba.",
    yearsOfExperience: 6,
    completedJobs: 260,
    availabilityStatus: "available",
    categorySlug: "beauty",
    lat: 6.199,
    lng: 6.6889,
    avatarImg: 44,
    services: [
      {
        title: "Bridal Makeup",
        description: "Full bridal makeup package including trial consultation.",
        basePrice: "35000.00",
        priceUnit: "fixed",
        durationMinutes: 120,
        imageSeed: "bridal-makeup",
      },
      {
        title: "Everyday Makeup",
        description: "Natural, everyday makeup application.",
        basePrice: "8000.00",
        priceUnit: "fixed",
        durationMinutes: 45,
        imageSeed: "everyday-makeup",
      },
      {
        title: "Makeup Trial Session",
        description: "Trial session to plan your look ahead of a big event.",
        basePrice: "10000.00",
        priceUnit: "fixed",
        durationMinutes: 60,
        imageSeed: "makeup-trial",
      },
    ],
  },
  {
    name: "Blessing Eze",
    email: "blessing.eze@example.com",
    phone: "+2348031234505",
    businessName: "Blessing Hair Studio",
    bio: "Specialist in braiding, weaving and natural hair care. Over 400 happy clients across Asaba.",
    yearsOfExperience: 7,
    completedJobs: 400,
    availabilityStatus: "available",
    categorySlug: "beauty",
    lat: 6.2041,
    lng: 6.6802,
    avatarImg: 47,
    services: [
      {
        title: "Braiding (Medium Length)",
        description: "Classic braiding styles for medium-length hair.",
        basePrice: "6000.00",
        priceUnit: "fixed",
        durationMinutes: 150,
        imageSeed: "braiding",
      },
      {
        title: "Weave Installation",
        description: "Sew-in weave installation with styling.",
        basePrice: "12000.00",
        priceUnit: "fixed",
        durationMinutes: 120,
        imageSeed: "weave-install",
      },
      {
        title: "Natural Hair Treatment",
        description: "Deep conditioning and treatment for natural hair.",
        basePrice: "7500.00",
        priceUnit: "fixed",
        durationMinutes: 90,
        imageSeed: "natural-hair",
      },
    ],
  },
  {
    name: "Adaeze Umeh",
    email: "adaeze.umeh@example.com",
    phone: "+2348031234506",
    businessName: "Adaeze Nails & Spa",
    bio: "Full-service nail bar and relaxation spa. Gel, acrylics, pedicures and massages in a clean, comfortable studio.",
    yearsOfExperience: 4,
    completedJobs: 130,
    availabilityStatus: "available",
    categorySlug: "beauty",
    lat: 6.1927,
    lng: 6.6945,
    avatarImg: 9,
    services: [
      {
        title: "Gel Manicure",
        description: "Long-lasting gel polish manicure.",
        basePrice: "5000.00",
        priceUnit: "fixed",
        durationMinutes: 60,
        imageSeed: "gel-manicure",
      },
      {
        title: "Pedicure & Foot Spa",
        description: "Relaxing foot spa treatment with pedicure.",
        basePrice: "6000.00",
        priceUnit: "fixed",
        durationMinutes: 75,
        imageSeed: "pedicure-spa",
      },
      {
        title: "Full Body Massage",
        description: "Full body relaxation massage.",
        basePrice: "15000.00",
        priceUnit: "fixed",
        durationMinutes: 90,
        imageSeed: "body-massage",
      },
    ],
  },
  {
    name: "Uche Nwachukwu",
    email: "uche.nwachukwu@example.com",
    phone: "+2348031234507",
    businessName: "CarePlus Home Health",
    bio: "Registered nurse offering home visits for health checks, wound care, and elderly care support across Asaba.",
    yearsOfExperience: 12,
    completedJobs: 110,
    availabilityStatus: "available",
    categorySlug: "healthcare",
    lat: 6.2098,
    lng: 6.6923,
    avatarImg: 5,
    services: [
      {
        title: "Home Health Checkup",
        description: "General wellness checkup performed at home.",
        basePrice: "8000.00",
        priceUnit: "fixed",
        durationMinutes: 45,
        imageSeed: "health-checkup",
      },
      {
        title: "Blood Pressure & Diabetes Screening",
        description: "On-the-spot BP and blood sugar screening.",
        basePrice: "5000.00",
        priceUnit: "fixed",
        durationMinutes: 30,
        imageSeed: "bp-screening",
      },
      {
        title: "Elderly Care Visit (Per Session)",
        description: "In-home care and companionship visit for elderly clients.",
        basePrice: "12000.00",
        priceUnit: "per_session",
        durationMinutes: 120,
        imageSeed: "elderly-care",
      },
    ],
  },
  {
    name: "Grace Chukwu",
    email: "grace.chukwu@example.com",
    phone: "+2348031234508",
    businessName: "Grace Physiotherapy",
    bio: "Licensed physiotherapist helping clients recover from injury and manage chronic pain, with home visits available.",
    yearsOfExperience: 9,
    completedJobs: 95,
    availabilityStatus: "busy",
    categorySlug: "healthcare",
    lat: 6.1889,
    lng: 6.6968,
    avatarImg: 20,
    services: [
      {
        title: "Physiotherapy Session",
        description: "One-on-one physiotherapy session tailored to your needs.",
        basePrice: "10000.00",
        priceUnit: "fixed",
        durationMinutes: 60,
        imageSeed: "physiotherapy",
      },
      {
        title: "Post-Surgery Rehab (Per Session)",
        description: "Guided rehabilitation exercises following surgery.",
        basePrice: "12000.00",
        priceUnit: "per_session",
        durationMinutes: 75,
        imageSeed: "post-surgery-rehab",
      },
      {
        title: "Sports Injury Assessment",
        description: "Assessment and treatment plan for sports-related injuries.",
        basePrice: "8000.00",
        priceUnit: "fixed",
        durationMinutes: 45,
        imageSeed: "sports-injury",
      },
    ],
  },
  {
    name: "Emeka Obiora",
    email: "emeka.obiora@example.com",
    phone: "+2348031234509",
    businessName: "Royal Events Asaba",
    bio: "Full-service event planning and decoration for weddings, birthdays and corporate events. Let us bring your vision to life.",
    yearsOfExperience: 8,
    completedJobs: 140,
    availabilityStatus: "available",
    categorySlug: "events",
    lat: 6.2003,
    lng: 6.6841,
    avatarImg: 51,
    services: [
      {
        title: "Birthday Party Decoration",
        description: "Themed decoration setup for birthday parties.",
        basePrice: "45000.00",
        priceUnit: "fixed",
        durationMinutes: 240,
        imageSeed: "birthday-decor",
      },
      {
        title: "Wedding Planning (Full Package)",
        description: "End-to-end wedding planning and coordination. Price varies by scale.",
        basePrice: "300000.00",
        priceUnit: "fixed",
        durationMinutes: 480,
        pricingMode: "request_quote",
        imageSeed: "wedding-planning",
      },
      {
        title: "Venue Decoration (Small Event)",
        description: "Decoration setup for small to medium venues.",
        basePrice: "60000.00",
        priceUnit: "fixed",
        durationMinutes: 180,
        imageSeed: "venue-decor",
      },
    ],
  },
  {
    name: "Patience Okonkwo",
    email: "patience.okonkwo@example.com",
    phone: "+2348031234510",
    businessName: "Patience Catering & Events",
    bio: "Delicious Nigerian and continental catering for parties, weddings and corporate functions. Fresh ingredients, timely delivery.",
    yearsOfExperience: 11,
    completedJobs: 175,
    availabilityStatus: "available",
    categorySlug: "events",
    lat: 6.1946,
    lng: 6.6982,
    avatarImg: 29,
    services: [
      {
        title: "Small Party Catering (Per Plate, Min. 30)",
        description: "Nigerian and continental dishes, priced per plate for parties of 30+.",
        basePrice: "3000.00",
        priceUnit: "per_session",
        durationMinutes: 60,
        imageSeed: "party-catering",
      },
      {
        title: "Wedding Catering Package",
        description: "Full wedding catering package. Price varies by guest count and menu.",
        basePrice: "250000.00",
        priceUnit: "fixed",
        durationMinutes: 480,
        pricingMode: "request_quote",
        imageSeed: "wedding-catering",
      },
      {
        title: "Small Chops (Per Tray)",
        description: "Assorted small chops, sold per tray.",
        basePrice: "15000.00",
        priceUnit: "fixed",
        durationMinutes: 60,
        imageSeed: "small-chops",
      },
    ],
  },
];

const CHECKLISTS: Record<string, string[]> = {
  "Plumbing Repair & Installation": [
    "Leak & pipe diagnosis",
    "Repair or replacement of faulty parts",
    "Fixture installation (taps, sinks, toilets)",
    "Pressure testing",
    "Cleanup after work",
  ],
  "Leaking Pipe Fix": [
    "Leak diagnosis",
    "Pipe repair",
    "Pipe replacement",
    "Pressure testing",
    "Cleanup after repair",
  ],
  "Water Heater Installation": [
    "Old unit removal (if any)",
    "New heater mounting & wiring",
    "Safety valve check",
    "Test run & temperature check",
    "Cleanup after installation",
  ],
  "Standard Home Cleaning (3 Bedroom)": [
    "Dusting all surfaces",
    "Sweeping & mopping floors",
    "Bathroom & kitchen cleaning",
    "Trash removal",
    "Window sills wiped down",
  ],
  "Deep Cleaning": [
    "Full dusting & wipe-down",
    "Inside cabinet & appliance cleaning",
    "Grout & tile scrubbing",
    "Interior window cleaning",
    "Trash removal",
  ],
  "Office Cleaning (Per Visit)": [
    "Desk & surface wipe-down",
    "Floor sweeping & mopping",
    "Restroom sanitation",
    "Trash removal",
    "Common area tidy-up",
  ],
  "Electrical Wiring Inspection": [
    "Full circuit inspection",
    "Faulty wiring identification",
    "Safety compliance check",
    "Written inspection report",
    "Repair recommendations",
  ],
  "Socket & Switch Installation": [
    "Old fixture removal",
    "New socket/switch fitting",
    "Wiring safety check",
    "Function test",
    "Cleanup after work",
  ],
  "Generator Repair & Servicing": [
    "Fault diagnosis",
    "Parts cleaning or replacement",
    "Oil & filter check",
    "Test run under load",
    "Maintenance report",
  ],
  "Bridal Makeup": [
    "Pre-event consultation",
    "Skin prep & primer",
    "Full face makeup application",
    "False lashes application",
    "Touch-up kit for the day",
  ],
  "Everyday Makeup": ["Skin prep", "Natural makeup application", "Setting spray finish", "Product recommendations"],
  "Makeup Trial Session": [
    "Look consultation",
    "Full trial application",
    "Photos for reference",
    "Adjustments based on feedback",
  ],
  "Braiding (Medium Length)": ["Hair wash & prep", "Scalp treatment", "Braiding in chosen style", "Edge styling & finishing"],
  "Weave Installation": ["Hair prep & cornrow base", "Weave sew-in", "Styling & blending", "Edge & finishing touches"],
  "Natural Hair Treatment": ["Hair & scalp assessment", "Deep conditioning treatment", "Detangling", "Style finish"],
  "Gel Manicure": ["Nail shaping & buffing", "Cuticle care", "Gel polish application", "UV curing & finish"],
  "Pedicure & Foot Spa": ["Foot soak", "Callus removal", "Nail shaping & polish", "Foot massage"],
  "Full Body Massage": ["Pressure preference consultation", "Full body relaxation massage", "Aromatherapy oils", "Quiet recovery time"],
  "Home Health Checkup": [
    "Vital signs check",
    "General health assessment",
    "Health advice & recommendations",
    "Written summary report",
  ],
  "Blood Pressure & Diabetes Screening": [
    "Blood pressure reading",
    "Blood sugar test",
    "Result explanation",
    "Referral if needed",
  ],
  "Elderly Care Visit (Per Session)": [
    "Wellness check",
    "Medication reminder support",
    "Companionship",
    "Mobility assistance",
  ],
  "Physiotherapy Session": ["Mobility assessment", "Guided exercises", "Manual therapy", "Home exercise plan"],
  "Post-Surgery Rehab (Per Session)": [
    "Recovery assessment",
    "Guided rehab exercises",
    "Pain management guidance",
    "Progress tracking",
  ],
  "Sports Injury Assessment": ["Injury assessment", "Range-of-motion testing", "Treatment plan", "Recovery advice"],
  "Birthday Party Decoration": [
    "Theme consultation",
    "Balloon & backdrop setup",
    "Table & seating decor",
    "Setup & breakdown",
  ],
  "Wedding Planning (Full Package)": [
    "Full event coordination",
    "Vendor sourcing & management",
    "Day-of coordination",
    "Timeline planning",
  ],
  "Venue Decoration (Small Event)": ["Venue consultation", "Decor setup", "Lighting arrangement", "Breakdown after event"],
  "Small Party Catering (Per Plate, Min. 30)": [
    "Menu consultation",
    "Fresh ingredient sourcing",
    "On-time delivery",
    "Serving equipment provided",
  ],
  "Wedding Catering Package": [
    "Menu tasting session",
    "Full-day catering service",
    "Serving staff included",
    "Setup & cleanup",
  ],
  "Small Chops (Per Tray)": ["Freshly prepared chops", "Assorted selection", "Tray packaging", "Timely delivery"],
};

const CUSTOMERS = [
  { name: "Amaka Eze", email: "amaka.eze@example.com", avatarImg: 1 },
  { name: "Tunde Bakare", email: "tunde.bakare@example.com", avatarImg: 14 },
  { name: "Chidinma Okoro", email: "chidinma.okoro@example.com", avatarImg: 21 },
  { name: "Emmanuel Igwe", email: "emmanuel.igwe@example.com", avatarImg: 15 },
  { name: "Folake Adebayo", email: "folake.adebayo@example.com", avatarImg: 23 },
  { name: "Samuel Nnamdi", email: "samuel.nnamdi@example.com", avatarImg: 34 },
  { name: "Chinwe Okafor", email: "chinwe.okafor@example.com", avatarImg: 26 },
  { name: "David Etim", email: "david.etim@example.com", avatarImg: 52 },
  { name: "Kemi Adewale", email: "kemi.adewale@example.com", avatarImg: 27 },
  { name: "Ikenna Chukwu", email: "ikenna.chukwu@example.com", avatarImg: 60 },
  { name: "Rita Ossai", email: "rita.ossai@example.com", avatarImg: 28 },
  { name: "Bright Okonji", email: "bright.okonji@example.com", avatarImg: 55 },
  { name: "Ngozi Umeadi", email: "ngozi.umeadi@example.com", avatarImg: 24 },
  { name: "Peter Effiong", email: "peter.effiong@example.com", avatarImg: 61 },
  { name: "Blessing Nwankwo", email: "blessing.nwankwo@example.com", avatarImg: 30 },
  { name: "Sandra Achebe", email: "sandra.achebe@example.com", avatarImg: 31 },
] as const;

const REVIEW_POOLS: Record<string, string[]> = {
  "home-services": [
    "Fixed the issue quickly and explained everything clearly. Very professional.",
    "Arrived on time and did a neat job. Would book again.",
    "Solved a problem two other people couldn't. Highly recommend!",
    "Good work overall, just took a bit longer than expected.",
    "Reliable and honest pricing. No hidden charges.",
    "Very knowledgeable, cleaned up after the job too.",
    "Showed up exactly when promised. Rare these days.",
  ],
  beauty: [
    "Absolutely loved my look! Got so many compliments.",
    "Very skilled hands, gentle and patient throughout.",
    "The result exceeded my expectations. Booking again for my next event.",
    "Professional setup, used quality products.",
    "Great attention to detail, my hair has never looked better.",
    "A bit pricey but worth every naira for the quality.",
    "Made me feel so comfortable, will be my regular now.",
  ],
  healthcare: [
    "Very caring and thorough. Made me feel comfortable.",
    "Explained my results clearly and gave useful advice.",
    "Punctual and professional home visit.",
    "Great bedside manner, checked in after the visit too.",
    "Very knowledgeable and patient with my questions.",
    "Helped my grandmother a lot, will book monthly now.",
    "Calm, reassuring, and clearly experienced.",
  ],
  events: [
    "Made our event so beautiful, guests couldn't stop complimenting the decor.",
    "Everything was well organized and on time.",
    "Food was delicious and served hot, guests loved it.",
    "Great communication throughout the planning process.",
    "Exceeded expectations for the price, highly recommend.",
    "Professional team, handled everything smoothly.",
    "Handled a last-minute change without any stress. Impressive.",
  ],
};

const RATING_POOL = [5, 5, 5, 4, 4, 4, 5, 3, 5, 4] as const;
const TIME_SLOTS = ["09:00", "10:30", "12:00", "14:00", "15:30", "17:00"] as const;

/* -------------------------------- Helpers -------------------------------- */

async function upsertCategory(cat: (typeof CATEGORIES)[number]) {
  const existing = await db.select().from(categories).where(eq(categories.slug, cat.slug)).limit(1);
  if (existing[0]) {
    // Keep icon/name/description in sync with CATEGORIES on every run, so a
    // future correction here doesn't silently get stuck on stale DB rows again.
    const [updated] = await db
      .update(categories)
      .set({ name: cat.name, icon: cat.icon, description: cat.description })
      .where(eq(categories.id, existing[0].id))
      .returning();
    return updated;
  }

  const [inserted] = await db.insert(categories).values(cat).returning();
  return inserted;
}

async function upsertCustomer(c: (typeof CUSTOMERS)[number]) {
  const existing = await db.select().from(users).where(eq(users.email, c.email)).limit(1);
  if (existing[0]) return existing[0];

  const [inserted] = await db
    .insert(users)
    .values({
      authUserId: crypto.randomUUID(),
      name: c.name,
      email: c.email,
      avatarUrl: `https://i.pravatar.cc/300?img=${c.avatarImg}`,
      appRole: "customer",
      status: "active",
      emailVerified: true,
      phoneVerified: true,
    })
    .returning();
  return inserted;
}

async function upsertProvider(p: SeedProvider, categoryId: number) {
  const existingUser = await db.select().from(users).where(eq(users.email, p.email)).limit(1);
  let user = existingUser[0];

  if (!user) {
    const [insertedUser] = await db
      .insert(users)
      .values({
        authUserId: crypto.randomUUID(),
        name: p.name,
        email: p.email,
        phone: p.phone,
        avatarUrl: `https://i.pravatar.cc/300?img=${p.avatarImg}`,
        appRole: "provider",
        status: "active",
        emailVerified: true,
        phoneVerified: true,
      })
      .returning();
    user = insertedUser;
  }

  const existingProfile = await db
    .select()
    .from(providerProfiles)
    .where(eq(providerProfiles.userId, user.id))
    .limit(1);
  let profile = existingProfile[0];

  if (!profile) {
    const [firstName, ...rest] = p.name.split(" ");
    const [insertedProfile] = await db
      .insert(providerProfiles)
      .values({
        userId: user.id,
        businessName: p.businessName,
        bio: p.bio,
        yearsOfExperience: p.yearsOfExperience,
        verificationStatus: "verified",
        verifiedAt: new Date(),
        availabilityStatus: p.availabilityStatus,
        completedJobs: p.completedJobs,
        city: "Asaba",
        state: "Delta",
        latitude: p.lat.toFixed(7),
        longitude: p.lng.toFixed(7),
        firstName,
        lastName: rest.join(" "),
        phone: p.phone,
        email: p.email,
      })
      .returning();
    profile = insertedProfile;
  }

  const providerServiceRows: (typeof services.$inferSelect)[] = [];
  let created = 0;
  for (const svc of p.services) {
    const existingSvc = await db
      .select()
      .from(services)
      .where(and(eq(services.providerId, profile.id), eq(services.title, svc.title)))
      .limit(1);

    let serviceRow = existingSvc[0];
    if (!serviceRow) {
      const [inserted] = await db
        .insert(services)
        .values({
          providerId: profile.id,
          categoryId,
          title: svc.title,
          description: svc.description,
          basePrice: svc.basePrice,
          priceUnit: svc.priceUnit,
          durationMinutes: svc.durationMinutes,
          pricingMode: svc.pricingMode ?? "fixed_price",
          // No imageUrl: Lorem Picsum's /seed/ endpoint ignores the seed's meaning and
          // just deterministically picks an arbitrary stock photo, so it rendered as
          // unrelated desert/train/landscape photos instead of anything service-relevant.
          // The UI falls back to the category icon when imageUrl is unset — honest,
          // not fabricated. imageSeed is kept on each entry for future real-photo curation.
          isActive: true,
        })
        .returning();
      serviceRow = inserted;
      created++;
    }

    // Idempotent to re-apply: same deterministic content every run.
    const checklist = CHECKLISTS[svc.title];
    if (checklist) {
      await db.update(services).set({ included: checklist }).where(eq(services.id, serviceRow.id));
    }

    providerServiceRows.push(serviceRow);
  }

  return { user, profile, servicesCreated: created, providerServiceRows };
}

/** Seeds a handful of completed bookings + reviews for a provider, skipping if they already have any. */
async function seedReviewsForProvider(
  profile: typeof providerProfiles.$inferSelect,
  providerServices: (typeof services.$inferSelect)[],
  categorySlug: string,
  customers: (typeof users.$inferSelect)[],
) {
  const existingCount = await db
    .select({ cnt: sql<number>`count(*)` })
    .from(reviews)
    .where(eq(reviews.providerId, profile.id));
  if (Number(existingCount[0]?.cnt ?? 0) > 0) return 0;

  const pool = REVIEW_POOLS[categorySlug] ?? REVIEW_POOLS["home-services"];
  const reviewTargetCount = 6 + Math.floor(Math.random() * 7); // 6–12

  for (let i = 0; i < reviewTargetCount; i++) {
    const customer = pick(customers);
    const service = pick(providerServices);
    const bookedDaysAgo = 3 + Math.floor(Math.random() * 87); // 3–90 days ago
    const bookedAt = daysAgo(bookedDaysAgo);
    const bookingDateStr = bookedAt.toISOString().slice(0, 10);

    const { id: bookingId } = await appDb.createBooking({
      customerId: customer.id,
      providerId: profile.id,
      serviceId: service.id,
      status: "completed",
      scheduledDate: bookingDateStr,
      scheduledTime: pick(TIME_SLOTS),
      subtotal: service.basePrice,
      total: service.basePrice,
      paymentStatus: "paid",
      completedAt: bookedAt,
      createdAt: bookedAt,
    });

    await appDb.createReview({
      bookingId,
      customerId: customer.id,
      providerId: profile.id,
      rating: pick(RATING_POOL),
      comment: pick(pool),
      createdAt: daysAgo(bookedDaysAgo - 1 >= 0 ? bookedDaysAgo - 1 : 0),
    });
  }

  return reviewTargetCount;
}

/* ---------------------------------- Main ---------------------------------- */

async function main() {
  console.log("Seeding categories...");
  const categoryIdBySlug = new Map<string, number>();
  for (const cat of CATEGORIES) {
    const row = await upsertCategory(cat);
    categoryIdBySlug.set(cat.slug, row.id);
    console.log(`  ${cat.name} -> id ${row.id}`);
  }

  console.log("Seeding customers...");
  const customers = [];
  for (const c of CUSTOMERS) {
    customers.push(await upsertCustomer(c));
  }
  console.log(`  ${customers.length} customers ready`);

  console.log("Seeding providers + services...");
  for (const p of PROVIDERS) {
    const categoryId = categoryIdBySlug.get(p.categorySlug);
    if (!categoryId) throw new Error(`Unknown category slug: ${p.categorySlug}`);

    const { profile, servicesCreated, providerServiceRows } = await upsertProvider(p, categoryId);
    console.log(`  ${p.businessName} -> provider id ${profile.id} (${servicesCreated} new services)`);

    const reviewsCreated = await seedReviewsForProvider(profile, providerServiceRows, p.categorySlug, customers);
    if (reviewsCreated > 0) {
      console.log(`    + ${reviewsCreated} bookings & reviews seeded`);
    }
  }

  console.log("Done.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
