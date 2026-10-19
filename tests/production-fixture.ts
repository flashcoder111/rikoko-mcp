import { callTool } from "../packages/mcp/src/tools.js";
import type { Service } from "../packages/core/src/index.js";
import type { Context } from "../packages/contracts/src/index.js";

/** Bind externally supplied fixture media to a real scope after its source review. */
export async function scopeFixture(
  service: Service,
  c: Context,
  projectId: string,
  assetId: string,
  width: number,
  height: number,
  shotId: string,
) {
  const saved: any = await callTool(service, c, "production_plan_save", {
    plan: {
      title: "Contract fixture",
      width,
      height,
      shots: [
        {
          id: shotId,
          initialState: { chart: "visible" },
          action: "Hold chart",
          endState: { chart: "visible" },
        },
      ],
    },
  });
  await callTool(service, c, "production_scope_save", {
    projectId,
    planId: saved.id,
    expectedPlanVersion: 1,
    expectedScopeVersion: 0,
    requirements: { allowedAssetUses: ["external"] },
  });
  await callTool(service, c, "production_asset_assign", {
    projectId,
    expectedScopeVersion: 1,
    shotId,
    assetId,
    use: "external",
    notes: "Reviewed synthetic fixture",
  });
}
