import { readFileSync } from "node:fs";
import { AppError } from "../../contracts/src/index.js";
import { readGuide, sha256 } from "./reader.js";
import {
  guideEntry,
  selectKnowledge,
  type GuideTopic,
  type KnowledgeSelection,
} from "./catalog.js";

function excerpt(markdown: string, key: string) {
  const start = `<!-- director:${key} -->`;
  const content = markdown
    .split(start)[1]
    ?.split("<!-- /director -->")[0]
    ?.trim();
  if (!content)
    throw new AppError(
      "GUIDE_UNAVAILABLE",
      `Missing director guidance: ${key}`,
      503,
    );
  return content;
}

// Initialization, natural language entry and MCP prompts share the published text.
const overview = readFileSync(
  new URL(`../content/${guideEntry("overview").path}`, import.meta.url),
  "utf8",
);
const manifest = JSON.parse(
  readFileSync(new URL("../manifest.json", import.meta.url), "utf8"),
);
if (sha256(overview) !== manifest.topics.overview)
  throw new Error("Director entry does not match the guide bundle");
export const directorResponsibility = excerpt(overview, "responsibility");

export type DirectorExcerpt =
  | "intent"
  | "reference"
  | "performance"
  | "method"
  | "preparation"
  | "image"
  | "sound_text"
  | "quality"
  | "review";
const topics: Record<DirectorExcerpt, GuideTopic> = {
  intent: "overview",
  reference: "video-direction",
  performance: "video-direction",
  method: "production-method",
  preparation: "video-direction",
  image: "image-direction",
  sound_text: "media-operations",
  quality: "production-quality",
  review: "visual-review",
};

/** Excerpts are verified against the same manifest as full guides, never a second library. */
export async function directorKnowledge(
  keys: DirectorExcerpt[],
  selection: KnowledgeSelection = {},
) {
  const guides = await Promise.all(
    [...new Set(keys.map((k) => topics[k]).concat("overview"))].map((topic) =>
      readGuide({ topic }),
    ),
  );
  const current = guides[0];
  if (guides.some((g) => g.guideVersion !== current.guideVersion))
    throw new AppError(
      "GUIDE_UNAVAILABLE",
      "Guide bundle changed during reading; retry on a consistent backend",
      503,
    );
  return {
    guideProtocol: current.guideProtocol,
    guideVersion: current.guideVersion,
    runtimeVersion: current.runtimeVersion,
    readingPath: selectKnowledge(
      selection,
      keys.map((key) => guideEntry(topics[key]).topic),
    ),
    responsibility: excerpt(
      guides.find((g) => g.topic === "overview")!.markdown,
      "responsibility",
    ),
    content: keys.map((key) => {
      const guide = guides.find((g) => g.topic === topics[key])!;
      return {
        key,
        topic: guide.topic,
        canonicalTopic: guide.canonicalTopic,
        layer: guide.layer,
        sha256: guide.sha256,
        text: excerpt(guide.markdown, key),
      };
    }),
  };
}
