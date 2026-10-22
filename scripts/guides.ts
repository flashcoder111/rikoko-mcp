import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  guideTopics,
  guideProtocol,
} from "../packages/guidance/src/catalog.js";
import {
  guidanceRoot,
  sha256,
  validateGuideBundle,
} from "../packages/guidance/src/reader.js";
if (process.argv.includes("--write")) {
  const topics: Record<string, string> = {};
  for (const topic of [...guideTopics].sort())
    topics[topic] = sha256(
      await readFile(join(guidanceRoot, "content", `${topic}.md`)),
    );
  await writeFile(
    join(guidanceRoot, "manifest.json"),
    JSON.stringify(
      { guideProtocol, guideVersion: sha256(JSON.stringify(topics)), topics },
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
