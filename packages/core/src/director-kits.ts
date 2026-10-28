import { z } from "zod";
import { AppError } from "../../contracts/src/index.js";
import { guideEntry } from "../../guidance/src/catalog.js";

// Original rikoko wording; architecture informed by hypit Prompt Kits. A revision
// is immutable once used in a preparation. Add a new revision for wording edits.
export const imageDirectorKitSchema = z
  .object({
    id: z.literal("creator-image-v1"),
    version: z.literal(1),
    recipe: z.enum(["creator-room", "product-in-hand"]),
  })
  .strict();
export const videoDirectorKitSchema = z.discriminatedUnion("id", [
  z
    .object({
      id: z.literal("ugc-demo-v1"),
      version: z.literal(1),
      recipe: z.enum(["hands-on", "daily-use"]),
    })
    .strict(),
  z
    .object({
      id: z.literal("talking-head-v1"),
      version: z.literal(1),
      recipe: z.enum(["friendly-explainer", "calm-expert", "energetic-hook"]),
      dialogue: z.string().trim().min(1).max(1500),
    })
    .strict(),
  z
    .object({
      id: z.literal("product-broll-v1"),
      version: z.literal(1),
      recipe: z.enum(["beauty-hold", "single-operation"]),
    })
    .strict(),
]);
export const directorKitSchema = z.union([
  imageDirectorKitSchema,
  videoDirectorKitSchema,
]);
export type DirectorKitSelection = z.infer<typeof directorKitSchema>;

const kits = [
  {
    id: "creator-image-v1",
    kind: "image",
    formats: ["ugc-ad", "talking-head-ad"],
    purpose:
      "Establish one reusable creator, environment and pre-action product state.",
    fixed:
      "Create a believable creator-camera still with natural skin and material texture, ordinary light and a recognizable lived-in setting. Keep the person's face and relevant hand/object contact clearly readable. Show only the declared boundary state. Leave useful room for the upcoming gesture and separately composed captions.",
    recipes: {
      "creator-room":
        "Use an eye-level medium close view. Give the room a few purposeful everyday details and keep the presenter's face unobstructed. A relaxed, attentive expression should be able to continue into a performance.",
      "product-in-hand":
        "Keep the established person and scene when their reference is supplied. Present the product in one stable grip beside the face or above the table. Match its defining form to the product reference; do not replace the surrounding scene with the product photo's background.",
    },
    referenceNeeds: [
      "Character/scene for recurring identity; product reference for exact shape and marks. References supply only their declared facts.",
    ],
    review: [
      "Identity and product form",
      "Natural grip and scale",
      "Correct pre-action state",
      "Room for motion and captions",
    ],
    limitations: ["Not a calibrated packshot or an exact text renderer."],
    requirements: [] as string[],
  },
  {
    id: "ugc-demo-v1",
    kind: "video",
    formats: ["ugc-ad"],
    purpose:
      "A creator demonstrates one observable product use in an everyday situation.",
    fixed:
      "Film one understandable product-use moment with the established creator and surroundings. Let the visible interaction carry the claim; show the same product before, during and after the action. Keep attention on the contact and result, with a brief readable pause after completion. The creator does not speak in this shot; any narration is added separately.",
    recipes: {
      "hands-on":
        "Use a steady close or medium view that includes the working hand and contact point. Perform only the authored operation once. Keep supports and grips plausible; stop when that operation finishes instead of continuing the product's entire workflow.",
      "daily-use":
        "Place the single use in the already established daily activity. Allow modest natural body movement while preserving a readable product view. End on the observable result without inventing another task or a dramatic transformation.",
    },
    referenceNeeds: [
      "A checked scene/first frame for the actual starting state; a product reference alone cannot establish an unfinished process.",
    ],
    review: [
      "One completed use",
      "Stable person and product",
      "Visible causal action",
      "No unsupported results",
    ],
    limitations: [
      "Silent demonstration; not lip-synchronized speech.",
      "Complex assembly needs an appropriate process plan or a different treatment.",
    ],
    requirements: [] as string[],
  },
  {
    id: "talking-head-v1",
    kind: "video",
    formats: ["ugc-ad", "talking-head-ad"],
    purpose:
      "One visible presenter delivers the approved advertising copy with synchronized native speech.",
    fixed:
      "Record the established presenter addressing the viewer in a stable, readable camera view. Keep identity, clothing, setting and any held product consistent. Deliver only the supplied words, in their supplied language, with matching visible articulation. Emphasize the thought through expression and a few motivated gestures. Spoken metaphors and mentioned products must not materialize as new objects or transformations in the scene.",
    recipes: {
      "friendly-explainer":
        "Speak as if explaining a useful detail to one interested person. Use relaxed confidence, clear phrasing and small explanatory gestures; leave a natural pause at the end.",
      "calm-expert":
        "Give the explanation measured emphasis and an assured, restrained presence. Keep gestures compact and let eye contact carry the delivery; do not invent professional credentials or endorsements.",
      "energetic-hook":
        "Open with focused curiosity and a clear vocal accent on the key thought. Maintain understandable delivery and controlled gestures rather than constant movement or shouting.",
    },
    referenceNeeds: [
      "A reusable presenter/scene reference; explicit supported voice inputs if recurring voice identity is required.",
    ],
    review: [
      "Exact words and language by listening",
      "Lip/speech synchronization",
      "Identity and expression",
      "Claims, offer and CTA match the brief",
    ],
    limitations: [
      "Requires an explicitly enabled native-audio video profile; silent video plus narration is not a talking-head substitute.",
      "No exact speaking-duration or recurring-voice guarantee.",
    ],
    requirements: ["native-dialogue-audio"],
  },
  {
    id: "product-broll-v1",
    kind: "video",
    formats: ["ugc-ad", "talking-head-ad"],
    purpose:
      "Silent product coverage that supports a demonstration or gives the ad a product payoff.",
    fixed:
      "Make a silent product insert in the supplied visual world. Preserve the product's visible shape, materials, count and support. Show the current shot's action only; do not complete later steps or add unrequested components. Keep its important detail readable through the end.",
    recipes: {
      "beauty-hold":
        "Keep the existing arrangement and process state unchanged. Use only restrained surface or environmental micro-motion and the explicitly requested camera movement. Do not turn the hold into assembly, pouring, opening or a product transformation.",
      "single-operation":
        "Show one bounded physical change with its approach, contact, completion and settled result visible. Stop after that change; keep previously completed work intact. A reference showing a finished product supplies appearance, not permission to skip or repeat operations.",
    },
    referenceNeeds: [
      "A checked current-state image for state-sensitive shots; the previous actual endpoint only when exact continuous action is needed.",
    ],
    review: [
      "Product identity",
      "Current operation or hold only",
      "Usable end hold",
      "Clean transition into composition",
    ],
    limitations: [
      "Not a validated food-assembly or fluid-simulation recipe.",
      "Brand lettering and CTA belong in the edit.",
    ],
    requirements: [] as string[],
  },
] as const;

