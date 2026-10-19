import { afterEach, expect, it, vi } from "vitest";
import {
  mkdtemp,
  mkdir,
  rm,
  writeFile,
  truncate,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeTikTokUrl } from "../packages/contracts/src/asset-import.js";
import {
  ensureTikTokRuntime,
  classifyTikTokError,
  downloadTikTok,
  runDownloadCommand,
} from "../packages/storage/src/tiktok.js";

const dirs: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    dirs.splice(0).map((p) => rm(p, { recursive: true, force: true })),
  );
});

it("accepts TikTok video/share links and rejects profiles, live streams, photos and URL tricks", () => {
  for (const url of [
    "https://www.tiktok.com/@name/video/123",
    "https://vm.tiktok.com/Abc/",
    "https://vt.tiktok.com/Abc/",
    "https://www.tiktok.com/t/Abc/",
    "https://www.tiktok.com/share/video/123/",
  ])
    expect(normalizeTikTokUrl(url)).toMatch(/^https:/);
  for (const url of [
    "https://tiktok.com.evil.test/@a/video/123",
    "https://user@www.tiktok.com/@a/video/123",
    "https://www.tiktok.com:8080/@a/video/123",
    "https://www.tiktok.com/@a",
    "https://www.tiktok.com/@a/live",
    "https://www.tiktok.com/@a/photo/123",
    "file:///tmp/a.mp4",
  ])
    expect(() => normalizeTikTokUrl(url)).toThrow();
});

it("automatically prepares the locked local environment once for concurrent first downloads", async () => {
  const root = await mkdtemp(join(tmpdir(), "rikoko-downloader-runtime-"));
  dirs.push(root);
  await mkdir(join(root, "python"));
  await writeFile(
    join(root, "python/pyproject.toml"),
    '[project]\ndependencies = ["yt-dlp[default,curl-cffi]==2026.8.19", "curl-cffi==0.16.0"]\n',
  );
  await writeFile(join(root, "python/uv.lock"), "fixture-lock");
  let ready = false;
  const run = vi.fn(async (file: string) => {
    if (file === "uv") {
      ready = true;
      return "";
    }
    if (!ready) throw Error("missing dependency");
    return "";
  });
  const [a, b] = await Promise.all([
    ensureTikTokRuntime({ root, run }),
    ensureTikTokRuntime({ root, run }),
  ]);
  expect(a.python).toBe(b.python);
  expect(run.mock.calls.filter(([file]) => file === "uv")).toHaveLength(1);
  const preparation = run.mock.calls.find(([file]) => file === "uv")! as any[];
  expect(preparation[1]).toEqual(expect.arrayContaining(["sync", "--frozen"]));
  await ensureTikTokRuntime({ root, run });
  expect(run.mock.calls.filter(([file]) => file === "uv")).toHaveLength(1);
  await writeFile(
    join(root, "python/uv.lock"),
    "changed-transitive-dependency",
  );
  await ensureTikTokRuntime({ root, run });
  expect(run.mock.calls.filter(([file]) => file === "uv")).toHaveLength(2);
});

it("cancels a real downloader process and does not forward model credentials", async () => {
  vi.stubEnv("FAL_KEY", "private-fixture");
  expect(
    await runDownloadCommand(process.execPath, [
      "-e",
      "process.stdout.write(String(process.env.FAL_KEY === undefined))",
    ]),
  ).toBe("true");
  const abort = new AbortController();
  const running = runDownloadCommand(
    globalThis.process.execPath,
    ["-e", "setInterval(() => {}, 1000)"],
    { signal: abort.signal },
  );
  abort.abort();
  await expect(running).rejects.toMatchObject({ code: "CANCELLED" });
});

it("enforces a finite execution deadline", async () => {
  await expect(
    runDownloadCommand(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      { timeoutMs: 25 },
    ),
  ).rejects.toMatchObject({ code: "DOWNLOAD_TIMEOUT" });
});

