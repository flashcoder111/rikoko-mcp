import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AppError } from "../../contracts/src/index.js";
import type { ToolName } from "./tools.js";
import { readPrivateText } from "../../bootstrap/src/config.ts";

export type HostClient = "codex" | "hermes" | "claude" | "generic";
export function backendUrl(value = "http://127.0.0.1:4310") {
  const url = new URL(value);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error("Use an HTTPS service origin, or HTTP on loopback only.");
  return url.origin;
}

export async function hostCredential(env: NodeJS.ProcessEnv = process.env) {
  if (env.VIDEOWORKBENCH_CREDENTIAL_FILE) {
    const key = (
      await readPrivateText(env.VIDEOWORKBENCH_CREDENTIAL_FILE)
    ).trim();
    if (!key) throw Error("Private credential file is empty");
    return key;
  }
  if (env.VIDEOWORKBENCH_API_KEY?.trim())
    return env.VIDEOWORKBENCH_API_KEY.trim();
  if (env.VIDEOWORKBENCH_KEYCHAIN_SERVICE && process.platform === "darwin") {
    try {
      const { stdout } = await promisify(execFile)("/usr/bin/security", [
        "find-generic-password",
        "-s",
        env.VIDEOWORKBENCH_KEYCHAIN_SERVICE,
        "-a",
        "hypit-mcp",
        "-w",
      ]);
      if (stdout.trim()) return stdout.trim();
    } catch {
      /* Never include keychain stdout/stderr in protocol errors. */
    }
  }
  throw new Error(
    "Hypit credential unavailable. Run the client installer, or set VIDEOWORKBENCH_API_KEY in the host's secret environment.",
  );
}

export class HostConnection {
  readonly base: string;
  constructor(
    base: string,
    private readonly credential: string,
  ) {
    this.base = backendUrl(base);
  }
  async request(path: string, init: RequestInit = {}) {
    if (!path.startsWith("/api/") || path.startsWith("//"))
      throw new Error("Invalid backend API path");
    const response = await fetch(`${this.base}${path}`, {
      ...init,
      headers: {
        ...Object.fromEntries(new Headers(init.headers)),
        Authorization: `Bearer ${this.credential}`,
      },
      signal: AbortSignal.timeout(60_000),
      redirect: "error",
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as {
        error?: { code?: string; message?: string };
      };
      throw new AppError(
        body.error?.code ?? "BACKEND_ERROR",
        body.error?.message ?? `Backend returned ${response.status}`,
        response.status,
      );
    }
    return response;
  }
  async invoke(name: ToolName, input: unknown): Promise<unknown> {
    const response = await this.request(`/api/tools/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    return ((await response.json()) as { result: unknown }).result;
  }
}
