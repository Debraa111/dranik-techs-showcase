/**
 * End-to-end tests for the enhancement pack:
 *  - Portfolio CRUD (provider) + public listing (customer)
 *  - Price negotiation: opening offer → provider counter → customer counter →
 *    accept → booking at the agreed price
 *  - Cannot accept your own offer; closing (reject/withdraw) ends the negotiation
 *  - Identity verification decision flow (verify / reject with reason)
 *  - Commission breakdown math (10% default)
 *
 * Requires a dedicated TEST_DATABASE_URL — skipped otherwise, so this suite
 * never writes to the real app database (see vitest.setup.ts, which
 * redirects DATABASE_URL to it for the duration of the test run).
 *
 * All rows created here are cleaned up in afterAll.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "dotenv/config";
import { eq, inArray } from "drizzle-orm";
import * as db from "../server/db";
import {
  bookingStatusHistory,
  bookings,
  categories,
  negotiationOffers,
  negotiations,
  notifications,
  portfolioItems,
  providerDocuments,
  providerProfiles,
  services,
  transactions,
  users,
  wallets,
} from "../drizzle/schema";

const hasDb = Boolean(process.env.TEST_DATABASE_URL);
const d = describe.runIf(hasDb);

const created = {
  customerId: 0,
  providerUserId: 0,
  providerId: 0,
  categoryId: 0,
  serviceId: 0,
  portfolioItemIds: [] as number[],
  negotiationIds: [] as number[],
  bookingIds: [] as number[],
};

async function makeUser(label: string, name: string) {
  return db.getOrCreateUserByAuthId(crypto.randomUUID(), { name, email: `${label}@test.dranik` }, { role: "user" });
}

d("E2E: portfolio, price negotiation & verification", () => {
  beforeAll(async () => {
    const dbi = await db.getDb();
    if (!dbi) throw new Error("no db");
    const customer = await makeUser(`e2en-customer-${Date.now()}`, "E2EN Customer");
    const providerUser = await makeUser(`e2en-provider-${Date.now()}`, "E2EN Provider");
    created.customerId = customer.id;
    created.providerUserId = providerUser.id;

    const [catRow] = await dbi
      .insert(categories)
      .values({ name: `E2EN Cat ${Date.now()}`, slug: `e2en-cat-${Date.now()}`, icon: "build", sortOrder: 998 })
      .returning({ id: categories.id });
    created.categoryId = catRow?.id ?? 0;

    created.providerId = await db.createProviderProfile({
      userId: created.providerUserId,
      businessName: "E2EN Plumbing",
      bio: "Test plumber",
      categoryId: created.categoryId,
      city: "Lagos",
      state: "Lagos",
      legalFirstName: "Quincy",
      legalLastName: "Tester",
      dateOfBirth: "1990-01-01",
      residentialAddress: "1 Test Close, Lagos",
    } as any);

    const svcId = await db.createService({
      providerId: created.providerId,
      categoryId: created.categoryId,
      title: "E2EN Custom Plumbing Job",
      description: "Negotiable-price plumbing work",
      basePrice: "50000.00",
    } as any);
    created.serviceId = svcId;
  });

  afterAll(async () => {
    const dbi = await db.getDb();
    if (!dbi) return;
    if (created.negotiationIds.length) {
      await dbi.delete(negotiationOffers).where(inArray(negotiationOffers.quoteRequestId, created.negotiationIds));
      await dbi.delete(negotiations).where(inArray(negotiations.id, created.negotiationIds));
    }
    if (created.bookingIds.length) {
      await dbi.delete(bookingStatusHistory).where(inArray(bookingStatusHistory.bookingId, created.bookingIds));
      await dbi.delete(bookings).where(inArray(bookings.id, created.bookingIds));
    }
    if (created.portfolioItemIds.length)
      await dbi.delete(portfolioItems).where(inArray(portfolioItems.id, created.portfolioItemIds));
    if (created.serviceId) await dbi.delete(services).where(eq(services.id, created.serviceId));
    if (created.providerId) {
      await dbi.delete(providerDocuments).where(eq(providerDocuments.providerId, created.providerId));
      await dbi.delete(providerProfiles).where(eq(providerProfiles.id, created.providerId));
    }
    if (created.categoryId) await dbi.delete(categories).where(eq(categories.id, created.categoryId));
    for (const uid of [created.customerId, created.providerUserId]) {
      if (!uid) continue;
      await dbi.delete(notifications).where(eq(notifications.userId, uid));
      const walletRows = await dbi.select().from(wallets).where(eq(wallets.userId, uid));
      for (const w of walletRows) {
        await dbi.delete(transactions).where(eq(transactions.walletId, w.id));
      }
      await dbi.delete(wallets).where(eq(wallets.userId, uid));
      await dbi.delete(users).where(eq(users.id, uid));
    }
  });

  it("1. provider can add and list portfolio items; customers see the same list", async () => {
    const item = await db.createPortfolioItem({
      providerId: created.providerId,
      title: "Bathroom renovation",
      description: "Full re-piping and fittings",
      images: [
        { url: "https://example.com/before.jpg", kind: "before" },
        { url: "https://example.com/after.jpg", kind: "after" },
      ],
    } as any);
    expect(item).toBeGreaterThan(0);
    created.portfolioItemIds.push(item);

    const list = await db.listPortfolioItems(created.providerId);
    expect(list.length).toBe(1);
    expect(list[0].title).toBe("Bathroom renovation");
    expect((list[0].images as any[]).length).toBe(2);
  });

  it("2. provider can delete own portfolio item, and only their own", async () => {
    const extra = await db.createPortfolioItem({
      providerId: created.providerId,
      title: "Temp item",
      images: [],
    } as any);
    const okForeign = await db.deletePortfolioItem(extra, created.providerId + 999999);
    expect(okForeign).toBe(false);
    const ok = await db.deletePortfolioItem(extra, created.providerId);
    expect(ok).toBe(true);
    const list = await db.listPortfolioItems(created.providerId);
    expect(list.find((i: any) => i.id === extra)).toBeUndefined();
  });

  it("3. customer makes an opening offer; provider sees it, opening offer already pending", async () => {
    const result = await db.createNegotiation({
      customerId: created.customerId,
      providerId: created.providerId,
      serviceId: created.serviceId,
      offerAmount: 40000,
      message: "Can you do it for 40k?",
      preferredDate: "2026-08-01",
      preferredTime: "10:00",
      photos: ["https://example.com/leak.jpg"],
    });
    expect(result.id).toBeGreaterThan(0);
    expect(result.reference).toMatch(/^NEG-/);
    created.negotiationIds.push(result.id);

    const forProvider = await db.listNegotiationsForProvider(created.providerId);
    expect(forProvider.some((r: any) => r.negotiation.id === result.id)).toBe(true);
    const forCustomer = await db.listNegotiationsForCustomer(created.customerId);
    expect(forCustomer.some((r: any) => r.negotiation.id === result.id)).toBe(true);

    // The offer amount is not optional — it's created atomically as the opening move.
    const detail = await db.getNegotiationById(result.id);
    expect(detail?.negotiation.status).toBe("negotiating");
    expect(detail?.offers.length).toBe(1);
    expect(detail?.offers[0].status).toBe("pending");
    expect(detail?.offers[0].byRole).toBe("customer");
    expect(Number(detail?.offers[0].amount)).toBe(40000);
  });

  it("4. provider counters the opening offer; previous offer is marked countered", async () => {
    const negotiationId = created.negotiationIds[0];
    const { offerId } = await db.addNegotiationOffer({
      negotiationId,
      byRole: "provider",
      byUserId: created.providerUserId,
      amount: 48000,
      note: "Best I can do with materials included",
      expiresInHours: 48,
    });
    expect(offerId).toBeGreaterThan(0);
    const detail = await db.getNegotiationById(negotiationId);
    expect(detail?.negotiation.status).toBe("negotiating");
    expect(detail?.offers.length).toBe(2);
    expect(detail?.offers[0].status).toBe("countered");
    expect(detail?.offers[1].status).toBe("pending");
    expect(detail?.offers[1].byRole).toBe("provider");
  });

  it("5. customer counters again; previous offer is marked countered", async () => {
    const negotiationId = created.negotiationIds[0];
    await db.addNegotiationOffer({
      negotiationId,
      byRole: "customer",
      byUserId: created.customerId,
      amount: 45000,
      note: "Can you meet me at 45k?",
    });
    const detail = await db.getNegotiationById(negotiationId);
    expect(detail?.offers.length).toBe(3);
    expect(detail?.offers[1].status).toBe("countered");
    expect(detail?.offers[2].status).toBe("pending");
    expect(Number(detail?.offers[2].amount)).toBe(45000);
  });

  it("6. customer cannot accept their own pending offer", async () => {
    const negotiationId = created.negotiationIds[0];
    await expect(
      db.acceptNegotiationOffer({
        negotiationId,
        acceptedByRole: "customer",
        acceptedByUserId: created.customerId,
      }),
    ).rejects.toThrow(/own offer/i);
  });

  it("7. provider accepts the customer's counter-offer; booking is created at the agreed price", async () => {
    const negotiationId = created.negotiationIds[0];
    const result = await db.acceptNegotiationOffer({
      negotiationId,
      acceptedByRole: "provider",
      acceptedByUserId: created.providerUserId,
    });
    expect(result.agreedPrice).toBe(45000);
    expect(result.bookingId).toBeGreaterThan(0);
    created.bookingIds.push(result.bookingId);

    const detail = await db.getNegotiationById(negotiationId);
    expect(detail?.negotiation.status).toBe("accepted");
    expect(Number(detail?.negotiation.agreedPrice)).toBe(45000);
    expect(detail?.negotiation.bookingId).toBe(result.bookingId);

    const bookingRow = await db.getBookingById(result.bookingId);
    expect(bookingRow).toBeTruthy();
    expect(Number(bookingRow!.booking.total)).toBe(45000);
    expect(bookingRow!.booking.status).toBe("confirmed");
    expect(bookingRow!.booking.scheduledDate).toBe("2026-08-01");
  });

  it("8. an accepted negotiation can no longer be countered or closed", async () => {
    const negotiationId = created.negotiationIds[0];
    await expect(
      db.addNegotiationOffer({
        negotiationId,
        byRole: "provider",
        byUserId: created.providerUserId,
        amount: 50000,
      }),
    ).rejects.toThrow(/no longer/i);
    await expect(
      db.closeNegotiation({ negotiationId, byRole: "customer", byUserId: created.customerId }),
    ).rejects.toThrow(/already/i);
  });

  it("9. provider can reject a fresh offer; customer can withdraw another", async () => {
    const n1 = await db.createNegotiation({
      customerId: created.customerId,
      providerId: created.providerId,
      serviceId: created.serviceId,
      offerAmount: 30000,
    });
    created.negotiationIds.push(n1.id);
    const r1 = await db.closeNegotiation({
      negotiationId: n1.id,
      byRole: "provider",
      byUserId: created.providerUserId,
    });
    expect(r1.status).toBe("rejected");

    const n2 = await db.createNegotiation({
      customerId: created.customerId,
      providerId: created.providerId,
      serviceId: created.serviceId,
      offerAmount: 32000,
    });
    created.negotiationIds.push(n2.id);
    const r2 = await db.closeNegotiation({
      negotiationId: n2.id,
      byRole: "customer",
      byUserId: created.customerId,
    });
    expect(r2.status).toBe("cancelled");
  });

  it("10. verification flow: reject with reason, then verify", async () => {
    await db.createProviderDocument({
      providerId: created.providerId,
      type: "government_id",
      idType: "nin",
      fileKey: "test/e2en-id.jpg",
      fileUrl: "https://example.com/id.jpg",
      fileName: "id.jpg",
      mimeType: "image/jpeg",
    } as any);

    await db.decideProviderVerification({
      providerId: created.providerId,
      decision: "rejected",
      rejectionReason: "ID photo is blurry",
    });
    let profile = await db.getProviderProfileById(created.providerId);
    expect(profile?.verificationStatus).toBe("rejected");
    expect((profile as any)?.rejectionReason).toContain("blurry");

    await db.decideProviderVerification({ providerId: created.providerId, decision: "verified" });
    profile = await db.getProviderProfileById(created.providerId);
    expect(profile?.verificationStatus).toBe("verified");
  });

  it("11. commission breakdown returns 10% split for the negotiated booking", async () => {
    const bookingId = created.bookingIds[0];
    const breakdown = await db.getBookingCommissionBreakdown(bookingId);
    expect(breakdown).toBeTruthy();
    expect(breakdown!.total).toBe(45000);
    expect(breakdown!.commissionRate).toBe(10);
    expect(breakdown!.commission).toBe(4500);
    expect(breakdown!.providerEarning).toBe(40500);
  });
});
