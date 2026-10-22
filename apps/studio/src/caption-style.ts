import type { CSSProperties } from "react";
import {
  captionFonts,
  resolveCaptionStyle,
  type CaptionStyle,
} from "../../../packages/contracts/src/caption-style.js";
import "./caption-fonts.css";

export function captionCss(value: CaptionStyle, scale = 1): CSSProperties {
  const style = resolveCaptionStyle(value);
  const alpha = (color: string, opacity: number) =>
    `${color}${Math.round(opacity * 255)
      .toString(16)
      .padStart(2, "0")}`;
  return {
    fontFamily: captionFonts.find((f) => f.id === style.fontFamily)!.css,
    fontWeight: style.fontWeight,
    fontSize: style.fontSize * scale,
    color: style.color,
    backgroundColor: alpha(style.background, style.backgroundOpacity),
    WebkitTextStroke: `${style.strokeWidth * 2 * scale}px ${style.strokeColor}`,
    paintOrder: "stroke fill",
    textShadow: style.shadowOpacity
      ? `${style.shadowOffsetX * scale}px ${style.shadowOffsetY * scale}px ${style.shadowBlur * scale}px ${alpha(style.shadowColor, style.shadowOpacity)}`
      : "none",
    lineHeight: `${(style.fontSize + 8 + style.strokeWidth * 2) * scale}px`,
    overflowWrap: "anywhere",
  };
}
