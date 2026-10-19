/** Shared command vocabulary. Commands prepare a request; none submits a job. */
export const creativeCommands = [
  { name: "help", usage: "/help", description: "View commands and examples" },
  {
    name: "models",
    usage: "/models",
    description: "View configured models and availability",
  },
  {
    name: "model",
    usage: "/model <model-id | auto>",
    description: "Select a generation model; auto prefers MiniMax",
  },
  { name: "video", usage: "/video", description: "Switch to video generation" },
  { name: "image", usage: "/image", description: "Switch to image generation" },
  {
    name: "speech",
    usage: "/speech",
    description:
      "Post-production voiceover and voice changes; defaults to Eleven v3",
  },
  {
    name: "audio",
    usage: "/audio",
    description: "Switch to music and sound effects generation",
  },
  {
    name: "edit",
    usage: "/edit",
    description: "Switch to automatic creation and editing",
  },
  {
    name: "brief",
    usage: "/brief <content>",
    description: "Add the topic, audience and purpose",
  },
  {
    name: "style",
    usage: "/style <description>",
    description: "Add visual style requirements",
  },
  {
    name: "reference",
    usage: "/reference <purpose>",
    description: "Describe how to use reference assets; upload files with +",
  },
] as const;

export const agentCommandInstructions =
  "Present rikoko command help and model catalog responses in English, including model names, descriptions, role labels and examples. Preserve exact command and model IDs. Other conversation may follow the user's language. " +
  "Current rikoko product models use fal.ai as their unified upstream channel, either behind the official gateway or via a custom fal connection. Model brands do not require separate native keys. Do not switch upstream providers when a model is unavailable. " +
  "Interpret /rikoko help, models, model <exact-id|auto>, video, image, speech, audio, edit, brief and style/reference updates using capabilities.commands. Do not intercept the host's global /model command. Help and models are read-only; other command-only turns prepare requirements without rendering, paid planning or submitting jobs. Keep separate model selections for video, image, speech (audio category=speech), and other audio; selecting one must not overwrite the others. Group the catalog by these roles. Extract duration and aspect ratio from natural language; do not offer duration/aspect slash commands or ask users to learn parameter syntax. Normalize requirements per task: video duration/aspect, image aspect/resolution, speech text/language/voice, music/sound requirements. Distinguish final composition duration from individual generated clips. Inspect the selected profile's fixedParameters and generationInput, match a compatible quoted profile, and use its exact ID; current generate operations use parameters={} because the server submits that profile's real fixed parameters. Never claim that prose in a prompt changes fixed parameters. If specifications are missing or incompatible, explain the gap before quoting instead of inventing values. Persist requirements and model IDs by role in workspace_request_save messages, resuming workspace_request_get with current requestVersion and preserving assets and unresolved missingInputs. Select only actual compatible profiles from capabilities.providers, preferring MiniMax for automatic video selection; never silently replace an explicit model. Reference text is not imported media. Recheck capabilities before quoting. Changed model, prompt, references or specs require a fresh quote and price agreement. Future model names do not imply configured availability. ";

export type CommandModel = {
  id: string;
  name: string;
  kind: string;
  category?: string;
  available: boolean;
  requiresVoiceProfile?: boolean;
  generationInput?: { mode: string };
};

export const generationRoles = [
  { id: "video", label: "Video generation" },
  { id: "image", label: "Image generation" },
  { id: "speech", label: "Speech generation" },
  { id: "audio", label: "Music and sound effects" },
] as const;

export function generationRole(model: Pick<CommandModel, "kind" | "category">) {
  return model.kind === "audio" && model.category === "speech"
    ? "speech"
    : model.kind;
}

// The studio's simple generation composer sends text only. Reference profiles
// are still listed, but require the Agent's structured reference workflow.
export function textGenerationModel(model: CommandModel) {
  return (
    ["video", "image", "audio"].includes(model.kind) &&
    !model.generationInput &&
    !model.requiresVoiceProfile
  );
}

export function defaultGenerationModel<T extends CommandModel>(models: T[]) {
  const available = models.filter((m) => m.available && textGenerationModel(m));
  if (
    models.length &&
    models.every((m) => m.kind === "audio" && m.category === "speech")
  )
    return available.find(
      (m) => m.id === "elevenlabs-voice" || /eleven.*v3/i.test(m.name),
    );
  return (
    available.find(
      (m) => m.kind === "video" && /minimax/i.test(`${m.id} ${m.name}`),
    ) ??
    available.find(
      (m) => m.id === "elevenlabs-voice" || /eleven.*v3/i.test(m.name),
    ) ??
    available[0]
  );
}

/** Only a standalone final line is a command, preserving the preceding brief. */
export function draftCommand(draft: string) {
  const lines = draft.split("\n");
  const last = lines.at(-1)!.trim();
  const match = /^\/(\S*)\s*(.*)$/.exec(last);
  if (!match) return undefined;
  return {
    name: match[1].toLowerCase(),
    argument: match[2].trim(),
    prefix: lines.slice(0, -1).join("\n").trimEnd(),
  };
}

export function commandRequirement(
  name: string,
  argument: string,
): { text: string } | { error: string } {
  if (name === "duration" || name === "aspect")
    return {
      error:
        "Include duration and aspect ratio in your creative brief, for example: Create a 15-second vertical video in 9:16.",
    };
  if (!["brief", "style", "reference"].includes(name))
    return {
      error: "Unknown command. Enter /help to view available commands.",
    };
  if (!argument) return { error: "Add a command argument, then press Enter." };
  const labels: Record<string, string> = {
    brief: "Creative brief",
    style: "Visual style",
    reference: "Reference purpose",
  };
  return labels[name]
    ? { text: `${labels[name]}: ${argument}` }
    : { error: "Unknown command. Enter /help to view available commands." };
}
