import { relations } from "drizzle-orm";
import {
  bookings,
  categories,
  negotiationOffers,
  negotiations,
  portfolioItems,
  providerProfiles,
  services,
  users,
} from "./schema";

/**
 * Drizzle relations for the tables added by the enhancement phase
 * (portfolio + negotiations). Core tables use plain int FK columns with joins
 * expressed directly in queries (see server/db.ts).
 */
export const portfolioItemsRelations = relations(portfolioItems, ({ one }) => ({
  provider: one(providerProfiles, {
    fields: [portfolioItems.providerId],
    references: [providerProfiles.id],
  }),
  category: one(categories, {
    fields: [portfolioItems.categoryId],
    references: [categories.id],
  }),
}));

export const negotiationsRelations = relations(negotiations, ({ one, many }) => ({
  customer: one(users, {
    fields: [negotiations.customerId],
    references: [users.id],
  }),
  provider: one(providerProfiles, {
    fields: [negotiations.providerId],
    references: [providerProfiles.id],
  }),
  service: one(services, {
    fields: [negotiations.serviceId],
    references: [services.id],
  }),
  booking: one(bookings, {
    fields: [negotiations.bookingId],
    references: [bookings.id],
  }),
  offers: many(negotiationOffers),
}));

export const negotiationOffersRelations = relations(negotiationOffers, ({ one }) => ({
  negotiation: one(negotiations, {
    fields: [negotiationOffers.quoteRequestId],
    references: [negotiations.id],
  }),
}));
