import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
const key = (await readFile(".data/local-admin.key", "utf8")).trim();
const projectId = JSON.parse(
  await readFile("artifacts/ui-replica/h3-fixture.json", "utf8"),
).projectId;
const res = await fetch("http://127.0.0.1:4310/api/tools/workspace_snapshot", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ projectId }),
});
const { result } = await res.json();
const job = result.jobs.find(
  (j: any) => j.revisionId === result.headRevisionId,
);
if (job?.status !== "completed") throw Error(`Latest render is ${job?.status}`);
const video = await fetch(
  `http://127.0.0.1:4310/api/assets/${job.outputs[0]}/file`,
  { headers: { Authorization: `Bearer ${key}` } },
);
await writeFile(
  "artifacts/ui-replica/edited-h3.mp4",
  Buffer.from(await video.arrayBuffer()),
);
const probe = JSON.parse(
  execFileSync(
    "ffprobe",
    [
      "-v",
      "quiet",
      "-show_streams",
      "-show_format",
      "-of",
      "json",
      "artifacts/ui-replica/edited-h3.mp4",
    ],
    { encoding: "utf8" },
  ),
);
const expected =
  result.revision.composition.scenes.reduce(
    (n: number, s: any) => n + s.durationMs,
    0,
  ) / 1000;
if (Math.abs(Number(probe.format.duration) - expected) > 0.1)
  throw Error("Output duration mismatch");
await writeFile(
  "artifacts/ui-replica/verification.json",
  JSON.stringify(
    {
      projectId,
      revisionId: result.headRevisionId,
      version: result.revision.version,
      jobId: job.id,
      status: job.status,
      expectedDuration: expected,
      actualDuration: Number(probe.format.duration),
      scenes: result.revision.composition.scenes.map((s: any) => ({
        id: s.id,
        durationMs: s.durationMs,
        sourceStartMs: s.sourceStartMs,
        fit: s.fit,
        text: s.text,
      })),
      streams: probe.streams.map((s: any) => ({
        codec: s.codec_name,
        width: s.width,
        height: s.height,
        channels: s.channels,
      })),
      evidence:
        "real-local-render-from-official-fal-h3-sample; no new paid generation",
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    version: result.revision.version,
    scenes: result.revision.composition.scenes.length,
    expectedDuration: expected,
    actualDuration: probe.format.duration,
    streams: probe.streams.length,
  }),
);
