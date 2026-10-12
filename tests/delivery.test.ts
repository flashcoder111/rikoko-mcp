import { afterEach, expect, it, vi } from "vitest";
import { mediaResponse } from "../packages/core/src/delivery.js";
import { publicBaseUrl } from "../packages/core/src/urls.js";
afterEach(() => vi.unstubAllEnvs());
it("serves complete and bounded single ranges for native players", async () => {
  const bytes = new Uint8Array([1, 2, 3, 4, 5]);
  for (const [range, expected, status] of [
    [undefined, [1, 2, 3, 4, 5], 200],
    ["bytes=-2", [4, 5], 206],
    ["bytes=3-", [4, 5], 206],
    ["bytes=0-99", [1, 2, 3, 4, 5], 206],
  ] as const) {
    const response = mediaResponse(bytes, "video/mp4", "video.mp4", range);
    expect(response.status).toBe(status);
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual(expected);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  }
  for (const range of [
    "bytes=-",
    "bytes=-0",
    "bytes=5-",
    "bytes=4-2",
    "bytes=0-1,3-4",
    "bytes=9007199254740993-",
    "invalid",
  ]) {
    expect(mediaResponse(bytes, "video/mp4", "video.mp4", range).status).toBe(
      416,
    );
  }
});
it("publishes links only on the configured service origin", () => {
  vi.stubEnv("PUBLIC_BASE_URL", "https://video.example.test/");
  expect(publicBaseUrl()).toBe("https://video.example.test");
  for (const url of [
    "file:///tmp/example",
    "https://key:secret@example.test/",
  ]) {
    vi.stubEnv("PUBLIC_BASE_URL", url);
    expect(() => publicBaseUrl()).toThrow();
  }
});
