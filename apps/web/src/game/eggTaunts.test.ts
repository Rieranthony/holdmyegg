import { describe, expect, it } from "vitest";
import { eggTauntMessages, getEggTauntMessage } from "./eggTaunts";

describe("eggTaunts", () => {
  it("ships a unique 36-line taunt bank", () => {
    expect(eggTauntMessages).toHaveLength(36);
    expect(new Set(eggTauntMessages).size).toBe(36);
  });

  it("resolves the same seeded order deterministically", () => {
    const firstRun = Array.from({ length: 6 }, (_, index) => getEggTauntMessage("speaker-a", index + 1));
    const secondRun = Array.from({ length: 6 }, (_, index) => getEggTauntMessage("speaker-a", index + 1));
    const otherSpeaker = Array.from({ length: 6 }, (_, index) => getEggTauntMessage("speaker-b", index + 1));

    expect(firstRun).toEqual(secondRun);
    expect(otherSpeaker).not.toEqual(firstRun);
  });

  it("cycles through the full bank before repeating for a seed", () => {
    const picks = Array.from({ length: eggTauntMessages.length }, (_, index) =>
      getEggTauntMessage("speaker-a", index + 1)
    );

    expect(new Set(picks).size).toBe(eggTauntMessages.length);
  });
});
