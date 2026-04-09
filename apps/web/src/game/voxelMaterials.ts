import * as THREE from "three";
import { DEFAULT_GROUND_TOP_Y, type BlockKind, type ExposedFaceName } from "@out-of-bounds/map";

export type BlockRenderProfile = "earthSurface" | "earthSubsoil" | "darkness";
export type TerrainMaterialKey =
  | "earthSurfaceTop"
  | "earthSurfaceSide"
  | "earthSurfaceBottom"
  | "earthSubsoil"
  | "darkness"
  | "waterTop"
  | "waterSide";

export const getBlockRenderProfile = (kind: BlockKind, y: number) => {
  if (kind === "hazard") {
    return "darkness" satisfies BlockRenderProfile;
  }

  return y < DEFAULT_GROUND_TOP_Y ? "earthSubsoil" : "earthSurface";
};

export const sharedVoxelGeometry = new THREE.BoxGeometry(1, 1, 1);

const PIXEL_TEXTURE_SIZE = 16;

export const voxelTexturePalette = {
  g: "#8bcf57",
  G: "#66a93b",
  h: "#95db63",
  j: "#78bf4c",
  d: "#8f6336",
  D: "#6e4727",
  e: "#55351b",
  b: "#040404",
  B: "#0f0f10",
  s: "#1b1b1d",
  w: "#78d7f2",
  W: "#58b7e0",
  q: "#4b99c7",
  Q: "#316e9f"
} as const;

const hexToRgb = (hex: string) => {
  const normalized = hex.replace("#", "");
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16)
  };
};

