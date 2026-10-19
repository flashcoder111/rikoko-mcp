import type { Model } from "./index.js";

/** Fixed fal profiles. Costs are placeholders; never enable without pricing review. */
const base = {
  kind: "audio" as const,
  maxCostCents: 100,
  priceVersion: "EXAMPLE-REPLACE-AFTER-PRICING-REVIEW",
  hardBoundConfirmed: false,
};
export const audioModels: Model[] = [
  {
    ...base,
    id: "elevenlabs-voice",
    name: "ElevenLabs Eleven v3 · Post-production voiceover",
    description:
      "Default standalone voiceover for later voice changes or replacement. Preserve native video audio by default. Review pricing before enabling.",
    endpoint: "fal-ai/elevenlabs/tts/eleven-v3",
    category: "speech",
    parameters: {
      voice: "Rachel",
      stability: 0.5,
      apply_text_normalization: "auto",
    },
    promptField: "text",
  },
  {
    ...base,
    id: "elevenlabs-music-30s",
    name: "ElevenLabs Music · 30-second music",
    description:
      "30-second instrumental background music. Other durations require separately priced profiles.",
    endpoint: "fal-ai/elevenlabs/music",
    category: "music",
    parameters: {
      music_length_ms: 30000,
      force_instrumental: true,
      output_format: "mp3_44100_128",
    },
  },
  {
    ...base,
    id: "elevenlabs-sound-5s",
    name: "ElevenLabs Sound Effects V2 · 5-second sound effects",
    description:
      "Generate ambience, action and transition sound effects as independently timed audio overlays.",
    endpoint: "fal-ai/elevenlabs/sound-effects/v2",
    category: "sound",
    parameters: {
      duration_seconds: 5,
      prompt_influence: 0.3,
      output_format: "mp3_44100_128",
    },
    promptField: "text",
  },
  {
    ...base,
    id: "minimax-voice-clone",
    name: "MiniMax Voice Clone · Voice cloning",
    description:
      "Clone a voice from 10–60 seconds of reference audio and generate a preview. Save the voice ID for reuse with compatible MiniMax speech models.",
    endpoint: "fal-ai/minimax/voice-clone",
    category: "speech",
    parameters: {
      model: "speech-02-hd",
      noise_reduction: true,
      need_volume_normalization: true,
    },
    promptField: "text",
    generationInput: {
      mode: "voice_clone",
      maxTotalBytes: 20971520,
      bindings: [
        {
          field: "audio_url",
          roles: ["voice"],
          kind: "audio",
          array: false,
          min: 1,
          max: 1,
          maxBytes: 20971520,
          minDurationMs: 10000,
          maxDurationMs: 60000,
        },
      ],
    },
  },
  {
    ...base,
    id: "minimax-cloned-speech",
    requiresVoiceProfile: true,
    name: "MiniMax Speech-02 HD · Cloned-voice speech",
    description:
      "For reusing MiniMax cloned voices only; requires the clone asset and voice ID. Standard post-production voiceover defaults to Eleven v3.",
    endpoint: "fal-ai/minimax/speech-02-hd",
    category: "speech",
    parameters: {
      output_format: "url",
      voice_setting: { speed: 1, vol: 1 },
    },
    promptField: "text",
  },
];
