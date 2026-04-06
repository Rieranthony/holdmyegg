export type ChickenPaletteName = "cream" | "gold" | "coral" | "mint" | "sky" | "cocoa";

export interface ChickenPalette {
  name: ChickenPaletteName;
  body: string;
  shade: string;
  ringAccent: string;
}

export const chickenPalettes: readonly ChickenPalette[] = [
  {
    name: "cream",
    body: "#f3ead7",
    shade: "#d7c8a4",
    ringAccent: "#d59b36"
  },
  {
    name: "gold",
    body: "#f2c45c",
    shade: "#c88d2c",
    ringAccent: "#ffd24a"
  },
  {
    name: "coral",
    body: "#f08d71",
    shade: "#ca6048",
    ringAccent: "#ffb18f"
  },
  {
    name: "mint",
    body: "#89d6b2",
    shade: "#4aa27c",
    ringAccent: "#c0ffe2"
  },
  {
    name: "sky",
    body: "#8abcf2",
    shade: "#4e7fca",
    ringAccent: "#d4efff"
  },
  {
    name: "cocoa",
    body: "#a77d62",
    shade: "#72503c",
    ringAccent: "#f3d0af"
  }
];

export const chickenDetailPalette = {
  eye: "#fff9ef",
  pupil: "#222c33",
  beak: "#dd8d32",
  legs: "#c7741d"
};

const hashString = (value: string) => {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
};

export const getChickenPaletteIndex = (playerId: string, matchColorSeed: number) => {
  const seedOffset = Math.abs(Math.trunc(matchColorSeed));
  return (hashString(playerId) + seedOffset) % chickenPalettes.length;
};

export const getChickenPaletteByName = (name: ChickenPaletteName) =>
  chickenPalettes.find((palette) => palette.name === name) ?? chickenPalettes[0]!;

export const getChickenPalette = (playerId: string, matchColorSeed: number, preferredName?: ChickenPaletteName | null) =>
  preferredName
    ? getChickenPaletteByName(preferredName)
    : chickenPalettes[getChickenPaletteIndex(playerId, matchColorSeed)]!;
