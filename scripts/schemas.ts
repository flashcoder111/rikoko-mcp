import { z } from "zod";
import { mkdir, writeFile } from "node:fs/promises";
import {
  compositionSchema,
  operationSchema,
  transcriptSchema,
  referenceReportSchema,
} from "../packages/contracts/src/index.js";
await mkdir("packages/contracts/schemas", { recursive: true });
for (const [name, schema] of Object.entries({
  composition: compositionSchema,
  operation: operationSchema,
  transcript: transcriptSchema,
}))
  await writeFile(
    `packages/contracts/schemas/${name}.v1.json`,
    JSON.stringify(
      z.toJSONSchema(schema, { unrepresentable: "any" }),
      null,
      2,
    ) + "\n",
  );

await writeFile(
  "packages/contracts/schemas/reference-analysis.v2.json",
  JSON.stringify(
    z.toJSONSchema(referenceReportSchema, { unrepresentable: "any" }),
    null,
    2,
  ) + "\n",
);
