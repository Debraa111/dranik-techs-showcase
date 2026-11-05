import { LegalDocScreen } from "@/components/legal-doc-screen";

/**
 * DRAFT placeholder text, not reviewed by a lawyer — written to cover this app's
 * actual provider mechanics (commission model, escrow payout/release-code process,
 * document verification workflow, account status vs. verification status as two
 * separate things) so the sections are specific rather than generic filler, but
 * this must go through real legal review before being relied on in production.
 * Separate from the customer-facing /terms — a provider's relationship with the
 * platform (getting paid, being verified, being suspended) is materially different
 * from a customer's, so this isn't just the customer terms with find-and-replace.
 */
const SECTIONS = [
  {
    heading: "1. Acceptance of terms",
    body: "By applying to become a D'RANIK Techs service provider, you agree to these Provider Terms in addition to the general Terms of Service. If you don't agree, please don't submit a provider application.",
  },
  {
    heading: "2. What you are on this platform",
    body: "You are an independent service provider, not an employee or agent of D'RANIK Techs. You're responsible for the quality, safety, and legality of the work you perform, for your own tools/equipment/insurance, and for meeting any licensing requirements your trade requires.",
  },
  {
    heading: "3. Verification",
    body: "Before you can accept live bookings, we review your application and any documents you submit (government ID, business registration where applicable). We may approve you, reject you with a reason, or ask for more information first. Being unverified or rejected doesn't affect your underlying account — you simply can't operate as a provider on the platform until approved. We may also request re-verification later.",
  },
  {
    heading: "4. Commission",
    body: "D'RANIK Techs charges a commission on each completed booking, deducted before your payout — currently 10% by default, though your specific rate is fixed to your account and won't change automatically if the platform-wide default changes later; any rate change affecting your account specifically will be communicated to you. Commission is calculated on the booking's total price at the time your payout is released, not at the time you accept the job.",
  },
  {
    heading: "5. Getting paid: held payments and the release code",
    body: "Payment for a booking isn't released to you the moment you mark a job complete. It's held until the customer confirms completion using a handoff code they give you in person, or until D'RANIK Techs support resolves the release for you if the code is lost, expired, or the customer is unreachable. This protects you too — the customer's payment is already secured in the system before you ever start the job.",
  },
  {
    heading: "6. Cancellations once a job is underway",
    body: "Before you start a job, either you or the customer can cancel directly. Once you've marked a job \"in progress,\" cancelling requires a request that D'RANIK Techs support reviews — we decide any refund to the customer and any partial payout to you for work already done, based on the circumstances you and the customer describe.",
  },
  {
    heading: "7. Account status and suspension",
    body: "Your account can be suspended or deactivated for policy violations, repeated customer complaints, fraudulent activity, or at your own request. A suspended account cannot sign in at all; a deactivated one is similarly blocked. This is separate from your verification status — losing verified status affects only your ability to operate as a provider, while account suspension affects your entire D'RANIK Techs account, customer side included.",
  },
  {
    heading: "8. Reviews and disputes",
    body: "Customers may leave reviews after a completed booking. You can respond publicly to a review or report one you believe violates platform policy. Repeated, substantiated complaints against your account may affect your verification status.",
  },
  {
    heading: "9. Changes to these terms",
    body: "We may update these terms from time to time. Continued use of your provider account after a change means you accept the updated terms.",
  },
  {
    heading: "10. Contact",
    body: "Questions about these terms can be sent to support@example.com.",
  },
];

export default function ProviderTermsScreen() {
  return (
    <LegalDocScreen
      title="Provider Terms & Conditions"
      lastUpdated="Draft — pending legal review"
      intro="These terms govern your relationship with D'RANIK Techs as a service provider, in addition to the general Terms of Service that apply to every account."
      sections={SECTIONS}
    />
  );
}
