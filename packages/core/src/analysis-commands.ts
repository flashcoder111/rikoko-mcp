import type { AnalysisDetail } from "../../contracts/src/reference-analysis.js";

export type AnalysisSetting = AnalysisDetail | "auto";
export const analysisCommand = {
  name: "analysis",
  usage: "/analysis [overview | shots | recreate | auto]",
  description:
    "View or change the account's default analysis detail: overview, shots, recreate or auto",
} as const;
export const analysisSettingLabels: Record<AnalysisSetting, string> = {
  auto: "Auto (shot breakdown for analysis, full detail for recreation)",
  overview: "Overview",
  shots: "Shot breakdown",
  recreate: "Recreation",
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
    throw new Error("Choose overview, shots, recreate or auto.");
  return aliases[value];
}
