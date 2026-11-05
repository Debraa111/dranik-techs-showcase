/**
 * File storage helpers. The original app used Manus's Forge S3 proxy, which
 * isn't available outside their platform. This is a local-disk implementation
 * with the same interface — swap it for a real S3/R2 client when you have
 * credentials, without touching call sites.
 */

import fs from "fs";
import path from "path";

const UPLOADS_DIR = path.join(process.cwd(), "uploads");

function normalizeKey(relKey: string): string {
  return relKey.replace(/^\/+/, "");
}

function appendHashSuffix(relKey: string): string {
  const hash = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const lastDot = relKey.lastIndexOf(".");
  if (lastDot === -1) return `${relKey}_${hash}`;
  return `${relKey.slice(0, lastDot)}_${hash}${relKey.slice(lastDot)}`;
}

/**
 * `baseUrl` (e.g. `https://your-tunnel.ngrok-free.dev`, derived by the caller from the
 * current request — see uploads.file in routers.ts) is prepended so callers get back a
 * genuine absolute URL. Without it, native Image components have no host to resolve a
 * bare `/uploads/...` path against, and it fails strict `z.string().url()` validation.
 */
function toUrl(key: string, baseUrl?: string): string {
  const relative = `/uploads/${key}`;
  return baseUrl ? `${baseUrl}${relative}` : relative;
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  _contentType = "application/octet-stream",
  baseUrl?: string,
): Promise<{ key: string; url: string }> {
  const key = appendHashSuffix(normalizeKey(relKey));
  const filePath = path.join(UPLOADS_DIR, key);

  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, data);

  return { key, url: toUrl(key, baseUrl) };
}

export async function storageGet(relKey: string, baseUrl?: string): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  return { key, url: toUrl(key, baseUrl) };
}

export async function storageGetSignedUrl(relKey: string, baseUrl?: string): Promise<string> {
  // Local disk has no expiring signed URLs — the static file route is public.
  return toUrl(normalizeKey(relKey), baseUrl);
}

export { UPLOADS_DIR };
