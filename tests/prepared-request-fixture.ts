import { callTool as runtimeTool } from "../packages/mcp/src/tools.js";
/** Existing compiler/transport tests now record their fixture brief explicitly. */
export async function callTool(service: any, c: any, name: any, raw: any) {
  if (name === "generation_prepare" && !raw.request) {
    const plan = raw.plan
      ? await service.get(c, "production-plan", raw.plan.planId)
      : undefined;
    if (!plan?.requestBinding) {
      const request: any = await runtimeTool(
        service,
        c,
        "workspace_request_save",
        {
          message: raw.input.prompt || "Fixture video",
          assetIds: (raw.input.references ?? []).map((r: any) => r.assetId),
        },
      );
      raw = {
        ...raw,
        request: {
          requestId: request.requestId,
          expectedVersion: request.requestVersion,
        },
      };
    }
  }
  return runtimeTool(service, c, name, raw);
}
