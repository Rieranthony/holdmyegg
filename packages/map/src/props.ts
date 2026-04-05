import type { MapProp, MapPropKind, Vec3i } from "./types";

export type MapPropVoxelKind = "wood" | "leaves";

export interface MapPropVoxel {
  x: number;
  y: number;
  z: number;
  kind: MapPropVoxelKind;
}

const hashString = (value: string) => {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
};

interface TreeOakVariant {
  trunkHeight: number;
  canopy: ReadonlyArray<{ x: number; y: number; z: number }>;
}

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

const getTreeOakVariant = (prop: Pick<MapProp, "kind" | "x" | "y" | "z">): TreeOakVariant => {
  const seed = `tree-oak:${prop.x}:${prop.y}:${prop.z}`;
  const random = createDeterministicRandom(seed);
  const trunkHeight = 3 + Math.floor(random() * 3);
  const layerCount = 3 + Math.floor(random() * 2);
  const baseRadiusRoll = random();
  const baseRadius = baseRadiusRoll < 0.16 ? 1 : baseRadiusRoll < 0.8 ? 2 : 3;
  const leanX = random() < 0.58 ? (random() < 0.5 ? -1 : 1) : 0;
  const leanZ = random() < 0.58 ? (random() < 0.5 ? -1 : 1) : 0;
  const canopy = new Map<string, { x: number; y: number; z: number }>();

  const addLeaf = (x: number, y: number, z: number) => {
    if (x === 0 && z === 0 && y < trunkHeight) {
      return;
    }

    canopy.set(`${x}:${y}:${z}`, { x, y, z });
  };

  for (let layer = 0; layer < layerCount; layer += 1) {
    const y = trunkHeight - 1 + layer;
    const extraRadius = layer === 0 && baseRadius === 2 && random() < 0.24 ? 1 : 0;
    const radius = Math.max(1, baseRadius + extraRadius - Math.floor((layer + 1) / 2));
    const centerX = layer >= 2 && random() < 0.42 ? leanX : 0;
    const centerZ = layer >= 1 && random() < 0.42 ? leanZ : 0;

    for (let dx = -radius; dx <= radius; dx += 1) {
      for (let dz = -radius; dz <= radius; dz += 1) {
        const distance = Math.max(Math.abs(dx), Math.abs(dz)) + Math.min(Math.abs(dx), Math.abs(dz)) * 0.34;
        const keepRoll = hashString(`${seed}:layer:${layer}:${dx}:${dz}`) / 4294967295;
        const keepThreshold = radius + (layer === 0 ? 0.45 : 0.18);
        if (distance > keepThreshold && !(distance <= keepThreshold + 0.6 && keepRoll > 0.44 - layer * 0.05)) {
          continue;
        }

        if (radius >= 3 && Math.abs(dx) === radius && Math.abs(dz) === radius && keepRoll < 0.88) {
          continue;
        }

        addLeaf(centerX + dx, y, centerZ + dz);
      }
    }
  }

  const branchDirections = [
    { x: 1, z: 0 },
    { x: -1, z: 0 },
    { x: 0, z: 1 },
    { x: 0, z: -1 },
    { x: 1, z: 1 },
    { x: 1, z: -1 },
    { x: -1, z: 1 },
    { x: -1, z: -1 }
  ] as const;
  const branchCount =
    (baseRadius === 3 ? 2 : 1) +
    (random() < 0.46 ? 1 : 0) +
    (baseRadius === 3 && random() < 0.32 ? 1 : 0);

  for (let branchIndex = 0; branchIndex < branchCount; branchIndex += 1) {
    const direction = branchDirections[Math.floor(random() * branchDirections.length)]!;
    const branchRadius = baseRadius === 3 && random() < 0.4 ? 2 : 1;
    const branchDistance = branchRadius === 2 ? 2 : 1 + Math.floor(random() * 2);
    const branchY = trunkHeight - 1 + Math.floor(random() * Math.max(2, layerCount));

    for (let dx = -branchRadius; dx <= branchRadius; dx += 1) {
      for (let dz = -branchRadius; dz <= branchRadius; dz += 1) {
        const keepRoll = hashString(`${seed}:branch:${branchIndex}:${dx}:${dz}`) / 4294967295;
        if (branchRadius === 2 && Math.abs(dx) === branchRadius && Math.abs(dz) === branchRadius && keepRoll < 0.9) {
          continue;
        }

        if (Math.max(Math.abs(dx), Math.abs(dz)) > branchRadius) {
          continue;
        }

        const y = branchY + (branchRadius === 2 && keepRoll > 0.78 ? 1 : 0);
        addLeaf(direction.x * branchDistance + dx, y, direction.z * branchDistance + dz);
      }
    }
  }

  addLeaf(random() < 0.45 ? leanX : 0, trunkHeight + layerCount, random() < 0.45 ? leanZ : 0);
  if (baseRadius >= 2 && random() < 0.62) {
    addLeaf(0, trunkHeight + layerCount - 1, 0);
  }

  return {
    trunkHeight,
    canopy: [...canopy.values()]
  };
};

export const getMapPropVoxels = (prop: Pick<MapProp, "kind" | "x" | "y" | "z">): MapPropVoxel[] => {
  if (prop.kind === "tree-oak") {
    const variant = getTreeOakVariant(prop);
    return [
      ...Array.from({ length: variant.trunkHeight }, (_, index) => ({
        x: prop.x,
        y: prop.y + index,
        z: prop.z,
        kind: "wood" as const
      })),
      ...variant.canopy.map((offset) => ({
        x: prop.x + offset.x,
        y: prop.y + offset.y,
        z: prop.z + offset.z,
        kind: "leaves" as const
      }))
    ];
  }

  return [];
};

export const getMapPropFootprint = (prop: Pick<MapProp, "kind" | "x" | "y" | "z">) => {
  if (prop.kind === "tree-oak") {
    return [...new Map(
      getMapPropVoxels(prop).map((voxel) => [`${voxel.x}:${voxel.z}`, { x: voxel.x, z: voxel.z } satisfies Pick<Vec3i, "x" | "z">])
    ).values()];
  }

  return [{ x: prop.x, z: prop.z }];
};

export const getMapPropHeight = (kind: MapPropKind) => {
  if (kind === "tree-oak") {
    return 10;
  }

  return 0;
};

export const isMapPropInBounds = (size: Vec3i, prop: Pick<MapProp, "kind" | "x" | "y" | "z">) =>
  getMapPropVoxels(prop).every(
    (voxel) =>
      voxel.x >= 0 &&
      voxel.x < size.x &&
      voxel.y >= 0 &&
      voxel.y < size.y &&
      voxel.z >= 0 &&
      voxel.z < size.z
  );
