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
  guideEntry,
  guideCatalog,
  guideCatalogSnapshot,
  guideFiles,
  selectKnowledge,
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
    files: Record<string, string>;
    catalogHash: string;
  };
  if (
    manifest.guideProtocol !== guideProtocol ||
    Object.keys(manifest.topics).sort().join() !==
      [...guideTopics].sort().join() ||
    JSON.stringify(manifest.files) !== JSON.stringify(guideFiles()) ||
    manifest.catalogHash !== sha256(JSON.stringify(guideCatalogSnapshot())) ||
    manifest.guideVersion !== guideVersionHash(manifest)
  )
    throw Error("Invalid guide manifest");
  return manifest;
}
export const guideVersionHash = (manifest: {
  topics: Record<string, string>;
  files: Record<string, string>;
  catalogHash: string;
}) =>
  sha256(
    JSON.stringify({
      topics: manifest.topics,
      files: manifest.files,
      catalogHash: manifest.catalogHash,
    }),
  );
export async function readGuide(raw: unknown) {
  const { topic, selection } = guideSchema.parse(raw);
  try {
    const manifest = await guideManifest();
    const markdown = await readFile(
      join(guidanceRoot, "content", manifest.files[topic]),
      "utf8",
    );
    const hash = sha256(markdown);
    if (!markdown.trim() || hash !== manifest.topics[topic])
      throw Error("Guide content mismatch");
    const { version } = JSON.parse(
      await readFile(new URL("../../../package.json", import.meta.url), "utf8"),
    );
    const entry = guideEntry(topic);
    const navigation =
      entry.kind === "index"
        ? guideCatalog.filter(
            (g) => topic === "knowledge" || g.layer === entry.layer,
          )
        : guideCatalog.filter((g) => entry.related.includes(g.topic));
    const readingPath = selection ? selectKnowledge(selection) : undefined;
    const navigationMarkdown = [
      `Knowledge layer: ${entry.layer}. Canonical topic: ${entry.topic}. Evidence: ${entry.evidence.status}.`,
      ...(navigation.length
        ? [
            "Related knowledge:",
            ...navigation.map(
              (g) =>
                `- ${g.topic}: ${g.title} (${g.layer}; ${g.evidence.status})`,
            ),
          ]
        : []),
      ...(readingPath
        ? [
            "Selected reading path:",
            ...[
              ...readingPath.formats,
              ...readingPath.craft,
              ...readingPath.models,
            ].map((g) => `- ${g.topic}: ${g.title}`),
            `Model coverage: ${readingPath.modelCoverage}. ${readingPath.instruction}`,
          ]
        : []),
    ].join("\n");
    return {
      topic,
      canonicalTopic: entry.topic,
      layer: entry.layer,
      evidence: entry.evidence,
      relatedTopics: entry.related,
      library:
        topic === "knowledge"
          ? guideCatalogSnapshot()
          : {
              layers: guideCatalogSnapshot().layers,
              entries: entry.kind === "index" ? navigation : [entry],
            },
      navigationMarkdown,
      ...(readingPath ? { readingPath } : {}),
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
    library: guideCatalogSnapshot(),
  };
}
/** Used by packaging and export; catches missing content and broken topic references. */
export async function validateGuideBundle(root = guidanceRoot) {
  const manifest = await guideManifest(root);
  if (new Set(guideCatalog.map((g) => g.path)).size !== guideCatalog.length)
    throw Error("Duplicate canonical guide path");
  for (const entry of guideCatalog) {
    if (
      !/^(?:[a-z0-9-]+\/)*[a-z0-9-]+\.md$/.test(entry.path) ||
      entry.related.some(
        (topic) => !guideCatalog.some((g) => g.topic === topic),
      )
    )
      throw Error(`Invalid catalog path or relation: ${entry.topic}`);
    if (
      entry.scope &&
      (entry.layer !== "models" || !entry.scope.modelIds.length)
    )
      throw Error(`Invalid model scope: ${entry.topic}`);
    if (
      ["official_documentation", "external_example", "rikoko_tested"].includes(
        entry.evidence.status,
      ) &&
      !entry.evidence.sources.length
    )
      throw Error(`Missing knowledge evidence: ${entry.topic}`);
    for (const source of entry.evidence.sources)
      if (!source.title.trim() || !/^https?:\/\//.test(source.url))
        throw Error(`Invalid knowledge source: ${entry.topic}`);
  }
  for (const topic of guideTopics) {
    const markdown = await readFile(
      join(root, "content", manifest.files[topic]),
      "utf8",
    );
    if (!markdown.trim() || sha256(markdown) !== manifest.topics[topic])
      throw Error(`Guide mismatch: ${topic}`);
    for (const match of markdown.matchAll(/topic:\s*"([a-z0-9/-]+)"/g)) {
      if (!(guideTopics as readonly string[]).includes(match[1]))
        throw Error(`Unknown guide reference: ${match[1]}`);
    }
  }
  return manifest;
}
