import { LegalDocScreen } from "@/components/legal-doc-screen";

/**
 * DRAFT placeholder text, not reviewed by a lawyer — written to cover this app's
 * actual mechanics (escrow-style payout release, admin-reviewed cancellations,
 * wallet/Paystack payments, provider verification) so the sections are specific
 * rather than generic filler, but this must go through real legal review before
 * being relied on in production. Swap this content for reviewed text when ready;
 * the screen itself (LegalDocScreen) doesn't need to change.
 */
const SECTIONS = [
  {
    heading: "1. Acceptance of terms",
    body: "By creating an account or using D'RANIK Techs, you agree to these Terms of Service. If you don't agree, please don't use the app.",
  },
  {
    heading: "2. What D'RANIK Techs is",
    body: "D'RANIK Techs is a marketplace connecting customers with independent service providers (electricians, plumbers, cleaners, beauticians, and similar). We are not the employer of any provider, and we don't perform the services ourselves — providers are independent professionals responsible for the quality and safety of their own work.",
  },
  {
    heading: "3. Accounts",
    body: "You must provide accurate information when creating an account and keep your login credentials secure. You're responsible for all activity under your account. Providers must complete our verification process before accepting live bookings.",
  },
  {
    heading: "4. Bookings, pricing, and negotiation",
    body: "You can book a service at its listed price or negotiate a price directly with a provider before booking. Once a booking is confirmed, its price is fixed unless both parties agree to a new negotiated offer through the app.",
  },
  {
    heading: "5. Payments and held payouts",
    body: "Payment is collected via card, bank transfer, or in-app wallet balance at booking. When a provider marks a job complete, payment isn't released to them immediately — it's held until you confirm completion using a handoff code, or until D'RANIK Techs support resolves the release. This protects both sides: providers know payment is secured before starting work, and customers confirm work is actually done before money moves.",
  },
  {
    heading: "6. Cancellations",
    body: "Bookings that haven't started yet can be cancelled directly in the app. Once a job is marked \"in progress,\" cancelling requires a request that D'RANIK Techs support reviews — we decide any refund to the customer and any partial payout to the provider for work already done, based on the circumstances.",
  },
  {
    heading: "7. Reviews and conduct",
    body: "Reviews must reflect a genuine experience with a booking. We may remove reviews or restrict accounts that post abusive, fraudulent, or harassing content, or that otherwise misuse the platform.",
  },
  {
    heading: "8. Liability",
    body: "D'RANIK Techs facilitates connections and payments between customers and providers but is not liable for the quality, safety, or legality of services performed by independent providers. Use the in-app messaging and reporting tools to raise any issue with a booking.",
  },
  {
    heading: "9. Changes to these terms",
    body: "We may update these terms from time to time. Continued use of the app after a change means you accept the updated terms.",
  },
  {
    heading: "10. Contact",
    body: "Questions about these terms can be sent to support@example.com.",
  },
];

export default function TermsOfServiceScreen() {
  return (
    <LegalDocScreen
      title="Terms of Service"
      lastUpdated="Draft — pending legal review"
      intro="These terms govern your use of the D'RANIK Techs app. Please read them carefully."
      sections={SECTIONS}
    />
  );
}
