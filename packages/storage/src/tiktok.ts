import { spawn } from "node:child_process";
import {
  readFile,
  readdir,
  lstat,
  realpath,
  chmod,
  mkdir,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, join, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "smol-toml";
import { AppError } from "../../contracts/src/index.js";
import { normalizeTikTokUrl } from "../../contracts/src/asset-import.js";
import { openDownloadProxy } from "./download-proxy.js";
import { configuredDownloadProxy } from "./download-network.js";

const MAX_BYTES = 100 * 1024 * 1024;
type RunOptions = {
  signal?: AbortSignal;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  guard?: () => Promise<void>;
};
type Runner = (
  file: string,
  args: string[],
  options?: RunOptions,
) => Promise<string>;
type RuntimeOptions = { root?: string; run?: Runner };
export type DownloadPhase =
  "preparing_download" | "downloading" | "probing_download";
const preparing = new Map<
  string,
  Promise<{ python: string; version: string }>
>();

function downloadEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of [
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "SYSTEMROOT",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
  ])
    if (process.env[key]) env[key] = process.env[key];
  return {
    ...env,
    PYTHONNOUSERSITE: "1",
    PYTHONUNBUFFERED: "1",
    NO_PROXY: "",
    no_proxy: "",
  };
}

export const runDownloadCommand: Runner = (file, args, options = {}) =>
  new Promise((accept, reject) => {
    if (options.signal?.aborted) {
      reject(new AppError("CANCELLED", "下载已取消。"));
      return;
    }
    const child = spawn(file, args, {
      cwd: options.cwd,
      env: options.env ?? downloadEnvironment(),
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "",
      stderr = "",
      finished = false,
      stopped: AppError | undefined,
      killTimer: ReturnType<typeof setTimeout> | undefined;
    const kill = (force = false) => {
      try {
        if (child.pid && process.platform !== "win32")
          process.kill(-child.pid, force ? "SIGKILL" : "SIGTERM");
        else child.kill(force ? "SIGKILL" : "SIGTERM");
      } catch {
        /* Process already exited. */
      }
    };
    const stop = (error: AppError) => {
      if (stopped || finished) return;
      stopped = error;
      kill();
      killTimer = setTimeout(() => kill(true), 2000);
      killTimer.unref();
    };
    const abort = () => stop(new AppError("CANCELLED", "下载已取消。"));
    options.signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(
      () =>
        stop(
          new AppError(
            "DOWNLOAD_TIMEOUT",
            "下载或环境准备超时，请检查本地网络后重试。",
          ),
        ),
      options.timeoutMs ?? 180_000,
    );
    let checking = false;
    const guard = options.guard
      ? setInterval(async () => {
          if (checking || stopped) return;
          checking = true;
          try {
            await options.guard!();
          } catch (error) {
            stop(
              error instanceof AppError
                ? error
                : new AppError("DOWNLOAD_FAILED", "下载文件检查失败。"),
            );
          } finally {
            checking = false;
          }
        }, 200)
      : undefined;
    const cleanup = () => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      clearInterval(guard);
      options.signal?.removeEventListener("abort", abort);
    };
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
      if (stdout.length > 1_000_000)
        stop(new AppError("DOWNLOAD_FAILED", "下载器返回内容过大。"));
    });
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + String(chunk)).slice(-8000);
    });
    child.once("error", () => {
      finished = true;
      cleanup();
      reject(
        new AppError(
          "DOWNLOAD_SETUP_FAILED",
          "下载工具启动失败，rikoko 将在下次使用时重新检查运行环境。",
        ),
      );
    });
    child.once("close", (code) => {
      if (stopped) kill(true);
      finished = true;
      cleanup();
      if (stopped) reject(stopped);
      else if (code !== 0) reject(new Error(stderr));
      else accept(stdout);
    });
  });

