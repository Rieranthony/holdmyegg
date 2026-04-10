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

interface TreeVariant {
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

const createCanopyCollector = (seed: string, trunkHeight: number) => {
  const canopy = new Map<string, { x: number; y: number; z: number }>();

  const addLeaf = (x: number, y: number, z: number) => {
    if (x === 0 && z === 0 && y < trunkHeight) {
      return;
    }

    canopy.set(`${x}:${y}:${z}`, { x, y, z });
  };

  return {
    addLeaf,
    getCanopy: () => [...canopy.values()],
    sampleKeepRoll: (tag: string, x: number, y: number, z: number) =>
      hashString(`${seed}:${tag}:${x}:${y}:${z}`) / 4294967295
  };
};

const getTreeOakVariant = (prop: Pick<MapProp, "kind" | "x" | "y" | "z">): TreeVariant => {
  const seed = `tree-oak:${prop.x}:${prop.y}:${prop.z}`;
  const random = createDeterministicRandom(seed);
  const trunkHeight = 3 + Math.floor(random() * 3);
  const layerCount = 3 + Math.floor(random() * 2);
  const baseRadiusRoll = random();
  const baseRadius = baseRadiusRoll < 0.16 ? 1 : baseRadiusRoll < 0.8 ? 2 : 3;
  const leanX = random() < 0.58 ? (random() < 0.5 ? -1 : 1) : 0;
  const leanZ = random() < 0.58 ? (random() < 0.5 ? -1 : 1) : 0;
  const { addLeaf, getCanopy, sampleKeepRoll } = createCanopyCollector(seed, trunkHeight);

  for (let layer = 0; layer < layerCount; layer += 1) {
    const y = trunkHeight - 1 + layer;
    const extraRadius = layer === 0 && baseRadius === 2 && random() < 0.24 ? 1 : 0;
    const radius = Math.max(1, baseRadius + extraRadius - Math.floor((layer + 1) / 2));
    const centerX = layer >= 2 && random() < 0.42 ? leanX : 0;
    const centerZ = layer >= 1 && random() < 0.42 ? leanZ : 0;

    for (let dx = -radius; dx <= radius; dx += 1) {
      for (let dz = -radius; dz <= radius; dz += 1) {
        const distance = Math.max(Math.abs(dx), Math.abs(dz)) + Math.min(Math.abs(dx), Math.abs(dz)) * 0.34;
        const keepRoll = sampleKeepRoll(`oak-layer-${layer}`, dx, y, dz);
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
        const keepRoll = sampleKeepRoll(`oak-branch-${branchIndex}`, dx, branchY, dz);
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
    canopy: getCanopy()
  };
};

const getTreePineVariant = (prop: Pick<MapProp, "kind" | "x" | "y" | "z">): TreeVariant => {
  const seed = `tree-pine:${prop.x}:${prop.y}:${prop.z}`;
  const random = createDeterministicRandom(seed);
  const trunkHeight = 6 + Math.floor(random() * 3);
  const canopyBaseY = 2 + Math.floor(random() * 2);
  const baseRadius = random() < 0.3 ? 3 : 2;
  const canopyTopRadius = random() < 0.55 ? 1 : 0;
  const { addLeaf, getCanopy, sampleKeepRoll } = createCanopyCollector(seed, trunkHeight);

  for (let y = canopyBaseY; y <= trunkHeight; y += 1) {
    const distanceFromTop = trunkHeight - y;
    const radius =
      distanceFromTop <= 0
        ? canopyTopRadius
        : distanceFromTop <= 1
          ? 1
          : distanceFromTop <= 3
            ? 2
            : baseRadius;

    for (let dx = -radius; dx <= radius; dx += 1) {
      for (let dz = -radius; dz <= radius; dz += 1) {
        const distance = Math.abs(dx) + Math.abs(dz) * 0.82;
        const keepRoll = sampleKeepRoll("pine", dx, y, dz);
        if (radius === 0) {
          if (dx === 0 && dz === 0) {
            addLeaf(dx, y, dz);
          }
          continue;
        }

        if (distance > radius + 0.12) {
          continue;
        }

        if (Math.abs(dx) === radius && Math.abs(dz) === radius && keepRoll < 0.78) {
          continue;
        }

        if (distanceFromTop >= 4 && dx === 0 && dz === 0 && keepRoll < 0.42) {
          continue;
        }

        addLeaf(dx, y, dz);
      }
    }
  }

  addLeaf(0, trunkHeight + 1, 0);
  if (random() < 0.62) {
    addLeaf(0, trunkHeight, random() < 0.5 ? -1 : 1);
  }

  return {
    trunkHeight,
    canopy: getCanopy()
  };
};

const getTreeAutumnVariant = (prop: Pick<MapProp, "kind" | "x" | "y" | "z">): TreeVariant => {
  const seed = `tree-autumn:${prop.x}:${prop.y}:${prop.z}`;
  const random = createDeterministicRandom(seed);
  const trunkHeight = 4 + Math.floor(random() * 2);
  const layerCount = 4 + Math.floor(random() * 2);
  const baseRadius = random() < 0.24 ? 2 : 3;
  const leanX = random() < 0.4 ? (random() < 0.5 ? -1 : 1) : 0;
  const leanZ = random() < 0.4 ? (random() < 0.5 ? -1 : 1) : 0;
  const { addLeaf, getCanopy, sampleKeepRoll } = createCanopyCollector(seed, trunkHeight);

  for (let layer = 0; layer < layerCount; layer += 1) {
    const y = trunkHeight - 1 + layer;
    const radius = Math.max(1, baseRadius + (layer < 2 ? 1 : 0) - Math.floor(layer / 2));
    const centerX = layer >= 2 ? leanX : 0;
    const centerZ = layer >= 1 ? leanZ : 0;

    for (let dx = -radius; dx <= radius; dx += 1) {
      for (let dz = -radius; dz <= radius; dz += 1) {
        const distance = Math.max(Math.abs(dx), Math.abs(dz)) + Math.min(Math.abs(dx), Math.abs(dz)) * 0.26;
        const keepRoll = sampleKeepRoll(`autumn-layer-${layer}`, dx, y, dz);
        if (distance > radius + 0.2 && !(distance <= radius + 0.75 && keepRoll > 0.52)) {
          continue;
        }

        if (Math.abs(dx) === radius && Math.abs(dz) === radius && keepRoll < 0.72) {
          continue;
        }

        addLeaf(centerX + dx, y, centerZ + dz);

        if (layer <= 1 && keepRoll > 0.8 && Math.max(Math.abs(dx), Math.abs(dz)) >= radius - 1) {
          addLeaf(centerX + dx, y - 1, centerZ + dz);
        }
      }
    }
  }

  const branchDirections = [
    { x: 2, z: 0 },
    { x: -2, z: 0 },
    { x: 0, z: 2 },
    { x: 0, z: -2 },
    { x: 2, z: 1 },
    { x: -2, z: -1 },
    { x: 1, z: 2 },
    { x: -1, z: -2 }
  ] as const;
  const branchCount = 2 + Math.floor(random() * 2);

  for (let branchIndex = 0; branchIndex < branchCount; branchIndex += 1) {
    const direction = branchDirections[Math.floor(random() * branchDirections.length)]!;
    const branchY = trunkHeight - 1 + Math.floor(random() * Math.max(2, layerCount - 1));

    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) > 1) {
          continue;
        }

        const keepRoll = sampleKeepRoll(`autumn-branch-${branchIndex}`, dx, branchY, dz);
        if (Math.abs(dx) === 1 && Math.abs(dz) === 1 && keepRoll < 0.46) {
          continue;
        }

        addLeaf(direction.x + dx, branchY, direction.z + dz);
        if (keepRoll > 0.74) {
          addLeaf(direction.x + dx, branchY - 1, direction.z + dz);
        }
      }
    }
  }

  addLeaf(0, trunkHeight + layerCount, 0);
  addLeaf(leanX, trunkHeight + layerCount - 1, leanZ);

  return {
    trunkHeight,
    canopy: getCanopy()
  };
};

const getTreeVariant = (prop: Pick<MapProp, "kind" | "x" | "y" | "z">): TreeVariant => {
  if (prop.kind === "tree-pine") {
    return getTreePineVariant(prop);
  }

  if (prop.kind === "tree-autumn") {
    return getTreeAutumnVariant(prop);
  }

  return getTreeOakVariant(prop);
};

export const getMapPropVoxels = (prop: Pick<MapProp, "kind" | "x" | "y" | "z">): MapPropVoxel[] => {
  const variant = getTreeVariant(prop);

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
};

export const getMapPropFootprint = (prop: Pick<MapProp, "kind" | "x" | "y" | "z">) =>
  [...new Map(
    getMapPropVoxels(prop).map((voxel) => [`${voxel.x}:${voxel.z}`, { x: voxel.x, z: voxel.z } satisfies Pick<Vec3i, "x" | "z">])
  ).values()];

export const getMapPropHeight = (kind: MapPropKind) => {
  if (kind === "tree-pine") {
    return 12;
  }

  if (kind === "tree-autumn") {
    return 11;
  }

  return 10;
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
