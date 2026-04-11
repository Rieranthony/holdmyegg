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

export const getBlockRenderProfile = (
  kind: BlockKind,
  y: number,
  surfaceDepth?: number
) => {
  if (kind === "hazard") {
    return "darkness" satisfies BlockRenderProfile;
  }

  if (kind === "ground" && surfaceDepth !== undefined) {
    return surfaceDepth === 0 ? "earthSurface" : "earthSubsoil";
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
  Q: "#316e9f",
  f: "#c7efff",
  F: "#f4fdff",
  "0": "#000000"
} as const;

const hexToRgb = (hex: string) => {
  const normalized = hex.replace("#", "");
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16)
  };
};

export const createPixelTexture = (
  rows: readonly string[],
  { transparentTokens = [] as readonly string[] } = {}
) => {
  const data = new Uint8Array(PIXEL_TEXTURE_SIZE * PIXEL_TEXTURE_SIZE * 4);
  const transparentTokenSet = new Set(transparentTokens);

  rows.forEach((row, y) => {
    [...row].forEach((token, x) => {
      if (transparentTokenSet.has(token)) {
        return;
      }

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
    "ghhgGghhgjGghhgG",
    "GghggGhggGhggGhj",
    "hggGjggGhggGhggG",
    "ggGhhgGjghhGgghg",
    "GghjgGhjgGhgGghg",
    "hgGghjGgGhggGhGg",
    "gGhggGhGGjggGhhG",
    "GghgGghghGgGhggg",
    "ghhjGgghggGhGghg",
    "GghjGghggGhjgGhg",
    "hggGhggGhggjhhgG",
    "ggGhhgGggGhhgGhj",
    "GghjgGhgghGggGhg",
    "hgGghgGgGhjgGhGg",
    "gGhggGhGGhggGghj",
    "GghgGghghGgGjggg"
  ],
  earthSide: [
    "ghhgGghhjgghGghg",
    "GghjGGhhgGhjGGhh",
    "hgGghgGgGhggGhGg",
    "gGhggGhGGhggGhhG",
    "dDgddDdDedDgddDd",
    "DdDddDddedDddDdd",
    "ddDDeDdddDdDddDe",
    "DddDddDdeDdDddDd",
    "ddDddDdeDdDdeDde",
    "eDdDddDdDddDdeDd",
    "dDddDdDedDdDddDd",
    "DdDdeDddedDddDdd",
    "ddDDeDdddDdDddDd",
    "DddDddDdeDdDdeDd",
    "ddDddDdeedDddDde",
    "eDdDddDdDddDdeDd"
  ],
  earthBottom: [
    "dDddDdeDdDdDddDd",
    "DdDddDddedDdeDdd",
    "ddDDeDdddDdDddDe",
    "DddDddDdeDdDdeDd",
    "ddDddDdeDdDddDde",
    "eDdDdeDdDddDdeDd",
    "dDddDdDedDdDddDd",
    "DdDdeDddedDddDdd",
    "ddDDeDdddedDddDd",
    "DddDddDdeDdDdeDd",
    "ddDddDdeDdDddDde",
    "eDdDddDdDdeDdeDd",
    "dDddDdDedDdDddDe",
    "DdDddDddedDdeDdd",
    "ddDDeDdddDdDddDd",
    "DdeDddDdeDdDddDd"
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

const applyTerrainColumnTint = (material: THREE.MeshStandardMaterial, strength = 0.12) => {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 vTerrainWorldPosition;"
      )
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvTerrainWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;"
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        [
          "#include <common>",
          "varying vec3 vTerrainWorldPosition;",
          "float terrainHash(vec2 p) {",
          "  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);",
          "}"
        ].join("\n")
      )
      .replace(
        "#include <color_fragment>",
        [
          "#include <color_fragment>",
          "vec2 terrainColumn = floor(vTerrainWorldPosition.xz + vec2(0.001));",
          "float terrainTintNoise = terrainHash(terrainColumn) - 0.5;",
          `diffuseColor.rgb *= 1.0 + terrainTintNoise * ${strength.toFixed(3)};`
        ].join("\n")
      );
  };
  material.customProgramCacheKey = () => `terrain-column-tint:${strength.toFixed(3)}`;
  return material;
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

const createTerrainMaterial = (
  texture: THREE.Texture,
  overrides: Partial<THREE.MeshStandardMaterialParameters> = {},
  columnTintStrength = 0.12
) =>
  applyTerrainColumnTint(
    createStandardMaterial(texture, {
      vertexColors: true,
      ...overrides
    }),
    columnTintStrength
  );

const terrainEarthSideMaterial = createTerrainMaterial(voxelTextures.earthSide, {}, 0.11);
const terrainEarthTopMaterial = createTerrainMaterial(voxelTextures.earthTop, {}, 0.14);
const terrainEarthBottomMaterial = createTerrainMaterial(voxelTextures.earthBottom, {}, 0.09);
const terrainEarthSubsoilMaterial = createTerrainMaterial(voxelTextures.earthBottom, {}, 0.07);
const terrainDarknessMaterial = createStandardMaterial(voxelTextures.darkness, { vertexColors: true });
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

const voxelEarthSideMaterial = createStandardMaterial(voxelTextures.earthSide);
const voxelEarthTopMaterial = createStandardMaterial(voxelTextures.earthTop);
const voxelEarthBottomMaterial = createStandardMaterial(voxelTextures.earthBottom);
const voxelEarthSubsoilMaterial = createStandardMaterial(voxelTextures.earthBottom);
const voxelDarknessMaterial = createStandardMaterial(voxelTextures.darkness);

export const voxelMaterialsByProfile: Record<BlockRenderProfile, THREE.MeshStandardMaterial[]> = {
  earthSurface: [
    voxelEarthSideMaterial,
    voxelEarthSideMaterial,
    voxelEarthTopMaterial,
    voxelEarthBottomMaterial,
    voxelEarthSideMaterial,
    voxelEarthSideMaterial
  ],
  earthSubsoil: [
    voxelEarthSubsoilMaterial,
    voxelEarthSubsoilMaterial,
    voxelEarthSubsoilMaterial,
    voxelEarthSubsoilMaterial,
    voxelEarthSubsoilMaterial,
    voxelEarthSubsoilMaterial
  ],
  darkness: [
    voxelDarknessMaterial,
    voxelDarknessMaterial,
    voxelDarknessMaterial,
    voxelDarknessMaterial,
    voxelDarknessMaterial,
    voxelDarknessMaterial
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
  earthSurfaceTop: terrainEarthTopMaterial,
  earthSurfaceSide: terrainEarthSideMaterial,
  earthSurfaceBottom: terrainEarthBottomMaterial,
  earthSubsoil: terrainEarthSubsoilMaterial,
  darkness: terrainDarknessMaterial,
  waterTop: waterTopMaterial,
  waterSide: waterSideMaterial
};

export const getTerrainMaterialIndex = (key: TerrainMaterialKey) => terrainMaterialIndexByKey[key];

export const getTerrainMaterialKey = (
  kind: BlockKind,
  y: number,
  face: ExposedFaceName,
  surfaceDepth?: number
): TerrainMaterialKey => {
  if (kind === "water") {
    return face === "posY" ? "waterTop" : "waterSide";
  }

  const profile = getBlockRenderProfile(kind, y, surfaceDepth);
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
