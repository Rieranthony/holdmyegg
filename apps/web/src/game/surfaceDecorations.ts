import { getMapPropFootprint, type MutableVoxelWorld } from "@out-of-bounds/map";

export type SurfaceDecorationKind =
  | "grass"
  | "flower-yellow"
  | "flower-pink"
  | "flower-white"
  | "flower-blue"
  | "bush-green"
  | "bush-dark"
  | "bush-autumn";

export interface SurfaceDecoration {
  id: string;
  kind: SurfaceDecorationKind;
  x: number;
  y: number;
  z: number;
  rotation: number;
  scale: number;
}

interface DecorationCandidate {
  x: number;
  y: number;
  z: number;
  priority: number;
  offsetX: number;
  offsetZ: number;
  rotation: number;
  scale: number;
  kind: SurfaceDecorationKind;
  spacing: number;
}

interface AcceptedDecorationEntry {
  x: number;
  z: number;
  spacing: number;
}

const DECORATION_DENSITY = 0.102;
const MIN_GRASS_SPACING = 1.6;
const MIN_FLOWER_SPACING = 2.02;
const MIN_BUSH_SPACING = 2.42;
const DECORATION_SPATIAL_HASH_CELL_SIZE = MIN_GRASS_SPACING;
const FLOWER_PATCH_SCALE = 5.5;
const BUSH_PATCH_SCALE = 8.25;

const hashString = (value: string) => {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
};

const normalizedHash = (value: string) => hashString(value) / 4294967295;
const lerp = (start: number, end: number, alpha: number) => start + (end - start) * alpha;
const smoothstep01 = (value: number) => value * value * (3 - 2 * value);

const addBufferedColumn = (blockedColumns: Set<string>, x: number, z: number, buffer: number) => {
  for (let dx = -buffer; dx <= buffer; dx += 1) {
    for (let dz = -buffer; dz <= buffer; dz += 1) {
      blockedColumns.add(`${x + dx}:${z + dz}`);
    }
  }
};

const flowerKindByHash = (value: number): SurfaceDecorationKind =>
  value < 0.25
    ? "flower-yellow"
    : value < 0.5
      ? "flower-pink"
      : value < 0.75
        ? "flower-white"
        : "flower-blue";

const bushKindByHash = (value: number): SurfaceDecorationKind =>
  value < 0.34 ? "bush-green" : value < 0.68 ? "bush-dark" : "bush-autumn";

const isBushDecorationKind = (kind: SurfaceDecorationKind) =>
  kind === "bush-green" || kind === "bush-dark" || kind === "bush-autumn";

const samplePatchNoise = (seed: string, x: number, z: number, scale: number) => {
  const scaledX = x / scale;
  const scaledZ = z / scale;
  const originX = Math.floor(scaledX);
  const originZ = Math.floor(scaledZ);
  const localX = smoothstep01(scaledX - originX);
  const localZ = smoothstep01(scaledZ - originZ);

  const sample = (sampleX: number, sampleZ: number) =>
    normalizedHash(`${seed}:${sampleX}:${sampleZ}`);

  const top = lerp(sample(originX, originZ), sample(originX + 1, originZ), localX);
  const bottom = lerp(sample(originX, originZ + 1), sample(originX + 1, originZ + 1), localX);
  return lerp(top, bottom, localZ);
};

const getDecorationCellCoord = (value: number) => Math.floor(value / DECORATION_SPATIAL_HASH_CELL_SIZE);
const getDecorationCellKey = (x: number, z: number) => `${x}:${z}`;

export const filterSurfaceDecorationsByDensity = (
  decorations: SurfaceDecoration[],
  density: number
) => {
  if (density >= 0.999) {
    return decorations;
  }

  return decorations.filter((decoration) => hashString(decoration.id) / 4294967295 <= density);
};

const canPlaceDecoration = (
  acceptedByCell: Map<string, AcceptedDecorationEntry[]>,
  x: number,
  z: number,
  spacing: number
) => {
  const cellX = getDecorationCellCoord(x);
  const cellZ = getDecorationCellCoord(z);
  const cellRadius = Math.ceil(
    Math.max(MIN_FLOWER_SPACING, MIN_BUSH_SPACING) / DECORATION_SPATIAL_HASH_CELL_SIZE
  );

  for (let dx = -cellRadius; dx <= cellRadius; dx += 1) {
    for (let dz = -cellRadius; dz <= cellRadius; dz += 1) {
      const cell = acceptedByCell.get(getDecorationCellKey(cellX + dx, cellZ + dz));
      if (!cell) {
        continue;
      }

      for (const decoration of cell) {
        if (Math.hypot(decoration.x - x, decoration.z - z) < Math.max(spacing, decoration.spacing)) {
          return false;
        }
      }
    }
  }

  return true;
};

const addAcceptedDecoration = (
  acceptedByCell: Map<string, AcceptedDecorationEntry[]>,
  decoration: AcceptedDecorationEntry
) => {
  const cellKey = getDecorationCellKey(
    getDecorationCellCoord(decoration.x),
    getDecorationCellCoord(decoration.z)
  );
  const cell = acceptedByCell.get(cellKey);
  if (cell) {
    cell.push(decoration);
    return;
  }

  acceptedByCell.set(cellKey, [decoration]);
};