export async function ensureTikTokRuntime(options: RuntimeOptions = {}) {
  const root =
    options.root ??
    process.env.WORKBENCH_ROOT ??
    fileURLToPath(new URL("../../../", import.meta.url));
  const existing = preparing.get(root);
  if (existing) return existing;
  const task = (async () => {
    const run = options.run ?? runDownloadCommand;
    const project = resolve(root, "python");
    const manifest = parse(
      await readFile(join(project, "pyproject.toml"), "utf8"),
    ) as { project: { dependencies: string[] } };
    const deps = manifest.project.dependencies;
    const ytVersion = deps
      .find((value) => value.startsWith("yt-dlp["))
      ?.split("==")[1];
    const curlVersion = deps
      .find((value) => value.startsWith("curl-cffi=="))
      ?.split("==")[1];
    if (!ytVersion || !curlVersion)
      throw new AppError(
        "DOWNLOAD_SETUP_FAILED",
        "rikoko 下载依赖清单不完整，请更新 rikoko。",
      );
    // uv checks the complete shipped lock, including transitive dependencies.
    const lockHash = createHash("sha256")
      .update(await readFile(join(project, "uv.lock")))
      .digest("hex");
    const environment = join(project, ".venv");
    const stamp = join(environment, ".rikoko-download-lock");
    const python =
      process.platform === "win32"
        ? join(environment, "Scripts/python.exe")
        : join(environment, "bin/python");
    const check = [
      "-c",
      "import sys; from importlib.metadata import version; from yt_dlp.networking._curlcffi import CurlCFFIRH; assert CurlCFFIRH._SUPPORTED_IMPERSONATE_TARGET_MAP; assert version('yt-dlp') == sys.argv[1] and version('curl-cffi') == sys.argv[2]",
      ytVersion,
      curlVersion,
    ];
    try {
      if ((await readFile(stamp, "utf8")).trim() !== lockHash)
        throw Error("Downloader dependencies changed");
      await run(python, check, { timeoutMs: 15_000 });
    } catch {
      try {
        const proxy = await configuredDownloadProxy();
        await run(
          "uv",
          [
            "sync",
            "--project",
            project,
            "--frozen",
            "--no-dev",
            "--managed-python",
            "--python",
            "3.12",
          ],
          {
            timeoutMs: 300_000,
            env: {
              ...downloadEnvironment(),
              ...(proxy ? { HTTP_PROXY: proxy, HTTPS_PROXY: proxy } : {}),
              UV_PROJECT_ENVIRONMENT: environment,
            },
          },
        );
        await run(python, check, { timeoutMs: 15_000 });
        await mkdir(environment, { recursive: true });
        await writeFile(stamp, lockHash, { mode: 0o600 });
      } catch {
        throw new AppError(
          "DOWNLOAD_SETUP_FAILED",
          "rikoko 自动准备下载环境失败。请检查本地网络后重试；若 uv 缺失，重新运行 rikoko 安装器即可补齐。",
          503,
        );
      }
    }
    return { python, version: ytVersion };
  })();
  preparing.set(root, task);
  try {
    return await task;
  } catch (error) {
    throw error instanceof AppError
      ? error
      : new AppError(
          "DOWNLOAD_SETUP_FAILED",
          "rikoko 下载环境不完整，请重新运行 rikoko 安装器自动修复。",
          503,
        );
  } finally {
    if (preparing.get(root) === task) preparing.delete(root);
  }
}

