import { execFile } from "node:child_process";
import { Agent, request } from "node:https";
import { connect as connectTls } from "node:tls";
import { isIP, type Socket } from "node:net";
import { assertPublicIp } from "./download.js";
import { AppError } from "../../contracts/src/index.js";

export async function configuredDownloadProxy(): Promise<string | undefined> {
  if (process.env.RIKOKO_DOWNLOAD_PROXY !== undefined)
    return process.env.RIKOKO_DOWNLOAD_PROXY || undefined;
  for (const key of ["https_proxy", "HTTPS_PROXY", "http_proxy", "HTTP_PROXY"])
    if (process.env[key]) return process.env[key];
  if (process.platform !== "darwin") return undefined;
  // macOS GUI clients often inherit no proxy environment variables. Reuse the
  // user's enabled system web proxy without changing their system settings.
  return new Promise((resolve) => {
    execFile(
      "/usr/sbin/scutil",
      ["--proxy"],
      { timeout: 2000, maxBuffer: 65536 },
      (error, output) => {
        if (error) {
          resolve(undefined);
          return;
        }
        for (const kind of ["HTTPS", "HTTP"]) {
          const enabled = new RegExp(
            `^\\s*${kind}Enable\\s*:\\s*1\\s*$`,
            "m",
          ).test(output);
          const host = new RegExp(
            `^\\s*${kind}Proxy\\s*:\\s*(\\S+)\\s*$`,
            "m",
          ).exec(output)?.[1];
          const port = new RegExp(
            `^\\s*${kind}Port\\s*:\\s*(\\d+)\\s*$`,
            "m",
          ).exec(output)?.[1];
          if (
            enabled &&
            host &&
            port &&
            Number(port) > 0 &&
            Number(port) <= 65535
          ) {
            resolve(`http://${isIP(host) === 6 ? `[${host}]` : host}:${port}`);
            return;
          }
        }
        resolve(undefined);
      },
    );
  });
}

export function isSyntheticProxyAddress(address: string) {
  return /^198\.(?:18|19)\./.test(address);
}

/** A local VPN's fake-IP DNS cannot be used as a public destination. Query a
 * fixed TLS-authenticated resolver through the selected user proxy instead,
 * then connect only to the checked real address. Never allow fake IPs directly. */
export async function resolveProxyDns(
  host: string,
  dial: (address: string, port: number) => Promise<Socket>,
  signal?: AbortSignal,
) {
  if (isIP(host)) throw new AppError("UNSAFE_URL", "非公网下载地址被阻止。");
  const socket = await dial("1.1.1.1", 443);
  const agent = new Agent();
  agent.createConnection = () =>
    connectTls({ socket, servername: "cloudflare-dns.com" });
  return new Promise<{ address: string; family: number }>((resolve, reject) => {
    const outgoing = request(
      {
        hostname: "cloudflare-dns.com",
        path: `/dns-query?name=${encodeURIComponent(host)}&type=A`,
        headers: { Accept: "application/dns-json" },
        agent,
        signal,
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
          if (body.length > 65536)
            outgoing.destroy(Error("DNS response too large"));
        });
        response.on("error", reject);
        response.on("end", () => {
          try {
            if (response.statusCode !== 200) throw Error("DNS request failed");
            const result = JSON.parse(body);
            const answers = (result.Answer ?? []).filter(
              (entry: { type: number }) => entry.type === 1,
            );
            if (result.Status !== 0 || !answers.length)
              throw Error("No public DNS answer");
            for (const entry of answers) assertPublicIp(entry.data);
            resolve({ address: answers[0].data, family: 4 });
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    const timer = setTimeout(
      () => outgoing.destroy(Error("DNS timeout")),
      10_000,
    );
    outgoing.once("error", reject);
    outgoing.once("close", () => {
      clearTimeout(timer);
      agent.destroy();
      socket.destroy();
    });
    outgoing.end();
  });
}
