import { afterEach, expect, it, vi } from "vitest";
import { createUpdateChecker } from "../packages/core/src/update-check.js";
import {
  UPDATE_COMMAND,
  UPDATE_INTERVAL_MS,
  UPDATE_MANIFEST_URL,
} from "../packages/contracts/src/updates.js";

const manifest = (version = "0.1.31") => ({
  schemaVersion: 1,
  version,
  publishedAt: "2026-10-22T00:00:00Z",
  releaseNotes: "改进版本检查。",
});
const response = (version?: string) => Response.json(manifest(version));
afterEach(() => vi.useRealTimers());

it.each([
  ["0.1.9", "0.1.10", "update_available"],
  ["0.1.30", "0.1.30", "up_to_date"],
  ["0.1.30", "0.1.12", "ahead"],
  ["0.1.30-rc.1", "0.1.30", "update_available"],
  ["0.1.30+local", "0.1.30", "up_to_date"],
  ["1.0.0", "0.99.99", "ahead"],
])(
  "compares %s against %s numerically",
  async (currentVersion, version, status) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(version));
    const checker = createUpdateChecker({ currentVersion, fetch: fetcher });
    expect(checker.snapshot().status).toBe("not_checked");
    expect(fetcher).not.toHaveBeenCalled();
    expect(await checker.check()).toMatchObject({
      status,
      currentVersion,
      latestVersion: version,
      upgradeCommand: UPDATE_COMMAND,
    });
    expect(fetcher).toHaveBeenCalledWith(
      UPDATE_MANIFEST_URL,
      expect.objectContaining({
        redirect: "error",
        credentials: "omit",
        headers: { Accept: "application/json" },
      }),
    );
  },
);

it("coalesces concurrent requests, caches six hours, throttles manual refreshes", async () => {
  let time = 1_000_000;
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => response());
  const checker = createUpdateChecker({
    currentVersion: "0.1.30",
    fetch: fetcher,
    now: () => time,
  });
  await Promise.all([checker.check(), checker.check(true), checker.check()]);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await checker.check(true);
  expect(fetcher).toHaveBeenCalledTimes(1);
  time += 60_000;
  await checker.check();
  expect(fetcher).toHaveBeenCalledTimes(1);
  await checker.check(true);
  expect(fetcher).toHaveBeenCalledTimes(2);
  time += UPDATE_INTERVAL_MS;
  await checker.check();
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it.each([
  [() => new Response("missing", { status: 404 }), "http"],
  [() => new Response("redirect", { status: 302 }), "http"],
  [() => new Response("<html>SPA fallback</html>"), "invalid_manifest"],
  [
    () => Response.json({ ...manifest(), version: "0.1.31-beta" }),
    "invalid_manifest",
  ],
  [
    () => Response.json({ ...manifest(), version: "01.2.3" }),
    "invalid_manifest",
  ],
  [
    () => Response.json({ ...manifest(), publishedAt: "yesterday" }),
    "invalid_manifest",
  ],
  [
    () => Response.json({ ...manifest(), upgradeCommand: "malicious command" }),
    "invalid_manifest",
  ],
  [
    () => Response.json({ ...manifest(), releaseNotes: "x".repeat(4001) }),
    "invalid_manifest",
  ],
  [
    () =>
      new Response("x".repeat(32769), {
        headers: { "content-type": "application/json" },
      }),
    "invalid_manifest",
  ],
  [
    () =>
      new Response("{}", {
        headers: {
          "content-type": "application/json",
          "content-length": "32769",
        },
      }),
    "invalid_manifest",
  ],
])(
  "fails closed for bad endpoint response %#",
  async (makeResponse, errorCode) => {
    const checker = createUpdateChecker({
      currentVersion: "0.1.30",
      fetch: vi.fn<typeof fetch>().mockResolvedValue(makeResponse()),
    });
    expect(await checker.check()).toMatchObject({
      status: "unavailable",
      errorCode,
    });
    expect(checker.snapshot().latestVersion).toBeUndefined();
  },
);

it("does not report up to date on network failure and retries after five minutes", async () => {
  let time = 1_000_000;
  const fetcher = vi
    .fn<typeof fetch>()
    .mockRejectedValueOnce(Error("private network details"))
    .mockImplementation(async () => response());
  const checker = createUpdateChecker({
    currentVersion: "0.1.30",
    fetch: fetcher,
    now: () => time,
  });
  const failed = await checker.check();
  expect(failed).toMatchObject({ status: "unavailable", errorCode: "network" });
  expect(JSON.stringify(failed)).not.toContain("private network details");
  await checker.check();
  expect(fetcher).toHaveBeenCalledTimes(1);
  time += 300_000;
  expect((await checker.check()).status).toBe("update_available");
});

it("aborts a stalled response body after four seconds", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn<typeof fetch>().mockImplementation(
    async (_input, init) =>
      new Response(
        new ReadableStream({
          start(controller) {
            init?.signal?.addEventListener(
              "abort",
              () => controller.error(Error("aborted")),
              { once: true },
            );
          },
        }),
        { headers: { "content-type": "application/json" } },
      ),
  );
  const checker = createUpdateChecker({
    currentVersion: "0.1.30",
    fetch: fetcher,
  });
  const pending = checker.check();
  await vi.advanceTimersByTimeAsync(4000);
  expect(await pending).toMatchObject({
    status: "unavailable",
    errorCode: "timeout",
  });
});

it("rejects an unknown runtime version rather than advertising an upgrade", async () => {
  const checker = createUpdateChecker({
    currentVersion: "development",
    fetch: vi.fn<typeof fetch>().mockResolvedValue(response()),
  });
  expect(await checker.check()).toMatchObject({
    status: "unavailable",
    errorCode: "invalid_version",
  });
});
