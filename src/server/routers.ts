import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { systemRouter } from "./_core/systemRouter";
import { adminPermissionProcedure, adminProcedure, protectedProcedure, providerProcedure, publicProcedure, router } from "./_core/trpc";
import { userRateLimit } from "./_core/rate-limit";
import * as db from "./db";
import { sdk } from "./_core/sdk";
import { getPaymentGateway } from "./services/payment";
import { ADMIN_ROLES } from "../drizzle/schema";

const HOUR_MS = 60 * 60 * 1000;
const FIFTEEN_MIN_MS = 15 * 60 * 1000;

/* ----------------------------- Input schemas ------------------------------ */

const idSchema = z.number().int().positive();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const timeSchema = z.string().regex(/^\d{2}:\d{2}$/, "Use HH:mm");

/* --------------------------------- Routers -------------------------------- */

export const appRouter = router({
  system: systemRouter,

  /** Minimal-surface public config the client needs before a booking exists — just
   *  the current fee, not the whole admin platformSettings row. */
  config: router({
    bookingFee: publicProcedure.query(async () => {
      const settings = await db.getPlatformSettings();
      return { enabled: settings.bookingFeeEnabled, amount: Number(settings.bookingFeeAmount) };
    }),
  }),

  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    /** Client should call supabase.auth.signOut() directly — this is a no-op kept for API compatibility. */
    logout: publicProcedure.mutation(() => {
      return { success: true } as const;
    }),
    updateProfile: protectedProcedure
      .input(
        z.object({
          name: z.string().min(1).max(255).optional(),
          phone: z.string().min(7).max(32).optional(),
          avatarUrl: z.string().url().max(512).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await db.updateUserProfile(ctx.user.id, input);
        await db.logAudit({ userId: ctx.user.id, action: "user.update_profile" });
        return { success: true } as const;
      }),
    /**
     * Deletes the app-side user row. Does NOT remove the underlying Supabase
     * auth identity — that requires the Supabase admin API (service_role
     * key), which isn't wired up here yet.
     */
    deleteAccount: protectedProcedure.mutation(async ({ ctx }) => {
      await db.deleteUserAccount(ctx.user.id);
      await db.logAudit({ userId: ctx.user.id, action: "user.delete_account" });
      return { success: true } as const;
    }),
  }),

  categories: router({
    list: publicProcedure.query(() => db.listCategories()),
  }),

  services: router({
    list: publicProcedure
      .input(
        z
          .object({
            categoryId: idSchema.optional(),
            search: z.string().max(128).optional(),
            verifiedOnly: z.boolean().optional(),
            limit: z.number().int().min(1).max(100).optional(),
            offset: z.number().int().min(0).optional(),
          })
          .optional(),
      )
      .query(({ input }) => db.listServices(input ?? {})),
    trending: publicProcedure
      .input(z.object({ limit: z.number().int().min(1).max(20).optional() }).optional())
      .query(({ input }) => db.listTrendingServices(input?.limit ?? 10)),
    recommended: protectedProcedure
      .input(z.object({ limit: z.number().int().min(1).max(20).optional() }).optional())
      .query(({ ctx, input }) => db.listRecommendedServices(ctx.user.id, input?.limit ?? 10)),
    byId: publicProcedure.input(z.object({ id: idSchema })).query(async ({ input }) => {
      const service = await db.getServiceById(input.id);
      if (!service) throw new TRPCError({ code: "NOT_FOUND", message: "Service not found" });
      return service;
    }),
    reviews: publicProcedure
      .input(z.object({ providerId: idSchema }))
      .query(({ input }) => db.listReviewsForProvider(input.providerId)),
  }),

  providers: router({
    featured: publicProcedure
      .input(z.object({ limit: z.number().int().min(1).max(20).optional() }).optional())
      .query(({ input }) => db.listFeaturedProviders(input?.limit ?? 8)),
    publicProfile: publicProcedure.input(z.object({ id: idSchema })).query(async ({ input }) => {
      const profile = await db.getProviderPublicProfile(input.id);
      if (!profile) throw new TRPCError({ code: "NOT_FOUND", message: "Provider not found" });
      return profile;
    }),
    activity: publicProcedure
      .input(z.object({ providerId: idSchema }))
      .query(({ input }) => db.getProviderActivity(input.providerId)),
  }),

  reviews: router({
    mine: protectedProcedure.query(({ ctx }) => db.listMyReviews(ctx.user.id)),
    update: protectedProcedure
      .input(
        z.object({
          reviewId: idSchema,
          rating: z.number().int().min(1).max(5).optional(),
          comment: z.string().max(2000).nullable().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const updated = await db.updateReview(input.reviewId, ctx.user.id, {
          rating: input.rating,
          comment: input.comment,
        });
        if (!updated) throw new TRPCError({ code: "FORBIDDEN", message: "Cannot edit this review" });
        return { success: true };
      }),
    remove: protectedProcedure
      .input(z.object({ reviewId: idSchema }))
      .mutation(async ({ ctx, input }) => {
        const ok = await db.deleteReview(input.reviewId, ctx.user.id);
        if (!ok) throw new TRPCError({ code: "FORBIDDEN", message: "Cannot delete this review" });
        return { success: true };
      }),
  }),

  messages: router({
    conversations: protectedProcedure.query(({ ctx }) => db.listConversationsForUser(ctx.user.id)),
    start: protectedProcedure
      .input(z.object({ providerId: idSchema, bookingId: idSchema.optional() }))
      .mutation(({ ctx, input }) =>
        db.getOrCreateConversation({
          customerId: ctx.user.id,
          providerId: input.providerId,
          bookingId: input.bookingId ?? null,
        }),
      ),
    list: protectedProcedure
      .input(z.object({ conversationId: idSchema }))
      .query(async ({ ctx, input }) => {
        const conversation = await db.getConversationById(input.conversationId);
        if (!conversation) throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
        const myProviderProfile = await db.getProviderProfileByUserId(ctx.user.id);
        const isParticipant =
          conversation.customerId === ctx.user.id ||
          (myProviderProfile && conversation.providerId === myProviderProfile.id);
        if (!isParticipant) throw new TRPCError({ code: "FORBIDDEN", message: "Not your conversation" });
        await db.markMessagesRead(input.conversationId, ctx.user.id);
        return db.listMessages(input.conversationId);
      }),
    send: protectedProcedure
      .input(
        z.object({
          conversationId: idSchema,
          content: z.string().min(1).max(4000),
          attachmentUrl: z.string().url().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const conversation = await db.getConversationById(input.conversationId);
        if (!conversation) throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
        const myProviderProfile = await db.getProviderProfileByUserId(ctx.user.id);
        const isParticipant =
          conversation.customerId === ctx.user.id ||
          (myProviderProfile && conversation.providerId === myProviderProfile.id);
        if (!isParticipant) throw new TRPCError({ code: "FORBIDDEN", message: "Not your conversation" });
        const id = await db.createMessage({
          conversationId: input.conversationId,
          senderId: ctx.user.id,
          content: input.content,
          attachmentUrl: input.attachmentUrl ?? null,
        });

        // Notify whichever side didn't send this message.
        const isSenderCustomer = conversation.customerId === ctx.user.id;
        const recipientUserId = isSenderCustomer
          ? (await db.getProviderProfileById(conversation.providerId))?.userId
          : conversation.customerId;
        if (recipientUserId) {
          const preview = input.content.length > 80 ? `${input.content.slice(0, 80)}…` : input.content;
          await db.createNotification({
            userId: recipientUserId,
            type: "message",
            title: `New message from ${ctx.user.name ?? (isSenderCustomer ? "a customer" : "a provider")}`,
            body: preview,
            data: { conversationId: input.conversationId },
          });
        }

        return { id };
      }),
    /** Provider starts (or resumes) a conversation with a customer, e.g. from a booking. */
    startWithCustomer: providerProcedure
      .input(z.object({ customerId: idSchema, bookingId: idSchema.optional() }))
      .mutation(async ({ ctx, input }) => {
        const profile = await db.getProviderProfileByUserId(ctx.user.id);
        if (!profile) throw new TRPCError({ code: "NOT_FOUND", message: "Provider profile not found" });
        return db.getOrCreateConversation({
          customerId: input.customerId,
          providerId: profile.id,
          bookingId: input.bookingId ?? null,
        });
      }),
  }),

  provider: router({
    /** Current user's provider profile (null if not onboarded). */
    myProfile: protectedProcedure.query(({ ctx }) => db.getProviderProfileByUserId(ctx.user.id)),
    onboard: protectedProcedure
      .input(
        z.object({
          businessName: z.string().min(2).max(255),
          bio: z.string().max(2000).optional(),
          yearsOfExperience: z.number().int().min(0).max(80).optional(),
          city: z.string().max(128).optional(),
          state: z.string().max(128).optional(),
          // Legal identity (mandatory for verification)
          firstName: z.string().min(1).max(128),
          lastName: z.string().min(1).max(128),
          dateOfBirth: dateSchema,
          phone: z.string().min(7).max(32),
          email: z.string().email().max(320),
          residentialAddress: z.string().min(5).max(512),
          businessAddress: z.string().max(512).optional(),
          cacRegistrationNumber: z.string().max(64).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const existing = await db.getProviderProfileByUserId(ctx.user.id);
        if (existing) throw new TRPCError({ code: "CONFLICT", message: "Provider profile already exists" });
        // Explicit, not the column's own "10.00" default — the admin-editable
        // platform setting is the real source of truth for new providers now (see
        // admin.commission.updateDefaultRate); the column default is just a
        // same-value fallback for the row shape, not what actually governs this.
        const { defaultCommissionRate } = await db.getPlatformSettings();
        const id = await db.createProviderProfile({ userId: ctx.user.id, ...input, commissionRate: defaultCommissionRate });
        await db.logAudit({ userId: ctx.user.id, action: "provider.onboard", entityType: "provider", entityId: id });
        return { id };
      }),
    updateProfile: providerProcedure
      .input(
        z.object({
          businessName: z.string().min(2).max(255).optional(),
          bio: z.string().max(2000).optional(),
          yearsOfExperience: z.number().int().min(0).max(80).optional(),
          availabilityStatus: z.enum(["available", "busy", "offline"]).optional(),
          city: z.string().max(128).optional(),
          state: z.string().max(128).optional(),
          firstName: z.string().min(1).max(128).optional(),
          lastName: z.string().min(1).max(128).optional(),
          dateOfBirth: dateSchema.optional(),
          phone: z.string().min(7).max(32).optional(),
          email: z.string().email().max(320).optional(),
          residentialAddress: z.string().min(5).max(512).optional(),
          businessAddress: z.string().max(512).optional(),
          cacRegistrationNumber: z.string().max(64).optional(),
          serviceRadiusKm: z.number().int().min(0).max(500).optional(),
          serviceAreas: z.array(z.string().max(128)).max(30).optional(),
          travelsToCustomer: z.boolean().optional(),
          customerComesToProvider: z.boolean().optional(),
          skills: z.array(z.string().max(64)).max(30).optional(),
          languages: z.array(z.string().max(64)).max(20).optional(),
          certifications: z
            .array(
              z.object({
                title: z.string().min(1).max(255),
                issuer: z.string().max(255).optional(),
                year: z.number().int().min(1950).max(2100).optional(),
              }),
            )
            .max(30)
            .optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const profile = await db.getProviderProfileByUserId(ctx.user.id);
        if (!profile) throw new TRPCError({ code: "NOT_FOUND", message: "Provider profile not found" });
        await db.updateProviderProfile(profile.id, input);
        return { success: true } as const;
      }),
    myServices: providerProcedure.query(async ({ ctx }) => {
      const profile = await db.getProviderProfileByUserId(ctx.user.id);
      if (!profile) return [];
      return db.listServices({ providerId: profile.id });
    }),
    createService: providerProcedure
      .input(
        z.object({
          categoryId: idSchema,
          title: z.string().min(3).max(255),
          description: z.string().max(4000).optional(),
          basePrice: z.number().positive().max(100_000_000),
          priceUnit: z.enum(["fixed", "hourly", "per_session"]).optional(),
          durationMinutes: z.number().int().min(15).max(1440).optional(),
          images: z.array(z.string().url().max(512)).max(6).optional(),
          pricingMode: z.enum(["fixed_price", "request_quote"]).optional(),
          materials: z.array(z.string().max(128)).max(30).optional(),
          isEmergency: z.boolean().optional(),
          tags: z.array(z.string().max(64)).max(20).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const profile = await db.getProviderProfileByUserId(ctx.user.id);
        if (!profile) throw new TRPCError({ code: "NOT_FOUND", message: "Complete provider onboarding first" });
        const id = await db.createService({
          providerId: profile.id,
          categoryId: input.categoryId,
          title: input.title,
          description: input.description,
          basePrice: input.basePrice.toFixed(2),
          priceUnit: input.priceUnit,
          durationMinutes: input.durationMinutes,
          imageUrl: input.images?.[0],
          images: input.images,
          pricingMode: input.pricingMode,
          materials: input.materials,
          isEmergency: input.isEmergency,
          tags: input.tags,
        });
        return { id };
      }),
    updateService: providerProcedure
      .input(
        z.object({
          serviceId: idSchema,
          title: z.string().min(3).max(255).optional(),
          description: z.string().max(4000).optional(),
          basePrice: z.number().positive().max(100_000_000).optional(),
          isActive: z.boolean().optional(),
          images: z.array(z.string().url().max(512)).max(6).optional(),
          pricingMode: z.enum(["fixed_price", "request_quote"]).optional(),
          materials: z.array(z.string().max(128)).max(30).optional(),
          isEmergency: z.boolean().optional(),
          tags: z.array(z.string().max(64)).max(20).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const profile = await db.getProviderProfileByUserId(ctx.user.id);
        const service = await db.getServiceById(input.serviceId);
        if (!profile || !service || service.service.providerId !== profile.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "You do not own this service" });
        }
        await db.updateService(input.serviceId, {
          title: input.title,
          description: input.description,
          basePrice: input.basePrice?.toFixed(2),
          isActive: input.isActive,
          imageUrl: input.images?.[0],
          images: input.images,
          pricingMode: input.pricingMode,
          materials: input.materials,
          isEmergency: input.isEmergency,
          tags: input.tags,
        });
        return { success: true } as const;
      }),
    bookings: providerProcedure.query(async ({ ctx }) => {
      const profile = await db.getProviderProfileByUserId(ctx.user.id);
      if (!profile) return [];
      return db.listBookingsForProvider(profile.id);
    }),
    deleteService: providerProcedure
      .input(z.object({ serviceId: idSchema }))
      .mutation(async ({ ctx, input }) => {
        const profile = await db.getProviderProfileByUserId(ctx.user.id);
        const service = await db.getServiceById(input.serviceId);
        if (!profile || !service || service.service.providerId !== profile.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "You do not own this service" });
        }
        await db.deactivateService(input.serviceId);
        await db.logAudit({
          userId: ctx.user.id,
          action: "provider.delete_service",
          entityType: "service",
          entityId: input.serviceId,
        });
        return { success: true } as const;
      }),
    dashboard: providerProcedure.query(async ({ ctx }) => {
      const profile = await db.getProviderProfileByUserId(ctx.user.id);
      if (!profile) throw new TRPCError({ code: "NOT_FOUND", message: "Provider profile not found" });
      const stats = await db.getProviderDashboardStats(profile.id, ctx.user.id);
      return { profile, stats };
    }),
    earnings: providerProcedure.query(({ ctx }) => db.getProviderEarnings(ctx.user.id)),
    analytics: providerProcedure.query(async ({ ctx }) => {
      const profile = await db.getProviderProfileByUserId(ctx.user.id);
      if (!profile) throw new TRPCError({ code: "NOT_FOUND", message: "Provider profile not found" });
      return db.getProviderAnalytics(profile.id, ctx.user.id);
    }),
    /** Every cancellation request on this provider's bookings, any status — simple
     *  v1 of dispute visibility, folded under provider (no new top-level router). */
    cancellationRequests: providerProcedure.query(async ({ ctx }) => {
      const profile = await db.getProviderProfileByUserId(ctx.user.id);
      if (!profile) return [];
      return db.listCancellationRequestsForProvider(profile.id);
    }),
    bankAccounts: providerProcedure.query(async ({ ctx }) => {
      const profile = await db.getProviderProfileByUserId(ctx.user.id);
      if (!profile) return [];
      return db.listProviderBankAccounts(profile.id);
    }),
    addBankAccount: providerProcedure
      .input(
        z.object({
          bankName: z.string().min(2).max(128),
          bankCode: z.string().max(16).optional(),
          accountNumber: z.string().min(6).max(20),
          accountName: z.string().min(2).max(255),
          isDefault: z.boolean().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const profile = await db.getProviderProfileByUserId(ctx.user.id);
        if (!profile) throw new TRPCError({ code: "NOT_FOUND", message: "Complete provider onboarding first" });
        const existing = await db.listProviderBankAccounts(profile.id);
        const id = await db.createProviderBankAccount({
          providerId: profile.id,
          ...input,
          // First account added is always the default, regardless of what was passed.
          isDefault: existing.length === 0 ? true : input.isDefault,
        });
        await db.logAudit({ userId: ctx.user.id, action: "provider.add_bank_account", entityType: "provider_bank_account", entityId: id });
        return { id };
      }),
    removeBankAccount: providerProcedure
      .input(z.object({ accountId: idSchema }))
      .mutation(async ({ ctx, input }) => {
        const profile = await db.getProviderProfileByUserId(ctx.user.id);
        if (!profile) throw new TRPCError({ code: "NOT_FOUND", message: "Provider profile not found" });
        await db.deleteProviderBankAccount(profile.id, input.accountId);
        return { success: true } as const;
      }),
    /** Provider's own recurring weekly hours — customer-facing booking flow doesn't read this yet (P4b scope). */
    workingHours: providerProcedure.query(async ({ ctx }) => {
      const profile = await db.getProviderProfileByUserId(ctx.user.id);
      if (!profile) return [];
      return db.getWorkingHours(profile.id);
    }),
    setWorkingHours: providerProcedure
      .input(
        z.object({
          days: z
            .array(
              z.object({
                dayOfWeek: z.number().int().min(0).max(6),
                isOpen: z.boolean(),
                openTime: timeSchema.optional(),
                closeTime: timeSchema.optional(),
              }),
            )
            .length(7),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const profile = await db.getProviderProfileByUserId(ctx.user.id);
        if (!profile) throw new TRPCError({ code: "NOT_FOUND", message: "Complete provider onboarding first" });
        await db.setWorkingHours(profile.id, input.days);
        return { success: true } as const;
      }),
    blockedDates: providerProcedure.query(async ({ ctx }) => {
      const profile = await db.getProviderProfileByUserId(ctx.user.id);
      if (!profile) return [];
      return db.listBlockedDates(profile.id);
    }),
    /** A single blocked day and a vacation range are the same thing here — just different-length date ranges. */
    addBlockedDate: providerProcedure
      .input(
        z.object({
          startDate: dateSchema,
          endDate: dateSchema,
          reason: z.string().max(255).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const profile = await db.getProviderProfileByUserId(ctx.user.id);
        if (!profile) throw new TRPCError({ code: "NOT_FOUND", message: "Complete provider onboarding first" });
        if (input.endDate < input.startDate) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "End date can't be before the start date" });
        }
        const id = await db.addBlockedDate({ providerId: profile.id, ...input });
        return { id };
      }),
    removeBlockedDate: providerProcedure
      .input(z.object({ blockedDateId: idSchema }))
      .mutation(async ({ ctx, input }) => {
        const profile = await db.getProviderProfileByUserId(ctx.user.id);
        if (!profile) throw new TRPCError({ code: "NOT_FOUND", message: "Provider profile not found" });
        await db.removeBlockedDate(profile.id, input.blockedDateId);
        return { success: true } as const;
      }),
    /** Mock withdrawal: debits wallet immediately (Paystack Transfers later). Requires a saved bank account. */
    withdraw: providerProcedure
      .input(z.object({ amount: z.number().min(500).max(10_000_000), bankAccountId: idSchema.optional() }))
      .mutation(async ({ ctx, input }) => {
        const profile = await db.getProviderProfileByUserId(ctx.user.id);
        if (!profile) throw new TRPCError({ code: "NOT_FOUND", message: "Provider profile not found" });
        const accounts = await db.listProviderBankAccounts(profile.id);
        const account = input.bankAccountId
          ? accounts.find((a) => a.id === input.bankAccountId)
          : (accounts.find((a) => a.isDefault) ?? accounts[0]);
        if (!account) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Add a bank account before withdrawing." });
        }
        const wallet = await db.getOrCreateWallet(ctx.user.id);
        if (Number(wallet.balance) < input.amount) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Insufficient wallet balance" });
        }
        const maskedAccount = `${account.bankName} ****${account.accountNumber.slice(-4)}`;
        await db.recordTransaction({
          userId: ctx.user.id,
          type: "debit",
          category: "withdrawal",
          amount: input.amount,
          description: `Withdrawal to ${maskedAccount} (test mode)`,
        });
        await db.createNotification({
          userId: ctx.user.id,
          type: "payment",
          title: "Withdrawal processed",
          body: `₦${input.amount.toLocaleString()} is on its way to ${maskedAccount}.`,
        });
        await db.logAudit({ userId: ctx.user.id, action: "provider.withdraw", detail: { amount: input.amount, bankAccountId: account.id } });
        return { success: true, bankAccount: maskedAccount } as const;
      }),
    myDocuments: providerProcedure.query(async ({ ctx }) => {
      const profile = await db.getProviderProfileByUserId(ctx.user.id);
      if (!profile) return [];
      return db.listProviderDocuments(profile.id);
    }),
    uploadDocument: protectedProcedure
      .input(
        z.object({
          type: z.enum(["government_id", "certificate", "portfolio", "selfie", "address_proof", "other"]),
          idType: z.enum(["nin", "drivers_licence", "international_passport", "voters_card"]).optional(),
          fileKey: z.string().min(1).max(512),
          fileUrl: z.string().min(1).max(512),
          fileName: z.string().max(255).optional(),
          mimeType: z.string().max(128).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const profile = await db.getProviderProfileByUserId(ctx.user.id);
        if (!profile) throw new TRPCError({ code: "NOT_FOUND", message: "Complete provider onboarding first" });
        if (input.type === "government_id" && !input.idType) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Select which government ID you are uploading" });
        }
        const id = await db.createProviderDocument({ providerId: profile.id, ...input });
        await db.submitProviderForVerification(profile.id);
        await db.logAudit({
          userId: ctx.user.id,
          action: "provider.upload_document",
          entityType: "provider_document",
          entityId: id,
        });
        return { id };
      }),
    myReviews: providerProcedure.query(async ({ ctx }) => {
      const profile = await db.getProviderProfileByUserId(ctx.user.id);
      if (!profile) return [];
      return db.listReviewsForProvider(profile.id, 50);
    }),
    /** Reply to (or edit an existing reply on) a review left on the provider's own profile. */
    respondToReview: providerProcedure
      .input(z.object({ reviewId: idSchema, response: z.string().min(1).max(2000) }))
      .mutation(async ({ ctx, input }) => {
        const profile = await db.getProviderProfileByUserId(ctx.user.id);
        if (!profile) throw new TRPCError({ code: "NOT_FOUND", message: "Provider profile not found" });
        const updated = await db.respondToReview(input.reviewId, profile.id, input.response);
        if (!updated) throw new TRPCError({ code: "FORBIDDEN", message: "Not your review" });
        await db.createNotification({
          userId: updated.customerId,
          type: "review",
          title: `${profile.businessName} replied to your review`,
          body: input.response.length > 100 ? `${input.response.slice(0, 100)}…` : input.response,
          data: { bookingId: updated.bookingId },
        });
        return { success: true } as const;
      }),
    /** Flag a review as abusive/inappropriate — creates a support ticket for admin review. */
    reportReview: providerProcedure
      .input(z.object({ reviewId: idSchema, reason: z.string().min(10).max(2000) }))
      .mutation(async ({ ctx, input }) => {
        const profile = await db.getProviderProfileByUserId(ctx.user.id);
        if (!profile) throw new TRPCError({ code: "NOT_FOUND", message: "Provider profile not found" });
        const review = await db.getReviewById(input.reviewId);
        if (!review || review.providerId !== profile.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Not your review" });
        }
        const id = await db.createSupportTicket({
          userId: ctx.user.id,
          subject: `Review report — review #${input.reviewId}`,
          description: `Provider "${profile.businessName}" reported review #${input.reviewId} (rating: ${review.rating}/5, comment: "${(review.comment ?? "").slice(0, 300)}").\n\nReason: ${input.reason}`,
          category: "other",
        });
        await db.logAudit({
          userId: ctx.user.id,
          action: "provider.report_review",
          entityType: "review",
          entityId: input.reviewId,
        });
        return { ticketId: id } as const;
      }),
    /* ---- Portfolio management ---- */
    myPortfolio: providerProcedure.query(async ({ ctx }) => {
      const profile = await db.getProviderProfileByUserId(ctx.user.id);
      if (!profile) return [];
      return db.listPortfolioItems(profile.id);
    }),
    addPortfolioItem: providerProcedure
      .input(
        z.object({
          title: z.string().min(3).max(255),
          description: z.string().max(4000).optional(),
          categoryId: idSchema.optional(),
          images: z
            .array(
              z.object({
                url: z.string().min(1).max(512),
                kind: z.enum(["before", "after", "general"]).default("general"),
              }),
            )
            .min(1)
            .max(10),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const profile = await db.getProviderProfileByUserId(ctx.user.id);
        if (!profile) throw new TRPCError({ code: "NOT_FOUND", message: "Complete provider onboarding first" });
        const id = await db.createPortfolioItem({
          providerId: profile.id,
          categoryId: input.categoryId,
          title: input.title,
          description: input.description,
          images: input.images,
        });
        await db.logAudit({
          userId: ctx.user.id,
          action: "provider.add_portfolio_item",
          entityType: "portfolio_item",
          entityId: id,
        });
        return { id };
      }),
    removePortfolioItem: providerProcedure
      .input(z.object({ itemId: idSchema }))
      .mutation(async ({ ctx, input }) => {
        const profile = await db.getProviderProfileByUserId(ctx.user.id);
        if (!profile) throw new TRPCError({ code: "NOT_FOUND", message: "Provider profile not found" });
        await db.deletePortfolioItem(input.itemId, profile.id);
        return { success: true } as const;
      }),
  }),

  bookings: router({
    availableSlots: publicProcedure
      .input(z.object({ providerId: idSchema, date: dateSchema }))
      .query(({ input }) => db.getAvailableTimeSlots(input.providerId, input.date)),
    create: protectedProcedure
      .use(userRateLimit({ windowMs: HOUR_MS, max: 10, label: "bookings.create" }))
      .input(
        z.object({
          serviceId: idSchema,
          scheduledDate: dateSchema,
          scheduledTime: timeSchema,
          addressId: idSchema.optional(),
          notes: z.string().max(2000).optional(),
          couponCode: z.string().max(32).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const service = await db.getServiceById(input.serviceId);
        if (!service) throw new TRPCError({ code: "NOT_FOUND", message: "Service not found" });

        // Enforced here, not just in the picker (which greys out the same window) —
        // a direct API call must not be able to book an already-passed or
        // seconds-away slot.
        if (db.scheduledAtUtc(input.scheduledDate, input.scheduledTime).getTime() < Date.now() + db.BOOKING_MIN_LEAD_MS) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Please choose a time at least an hour from now.",
          });
        }

        const subtotal = Number(service.service.basePrice);
        let discount = 0;
        let couponId: number | undefined;
        if (input.couponCode) {
          const result = await db.validateCoupon(input.couponCode, subtotal);
          if (!result.valid) throw new TRPCError({ code: "BAD_REQUEST", message: result.reason });
          discount = result.discount;
          couponId = result.coupon.id;
        }

        // Snapshotted now, not read live later — see bookings.platformFee's own
        // schema comment for why (a later admin change must never retroactively
        // touch a booking already placed).
        const platformSettings = await db.getPlatformSettings();
        const platformFee = platformSettings.bookingFeeEnabled ? Number(platformSettings.bookingFeeAmount) : 0;

        const { id, reference } = await db.createBooking({
          customerId: ctx.user.id,
          providerId: service.service.providerId,
          serviceId: input.serviceId,
          addressId: input.addressId,
          scheduledDate: input.scheduledDate,
          scheduledTime: input.scheduledTime,
          notes: input.notes,
          subtotal: subtotal.toFixed(2),
          discount: discount.toFixed(2),
          platformFee: platformFee.toFixed(2),
          total: (subtotal - discount + platformFee).toFixed(2),
          couponId,
        });
        if (couponId) await db.incrementCouponUse(couponId);
        await db.logAudit({ userId: ctx.user.id, action: "booking.create", entityType: "booking", entityId: id });
        return { id, reference };
      }),
    mine: protectedProcedure.query(({ ctx }) => db.listBookingsForCustomer(ctx.user.id)),
    byId: protectedProcedure.input(z.object({ id: idSchema })).query(async ({ ctx, input }) => {
      const row = await db.getBookingById(input.id);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });
      const profile = await db.getProviderProfileByUserId(ctx.user.id);
      const isCustomer = row.booking.customerId === ctx.user.id;
      const isProvider = profile && row.booking.providerId === profile.id;
      if (!isCustomer && !isProvider && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not your booking" });
      }
      return row;
    }),
    /**
     * Customer-only, deliberately NOT shared with the provider path like byId above —
     * the whole point of the handoff code is that the provider can only learn it from
     * the customer in person, never through the API.
     */
    releaseCode: protectedProcedure.input(z.object({ id: idSchema })).query(async ({ ctx, input }) => {
      const row = await db.getBookingById(input.id);
      if (!row || row.booking.customerId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not your booking" });
      }
      return db.getReleaseCodeForCustomer(input.id);
    }),
    history: protectedProcedure.input(z.object({ id: idSchema })).query(async ({ ctx, input }) => {
      const row = await db.getBookingById(input.id);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });
      const profile = await db.getProviderProfileByUserId(ctx.user.id);
      const isCustomer = row.booking.customerId === ctx.user.id;
      const isProvider = profile && row.booking.providerId === profile.id;
      if (!isCustomer && !isProvider && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not your booking" });
      }
      return db.getBookingStatusHistory(input.id);
    }),
    progressUpdates: protectedProcedure.input(z.object({ id: idSchema })).query(async ({ ctx, input }) => {
      const row = await db.getBookingById(input.id);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });
      const profile = await db.getProviderProfileByUserId(ctx.user.id);
      const isCustomer = row.booking.customerId === ctx.user.id;
      const isProvider = profile && row.booking.providerId === profile.id;
      if (!isCustomer && !isProvider && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not your booking" });
      }
      return db.listBookingProgressUpdates(input.id);
    }),
    /** Provider posts a lightweight "on the way"/"arrived"/"waiting" checkpoint — notifies the customer instantly. */
    addProgressUpdate: providerProcedure
      .input(
        z.object({
          id: idSchema,
          type: z.enum(["on_the_way", "arrived", "waiting_for_customer"]),
          note: z.string().max(500).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const profile = await db.getProviderProfileByUserId(ctx.user.id);
        const row = await db.getBookingById(input.id);
        if (!profile || !row || row.booking.providerId !== profile.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Not your booking" });
        }
        return db.addBookingProgressUpdate({ bookingId: input.id, type: input.type, note: input.note });
      }),
    cancel: protectedProcedure
      .input(z.object({ id: idSchema, reason: z.string().max(500).optional() }))
      .mutation(async ({ ctx, input }) => {
        const row = await db.getBookingById(input.id);
        if (!row || row.booking.customerId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Not your booking" });
        }
        // Once work is underway, cancelling stops being instant — see requestCancellation.
        // Enforced here too (not just hidden in the UI) so a client can't bypass admin review.
        if (row.booking.status === "in_progress") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This booking is in progress — request a cancellation instead, which an admin will review.",
          });
        }
        await db.updateBookingStatus({
          bookingId: input.id,
          toStatus: "cancelled",
          changedByUserId: ctx.user.id,
          cancelReason: input.reason,
        });
        await db.createNotification({
          userId: ctx.user.id,
          type: "booking_update",
          title: "Booking cancelled",
          body: `Your booking ${row.booking.reference} has been cancelled.`,
          data: { bookingId: input.id },
        });
        return { success: true } as const;
      }),
    /**
     * Once `in_progress`, cancelling is a request either party files, reviewed by an
     * admin (see `admin.cancellationRequests`) — same review-queue pattern as held
     * payments. Doesn't change `bookings.status` itself.
     */
    requestCancellation: protectedProcedure
      .input(z.object({ id: idSchema, reason: z.string().min(3).max(500) }))
      .mutation(async ({ ctx, input }) => {
        const row = await db.getBookingById(input.id);
        if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });
        const profile = await db.getProviderProfileByUserId(ctx.user.id);
        const isCustomer = row.booking.customerId === ctx.user.id;
        const isProvider = !!profile && row.booking.providerId === profile.id;
        if (!isCustomer && !isProvider) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Not your booking" });
        }
        try {
          return await db.requestBookingCancellation({
            bookingId: input.id,
            requestedByUserId: ctx.user.id,
            requestedByRole: isCustomer ? "customer" : "provider",
            reason: input.reason,
          });
        } catch (e: any) {
          throw new TRPCError({ code: "BAD_REQUEST", message: e?.message ?? "Couldn't submit cancellation request" });
        }
      }),
    /** Whether this booking currently has a pending cancellation request, and who filed it. */
    cancellationRequestStatus: protectedProcedure.input(z.object({ id: idSchema })).query(async ({ ctx, input }) => {
      const row = await db.getBookingById(input.id);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });
      const profile = await db.getProviderProfileByUserId(ctx.user.id);
      const isCustomer = row.booking.customerId === ctx.user.id;
      const isProvider = !!profile && row.booking.providerId === profile.id;
      if (!isCustomer && !isProvider && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not your booking" });
      }
      return db.getPendingCancellationRequest(input.id);
    }),
    /** Provider accepts/rejects/progresses a booking. */
    updateStatus: providerProcedure
      .input(
        z.object({
          id: idSchema,
          status: z.enum(["confirmed", "rejected", "in_progress", "completed"]),
          note: z.string().max(500).optional(),
          completionPhotos: z.array(z.string().min(1).max(512)).max(10).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const profile = await db.getProviderProfileByUserId(ctx.user.id);
        const row = await db.getBookingById(input.id);
        if (!profile || !row || row.booking.providerId !== profile.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Not your booking" });
        }
        // Verification gating: unverified/rejected providers cannot accept jobs.
        if (input.status === "confirmed" && profile.verificationStatus !== "verified") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message:
              profile.verificationStatus === "pending"
                ? "Your identity verification is still under review. You can accept bookings once verified."
                : "You must complete identity verification before accepting bookings.",
          });
        }
        // Payment now happens after acceptance, not before (see payments.initialize's own
        // gate) — so the provider can accept an unpaid request, but can't start work on
        // one. This is the invariant updateBookingStatus's "completed" handler relies on
        // ("paymentStatus should always be 'paid' by the time a booking reaches
        // 'completed'") — moved here from the old pre-accept gate, not dropped.
        if (input.status === "in_progress" && row.booking.paymentStatus !== "paid") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This booking hasn't been paid for yet and can't be started.",
          });
        }
        const result = await db.updateBookingStatus({
          bookingId: input.id,
          toStatus: input.status,
          changedByUserId: ctx.user.id,
          note: input.note,
          completionPhotos: input.completionPhotos,
        });
        const statusLabels: Record<string, string> = {
          confirmed: "confirmed",
          rejected: "declined",
          in_progress: "started",
          completed: "completed",
        };
        await db.createNotification({
          userId: row.booking.customerId,
          type: "booking_update",
          title: `Booking ${statusLabels[input.status]}`,
          body:
            input.status === "confirmed"
              ? `${row.booking.reference} was accepted — pay now to secure your booking.`
              : `Your booking ${row.booking.reference} has been ${statusLabels[input.status]}.`,
          data: { bookingId: input.id },
        });
        // Separate from the "completed" notification above — this is the handoff code
        // the customer gives the provider in person to release the held payment.
        if (input.status === "completed" && result.releaseCode) {
          await db.createNotification({
            userId: row.booking.customerId,
            type: "payment",
            title: "Your job completion code",
            body: `Give this code to your provider to confirm the job is done and release payment: ${result.releaseCode}`,
            data: { bookingId: input.id },
          });
        }
        return { success: true } as const;
      }),
    /**
     * Provider enters the 5-digit code the customer handed them in person. Rate-limited
     * in addition to the hard per-booking attempt cap enforced in db.ts — two independent
     * throttles on a mutation that gates real money.
     */
    confirmReleaseCode: providerProcedure
      .use(userRateLimit({ windowMs: FIFTEEN_MIN_MS, max: 10, label: "bookings.confirmReleaseCode" }))
      .input(z.object({ bookingId: idSchema, code: z.string().regex(/^\d{5}$/, "Enter the 5-digit code") }))
      .mutation(async ({ ctx, input }) => {
        const profile = await db.getProviderProfileByUserId(ctx.user.id);
        const row = await db.getBookingById(input.bookingId);
        if (!profile || !row || row.booking.providerId !== profile.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Not your booking" });
        }
        const result = await db.confirmReleaseCode({
          bookingId: input.bookingId,
          providerUserId: ctx.user.id,
          code: input.code,
        });
        if (!result.success) {
          const messages: Record<string, string> = {
            not_held: "This booking has no payment currently held.",
            expired: "This code has expired. Contact support to release this payment.",
            locked: "Too many wrong attempts — this code is locked. Contact support to release this payment.",
            wrong_code: `Incorrect code. ${result.remainingAttempts} attempt${result.remainingAttempts === 1 ? "" : "s"} left.`,
          };
          throw new TRPCError({ code: "BAD_REQUEST", message: messages[result.reason] });
        }
        return result;
      }),
    review: protectedProcedure
      .input(
        z.object({
          bookingId: idSchema,
          rating: z.number().int().min(1).max(5),
          comment: z.string().max(2000).optional(),
          images: z.array(z.string().url()).max(6).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const row = await db.getBookingById(input.bookingId);
        if (!row || row.booking.customerId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Not your booking" });
        }
        if (row.booking.status !== "completed") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "You can only review completed bookings" });
        }
        const id = await db.createReview({
          bookingId: input.bookingId,
          customerId: ctx.user.id,
          providerId: row.booking.providerId,
          rating: input.rating,
          comment: input.comment,
          images: input.images,
        });
        return { id };
      }),
    reschedule: protectedProcedure
      .input(
        z.object({
          id: idSchema,
          scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          scheduledTime: z.string().regex(/^\d{2}:\d{2}$/),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const updated = await db.rescheduleBooking({
          bookingId: input.id,
          customerId: ctx.user.id,
          scheduledDate: input.scheduledDate,
          scheduledTime: input.scheduledTime,
        });
        if (!updated) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This booking can no longer be rescheduled",
          });
        }
        await db.createNotification({
          userId: ctx.user.id,
          type: "booking_update",
          title: "Booking rescheduled",
          body: `Your booking has been moved to ${input.scheduledDate} at ${input.scheduledTime}.`,
          data: { bookingId: input.id },
        });
        return { success: true } as const;
      }),
    /** Transparent commission breakdown for a booking (customer, provider, or admin). */
    commissionBreakdown: protectedProcedure
      .input(z.object({ id: idSchema }))
      .query(async ({ ctx, input }) => {
        const row = await db.getBookingById(input.id);
        if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });
        const profile = await db.getProviderProfileByUserId(ctx.user.id);
        const isCustomer = row.booking.customerId === ctx.user.id;
        const isProvider = profile && row.booking.providerId === profile.id;
        if (!isCustomer && !isProvider && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Not your booking" });
        }
        const breakdown = await db.getBookingCommissionBreakdown(input.id);
        if (!breakdown) throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });
        return breakdown;
      }),
  }),

  /* -------- Portfolio browsing (public, for customer-facing profiles) ------- */
  portfolio: router({
    byProvider: publicProcedure
      .input(z.object({ providerId: idSchema }))
      .query(({ input }) => db.listPortfolioItems(input.providerId)),
  }),

  /* --------------------------- Quotes & negotiation ------------------------- */
  negotiations: router({
    /** Customer makes an opening offer to a provider on one of their services. */
    start: protectedProcedure
      .use(userRateLimit({ windowMs: HOUR_MS, max: 10, label: "negotiations.start" }))
      .input(
        z.object({
          providerId: idSchema,
          serviceId: idSchema,
          offerAmount: z.number().positive().max(100_000_000),
          message: z.string().max(1000).optional(),
          photos: z.array(z.string().min(1).max(512)).max(6).optional(),
          preferredDate: dateSchema.optional(),
          preferredTime: timeSchema.optional(),
          addressId: idSchema.optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const service = await db.getServiceById(input.serviceId);
        if (!service || service.service.providerId !== input.providerId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Service not found for this provider" });
        }
        const result = await db.createNegotiation({ customerId: ctx.user.id, ...input });
        await db.logAudit({
          userId: ctx.user.id,
          action: "negotiation.start",
          entityType: "negotiation",
          entityId: result.id,
        });
        return result;
      }),
    mine: protectedProcedure.query(({ ctx }) => db.listNegotiationsForCustomer(ctx.user.id)),
    forProvider: providerProcedure.query(async ({ ctx }) => {
      const profile = await db.getProviderProfileByUserId(ctx.user.id);
      if (!profile) return [];
      return db.listNegotiationsForProvider(profile.id);
    }),
    byId: protectedProcedure.input(z.object({ id: idSchema })).query(async ({ ctx, input }) => {
      const row = await db.getNegotiationById(input.id);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Negotiation not found" });
      const isCustomer = row.negotiation.customerId === ctx.user.id;
      const isProvider = row.providerUserId === ctx.user.id;
      if (!isCustomer && !isProvider && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not your negotiation" });
      }
      return { ...row, viewerRole: isCustomer ? ("customer" as const) : ("provider" as const) };
    }),
    /** Make a counter-offer — either party, any time it's their turn. */
    offer: protectedProcedure
      .use(userRateLimit({ windowMs: FIFTEEN_MIN_MS, max: 20, label: "negotiations.offer" }))
      .input(
        z.object({
          negotiationId: idSchema,
          amount: z.number().positive().max(100_000_000),
          note: z.string().max(1000).optional(),
          expiresInHours: z.number().int().min(1).max(168).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const row = await db.getNegotiationById(input.negotiationId);
        if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Negotiation not found" });
        const isCustomer = row.negotiation.customerId === ctx.user.id;
        const isProvider = row.providerUserId === ctx.user.id;
        if (!isCustomer && !isProvider) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Not your negotiation" });
        }
        // Verification gating: providers must be verified to make offers.
        if (isProvider) {
          const profile = await db.getProviderProfileByUserId(ctx.user.id);
          if (!profile || profile.verificationStatus !== "verified") {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "Complete identity verification before making offers.",
            });
          }
        }
        const result = await db.addNegotiationOffer({
          negotiationId: input.negotiationId,
          byRole: isCustomer ? "customer" : "provider",
          byUserId: ctx.user.id,
          amount: input.amount,
          note: input.note,
          expiresInHours: input.expiresInHours,
        });
        return result;
      }),
    /** Accept the other party's pending offer → creates a confirmed booking. */
    accept: protectedProcedure
      .input(z.object({ negotiationId: idSchema }))
      .mutation(async ({ ctx, input }) => {
        const row = await db.getNegotiationById(input.negotiationId);
        if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Negotiation not found" });
        const isCustomer = row.negotiation.customerId === ctx.user.id;
        const isProvider = row.providerUserId === ctx.user.id;
        if (!isCustomer && !isProvider) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Not your negotiation" });
        }
        const result = await db.acceptNegotiationOffer({
          negotiationId: input.negotiationId,
          acceptedByRole: isCustomer ? "customer" : "provider",
          acceptedByUserId: ctx.user.id,
        });
        await db.logAudit({
          userId: ctx.user.id,
          action: "negotiation.accept",
          entityType: "negotiation",
          entityId: input.negotiationId,
          detail: { agreedPrice: result.agreedPrice, bookingId: result.bookingId },
        });
        return result;
      }),
    /** Reject (provider) or withdraw (customer) the negotiation. */
    close: protectedProcedure
      .input(z.object({ negotiationId: idSchema, reason: z.string().max(500).optional() }))
      .mutation(async ({ ctx, input }) => {
        const row = await db.getNegotiationById(input.negotiationId);
        if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Negotiation not found" });
        const isCustomer = row.negotiation.customerId === ctx.user.id;
        const isProvider = row.providerUserId === ctx.user.id;
        if (!isCustomer && !isProvider) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Not your negotiation" });
        }
        return db.closeNegotiation({
          negotiationId: input.negotiationId,
          byRole: isCustomer ? "customer" : "provider",
          byUserId: ctx.user.id,
          reason: input.reason,
        });
      }),
  }),

  /* ------------------------ Admin: provider verification --------------------- */
  adminVerification: router({
    // Overview numbers, visible regardless of role — not resource-gated on purpose.
    stats: adminProcedure.query(() => db.getAdminStats()),
    pending: adminPermissionProcedure("providers").query(() => db.listProvidersByVerificationStatus("pending")),
    documents: adminPermissionProcedure("providers")
      .input(z.object({ providerId: idSchema }))
      .query(({ input }) => db.listProviderDocuments(input.providerId)),
    decide: adminPermissionProcedure("providers")
      .input(
        z.object({
          providerId: idSchema,
          decision: z.enum(["verified", "rejected"]),
          rejectionReason: z.string().max(1000).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const result = await db.decideProviderVerification(input);
        await db.logAudit({
          userId: ctx.user.id,
          action: `admin.verification_${input.decision}`,
          entityType: "provider",
          entityId: input.providerId,
          detail: { rejectionReason: input.rejectionReason },
        });
        return result;
      }),
    requestInfo: adminPermissionProcedure("providers")
      .input(z.object({ providerId: idSchema, message: z.string().min(1).max(1000) }))
      .mutation(async ({ ctx, input }) => {
        const result = await db.requestProviderVerificationInfo(input);
        await db.logAudit({
          userId: ctx.user.id,
          action: "admin.verification_request_info",
          entityType: "provider",
          entityId: input.providerId,
          detail: { message: input.message },
        });
        return result;
      }),
  }),

  addresses: router({
    list: protectedProcedure.query(({ ctx }) => db.listAddresses(ctx.user.id)),
    create: protectedProcedure
      .input(
        z.object({
          label: z.string().max(64).optional(),
          addressLine1: z.string().min(3).max(255),
          addressLine2: z.string().max(255).optional(),
          city: z.string().min(2).max(128),
          state: z.string().min(2).max(128),
          isDefault: z.boolean().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const id = await db.createAddress({ userId: ctx.user.id, ...input });
        return { id };
      }),
    remove: protectedProcedure.input(z.object({ id: idSchema })).mutation(async ({ ctx, input }) => {
      await db.deleteAddress(ctx.user.id, input.id);
      return { success: true } as const;
    }),
  }),

  notifications: router({
    list: protectedProcedure.query(({ ctx }) => db.listNotifications(ctx.user.id)),
    markRead: protectedProcedure.input(z.object({ id: idSchema })).mutation(async ({ ctx, input }) => {
      await db.markNotificationRead(ctx.user.id, input.id);
      return { success: true } as const;
    }),
    markAllRead: protectedProcedure.mutation(async ({ ctx }) => {
      await db.markAllNotificationsRead(ctx.user.id);
      return { success: true } as const;
    }),
    preferences: protectedProcedure.query(({ ctx }) => db.getNotificationPreferences(ctx.user.id)),
    updatePreferences: protectedProcedure
      .input(
        z.object({
          pushEnabled: z.boolean().optional(),
          emailEnabled: z.boolean().optional(),
          smsEnabled: z.boolean().optional(),
          bookingUpdates: z.boolean().optional(),
          messages: z.boolean().optional(),
          promotions: z.boolean().optional(),
          serviceReminders: z.boolean().optional(),
          newBookingRequests: z.boolean().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await db.updateNotificationPreferences(ctx.user.id, input);
        return { success: true } as const;
      }),
    /** Called once the device has a fresh Expo push token — upserts by token, so
     *  re-registering the same device is safe to call on every app open. */
    registerPushToken: protectedProcedure
      .input(z.object({ token: z.string().min(1).max(255), platform: z.enum(["ios", "android", "web"]) }))
      .mutation(async ({ ctx, input }) => {
        await db.registerDevicePushToken({ userId: ctx.user.id, token: input.token, platform: input.platform });
        return { success: true } as const;
      }),
    unregisterPushToken: protectedProcedure
      .input(z.object({ token: z.string().min(1).max(255) }))
      .mutation(async ({ input }) => {
        await db.unregisterDevicePushToken(input.token);
        return { success: true } as const;
      }),
  }),

  wallet: router({
    me: protectedProcedure.query(({ ctx }) => db.getOrCreateWallet(ctx.user.id)),
    transactions: protectedProcedure.query(({ ctx }) => db.listTransactions(ctx.user.id)),
    /** Mock deposit: tops up the wallet instantly (replaced by Paystack charge later). */
    deposit: protectedProcedure
      .input(z.object({ amount: z.number().min(100).max(1000000) }))
      .mutation(async ({ ctx, input }) => {
        await db.recordTransaction({
          userId: ctx.user.id,
          type: "credit",
          category: "topup",
          amount: input.amount,
          description: "Wallet top-up (test mode)",
        });
        await db.createNotification({
          userId: ctx.user.id,
          type: "payment",
          title: "Wallet funded",
          body: `₦${input.amount.toLocaleString()} has been added to your wallet.`,
        });
        return { success: true } as const;
      }),
  }),

  payments: router({
    /**
     * Initialize a payment for a booking. In mock mode (no Paystack key yet)
     * the payment is auto-approved and the booking marked paid.
     */
    initialize: protectedProcedure
      .input(
        z.object({
          bookingId: idSchema,
          method: z.enum(["card", "bank_transfer", "wallet"]).default("card"),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const row = await db.getBookingById(input.bookingId);
        if (!row || row.booking.customerId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Not your booking" });
        }
        if (row.booking.paymentStatus === "paid") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Booking already paid" });
        }
        // Payment only opens up once the provider has accepted — before that (still
        // "pending") or if they declined/it was cancelled, there's nothing to pay for yet.
        if (row.booking.status !== "confirmed") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This booking must be accepted by the provider before you can pay.",
          });
        }
        const amount = Number(row.booking.total);
        const reference = `PAY-${row.booking.reference}`;

        const markBookingPaid = async () => {
          const dbi = await db.getDb();
          if (!dbi) return;
          const { bookings: bookingsTable } = await import("../drizzle/schema");
          const { eq: eqOp } = await import("drizzle-orm");
          await dbi
            .update(bookingsTable)
            .set({ paymentStatus: "paid" })
            .where(eqOp(bookingsTable.id, input.bookingId));
        };

        // Wallet pays out of the user's real balance immediately — no gateway involved.
        if (input.method === "wallet") {
          const paymentId = await db.createPayment({
            bookingId: input.bookingId,
            userId: ctx.user.id,
            amount,
            method: "wallet",
            gatewayReference: reference,
          });
          try {
            await db.recordTransaction({
              userId: ctx.user.id,
              type: "debit",
              category: "booking_payment",
              amount,
              bookingId: input.bookingId,
              paymentId,
              description: `Payment for booking ${row.booking.reference}`,
            });
          } catch (e: any) {
            await db.updatePaymentStatus(paymentId, "failed");
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: e?.message === "Insufficient wallet balance" ? "Insufficient wallet balance." : "Wallet payment failed.",
            });
          }
          await db.updatePaymentStatus(paymentId, "successful");
          await markBookingPaid();
          await db.createNotification({
            userId: ctx.user.id,
            type: "payment",
            title: "Payment successful",
            body: `₦${amount.toLocaleString()} was paid from your wallet for ${row.booking.reference}.`,
            data: { bookingId: input.bookingId },
          });
          return { paymentId, authorizationUrl: null, mock: false };
        }

        const paymentId = await db.createPayment({
          bookingId: input.bookingId,
          userId: ctx.user.id,
          amount,
          method: input.method,
          gatewayReference: reference,
        });
        const gateway = getPaymentGateway();
        const init = await gateway.initialize({
          amountNgn: amount,
          email: ctx.user.email ?? "customer@example.com",
          reference,
        });
        if (init.mock) {
          await db.updatePaymentStatus(paymentId, "successful");
          await markBookingPaid();
          await db.createNotification({
            userId: ctx.user.id,
            type: "payment",
            title: "Payment successful",
            body: `Payment of ₦${amount.toLocaleString()} for ${row.booking.reference} was successful.`,
            data: { bookingId: input.bookingId },
          });
        }
        return { paymentId, authorizationUrl: init.authorizationUrl, mock: init.mock };
      }),
  }),

  coupons: router({
    validate: protectedProcedure
      .input(z.object({ code: z.string().min(1).max(32), orderAmount: z.number().positive() }))
      .query(({ input }) => db.validateCoupon(input.code, input.orderAmount)),
  }),

  support: router({
    createTicket: protectedProcedure
      .input(
        z.object({
          subject: z.string().min(3).max(255),
          description: z.string().min(10).max(4000),
          category: z.enum(["booking", "payment", "account", "provider", "other"]).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const id = await db.createSupportTicket({ userId: ctx.user.id, ...input });
        return { id };
      }),
    myTickets: protectedProcedure.query(({ ctx }) => db.listSupportTickets(ctx.user.id)),
  }),

  uploads: router({
    /**
     * Upload a base64-encoded file (image/document) to S3-compatible storage.
     * Returns a `/manus-storage/...` URL that can be saved on entities.
     */
    file: protectedProcedure
      .use(userRateLimit({ windowMs: FIFTEEN_MIN_MS, max: 20, label: "uploads.file" }))
      .input(
        z.object({
          fileName: z.string().min(1).max(200),
          contentType: z.string().min(3).max(128),
          base64: z.string().min(1).max(14_000_000), // ~10MB binary
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const { storagePut } = await import("./storage");
        const buffer = Buffer.from(input.base64, "base64");
        if (buffer.length > 10 * 1024 * 1024) {
          throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: "File exceeds 10MB limit" });
        }
        const safeName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
        // Same request-derived same-origin approach as the CORS fix — no hardcoded domain,
        // so it stays correct across tunnel restarts / a future real deployment.
        const baseUrl = `${ctx.req.protocol}://${ctx.req.get("host")}`;
        const { key, url } = await storagePut(`user-${ctx.user.id}/${safeName}`, buffer, input.contentType, baseUrl);
        await db.logAudit({ userId: ctx.user.id, action: "upload.file", detail: { key } });
        return { key, url };
      }),
  }),

  admin: router({
    /** The signed-in admin's own roles — drives the dashboard sidebar (hide sections
     *  the account can't use) and any client-side "are you sure you can do this"
     *  affordance. The server-side check on each endpoint is the real gate; this is
     *  just so the UI doesn't dangle actions in front of an admin who'll get a 403. */
    me: adminProcedure.query(async ({ ctx }) => ({
      id: ctx.user.id,
      email: ctx.user.email,
      name: ctx.user.name,
      roles: await db.getAdminRoles(ctx.user.id),
    })),

    categories: router({
      list: adminPermissionProcedure("categories").query(() => db.listCategoriesAdmin()),
      create: adminPermissionProcedure("categories")
        .input(
          z.object({
            name: z.string().min(2).max(128),
            slug: z.string().min(2).max(128).regex(/^[a-z0-9-]+$/, "Lowercase letters, numbers, and hyphens only"),
            description: z.string().max(1000).optional(),
            icon: z.string().max(64).optional(),
            imageUrl: z.string().url().max(512).optional(),
            sortOrder: z.number().int().optional(),
          }),
        )
        .mutation(async ({ ctx, input }) => {
          const id = await db.createCategoryAdmin(input);
          await db.logAudit({ userId: ctx.user.id, action: "admin.category.create", entityType: "category", entityId: id, detail: input });
          return { id };
        }),
      update: adminPermissionProcedure("categories")
        .input(
          z.object({
            id: idSchema,
            name: z.string().min(2).max(128).optional(),
            slug: z.string().min(2).max(128).regex(/^[a-z0-9-]+$/).optional(),
            description: z.string().max(1000).optional(),
            icon: z.string().max(64).optional(),
            imageUrl: z.string().url().max(512).optional(),
            sortOrder: z.number().int().optional(),
            isActive: z.boolean().optional(),
          }),
        )
        .mutation(async ({ ctx, input }) => {
          const { id, ...data } = input;
          await db.updateCategoryAdmin(id, data);
          await db.logAudit({ userId: ctx.user.id, action: "admin.category.update", entityType: "category", entityId: id, detail: data });
          return { success: true } as const;
        }),
    }),

    bookings: router({
      /** Completed bookings whose payout is still held — the "stuck payments" queue. */
      heldPayments: adminPermissionProcedure("finance").query(() => db.listHeldPayments()),
      /** Manual override for a held payment the code path never resolved. Requires a reason. */
      releasePayment: adminPermissionProcedure("finance")
        .input(z.object({ bookingId: idSchema, note: z.string().min(3).max(1000) }))
        .mutation(async ({ ctx, input }) => {
          const result = await db.releaseHeldPaymentByAdmin({
            bookingId: input.bookingId,
            adminUserId: ctx.user.id,
            note: input.note,
          });
          if (!result) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "This booking isn't a held payout (already released, unpaid, or doesn't exist).",
            });
          }
          return result;
        }),
      /** General booking browser — investigative visibility only. Admins intervene
       *  through the existing, transition-safe tools (held-payment release, cancellation
       *  decisions) rather than a raw status override that could bypass BOOKING_TRANSITIONS. */
      list: adminPermissionProcedure("bookings")
        .input(
          z.object({
            status: z.enum(["pending", "confirmed", "in_progress", "completed", "cancelled", "rejected"]).optional(),
            search: z.string().max(128).optional(),
            page: z.number().int().min(0).default(0),
          }),
        )
        .query(({ input }) =>
          db.listBookingsAdmin({ status: input.status, search: input.search, limit: 50, offset: input.page * 50 }),
        ),
      detail: adminPermissionProcedure("bookings").input(z.object({ id: idSchema })).query(({ input }) => db.getBookingDetailAdmin(input.id)),
    }),

    /** In-progress bookings either party has asked to cancel — awaits admin approve/reject. */
    cancellationRequests: router({
      list: adminPermissionProcedure("disputes")
        .input(z.object({ status: z.enum(["pending", "approved", "rejected"]).default("pending") }).optional())
        .query(({ input }) => db.listCancellationRequests(input?.status ?? "pending")),
      decide: adminPermissionProcedure("disputes")
        .input(
          z.object({
            requestId: idSchema,
            decision: z.enum(["approve", "reject"]),
            reviewNote: z.string().max(1000).optional(),
            refundAmount: z.number().min(0).optional(),
            providerPayoutAmount: z.number().min(0).optional(),
          }),
        )
        .mutation(async ({ ctx, input }) => {
          if (input.decision === "reject" && !input.reviewNote) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "A reason is required to reject a cancellation request." });
          }
          let result;
          try {
            result = await db.decideCancellationRequest({
              requestId: input.requestId,
              adminUserId: ctx.user.id,
              decision: input.decision,
              reviewNote: input.reviewNote,
              refundAmount: input.refundAmount,
              providerPayoutAmount: input.providerPayoutAmount,
            });
          } catch (e: any) {
            throw new TRPCError({ code: "BAD_REQUEST", message: e?.message ?? "Couldn't process this decision" });
          }
          if (!result.success) {
            const messages: Record<string, string> = {
              not_found: "Request or booking not found.",
              already_decided: "This request has already been reviewed.",
              booking_no_longer_in_progress: "This booking is no longer in progress — it may have already been resolved another way.",
            };
            throw new TRPCError({ code: "BAD_REQUEST", message: messages[result.reason] });
          }
          await db.logAudit({
            userId: ctx.user.id,
            action: `admin.cancellation_request.${input.decision}`,
            entityType: "booking_cancellation_request",
            entityId: input.requestId,
            detail: { reviewNote: input.reviewNote, refundAmount: input.refundAmount, providerPayoutAmount: input.providerPayoutAmount },
          });
          return result;
        }),
    }),

    users: router({
      list: adminPermissionProcedure("users")
        .input(
          z.object({
            search: z.string().max(128).optional(),
            status: z.enum(["active", "suspended", "deactivated", "deleted"]).optional(),
            appRole: z.enum(["customer", "provider", "admin"]).optional(),
            page: z.number().int().min(0).default(0),
          }),
        )
        .query(({ input }) =>
          db.listUsersAdmin({ search: input.search, status: input.status, appRole: input.appRole, limit: 50, offset: input.page * 50 }),
        ),
      detail: adminPermissionProcedure("users").input(z.object({ id: idSchema })).query(({ input }) => db.getUserDetailAdmin(input.id)),
      setStatus: adminPermissionProcedure("users")
        .input(z.object({ id: idSchema, status: z.enum(["active", "suspended", "deactivated"]), reason: z.string().min(3).max(1000) }))
        .mutation(async ({ ctx, input }) => {
          if (input.id === ctx.user.id) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "You can't change your own account status." });
          }
          const before = await db.getUserById(input.id);
          await db.setUserStatusAdmin({ userId: input.id, status: input.status });
          await db.logAudit({
            userId: ctx.user.id,
            action: "admin.user.set_status",
            entityType: "user",
            entityId: input.id,
            detail: { from: before?.status, to: input.status, reason: input.reason },
          });
          return { success: true } as const;
        }),
      /** Powers the confirmation screen's preview and doubles as the same guard
       *  data permanentDelete itself checks — see db.ts's own comment. */
      deletionPreview: adminPermissionProcedure("users").input(z.object({ id: idSchema })).query(({ input }) => db.getUserDeletionPreview(input.id)),
      /**
       * Deliberately its own resource string, NOT listed in RESOURCE_ROLES — same
       * convention already used for audit_logs/admin_management, so only
       * super_admin ever passes (see db.ts's hasAdminPermission).
       */
      permanentDelete: adminPermissionProcedure("users.permanent_delete")
        .input(z.object({ id: idSchema, confirmEmail: z.string().max(320), reason: z.string().min(3).max(1000) }))
        .mutation(async ({ ctx, input }) => {
          if (input.id === ctx.user.id) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "You can't delete your own account." });
          }
          const target = await db.getUserById(input.id);
          if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
          if ((target.email ?? "").toLowerCase() !== input.confirmEmail.trim().toLowerCase()) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "The email you entered doesn't match this account." });
          }

          const result = await db.permanentlyDeleteUser(input.id);
          if (!result.success) {
            const message =
              result.reason === "not_found"
                ? "User not found"
                : (result.blockedReasons ?? ["This account can't be permanently deleted."]).join(" ");
            throw new TRPCError({ code: "BAD_REQUEST", message });
          }

          // Doesn't block on this — the account is already fully inert via
          // users.status = "deleted" regardless of whether Supabase's own copy
          // of the identity is also gone. Surfaced in the response and the audit
          // log instead, so an admin can follow up manually if it failed.
          const authResult = await sdk.deleteSupabaseAuthUser(target.authUserId);

          await db.logAudit({
            userId: ctx.user.id,
            action: "admin.user.permanent_delete",
            entityType: "user",
            entityId: input.id,
            detail: { reason: input.reason, deletedAccount: result.snapshot, supabaseAuthDeleted: authResult.deleted, supabaseAuthError: authResult.error },
          });

          return { success: true, supabaseAuthDeleted: authResult.deleted, supabaseAuthError: authResult.error } as const;
        }),
    }),

    finance: router({
      summary: adminPermissionProcedure("finance")
        .input(z.object({ from: z.string().optional(), to: z.string().optional() }).optional())
        .query(({ input }) =>
          db.getFinanceSummary({
            from: input?.from ? new Date(input.from) : undefined,
            to: input?.to ? new Date(input.to) : undefined,
          }),
        ),
      payments: adminPermissionProcedure("finance")
        .input(z.object({ status: z.enum(["pending", "successful", "failed", "refunded"]).optional(), page: z.number().int().min(0).default(0) }))
        .query(({ input }) => db.listPaymentsAdmin({ status: input.status, limit: 50, offset: input.page * 50 })),
    }),

    commission: router({
      settings: adminPermissionProcedure("finance").query(() => db.getPlatformSettings()),
      /** Forward-only — see updateDefaultCommissionRate's own comment in db.ts.
       *  Existing providers and any payout not yet released are unaffected. */
      updateDefaultRate: adminPermissionProcedure("finance")
        .input(z.object({ rate: z.number().min(0).max(100), reason: z.string().min(3).max(1000) }))
        .mutation(async ({ ctx, input }) => {
          const result = await db.updateDefaultCommissionRate({ rate: input.rate, updatedByUserId: ctx.user.id });
          await db.logAudit({
            userId: ctx.user.id,
            action: "admin.commission.update_default_rate",
            entityType: "platform_settings",
            detail: { from: result.from, to: result.to, reason: input.reason },
          });
          return { success: true, ...result } as const;
        }),
      /** Forward-only, same as the commission rate — see updateBookingFeeSettings's
       *  own comment in db.ts. */
      updateBookingFee: adminPermissionProcedure("finance")
        .input(z.object({ enabled: z.boolean(), amount: z.number().min(0).max(1_000_000), reason: z.string().min(3).max(1000) }))
        .mutation(async ({ ctx, input }) => {
          const result = await db.updateBookingFeeSettings({ enabled: input.enabled, amount: input.amount, updatedByUserId: ctx.user.id });
          await db.logAudit({
            userId: ctx.user.id,
            action: "admin.commission.update_booking_fee",
            entityType: "platform_settings",
            detail: { ...result, reason: input.reason },
          });
          return { success: true, ...result } as const;
        }),
      /** Real, itemized commission per booking — derived from released payouts, same
       *  math as finance.summary's aggregate figure, see listCommissionLedger in db.ts. */
      ledger: adminPermissionProcedure("finance")
        .input(z.object({ from: z.string().optional(), to: z.string().optional(), page: z.number().int().min(0).default(0) }))
        .query(({ input }) =>
          db.listCommissionLedger({
            from: input.from ? new Date(input.from) : undefined,
            to: input.to ? new Date(input.to) : undefined,
            limit: 50,
            offset: input.page * 50,
          }),
        ),
    }),

    support: router({
      list: adminPermissionProcedure("disputes")
        .input(
          z.object({
            status: z.enum(["open", "in_progress", "resolved", "closed"]).optional(),
            priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
            page: z.number().int().min(0).default(0),
          }),
        )
        .query(({ input }) => db.listSupportTicketsAdmin({ status: input.status, priority: input.priority, limit: 50, offset: input.page * 50 })),
      /** Just enough to populate an "assign to" dropdown — full admin_management.list
       *  (with role detail) stays super_admin-only, this doesn't need that. */
      assignableAdmins: adminPermissionProcedure("disputes").query(() => db.listAdminUsers()),
      update: adminPermissionProcedure("disputes")
        .input(
          z.object({
            id: idSchema,
            status: z.enum(["open", "in_progress", "resolved", "closed"]).optional(),
            priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
            assignedToUserId: idSchema.nullable().optional(),
            internalNotes: z.string().max(4000).optional(),
          }),
        )
        .mutation(async ({ ctx, input }) => {
          const { id, ...data } = input;
          await db.updateSupportTicketAdmin(id, data);
          await db.logAudit({ userId: ctx.user.id, action: "admin.support_ticket.update", entityType: "support_ticket", entityId: id, detail: data });
          return { success: true } as const;
        }),
    }),

    auditLogs: router({
      list: adminPermissionProcedure()
        .input(
          z.object({
            action: z.string().max(128).optional(),
            entityType: z.string().max(64).optional(),
            userId: idSchema.optional(),
            from: z.string().optional(),
            to: z.string().optional(),
            page: z.number().int().min(0).default(0),
          }),
        )
        .query(({ input }) =>
          db.listAuditLogs({
            action: input.action,
            entityType: input.entityType,
            userId: input.userId,
            from: input.from ? new Date(input.from) : undefined,
            to: input.to ? new Date(input.to) : undefined,
            limit: 50,
            offset: input.page * 50,
          }),
        ),
      actions: adminPermissionProcedure().query(() => db.listDistinctAuditActions()),
    }),

    /** Super-admin-only: who has dashboard access and which roles they hold. */
    adminUsers: router({
      list: adminPermissionProcedure().query(() => db.listAdminUsers()),
      findByEmail: adminPermissionProcedure()
        .input(z.object({ email: z.string().email() }))
        .query(({ input }) => db.findUserByEmail(input.email)),
      assignRole: adminPermissionProcedure()
        .input(z.object({ userId: idSchema, role: z.enum(ADMIN_ROLES) }))
        .mutation(async ({ ctx, input }) => {
          await db.assignAdminRole({ targetUserId: input.userId, role: input.role, assignedByUserId: ctx.user.id });
          await db.logAudit({
            userId: ctx.user.id,
            action: "admin.role.assign",
            entityType: "user",
            entityId: input.userId,
            detail: { role: input.role },
          });
          return { success: true } as const;
        }),
      removeRole: adminPermissionProcedure()
        .input(z.object({ userId: idSchema, role: z.enum(ADMIN_ROLES) }))
        .mutation(async ({ ctx, input }) => {
          if (input.userId === ctx.user.id && input.role === "super_admin") {
            throw new TRPCError({ code: "BAD_REQUEST", message: "You can't remove your own Super Admin role." });
          }
          await db.removeAdminRole({ targetUserId: input.userId, role: input.role });
          await db.logAudit({
            userId: ctx.user.id,
            action: "admin.role.remove",
            entityType: "user",
            entityId: input.userId,
            detail: { role: input.role },
          });
          return { success: true } as const;
        }),
      setActive: adminPermissionProcedure()
        .input(z.object({ userId: idSchema, active: z.boolean() }))
        .mutation(async ({ ctx, input }) => {
          if (input.userId === ctx.user.id) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "You can't deactivate your own admin access." });
          }
          await db.setAdminAccountActive({ targetUserId: input.userId, active: input.active });
          await db.logAudit({
            userId: ctx.user.id,
            action: input.active ? "admin.account.activate" : "admin.account.deactivate",
            entityType: "user",
            entityId: input.userId,
          });
          return { success: true } as const;
        }),
    }),
  }),
});

export type AppRouter = typeof appRouter;
