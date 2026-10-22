import { z } from "zod";
import {
  UPDATE_COMMAND,
  UPDATE_INTERVAL_MS,
  UPDATE_MANIFEST_URL,
  type UpdateStatus,
} from "../../contracts/src/updates.js";
import { runtimeVersion } from "./runtime-identity.js";

const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const manifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    version: z
      .string()
      .max(64)
      .regex(stableVersion)
      .refine((value) =>
        value.split(".").every((part) => Number.isSafeInteger(Number(part))),
      ),
    publishedAt: z.iso.datetime({ offset: true }),
    releaseNotes: z.string().max(4000),
  })
  .strict();
const MAX_BYTES = 32 * 1024;
const FAILURE_RETRY_MS = 5 * 60 * 1000;
const MANUAL_COOLDOWN_MS = 60 * 1000;
const TIMEOUT_MS = 4000;

function compare(current: string, latest: string): number {
  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.exec(
      current,
    );
  if (!match) throw Error("invalid_version");
  const parts = match.slice(1, 4).map(Number);
  if (!parts.every(Number.isSafeInteger)) throw Error("invalid_version");
  const target = latest.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (parts[i] !== target[i]) return Math.sign(target[i] - parts[i]);
  }
  return match[4] ? 1 : 0;
}

/** Per-process cache shared by MCP and Studio. No credentials or user data leave the machine. */
export function createUpdateChecker(options: {
  currentVersion: string;
  fetch?: typeof fetch;
  now?: () => number;
}) {
  const now = options.now ?? Date.now;
  let state: UpdateStatus = {
    status: "not_checked",
    currentVersion: options.currentVersion,
    checkedAt: null,
    nextCheckAt: null,
    manifestUrl: UPDATE_MANIFEST_URL,
    upgradeCommand: UPDATE_COMMAND,
  };
  let pending: Promise<UpdateStatus> | undefined;
  let lastAttempt = -Infinity;
  let expiresAt = 0;

  async function request(): Promise<UpdateStatus> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let errorCode: UpdateStatus["errorCode"] = "network";
    const base = {
      currentVersion: options.currentVersion,
      manifestUrl: UPDATE_MANIFEST_URL,
      upgradeCommand: UPDATE_COMMAND,
    } as const;
    try {
      const response = await (options.fetch ?? globalThis.fetch)(
        UPDATE_MANIFEST_URL,
        {
          method: "GET",
          headers: { Accept: "application/json" },
          redirect: "error",
          credentials: "omit",
          signal: controller.signal,
        },
      );
      errorCode = "http";
      if (!response.ok) {
        await response.body?.cancel();
        throw Error("http");
      }
      errorCode = "invalid_manifest";
      if (
        !response.headers
          .get("content-type")
          ?.toLowerCase()
          .includes("application/json") ||
        Number(response.headers.get("content-length") ?? 0) > MAX_BYTES
      ) {
        await response.body?.cancel();
        throw Error("invalid_manifest");
      }
      const reader = response.body?.getReader();
      if (!reader) throw Error("invalid_manifest");
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_BYTES) throw Error("invalid_manifest");
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
        reader.releaseLock();
      }
      const manifest = manifestSchema.parse(
        JSON.parse(Buffer.concat(chunks).toString("utf8")),
      );
      errorCode = "invalid_version";
      const order = compare(options.currentVersion, manifest.version);
      const checked = now();
      expiresAt = checked + UPDATE_INTERVAL_MS;
      state = {
        ...base,
        status:
          order > 0 ? "update_available" : order < 0 ? "ahead" : "up_to_date",
        latestVersion: manifest.version,
        publishedAt: manifest.publishedAt,
        releaseNotes: manifest.releaseNotes,
        checkedAt: new Date(checked).toISOString(),
        nextCheckAt: new Date(expiresAt).toISOString(),
      };
    } catch {
      const checked = now();
      expiresAt = checked + FAILURE_RETRY_MS;
      state = {
        ...base,
        status: "unavailable",
        checkedAt: new Date(checked).toISOString(),
        nextCheckAt: new Date(expiresAt).toISOString(),
        errorCode: controller.signal.aborted ? "timeout" : errorCode,
      };
    } finally {
      clearTimeout(timeout);
    }
    return { ...state };
  }

  return {
    snapshot: (): UpdateStatus => ({ ...state }),
    check(force = false): Promise<UpdateStatus> {
      if (pending) return pending;
      const time = now();
      if (
        time < expiresAt &&
        (!force || time - lastAttempt < MANUAL_COOLDOWN_MS)
      )
        return Promise.resolve({ ...state });
      lastAttempt = time;
      pending = request().finally(() => {
        pending = undefined;
      });
      return pending;
    },
  };
}

export const updateChecker = createUpdateChecker({
  currentVersion: runtimeVersion,
});
