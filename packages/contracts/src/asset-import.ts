import { z } from "zod";

export const urlImportSchema = z
  .object({
    url: z.url().max(4096),
    name: z.string().min(1).max(120),
    license: z.string().min(1).max(100).default("user-provided"),
    rightsConfirmed: z.literal(true).optional(),
    idempotencyKey: z.string().min(1).max(128).optional(),
  })
  .strict();

export function isTikTokUrl(value: string) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return [
      "tiktok.com",
      "www.tiktok.com",
      "vm.tiktok.com",
      "vt.tiktok.com",
    ].includes(host);
  } catch {
    return false;
  }
}

export function normalizeTikTokUrl(value: string) {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  const short = ["vm.tiktok.com", "vt.tiktok.com"].includes(host);
  const main = ["tiktok.com", "www.tiktok.com"].includes(host);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !(
      (short && /^\/[a-zA-Z0-9]+\/?$/.test(url.pathname)) ||
      (main &&
        /^(?:\/@[\w.-]*\/video\/\d+|\/share\/video\/\d+|\/embed\/\d+|\/t\/[a-zA-Z0-9]+)\/?$/.test(
          url.pathname,
        ))
    )
  )
    throw Error("Only HTTPS TikTok single-video and share links are supported");
  if (main) url.hostname = "www.tiktok.com";
  url.hash = "";
  url.search = "";
  return url.href;
}

export const videoImportOperationSchema = urlImportSchema
  .omit({ idempotencyKey: true })
  .extend({
    kind: z.literal("import_video"),
    url: z
      .url()
      .max(4096)
      .refine((value) => {
        try {
          normalizeTikTokUrl(value);
          return true;
        } catch {
          return false;
        }
      }, "Select one TikTok video or share link"),
  });