const createPixelTexture = (rows: readonly string[]) => {
  const data = new Uint8Array(PIXEL_TEXTURE_SIZE * PIXEL_TEXTURE_SIZE * 4);

  rows.forEach((row, y) => {
    [...row].forEach((token, x) => {
      const color = hexToRgb(voxelTexturePalette[token as keyof typeof voxelTexturePalette]);
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

export const voxelTextureRows = {
  earthTop: [
    "ghhgGghhggGghhgG",
    "GghggGhggGhggGhg",
    "hggGhggGhggGhggG",
    "ggGhhgGgghhGgghg",
    "GghggGhjgGhgGghg",
    "hgGghgGgGhggGhGg",
    "gGhggGhGGhggGhhG",
    "GghgGghghGgGhggg",
    "ghhgGgghggGhGghg",
    "GghjGghggGhggGhg",
    "hggGhggGhggGhhgG",
    "ggGhhgGggGhhgGhg",
    "GghggGhgghGggGhg",
    "hgGghgGgGhggGhGg",
    "gGhggGhGGhggGghG",
    "GghgGghghGgGhggg"
  ],
  earthSide: [
    "gghhGGhhgghhGGhh",
    "GhghdDgddDgdhDgd",
    "dDgddDgddDddDdDd",
    "DdDddDddedDddDdd",
    "ddDDeDdddDdDddDd",
    "DddDddDdeDdDddDd",
    "ddDddDdeDdDddDde",
    "eDdDddDdDddDdeDd",
    "dDddDdDedDdDddDd",
    "DdDddDddedDddDdd",
    "ddDDeDdddDdDddDd",
    "DddDddDdeDdDddDd",
    "ddDddDdeDdDddDde",
    "eDdDddDdDddDdeDd",
    "dDddDdDedDdDddDd",
    "DdDddDddedDddDdd"
  ],
  earthBottom: [
    "dDddDdDdDdDddDdd",
    "DdDddDddedDddDdd",
    "ddDDeDdddDdDddDd",
    "DddDddDdeDdDddDd",
    "ddDddDdeDdDddDde",
    "eDdDddDdDddDdeDd",
    "dDddDdDedDdDddDd",
    "DdDddDddedDddDdd",
    "ddDDeDdddDdDddDd",
    "DddDddDdeDdDddDd",
    "ddDddDdeDdDddDde",
    "eDdDddDdDddDdeDd",
    "dDddDdDedDdDddDd",
    "DdDddDddedDddDdd",
    "ddDDeDdddDdDddDd",
    "DddDddDdeDdDddDd"
  ],
  darkness: [
    "bbbbBbbbbbbbBbbb",
    "bbBbbsbbbbBbbsbb",
    "bBbbbBbbbBbbbBbb",
    "bbbbsbbbbbbsbbbb",
    "bbBbbbBbbbBbbbBb",
    "bbsbbbbsbbsbbbbs",
    "bBbbbBbbbBbbbBbb",
    "bbbbsbbbbbbsbbbb",
    "bbbbBbbbbbbbBbbb",
    "bbBbbsbbbbBbbsbb",
    "bBbbbBbbbBbbbBbb",
    "bbbbsbbbbbbsbbbb",
    "bbBbbbBbbbBbbbBb",
    "bbsbbbbsbbsbbbbs",
    "bBbbbBbbbBbbbBbb",
    "bbbbsbbbbbbsbbbb"
  ],
  waterTop: [
    "wwWwqqwwWwqqwwWw",
    "WwwqWwwqWwwqWwwq",
    "wWwwqqwWwwqqwWww",
    "qqwwWwqqwwWwqqww",
    "wwWwqqwwWwqqwwWw",
    "WwwqWwwqWwwqWwwq",
    "wWwwqqwWwwqqwWww",
    "qqwwWwqqwwWwqqww",
    "wwWwqqwwWwqqwwWw",
    "WwwqWwwqWwwqWwwq",
    "wWwwqqwWwwqqwWww",
    "qqwwWwqqwwWwqqww",
    "wwWwqqwwWwqqwwWw",
    "WwwqWwwqWwwqWwwq",
    "wWwwqqwWwwqqwWww",
    "qqwwWwqqwwWwqqww"
  ],
  waterSide: [
    "WwwwqqWwwwqqWwww",
    "wWwwqqwWwwqqwWww",
    "qqQWwwqqQWwwqqQW",
    "WwwwqqWwwwqqWwww",
    "wWwwqqwWwwqqwWww",
    "qqQWwwqqQWwwqqQW",
    "WwwwqqWwwwqqWwww",
    "wWwwqqwWwwqqwWww",
    "qqQWwwqqQWwwqqQW",
    "WwwwqqWwwwqqWwww",
    "wWwwqqwWwwqqwWww",
    "qqQWwwqqQWwwqqQW",
    "WwwwqqWwwwqqWwww",
    "wWwwqqwWwwqqwWww",
    "qqQWwwqqQWwwqqQW",
    "WwwwqqWwwwqqWwww"
  ]
} as const;

export const voxelTextures = {
  earthTop: createPixelTexture(voxelTextureRows.earthTop),
  earthSide: createPixelTexture(voxelTextureRows.earthSide),
  earthBottom: createPixelTexture(voxelTextureRows.earthBottom),
  darkness: createPixelTexture(voxelTextureRows.darkness),
  waterTop: createPixelTexture(voxelTextureRows.waterTop),
  waterSide: createPixelTexture(voxelTextureRows.waterSide)
};

export const updateVoxelMaterialAnimation = (elapsedSeconds: number) => {
  voxelTextures.waterTop.offset.x = (elapsedSeconds * 0.045) % 1;
  voxelTextures.waterTop.offset.y = (elapsedSeconds * 0.02) % 1;
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

const earthSideMaterial = createStandardMaterial(voxelTextures.earthSide);
const earthTopMaterial = createStandardMaterial(voxelTextures.earthTop);
const earthBottomMaterial = createStandardMaterial(voxelTextures.earthBottom);
const earthSubsoilMaterial = createStandardMaterial(voxelTextures.earthBottom);
const darknessMaterial = createStandardMaterial(voxelTextures.darkness);
const waterTopMaterial = createStandardMaterial(voxelTextures.waterTop, {
  transparent: true,
  opacity: 0.76,
  depthWrite: false
});
const waterSideMaterial = createStandardMaterial(voxelTextures.waterSide, {
  transparent: true,
  opacity: 0.72,
  depthWrite: false
});

export const voxelMaterialsByProfile: Record<BlockRenderProfile, THREE.Material[]> = {
  earthSurface: [
    earthSideMaterial,
    earthSideMaterial,
    earthTopMaterial,
    earthBottomMaterial,
    earthSideMaterial,
    earthSideMaterial
  ],
  earthSubsoil: [
    earthSubsoilMaterial,
    earthSubsoilMaterial,
    earthSubsoilMaterial,
    earthSubsoilMaterial,
    earthSubsoilMaterial,
    earthSubsoilMaterial
  ],
  darkness: [
    darknessMaterial,
    darknessMaterial,
    darknessMaterial,
    darknessMaterial,
    darknessMaterial,
    darknessMaterial
  ]
};

export const getVoxelMaterials = (profile: BlockRenderProfile) => voxelMaterialsByProfile[profile];

export const terrainMaterialOrder = [
  "earthSurfaceTop",
  "earthSurfaceSide",
  "earthSurfaceBottom",
  "earthSubsoil",
  "darkness",
  "waterTop",
  "waterSide"
] as const satisfies readonly TerrainMaterialKey[];

const terrainMaterialIndexByKey = terrainMaterialOrder.reduce<Record<TerrainMaterialKey, number>>((lookup, key, index) => {
  lookup[key] = index;
  return lookup;
}, {
  earthSurfaceTop: 0,
  earthSurfaceSide: 0,
  earthSurfaceBottom: 0,
  earthSubsoil: 0,
  darkness: 0,
  waterTop: 0,
  waterSide: 0
});

export const terrainMaterialsByKey: Record<TerrainMaterialKey, THREE.MeshStandardMaterial> = {
  earthSurfaceTop: earthTopMaterial,
  earthSurfaceSide: earthSideMaterial,
  earthSurfaceBottom: earthBottomMaterial,
  earthSubsoil: earthSubsoilMaterial,
  darkness: darknessMaterial,
  waterTop: waterTopMaterial,
  waterSide: waterSideMaterial
};

export const getTerrainMaterialIndex = (key: TerrainMaterialKey) => terrainMaterialIndexByKey[key];

export const getTerrainMaterialKey = (kind: BlockKind, y: number, face: ExposedFaceName): TerrainMaterialKey => {
  if (kind === "water") {
    return face === "posY" ? "waterTop" : "waterSide";
  }

  const profile = getBlockRenderProfile(kind, y);
  if (profile === "earthSurface") {
    if (face === "posY") {
      return "earthSurfaceTop";
    }

    if (face === "negY") {
      return "earthSurfaceBottom";
    }

    return "earthSurfaceSide";
  }

  if (profile === "earthSubsoil") {
    return "earthSubsoil";
  }

  return "darkness";
};

export const getTerrainChunkMaterials = () => terrainMaterialOrder.map((key) => terrainMaterialsByKey[key]);

export const cloneTerrainChunkMaterials = () =>
  terrainMaterialOrder.map((key) => {
    const clone = terrainMaterialsByKey[key].clone();
    if (!(clone instanceof THREE.MeshStandardMaterial)) {
      throw new Error(`Expected MeshStandardMaterial for ${key} terrain material clone.`);
    }

    return clone;
  });
