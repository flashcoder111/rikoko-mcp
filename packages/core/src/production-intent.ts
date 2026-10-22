import { z } from "zod";
import { AppError } from "../../contracts/src/index.js";

export const userRequirementSchema = z
  .object({
    id: z.string().trim().min(1).max(100),
    text: z.string().trim().min(1).max(5000),
    sourceTurn: z.number().int().nonnegative(),
    sourceQuote: z.string().trim().min(1).max(5000),
    preserve: z
      .array(z.enum(["action", "camera", "timing", "framing"]))
      .max(4)
      .default([]),
  })
  .strict();
export type UserRequirement = z.infer<typeof userRequirementSchema>;
export const creativeChoiceSchema = z
  .object({
    decision: z.string().trim().min(1).max(1000),
    reason: z.string().trim().min(1).max(1000),
  })
  .strict();

export function validateUserRequirements(
  requirements: UserRequirement[],
  turns: { message: string }[],
) {
  if (new Set(requirements.map((r) => r.id)).size !== requirements.length)
    throw new AppError(
      "INVALID_USER_REQUIREMENTS",
      "User requirement IDs must be unique",
    );
  for (const requirement of requirements) {
    if (
      !turns[requirement.sourceTurn]?.message.includes(requirement.sourceQuote)
    )
      throw new AppError(
        "USER_REQUIREMENT_EVIDENCE_REQUIRED",
        "Each user requirement needs an exact quote from its saved user turn. Agent choices belong in plan.creativeChoices, not user requirements.",
        409,
      );
  }
}

export function assertUserPreservation(
  requirements: UserRequirement[],
  method?: { relationship: string; preserve: string[] },
) {
  const required = [...new Set(requirements.flatMap((r) => r.preserve))];
  if (
    required.length &&
    (!method ||
      method.relationship === "reinterpret" ||
      (method.relationship !== "edit_source" &&
        required.some((p) => !method.preserve.includes(p))))
  )
    throw new AppError(
      "USER_PRESERVATION_CONFLICT",
      "The plan drops a user-preserved property. Keep the requirement; clarify only if fulfilling it requires changing the user's goal.",
      409,
    );
}

export function intentNotice(
  requirements: UserRequirement[],
  choices: { decision: string; reason: string }[] = [],
) {
  return {
    mode: "inform_and_continue" as const,
    requiresConfirmation: false,
    userRequirements: requirements,
    creativeChoices: choices,
    instruction:
      "Briefly tell the user what must stay, what will change and your creative approach before execution. Continue within the existing authorization; this is not an approval checkpoint. Ask only about material ambiguity, changing a user requirement, unavailable model/account, or spending beyond authorization. Do not present your choices as user instructions. Source quotes are host-recorded evidence, not independently authenticated consent.",
  };
}
