import { expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "../packages/db/src/index.js";
import { Service } from "../packages/core/src/index.js";
import { LocalStorage } from "../packages/storage/src/index.js";
import { connectCloud } from "../packages/cloud-client/src/index.js";
import { callTool } from "../packages/mcp/src/tools.js";

it("quotes official TTS and imports a source-bound transcript, rejecting changed source", async () => {
  const dir = await mkdtemp(join(tmpdir(), "speech-")),
    db = await Database.open();
  try {
    const s = new Service(db, new LocalStorage(dir));
    const c = await s.authenticate((await s.createAccount("test", 0)).key);
    const source = await s.registerAsset(c.accountId, Buffer.from("audio"), {
      name: "voice",
      kind: "audio",
      mime: "audio/mpeg",
      metadata: { durationMs: 2000, hasAudio: true },
      provenance: {},
    });
    let remote: any,
      valid = false;
    const transcript = {
      schemaVersion: 1,
      language: "zh",
      durationMs: 2000,
      words: [{ id: "w0", text: "你好", startMs: 0, endMs: 1000 }],
      evidence: "provider-live",
    };
    connectCloud(s, "https://official.example", "test", async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path === "/v1/reference-uploads") return Response.json({ id: "u" });
      if (path === "/v1/reference-uploads/u")
        return Response.json({
          id: "remote-a",
          sha256: source.sha256,
          bytes: source.bytes,
        });
      if (path === "/v1/quotes") {
        remote = JSON.parse(String(init?.body)).input;
        return Response.json({ id: "q", priceVersion: "testing:v1" });
      }
      if (path === "/v1/generations")
        return Response.json({ id: "j", status: "queued" });
      if (path.endsWith("/result"))
        return Response.json({
          transcript,
          source: {
            assetId: "remote-a",
            sha256: valid ? source.sha256 : "wrong",
            durationMs: 2000,
          },
        });
      return Response.json({
        id: "j",
        status: "completed",
        result: {
          kind: "transcript",
          downloadPath: "/v1/generations/j/result",
        },
      });
    });
    await callTool(s, c, "quote_create", {
      input: {
        kind: "tts",
        engine: "fal",
        model: "voice",
        language: "zh",
        text: "你好",
      },
    });
    expect(remote.kind).toBe("tts");
    const input = {
      kind: "transcribe",
      engine: "fal",
      model: "scribe",
      language: "zh",
      assetId: source.id,
    };
    const q = await callTool(s, c, "quote_create", { input });
    expect(remote.assetId).toBe("remote-a");
    const j = await callTool(s, c, "job_submit", {
      input,
      quoteId: q.id,
      idempotencyKey: "speech",
    });
    await expect(
      callTool(s, c, "record_get", { type: "job", id: j.id }),
    ).rejects.toThrow(/source/i);
    valid = true;
    const done = await callTool(s, c, "record_get", { type: "job", id: j.id });
    const asset = await s.get(c, "asset", done.outputs[0]);
    expect(asset.kind).toBe("transcript");
    expect(await callTool(s,c,"transcript_get",{assetId:asset.id})).toEqual(transcript);
    expect(
      JSON.parse(
        Buffer.from(await s.storage.read(asset.storageKey)).toString(),
      ),
    ).toEqual(transcript);
  } finally {
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
