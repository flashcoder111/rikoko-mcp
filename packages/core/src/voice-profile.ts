import {
  AppError,
  voiceCloneSchema,
  type Entity,
  type Operation,
} from "../../contracts/src/index.js";

export function validateVoiceProfile(
  asset: Entity,
  input: Extract<Operation, { kind: "tts" }>,
) {
  const profile = voiceCloneSchema.safeParse(asset.provenance?.voiceClone);
  if (
    asset.kind !== "audio" ||
    !profile.success ||
    input.model !== profile.data.reuseModel ||
    input.voice !== profile.data.voiceId
  )
    throw new AppError(
      "VOICE_PROFILE_MISMATCH",
      "Use the owned cloned voice with its compatible synthesis model and exact voice ID",
    );
  return profile.data;
}
