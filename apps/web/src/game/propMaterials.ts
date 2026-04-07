import * as THREE from "three";

export const PIXEL_TEXTURE_SIZE = 8;

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
  c: "#f5d95b"
} as const;

const hexToRgb = (hex: string) => {
  const normalized = hex.replace("#", "");
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16)
  };
};

const createPixelTexture = (rows: string[]) => {
  const data = new Uint8Array(PIXEL_TEXTURE_SIZE * PIXEL_TEXTURE_SIZE * 4);

  rows.forEach((row, y) => {
    [...row].forEach((token, x) => {
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

const createStandardMaterial = (texture: THREE.Texture) =>
  new THREE.MeshStandardMaterial({
    color: "#ffffff",
    map: texture,
    roughness: 1,
    metalness: 0
  });

export const propTextureRows = {
  bark: [
    "bBbBbBbB",
    "BbBbBbBb",
    "bBbBBbBb",
    "BbBbBbBb",
    "bBBbBbBb",
    "BbBbBBbB",
    "bBbBbBbB",
    "BbBbBbBb"
  ],
  leaves: [
    "lLllLllL",
    "LlLllLll",
    "llLLllLl",
    "LllLllLl",
    "llLllLLl",
    "LllLLllL",
    "llLllLll",
    "LllLllLl"
  ],
  nest: [
    "nNnnNnnN",
    "NnnNNnnn",
    "nnNnnNnN",
    "NnnnNnnN",
    "nnNNnnNn",
    "NnnnNnnN",
    "nnNnnNNn",
    "NnnNnnnN"
  ],
  grass: [
    "gGGgGGgG",
    "GgGGgGGg",
    "gGGgGGgG",
    "GGggGGgg",
    "gGGGGgGG",
    "GgGGgGGg",
    "gGGgGGgG",
    "GGggGGgg"
  ],
  stem: [
    "ssssssss",
    "sSsSsSsS",
    "ssssssss",
    "sSsSsSsS",
    "ssssssss",
    "sSsSsSsS",
    "ssssssss",
    "sSsSsSsS"
  ],
  egg: [
    "eeeeeeee",
    "eweeeewe",
    "eeeeeeee",
    "eeeweeee",
    "eeeeeeee",
    "eweeeewe",
    "eeeeeeee",
    "eeeweeee"
  ],
  flowerYellow: [
    "yyyyyyyy",
    "ycyyyycy",
    "yyyyyyyy",
    "yycyyyyy",
    "yyyyyyyy",
    "ycyyyycy",
    "yyyyyyyy",
    "yycyyyyy"
  ],
  flowerPink: [
    "pppppppp",
    "pcppppcp",
    "pppppppp",
    "ppcppppp",
    "pppppppp",
    "pcppppcp",
    "pppppppp",
    "ppcppppp"
  ],
  flowerWhite: [
    "wwwwwwww",
    "wcwwwwcw",
    "wwwwwwww",
    "wwcwwwww",
    "wwwwwwww",
    "wcwwwwcw",
    "wwwwwwww",
    "wwcwwwww"
  ]
} as const;

const textures = {
  bark: createPixelTexture(propTextureRows.bark),
  leaves: createPixelTexture(propTextureRows.leaves),
  nest: createPixelTexture(propTextureRows.nest),
  grass: createPixelTexture(propTextureRows.grass),
  stem: createPixelTexture(propTextureRows.stem),
  egg: createPixelTexture(propTextureRows.egg),
  flowerYellow: createPixelTexture(propTextureRows.flowerYellow),
  flowerPink: createPixelTexture(propTextureRows.flowerPink),
  flowerWhite: createPixelTexture(propTextureRows.flowerWhite)
};

export const propMaterials = {
  bark: createStandardMaterial(textures.bark),
  leaves: createStandardMaterial(textures.leaves),
  nest: createStandardMaterial(textures.nest),
  grass: createStandardMaterial(textures.grass),
  stem: createStandardMaterial(textures.stem),
  egg: createStandardMaterial(textures.egg),
  flowerYellow: createStandardMaterial(textures.flowerYellow),
  flowerPink: createStandardMaterial(textures.flowerPink),
  flowerWhite: createStandardMaterial(textures.flowerWhite)
};
