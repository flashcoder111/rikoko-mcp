import type { AnalysisDetail } from "../../contracts/src/reference-analysis.js";

export type AnalysisSetting = AnalysisDetail | "auto";
export const analysisCommand = {
  name: "analysis",
  usage: "/analysis [overview | shots | recreate | auto]",
  description: "查看或切换账号默认分析精度；支持概览、逐镜头、复刻、自动",
} as const;
export const analysisSettingLabels: Record<AnalysisSetting, string> = {
  auto: "自动（一般分析逐镜头，用于复刻时详细展开）",
  overview: "概览",
  shots: "逐镜头",
  recreate: "复刻",
};
export function parseAnalysisSetting(
  argument: string,
): AnalysisSetting | undefined {
  const value = argument.trim().toLowerCase();
  if (!value) return undefined;
  const aliases: Record<string, AnalysisSetting> = {
    overview: "overview",
    概览: "overview",
    shots: "shots",
    逐镜头: "shots",
    recreate: "recreate",
    复刻: "recreate",
    auto: "auto",
    自动: "auto",
  };
  if (!Object.hasOwn(aliases, value))
    throw new Error(
      "请选择 overview（概览）、shots（逐镜头）、recreate（复刻）或 auto（自动）。",
    );
  return aliases[value];
}
