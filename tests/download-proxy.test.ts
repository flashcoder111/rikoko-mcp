import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createServer, request } from "node:http";
import { connect } from "node:net";
import { openDownloadProxy } from "../packages/storage/src/download-proxy.js";

const state = vi.hoisted(() => ({ lookup: vi.fn(), connect: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: state.lookup }));
vi.mock("node:net", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:net")>()),
  connect: state.connect,
}));
const closers: Array<() => Promise<unknown>> = [];
beforeEach(() => {
  state.lookup.mockReset();
  state.connect.mockReset();
  vi.unstubAllEnvs();
  vi.stubEnv("RIKOKO_DOWNLOAD_PROXY", "");
});
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
  vi.unstubAllEnvs();
});

async function proxy() {
  const value = await openDownloadProxy();
  closers.push(value.close);
  return value;
}

async function connectStatus(url: string, target: string) {
  return new Promise<number>((resolve, reject) => {
    const outgoing = request({
      hostname: "127.0.0.1",
      port: new URL(url).port,
      method: "CONNECT",
      path: target,
    });
    outgoing.on("connect", (response, socket) => {
      resolve(response.statusCode!);
      socket.destroy();
    });
    outgoing.on("error", reject);
    outgoing.end();
  });
}

it("blocks private, mapped, metadata and mixed DNS targets before opening a socket", async () => {
  const value = await proxy();
  for (const addresses of [
    ["127.0.0.1"],
    ["::ffff:127.0.0.1"],
    ["169.254.169.254"],
    ["1.1.1.1", "10.0.0.1"],
  ]) {
    state.lookup.mockResolvedValue(
      addresses.map((address) => ({
        address,
        family: address.includes(":") ? 6 : 4,
      })),
    );
    expect(await connectStatus(value.url, "cdn.example.test:443")).toBe(403);
  }
  expect(state.connect).not.toHaveBeenCalled();
  expect(value.failure()?.code).toBe("UNSAFE_URL");
});

it("rechecks each redirected destination and refuses non-web ports", async () => {
  state.lookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
  const value = await proxy();
  expect(await connectStatus(value.url, "www.tiktok.com:443")).toBe(403);
  expect(await connectStatus(value.url, "cdn.example.test:443")).toBe(403);
  expect(state.lookup).toHaveBeenCalledTimes(2);
  expect(await connectStatus(value.url, "example.test:22")).toBe(403);
  expect(state.lookup).toHaveBeenCalledTimes(2);
});

it("pins the validated public address and streams HTTP media through it", async () => {
  const fixture = createServer((incoming, response) => {
    expect(incoming.headers.host).toBe("cdn.example.test");
    expect(incoming.headers["proxy-authorization"]).toBeUndefined();
    response.end("media-bytes");
  });
  await new Promise<void>((resolve) => fixture.listen(0, "127.0.0.1", resolve));
  closers.push(
    () => new Promise<void>((resolve) => fixture.close(() => resolve())),
  );
  const actual = await vi.importActual<typeof import("node:net")>("node:net");
  state.connect.mockImplementation(() =>
    actual.connect({
      host: "127.0.0.1",
      port: (fixture.address() as { port: number }).port,
    }),
  );
  state.lookup.mockResolvedValue([{ address: "1.1.1.1", family: 4 }]);
  const value = await proxy();
  const text = await new Promise<string>((resolve, reject) => {
    const outgoing = request(
      {
        hostname: "127.0.0.1",
        port: new URL(value.url).port,
        path: "http://cdn.example.test/file",
        headers: { "Proxy-Authorization": "private-fixture" },
      },
      (response) => {
        let body = "";
        response.on("data", (chunk) => (body += chunk));
        response.on("end", () => resolve(body));
      },
    );
    outgoing.on("error", reject);
    outgoing.end();
  });
  expect(text).toBe("media-bytes");
  expect(vi.mocked(connect)).toHaveBeenCalledWith({
    host: "1.1.1.1",
    port: 80,
    family: 4,
  });
});
