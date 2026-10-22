import { expect, it } from "vitest";
import {
  commandRequirement,
  defaultGenerationModel,
  draftCommand,
  creativeCommands,
  generationRole,
} from "../packages/core/src/commands.js";

it("recognizes only a final command line and keeps the existing creative brief", () => {
  expect(draftCommand("咖啡店新品短片\n/style 自然光")).toEqual({
    name: "style",
    argument: "自然光",
    prefix: "咖啡店新品短片",
  });
  expect(draftCommand("镜头中显示 /model 文字")).toBeUndefined();
  expect(draftCommand("https://example.com/video")).toBeUndefined();
});

it("keeps duration and aspect in natural language instead of separate commands", () => {
  expect(
    creativeCommands.some((c) => ["duration", "aspect"].includes(c.name)),
  ).toBe(false);
  expect(commandRequirement("brief", "做一条15秒竖屏视频")).toEqual({
    text: "Creative brief: 做一条15秒竖屏视频",
  });
  expect(commandRequirement("duration", "15")).toEqual(
    expect.objectContaining({
      error: expect.stringContaining(
        "Include duration and aspect ratio in your creative brief",
      ),
    }),
  );
  expect(commandRequirement("style", "")).toHaveProperty("error");
  expect(commandRequirement("buy", "now")).toHaveProperty("error");
});

it("distinguishes speech from other audio while preserving image and video roles", () => {
  expect(generationRole({ kind: "audio", category: "speech" })).toBe("speech");
  expect(generationRole({ kind: "audio", category: "music" })).toBe("audio");
  expect(generationRole({ kind: "image" })).toBe("image");
  expect(generationRole({ kind: "video" })).toBe("video");
});

it("prefers available Seedance Mini text profiles, with MiniMax as an alternative", () => {
  const model = (id: string) => ({
    id,
    name: id,
    kind: "video",
    available: true,
  });
  const seedance = model("future-seedance-profile");
  const mini = model("seedance-mini-text");
  const minimax = model("minimax-text");
  const reference = {
    ...model("minimax-reference"),
    generationInput: { mode: "image_to_video" },
  };
  expect(defaultGenerationModel([seedance, reference, minimax])).toBe(minimax);
  expect(defaultGenerationModel([minimax, seedance, mini])).toBe(mini);
  expect(
    defaultGenerationModel([
      reference,
      { ...minimax, available: false },
      seedance,
    ]),
  ).toBe(seedance);
  expect(
    defaultGenerationModel([reference, { ...minimax, available: false }]),
  ).toBeUndefined();
});
