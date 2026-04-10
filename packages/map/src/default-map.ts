import { getMapPropHeight, getMapPropVoxels, isMapPropInBounds } from "./props";
import type { MapDocumentV1, MapProp, VoxelCell } from "./types";
import { cloneMapDocument, createVoxelKey } from "./utils";

const now = () => new Date().toISOString();

const DEFAULT_SPAWN_MARGIN_RATIO = 28.5 / 200;
const DEFAULT_ARENA_CORNER_RADIUS_RATIO = 0.225;
const DEFAULT_DEFAULT_SPAWN_PAD_RATIO = 0.2;
const DEFAULT_MOUNTAIN_FALLOFF_RADIUS = 16;
const DEFAULT_ARENA_RIM_WIDTH = 11;
const DEFAULT_BORDER_WIDTH_VARIATION = 3;
const DEFAULT_RIM_HEIGHT_VARIATION = 1.15;
const DEFAULT_OUTER_WATER_MARGIN = 4;
const DEFAULT_TREE_COUNT = 42;
const DEFAULT_TREE_MIN_SPACING = 4.5;
const DEFAULT_TREE_SPAWN_BUFFER = 2;
const DEFAULT_TREE_SUMMIT_BUFFER = 4;
const DEFAULT_TREE_POND_BUFFER = 2;
const DEFAULT_TREE_SIDE_MOUNTAIN_BUFFER = 2;
const TREE_EDGE_WEIGHT_DISTANCE = 20;
const DEFAULT_POND_CENTER_RATIO = 0.1125;
const DEFAULT_POND_HALF_SIZE = 4;
const DEFAULT_POND_SHORE_BUFFER = 1;
const DEFAULT_SIDE_MOUNTAIN_HALF_WIDTH = 5.5;
const DEFAULT_SIDE_MOUNTAIN_RISE = 5;
const DEFAULT_TREE_KINDS = ["tree-oak", "tree-pine", "tree-autumn"] as const;

const snapToVoxelCenter = (value: number) => Math.round(value - 0.5) + 0.5;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const lerp = (start: number, end: number, alpha: number) => start + (end - start) * alpha;
const smoothstep01 = (value: number) => value * value * (3 - 2 * value);

const getArenaSpawnOffset = (axisSize: number) => {
  if (axisSize <= 0) {
    return 0.5;
  }

  const maxOffset = Math.max(0.5, axisSize / 2 - 0.5);
  return Math.min(snapToVoxelCenter(axisSize * DEFAULT_SPAWN_MARGIN_RATIO), maxOffset);
};

const isSpawnInBounds = (documentSize: MapDocumentV1["size"], spawn: MapDocumentV1["spawns"][number]) =>
  spawn.x >= 0 &&
  spawn.x < documentSize.x &&
  spawn.y >= 0 &&
  spawn.y < documentSize.y &&
  spawn.z >= 0 &&
  spawn.z < documentSize.z;

const hashString = (value: string) => {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
};

