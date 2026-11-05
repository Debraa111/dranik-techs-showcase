import { LegalDocScreen } from "@/components/legal-doc-screen";

/**
 * DRAFT placeholder text, not reviewed by a lawyer — written to reflect this app's
 * real data practices (Supabase for auth/data, Paystack for payments, phone numbers
 * deliberately never shared cross-party, push tokens) so it's specific rather than
 * generic filler, but this must go through real legal review (and likely NDPR
 * compliance review, given this app targets Nigeria) before production use.
 */
const SECTIONS = [
  {
    heading: "1. Information we collect",
    body: "Account details you provide (name, email, phone number, profile photo), booking and payment history, location (only while using the app, to show nearby providers and distances), photos you upload (reviews, job completion), and messages you send through in-app chat. Providers additionally provide business details and verification documents.",
  },
  {
    heading: "2. How we use your information",
    body: "To operate bookings, payments, and messaging; to show you relevant nearby services; to send booking-related and, if enabled, promotional notifications; to verify provider identity and prevent fraud; and to improve the app.",
  },
  {
    heading: "3. What we don't share",
    body: "Your phone number is never shared with the other party in a booking — all contact happens through in-app messaging. Payment card details are handled directly by our payment processor (Paystack) and are never stored on our servers.",
  },
  {
    heading: "4. Third-party services",
    body: "We use Supabase for authentication and data storage, and Paystack for payment processing. Push notifications, where enabled, are delivered via Expo's push notification service. These providers process data on our behalf under their own security practices.",
  },
  {
    heading: "5. Location data",
    body: "Location is used only to sort and display nearby providers/distance while you're actively using the app. We don't track location in the background.",
  },
  {
    heading: "6. Data retention and deletion",
    body: "You can request account deletion at any time from your Profile. This removes your personal details (name, email, phone, photo) from your account. Some records (like completed transaction history) may be retained as required for financial recordkeeping.",
  },
  {
    heading: "7. Your rights",
    body: "You can access and update most of your information directly in the app (Profile, Addresses, Notification Settings), and can request account deletion at any time. Contact support@example.com for any other data request.",
  },
  {
    heading: "8. Children's privacy",
    body: "D'RANIK Techs is not directed at children under 18. Provider accounts specifically require the account holder to be an adult.",
  },
  {
    heading: "9. Changes to this policy",
    body: "We may update this policy from time to time. Continued use of the app after a change means you accept the updated policy.",
  },
  {
    heading: "10. Contact",
    body: "Questions about this policy can be sent to support@example.com.",
  },
];

export default function PrivacyPolicyScreen() {
  return (
    <LegalDocScreen
      title="Privacy Policy"
      lastUpdated="Draft — pending legal review"
      intro="This policy explains what information D'RANIK Techs collects and how it's used."
      sections={SECTIONS}
    />
  );
}
