import { randomUUID } from "node:crypto";
import type { Context, Entity } from "../packages/contracts/src/index.js";
import type { Service } from "../packages/core/src/index.js";
import { callTool } from "../packages/mcp/src/tools.js";

/** Synthetic evidence for contract tests only; never a claim about actual generated pixels. */
export async function acceptFixtureImage(
  service: Service,
  c: Context,
  asset: Entity,
  production?: { projectId: string; scopeVersion: number; shotId: string },
) {
  const id = randomUUID();
  await service.scoped(c, "write", (tx) =>
    tx.put({
      id,
      type: "media-inspection",
      accountId: c.accountId,
      createdAt: new Date().toISOString(),
      assetId: asset.id,
      sourceSha256: asset.sha256,
      frames: [{ sourceTimeMs: 0 }],
    }),
  );
  return callTool(service, c, "media_review", {
    ...(production ? { production } : {}),
    assetId: asset.id,
    inspectionIds: [id],
    reviewer: "host_agent",
    decision: "accepted",
    checks: {
      actionComplete: {
        status: "not_applicable",
        reason: "Synthetic still image fixture",
      },
      framing: true,
      continuity: true,
      noArtifacts: true,
    },
    notes:
      "Synthetic hash-bound quick-image acceptance for automated contract testing only.",
  });
}
