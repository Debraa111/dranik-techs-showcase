import { ENV } from "./env";

/**
 * Sends an operational alert to the project owner. Manus's hosted owner-notification
 * channel isn't available outside their platform, so this logs locally instead.
 * Swap this out for a real channel (email, Slack webhook, etc.) when you have one.
 */
export async function notifyOwner({ title, content }: { title: string; content: string }): Promise<boolean> {
  console.log(`[Owner Notification]${ENV.ownerName ? ` to ${ENV.ownerName}` : ""}: ${title}\n${content}`);
  return true;
}