it("maps only known failures and redacts links and credentials from reported errors", () => {
  expect(classifyTikTokError("TikTok is requiring login for access").code).toBe(
    "DOWNLOAD_LOGIN_REQUIRED",
  );
  expect(
    classifyTikTokError("Your IP address is blocked from accessing this post")
      .code,
  ).toBe("DOWNLOAD_PLATFORM_BLOCKED");
  expect(
    classifyTikTokError("Unable to extract universal data for rehydration")
      .code,
  ).toBe("DOWNLOAD_EXTRACTOR_FAILED");
  expect(
    classifyTikTokError(
      "ERROR: No suitable extractor found for URL https://www.tiktok.com/",
    ).code,
  ).toBe("DOWNLOAD_LINK_UNRESOLVED");
  const error = classifyTikTokError(
    "HTTP Error 403: Forbidden https://user:secret@host/file?token=private",
  );
  expect(error.message).not.toContain("secret");
  expect(error.message).not.toContain("private");
  expect(error.code).toBe("DOWNLOAD_PLATFORM_BLOCKED");
});

it("rejects unsafe input before preparing or making network requests", async () => {
  const run = vi.fn();
  await expect(
    downloadTikTok("https://www.tiktok.com/@a/live", "/tmp", { run }),
  ).rejects.toMatchObject({ code: "UNSUPPORTED_VIDEO_URL" });
  expect(run).not.toHaveBeenCalled();
});

async function downloaderFixture() {
  vi.stubEnv("RIKOKO_DOWNLOAD_PROXY", "");
  const root = await mkdtemp(join(tmpdir(), "rikoko-downloader-fixture-"));
  dirs.push(root);
  await mkdir(join(root, "python"));
  await writeFile(
    join(root, "python/pyproject.toml"),
    '[project]\ndependencies = ["yt-dlp[default,curl-cffi]==2026.8.19", "curl-cffi==0.16.0"]\n',
  );
  await writeFile(join(root, "python/uv.lock"), "fixture-lock");
  const work = join(root, "work");
  await mkdir(work);
  return { root, work };
}

it("downloads one video with both extractor names and returns the actual final file", async () => {
  const { root, work } = await downloaderFixture();
  const phases: string[] = [];
  const run = vi.fn(async (_file: string, args: string[]) => {
    if (!args.includes("--output")) return "";
    expect(args).toEqual(
      expect.arrayContaining([
        "^TikTok$,^vm[.]tiktok$",
        "bv*+ba/b",
        "--ignore-config",
        "--no-plugin-dirs",
        "--no-remote-components",
        "--no-playlist",
      ]),
    );
    const path = join(work, "source.mp4");
    await writeFile(path, "fixture-media");
    return JSON.stringify({ path, id: "123" });
  });
  expect(
    await downloadTikTok("https://vm.tiktok.com/Abc/", work, {
      root,
      run,
      onPhase: async (phase) => {
        phases.push(phase);
      },
    }),
  ).toMatchObject({
    path: await realpath(join(work, "source.mp4")),
    videoId: "123",
  });
  expect(phases).toEqual([
    "preparing_download",
    "downloading",
    "probing_download",
  ]);
});

it("refuses output outside the private work directory and oversized final files", async () => {
  const { root, work } = await downloaderFixture();
  const outside = join(root, "escape.mp4");
  await writeFile(outside, "fixture");
  let path = outside;
  const run = vi.fn(async (_file: string, args: string[]) =>
    args.includes("--output") ? JSON.stringify({ path, id: "123" }) : "",
  );
  await expect(
    downloadTikTok("https://vm.tiktok.com/Abc/", work, { root, run }),
  ).rejects.toMatchObject({ code: "INVALID_MEDIA" });
  path = join(work, "source.mp4");
  await writeFile(path, "fixture");
  await truncate(path, 101 * 1024 * 1024);
  await expect(
    downloadTikTok("https://vm.tiktok.com/Abc/", work, { root, run }),
  ).rejects.toMatchObject({ code: "FILE_TOO_LARGE" });
});

it("cancels promptly during shared setup while letting the dependency preparation finish safely", async () => {
  const { root, work } = await downloaderFixture();
  let release!: () => void;
  const prepared = new Promise<void>((resolve) => {
    release = resolve;
  });
  const run = vi.fn(async (file: string) => {
    if (file === "uv") await prepared;
    return "";
  });
  const abort = new AbortController();
  const download = downloadTikTok("https://vm.tiktok.com/Abc/", work, {
    root,
    run,
    signal: abort.signal,
  });
  await vi.waitFor(() =>
    expect(run.mock.calls.some(([file]) => file === "uv")).toBe(true),
  );
  abort.abort();
  await expect(download).rejects.toMatchObject({ code: "CANCELLED" });
  release();
  await ensureTikTokRuntime({ root, run });
});