function abortable<T>(task: Promise<T>, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal?.removeEventListener("abort", abort);
      reject(new AppError("CANCELLED", "下载已取消。"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    task.then(
      (value) => {
        signal?.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal?.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

export function classifyTikTokError(message: string): AppError {
  // Never return raw downloader stderr: it may include signed CDN URLs/cookies.
  if (/No suitable extractor found for URL/i.test(message))
    return new AppError(
      "DOWNLOAD_LINK_UNRESOLVED",
      "分享链接跳转后未指向支持的视频页面，请复制该视频的完整页面链接，或提供本地视频文件。",
    );
  if (/login|log in|private (?:post|account)|permission to view/i.test(message))
    return new AppError(
      "DOWNLOAD_LOGIN_REQUIRED",
      "该 TikTok 视频需要登录或账号访问权限，请提供可访问的视频文件。",
    );
  if (
    /IP address is blocked|403|429|captcha|challenge|Unexpected response/i.test(
      message,
    )
  )
    return new AppError(
      "DOWNLOAD_PLATFORM_BLOCKED",
      "TikTok 拦截了本次请求，请确认本机能访问视频，稍后重试或提供视频文件。",
    );
  if (/Unable to extract|Unsupported URL|extractor/i.test(message))
    return new AppError(
      "DOWNLOAD_EXTRACTOR_FAILED",
      "TikTok 页面解析失败，可能需要更新 rikoko 下载组件；这不代表视频已失效。",
    );
  if (/timed? out|timeout|resolve|connect|proxy|SSL|certificate/i.test(message))
    return new AppError(
      "DOWNLOAD_NETWORK_FAILED",
      "本地下载连接失败，请检查网络及 rikoko 下载代理设置后重试。",
    );
  if (/not available|removed|deleted|404|410/i.test(message))
    return new AppError(
      "DOWNLOAD_UNAVAILABLE",
      "TikTok 返回内容不可用，请在浏览器中确认链接和访问权限。",
    );
  if (/max.filesize|larger than|size limit/i.test(message))
    return new AppError("FILE_TOO_LARGE", "视频超过 100 MiB 下载限制。");
  return new AppError(
    "DOWNLOAD_FAILED",
    "TikTok 下载失败，请重试或提供本地视频文件。",
  );
}

export async function downloadTikTok(
  url: string,
  work: string,
  options: RuntimeOptions & {
    signal?: AbortSignal;
    onPhase?: (phase: DownloadPhase) => Promise<void>;
  } = {},
) {
  let source: string;
  try {
    source = normalizeTikTokUrl(url);
  } catch {
    throw new AppError(
      "UNSUPPORTED_VIDEO_URL",
      "请提供一个 TikTok 短视频或分享链接，主页、直播和图集暂不支持。",
    );
  }
  if (options.signal?.aborted) throw new AppError("CANCELLED", "下载已取消。");
  await options.onPhase?.("preparing_download");
  // Preparation is shared. Cancelling one job must not corrupt another caller's environment.
  const runtime = await abortable(ensureTikTokRuntime(options), options.signal);
  if (options.signal?.aborted) throw new AppError("CANCELLED", "下载已取消。");
  const run = options.run ?? runDownloadCommand;
  try {
    await Promise.all(
      ["ffmpeg", "ffprobe"].map((file) =>
        run(file, ["-version"], { signal: options.signal, timeoutMs: 15_000 }),
      ),
    );
  } catch (error) {
    if (options.signal?.aborted)
      throw new AppError("CANCELLED", "下载已取消。");
    throw new AppError(
      "DOWNLOAD_SETUP_FAILED",
      "rikoko 媒体工具缺失，请重新运行 rikoko 安装器自动补齐 FFmpeg。",
      503,
    );
  }
  const proxy = await openDownloadProxy(options.signal);
  const guard = async () => {
    let total = 0;
    for (const name of await readdir(work)) {
      const info = await lstat(join(work, name));
      if (!info.isFile() || info.isSymbolicLink())
        throw new AppError("INVALID_MEDIA", "下载器输出无效。");
      total += info.size;
    }
    if (total > MAX_BYTES * 3)
      throw new AppError("FILE_TOO_LARGE", "下载临时文件超过限制。");
  };
  try {
    await options.onPhase?.("downloading");
    const result = await run(
      runtime.python,
      [
        "-m",
        "yt_dlp",
        "--ignore-config",
        "--no-update",
        "--no-plugin-dirs",
        "--no-remote-components",
        "--no-playlist",
        "--use-extractors",
        "^TikTok$,^vm[.]tiktok$",
        "--no-progress",
        "--socket-timeout",
        "30",
        "--retries",
        "2",
        "--extractor-retries",
        "1",
        "--max-filesize",
        String(MAX_BYTES),
        "--format",
        "bv*+ba/b",
        "--format-sort",
        "res:1080,vcodec:h264",
        "--merge-output-format",
        "mp4",
        "--proxy",
        proxy.url,
        "--output",
        join(work, "source.%(ext)s"),
        "--print",
        'after_move:{"path":%(filepath)j,"id":%(id)j}',
        "--",
        source,
      ],
      { signal: options.signal, timeoutMs: 180_000, guard, cwd: work },
    );
    await guard();
    const output = JSON.parse(result.trim().split(/\r?\n/).at(-1) ?? "{}");
    if (
      typeof output.path !== "string" ||
      typeof output.id !== "string" ||
      !/^\d+$/.test(output.id)
    )
      throw new AppError("INVALID_MEDIA", "下载器未返回有效视频文件。");
    const path = await realpath(output.path);
    const local = relative(await realpath(work), path);
    if (!local || local.startsWith("..") || isAbsolute(local))
      throw new AppError("INVALID_MEDIA", "下载结果超出素材目录。");
    const info = await lstat(path);
    if (!info.isFile() || !info.size)
      throw new AppError("INVALID_MEDIA", "下载器未写入有效的视频文件。");
    if (info.size > MAX_BYTES)
      throw new AppError("FILE_TOO_LARGE", "视频超过 100 MiB 限制。");
    await chmod(path, 0o600);
    await options.onPhase?.("probing_download");
    return {
      path,
      videoId: output.id as string,
      downloaderVersion: runtime.version,
    };
  } catch (error) {
    if (options.signal?.aborted)
      throw new AppError("CANCELLED", "下载已取消。");
    if (proxy.failure()) throw proxy.failure();
    throw error instanceof AppError
      ? error
      : classifyTikTokError(error instanceof Error ? error.message : "");
  } finally {
    await proxy.close();
  }
}
