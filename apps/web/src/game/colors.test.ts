import { describe, expect, it } from "vitest";
import { chickenPalettes, getChickenPalette, getChickenPaletteIndex } from "./colors";

describe("getChickenPalette", () => {
  it("returns the same palette for the same player and match seed", () => {
    expect(getChickenPalette("human-1", 3)).toEqual(getChickenPalette("human-1", 3));
  });

  it("rerolls the palette when the match seed changes", () => {
    expect(getChickenPalette("human-1", 3)).not.toEqual(getChickenPalette("human-1", 4));
  });

  it("always returns a palette index inside the curated flock range", () => {
    for (const playerId of ["human-1", "npc-1", "npc-2", "npc-3"]) {
      for (let matchColorSeed = 0; matchColorSeed < 18; matchColorSeed += 1) {
        const paletteIndex = getChickenPaletteIndex(playerId, matchColorSeed);

        expect(paletteIndex).toBeGreaterThanOrEqual(0);
        expect(paletteIndex).toBeLessThan(chickenPalettes.length);
      }
    }
  });
});
