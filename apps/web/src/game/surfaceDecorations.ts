import { getMapPropFootprint, type MutableVoxelWorld } from "@out-of-bounds/map";

export type SurfaceDecorationKind = "grass" | "flower-yellow" | "flower-pink" | "flower-white";

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

const DECORATION_DENSITY = 0.07;
const MIN_GRASS_SPACING = 1.7;
const MIN_FLOWER_SPACING = 2.2;

const hashString = (value: string) => {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
};

const normalizedHash = (value: string) => hashString(value) / 4294967295;

const addBufferedColumn = (blockedColumns: Set<string>, x: number, z: number, buffer: number) => {
  for (let dx = -buffer; dx <= buffer; dx += 1) {
    for (let dz = -buffer; dz <= buffer; dz += 1) {
      blockedColumns.add(`${x + dx}:${z + dz}`);
    }
  }
};

const flowerKindByHash = (value: number): SurfaceDecorationKind =>
  value < 0.333 ? "flower-yellow" : value < 0.666 ? "flower-pink" : "flower-white";

const createDecorationCandidate = (x: number, y: number, z: number): DecorationCandidate | null => {
  const placementRoll = normalizedHash(`flora-placement:${x}:${z}`);
  if (placementRoll > DECORATION_DENSITY) {
    return null;
  }

  const flowerRoll = normalizedHash(`flora-flower-roll:${x}:${z}`);
  const kind =
    flowerRoll < 0.82
      ? "grass"
      : flowerKindByHash(normalizedHash(`flora-flower-kind:${x}:${z}`));

  return {
    x,
    y,
    z,
    priority: normalizedHash(`flora-priority:${x}:${z}`),
    offsetX: normalizedHash(`flora-offset-x:${x}:${z}`) * 0.82 - 0.41,
    offsetZ: normalizedHash(`flora-offset-z:${x}:${z}`) * 0.82 - 0.41,
    rotation: normalizedHash(`flora-rotation:${x}:${z}`) * Math.PI * 2,
    scale: Number((0.78 + normalizedHash(`flora-scale:${x}:${z}`) * 0.34).toFixed(2)),
    kind,
    spacing: kind === "grass" ? MIN_GRASS_SPACING : MIN_FLOWER_SPACING
  };
};

export const buildSurfaceDecorations = (world: MutableVoxelWorld): SurfaceDecoration[] => {
  const blockedColumns = new Set<string>();

  for (const spawn of world.listSpawns()) {
    addBufferedColumn(blockedColumns, Math.floor(spawn.x), Math.floor(spawn.z), 1);
  }

  for (const prop of world.listProps()) {
    for (const cell of getMapPropFootprint(prop)) {
      addBufferedColumn(blockedColumns, cell.x, cell.z, 1);
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
    if (
      decorations.some((decoration) => {
        const decorationSpacing = decoration.kind === "grass" ? MIN_GRASS_SPACING : MIN_FLOWER_SPACING;
        return Math.hypot(decoration.x - actualX, decoration.z - actualZ) < Math.max(candidate.spacing, decorationSpacing);
      })
    ) {
      continue;
    }

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