const createDeterministicRandom = (seed: string) => {
  let state = hashString(seed) || 1;

  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

export const MAX_PLAYABLE_ARENA_WIDTH = 80;
export const MAX_PLAYABLE_ARENA_DEPTH = 80;
export const DEFAULT_ARENA_WIDTH = MAX_PLAYABLE_ARENA_WIDTH;
export const DEFAULT_ARENA_HEIGHT = 32;
export const DEFAULT_ARENA_DEPTH = MAX_PLAYABLE_ARENA_DEPTH;
export const DEFAULT_FOUNDATION_DEPTH = 5;
export const DEFAULT_SURFACE_Y = DEFAULT_FOUNDATION_DEPTH;
export const DEFAULT_GROUND_TOP_Y = DEFAULT_SURFACE_Y - 1;
export const WORLD_FLOOR_Y = 0;
export const SEA_LEVEL_Y = WORLD_FLOOR_Y;
export const DEFAULT_WATERLINE_Y = Math.max(WORLD_FLOOR_Y, DEFAULT_GROUND_TOP_Y - 1);
export const DEFAULT_WATER_TABLE_Y = DEFAULT_WATERLINE_Y;
export const DEFAULT_BOUNDARY_HEIGHT = 4;
export const DEFAULT_SUMMIT_PAD_SIZE = 6;
export const DEFAULT_SPAWN_PAD_SIZE = 5;
export const DEFAULT_MOUNTAIN_PEAK_RISE = 7;
export const DEFAULT_RIM_PEAK_RISE = 6;

let cachedDefaultArenaTemplate: MapDocumentV1 | null = null;

const getRoundedCornerRadius = (size: MapDocumentV1["size"]) => {
  const maxRadius = Math.max(4, Math.floor(Math.min(size.x, size.z) / 2) - 2);
  return clamp(Math.round(Math.min(size.x, size.z) * DEFAULT_ARENA_CORNER_RADIUS_RATIO), 8, maxRadius);
};

const normalizedHash = (value: string) => hashString(value) / 4294967295;

const sampleSignedNoise = (
  seed: string,
  x: number,
  z: number,
  coarseScale: number,
  detailScale: number
) => {
  const sampleLayer = (layerSeed: string, scale: number) => {
    const scaledX = x / scale;
    const scaledZ = z / scale;
    const originX = Math.floor(scaledX);
    const originZ = Math.floor(scaledZ);
    const localX = smoothstep01(scaledX - originX);
    const localZ = smoothstep01(scaledZ - originZ);

    const sample = (sampleX: number, sampleZ: number) =>
      normalizedHash(`${layerSeed}:${sampleX}:${sampleZ}`) * 2 - 1;

    const top = lerp(sample(originX, originZ), sample(originX + 1, originZ), localX);
    const bottom = lerp(sample(originX, originZ + 1), sample(originX + 1, originZ + 1), localX);
    return lerp(top, bottom, localZ);
  };

  return clamp(
    sampleLayer(`${seed}:coarse`, coarseScale) * 0.72 +
      sampleLayer(`${seed}:detail`, detailScale) * 0.28,
    -1,
    1
  );
};

const distanceToRect = (
  x: number,
  z: number,
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
) => {
  const deltaX = Math.max(bounds.minX - x, 0, x - bounds.maxX);
  const deltaZ = Math.max(bounds.minZ - z, 0, z - bounds.maxZ);
  return Math.hypot(deltaX, deltaZ);
};

const getBaseFootprintSignedDistance = (size: MapDocumentV1["size"], x: number, z: number) => {
  const radius = getRoundedCornerRadius(size);
  const centerX = x + 0.5 - size.x / 2;
  const centerZ = z + 0.5 - size.z / 2;
  const innerHalfWidth = size.x / 2 - radius;
  const innerHalfDepth = size.z / 2 - radius;
  const qx = Math.abs(centerX) - innerHalfWidth;
  const qz = Math.abs(centerZ) - innerHalfDepth;
  const outsideX = Math.max(qx, 0);
  const outsideZ = Math.max(qz, 0);

  return Math.hypot(outsideX, outsideZ) + Math.min(Math.max(qx, qz), 0) - radius;
};

export const getDefaultArenaSummitBounds = (size: MapDocumentV1["size"]) => {
  const minX = Math.max(0, Math.floor((size.x - DEFAULT_SUMMIT_PAD_SIZE) / 2));
  const minZ = Math.max(0, Math.floor((size.z - DEFAULT_SUMMIT_PAD_SIZE) / 2));
  return {
    minX,
    maxX: Math.min(size.x - 1, minX + DEFAULT_SUMMIT_PAD_SIZE - 1),
    minZ,
    maxZ: Math.min(size.z - 1, minZ + DEFAULT_SUMMIT_PAD_SIZE - 1)
  };
};

const getDefaultArenaNorthEntryColumn = (size: MapDocumentV1["size"]) => {
  const centerX = clamp(Math.floor(size.x / 2), 0, Math.max(0, size.x - 1));

  for (let z = 0; z < size.z; z += 1) {
    if (isInsideDefaultArenaFootprint(size, centerX, z)) {
      return { x: centerX, z };
    }
  }

  return null;
};

const isInsideRect = (
  bounds: ReturnType<typeof getDefaultArenaSummitBounds> | { minX: number; maxX: number; minZ: number; maxZ: number },
  x: number,
  z: number
) => x >= bounds.minX && x <= bounds.maxX && z >= bounds.minZ && z <= bounds.maxZ;

const isInsideExpandedRect = (
  bounds: ReturnType<typeof getDefaultArenaSummitBounds> | { minX: number; maxX: number; minZ: number; maxZ: number },
  x: number,
  z: number,
  buffer: number
) =>
  x >= bounds.minX - buffer &&
  x <= bounds.maxX + buffer &&
  z >= bounds.minZ - buffer &&
  z <= bounds.maxZ + buffer;

export const getDefaultArenaPondBounds = (size: MapDocumentV1["size"]) => {
  const centerX = clamp(
    Math.round(size.x * DEFAULT_POND_CENTER_RATIO),
    DEFAULT_POND_HALF_SIZE + 3,
    Math.max(DEFAULT_POND_HALF_SIZE + 3, Math.floor(size.x / 2) - DEFAULT_POND_HALF_SIZE - 5)
  );
  const centerZ = clamp(
    Math.round(size.z * DEFAULT_POND_CENTER_RATIO),
    DEFAULT_POND_HALF_SIZE + 3,
    Math.max(DEFAULT_POND_HALF_SIZE + 3, Math.floor(size.z / 2) - DEFAULT_POND_HALF_SIZE - 5)
  );

  return {
    minX: centerX - DEFAULT_POND_HALF_SIZE,
    maxX: centerX + DEFAULT_POND_HALF_SIZE,
    minZ: centerZ - DEFAULT_POND_HALF_SIZE,
    maxZ: centerZ + DEFAULT_POND_HALF_SIZE
  };
};

const getDistanceToSegment = (
  pointX: number,
  pointZ: number,
  startX: number,
  startZ: number,
  endX: number,
  endZ: number
) => {
  const segmentX = endX - startX;
  const segmentZ = endZ - startZ;
  const segmentLengthSquared = segmentX * segmentX + segmentZ * segmentZ;

  if (segmentLengthSquared <= Number.EPSILON) {
    return {
      distance: Math.hypot(pointX - startX, pointZ - startZ),
      t: 0
    };
  }

  const t = clamp(
    ((pointX - startX) * segmentX + (pointZ - startZ) * segmentZ) / segmentLengthSquared,
    0,
    1
  );
  const closestX = startX + segmentX * t;
  const closestZ = startZ + segmentZ * t;
  return {
    distance: Math.hypot(pointX - closestX, pointZ - closestZ),
    t
  };
};

const getSideMountainMetrics = (size: MapDocumentV1["size"], x: number, z: number) => {
  const northEntry = getDefaultArenaNorthEntryColumn(size);
  if (!northEntry) {
    return null;
  }

  const summitBounds = getDefaultArenaSummitBounds(size);
  return getDistanceToSegment(
    x + 0.5,
    z + 0.5,
    northEntry.x + 0.5,
    northEntry.z + 0.5,
    northEntry.x + 0.5,
    summitBounds.minZ + 0.5
  );
};

const getSideMountainRiseAt = (size: MapDocumentV1["size"], x: number, z: number) => {
  const metrics = getSideMountainMetrics(size, x, z);
  if (!metrics || metrics.distance >= DEFAULT_SIDE_MOUNTAIN_HALF_WIDTH) {
    return 0;
  }

  const crossSection = smoothstep01(clamp(1 - metrics.distance / DEFAULT_SIDE_MOUNTAIN_HALF_WIDTH, 0, 1));
  const startFade = smoothstep01(clamp(metrics.t / 0.12, 0, 1));
  const endFade = smoothstep01(clamp((1 - metrics.t) / 0.1, 0, 1));
  const alongRidge = Math.min(startFade, endFade) * lerp(0.76, 1, metrics.t);

  return Math.max(0, Math.round(DEFAULT_SIDE_MOUNTAIN_RISE * crossSection * alongRidge));
};

const isInsideSideMountainBuffer = (size: MapDocumentV1["size"], x: number, z: number, buffer: number) => {
  const metrics = getSideMountainMetrics(size, x, z);
  return metrics !== null && metrics.distance <= DEFAULT_SIDE_MOUNTAIN_HALF_WIDTH + buffer;
};

const getProtectedBorderNoiseFade = (size: MapDocumentV1["size"], x: number, z: number) => {
  const summitBounds = getDefaultArenaSummitBounds(size);
  const pondBounds = getDefaultArenaPondBounds(size);
  const spawnDistance = Math.min(
    ...getDefaultArenaSpawnPadBounds(size).map((bounds) => distanceToRect(x, z, bounds))
  );
  const summitDistance = distanceToRect(x, z, summitBounds);
  const pondDistance = distanceToRect(x, z, pondBounds);

  return Math.min(
    smoothstep01(clamp(spawnDistance / 5, 0, 1)),
    smoothstep01(clamp(summitDistance / 7, 0, 1)),
    smoothstep01(clamp(pondDistance / (4 + DEFAULT_POND_SHORE_BUFFER), 0, 1))
  );
};

const getFootprintSignedDistance = (size: MapDocumentV1["size"], x: number, z: number) => {
  const baseDistance = getBaseFootprintSignedDistance(size, x, z);
  const borderNoise =
    sampleSignedNoise(
      `default-arena-footprint:${size.x}:${size.z}`,
      x + 0.5,
      z + 0.5,
      10.5,
      5.25
    ) *
    DEFAULT_BORDER_WIDTH_VARIATION *
    getProtectedBorderNoiseFade(size, x, z);

  return baseDistance + DEFAULT_OUTER_WATER_MARGIN - borderNoise;
};

const getDefaultSpawnPadCenters = (size: MapDocumentV1["size"]) => {
  const centerX = clamp(Math.round(size.x * DEFAULT_DEFAULT_SPAWN_PAD_RATIO), 2, Math.max(2, size.x - 3));
  const centerZ = clamp(Math.round(size.z * DEFAULT_DEFAULT_SPAWN_PAD_RATIO), 2, Math.max(2, size.z - 3));

  return [
    { id: "spawn-1", x: centerX, z: centerZ },
    { id: "spawn-2", x: size.x - 1 - centerX, z: centerZ },
    { id: "spawn-3", x: centerX, z: size.z - 1 - centerZ },
    { id: "spawn-4", x: size.x - 1 - centerX, z: size.z - 1 - centerZ }
  ];
};

export const getDefaultArenaSpawnPadBounds = (size: MapDocumentV1["size"]) => {
  const halfPad = Math.floor(DEFAULT_SPAWN_PAD_SIZE / 2);
  return getDefaultSpawnPadCenters(size).map((center) => ({
    id: center.id,
    minX: clamp(center.x - halfPad, 0, size.x - 1),
    maxX: clamp(center.x + halfPad, 0, size.x - 1),
    minZ: clamp(center.z - halfPad, 0, size.z - 1),
    maxZ: clamp(center.z + halfPad, 0, size.z - 1)
  }));
};

export const isInsideDefaultArenaFootprint = (size: MapDocumentV1["size"], x: number, z: number) => {
  if (x < 0 || x >= size.x || z < 0 || z >= size.z) {
    return false;
  }

  return getFootprintSignedDistance(size, x, z) <= 0;
};

const getMountainRiseAt = (size: MapDocumentV1["size"], x: number, z: number) => {
  const summitBounds = getDefaultArenaSummitBounds(size);
  if (isInsideRect(summitBounds, x, z)) {
    return DEFAULT_MOUNTAIN_PEAK_RISE;
  }

  const plateauHalfExtent = DEFAULT_SUMMIT_PAD_SIZE / 2 - 0.5;
  const centerX = size.x / 2;
  const centerZ = size.z / 2;
  const distanceX = Math.max(0, Math.abs(x + 0.5 - centerX) - plateauHalfExtent);
  const distanceZ = Math.max(0, Math.abs(z + 0.5 - centerZ) - plateauHalfExtent);
  const distance = Math.hypot(distanceX, distanceZ);

  if (distance >= DEFAULT_MOUNTAIN_FALLOFF_RADIUS) {
    return 0;
  }

  const normalized = 1 - distance / DEFAULT_MOUNTAIN_FALLOFF_RADIUS;
  const eased = normalized * normalized * (3 - 2 * normalized);
  return Math.max(0, Math.round(DEFAULT_MOUNTAIN_PEAK_RISE * eased));
};

const getRimRiseAt = (size: MapDocumentV1["size"], x: number, z: number) => {
  if (!isInsideDefaultArenaFootprint(size, x, z)) {
    return 0;
  }

  const inwardDistance = Math.max(0, -getFootprintSignedDistance(size, x, z));
  if (inwardDistance >= DEFAULT_ARENA_RIM_WIDTH) {
    return 0;
  }

  const normalized = 1 - inwardDistance / DEFAULT_ARENA_RIM_WIDTH;
  const eased = normalized * normalized * (3 - 2 * normalized);
  const rimNoise =
    Math.round(
      sampleSignedNoise(
        `default-arena-rim:${size.x}:${size.z}`,
        x + 0.5,
        z + 0.5,
        9,
        4.5
      ) *
        DEFAULT_RIM_HEIGHT_VARIATION *
        getProtectedBorderNoiseFade(size, x, z)
    );
  return Math.max(0, Math.round(DEFAULT_RIM_PEAK_RISE * eased) + rimNoise);
};

const getPondFloorY = (size: MapDocumentV1["size"], x: number, z: number) => {
  const bounds = getDefaultArenaPondBounds(size);
  if (!isInsideRect(bounds, x, z)) {
    return null;
  }

  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerZ = (bounds.minZ + bounds.maxZ) / 2;
  const ringDistance = Math.max(Math.abs(x - centerX), Math.abs(z - centerZ));

  if (ringDistance <= 2) {
    return WORLD_FLOOR_Y;
  }

  if (ringDistance <= 3) {
    return Math.max(WORLD_FLOOR_Y, DEFAULT_WATERLINE_Y - 2);
  }

  return Math.max(WORLD_FLOOR_Y, DEFAULT_WATERLINE_Y - 1);
};

export const getDefaultArenaColumnTopY = (size: MapDocumentV1["size"], x: number, z: number) => {
  if (!isInsideDefaultArenaFootprint(size, x, z)) {
    return -1;
  }

  if (getDefaultArenaSpawnPadBounds(size).some((bounds) => isInsideRect(bounds, x, z))) {
    return DEFAULT_GROUND_TOP_Y;
  }

  const surfaceTopY =
    DEFAULT_GROUND_TOP_Y +
    getMountainRiseAt(size, x, z) +
    getSideMountainRiseAt(size, x, z) +
    getRimRiseAt(size, x, z);
  const pondFloorY = getPondFloorY(size, x, z);
  return pondFloorY === null ? surfaceTopY : Math.min(surfaceTopY, pondFloorY);
};

const isBoundaryColumn = (size: MapDocumentV1["size"], x: number, z: number) =>
  isInsideDefaultArenaFootprint(size, x, z) &&
  (
    !isInsideDefaultArenaFootprint(size, x - 1, z) ||
    !isInsideDefaultArenaFootprint(size, x + 1, z) ||
    !isInsideDefaultArenaFootprint(size, x, z - 1) ||
    !isInsideDefaultArenaFootprint(size, x, z + 1)
  );

export const createArenaCornerSpawns = (size: MapDocumentV1["size"]) => {
  if (size.x <= 0 || size.y <= 0 || size.z <= 0) {
    return [];
  }

  const xOffset = getArenaSpawnOffset(size.x);
  const zOffset = getArenaSpawnOffset(size.z);
  const surfaceY = Math.min(DEFAULT_SURFACE_Y, size.y - 1) + 0.05;

  return [
    { id: "spawn-1", x: xOffset, y: surfaceY, z: zOffset },
    { id: "spawn-2", x: size.x - xOffset, y: surfaceY, z: zOffset },
    { id: "spawn-3", x: xOffset, y: surfaceY, z: size.z - zOffset },
    { id: "spawn-4", x: size.x - xOffset, y: surfaceY, z: size.z - zOffset }
  ];
};

export const createDefaultArenaSpawns = (size: MapDocumentV1["size"]) =>
  getDefaultSpawnPadCenters(size).map((spawn) => ({
    id: spawn.id,
    x: spawn.x + 0.5,
    y: getDefaultArenaColumnTopY(size, spawn.x, spawn.z) + 1.05,
    z: spawn.z + 0.5
  }));

const normalizeArenaProps = (document: MapDocumentV1) => {
  const terrainOccupancy = new Set(document.voxels.map((voxel) => createVoxelKey(voxel.x, voxel.y, voxel.z)));
  const propOccupancy = new Set<string>();
  const acceptedProps: MapProp[] = [];

  for (const prop of document.props) {
    if (!isMapPropInBounds(document.size, prop)) {
      continue;
    }

    if (
      document.spawns.some((spawn) => Math.floor(spawn.x) === prop.x && Math.floor(spawn.z) === prop.z)
    ) {
      continue;
    }

    if (!terrainOccupancy.has(createVoxelKey(prop.x, prop.y - 1, prop.z))) {
      continue;
    }

    const propVoxels = getMapPropVoxels(prop);
    if (propVoxels.some((voxel) => terrainOccupancy.has(createVoxelKey(voxel.x, voxel.y, voxel.z)))) {
      continue;
    }

    if (propVoxels.some((voxel) => propOccupancy.has(createVoxelKey(voxel.x, voxel.y, voxel.z)))) {
      continue;
    }

    acceptedProps.push({ ...prop });
    for (const voxel of propVoxels) {
      propOccupancy.add(createVoxelKey(voxel.x, voxel.y, voxel.z));
    }
  }

  document.props = acceptedProps;
};

export const normalizeArenaBudgetMapDocument = (document: MapDocumentV1): MapDocumentV1 => {
  const normalized = cloneMapDocument(document);

  normalized.size = {
    ...normalized.size,
    x: Math.min(normalized.size.x, MAX_PLAYABLE_ARENA_WIDTH),
    z: Math.min(normalized.size.z, MAX_PLAYABLE_ARENA_DEPTH)
  };
  normalized.voxels = normalized.voxels.filter(
    (voxel) =>
      voxel.x >= 0 &&
      voxel.x < normalized.size.x &&
      voxel.y >= 0 &&
      voxel.y < normalized.size.y &&
      voxel.z >= 0 &&
      voxel.z < normalized.size.z
  );
  normalized.spawns = normalized.spawns.filter((spawn) => isSpawnInBounds(normalized.size, spawn));

  if (normalized.spawns.length === 0) {
    normalized.spawns = createArenaCornerSpawns(normalized.size);
  }

  normalizeArenaProps(normalized);

  return normalized;
};

const buildDefaultTreeSeedCandidates = (size: MapDocumentV1["size"]) => {
  const summitBounds = getDefaultArenaSummitBounds(size);
  const spawnPadBounds = getDefaultArenaSpawnPadBounds(size);
  const pondBounds = getDefaultArenaPondBounds(size);
  const treeHeight = Math.max(...DEFAULT_TREE_KINDS.map((kind) => getMapPropHeight(kind)));
  const candidates: Array<{ x: number; y: number; z: number; weight: number }> = [];

  for (let x = 0; x < size.x; x += 1) {
    for (let z = 0; z < size.z; z += 1) {
      const topY = getDefaultArenaColumnTopY(size, x, z);
      if (topY < 0 || topY + treeHeight >= size.y || isBoundaryColumn(size, x, z)) {
        continue;
      }

      if (spawnPadBounds.some((bounds) => isInsideExpandedRect(bounds, x, z, DEFAULT_TREE_SPAWN_BUFFER))) {
        continue;
      }

      if (isInsideExpandedRect(summitBounds, x, z, DEFAULT_TREE_SUMMIT_BUFFER)) {
        continue;
      }

      if (isInsideExpandedRect(pondBounds, x, z, DEFAULT_TREE_POND_BUFFER + DEFAULT_POND_SHORE_BUFFER)) {
        continue;
      }

      if (isInsideSideMountainBuffer(size, x, z, DEFAULT_TREE_SIDE_MOUNTAIN_BUFFER)) {
        continue;
      }

      const inwardDistance = Math.max(0, -getFootprintSignedDistance(size, x, z));
      const edgeBias = 1 - Math.min(1, inwardDistance / TREE_EDGE_WEIGHT_DISTANCE);
      const weight = 1 + edgeBias * edgeBias * 24;
      candidates.push({
        x,
        y: topY + 1,
        z,
        weight
      });
    }
  }

  return candidates;
};

const pickDefaultArenaTreeKind = (
  size: MapDocumentV1["size"],
  candidate: { x: number; y: number; z: number }
) => {
  const inwardDistance = Math.max(0, -getFootprintSignedDistance(size, candidate.x, candidate.z));
  const edgeBias = 1 - Math.min(1, inwardDistance / TREE_EDGE_WEIGHT_DISTANCE);
  const elevationBias = clamp(
    (candidate.y - DEFAULT_SURFACE_Y) / Math.max(1, DEFAULT_MOUNTAIN_PEAK_RISE),
    0,
    1
  );
  const autumnPatch = sampleSignedNoise("default-arena-autumn", candidate.x + 0.5, candidate.z + 0.5, 13, 6);
  const pineRoll = normalizedHash(`default-arena-tree-pine:${candidate.x}:${candidate.z}`);
  const autumnRoll = normalizedHash(`default-arena-tree-autumn:${candidate.x}:${candidate.z}`);

  if (
    autumnPatch > 0.18 &&
    edgeBias < 0.72 &&
    elevationBias < 0.76 &&
    autumnRoll < clamp(0.36 + autumnPatch * 0.2, 0.26, 0.62)
  ) {
    return "tree-autumn" as const;
  }

  const pineChance = clamp(0.16 + edgeBias * 0.42 + elevationBias * 0.2, 0.16, 0.7);
  if (pineRoll < pineChance) {
    return "tree-pine" as const;
  }

  return "tree-oak" as const;
};

const createDefaultArenaTreeProps = (size: MapDocumentV1["size"], voxels: readonly VoxelCell[]) => {
  const terrainOccupancy = new Set(voxels.map((voxel) => createVoxelKey(voxel.x, voxel.y, voxel.z)));
  const propOccupancy = new Set<string>();
  const random = createDeterministicRandom(`default-arena-trees:${size.x}:${size.y}:${size.z}`);
  const pool = buildDefaultTreeSeedCandidates(size);
  const props: MapProp[] = [];

  while (props.length < DEFAULT_TREE_COUNT && pool.length > 0) {
    const totalWeight = pool.reduce((sum, candidate) => sum + candidate.weight, 0);
    let roll = random() * totalWeight;
    let selectedIndex = pool.length - 1;

    for (let index = 0; index < pool.length; index += 1) {
      roll -= pool[index]!.weight;
      if (roll <= 0) {
        selectedIndex = index;
        break;
      }
    }

    const [candidate] = pool.splice(selectedIndex, 1);
    if (!candidate) {
      continue;
    }

    if (
      props.some((prop) => Math.hypot(prop.x - candidate.x, prop.z - candidate.z) < DEFAULT_TREE_MIN_SPACING)
    ) {
      continue;
    }

    const nextProp: MapProp = {
      id: `prop-${props.length + 1}`,
      kind: pickDefaultArenaTreeKind(size, candidate),
      x: candidate.x,
      y: candidate.y,
      z: candidate.z
    };

    if (!isMapPropInBounds(size, nextProp)) {
      continue;
    }

    const propVoxels = getMapPropVoxels(nextProp);
    if (propVoxels.some((voxel) => terrainOccupancy.has(createVoxelKey(voxel.x, voxel.y, voxel.z)))) {
      continue;
    }

    if (propVoxels.some((voxel) => propOccupancy.has(createVoxelKey(voxel.x, voxel.y, voxel.z)))) {
      continue;
    }

    props.push(nextProp);
    for (const voxel of propVoxels) {
      propOccupancy.add(createVoxelKey(voxel.x, voxel.y, voxel.z));
    }
  }

  return props;
};

const buildDefaultArenaTemplate = (): MapDocumentV1 => {
  const voxels: VoxelCell[] = [];
  const size = {
    x: DEFAULT_ARENA_WIDTH,
    y: DEFAULT_ARENA_HEIGHT,
    z: DEFAULT_ARENA_DEPTH
  };
  const seenColumns = new Set<string>();

  const pushVoxel = (x: number, y: number, z: number, kind: VoxelCell["kind"]) => {
    if (y < 0 || y >= size.y) {
      return;
    }

    const key = `${x}:${y}:${z}`;
    if (seenColumns.has(key)) {
      return;
    }

    seenColumns.add(key);
    voxels.push({ x, y, z, kind });
  };

  for (let x = 0; x < size.x; x += 1) {
    for (let z = 0; z < size.z; z += 1) {
      const topY = getDefaultArenaColumnTopY(size, x, z);
      if (topY < 0) {
        for (let y = WORLD_FLOOR_Y; y <= DEFAULT_WATERLINE_Y; y += 1) {
          pushVoxel(x, y, z, "water");
        }
        continue;
      }

      for (let y = WORLD_FLOOR_Y; y <= topY; y += 1) {
        pushVoxel(x, y, z, "ground");
      }

      if (topY < DEFAULT_WATERLINE_Y) {
        for (let y = topY + 1; y <= DEFAULT_WATERLINE_Y; y += 1) {
          pushVoxel(x, y, z, "water");
        }
      }

      if (!isBoundaryColumn(size, x, z)) {
        continue;
      }

      for (let y = topY + 1; y <= topY + DEFAULT_BOUNDARY_HEIGHT; y += 1) {
        pushVoxel(x, y, z, "boundary");
      }
    }
  }

  const props = createDefaultArenaTreeProps(size, voxels);

  return {
    version: 1,
    meta: {
      name: "Default Arena",
      description: "A compact arena with a raised outer rim, curved corners, a central summit, and grassy terrain for runtime play.",
      theme: "party-grass",
      createdAt: "1970-01-01T00:00:00.000Z",
      updatedAt: "1970-01-01T00:00:00.000Z"
    },
    size,
    boundary: {
      fallY: -1
    },
    spawns: createDefaultArenaSpawns(size),
    props,
    voxels
  };
};

export const createDefaultArenaMap = (): MapDocumentV1 => {
  cachedDefaultArenaTemplate ??= buildDefaultArenaTemplate();
  const document = cloneMapDocument(cachedDefaultArenaTemplate);
  const timestamp = now();
  document.meta.createdAt = timestamp;
  document.meta.updatedAt = timestamp;
  return document;
};
