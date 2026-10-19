import { z } from "zod";

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const captionFonts = [
  {
    id: "system",
    label: "原有默认字体",
    css: '"PingFang SC", "Noto Sans CJK SC", sans-serif',
  },
  {
    id: "noto-sans-sc",
    label: "思源黑体 · Noto Sans SC",
    css: '"Rikoko Sans", sans-serif',
    file: "NotoSansSC.ttf",
  },
  {
    id: "noto-serif-sc",
    label: "思源宋体 · Noto Serif SC",
    css: '"Rikoko Serif", serif',
    file: "NotoSerifSC.ttf",
  },
] as const;
export const captionStyleSchema = z
  .object({
    fontSize: z.number().int().min(12).max(96).default(28),
    color: color.default("#ffffff"),
    background: color.default("#151a22"),
    // Optional fields preserve existing compositions and their default appearance.
    fontFamily: z.enum(["system", "noto-sans-sc", "noto-serif-sc"]).optional(),
    fontWeight: z
      .union([
        z.literal(300),
        z.literal(400),
        z.literal(500),
        z.literal(600),
        z.literal(700),
      ])
      .optional(),
    backgroundOpacity: z.number().min(0).max(1).optional(),
    strokeWidth: z.number().int().min(0).max(8).optional(),
    strokeColor: color.optional(),
    shadowColor: color.optional(),
    shadowOpacity: z.number().min(0).max(1).optional(),
    shadowBlur: z.number().min(0).max(20).optional(),
    shadowOffsetX: z.number().min(-20).max(20).optional(),
    shadowOffsetY: z.number().min(-20).max(20).optional(),
  })
  .strict();
// Zod optional(default(...)) still inserts defaults. Edits must preserve omitted fields.
export const captionStylePatchSchema = captionStyleSchema.partial().extend({
  fontSize: captionStyleSchema.shape.fontSize.removeDefault().optional(),
  color: captionStyleSchema.shape.color.removeDefault().optional(),
  background: captionStyleSchema.shape.background.removeDefault().optional(),
});
export type CaptionStyle = z.infer<typeof captionStyleSchema>;
export type CaptionStylePatch = z.infer<typeof captionStylePatchSchema>;

export function resolveCaptionStyle(style: CaptionStyle) {
  const resolved = {
    ...style,
    fontFamily: style.fontFamily ?? "system",
    fontWeight: style.fontWeight ?? 400,
    backgroundOpacity: style.backgroundOpacity ?? 238 / 255,
    strokeWidth: style.strokeWidth ?? 0,
    strokeColor: style.strokeColor ?? "#000000",
    shadowColor: style.shadowColor ?? "#000000",
    shadowOpacity: style.shadowOpacity ?? 0,
    shadowBlur: style.shadowBlur ?? 4,
    shadowOffsetX: style.shadowOffsetX ?? 0,
    shadowOffsetY: style.shadowOffsetY ?? 2,
  };
  // The legacy platform font has no portable weight mapping. A weight change
  // opts into the bundled sans family so preview and export use real weights.
  if (resolved.fontFamily === "system" && resolved.fontWeight !== 400)
    resolved.fontFamily = "noto-sans-sc";
  return resolved;
}

export const captionPresets = {
  clean: {
    label: "简洁清晰",
    style: {
      fontFamily: "noto-sans-sc",
      fontWeight: 400,
      fontSize: 28,
      color: "#ffffff",
      background: "#151a22",
      backgroundOpacity: 0.8,
      strokeWidth: 0,
      shadowOpacity: 0,
    },
  },
  cinematic: {
    label: "电影感",
    style: {
      fontFamily: "noto-serif-sc",
      fontWeight: 500,
      fontSize: 28,
      color: "#fff7e8",
      backgroundOpacity: 0,
      strokeWidth: 1,
      strokeColor: "#171717",
      shadowColor: "#000000",
      shadowOpacity: 0.75,
      shadowBlur: 4,
      shadowOffsetX: 0,
      shadowOffsetY: 2,
    },
  },
  bold: {
    label: "醒目有力",
    style: {
      fontFamily: "noto-sans-sc",
      fontWeight: 700,
      fontSize: 36,
      color: "#ffe24a",
      backgroundOpacity: 0,
      strokeWidth: 2,
      strokeColor: "#111111",
      shadowColor: "#000000",
      shadowOpacity: 0.7,
      shadowBlur: 2,
      shadowOffsetX: 2,
      shadowOffsetY: 3,
    },
  },
  soft: {
    label: "柔和温暖",
    style: {
      fontFamily: "noto-serif-sc",
      fontWeight: 400,
      fontSize: 28,
      color: "#fff7ed",
      background: "#4b3832",
      backgroundOpacity: 0.65,
      strokeWidth: 0,
      shadowOpacity: 0,
    },
  },
} as const satisfies Record<
  string,
  { label: string; style: CaptionStylePatch }
>;
export type CaptionPreset = keyof typeof captionPresets;
