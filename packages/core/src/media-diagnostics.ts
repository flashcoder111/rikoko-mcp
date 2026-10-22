import { AppError } from "../../contracts/src/index.js";

export type MediaStage =
  | "temp_directory"
  | "source_read"
  | "source_write"
  | "probe_video"
  | "extract_frame"
  | "read_frame"
  | "register_frame"
  | "gray_frame"
  | "save_evidence"
  | "build_grid"
  | "read_grid"
  | "cleanup";

export function mediaFailure(error: unknown, stage: MediaStage): AppError {
  if (error instanceof AppError) return error;
  const e = error as {
    code?: unknown;
    signal?: unknown;
    killed?: boolean;
    name?: string;
    stderr?: unknown;
  } | null;
  const processStage = [
    "probe_video",
    "extract_frame",
    "gray_frame",
    "build_grid",
  ].includes(stage);
  const systemCode =
    typeof e?.code === "string" && /^[A-Z][A-Z0-9_]{1,40}$/.test(e.code)
      ? e.code
      : undefined;
  const stderr =
    typeof e?.stderr === "string"
      ? e.stderr
      : Buffer.isBuffer(e?.stderr)
        ? e.stderr.toString()
        : "";
  let code = "MEDIA_FAILED",
    reason = "operation_failed";
  if (processStage && systemCode === "ENOENT") {
    code = "MEDIA_DEPENDENCY_MISSING";
    reason = stage === "probe_video" ? "ffprobe_not_found" : "ffmpeg_not_found";
  } else if (systemCode === "EACCES" || systemCode === "EPERM") {
    code = "MEDIA_PERMISSION_DENIED";
    reason = "permission_denied";
  } else if (
    processStage &&
    (e?.name === "AbortError" || e?.killed || systemCode === "ETIMEDOUT")
  ) {
    code = "MEDIA_TIMEOUT";
    reason = "execution_budget_exceeded";
  } else if (stage === "source_read" && systemCode === "ENOENT") {
    code = "MEDIA_SOURCE_MISSING";
    reason = "source_not_found";
  } else if (
    ["read_frame", "read_grid"].includes(stage) &&
    systemCode === "ENOENT"
  ) {
    code = "MEDIA_OUTPUT_MISSING";
    reason = "no_frame_at_requested_position";
  } else if (systemCode === "ENOSPC") {
    code = "MEDIA_STORAGE_FULL";
    reason = "storage_full";
  } else if (processStage) {
    code = "MEDIA_PROCESS_FAILED";
    // Classify known diagnostics rather than returning stderr, which can contain
    // paths, URLs, credentials and attacker-controlled media metadata.
    reason =
      /Invalid data found|moov atom not found|Error while decoding/i.test(
        stderr,
      )
        ? "invalid_or_undecodable_media"
        : /Unknown decoder|Decoder .*not found|Decoding requested.*no decoder/i.test(
              stderr,
            )
          ? "decoder_unavailable"
          : /No such filter|Unknown encoder|Encoder .*not found/i.test(stderr)
            ? "ffmpeg_feature_unavailable"
            : /matches no streams|does not contain any stream/i.test(stderr)
              ? "no_video_stream"
              : "ffmpeg_failed";
  }
  const failure = new AppError(
    code,
    `Media inspection failed at ${stage}: ${reason}.`,
    500,
    {
      stage,
      reason,
      systemCode,
      exitCode: typeof e?.code === "number" ? e.code : undefined,
      signal:
        typeof e?.signal === "string" && /^SIG[A-Z0-9]+$/.test(e.signal)
          ? e.signal
          : undefined,
    },
  );
  return failure;
}
