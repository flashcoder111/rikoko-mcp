import {
  captionPresets,
  captionStyleSchema,
  captionStylePatchSchema,
  type CaptionStyle,
  type CaptionStylePatch,
  type CaptionPreset,
} from "../../contracts/src/caption-style.js";

const moods: [CaptionPreset, RegExp][] = [
  ["cinematic", /电影|复古|文艺|纪录片|cinema|film\b|vintage|documentary/i],
  ["bold", /醒目|有力|运动|活泼|动感|快节奏|energetic|sport|punchy|bold/i],
  ["soft", /柔和|温暖|治愈|温馨|soft|warm|gentle/i],
  ["clean", /简洁|清晰|科技|商务|正式|极简|clean|minimal|tech|corporate/i],
];
export function captionPresetFor(
  description: string,
): CaptionPreset | undefined {
  return moods.find(([, pattern]) => pattern.test(description))?.[0];
}
const colors: Record<string, string> = {
  白: "#ffffff",
  黑: "#000000",
  黄: "#ffe24a",
  红: "#ef4444",
  蓝: "#60a5fa",
  white: "#ffffff",
  black: "#000000",
  yellow: "#ffe24a",
  red: "#ef4444",
  blue: "#60a5fa",
};
const colorToken =
  "(#[0-9a-fA-F]{6}|白色?|黑色?|黄色?|红色?|蓝色?|white|black|yellow|red|blue)";
const colorValue = (v: string) =>
  v.startsWith("#") ? v : colors[v.toLowerCase().replace(/色$/, "")];

