import { describe, expect, it } from "vitest";
import {
  chickenPreviewEggDelayRangeSeconds,
  getNextChickenPreviewEggTaunt,
  getNextChickenPreviewEggDelay
} from "./chickenPreviewEggs";
import { eggTauntDurationSeconds, getEggTauntMessage } from "../game/eggTaunts";

describe("chickenPreviewEggs", () => {
  it("keeps randomized egg delay inside the configured interval", () => {
    expect(getNextChickenPreviewEggDelay(() => 0)).toBe(chickenPreviewEggDelayRangeSeconds.min);
    expect(getNextChickenPreviewEggDelay(() => 0.5)).toBe(3.75);
    expect(getNextChickenPreviewEggDelay(() => 1)).toBe(chickenPreviewEggDelayRangeSeconds.max);
  });

  it("clamps out-of-range random values back into the configured interval", () => {
    expect(getNextChickenPreviewEggDelay(() => -3)).toBe(chickenPreviewEggDelayRangeSeconds.min);
    expect(getNextChickenPreviewEggDelay(() => 4)).toBe(chickenPreviewEggDelayRangeSeconds.max);
  });

  it("keeps sampled delays inside bounds across multiple values", () => {
    const samples = [0.1, 0.25, 0.75, 0.9].map((value) => getNextChickenPreviewEggDelay(() => value));

    samples.forEach((sample) => {
      expect(sample).toBeGreaterThanOrEqual(chickenPreviewEggDelayRangeSeconds.min);
      expect(sample).toBeLessThanOrEqual(chickenPreviewEggDelayRangeSeconds.max);
    });
  });

  it("advances preview taunts when menu eggs spawn", () => {
    expect(getNextChickenPreviewEggTaunt(0, true)).toEqual({
      sequence: 1,
      remaining: eggTauntDurationSeconds,
      message: getEggTauntMessage("menu-preview", 1)
    });
    expect(getNextChickenPreviewEggTaunt(1, true)).toEqual({
      sequence: 2,
      remaining: eggTauntDurationSeconds,
      message: getEggTauntMessage("menu-preview", 2)
    });
  });

  it("keeps launch preview taunt-free", () => {
    expect(getNextChickenPreviewEggTaunt(0, false)).toBeNull();
  });
});