const createDecorationCandidate = (x: number, y: number, z: number): DecorationCandidate | null => {
  const flowerPatchNoise = samplePatchNoise("flora-patch", x + 0.5, z + 0.5, FLOWER_PATCH_SCALE);
  const bushPatchNoise = samplePatchNoise("flora-bush-patch", x + 0.5, z + 0.5, BUSH_PATCH_SCALE);
  const placementRoll = normalizedHash(`flora-placement:${x}:${z}`);
  const placementDensity =
    DECORATION_DENSITY *
    lerp(0.8, 1.22, flowerPatchNoise * 0.62 + bushPatchNoise * 0.38);
  if (placementRoll > placementDensity) {
    return null;
  }

  const flowerRoll = normalizedHash(`flora-flower-roll:${x}:${z}`);
  const bushRoll = normalizedHash(`flora-bush-roll:${x}:${z}`);
  const flowerChance = lerp(0.22, 0.58, flowerPatchNoise);
  const bushChance = lerp(0.04, 0.26, bushPatchNoise) * lerp(0.95, 0.62, flowerPatchNoise);
  const kind =
    bushRoll < bushChance
      ? bushKindByHash(normalizedHash(`flora-bush-kind:${x}:${z}`))
      : flowerRoll < flowerChance
      ? flowerKindByHash(normalizedHash(`flora-flower-kind:${x}:${z}`))
      : "grass";
  const basePriority = normalizedHash(`flora-priority:${x}:${z}`);
  const isBush = isBushDecorationKind(kind);
  const scaleBase = kind === "grass" ? 0.76 : isBush ? 0.92 : 0.8;
  const scaleRange = kind === "grass" ? 0.3 : isBush ? 0.28 : 0.26;
  const offsetRange = kind === "grass" ? 0.82 : isBush ? 0.54 : 0.72;

  return {
    x,
    y,
    z,
    priority: kind === "grass" ? basePriority : isBush ? basePriority * 0.68 : basePriority * 0.78,
    offsetX: normalizedHash(`flora-offset-x:${x}:${z}`) * offsetRange - offsetRange / 2,
    offsetZ: normalizedHash(`flora-offset-z:${x}:${z}`) * offsetRange - offsetRange / 2,
    rotation: normalizedHash(`flora-rotation:${x}:${z}`) * Math.PI * 2,
    scale: Number((scaleBase + normalizedHash(`flora-scale:${x}:${z}`) * scaleRange).toFixed(2)),
    kind,
    spacing: kind === "grass" ? MIN_GRASS_SPACING : isBush ? MIN_BUSH_SPACING : MIN_FLOWER_SPACING
  };
};

export const buildSurfaceDecorations = (world: MutableVoxelWorld): SurfaceDecoration[] => {
  const blockedColumns = new Set<string>();
  const acceptedByCell = new Map<string, AcceptedDecorationEntry[]>();

  for (const spawn of world.listSpawns()) {
    addBufferedColumn(blockedColumns, Math.floor(spawn.x), Math.floor(spawn.z), 1);
  }

  for (const prop of world.listProps()) {
    for (const cell of getMapPropFootprint(prop)) {
      addBufferedColumn(blockedColumns, cell.x, cell.z, 1);
    }
  }

  for (let x = 0; x < world.size.x; x += 1) {
    for (let z = 0; z < world.size.z; z += 1) {
      if (world.getTopWaterY(x, z) > world.getTopGroundY(x, z)) {
        addBufferedColumn(blockedColumns, x, z, 1);
      }
    }
  }

  const decorations: SurfaceDecoration[] = [];
  const candidates: DecorationCandidate[] = [];

  for (let x = 0; x < world.size.x; x += 1) {
    for (let z = 0; z < world.size.z; z += 1) {
      if (blockedColumns.has(`${x}:${z}`)) {
        continue;
      }

      const topGroundY = world.getTopGroundY(x, z);
      if (topGroundY < 0 || world.getVoxelKind(x, topGroundY, z) !== "ground") {
        continue;
      }

      if (world.getTopSolidY(x, z) !== topGroundY) {
        continue;
      }

      if (world.getTopWaterY(x, z) > topGroundY) {
        continue;
      }

      const neighborHeights = [
        world.getTopGroundY(x - 1, z),
        world.getTopGroundY(x + 1, z),
        world.getTopGroundY(x, z - 1),
        world.getTopGroundY(x, z + 1)
      ];
      if (neighborHeights.some((height) => height < 0 || Math.abs(height - topGroundY) > 1)) {
        continue;
      }

      const candidate = createDecorationCandidate(x, topGroundY, z);
      if (candidate) {
        candidates.push(candidate);
      }
    }
  }

  candidates.sort((left, right) => left.priority - right.priority);

  for (const candidate of candidates) {
    const actualX = candidate.x + 0.5 + candidate.offsetX;
    const actualZ = candidate.z + 0.5 + candidate.offsetZ;
    if (!canPlaceDecoration(acceptedByCell, actualX, actualZ, candidate.spacing)) {
      continue;
    }

    addAcceptedDecoration(acceptedByCell, {
      x: actualX,
      z: actualZ,
      spacing: candidate.spacing
    });
    decorations.push({
      id: `flora:${candidate.x}:${candidate.z}`,
      kind: candidate.kind,
      x: actualX,
      y: candidate.y + 1.02,
      z: actualZ,
      rotation: candidate.rotation,
      scale: candidate.scale
    });
  }

  return decorations;
};
