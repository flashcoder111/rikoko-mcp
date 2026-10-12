import { afterEach, expect, it, vi } from "vitest";
import { PreviewAudio } from "../apps/studio/src/preview-audio.js";
import {
  envelopeGain,
  sliceEnvelope,
} from "../packages/contracts/src/audio.js";
afterEach(() => vi.unstubAllGlobals());
it("uses Web Audio gain above 100% and reuses each media element source", () => {
  const gain = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() };
  const source = { connect: vi.fn(), disconnect: vi.fn() };
  const context = {
    resume: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    createGain: vi.fn(() => gain),
    createMediaElementSource: vi.fn(() => source),
    destination: {},
  };
  vi.stubGlobal("AudioContext", function () {
    return context;
  });
  const player = new PreviewAudio();
  const element = { volume: 1, pause: vi.fn() } as unknown as HTMLMediaElement;
  player.setGain(element, 0.5);
  expect(element.volume).toBe(0.5);
  player.resume();
  player.setGain(element, 1.5);
  expect(element.volume).toBe(1);
  expect(gain.gain.value).toBe(1.5);
  player.setGain(element, 0.2);
  expect(context.createMediaElementSource).toHaveBeenCalledTimes(1);
  expect(gain.gain.value).toBe(0.2);
  player.close();
  expect(context.close).toHaveBeenCalledOnce();
});
it("interpolates the same curve in preview, including cropped boundaries and absent keys", () => {
  const points = [
    { timeMs: 100, gain: 0.2 },
    { timeMs: 900, gain: 1 },
  ];
  expect(envelopeGain(undefined, 500)).toBe(1);
  expect(envelopeGain([], 500)).toBe(1);
  expect(envelopeGain(points, 0)).toBe(0.2);
  expect(envelopeGain(points, 500)).toBeCloseTo(0.6);
  expect(envelopeGain(points, 1000)).toBe(1);
  const sliced = sliceEnvelope(points, 200, 800);
  expect(sliced.map((p) => p.timeMs)).toEqual([0, 600]);
  expect(sliced[0].gain).toBeCloseTo(0.3);
  expect(sliced[1].gain).toBeCloseTo(0.9);
  const dense = Array.from({ length: 64 }, (_, i) => ({
    timeMs: i + 1,
    gain: i % 2,
  }));
  expect(sliceEnvelope(dense, 0, 100)).toHaveLength(64);
});
it("disconnects and pauses media removed from the player", () => {
  const gain = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() };
  const source = { connect: vi.fn(), disconnect: vi.fn() };
  const context = {
    resume: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    createGain: () => gain,
    createMediaElementSource: vi.fn(() => source),
    destination: {},
  };
  vi.stubGlobal("AudioContext", function () {
    return context;
  });
  const player = new PreviewAudio();
  const element = { volume: 1, pause: vi.fn() } as unknown as HTMLMediaElement;
  player.resume();
  player.setGain(element, 1.5);
  player.retain([]);
  expect(element.pause).toHaveBeenCalledOnce();
  expect(source.disconnect).toHaveBeenCalledOnce();
  expect(gain.disconnect).toHaveBeenCalledOnce();
  player.setGain(element, 0.5);
  expect(context.createMediaElementSource).toHaveBeenCalledOnce();
  expect(source.connect).toHaveBeenCalledTimes(2);
  player.close();
});
