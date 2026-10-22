import React, { useEffect, useRef, useState } from "react";
import {
  captionFonts,
  captionPresets,
  resolveCaptionStyle,
  type CaptionStyle,
  type CaptionStylePatch,
  type CaptionPreset,
} from "../../../packages/contracts/src/caption-style.js";
import type { Entity } from "../../../packages/contracts/src/index.js";
import { api } from "./api";
import { captionCss } from "./caption-style";

function StyleNumberInput({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const valid = (n: number) =>
    Number.isFinite(n) &&
    n >= min &&
    n <= max &&
    (step !== 1 || Number.isInteger(n));
  return (
    <input
      aria-label={label}
      type="number"
      min={min}
      max={max}
      step={step}
      value={draft}
      onChange={(e) => {
        setDraft(e.currentTarget.value);
        const n = e.currentTarget.valueAsNumber;
        if (valid(n)) onChange(n);
      }}
      onBlur={() => {
        if (!draft.trim() || !valid(Number(draft))) setDraft(String(value));
      }}
    />
  );
}

export default function CaptionStyleControls({
  style,
  assets,
  onChange,
}: {
  style: CaptionStyle;
  assets: Entity[];
  onChange: (patch: CaptionStylePatch) => void;
}) {
  const current = resolveCaptionStyle(style);
  const [description, setDescription] = useState("");
  const [analysisAssetId, setAnalysisAssetId] = useState("");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const request = useRef(0);
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );
  async function suggest() {
    const version = ++request.current;
    setPending(true);
    setNotice("");
    try {
      const result = await api<{
        style: CaptionStyle;
        matched: boolean;
        unmatched: string[];
        message: string;
      }>("caption_style_prepare", {
        description,
        currentStyle: style,
        ...(analysisAssetId ? { analysisAssetId } : {}),
      });
      if (version !== request.current) return;
      if (result.matched && !result.unmatched.length) {
        onChange(result.style);
        setNotice(`${result.message} 保存作品后会应用到导出视频。`);
      } else
        setNotice(
          result.unmatched.length
            ? result.message
            : "暂未匹配到样式，请选择预设或直接调整下方设置。",
        );
    } catch (error) {
      if (version === request.current) setNotice((error as Error).message);
    } finally {
      if (version === request.current) setPending(false);
    }
  }
  const number = (
    key: keyof CaptionStyle,
    label: string,
    min: number,
    max: number,
    step = 1,
  ) => (
    <label key={key}>
      {label}
      <StyleNumberInput
        label={label}
        min={min}
        max={max}
        step={step}
        value={Number(current[key])}
        onChange={(n) => onChange({ [key]: n })}
      />
    </label>
  );
  const color = (
    key: "color" | "background" | "strokeColor" | "shadowColor",
    label: string,
  ) => (
    <label key={key}>
      {label}
      <input
        aria-label={label}
        type="color"
        value={current[key]}
        onChange={(e) => onChange({ [key]: e.currentTarget.value })}
      />
    </label>
  );
  return (
    <fieldset className="caption-style-controls" disabled={pending}>
      <p className="caption-style-hint">
        样式应用于整个作品。参考视频没有字幕，也可以只描述你想要的效果。
      </p>
      <label>
        样式预设
        <select
          aria-label="字幕样式预设"
          value=""
          onChange={(e) => {
            if (e.target.value)
              onChange(captionPresets[e.target.value as CaptionPreset].style);
          }}
        >
          <option value="">选择预设…</option>
          {Object.entries(captionPresets).map(([id, preset]) => (
            <option key={id} value={id}>
              {preset.label}
            </option>
          ))}
        </select>
      </label>
      <div className="caption-style-sample">
        <span style={captionCss(style, 0.7)}>字幕预览 Aa 你好</span>
      </div>
      <label>
        字体
        <select
          aria-label="字幕字体"
          value={current.fontFamily}
          onChange={(e) =>
            onChange({
              fontFamily: e.target.value as CaptionStyle["fontFamily"],
            })
          }
        >
          {captionFonts.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
      </label>
      {current.fontFamily === "system" && (
        <small>调整粗细时使用内置黑体，保证预览和导出都有对应字重。</small>
      )}
      <div className="input-pair">
        <label>
          粗细
          <select
            aria-label="字幕粗细"
            value={current.fontWeight}
            onChange={(e) =>
              onChange({
                fontWeight: Number(
                  e.target.value,
                ) as CaptionStyle["fontWeight"],
              })
            }
          >
            {(
              [
                [300, "细"],
                [400, "常规"],
                [500, "中等"],
                [600, "半粗"],
                [700, "粗体"],
              ] as const
            ).map(([weight, label]) => (
              <option value={weight} key={weight}>
                {label} · {weight}
              </option>
            ))}
          </select>
        </label>
        {number("fontSize", "字幕字号", 12, 96)}
        {color("color", "字幕文字颜色")}
        {color("background", "字幕底色")}
        {number("backgroundOpacity", "底色不透明度", 0, 1, 0.05)}
      </div>
      <details open>
        <summary>描边</summary>
        <div className="input-pair">
          {number("strokeWidth", "描边宽度", 0, 8)}
          {color("strokeColor", "描边颜色")}
        </div>
        <small>宽度为 0 时关闭描边。</small>
      </details>
      <details>
        <summary>阴影</summary>
        <div className="input-pair">
          {number("shadowOpacity", "阴影不透明度", 0, 1, 0.05)}
          {color("shadowColor", "阴影颜色")}
          {number("shadowBlur", "阴影模糊", 0, 20)}
          {number("shadowOffsetX", "阴影水平偏移", -20, 20)}
          {number("shadowOffsetY", "阴影垂直偏移", -20, 20)}
        </div>
        <small>不透明度为 0 时关闭阴影。</small>
      </details>
      <details className="caption-style-suggest">
        <summary>按描述或参考匹配样式</summary>
        <label>
          描述字幕样式
          <textarea
            aria-label="描述字幕样式"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="例如：电影感，宋体，白字，细描边，轻微阴影，无底框"
          />
        </label>
        <label>
          参考视频分析（可选）
          <select
            aria-label="字幕样式参考分析"
            value={analysisAssetId}
            onChange={(e) => setAnalysisAssetId(e.target.value)}
          >
            <option value="">只使用文字描述</option>
            {assets
              .filter((a) => a.kind === "analysis")
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name ?? a.id}
                </option>
              ))}
          </select>
        </label>
        <button
          type="button"
          className="wide"
          disabled={!description.trim() && !analysisAssetId}
          onClick={() => void suggest()}
        >
          {pending ? "准备样式…" : "根据描述 / 参考预览样式"}
        </button>
        {notice && (
          <p className="caption-style-hint" role="status">
            {notice}
          </p>
        )}
      </details>
    </fieldset>
  );
}
