import { z } from "zod";
import { referenceAnalysisProtocol } from "../../contracts/src/reference-analysis.js";

const protocolSchema = z.object({
  version: z.literal(referenceAnalysisProtocol.version),
  reportSchemaVersion: z.literal(referenceAnalysisProtocol.reportSchemaVersion),
  details: z.array(z.string()).max(20),
  focus: z.array(z.string()).max(20),
});

export function compatibleAnalysisProtocol(value: unknown) {
  const parsed = protocolSchema.safeParse(value);
  return (
    parsed.success &&
    referenceAnalysisProtocol.details.every((detail) =>
      parsed.data.details.includes(detail),
    ) &&
    referenceAnalysisProtocol.focus.every((focus) =>
      parsed.data.focus.includes(focus),
    )
  );
}

export const analysisProtocolMessage =
  "Cloud reference analysis protocol is incompatible with this client (detail/focus and report schema v2 required). Upgrade the official cloud runtime and reconnect. Do not remove analysis fields, retry unchanged requests, or bypass analysis to generate a remake.";
