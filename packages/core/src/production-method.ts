import { z } from "zod";
import {
  videoPolicySchema,
  combinedFaceStatus,
  videoModelFamily,
  videoModelRank,
} from "../../contracts/src/video-policy.js";
import { AppError, idSchema, type Entity } from "../../contracts/src/index.js";
import { validateGenerationAssets } from "../../providers/src/generation-input.js";
import type { FalProvider, Model } from "../../providers/src/index.js";
import type { ProductionPlan } from "./production-plan.js";

const properties = z.enum(["action", "camera", "timing", "framing"]);
export const methodIntentSchema = z
  .object({
    relationship: z.enum(["edit_source", "transfer_properties", "reinterpret"]),
    change: z.string().trim().min(1).max(1500),
    preserve: z.array(properties).max(4).default([]),
  })
  .strict();
export const productionMethodSchema = z
  .object({
    ...methodIntentSchema.shape,
    kind: z.enum([
      "source_edit",
      "motion_transfer",
      "camera_transfer",
      "reference_transfer",
      "adaptation",
    ]),
    executionMode: z.enum(["reference_to_video", "video_to_video"]).optional(),
    segments: z
      .array(
        z
          .object({
            shotId: idSchema,
            assetId: idSchema,
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
            sourceStartMs: z.number().int().nonnegative(),
            durationMs: z.number().int().positive(),
          })
          .strict(),
      )
      .min(1)
      .max(100)
      .optional(),
    source: z
      .object({
        assetId: idSchema,
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        fps: z.number().positive().max(120).optional(),
        durationMs: z.number().int().positive(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type ProductionMethod = z.infer<typeof productionMethodSchema>;
export const methodResolveSchema = z
  .object({
    videoPolicy: videoPolicySchema.optional(),
    intent: methodIntentSchema,
    model: z.string().min(1).max(120).optional(),
    sourceSegments: z
      .array(
        z
          .object({
            assetId: idSchema,
            sourceStartMs: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .min(1)
      .max(100)
      .optional(),
    sourceAssetId: idSchema.optional(),
    subjects: z
      .array(
        z
          .object({
            assetId: idSchema,
            role: z.enum(["character", "product"]).default("character"),
            instruction: z.string().trim().min(1).max(1000),
          })
          .strict(),
      )
      .max(9)
      .default([]),
    output: z
      .object({
        width: z.number().int().min(144).max(1920),
        height: z.number().int().min(144).max(1920),
      })
      .strict()
      .optional(),
  })
  .strict();

export function methodKind(
  intent: z.infer<typeof methodIntentSchema>,
): ProductionMethod["kind"] {
  if (intent.relationship === "edit_source") return "source_edit";
  if (intent.relationship === "reinterpret") return "adaptation";
  if (intent.preserve.length === 1 && intent.preserve[0] === "action")
    return "motion_transfer";
  if (intent.preserve.length === 1 && intent.preserve[0] === "camera")
    return "camera_transfer";
  return "reference_transfer";
}
export function methodMode(method: ProductionMethod) {
  if (method.executionMode) return method.executionMode;
  return method.kind === "source_edit"
    ? "video_to_video"
    : method.kind === "motion_transfer"
      ? "motion_transfer"
      : method.kind === "camera_transfer"
        ? "camera_transfer"
        : "reference_to_video";
}
export function methodDirection(method: ProductionMethod) {
  return method.kind === "source_edit"
    ? `Recreate the supplied footage with only these requested changes: ${method.change}\nPreserve all other content, body actions, camera motion, cuts, timing, framing and subject screen occupancy. The supplied video determines the entire performance and camera sequence. Identity images change appearance only; retain original poses, vehicles, cuts and their timing. Reproduce the source at its original speed.`
    : `Requested change: ${method.change}\nUse the source footage to transfer these properties together: ${method.preserve.join(", ")}.`;
}

/** The host interprets the brief; this resolves that interpretation, never keywords in user prose. */
export function resolveProductionMethod(
  raw: unknown,
  source: Entity | undefined,
  subjects: Entity[],
  models: ReturnType<FalProvider["describe"]>,
  segmentAssets: Entity[] = [],
) {
  const input = methodResolveSchema.parse(raw);
  const kind = methodKind(input.intent);
  // This is only a method preview. The generation boundary rechecks exact references/hashes.
  const faces = combinedFaceStatus(input.videoPolicy);
  if (kind !== "adaptation" && (!source || source.kind !== "video"))
    throw new AppError(
      "METHOD_SOURCE_REQUIRED",
      "This method needs the actual owned source video",
    );
  if (
    input.intent.relationship === "transfer_properties" &&
    !input.intent.preserve.length
  )
    throw new AppError(
      "METHOD_INTENT_REQUIRED",
      "Name the temporal properties to preserve together",
    );
  if (input.sourceSegments && kind !== "source_edit")
    throw new AppError(
      "INVALID_INPUT",
      "Source segments currently describe a source-preserving timeline",
    );
  const portions = input.sourceSegments
    ? input.sourceSegments.map((entry, i) => {
        const asset = segmentAssets[i];
        if (
          !asset ||
          asset.id !== entry.assetId ||
          asset.kind !== "video" ||
          !Number.isSafeInteger(asset.metadata?.durationMs)
        )
          throw new AppError(
            "METHOD_SOURCE_REQUIRED",
            "Supply actual owned video excerpts with measured duration",
          );
        return { asset, start: entry.sourceStartMs, id: `source-${i + 1}` };
      })
    : source
      ? [{ asset: source, start: 0, id: "source-edit" }]
      : [];
  let end = 0;
  for (const portion of portions) {
    if (
      kind === "source_edit" &&
      (portion.asset.metadata.width !== source!.metadata.width ||
        portion.asset.metadata.height !== source!.metadata.height ||
        (source!.metadata.fps &&
          portion.asset.metadata.fps !== source!.metadata.fps))
    )
      throw new AppError(
        "METHOD_SOURCE_FORMAT_MISMATCH",
        "Source excerpts must preserve the original canvas and frame rate; extract again from the original without cropping or retiming",
      );
    if (kind === "source_edit" && portion.start !== end)
      throw new AppError(
        "METHOD_TIMELINE_MISMATCH",
        "Source excerpts must cover the original timeline in order without gaps or overlaps",
      );
    end = portion.start + portion.asset.metadata.durationMs;
  }
  if (kind === "source_edit" && end !== source!.metadata?.durationMs)
    throw new AppError(
      "METHOD_TIMELINE_MISMATCH",
      "Source excerpts must preserve the complete original duration",
    );
  const method = productionMethodSchema.parse({
    ...input.intent,
    kind,
    ...(kind === "source_edit"
      ? { preserve: ["action", "camera", "timing", "framing"] }
      : {}),
    ...(source
      ? {
          source: {
            assetId: source.id,
            sha256: source.sha256,
            width: source.metadata?.width,
            height: source.metadata?.height,
            durationMs: source.metadata?.durationMs,
            ...(source.metadata?.fps > 0 ? { fps: source.metadata.fps } : {}),
          },
        }
      : {}),
    ...(kind === "source_edit"
      ? {
          segments: portions.map((p) => ({
            shotId: p.id,
            assetId: p.asset.id,
            sha256: p.asset.sha256,
            sourceStartMs: p.start,
            durationMs: p.asset.metadata.durationMs,
          })),
        }
      : {}),
  });
  const refsFor = (asset: Entity | undefined, mode: string) => [
    ...input.subjects,
    ...(asset && kind !== "adaptation"
      ? [
          {
            assetId: asset.id,
            role:
              mode === "video_to_video"
                ? ("source_video" as const)
                : ("motion" as const),
            ...(mode === "video_to_video"
              ? {}
              : {
                  transfer: method.preserve.includes("action")
                    ? ("action" as const)
                    : method.preserve.includes("camera")
                      ? ("camera" as const)
                      : ("rhythm" as const),
                }),
            instruction:
              kind === "source_edit"
                ? "Preserve the complete source performance, camera, timing, cuts and screen occupancy together. Only replace the specified appearances."
                : `Supplies ${method.preserve.join(", ")} together.`,
          },
        ]
      : []),
  ];
  const candidates: {
    modelId: string;
    mode: "reference_to_video" | "video_to_video";
    preference: string;
  }[] = [];
  const excluded: { modelId: string; reason: string }[] = [];
  if (kind !== "adaptation")
    for (const model of models.filter(
      (m) => m.kind === "video" && (!input.model || m.id === input.model),
    )) {
      if (faces !== "absent" && videoModelFamily(model) === "seedance") {
        excluded.push({
          modelId: model.id,
          reason:
            "SEEDANCE_FACE_BLOCKED: inspect references and choose MiniMax or Kling with the user",
        });
        continue;
      }
      const profile = model.generationInput;
      if (
        !model.available ||
        !profile ||
        !["reference_to_video", "video_to_video"].includes(profile.mode) ||
        (kind !== "source_edit" && profile.mode !== "reference_to_video")
      ) {
        excluded.push({
          modelId: model.id,
          reason: "Unavailable or lacks video and identity reference inputs",
        });
        continue;
      }
      const mode = profile.mode as "reference_to_video" | "video_to_video";
      try {
        const { references: bindings, ...limits } = profile;
        const publicModel: Model = {
          id: model.id,
          endpoint: "",
          kind: "video",
          parameters: {},
          priceVersion: "",
          maxCostCents: 0,
          hardBoundConfirmed: false,
          generationInput: {
            ...limits,
            bindings: bindings.map((b, i) => ({
              ...b,
              field: `reference_${i}`,
            })),
          },
        };
        for (const portion of portions)
          validateGenerationAssets(
            publicModel,
            {
              kind: "generate",
              model: model.id,
              mode,
              prompt: input.intent.change,
              parameters: {},
              references: refsFor(portion.asset, mode).map(
                ({ assetId, role }) => ({ assetId, role }),
              ),
            },
            [...subjects, portion.asset],
          );
        candidates.push({
          modelId: model.id,
          mode,
          preference:
            videoModelRank(model, faces) === 0
              ? faces === "absent"
                ? "preferred_compatible_seedance_mini"
                : "preferred_compatible_minimax"
              : "compatible_alternative",
        });
      } catch (error) {
        if (!(error instanceof AppError)) throw error;
        excluded.push({ modelId: model.id, reason: error.message });
      }
    }
  candidates.sort(
    (a, b) =>
      Number(b.preference.startsWith("preferred_")) -
      Number(a.preference.startsWith("preferred_")),
  );
  const selected = candidates[0];
  if (selected) method.executionMode = selected.mode;
  const mode = methodMode(method);
  const references = refsFor(portions[0]?.asset, mode);
  const output =
    input.output ??
    (method.source
      ? { width: method.source.width, height: method.source.height }
      : undefined);
  if (
    kind === "source_edit" &&
    output &&
    [output.width, output.height].some((n) => n < 144 || n > 1920)
  )
    throw new AppError(
      "METHOD_OUTPUT_UNSUPPORTED",
      "The inherited canvas exceeds runtime output limits; resolve an explicit output size",
    );
  const plan =
    kind === "source_edit"
      ? {
          title: "Source-preserving remake",
          ...output,
          method,
          shots: portions.map((p) => ({
            id: p.id,
            sourceVideo: { strategy: "reference", assetId: p.asset.id },
            initialState: {
              source: `Original source state at ${p.start}ms with requested appearance changes only`,
            },
            action: input.intent.change,
            endState: {
              source: `Original source state at ${p.start + Number(p.asset.metadata.durationMs)}ms with requested appearance changes only`,
            },
            sceneDirection: methodDirection(method),
            durationMs: p.asset.metadata.durationMs,
            references: [
              ...refsFor(p.asset, mode),
              ...(p.asset.id !== source!.id
                ? [
                    {
                      assetId: source!.id,
                      role: "motion",
                      usage: "analysis_only",
                      transfer: "action",
                      instruction:
                        "Full original establishes the timeline and canvas; the corresponding excerpt supplies generation motion.",
                    },
                  ]
                : []),
            ],
          })),
        }
      : undefined;
  return {
    method,
    promptMode: mode,
    references,
    output,
    candidates,
    modelSelection: {
      tool: "video_model_resolve",
      faceStatus: faces,
      defaultPreference: faces === "absent" ? "Seedance Mini" : "MiniMax",
      instruction:
        "Resolve each shot's actual references before generation. Present/unknown faces forbid Seedance and require a user choice of MiniMax or Kling. Method compatibility alone is not model authorization.",
    },
    excluded,
    status:
      kind === "adaptation"
        ? "author_target"
        : selected
          ? "candidate_available"
          : "capability_gap",
    ...(plan ? { plan } : {}),
    next:
      kind === "adaptation"
        ? "Author target shots and save this intent."
        : selected
          ? "Save the plan and current request. Requirements remain independent of the selected interface. Compile with promptMode and prepare exact references/parameters. Assemble source-preserving outputs with production_editing_preview; preserve original speed and canvas."
          : "Keep the preservation requirements. Check actual reference limits; if the source is too long, explicitly prepare sourceSegments at meaningful boundaries and resolve again. Never omit footage, invent choreography, retime or change canvas to hide a capability gap.",
    guideTopics: ["production-method"],
    generated: false,
    evidenceBoundary:
      "Interface compatibility is not a visual fidelity guarantee. Source segment ranges are host-declared provenance. Neither preparation nor model selection authorizes unrelated generations.",
  };
}

export function methodPlanIssues(plan: ProductionPlan) {
  const m = plan.method;
  if (!m) return [];
  const messages: string[] = [];
  if (m.kind !== methodKind(m))
    messages.push(
      "Method must follow the saved input relationship and preserved properties",
    );
  if (m.kind !== "adaptation" && !m.source)
    messages.push("Bind the owned source video");
  if (
    ["motion_transfer", "camera_transfer"].includes(m.kind) &&
    plan.shots.some(
      (shot) =>
        shot.visualKind === "media" &&
        !shot.references.some(
          (r) =>
            r.usage !== "analysis_only" &&
            r.role === "motion" &&
            r.transfer === (m.kind === "motion_transfer" ? "action" : "camera"),
        ),
    )
  )
    messages.push(
      "The motion reference responsibility must match the saved method",
    );
  const role = methodMode(m) === "video_to_video" ? "source_video" : "motion";
  if (
    m.kind !== "adaptation" &&
    plan.shots.some(
      (shot) =>
        shot.visualKind === "media" &&
        !shot.references.some(
          (r) => r.usage !== "analysis_only" && r.role === role,
        ),
    )
  )
    messages.push(
      "Carry the actual source footage in the selected interface's reference role",
    );
  if (m.kind === "source_edit") {
    const segments =
      m.segments ??
      (m.source
        ? [
            {
              shotId: plan.shots[0]?.id,
              assetId: m.source.assetId,
              sha256: m.source.sha256,
              sourceStartMs: 0,
              durationMs: m.source.durationMs,
            },
          ]
        : []);
    let end = 0;
    if (segments.length !== plan.shots.length)
      messages.push("Preserve every declared source segment");
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i],
        shot = plan.shots[i];
      if (
        segment.sourceStartMs !== end ||
        !shot ||
        shot.id !== segment.shotId ||
        shot.durationMs !== segment.durationMs ||
        !shot.references.some(
          (r) =>
            r.usage !== "analysis_only" &&
            r.role === role &&
            r.assetId === segment.assetId,
        )
      )
        messages.push(
          "Source-preserving shots must retain their ordered source ranges, duration and actual video reference",
        );
      end = segment.sourceStartMs + segment.durationMs;
    }
    if (end !== m.source?.durationMs)
      messages.push(
        "Preserve the entire original timeline without gaps, overlaps or retiming",
      );
  }
  return messages.map((message) => ({
    code: "PRODUCTION_METHOD_MISMATCH",
    shotId: "",
    message,
  }));
}

export function assertMethodMode(
  plan: ProductionPlan,
  mode?: string,
  stage = "video",
) {
  const m = plan.method;
  if (!m || m.kind === "adaptation") return;
  const expected = methodMode(m);
  if (stage !== "video" && m.kind !== "source_edit") return;
  const wire = expected === "video_to_video" ? expected : "reference_to_video";
  if (stage !== "video" || (mode !== expected && mode !== wire))
    throw new AppError(
      "PRODUCTION_METHOD_MISMATCH",
      `Use ${expected} for the saved execution mode; revise the selected interface explicitly without changing preservation requirements`,
      409,
    );
}

export function assertMethodSource(
  plan: ProductionPlan,
  source: Entity | null | undefined,
) {
  const expected = plan.method?.source;
  if (!expected) return;
  if (
    !source ||
    source.kind !== "video" ||
    source.sha256 !== expected.sha256 ||
    source.metadata?.width !== expected.width ||
    source.metadata?.height !== expected.height ||
    source.metadata?.durationMs !== expected.durationMs
  )
    throw new AppError(
      "METHOD_SOURCE_CHANGED",
      "Resolve the method against the actual owned source video and its measured metadata",
      409,
    );
}

export function assertMethodSegment(
  plan: ProductionPlan,
  shotId: string,
  assets: Entity[],
) {
  const segment = plan.method?.segments?.find((s) => s.shotId === shotId);
  if (!segment) return;
  const actual = assets.find((a) => a.id === segment.assetId);
  if (
    !actual ||
    actual.kind !== "video" ||
    actual.sha256 !== segment.sha256 ||
    actual.metadata?.durationMs !== segment.durationMs
  )
    throw new AppError(
      "METHOD_SOURCE_CHANGED",
      "Use the actual owned excerpt recorded for this shot",
      409,
    );
}

export function sourceEditComposition(
  plan: ProductionPlan,
  output: Entity | Entity[],
) {
  if (plan.method?.kind !== "source_edit" || !plan.method.source)
    throw new AppError(
      "PRODUCTION_METHOD_MISMATCH",
      "This assembly path requires a source-preserving plan",
    );
  const assets = Array.isArray(output) ? output : [output];
  if (assets.length !== plan.shots.length)
    throw new AppError(
      "INVALID_INPUT",
      "Supply one completed output for each ordered source segment",
    );
  const scenes = plan.shots.map((shot, i) => {
    const asset = assets[i],
      durationMs = shot.durationMs!;
    if (
      asset.kind !== "video" ||
      !Number.isSafeInteger(asset.metadata?.durationMs) ||
      asset.metadata.durationMs < durationMs
    )
      throw new AppError(
        "GENERATION_TOO_SHORT",
        "Output does not cover the original source range; never stretch or loop it",
      );
    return {
      id: shot.id,
      productionShotId: shot.id,
      assetId: asset.id,
      sourceStartMs: 0,
      durationMs,
      speed: 1,
      fit: "contain",
    };
  });
  return {
    schemaVersion: 1,
    title: plan.title,
    width: plan.width,
    height: plan.height,
    ...(plan.method.source.fps ? { fps: plan.method.source.fps } : {}),
    scenes,
  };
}
