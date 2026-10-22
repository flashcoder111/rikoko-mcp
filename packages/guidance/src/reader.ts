import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { AppError } from "../../contracts/src/index.js";
import {
  guideProtocol,
  guideSchema,
  guideTopics,
  guideRequirements,
} from "./catalog.js";
export const guidanceRoot = fileURLToPath(new URL("../", import.meta.url));
export const sha256 = (s: string | Buffer) =>
  createHash("sha256").update(s).digest("hex");
export async function guideManifest(root = guidanceRoot) {
  const manifest = JSON.parse(
    await readFile(join(root, "manifest.json"), "utf8"),
  ) as {
    guideProtocol: string;
    guideVersion: string;
    topics: Record<string, string>;
  };
  if (
    manifest.guideProtocol !== guideProtocol ||
    Object.keys(manifest.topics).sort().join() !==
      [...guideTopics].sort().join() ||
    manifest.guideVersion !== sha256(JSON.stringify(manifest.topics))
  )
    throw Error("Invalid guide manifest");
  return manifest;
}
export async function readGuide(raw: unknown) {
  const { topic } = guideSchema.parse(raw);
  try {
    const manifest = await guideManifest();
    const markdown = await readFile(
      join(guidanceRoot, "content", `${topic}.md`),
      "utf8",
    );
    const hash = sha256(markdown);
    if (!markdown.trim() || hash !== manifest.topics[topic])
      throw Error("Guide content mismatch");
    const { version } = JSON.parse(
      await readFile(new URL("../../../package.json", import.meta.url), "utf8"),
    );
    return {
      topic,
      markdown,
      sha256: hash,
      availableTopics: guideTopics,
      configuredHost: "generic",
      guideProtocol,
      guideVersion: manifest.guideVersion,
      runtimeVersion: version as string,
      source: "backend" as const,
      requiredContracts: [guideProtocol],
      requiredTools: guideRequirements(topic),
    };
  } catch {
    throw new AppError(
      "GUIDE_UNAVAILABLE",
      "Backend director guides are missing or inconsistent. Repair/update the backend runtime and reconnect; do not bypass production contracts.",
      503,
    );
  }
}
export async function guideCapabilities() {
  const manifest = await guideManifest();
  return {
    protocol: guideProtocol,
    version: manifest.guideVersion,
    topics: manifest.topics,
    source: "backend",
    skillRequired: false,
  };
}
/** Used by packaging and export; catches missing content and broken topic references. */
export async function validateGuideBundle(root = guidanceRoot) {
  const manifest = await guideManifest(root);
  for (const topic of guideTopics) {
    const markdown = await readFile(
      join(root, "content", `${topic}.md`),
      "utf8",
    );
    if (!markdown.trim() || sha256(markdown) !== manifest.topics[topic])
      throw Error(`Guide mismatch: ${topic}`);
    for (const match of markdown.matchAll(/topic:\s*"([a-z0-9-]+)"/g)) {
      if (!(guideTopics as readonly string[]).includes(match[1]))
        throw Error(`Unknown guide reference: ${match[1]}`);
    }
  }
  return manifest;
}