/** Bounded local vocabulary. Unmatched clauses are reported, never silently executed in chat. */
export function parseCaptionDescription(description: string) {
  const patch: CaptionStylePatch = {};
  const unmatched: string[] = [];
  let preset: CaptionPreset | undefined;
  const normalized = description.replace(
    /(?:不要|不加|无|去掉|关闭)(?:描边[和与及、]阴影|阴影[和与及、]描边)/g,
    "无描边，无阴影",
  );
  for (const original of normalized
    .split(/[，,、；;。\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)) {
    // This is context, not permission to invent subtitles or timing.
    if (/^(?:参考)?视频(?:里|中)?(?:没有|无)字幕$/.test(original)) continue;
    if (
      /^(?:根据|参考)(?:这个|这段|参考)?视频的?(?:整体|视觉)?风格$/.test(
        original,
      )
    )
      continue;
    let text = original;
    const take = (pattern: RegExp, apply: (m: RegExpExecArray) => void) => {
      text = text.replace(pattern, (...args: unknown[]) => {
        apply(args as unknown as RegExpExecArray);
        return " ";
      });
    };
    take(/(?:不加粗|不要加粗|正常粗细|常规|regular)/gi, () => {
      patch.fontWeight = 400;
    });
    take(/(?:细体|light)/gi, () => {
      patch.fontWeight = 300;
    });
    take(/(?:半粗|semibold)/gi, () => {
      patch.fontWeight = 600;
    });
    take(/(?:加粗|粗体|bold)/gi, () => {
      patch.fontWeight = 700;
    });
    take(
      /(?:字重|font\s*weight)\s*[:：=]?\s*(300|400|500|600|700)\b/gi,
      (m) => {
        patch.fontWeight = Number(m[1]) as CaptionStyle["fontWeight"];
      },
    );
    take(/(?:思源)?黑体|noto\s*sans(?:\s*sc)?|sans(?:-serif)?/gi, () => {
      patch.fontFamily = "noto-sans-sc";
    });
    take(/(?:思源)?宋体|noto\s*serif(?:\s*sc)?|serif/gi, () => {
      patch.fontFamily = "noto-serif-sc";
    });
    take(/(?:原有|系统|默认)字体/gi, () => {
      patch.fontFamily = "system";
    });
    take(
      /(?:不要|不加|无|去掉|关闭)描边|(?:no|without)\s+(?:stroke|outline)/gi,
      () => {
        patch.strokeWidth = 0;
      },
    );
    take(/(?:不要|不加|无|去掉|关闭)阴影|(?:no|without)\s+shadow/gi, () => {
      patch.shadowOpacity = 0;
    });
    take(
      /(?:不要|无|去掉|关闭)(?:底框|底色|背景)|透明(?:底框|底色|背景)|(?:no|without)\s+background/gi,
      () => {
        patch.backgroundOpacity = 0;
      },
    );
    for (const [target, field] of [
      ["描边|轮廓|stroke|outline", "strokeColor"],
      ["阴影|shadow", "shadowColor"],
      ["底框|底色|背景|background", "background"],
      ["文字|字幕|字|text", "color"],
    ] as const) {
      const apply = (v: string) => {
        patch[field] = colorValue(v);
        if (field === "strokeColor" && patch.strokeWidth === undefined)
          patch.strokeWidth = 1;
        if (field === "shadowColor" && patch.shadowOpacity === undefined)
          patch.shadowOpacity = 0.65;
        if (field === "background" && patch.backgroundOpacity === undefined)
          patch.backgroundOpacity = 0.8;
      };
      take(new RegExp(`${colorToken}\\s*(?:的)?(?:${target})`, "gi"), (m) =>
        apply(m[1]),
      );
      take(
        new RegExp(
          `(?:${target})(?:颜色)?\\s*(?:设为|改为|为|是|用|[:：=])?\\s*${colorToken}`,
          "gi",
        ),
        (m) => apply(m[1]),
      );
    }
    take(
      /(?:描边|stroke|outline)(?:宽度)?\s*[:：=]?\s*(\d+(?:\.\d+)?)\s*(?:px|像素)?/gi,
      (m) => {
        patch.strokeWidth = Number(m[1]);
      },
    );
    take(/(\d+(?:\.\d+)?)\s*(?:px|像素)\s*描边/gi, (m) => {
      patch.strokeWidth = Number(m[1]);
    });
    take(
      /(?:字号|font\s*size)\s*(?:设为|改为|为|[:：=])?\s*(\d+)\s*(?:px|像素)?/gi,
      (m) => {
        patch.fontSize = Number(m[1]);
      },
    );
    take(
      /(?:阴影不透明度|shadow\s*opacity)\s*[:：=]?\s*(\d+(?:\.\d+)?)/gi,
      (m) => {
        patch.shadowOpacity = Number(m[1]);
      },
    );
    take(
      /(?:底色不透明度|背景不透明度|background\s*opacity)\s*[:：=]?\s*(\d+(?:\.\d+)?)/gi,
      (m) => {
        patch.backgroundOpacity = Number(m[1]);
      },
    );
    take(
      /(?:阴影模糊|shadow\s*blur)\s*[:：=]?\s*(\d+(?:\.\d+)?)\s*(?:px|像素)?/gi,
      (m) => {
        patch.shadowBlur = Number(m[1]);
      },
    );
    take(/(?:轻微|柔和|淡淡的?|轻)?阴影|soft\s+shadow/gi, () => {
      patch.shadowOpacity ??= 0.5;
      patch.shadowBlur ??= 4;
    });
    take(/(?:细)?描边/gi, () => {
      patch.strokeWidth ??= 1;
    });
    for (const [name, pattern] of moods) {
      if (pattern.test(text)) {
        preset = name;
        text = text.replace(new RegExp(pattern.source, "gi"), " ");
      }
    }
    text = text.replace(
      /(?:请|帮我|把|设置|使用|采用|选择|加上|添加|增加|调整|调成|改成|改为|设为|字幕样式|字幕风格|字体|字幕|文字|风格|感觉|一些|一点|的|感|且|和|并|要|用)|\b(?:please|use|add|set|font|captions?|subtitles?|style|and|to)\b|[\s:：=！!]/gi,
      "",
    );
    if (text) unmatched.push(original);
  }
  return { patch: captionStylePatchSchema.parse(patch), preset, unmatched };
}

export function prepareCaptionStyle(input: {
  description?: string;
  referenceStyle?: string;
  preset?: CaptionPreset;
  currentStyle?: CaptionStyle;
  overrides?: CaptionStylePatch;
}) {
  const parsed = parseCaptionDescription(input.description ?? "");
  const referencePreset = captionPresetFor(input.referenceStyle ?? "");
  const preset = input.preset ?? parsed.preset ?? referencePreset;
  const style = captionStyleSchema.parse({
    ...captionStyleSchema.parse(input.currentStyle ?? {}),
    ...(preset ? captionPresets[preset].style : {}),
    ...parsed.patch,
    ...captionStylePatchSchema.parse(input.overrides ?? {}),
  });
  return {
    style,
    edit: { type: "style" as const, ...style },
    preset: preset ?? null,
    method: "local-style-rules" as const,
    matched:
      !!preset ||
      Object.keys(parsed.patch).length > 0 ||
      Object.keys(input.overrides ?? {}).length > 0,
    unmatched: parsed.unmatched,
    message: parsed.unmatched.length
      ? `部分描述尚未识别：${parsed.unmatched.join("；")}。请检查预览并手动补充设置。`
      : preset
        ? `已按「${captionPresets[preset].label}」准备样式，文字中的具体设置优先。`
        : "已准备字幕样式。",
    fontRecognition: false,
  };
}
