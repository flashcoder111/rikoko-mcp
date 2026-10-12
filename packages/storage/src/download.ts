import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import ipaddr from "ipaddr.js";
import { AppError } from "../../contracts/src/index.js";
export function assertPublicIp(address: string) {
  const parsed = ipaddr.process(address);
  if (parsed.range() !== "unicast")
    throw new AppError(
      "UNSAFE_URL",
      "Private and special network destinations are blocked",
    );
}
export async function downloadPublic(
  url: string,
  maxBytes = 100 * 1024 * 1024,
  depth = 0,
): Promise<Uint8Array> {
  if (depth > 4) throw new AppError("TOO_MANY_REDIRECTS", "Too many redirects");
  const u = new URL(url);
  if (
    !["http:", "https:"].includes(u.protocol) ||
    u.username ||
    u.password ||
    (u.port && !["80", "443"].includes(u.port))
  )
    throw new AppError(
      "UNSAFE_URL",
      "Only public HTTP(S) media URLs are supported",
    );
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const addresses = await lookup(host, { all: true });
  if (!addresses.length)
    throw new AppError("UNSAFE_URL", "Host has no addresses");
  for (const a of addresses) assertPublicIp(a.address);
  const address = addresses[0]!;
  return new Promise((resolve, reject) => {
    const req = (u.protocol === "https:" ? httpsRequest : httpRequest)(
      u,
      {
        lookup: (_hostname, options: any, callback: any) => {
          if (options?.all) callback(null, [address]);
          else callback(null, address.address, address.family);
        },
        headers: {
          Accept: "video/*,audio/*,image/*",
          "User-Agent": "VideoWorkbench/0.1",
        },
      },
      (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          res.resume();
          downloadPublic(
            new URL(res.headers.location, u).toString(),
            maxBytes,
            depth + 1,
          ).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(
            new AppError(
              "DOWNLOAD_FAILED",
              `Media returned HTTP ${res.statusCode}`,
            ),
          );
          return;
        }
        if (Number(res.headers["content-length"]) > maxBytes) {
          res.destroy();
          reject(new AppError("FILE_TOO_LARGE", "Media exceeds size limit"));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            res.destroy();
            reject(new AppError("FILE_TOO_LARGE", "Media exceeds size limit"));
          } else chunks.push(chunk);
        });
        res.on("error", reject);
        res.on("end", () => resolve(Buffer.concat(chunks)));
      },
    );
    const deadline = setTimeout(
      () =>
        req.destroy(
          new AppError("DOWNLOAD_TIMEOUT", "Media download timed out"),
        ),
      30000,
    );
    req.on("close", () => clearTimeout(deadline));
    req.on("error", reject);
    req.end();
  });
}
