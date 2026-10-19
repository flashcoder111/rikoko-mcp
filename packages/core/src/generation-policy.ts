import { AppError, type Operation } from "../../contracts/src/index.js";

/** Server policy, never a host-supplied per-request bypass. */
export function requireGenerationPreparation(
  input: Operation,
  modelKind: string,
  allowLegacy: boolean,
  preparing = false,
) {
  if (input.kind !== "generate" || modelKind !== "video" || allowLegacy) return;
  if (!preparing && input.references?.length && !input.preparedRequestId)
    throw new AppError(
      "GENERATION_PREPARATION_REQUIRED",
      "Reference video generation requires generation_prepare before quotation or submission",
      409,
    );
  if (!input.target)
    throw new AppError(
      "GENERATION_TARGET_REQUIRED",
      "Supply target dimensions or prepare with a saved target plan; never infer the user's canvas from a provider default",
      409,
    );
}
