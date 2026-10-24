import { AppError, type Operation } from "../../contracts/src/index.js";

/** Server policy, never a host-supplied per-request bypass. */
export function requireGenerationPreparation(
  input: Operation,
  modelKind: string,
  allowLegacy: boolean,
  preparing = false,
) {
  if (input.kind !== "generate" || modelKind !== "video") return;
  if (!input.target && !allowLegacy)
    throw new AppError(
      "GENERATION_TARGET_REQUIRED",
      "Supply target dimensions or prepare with a saved target plan; never infer the user's canvas from a provider default",
      409,
    );
  if (!preparing && !input.preparedRequestId)
    throw new AppError(
      "GENERATION_PREPARATION_REQUIRED",
      "Video generation requires generation_prepare before quotation or submission",
      409,
    );
}
