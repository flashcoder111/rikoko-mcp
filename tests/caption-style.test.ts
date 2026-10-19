import { describe, expect, it } from "vitest";
import {
  compositionSchema,
  operationSchema,
  type Entity,
} from "../packages/contracts/src/index.js";
import {
  captionStylePatchSchema,
  resolveCaptionStyle,
} from "../packages/contracts/src/caption-style.js";
import {
  prepareCaptionStyle,
  parseCaptionDescription,
} from "../packages/core/src/caption-style.js";
import { applyEdits } from "../packages/core/src/editing.js";
import { planRequest } from "../packages/core/src/workspace-planner.js";
import { srt } from "../packages/render/src/index.js";

const base = () =>
  compositionSchema.parse({
    schemaVersion: 1,
    title: "Caption styling",
    width: 360,
    height: 640,
    language: "zh",
    scenes: [
      {
        id: "s",
        text: "你好世界",
        durationMs: 2000,
        audioAssetId: "voice",
        speechAlignment: {
          sourceAssetId: "voice",
          transcriptAssetId: "transcript",
        },
        words: [{ id: "w", text: "你好世界", startMs: 200, endMs: 1500 }],
      },
    ],
    captionStyle: { fontSize: 40, color: "#abcdef", background: "#123456" },
  });
describe("subtitle style contracts", () => {
  it("keeps omitted edit properties absent and preserves old appearance and speech timing", () => {
    expect(captionStylePatchSchema.parse({ fontWeight: 700 })).toEqual({
      fontWeight: 700,
    });
    expect(captionStylePatchSchema.parse({})).toEqual({});
    const old = base();
    const next = applyEdits(old, [
      {
        type: "style",
        fontFamily: "noto-serif-sc",
        fontWeight: 700,
        strokeWidth: 2,
        shadowOpacity: 0.7,
      },
    ]);
    expect(next.captionStyle).toMatchObject({
      ...old.captionStyle,
      fontWeight: 700,
    });
    expect(next.scenes).toEqual(old.scenes);
    expect(srt(next)).toBe(srt(old));
    expect(old.captionStyle).not.toHaveProperty("fontWeight");
    expect(resolveCaptionStyle(old.captionStyle)).toMatchObject({
      fontFamily: "system",
      strokeWidth: 0,
      shadowOpacity: 0,
    });
  });
  it.each([
    { fontFamily: "../../secret" },
    { fontWeight: 999 },
    { strokeWidth: 1000 },
    { shadowBlur: -1 },
    { shadowOpacity: 2 },
    { color: "red;url()" },
    { shadowOffsetX: Infinity },
  ])("rejects unsafe or unbounded effects %j", (style) => {
    expect(captionStylePatchSchema.safeParse(style).success).toBe(false);
  });
  it("accepts identical effects for captions-only operations", () => {
    const style = {
      fontFamily: "noto-sans-sc",
      fontWeight: 600,
      strokeWidth: 2,
      strokeColor: "#111111",
      shadowOpacity: 0.5,
    };
    expect(
      operationSchema.parse({
        kind: "captions",
        assetId: "video",
        transcript: {
          schemaVersion: 1,
          language: "zh",
          durationMs: 1000,
          words: [],
          evidence: "precomputed",
        },
        style,
      }),
    ).toMatchObject({ style });
  });
});

describe("text and reference style selection", () => {
  it("respects grouped negations and Chinese list punctuation", () => {
    const result = prepareCaptionStyle({
      description: "参考视频没有字幕，字幕用白色黑体加粗、不要描边和阴影",
    });
    expect(result.unmatched).toEqual([]);
    expect(result.style).toMatchObject({
      fontFamily: "noto-sans-sc",
      fontWeight: 700,
      color: "#ffffff",
      strokeWidth: 0,
      shadowOpacity: 0,
    });
  });
  it("uses text only when a reference has no subtitles, with explicit effect removals", () => {
    const result = prepareCaptionStyle({
      description:
        "参考视频没有字幕，电影感，宋体，白字，细描边，轻微阴影，无底框",
    });
    expect(result.unmatched).toEqual([]);
    expect(result.style).toMatchObject({
      fontFamily: "noto-serif-sc",
      color: "#ffffff",
      strokeWidth: 1,
      backgroundOpacity: 0,
      shadowOpacity: 0.5,
    });
    expect(result.fontRecognition).toBe(false);
    const disabled = prepareCaptionStyle({
      currentStyle: result.style,
      description: "不要描边，关闭阴影",
    });
    expect(disabled.style).toMatchObject({
      strokeWidth: 0,
      shadowOpacity: 0,
      fontFamily: "noto-serif-sc",
    });
  });
  it("uses video visual style without copying speech or text; user instructions and overrides win", () => {
    const result = prepareCaptionStyle({
      referenceStyle: "Warm, gentle film with no subtitles",
      description: "黑体加粗，白字，无描边",
      overrides: { shadowOpacity: 0.2 },
    });
    expect(result.preset).toBe("cinematic");
    expect(result.style).toMatchObject({
      fontFamily: "noto-sans-sc",
      fontWeight: 700,
      color: "#ffffff",
      strokeWidth: 0,
      shadowOpacity: 0.2,
    });
  });
  it("reports unknown instructions instead of silently claiming complete interpretation", () => {
    const parsed = parseCaptionDescription("黑体，逐字跳动");
    expect(parsed.unmatched).toEqual(["逐字跳动"]);
    expect(
      prepareCaptionStyle({ description: "让字幕像星云一样流动" }).matched,
    ).toBe(false);
  });
  it("handles a multi-clause chat instruction as one style edit without replacing subtitle text", async () => {
    const revision: Entity = {
      id: "r",
      type: "revision",
      accountId: "a",
      createdAt: "now",
      composition: base(),
    };
    const result = await planRequest(
      {
        message: "字幕字体改为宋体，字重 700，描边 2px，关闭阴影",
        assetIds: [],
      },
      revision,
      [],
    );
    expect(result.engine).toBe("local-commands");
    if (result.action?.type !== "edit") throw Error("No edit");
    const next = applyEdits(base(), result.action.edits);
    expect(next.captionStyle).toMatchObject({
      fontFamily: "noto-serif-sc",
      fontWeight: 700,
      strokeWidth: 2,
      shadowOpacity: 0,
      color: "#abcdef",
      fontSize: 40,
    });
    expect(next.scenes).toEqual(base().scenes);
    const partial = await planRequest(
      { message: "字体用宋体，帮我拍海滩", assetIds: [] },
      revision,
      [],
    );
    expect(partial.action).toBeUndefined();
    const literal = await planRequest(
      { message: "字幕改成：宋体加粗", assetIds: [] },
      revision,
      [],
    );
    expect(literal.action).toMatchObject({
      edits: [{ type: "caption", text: "宋体加粗" }],
    });
  });
});
