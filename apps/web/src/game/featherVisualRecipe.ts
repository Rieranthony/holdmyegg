const featherTextureRows = [
  "...d....",
  "..ca....",
  ".cbaa...",
  ".cbaaa..",
  ".cbaaa..",
  "..cbaa..",
  "...ca...",
  "....d..."
] as const;

const transparentToken = ".";

const featherPalettes = {
  default: {
    a: "#fff9ef",
    b: "#f1e4b5",
    c: "#d3b169",
    d: "#8a6c34"
  },
  critical: {
    a: "#fff0ea",
    b: "#ffb0a4",
    c: "#f45d48",
    d: "#8f1f1f"
  }
} as const;

export type FeatherTone = keyof typeof featherPalettes;

export const featherIconViewBox = {
  width: featherTextureRows[0].length,
  height: featherTextureRows.length
} as const;

const createFeatherPixels = (palette: (typeof featherPalettes)[FeatherTone]) =>
  featherTextureRows.flatMap((row, y) =>
    [...row].flatMap((token, x) => {
      if (token === transparentToken) {
        return [];
      }

      return {
        x,
        y,
        color: palette[token as keyof typeof palette]
      };
    })
  );

export const featherPixelsByTone = {
  default: createFeatherPixels(featherPalettes.default),
  critical: createFeatherPixels(featherPalettes.critical)
} as const satisfies Record<FeatherTone, ReadonlyArray<{ x: number; y: number; color: string }>>;
