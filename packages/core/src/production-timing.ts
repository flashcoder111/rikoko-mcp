import { AppError } from "../../contracts/src/index.js";
export function resolveTiming(
  assetDurationMs: number,
  input: {
    policy?: "full_asset" | "selected_range" | "fit_target";
    sourceStartMs?: number;
    durationMs?: number;
  },
) {
  const policy =
    input.policy ??
    (input.durationMs !== undefined || input.sourceStartMs
      ? "selected_range"
      : "full_asset");
  const sourceStartMs = input.sourceStartMs ?? 0;
  const remaining = assetDurationMs - sourceStartMs;
  const durationMs =
    policy === "full_asset" ? remaining : (input.durationMs ?? remaining);
  const speed = policy === "fit_target" ? remaining / durationMs : 1;
  if (
    !Number.isSafeInteger(assetDurationMs) ||
    !Number.isSafeInteger(sourceStartMs) ||
    sourceStartMs < 0 ||
    !Number.isSafeInteger(durationMs) ||
    durationMs < 100 ||
    speed < 0.25 ||
    speed > 4 ||
    sourceStartMs + durationMs * speed > assetDurationMs + 0.01 ||
    (policy === "full_asset" &&
      (sourceStartMs !== 0 || input.durationMs !== undefined))
  )
    throw new AppError(
      "INVALID_INTERVAL",
      "Choose a valid source range or a whole-clip speed between 0.25 and 4; full_asset cannot trim",
    );
  return {
    policy,
    sourceStartMs,
    durationMs,
    speed,
    discardedTailMs: Math.max(0, Math.round(remaining - durationMs * speed)),
  };
}
