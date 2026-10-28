import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  guideTopics,
  guideProtocol,
  guideFiles,
  guideCatalogSnapshot,
} from "../packages/guidance/src/catalog.js";
import {
  guidanceRoot,
  sha256,
  validateGuideBundle,
  guideVersionHash,
} from "../packages/guidance/src/reader.js";
if (process.argv.includes("--write")) {
  const topics: Record<string, string> = {};
  const files = guideFiles();
  for (const topic of [...guideTopics].sort())
    topics[topic] = sha256(
      await readFile(join(guidanceRoot, "content", files[topic])),
    );
  const manifest = {
    guideProtocol,
    topics,
    files,
    catalogHash: sha256(JSON.stringify(guideCatalogSnapshot())),
  };
  await writeFile(
    join(guidanceRoot, "manifest.json"),
    JSON.stringify(
      { ...manifest, guideVersion: guideVersionHash(manifest) },
      null,
      2,
    ) + "\n",
  );
}
const manifest = await validateGuideBundle();
console.log(
  JSON.stringify({
    valid: true,
    guideVersion: manifest.guideVersion,
    topics: Object.keys(manifest.topics).length,
  }),
);
