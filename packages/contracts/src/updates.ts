/** Public release metadata contains data only; never accept executable commands. */
export const UPDATE_MANIFEST_URL = "https://rikoko.ai/releases/latest.json";
export const UPDATE_COMMAND = "curl -fsSL https://rikoko.ai/install.sh | bash";
export const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;

export type UpdateStatus = {
  status:
    "not_checked" | "up_to_date" | "ahead" | "update_available" | "unavailable";
  currentVersion: string;
  latestVersion?: string;
  publishedAt?: string;
  releaseNotes?: string;
  checkedAt: string | null;
  nextCheckAt: string | null;
  manifestUrl: typeof UPDATE_MANIFEST_URL;
  upgradeCommand: typeof UPDATE_COMMAND;
  errorCode?:
    "network" | "timeout" | "http" | "invalid_manifest" | "invalid_version";
};
