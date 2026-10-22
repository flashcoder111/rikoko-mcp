/** Shared command vocabulary. Commands prepare a request; none submits a job. */
import { videoModelRank } from "../../contracts/src/video-policy.js";
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
    description:
      "Auto prefers Seedance Mini; face tasks require MiniMax or Kling and user choice",
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
    available
      .filter((m) => m.kind === "video")
      .sort(
        (a, b) => videoModelRank(a, "absent") - videoModelRank(b, "absent"),
      )[0] ??
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
