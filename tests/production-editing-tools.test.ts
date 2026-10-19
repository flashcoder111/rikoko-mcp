import { afterAll, beforeAll, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "../packages/db/src/index.js";
import { Service } from "../packages/core/src/index.js";
import { LocalStorage } from "../packages/storage/src/index.js";
import { FalProvider } from "../packages/providers/src/index.js";
import { callTool } from "../packages/mcp/src/tools.js";
import {
  cloudPreparationProtocol,
  syncCloudProductionContext,
} from "../packages/core/src/cloud-preparation.js";
let db: Database, service: Service, c: any, dir: string, music: any;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "quality-tools-"));
  db = await Database.open();
  service = new Service(
    db,
    new LocalStorage(dir),
    new FalProvider([], undefined, false),
  );
  c = await service.authenticate(
    (await service.createAccount("quality", 100)).key,
  );
  music = await service.registerAsset(c.accountId, Buffer.from("test-audio"), {
    name: "track",
    kind: "audio",
    mime: "audio/wav",
    metadata: { hasAudio: true, durationMs: 10000 },
    provenance: { evidence: "precomputed" },
  });
});
afterAll(async () => {
  await db.close();
  await rm(dir, { recursive: true, force: true });
});
function plan() {
  return {
    title: "Service ad",
    width: 720,
    height: 1280,
    shots: [
      {
        id: "demo",
        initialState: { screen: "before" },
        action: "Show the result",
        endState: { screen: "after" },
        durationMs: 2000,
      },
      {
        id: "brand",
        visualKind: "graphic",
        initialState: { brand: "shown" },
        action: "Hold",
        endState: { brand: "shown" },
        durationMs: 2000,
      },
    ],
    editing: {
      version: 1,
      audio: {
        mode: "shared_track",
        assetId: music.id,
        sourceSha256: music.sha256,
        gain: 0.2,
        allowNativeAudio: false,
        ending: "resolve",
        endingReason: "Closing phrase",
        beatPoints: [
          {
            id: "accent",
            timeMs: 2000,
            kind: "accent",
            provenance: "manual",
            evidence: "User-supplied cue",
          },
        ],
        syncPoints: [
          {
            shotId: "brand",
            offsetMs: 0,
            beatId: "accent",
            toleranceMs: 80,
            description: "Brand reveal",
          },
        ],
      },
      ending: {
        shotIds: ["brand"],
        strategy: "brand_card",
        productVisible: false,
        brandText: "Example",
        minHoldMs: 1500,
        reason: "Service brand card after demo",
      },
    },
  };
}
it("exposes timing and review obligations without rendering", async () => {
  const saved: any = await callTool(service, c, "production_plan_save", {
    plan: plan(),
  });
  const preview: any = await callTool(
    service,
    c,
    "production_editing_preview",
    { planId: saved.id, expectedVersion: 1 },
  );
  expect(preview.timeline).toHaveLength(2);
  expect(preview.syncPoints[0]).toMatchObject({
    targetMs: 2000,
    beatMs: 2000,
    deltaMs: 0,
  });
  expect(preview.generated).toBe(false);
  expect(preview.reviewObligations.map((x: any) => x.id)).toContain(
    "audio:continuity",
  );
  await expect(
    callTool(service, c, "production_editing_preview", {
      planId: saved.id,
      expectedVersion: 2,
    }),
  ).rejects.toMatchObject({ code: "PLAN_CONFLICT" });
});
it("validates owned audio and byte binding before saving", async () => {
  const bad = plan();
  bad.editing.audio.sourceSha256 = "f".repeat(64);
  await expect(
    callTool(service, c, "production_plan_save", { plan: bad }),
  ).rejects.toMatchObject({ code: "AUDIO_SOURCE_CHANGED" });
  bad.editing.audio.assetId = "other-account-audio";
  await expect(
    callTool(service, c, "production_plan_save", { plan: bad }),
  ).rejects.toMatchObject({ code: "AUDIO_SOURCE_REQUIRED" });
});
it("does not allow updates to silently strip quality contracts", async () => {
  const saved: any = await callTool(service, c, "production_plan_save", {
    plan: plan(),
  });
  const changed: any = plan();
  delete changed.editing;
  await expect(
    callTool(service, c, "production_plan_save", {
      plan: changed,
      planId: saved.id,
      expectedVersion: 1,
    }),
  ).rejects.toMatchObject({ code: "PRODUCTION_QUALITY_REQUIRED" });
  changed.editing = plan().editing;
  delete changed.editing.audio;
  await expect(
    callTool(service, c, "production_plan_save", {
      plan: changed,
      planId: saved.id,
      expectedVersion: 1,
    }),
  ).rejects.toMatchObject({ code: "PRODUCTION_QUALITY_REQUIRED" });
});
it("advertises quality boundary and retained legacy support", async () => {
  const caps: any = await callTool(service, c, "capabilities", {});
  expect(caps.productionQuality).toMatchObject({
    version: 1,
    semanticReviewer: "host_or_user",
    automaticBeatDetection: false,
    editingPreviewTool: "production_editing_preview",
  });
});

it("retains quality obligations when rebinding a project to another plan", async () => {
  const original: any = await callTool(service, c, "production_plan_save", {
    plan: plan(),
  });
  const legacy: any = plan();
  delete legacy.editing;
  const replacement: any = await callTool(service, c, "production_plan_save", {
    plan: legacy,
  });
  await expect(
    callTool(service, c, "production_scope_save", {
      projectId: original.productionProjectId,
      planId: replacement.id,
      expectedPlanVersion: 1,
      expectedScopeVersion: 1,
    }),
  ).rejects.toMatchObject({ code: "PRODUCTION_QUALITY_REQUIRED" });
});

it("does not strip quality contracts in a newer cloud plan mirror", async () => {
  const context = {
    protocol: cloudPreparationProtocol,
    clientId: "a".repeat(64),
    localId: "quality-plan-mirror",
    kind: "plan",
    version: 1,
    plan: plan(),
  };
  await syncCloudProductionContext(service, c, context);
  const legacy: any = plan();
  delete legacy.editing;
  await expect(
    syncCloudProductionContext(service, c, {
      ...context,
      version: 2,
      plan: legacy,
    }),
  ).rejects.toMatchObject({ code: "PRODUCTION_QUALITY_REQUIRED" });
});

it("retains quality obligations across cloud scope plan switches", async () => {
  const context = {
    protocol: cloudPreparationProtocol,
    clientId: "b".repeat(64),
    version: 1,
  };
  const enhanced = await syncCloudProductionContext(service, c, {
    ...context,
    kind: "plan",
    localId: "enhanced",
    plan: plan(),
  });
  const legacy: any = plan();
  delete legacy.editing;
  const replacement = await syncCloudProductionContext(service, c, {
    ...context,
    kind: "plan",
    localId: "legacy",
    plan: legacy,
  });
  const scope = {
    version: 1,
    planId: enhanced.id,
    planVersion: 1,
    requirements: {
      requiredChecks: [
        "actionComplete",
        "framing",
        "continuity",
        "noArtifacts",
      ],
      allowedAssetUses: ["prepared_generation"],
    },
  };
  await syncCloudProductionContext(service, c, {
    ...context,
    kind: "scope",
    localId: "quality-project",
    scope,
  });
  await expect(
    syncCloudProductionContext(service, c, {
      ...context,
      kind: "scope",
      localId: "quality-project",
      version: 2,
      scope: { ...scope, version: 2, planId: replacement.id },
    }),
  ).rejects.toMatchObject({ code: "PRODUCTION_QUALITY_REQUIRED" });
});
