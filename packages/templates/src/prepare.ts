import { builtinPrompts } from "./builtin-prompts.js";
import { AppError, type Context } from "../../contracts/src/index.js";
import { fingerprint, type Service } from "../../core/src/index.js";
import { cloudConnection } from "../../cloud-client/src/index.js";
import { applyTemplateSchema, instantiate, templateSchema } from "./schema.js";
import {
  promptTemplateSchema,
  renderPrompt,
  applyPromptTemplateSchema,
} from "./prompt-schema.js";
import { starterTemplates } from "./starters.js";
import {
  prepareStarter,
  validateSceneAssets,
  bindSceneAssets,
} from "./local-library.js";
import { prepareTemplateSpeech, validateSpeechVisuals } from "./speech.js";
import { personalVersion, rememberPreparation } from "./personal.js";
export async function prepareTemplate(
  service: Service,
  c: Context,
  raw: unknown,
) {
  const p = applyTemplateSchema.parse(raw);
  await service.scoped(c, "write", async () => {});
  const client = cloudConnection(service)?.templates;
  const cloud = client ? await client.list(c) : null;
  const isPersonal =
    p.sourceKind === "personal" ||
    (!p.sourceKind && p.id.startsWith("personal-"));
  if (isPersonal) {
    const saved = await personalVersion(service, c, p.id, p.version);
    if (saved.kind === "prompt")
      throw new AppError(
        "INVALID_INPUT",
        "Use template_prompt_prepare for prompt templates",
      );
    const { hash, sourceKind, upstream, ...rawDefinition } = saved;
    const t = templateSchema.parse(rawDefinition);
    const bindings = await validateSceneAssets(
      service,
      c,
      t.composition.scenes.map((s) => s.id),
      p.sceneAssets,
    );
    const mapping: Record<string, string> = {};
    for (const a of t.assets) {
      const owned = await service.get(c, "asset", a.id);
      if (owned.sha256 !== a.sha256)
        throw new AppError("ASSET_HASH_MISMATCH", "个人模板素材已改变", 409);
      mapping[a.id] = a.id;
    }
    const composition = await prepareTemplateSpeech(
      service,
      c,
      t,
      bindSceneAssets(instantiate(t, p.parameters, mapping), bindings),
      p.speech,
      p.parameters,
    );
    const visuals = { ...bindings };
    for (const s of composition.scenes)
      if (s.assetId && !visuals[s.id])
        visuals[s.id] = await service.get(c, "asset", s.assetId);
    validateSpeechVisuals(composition, visuals);
    return rememberPreparation(service, c, {
      composition,
      templateSource: {
        id: t.id,
        version: t.version,
        hash,
        source: "personal",
        parameters: p.parameters,
        snapshot: t,
        upstream,
      },
      reuse: {
        existingScenes: composition.scenes.length,
        bundledScenes: 0,
        generationRequests: 0,
      },
    });
  }
  const hasCloud = [
    ...(cloud?.templates ?? []),
    ...(cloud?.history ?? []),
  ].some((t: any) => t.id === p.id && t.version === p.version);
  if (p.sourceKind === "cloud" || (!p.sourceKind && hasCloud)) {
    if (!client)
      throw new AppError("CLOUD_NOT_CONFIGURED", "请配置模板源并更新模板", 409);
    return rememberPreparation(service, c, await client.prepare(c, p));
  }
  const t = starterTemplates.find(
    (t) => t.id === p.id && t.version === p.version,
  );
  if (!t)
    throw new AppError(
      "TEMPLATE_NOT_CACHED",
      "模板版本不存在，请更新模板或检查版本",
      404,
    );
  const {
    sourceKind,
    parameterLabels,
    sceneLabels,
    coverAssetId,
    preparation,
    isNew,
    ...definition
  } = t;
  return rememberPreparation(service, c, {
    ...(await prepareStarter(service, c, p)),
    templateSource: {
      id: t.id,
      version: t.version,
      hash: fingerprint(definition),
      source: "builtin",
      parameters: p.parameters,
      snapshot: definition,
    },
  });
}
export async function preparePromptTemplate(
  service: Service,
  c: Context,
  raw: unknown,
) {
  const p = applyPromptTemplateSchema.parse(raw);
  await service.scoped(c, "write", async () => {});
  if (Object.keys(p.sceneAssets).length || p.speech)
    throw new AppError(
      "INVALID_INPUT",
      "Prompt templates accept text parameters only",
    );
  let saved: any, source: string;
  if (
    p.sourceKind === "personal" ||
    (!p.sourceKind && p.id.startsWith("personal-"))
  ) {
    saved = await personalVersion(service, c, p.id, p.version);
    source = "personal";
  } else {
    const snapshot = await cloudConnection(service)?.templates?.list(c);
    saved =
      p.sourceKind !== "builtin"
        ? [
            ...(snapshot?.promptTemplates ?? []),
            ...(snapshot?.promptHistory ?? []),
          ].find((t: any) => t.id === p.id && t.version === p.version)
        : undefined;
    source = snapshot?.source;
    if (!saved && p.sourceKind !== "cloud") {
      const builtin = builtinPrompts.find(
        (t) => t.id === p.id && t.version === p.version,
      );
      if (builtin) {
        saved = { ...builtin, hash: fingerprint(builtin) };
        source = "builtin";
      }
    }
  }
  if (!saved || saved.kind !== "prompt")
    throw new AppError("NOT_FOUND", "提示词模板版本不存在", 404);
  const { hash, sourceKind, upstream, ...definition } = saved;
  const t = promptTemplateSchema.parse(definition);
  return rememberPreparation(service, c, {
    text: renderPrompt(t, p.parameters),
    mode: t.mode,
    promptTemplate: t,
    templateSource: {
      id: t.id,
      version: t.version,
      hash,
      source,
      parameters: p.parameters,
      snapshot: t,
      upstream,
    },
    generationRequests: 0,
  });
}
