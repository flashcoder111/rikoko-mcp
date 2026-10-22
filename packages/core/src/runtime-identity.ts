import { readFileSync } from "node:fs";

// Captured at process startup so changing files cannot disguise a stale process.
export const runtimeVersion: string = JSON.parse(
  readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
).version;
export const runtimeGuideVersion: string = JSON.parse(
  readFileSync(
    new URL("../../guidance/manifest.json", import.meta.url),
    "utf8",
  ),
).guideVersion;
