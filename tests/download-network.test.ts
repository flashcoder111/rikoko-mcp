import { afterEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough, Readable } from "node:stream";
import type { Socket } from "node:net";
const stubs = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("node:https", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:https")>()),
  request: stubs.request,
}));
import {
  configuredDownloadProxy,
  resolveProxyDns,
} from "../packages/storage/src/download-network.js";
afterEach(() => {
  vi.unstubAllEnvs();
  stubs.request.mockReset();
});

function dns(body: unknown, status = 200) {
  stubs.request.mockImplementation((_options, callback) => {
    const request = new EventEmitter() as any;
    request.end = () =>
      queueMicrotask(() => {
        const response = Readable.from([JSON.stringify(body)]) as any;
        response.statusCode = status;
        response.on("end", () => request.emit("close"));
        callback(response);
      });
    return request;
  });
}

it("respects an explicit downloader proxy and the user's standard proxy environment", async () => {
  vi.stubEnv("RIKOKO_DOWNLOAD_PROXY", "http://127.0.0.1:7890");
  expect(await configuredDownloadProxy()).toBe("http://127.0.0.1:7890");
  vi.stubEnv("RIKOKO_DOWNLOAD_PROXY", "");
  expect(await configuredDownloadProxy()).toBeUndefined();
  vi.stubEnv("RIKOKO_DOWNLOAD_PROXY", undefined);
  vi.stubEnv("https_proxy", "http://127.0.0.1:7891");
  expect(await configuredDownloadProxy()).toBe("http://127.0.0.1:7891");
});

it("resolves VPN synthetic DNS through a fixed resolver and returns only real public addresses", async () => {
  dns({
    Status: 0,
    Answer: [
      { type: 5, data: "cdn.example.test" },
      { type: 1, data: "1.1.1.2" },
    ],
  });
  const socket = new PassThrough() as unknown as Socket;
  const dial = vi.fn().mockResolvedValue(socket);
  expect(await resolveProxyDns("www.tiktok.com", dial)).toEqual({
    address: "1.1.1.2",
    family: 4,
  });
  expect(dial).toHaveBeenCalledWith("1.1.1.1", 443);
  expect(stubs.request.mock.calls[0][0]).toMatchObject({
    hostname: "cloudflare-dns.com",
    path: "/dns-query?name=www.tiktok.com&type=A",
  });
});

it("never turns a private/mixed DNS answer or literal fake IP into an allowed destination", async () => {
  dns({
    Status: 0,
    Answer: [
      { type: 1, data: "1.1.1.2" },
      { type: 1, data: "127.0.0.1" },
    ],
  });
  await expect(
    resolveProxyDns(
      "www.tiktok.com",
      vi.fn().mockResolvedValue(new PassThrough()),
    ),
  ).rejects.toMatchObject({ code: "UNSAFE_URL" });
  const dial = vi.fn();
  await expect(resolveProxyDns("198.18.0.1", dial)).rejects.toMatchObject({
    code: "UNSAFE_URL",
  });
  expect(dial).not.toHaveBeenCalled();
});
