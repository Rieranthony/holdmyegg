import * as THREE from "three";

export const PIXEL_TEXTURE_SIZE = 16;

export const propTexturePalette = {
  b: "#8b5a2b",
  B: "#6d421c",
  l: "#5eaa43",
  L: "#7bc858",
  n: "#b4874b",
  N: "#8d673a",
  g: "#5bb24a",
  G: "#79cb63",
  s: "#4d8d3c",
  S: "#6ba94f",
  e: "#f1ead8",
  y: "#f4cf4c",
  p: "#ef8fb8",
  w: "#f4f3ef",
  c: "#f5d95b",
  u: "#8cbcff",
  U: "#6296ea"
} as const;

const hexToRgb = (hex: string) => {
  const normalized = hex.replace("#", "");
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16)
  };
};

const createPixelTexture = (
  rows: string[],
  { flipRowsVertically = false }: { flipRowsVertically?: boolean } = {}
) => {
  const data = new Uint8Array(PIXEL_TEXTURE_SIZE * PIXEL_TEXTURE_SIZE * 4);
  const sourceRows = flipRowsVertically ? [...rows].reverse() : rows;

  sourceRows.forEach((row, y) => {
    [...row].forEach((token, x) => {
      if (token === ".") {
        return;
      }

      const hex = propTexturePalette[token as keyof typeof propTexturePalette];
      if (!hex) {
        throw new Error(`Unknown prop texture token "${token}" at ${x},${y}`);
      }

      const color = hexToRgb(hex);
      const offset = (y * PIXEL_TEXTURE_SIZE + x) * 4;
      data[offset] = color.r;
      data[offset + 1] = color.g;
      data[offset + 2] = color.b;
      data[offset + 3] = 255;
    });
  });

  const texture = new THREE.DataTexture(data, PIXEL_TEXTURE_SIZE, PIXEL_TEXTURE_SIZE, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
};

const createStandardMaterial = (
  texture: THREE.Texture,
  overrides: Partial<THREE.MeshStandardMaterialParameters> = {}
) =>
  new THREE.MeshStandardMaterial({
    color: "#ffffff",
    map: texture,
    roughness: 1,
    metalness: 0,
    ...overrides
  });

export const propTextureRows = {
  bark: [
    "bBbBbBbBBbBbBbBb",
    "BbBbBbBbbBbBbBbB",
    "bBbBBbBbbBbBBbBb",
    "BbBbBbBbBbBbBbBb",
    "bBBbBbBbbBBbBbBb",
    "BbBbBBbBBbBbBBbB",
    "bBbBbBbBbBbBbBbB",
    "BbBbBbBbbBbBbBbB",
    "bBbBBbBbbBbBBbBb",
    "BbBbBbBbBbBbBbBb",
    "bBBbBbBbbBBbBbBb",
    "BbBbBBbBBbBbBBbB",
    "bBbBbBbBbBbBbBbB",
    "BbBbBbBbbBbBbBbB",
    "bBbBBbBbbBbBBbBb",
    "BbBbBbBbBbBbBbBb"
  ],
  leaves: [
    "lLllLllLLllLllLl",
    "LlLllLlllLllLllL",
    "llLLllLlllLLllLl",
    "LllLllLlLllLllLl",
    "llLllLLlllLllLLl",
    "LllLLllLLllLLllL",
    "llLllLlllLllLlll",
    "LllLllLlLllLllLl",
    "lLllLllLLllLllLl",
    "LlLllLlllLllLllL",
    "llLLllLlllLLllLl",
    "LllLllLlLllLllLl",
    "llLllLLlllLllLLl",
    "LllLLllLLllLLllL",
    "llLllLlllLllLlll",
    "LllLllLlLllLllLl"
  ],
  nest: [
    "nNnnNnnNnNnnNnnN",
    "NnnNNnnnNnnNNnnn",
    "nnNnnNnNnnNnnNnN",
    "NnnnNnnNNnnnNnnN",
    "nnNNnnNnnnNNnnNn",
    "NnnnNnnNNnnnNnnN",
    "nnNnnNNnnnNnnNNn",
    "NnnNnnnNNnnNnnnN",
    "nNnnNnnNnNnnNnnN",
    "NnnNNnnnNnnNNnnn",
    "nnNnnNnNnnNnnNnN",
    "NnnnNnnNNnnnNnnN",
    "nnNNnnNnnnNNnnNn",
    "NnnnNnnNNnnnNnnN",
    "nnNnnNNnnnNnnNNn",
    "NnnNnnnNNnnNnnnN"
  ],
  grass: [
    "................",
    ".......g........",
    "......gG........",
    "......GG....g...",
    "..g...gG....GG..",
    "..G...GG...gGG..",
    "..GG..gG...GGG..",
    "..gG..GG..gGGg..",
    "..GG..GG..GGGg..",
    "..gG.gGG..gGGG..",
    "..GG.GGg..GGGg..",
    "..gGGGGG.gGGGG..",
    "..GGGGGg.GGGGg..",
    "...GGGG..GGGG...",
    "...gGG....gGG...",
    "................"
  ],
  stem: [
    "................",
    "................",
    "................",
    "................",
    ".......s........",
    ".......S........",
    ".......s........",
    ".......S........",
    ".......s........",
    ".......S........",
    ".......s........",
    ".......S........",
    ".......s........",
    ".......S........",
    ".......s........",
    "................"
  ],
  egg: [
    "eeeeeeeeeeeeeeee",
    "eweeeeweeeeeeewe",
    "eeeeeeeeeeeeeeee",
    "eeeweeeeeeeweeee",
    "eeeeeeeeeeeeeeee",
    "eweeeeweeeeeeewe",
    "eeeeeeeeeeeeeeee",
    "eeeweeeeeeeweeee",
    "eeeeeeeeeeeeeeee",
    "eweeeeweeeeeeewe",
    "eeeeeeeeeeeeeeee",
    "eeeweeeeeeeweeee",
    "eeeeeeeeeeeeeeee",
    "eweeeeweeeeeeewe",
    "eeeeeeeeeeeeeeee",
    "eeeweeeeeeeweeee"
  ],
  flowerYellow: [
    "................",
    "................",
    "......yyy.......",
    ".....yyyyy......",
    "....yycycyy.....",
    "....yyyyyyy.....",
    "....yycycyy.....",
    ".....yyyyy......",
    "......yyy.......",
    ".......s........",
    ".......S........",
    ".......s........",
    "......sS........",
    "......Ss........",
    ".......s........",
    "................"
  ],
  flowerPink: [
    "................",
    "................",
    "......pp........",
    ".....pppp.......",
    "....ppcppp......",
    "....pppppp......",
    ".....pppp.......",
    "......pp........",
    ".....pppp.......",
    ".......s........",
    ".......S........",
    ".......s........",
    "......sS........",
    "......Ss........",
    ".......s........",
    "................"
  ],
  flowerWhite: [
    "................",
    "................",
    ".......w........",
    "......www.......",
    ".....wwcww......",
    "....wwcwcww.....",
    ".....wwcww......",
    "......www.......",
    ".......w........",
    "......www.......",
    ".......w........",
    ".......s........",
    ".......S........",
    ".......s........",
    "......sS........",
    "......Ss........",
    ".......s........",
    "................"
  ],
  flowerBlue: [
    "................",
    "................",
    ".......u........",
    "......uuu.......",
    ".....uuUuu......",
    "....uuUcUuu.....",
    ".....uuUuu......",
    "......uuu.......",
    ".......u........",
    ".......s........",
    ".......S........",
    ".......s........",
    "......sS........",
    "......Ss........",
    ".......s........",
    "................"
  ]
} as const;

const textures = {
  bark: createPixelTexture(propTextureRows.bark),
  leaves: createPixelTexture(propTextureRows.leaves),
  nest: createPixelTexture(propTextureRows.nest),
  grass: createPixelTexture(propTextureRows.grass, { flipRowsVertically: true }),
  stem: createPixelTexture(propTextureRows.stem, { flipRowsVertically: true }),
  egg: createPixelTexture(propTextureRows.egg),
  flowerYellow: createPixelTexture(propTextureRows.flowerYellow, { flipRowsVertically: true }),
  flowerPink: createPixelTexture(propTextureRows.flowerPink, { flipRowsVertically: true }),
  flowerWhite: createPixelTexture(propTextureRows.flowerWhite, { flipRowsVertically: true }),
  flowerBlue: createPixelTexture(propTextureRows.flowerBlue, { flipRowsVertically: true })
};

export const propMaterials = {
  bark: createStandardMaterial(textures.bark),
  leaves: createStandardMaterial(textures.leaves),
  nest: createStandardMaterial(textures.nest),
  grass: createStandardMaterial(textures.grass, { transparent: true, alphaTest: 0.5, side: THREE.DoubleSide }),
  stem: createStandardMaterial(textures.stem, { transparent: true, alphaTest: 0.5, side: THREE.DoubleSide }),
  egg: createStandardMaterial(textures.egg),
  flowerYellow: createStandardMaterial(textures.flowerYellow, { transparent: true, alphaTest: 0.5, side: THREE.DoubleSide }),
  flowerPink: createStandardMaterial(textures.flowerPink, { transparent: true, alphaTest: 0.5, side: THREE.DoubleSide }),
  flowerWhite: createStandardMaterial(textures.flowerWhite, { transparent: true, alphaTest: 0.5, side: THREE.DoubleSide }),
  flowerBlue: createStandardMaterial(textures.flowerBlue, { transparent: true, alphaTest: 0.5, side: THREE.DoubleSide })
};
