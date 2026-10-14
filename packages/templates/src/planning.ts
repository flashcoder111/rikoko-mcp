import { z } from "zod";
import {
  AppError,
  compositionSchema,
  type Entity,
} from "../../contracts/src/index.js";
import type {
  PlanInput,
  Proposal,
} from "../../core/src/workspace-contracts.js";
import { applyTemplateSchema } from "./schema.js";
import { rankTemplates, relevantAssets } from "./matching.js";
import type { LibraryTemplate } from "./starters.js";

export const templateDecisionSchema = applyTemplateSchema
  .extend({
    durationMs: z.number().int().min(500).max(600000).optional(),
    format: z.enum(["portrait", "landscape", "square"]).optional(),
  })
  .strict();
export type TemplateDecision = z.infer<typeof templateDecisionSchema>;
export type TemplateContext = {
  templates: LibraryTemplate[];
  assets: Entity[];
};
export type PlannedProposal = Proposal & { template?: TemplateDecision };

export function templateContext(
  message: string,
  templates: LibraryTemplate[],
  assets: Entity[],
  attached: Entity[],
): TemplateContext {
  const ranked = rankTemplates(message, templates)
    .slice(0, 5)
    .map((item) => item.template);
  return {
    // For free-form requests the model can evaluate the compact catalog itself.
    templates: ranked.length ? ranked : templates.slice(0, 12),
    assets: [
      ...new Map(
        [...attached, ...relevantAssets(message, assets)].map((a) => [a.id, a]),
      ).values(),
    ],
  };
}

export function localTemplatePlan(
  input: PlanInput,
  context: TemplateContext,
): PlannedProposal | undefined {
  const selected = rankTemplates(input.message, context.templates)[0]?.template;
  if (!selected || selected.sourceKind !== "builtin") return;
  // These requests require footage/analysis or audio work that a graphic template cannot supply.
  if (
    /(?:真人|口播|配音|跳舞|跟拍|电影大片|live.action|voice.?over|lip.?sync)/i.test(
      input.message,
    )
  )
    return;
  if (
    input.assetIds.some((id) =>
      context.assets.some((a) => a.id === id && a.kind === "video"),
    )
  )
    return;
  const script = input.message.match(
    /(?:脚本|文案|文字)\s*[:：]\s*([\s\S]+)/,
  )?.[1];
  const content =
    script ??
    input.message
      .replace(/^(?:帮我|请|给我)/, "")
      .replace(/(?:制作|做|生成)(?:一个|一条|一段)?/g, "")
      .replace(/\d+(?:\.\d+)?\s*秒(?:的)?|横屏|竖屏|16[:：]9|9[:：]16/g, "")
      .replace(/(?:宣传)?(?:视频|短片)/g, "");
  const copy = content
    .split(script ? /[\n；;]+/ : /[\n；;。]+|[，,]/)
    .map((s) => s.trim())
    .filter(
      (s) =>
        s &&
        (script ||
          !/^(?:风格|色调|节奏|画面|温暖|简洁|温馨|不要|没有参考|无参考|不提供参考)/.test(
            s,
          )),
    );
  if (!copy.length) return;
  if (selected.id.endsWith("testimonial") && !script)
    return {
      engine: "template-library",
      message:
        "我可以按评价短片的结构编排。请补充要展示的真实评价文字和来源，不需要提供参考视频。",
    };
  const keys = Object.keys(selected.parameters);
  if (
    copy.length > keys.length ||
    copy.some(
      (line, i) => line.length > selected.parameters[keys[i]]?.maxLength,
    )
  )
    return;
  const parameters = Object.fromEntries(
    keys.map((key, i) => [key, copy[i] ?? ""]),
  );
  const attached = context.assets.filter(
    (a) => input.assetIds.includes(a.id) && ["image", "video"].includes(a.kind),
  );
  const visuals = attached.length
    ? attached
    : relevantAssets(input.message, context.assets).filter(
        (a) =>
          ["image", "video"].includes(a.kind) &&
          a.provenance?.source !== "rikoko-starter",
      );
  const sceneAssets = Object.fromEntries(
    selected.composition.scenes.flatMap((scene, i) =>
      visuals.length ? [[scene.id, visuals[i % visuals.length].id]] : [],
    ),
  );
  const seconds = input.message.match(
    /(\d+(?:\.\d+)?)\s*(?:秒|seconds?)/i,
  )?.[1];
  return {
    engine: "template-library",
    message: "已自动匹配剪辑结构，按你的文字编排并复用可用画面。",
    template: templateDecisionSchema.parse({
      id: selected.id,
      version: selected.version,
      parameters,
      sceneAssets,
      ...(seconds ? { durationMs: Math.round(Number(seconds) * 1000) } : {}),
      ...(/横屏|16[:：]9|landscape/i.test(input.message)
        ? { format: "landscape" }
        : /方形|1[:：]1|square/i.test(input.message)
          ? { format: "square" }
          : {}),
    }),
  };
}

export function validateTemplateDecision(
  decision: TemplateDecision,
  context: TemplateContext,
) {
  const selected = context.templates.find(
    (t) => t.id === decision.id && t.version === decision.version,
  );
  if (!selected)
    throw new AppError("AGENT_OUTPUT", "创作方案引用了不可用的模板。", 502);
  if (
    Object.values(decision.sceneAssets).some(
      (id) => !context.assets.some((a) => a.id === id),
    )
  )
    throw new AppError("AGENT_OUTPUT", "创作方案引用了未提供的素材。", 502);
  // Require explicit values: example copy must not leak into an actual user's video.
  if (
    Object.keys(selected.parameters).some(
      (key) => !Object.hasOwn(decision.parameters, key),
    )
  )
    throw new AppError("AGENT_OUTPUT", "创作方案没有完成文案填充。", 502);
  return selected;
}

export function adaptTemplateComposition(
  raw: unknown,
  decision: TemplateDecision,
  assets: Entity[],
) {
  const composition = compositionSchema.parse(raw);
  if (decision.format) {
    const sizes = {
      portrait: [720, 1280],
      landscape: [1280, 720],
      square: [720, 720],
    };
    [composition.width, composition.height] = sizes[decision.format];
  }
  if (decision.durationMs !== undefined) {
    const original = composition.scenes.reduce(
      (sum, s) => sum + s.durationMs,
      0,
    );
    // Avoid silently breaking timed overlays, speech or music in a richer cloud template.
    if (
      composition.events.length ||
      composition.audio ||
      composition.scenes.some((s) => s.audioAssetId || s.words?.length)
    ) {
      if (decision.durationMs !== original)
        throw new AppError(
          "INVALID_INPUT",
          "此模板含已对齐的声音或叠加内容，需要按镜头调整时长。",
        );
    } else {
      let allocated = 0;
      composition.scenes.forEach((scene, i) => {
        const target =
          i === composition.scenes.length - 1
            ? decision.durationMs! - allocated
            : Math.round((scene.durationMs / original) * decision.durationMs!);
        const asset = assets.find((a) => a.id === scene.assetId);
        if (
          asset?.kind === "video" &&
          asset.metadata?.durationMs &&
          target > asset.metadata.durationMs
        )
          throw new AppError(
            "INVALID_INPUT",
            "已有视频长度不足，需要调整镜头安排或时长。",
          );
        scene.durationMs = target;
        allocated += target;
      });
    }
  }
  return compositionSchema.parse(composition);
}
