import { directorCatalog } from "../../core/src/director-kits.js";
import { promptTemplateSchema } from "./prompt-schema.js";
// The legacy director selectors remain compatible; data templates can evolve independently.
export const builtinPrompts = directorCatalog({}).kits.flatMap((kit) =>
  Object.entries(kit.recipes).map(([recipe, wording]) =>
    promptTemplateSchema.parse({
      kind: "prompt",
      schemaVersion: 1,
      id: `${kit.id}--${recipe}`,
      version: kit.version,
      title: `${kit.id} / ${recipe}`,
      description: kit.purpose,
      category: kit.kind === "image" ? "图片提示词" : "视频提示词",
      mode: kit.kind,
      searchTerms: [...kit.formats, recipe, ...kit.review],
      text: [
        kit.fixed,
        wording,
        "{{shot}}",
        ...(kit.id === "talking-head-v1"
          ? ["Speak this dialogue exactly:\n{{dialogue}}"]
          : []),
      ].join("\n\n"),
      parameters: {
        shot: { default: "", maxLength: 4000 },
        ...(kit.id === "talking-head-v1"
          ? { dialogue: { default: "", maxLength: 1500 } }
          : {}),
      },
    }),
  ),
);
