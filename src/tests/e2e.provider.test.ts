/**
 * End-to-end provider flow integration tests.
 *
 * Covers the provider app surface: onboarding (profile creation + role switch),
 * service management (create/update/deactivate), booking accept → complete with
 * earning credit (total − commission), dashboard stats, earnings summary,
 * withdrawals, verification documents, and provider-side conversations.
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
  bookingCancellationRequests,
  bookingStatusHistory,
  bookings,
  categories,
  conversations,
  messages,
  notifications,
  payments,
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
  serviceIds: [] as number[],
  bookingIds: [] as number[],
  conversationIds: [] as number[],
};

async function makeUser(label: string, name: string) {
  return db.getOrCreateUserByAuthId(crypto.randomUUID(), { name, email: `${label}@test.dranik` }, { role: "user" });
}

d("E2E: provider flows", () => {
  beforeAll(async () => {
    const dbi = await db.getDb();
    if (!dbi) throw new Error("no db");
    const customer = await makeUser(`e2ep-customer-${Date.now()}`, "E2EP Customer");
    const providerUser = await makeUser(`e2ep-provider-${Date.now()}`, "E2EP Provider");
    created.customerId = customer.id;
    created.providerUserId = providerUser.id;

    const [catRow] = await dbi
      .insert(categories)
      .values({ name: `E2EP Cat ${Date.now()}`, slug: `e2ep-cat-${Date.now()}`, icon: "build", sortOrder: 999 })
      .returning({ id: categories.id });
    created.categoryId = catRow?.id ?? 0;
  });

  afterAll(async () => {
    const dbi = await db.getDb();
    if (!dbi) return;
    if (created.conversationIds.length) {
      await dbi.delete(messages).where(inArray(messages.conversationId, created.conversationIds));
      await dbi.delete(conversations).where(inArray(conversations.id, created.conversationIds));
    }
    if (created.bookingIds.length) {
      await dbi.delete(payments).where(inArray(payments.bookingId, created.bookingIds));
      await dbi.delete(bookingStatusHistory).where(inArray(bookingStatusHistory.bookingId, created.bookingIds));
      await dbi.delete(bookingCancellationRequests).where(inArray(bookingCancellationRequests.bookingId, created.bookingIds));
      await dbi.delete(bookings).where(inArray(bookings.id, created.bookingIds));
    }
    if (created.serviceIds.length) await dbi.delete(services).where(inArray(services.id, created.serviceIds));
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

  it("1. onboarding creates a provider profile and switches appRole", async () => {
    const id = await db.createProviderProfile({
      userId: created.providerUserId,
      businessName: "E2EP Electrics",
      bio: "Test electrician",
      yearsOfExperience: 4,
      city: "Ikeja",
      state: "Lagos",
    });
    created.providerId = id;
    expect(id).toBeGreaterThan(0);

    const profile = await db.getProviderProfileByUserId(created.providerUserId);
    expect(profile).toBeTruthy();
    expect(profile!.businessName).toBe("E2EP Electrics");
    expect(profile!.verificationStatus).toBe("unverified");

    const dbi = await db.getDb();
    const userRows = await dbi!.select().from(users).where(eq(users.id, created.providerUserId)).limit(1);
    expect(userRows[0].appRole).toBe("provider");
  });

  it("2. provider can create, update, and deactivate services", async () => {
    const serviceId = await db.createService({
      providerId: created.providerId,
      categoryId: created.categoryId,
      title: "E2EP Wiring Fix",
      description: "Fix wiring",
      basePrice: "20000.00",
      priceUnit: "fixed",
      isActive: true,
    });
    created.serviceIds.push(serviceId);
    expect(serviceId).toBeGreaterThan(0);

    await db.updateService(serviceId, { title: "E2EP Wiring Fix Pro", basePrice: "25000.00" });
    let row = await db.getServiceById(serviceId);
    expect(row!.service.title).toBe("E2EP Wiring Fix Pro");
    expect(Number(row!.service.basePrice)).toBe(25000);

    await db.deactivateService(serviceId);
    row = await db.getServiceById(serviceId);
    expect(row!.service.isActive).toBe(false);

    // Deactivated service no longer appears in public listings
    const listed = await db.listServices({ providerId: created.providerId });
    expect(listed.some((r: any) => r.service.id === serviceId)).toBe(false);

    // Reactivate for the booking tests below
    await db.updateService(serviceId, { isActive: true });
  });

  it("3. completing a PAID booking holds the payout until the handoff code is confirmed", async () => {
    const serviceId = created.serviceIds[0];
    const { id: bookingId } = await db.createBooking({
      customerId: created.customerId,
      providerId: created.providerId,
      serviceId,
      scheduledDate: "2026-08-10",
      scheduledTime: "10:00",
      subtotal: "25000.00",
      discount: "0.00",
      total: "25000.00",
    });
    created.bookingIds.push(bookingId);

    // Mark paid (mock payment path)
    const dbi = await db.getDb();
    await dbi!.update(bookings).set({ paymentStatus: "paid" }).where(eq(bookings.id, bookingId));

    const before = await db.getOrCreateWallet(created.providerUserId);

    await db.updateBookingStatus({ bookingId, toStatus: "confirmed", changedByUserId: created.providerUserId });
    await db.updateBookingStatus({ bookingId, toStatus: "in_progress", changedByUserId: created.providerUserId });
    const completeResult = await db.updateBookingStatus({
      bookingId,
      toStatus: "completed",
      changedByUserId: created.providerUserId,
    });

    // Completing does NOT credit the wallet yet — payout is held behind the release code.
    expect(completeResult.releaseCode).toMatch(/^\d{5}$/);
    const heldWallet = await db.getOrCreateWallet(created.providerUserId);
    expect(Number(heldWallet.balance)).toBe(Number(before.balance));

    const heldRow = (await dbi!.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1))[0];
    expect(heldRow.payoutStatus).toBe("held");
    expect(heldRow.releaseCodeHash).toBeTruthy();
    expect(heldRow.releaseCodeHash).not.toBe(completeResult.releaseCode); // never stored in plain text

    // Wrong code: rejected, does not release, increments the attempt counter
    const wrongCode = completeResult.releaseCode === "12345" ? "54321" : "12345";
    const wrongAttempt = await db.confirmReleaseCode({
      bookingId,
      providerUserId: created.providerUserId,
      code: wrongCode,
    });
    expect(wrongAttempt.success).toBe(false);
    const stillHeldWallet = await db.getOrCreateWallet(created.providerUserId);
    expect(Number(stillHeldWallet.balance)).toBe(Number(before.balance));

    // Correct code releases the hold — default commission = 10% → earning = 22500
    const confirmResult = await db.confirmReleaseCode({
      bookingId,
      providerUserId: created.providerUserId,
      code: completeResult.releaseCode!,
    });
    expect(confirmResult.success).toBe(true);
    if (confirmResult.success) expect(confirmResult.earning).toBe(22500);

    const after = await db.getOrCreateWallet(created.providerUserId);
    expect(Number(after.balance)).toBe(Number(before.balance) + 22500);

    const txs = await db.listTransactions(created.providerUserId);
    const earning = txs.find((t: any) => t.category === "booking_earning" && t.bookingId === bookingId);
    expect(earning).toBeTruthy();
    expect(Number(earning!.amount)).toBe(22500);

    const releasedRow = (await dbi!.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1))[0];
    expect(releasedRow.payoutStatus).toBe("released");
    expect(releasedRow.payoutReleasedBy).toBe(created.providerUserId);

    // Idempotency: confirming again (even with the right code) does nothing further
    const res = await db.confirmReleaseCode({
      bookingId,
      providerUserId: created.providerUserId,
      code: completeResult.releaseCode!,
    });
    expect(res.success).toBe(false);
    const finalWallet = await db.getOrCreateWallet(created.providerUserId);
    expect(Number(finalWallet.balance)).toBe(Number(after.balance));
  });

  it("4. unpaid completed bookings do NOT credit the provider", async () => {
    const serviceId = created.serviceIds[0];
    const { id: bookingId } = await db.createBooking({
      customerId: created.customerId,
      providerId: created.providerId,
      serviceId,
      scheduledDate: "2026-08-11",
      scheduledTime: "12:00",
      subtotal: "25000.00",
      discount: "0.00",
      total: "25000.00",
    });
    created.bookingIds.push(bookingId);

    const before = await db.getOrCreateWallet(created.providerUserId);
    await db.updateBookingStatus({ bookingId, toStatus: "confirmed", changedByUserId: created.providerUserId });
    await db.updateBookingStatus({ bookingId, toStatus: "in_progress", changedByUserId: created.providerUserId });
    await db.updateBookingStatus({ bookingId, toStatus: "completed", changedByUserId: created.providerUserId });
    const after = await db.getOrCreateWallet(created.providerUserId);
    expect(Number(after.balance)).toBe(Number(before.balance));
  });

  it("5. dashboard stats aggregate correctly", async () => {
    const stats = await db.getProviderDashboardStats(created.providerId, created.providerUserId);
    expect(stats.completed).toBe(2);
    expect(stats.completedJobs).toBe(2);
    expect(stats.pendingRequests).toBe(0);
    expect(stats.walletBalance).toBe(22500);
    expect(stats.earningsThisMonth).toBe(22500);
  });

  it("6. earnings summary and withdrawal keep the ledger consistent", async () => {
    const earnings = await db.getProviderEarnings(created.providerUserId);
    expect(earnings.balance).toBe(22500);
    expect(earnings.allTime).toBe(22500);
    expect(earnings.transactions.length).toBeGreaterThan(0);

    // Withdrawal
    await db.recordTransaction({
      userId: created.providerUserId,
      type: "debit",
      category: "withdrawal",
      amount: 10000,
      description: "E2EP withdrawal",
    });
    const after = await db.getProviderEarnings(created.providerUserId);
    expect(after.balance).toBe(12500);
    // Earnings totals unaffected by withdrawals
    expect(after.allTime).toBe(22500);
  });

  it("7. document upload marks verification pending", async () => {
    const docId = await db.createProviderDocument({
      providerId: created.providerId,
      type: "government_id",
      fileKey: "test/e2ep-id.jpg",
      fileUrl: "https://example.com/e2ep-id.jpg",
      fileName: "e2ep-id.jpg",
      mimeType: "image/jpeg",
    });
    expect(docId).toBeGreaterThan(0);

    await db.submitProviderForVerification(created.providerId);
    const profile = await db.getProviderProfileByUserId(created.providerUserId);
    expect(profile!.verificationStatus).toBe("pending");

    const docs = await db.listProviderDocuments(created.providerId);
    expect(docs.length).toBe(1);
    expect(docs[0].status).toBe("pending");
  });

  it("8. provider-side conversation works for a booking", async () => {
    const conv = await db.getOrCreateConversation({
      customerId: created.customerId,
      providerId: created.providerId,
      bookingId: created.bookingIds[0],
    });
    created.conversationIds.push(conv.id);
    expect(conv.id).toBeGreaterThan(0);

    // Same conversation is reused (no duplicates)
    const again = await db.getOrCreateConversation({
      customerId: created.customerId,
      providerId: created.providerId,
    });
    expect(again.id).toBe(conv.id);

    // Provider sends a message; both sides see the conversation
    await db.createMessage({
      conversationId: conv.id,
      senderId: created.providerUserId,
      content: "Hello, I will arrive at 10am.",
    });
    const providerConvs = await db.listConversationsForUser(created.providerUserId);
    const customerConvs = await db.listConversationsForUser(created.customerId);
    expect(providerConvs.some((c: any) => c.conversation.id === conv.id)).toBe(true);
    expect(customerConvs.some((c: any) => c.conversation.id === conv.id)).toBe(true);
  });

  it("9. provider bookings list shows customer info for all bookings", async () => {
    const rows = await db.listBookingsForProvider(created.providerId);
    expect(rows.length).toBe(2);
    for (const row of rows) {
      expect(row.customer.id).toBe(created.customerId);
      expect(row.service.providerId).toBe(created.providerId);
    }
  });

  it("10. cancellation requests can only be filed while in_progress, and can't be duplicated", async () => {
    const serviceId = created.serviceIds[0];
    const { id: bookingId } = await db.createBooking({
      customerId: created.customerId,
      providerId: created.providerId,
      serviceId,
      scheduledDate: "2026-08-12",
      scheduledTime: "09:00",
      subtotal: "25000.00",
      discount: "0.00",
      total: "25000.00",
    });
    created.bookingIds.push(bookingId);
    const dbi = await db.getDb();
    await dbi!.update(bookings).set({ paymentStatus: "paid" }).where(eq(bookings.id, bookingId));
    await db.updateBookingStatus({ bookingId, toStatus: "confirmed", changedByUserId: created.providerUserId });

    // Not yet in_progress — filing should be rejected.
    await expect(
      db.requestBookingCancellation({
        bookingId,
        requestedByUserId: created.customerId,
        requestedByRole: "customer",
        reason: "Too early to cancel this way",
      }),
    ).rejects.toThrow(/in progress/);

    await db.updateBookingStatus({ bookingId, toStatus: "in_progress", changedByUserId: created.providerUserId });

    const { id: requestId } = await db.requestBookingCancellation({
      bookingId,
      requestedByUserId: created.customerId,
      requestedByRole: "customer",
      reason: "Provider ran into a scheduling conflict",
    });
    expect(requestId).toBeGreaterThan(0);

    // Booking status is untouched by merely filing a request.
    const midRow = (await dbi!.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1))[0];
    expect(midRow.status).toBe("in_progress");

    const pending = await db.getPendingCancellationRequest(bookingId);
    expect(pending).toBeTruthy();
    expect(pending!.id).toBe(requestId);

    const queue = await db.listCancellationRequests("pending");
    expect(queue.some((r: any) => r.request.id === requestId)).toBe(true);

    // A second request on the same booking, while one is already pending, is rejected.
    await expect(
      db.requestBookingCancellation({
        bookingId,
        requestedByUserId: created.providerUserId,
        requestedByRole: "provider",
        reason: "Also want to cancel",
      }),
    ).rejects.toThrow(/already pending/);

    // Admin rejects the request — booking is untouched, request leaves the pending queue.
    const rejectResult = await db.decideCancellationRequest({
      requestId,
      adminUserId: created.customerId, // no dedicated admin fixture in this suite; only the id is used for attribution
      decision: "reject",
      reviewNote: "Not a valid reason to skip the normal flow",
    });
    expect(rejectResult.success).toBe(true);

    const afterReject = (await dbi!.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1))[0];
    expect(afterReject.status).toBe("in_progress");
    expect(await db.getPendingCancellationRequest(bookingId)).toBeNull();

    // Deciding an already-decided request is rejected, not silently repeated.
    const redecide = await db.decideCancellationRequest({
      requestId,
      adminUserId: created.customerId,
      decision: "reject",
    });
    expect(redecide).toEqual({ success: false, reason: "already_decided" });
  });

  it("11. approving a cancellation request splits refund/payout and cancels the booking", async () => {
    const serviceId = created.serviceIds[0];
    const { id: bookingId } = await db.createBooking({
      customerId: created.customerId,
      providerId: created.providerId,
      serviceId,
      scheduledDate: "2026-08-13",
      scheduledTime: "14:00",
      subtotal: "25000.00",
      discount: "0.00",
      total: "25000.00",
    });
    created.bookingIds.push(bookingId);
    const dbi = await db.getDb();
    await dbi!.update(bookings).set({ paymentStatus: "paid" }).where(eq(bookings.id, bookingId));
    await db.updateBookingStatus({ bookingId, toStatus: "confirmed", changedByUserId: created.providerUserId });
    await db.updateBookingStatus({ bookingId, toStatus: "in_progress", changedByUserId: created.providerUserId });

    const { id: requestId } = await db.requestBookingCancellation({
      bookingId,
      requestedByUserId: created.providerUserId,
      requestedByRole: "provider",
      reason: "Emergency came up, can't finish the job",
    });

    const customerBefore = await db.getOrCreateWallet(created.customerId);
    const providerBefore = await db.getOrCreateWallet(created.providerUserId);

    // Refund + payout must not exceed the booking total.
    await expect(
      db.decideCancellationRequest({
        requestId,
        adminUserId: created.customerId,
        decision: "approve",
        refundAmount: 20000,
        providerPayoutAmount: 10000,
      }),
    ).rejects.toThrow(/can't exceed/);

    // Half the work was done: split 15000 refund / 10000 partial payout (no commission deducted
    // from an admin-decided amount — see decideCancellationRequest's own comment on why).
    const decideResult = await db.decideCancellationRequest({
      requestId,
      adminUserId: created.customerId,
      decision: "approve",
      reviewNote: "Confirmed half the job was completed before the emergency",
      refundAmount: 15000,
      providerPayoutAmount: 10000,
    });
    expect(decideResult).toEqual({ success: true, refundAmount: 15000, providerPayoutAmount: 10000 });

    const customerAfter = await db.getOrCreateWallet(created.customerId);
    const providerAfter = await db.getOrCreateWallet(created.providerUserId);
    expect(Number(customerAfter.balance)).toBe(Number(customerBefore.balance) + 15000);
    expect(Number(providerAfter.balance)).toBe(Number(providerBefore.balance) + 10000);

    const finalRow = (await dbi!.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1))[0];
    expect(finalRow.status).toBe("cancelled");
    expect(finalRow.paymentStatus).toBe("refunded");

    const requestRow = (
      await dbi!.select().from(bookingCancellationRequests).where(eq(bookingCancellationRequests.id, requestId)).limit(1)
    )[0];
    expect(requestRow.status).toBe("approved");
    expect(Number(requestRow.refundAmount)).toBe(15000);
    expect(Number(requestRow.providerPayoutAmount)).toBe(10000);

    // The booking is no longer in_progress, so a second approve attempt (e.g. a stale
    // admin tab) is rejected rather than double-paying.
    const [{ id: requestId2 }] = await dbi!
      .insert(bookingCancellationRequests)
      .values({
        bookingId,
        requestedByUserId: created.customerId,
        requestedByRole: "customer",
        reason: "Stale duplicate request row for the not-in-progress guard",
      })
      .returning({ id: bookingCancellationRequests.id });
    const staleResult = await db.decideCancellationRequest({
      requestId: requestId2,
      adminUserId: created.customerId,
      decision: "approve",
      refundAmount: 5000,
      providerPayoutAmount: 0,
    });
    expect(staleResult).toEqual({ success: false, reason: "booking_no_longer_in_progress" });
  });
});
