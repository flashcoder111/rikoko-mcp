import {
  guideResultSchema,
  guideCapabilitiesSchema,
} from "../../contracts/src/guidance.js";
import { createHash } from "node:crypto";
import { guideProtocol, guideTopics } from "./catalog.js";
type Call = (name: string, args: Record<string, unknown>) => Promise<unknown>;
/** Verify backend content, advertised tools and bridge contract support, not version equality. */
export async function checkDirectorGuides(
  toolNames: string[],
  capabilities: unknown,
  call: Call,
) {
  const candidate =
    capabilities &&
    typeof capabilities === "object" &&
    "directorGuides" in capabilities
      ? capabilities.directorGuides
      : undefined;
  const parsed = guideCapabilitiesSchema.safeParse(candidate);
  const advertised = parsed.success ? parsed.data : undefined;
  if (
    !toolNames.includes("rikoko_guide") ||
    advertised?.protocol !== guideProtocol ||
    !advertised?.topics
  )
    throw Error(
      "Director guides unavailable or incompatible; upgrade the backend and bridge, then reconnect",
    );
  if (!guideTopics.every((t) => Object.hasOwn(advertised.topics, t)))
    throw Error("Backend guide topics are incomplete");
  let runtimeVersion: string | undefined;
  for (const topic of Object.keys(advertised.topics)) {
    // A new topic requires a bridge with a schema that can request it.
    if (!(guideTopics as readonly string[]).includes(topic))
      throw Error("Backend has new guide topics; upgrade the MCP bridge");
    const result = guideResultSchema.safeParse(
      await call("rikoko_guide", { topic }),
    );
    if (!result.success) throw Error(`Guide verification failed: ${topic}`);
    const value = result.data;
    const digest =
      typeof value?.markdown === "string"
        ? createHash("sha256").update(value.markdown).digest("hex")
        : null;
    if (
      !digest ||
      value.topic !== topic ||
      [...value.availableTopics].sort().join() !==
        Object.keys(advertised.topics).sort().join() ||
      !value.markdown.trim() ||
      value.guideProtocol !== guideProtocol ||
      value.guideVersion !== advertised.version ||
      value.sha256 !== digest ||
      advertised.topics[topic] !== digest ||
      value.source !== "backend" ||
      !value.runtimeVersion
    )
      throw Error(`Guide verification failed: ${topic}`);
    if (
      !Array.isArray(value.requiredContracts) ||
      value.requiredContracts.some((p: string) => p !== guideProtocol) ||
      !Array.isArray(value.requiredTools) ||
      value.requiredTools.some((t: string) => !toolNames.includes(t))
    )
      throw Error(`Guide requires unsupported contracts/tools: ${topic}`);
    if (runtimeVersion && runtimeVersion !== value.runtimeVersion)
      throw Error(
        "Backend changed during guide verification; run doctor again",
      );
    runtimeVersion = value.runtimeVersion;
  }
  return {
    available: true,
    protocol: guideProtocol,
    version: advertised.version,
    runtimeVersion,
    topics: Object.keys(advertised.topics).length,
    source: "backend",
    skillRequired: false,
  };
}
