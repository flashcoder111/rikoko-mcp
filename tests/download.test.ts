import { EventEmitter } from "node:events";
import { expect, it, vi, beforeEach } from "vitest";
const stubs = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: stubs.lookup }));
vi.mock("node:https", () => ({ request: stubs.request }));
vi.mock("node:http", () => ({ request: stubs.request }));
import { downloadPublic } from "../packages/storage/src/download.js";
beforeEach(() => {
  stubs.lookup.mockReset();
  stubs.request.mockReset();
  stubs.lookup.mockResolvedValue([{ address: "1.1.1.1", family: 4 }]);
});
function response(
  status: number,
  headers: Record<string, string>,
  chunks: Buffer[] = [],
) {
  stubs.request.mockImplementationOnce((_url, options, callback) => {
    const req = new EventEmitter() as any;
    req.destroy = (e: Error) => {
      req.emit("error", e);
      req.emit("close");
    };
    req.end = () =>
      queueMicrotask(() => {
        options.lookup("host", { all: true }, (_e: any, result: any) =>
          expect(result[0].address).toBe("1.1.1.1"),
        );
        options.lookup("host", {}, (_e: any, ip: any) =>
          expect(ip).toBe("1.1.1.1"),
        );
        const res = new EventEmitter() as any;
        res.statusCode = status;
        res.headers = headers;
        res.resume = () => {};
        res.destroy = () => {
          req.emit("close");
        };
        callback(res);
        for (const chunk of chunks) res.emit("data", chunk);
        res.emit("end");
        req.emit("close");
      });
    return req;
  });
}
it("pins resolved public addresses and bounds the downloaded body", async () => {
  response(200, {}, [Buffer.from("abc"), Buffer.from("def")]);
  expect(
    Buffer.from(
      await downloadPublic("https://media.example.com/movie"),
    ).toString(),
  ).toBe("abcdef");
  response(200, { "content-length": "100" });
  await expect(
    downloadPublic("https://media.example.com/movie", 10),
  ).rejects.toMatchObject({ code: "FILE_TOO_LARGE" });
  response(200, {}, [Buffer.alloc(20)]);
  await expect(
    downloadPublic("https://media.example.com/movie", 10),
  ).rejects.toMatchObject({ code: "FILE_TOO_LARGE" });
});
it("rechecks redirects and refuses internal destinations", async () => {
  response(302, { location: "https://other.example.com/file" });
  response(200, {}, [Buffer.from("ok")]);
  expect(
    Buffer.from(
      await downloadPublic("http://media.example.com/file"),
    ).toString(),
  ).toBe("ok");
  expect(stubs.lookup).toHaveBeenCalledTimes(2);
  stubs.lookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
  await expect(
    downloadPublic("https://media.example.com"),
  ).rejects.toMatchObject({ code: "UNSAFE_URL" });
});
it("rejects unsafe URL forms, DNS failures, status errors and redirect loops", async () => {
  for (const url of [
    "file:///etc/passwd",
    "http://user:password@example.com",
    "http://example.com:8080",
  ])
    await expect(downloadPublic(url)).rejects.toMatchObject({
      code: "UNSAFE_URL",
    });
  await expect(
    downloadPublic("http://example.com", 10, 5),
  ).rejects.toMatchObject({ code: "TOO_MANY_REDIRECTS" });
  stubs.lookup.mockResolvedValueOnce([]);
  await expect(downloadPublic("https://example.com")).rejects.toMatchObject({
    code: "UNSAFE_URL",
  });
  response(404, {});
  await expect(downloadPublic("https://example.com")).rejects.toMatchObject({
    code: "DOWNLOAD_FAILED",
  });
});
it("aborts a stalled download at its deadline", async () => {
  vi.useFakeTimers();
  stubs.request.mockImplementation(() => {
    const req = new EventEmitter() as any;
    req.end = () => {};
    req.destroy = (e: Error) => {
      req.emit("error", e);
      req.emit("close");
    };
    return req;
  });
  const result = downloadPublic("https://example.com");
  const rejected = expect(result).rejects.toMatchObject({
    code: "DOWNLOAD_TIMEOUT",
  });
  await vi.advanceTimersByTimeAsync(30001);
  await rejected;
  vi.useRealTimers();
});
