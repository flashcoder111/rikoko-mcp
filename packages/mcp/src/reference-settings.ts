import { z } from "zod";
import type { Context } from "../../contracts/src/index.js";
import type { AnalysisDetail } from "../../contracts/src/reference-analysis.js";
import type { Service } from "../../core/src/index.js";

const settingSchema = z.enum(["auto", "overview", "shots", "recreate"]);
export const analysisSettingsSchema = z
  .object({ detail: settingSchema.optional() })
  .strict();

/** A default for future inputs only: existing quotes, plans and jobs retain their resolved detail. */
export async function analysisSettings(
  service: Service,
  c: Context,
  raw: unknown,
) {
  const input = analysisSettingsSchema.parse(raw);
  return service.scoped(
    c,
    input.detail === undefined ? "read" : "write",
    async (tx) => {
      const id = `analysis-settings-${c.accountId}`;
      const previous = await tx.get(id, c.accountId, "analysis-settings");
      if (input.detail !== undefined)
        await tx.put({
          id,
          accountId: c.accountId,
          type: "analysis-settings",
          createdAt: previous?.createdAt ?? new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          detail: input.detail,
        });
      const detail = settingSchema.parse(
        input.detail ?? previous?.detail ?? "auto",
      );
      return {
        detail,
        scope: "account" as const,
        defaultDetail: detail === "auto" ? "shots" : detail,
        remakeDetail: detail === "auto" ? "recreate" : detail,
        submitted: false,
      };
    },
  );
}
export async function resolveAnalysisDetail(
  service: Service,
  c: Context,
  input: { detail?: AnalysisDetail; purpose?: string },
): Promise<AnalysisDetail> {
  if (input.detail) return input.detail;
  const { detail } = await analysisSettings(service, c, {});
  return detail === "auto"
    ? input.purpose === "remake"
      ? "recreate"
      : "shots"
    : detail;
}
