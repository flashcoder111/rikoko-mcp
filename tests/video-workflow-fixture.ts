import { randomUUID } from "node:crypto";
import { referenceReportSchema } from "../packages/contracts/src/reference-analysis.js";
export async function remakeFixture(
  service: any,
  c: any,
  options: {
    upstream?: string;
    unknown?: boolean;
    trusted?: boolean;
    source?: any;
  } = {},
) {
  const jobId = randomUUID();
  const source =
    options.source ??
    (await service.registerAsset(c.accountId, Buffer.from(randomUUID()), {
      name: "source.mp4",
      kind: "video",
      mime: "video/mp4",
      metadata: { durationMs: 2000, hasAudio: false },
      provenance: { evidence: "contract-fixture" },
    }));
  const duration = source.metadata?.durationMs ?? 2000;
  const report = referenceReportSchema.parse({
    schemaVersion: 2,
    analysis: {
      detail: "recreate",
      focus: ["motion", "continuity"],
      method: "whole_video",
    },
    source: {
      assetId: source.id,
      sha256: source.sha256,
      durationMs: duration,
      hasAudio: source.metadata?.hasAudio === true,
      timebase: "source_ms",
    },
    summary: "A lid opens and the interior is revealed.",
    shots: [
      {
        id: "source-open",
        startMs: 0,
        endMs: duration,
        description: "Box",
        framing: "Close-up",
        cameraMotion: "Fixed",
        action: "Open lid",
        transition: "End",
        evidenceIds: ["e-open"],
        details: {
          startState: "Closed",
          endState: "Open",
          spatialRelations: "Hand above lid",
          lighting: "Soft",
          actionStages: [
            {
              description: "Contact",
              subjectMotion: "Hand approaches",
              cameraMotion: "Fixed",
            },
            {
              description: "Open",
              subjectMotion: "Lid rotates",
              cameraMotion: "Fixed",
            },
          ],
          continuity: {
            fromPrevious: "Start",
            toNext: "End",
            constraints: ["Same box"],
          },
        },
      },
    ],
    narrativeBeats: [
      {
        id: "beat-reveal",
        startMs: 0,
        endMs: duration,
        role: "reveal",
        description: "Show interior",
        evidenceIds: ["e-open"],
      },
    ],
    events: [],
    visualStyle: { description: "Clean", evidenceIds: ["e-open"] },
    speech: [],
    audio: { description: "Silent", evidenceIds: [] },
    evidence: [
      {
        id: "e-open",
        startMs: 0,
        endMs: duration,
        modality: "visual",
        observation: "The lid opens",
        confidence: "high",
      },
    ],
    unknowns: options.unknown
      ? [
          {
            startMs: 0,
            endMs: 1000,
            question: "Was contact made?",
            reason: "Occluded",
            suggestedFps: 4,
          },
        ]
      : [],
    coverage: {
      startMs: 0,
      endMs: duration,
      fps: 2,
      mode: "static_video_and_audio",
      timing: "model_estimated",
      gaps: [],
    },
    measurements: {
      status: "unavailable",
      method: "ffmpeg-scene-difference",
      threshold: 0.3,
      cutTimesMs: [],
      reason: "Contract fixture",
    },
    provenance: {
      provider: "fixture-analysis",
      model: "reference-vision",
      endpoint: "gemini-fixture",
      upstreamModel: options.upstream ?? "gemini-fixture",
      requestId: "fixture-request",
      jobId,
      analysisVersion: "reference-v2.2-detail",
      priceVersion: "fixture",
      analyzedAt: new Date().toISOString(),
      evidence: "provider-live",
    },
  });
  const asset = await service.registerAsset(
    c.accountId,
    Buffer.from(JSON.stringify(report)),
    {
      name: "analysis.json",
      kind: "analysis",
      mime: "application/json",
      metadata: {},
      provenance: { evidence: "provider-live" },
      jobId,
    },
  );
  if (options.trusted !== false)
    await service.scoped(c, "write", (tx: any) =>
      tx.put({
        id: jobId,
        type: "job",
        accountId: c.accountId,
        createdAt: new Date().toISOString(),
        status: "completed",
        input: {
          kind: "reference_analyze",
          assetId: source.id,
          model: "reference-vision",
          purpose: "remake",
          detail: "recreate",
        },
        outputs: [asset.id],
        analysis: report,
      }),
    );
  const plan: any = {
    title: "Reveal a new box",
    width: 1280,
    height: 720,
    remake: {
      analysisAssetId: asset.id,
      analysisSha256: asset.sha256,
      productFacts: ["The target box has a hinged lid"],
      requirements: [
        {
          id: "reveal",
          mode: "preserve",
          origin: "reference",
          description: "Show the completed opening before cutting",
          sourceShotIds: ["source-open"],
          evidenceIds: ["e-open"],
        },
      ],
      unknownDecisions: [],
    },
    shots: [
      {
        id: "target-open",
        sourceShotIds: ["source-open"],
        purpose: "Reveal the interior",
        initialState: { lid: "closed" },
        action: "Open the lid",
        actionStages: [
          "Hand contacts the lid",
          "Lid rotates open",
          "Hold the open result",
        ],
        endState: { lid: "open" },
        camera: "Fixed close-up; keep contact visible",
        acceptanceCriteria: ["Interior is visible after opening"],
        requirementUses: [
          {
            requirementId: "reveal",
            application: "Hold the open result before the cut",
          },
        ],
      },
    ],
  };
  return { source, report, asset, plan };
}

/** Completed analysis fixture used by transport tests, never a runtime bypass. */
export async function attachFixtureAnalysis(
  service: any,
  c: any,
  plan: any,
  source: any,
) {
  const f = await remakeFixture(service, c, { source });
  plan.remake = f.plan.remake;
  for (const shot of plan.shots) {
    shot.purpose ??= "Preserve the original action";
    shot.camera ??= "Preserve original camera motion";
    shot.actionStages ??= ["Preserve the original movement"];
    shot.acceptanceCriteria ??= ["Movement matches the source"];
    shot.sourceShotIds = ["source-open"];
    if (plan.method?.kind === "source_edit") {
      shot.sourceShotDirections ??= [
        {
          sourceShotId: "source-open",
          direction: "Retain the fixture action with the target subject",
          referenceAssetIds: [],
          relations: [
            {
              sourceField: "startState",
              disposition: "preserve",
              target: "Target lid starts closed",
              reason: "Fixture closed starting state",
            },
            {
              sourceField: "endState",
              disposition: "preserve",
              target: "Target lid ends open",
              reason: "Fixture completed opening",
            },
            {
              sourceField: "spatialRelations",
              disposition: "preserve",
              target: "Target hand remains above the target lid",
              reason: "Fixture contact layout",
            },
          ],
        },
      ];
    }
    shot.requirementUses = [
      {
        requirementId: "reveal",
        application: "Preserve the fixture source movement",
      },
    ];
  }
  return f;
}