export const directorCatalogSchema = z
  .object({
    id: z.string().min(1).max(80).optional(),
    kind: z.enum(["image", "video"]).optional(),
    format: z.enum(["ugc-ad", "talking-head-ad"]).optional(),
  })
  .strict();

export function directorCatalog(raw: unknown) {
  const filter = directorCatalogSchema.parse(raw);
  if (filter.id && !kits.some((k) => k.id === filter.id))
    throw new AppError(
      "DIRECTOR_KIT_NOT_FOUND",
      "Choose an ID from director_catalog",
    );
  return {
    catalogVersion: "rikoko-ad-directors-v1",
    formats: [
      {
        id: "ugc-ad",
        guide: "ugc-ads",
        structure: [
          "recognizable situation or hook",
          "one visible use",
          "observable benefit/proof",
          "product and approved CTA",
        ],
      },
      {
        id: "talking-head-ad",
        guide: "talking-head-ads",
        structure: [
          "spoken hook",
          "specific explanation",
          "supporting proof or B-roll",
          "spoken CTA and product/brand hold",
        ],
      },
    ],
    kits: kits
      .filter(
        (k) =>
          (!filter.id || k.id === filter.id) &&
          (!filter.kind || k.kind === filter.kind) &&
          (!filter.format ||
            (k.formats as readonly string[]).includes(filter.format)),
      )
      .map((k) => ({
        ...k,
        knowledge: {
          formats: k.formats.map((format) =>
            format === "ugc-ad"
              ? "formats/ugc-ads"
              : "formats/talking-head-ads",
          ),
          craft: [
            ...new Set(
              k.formats.flatMap(
                (format) =>
                  guideEntry(
                    format === "ugc-ad"
                      ? "formats/ugc-ads"
                      : "formats/talking-head-ads",
                  ).related,
              ),
            ),
          ],
          modelWriting: "models/prompt-writing",
          modelSpecific: false,
        },
        version: 1,
        validation: "candidate" as const,
        measuredTrials: 0,
      })),
    generated: false,
    evidenceBoundary:
      "Candidate wording, not measured model quality. Account-owned director-case records contain actual trials; they never automatically promote a kit or authorize generation.",
  };
}

export function renderDirectorKit(raw: unknown, mode: string) {
  const selection = directorKitSchema.parse(raw);
  const kit = kits.find((k) => k.id === selection.id)!;
  const image = mode === "text_to_image" || mode === "image_edit";
  if ((kit.kind === "image") !== image)
    throw new AppError(
      "DIRECTOR_KIT_MODE_MISMATCH",
      "Use the image kit for a boundary image and a video kit for video",
    );
  const recipes = kit.recipes as Readonly<Record<string, string>>;
  return {
    ...selection,
    validation: "candidate" as const,
    requirements: [...kit.requirements],
    text: [
      kit.fixed,
      recipes[selection.recipe],
      "Do not paint captions, promotional lettering or new logos into the generated scene. Preserve actual referenced markings on their objects. Add advertising overlays in composition.",
      ...(selection.id === "talking-head-v1"
        ? [`Speak this dialogue exactly:\n${selection.dialogue}`]
        : []),
    ].join("\n\n"),
  };
}

export function assertDirectorAudio(
  selection: unknown,
  parameters: Record<string, unknown>,
) {
  if (!selection) return;
  if (
    directorKitSchema.parse(selection).id === "talking-head-v1" &&
    parameters.generate_audio !== true
  )
    throw new AppError(
      "DIRECTOR_AUDIO_REQUIRED",
      "Talking-head direction requires a supported video profile with generate_audio=true. Select a compatible available profile; separate narration over silent footage does not establish lip-synchronized speech.",
    );
}
