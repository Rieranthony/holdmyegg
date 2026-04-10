import {
  getMapPropVoxels,
  type MapProp,
  type MapPropKind,
  type MapPropVoxel,
  type MapPropVoxelKind
} from "@out-of-bounds/map";
import type {
  RuntimeEggScatterDebrisState,
  RuntimeVoxelBurstState,
  Vector3
} from "@out-of-bounds/sim";
import { getEggScatterDebrisPosition } from "./eggs";
import { getBlockRenderProfile, type BlockRenderProfile } from "./voxelMaterials";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const lerp = (start: number, end: number, alpha: number) => start + (end - start) * alpha;

const hashString = (value: string) => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33 + value.charCodeAt(index)) >>> 0;
  }

  return hash;
};

const getNoise = (seed: number, salt: number) => {
  const value = Math.sin(seed * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
};

const getProgress = (elapsed: number, duration: number) =>
  duration <= 0 ? 1 : clamp(elapsed / duration, 0, 1);

const sortDeterministically = <T>(items: readonly T[], getSeed: (item: T) => string) =>
  [...items].sort((left, right) => hashString(getSeed(left)) - hashString(getSeed(right)));

const sampleDeterministicSpread = <T>(items: readonly T[], targetCount: number, seed: string) => {
  if (targetCount >= items.length) {
    return [...items];
  }

  const phase = getNoise(hashString(seed) * 0.0001, 1) - 0.5;
  const samples: T[] = [];
  for (let index = 0; index < targetCount; index += 1) {
    const normalized = (index + 0.5 + phase * 0.8) / targetCount;
    const sampleIndex = clamp(Math.floor(normalized * items.length), 0, items.length - 1);
    samples.push(items[sampleIndex]!);
  }

  return samples;
};

const allocateFragmentCounts = (woodCount: number, leafCount: number, targetCount: number) => {
  if (targetCount <= 0) {
    return {
      wood: 0,
      leaves: 0
    };
  }

  if (woodCount === 0) {
    return {
      wood: 0,
      leaves: Math.min(leafCount, targetCount)
    };
  }

  if (leafCount === 0) {
    return {
      wood: Math.min(woodCount, targetCount),
      leaves: 0
    };
  }

  let wood = Math.round((targetCount * woodCount) / (woodCount + leafCount));
  wood = clamp(wood, 1, Math.min(woodCount, targetCount - 1));
  let leaves = Math.min(leafCount, targetCount - wood);

  while (wood + leaves < targetCount) {
    if (leaves < leafCount && leafCount - leaves >= woodCount - wood) {
      leaves += 1;
      continue;
    }

    if (wood < woodCount) {
      wood += 1;
      continue;
    }

    if (leaves < leafCount) {
      leaves += 1;
      continue;
    }

    break;
  }

  return {
    wood,
    leaves
  };
};

export interface EggScatterDebrisVisualState {
  position: Vector3;
  rotationX: number;
  rotationY: number;
  rotationZ: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
}

export interface VoxelBurstParticleState {
  position: Vector3;
  rotationX: number;
  rotationY: number;
  rotationZ: number;
  scale: number;
  opacity: number;
  bucket: VoxelBurstParticleBucket;
}

export interface VoxelBurstShockwaveState {
  position: Vector3;
  scale: number;
  opacity: number;
}

export type VoxelBurstParticleBucket = "terrain" | "accent";
export type PropShatterMaterialKey = "bark" | "leavesOak" | "leavesPine" | "leavesAutumn";

export interface PropShatterFragment {
  materialKey: PropShatterMaterialKey;
  origin: Vector3;
  voxelKind: MapPropVoxelKind;
}

export interface PropShatterBurstState {
  id: string;
  propId: string;
  kind: MapPropKind;
  center: Vector3;
  elapsed: number;
  duration: number;
  fragments: PropShatterFragment[];
}

export interface PropShatterFragmentState {
  position: Vector3;
  rotationX: number;
  rotationY: number;
  rotationZ: number;
  scale: number;
  opacity: number;
  materialKey: PropShatterMaterialKey;
}

export const DEFAULT_PROP_SHATTER_DURATION = 0.48;
export const MAX_PROP_SHATTER_FRAGMENTS = 96;

export const voxelBurstParticleCountByStyle = {
  eggExplosion: 288,
  harvest: 7,
  superBoomExplosion: 432
} as const;

export const getVoxelBurstParticleCount = (burst: RuntimeVoxelBurstState) =>
  voxelBurstParticleCountByStyle[burst.style];

export const getPropShatterMaterialKey = (
  propKind: MapPropKind,
  voxelKind: MapPropVoxelKind
): PropShatterMaterialKey => {
  if (voxelKind === "wood") {
    return "bark";
  }

  if (propKind === "tree-pine") {
    return "leavesPine";
  }

  if (propKind === "tree-autumn") {
    return "leavesAutumn";
  }

  return "leavesOak";
};

export const createPropShatterBurstState = ({
  id,
  prop,
  duration = DEFAULT_PROP_SHATTER_DURATION,
  maxFragments = MAX_PROP_SHATTER_FRAGMENTS
}: {
  id: string;
  prop: Pick<MapProp, "id" | "kind" | "x" | "y" | "z">;
  duration?: number;
  maxFragments?: number;
}): PropShatterBurstState => {
  const allVoxels = getMapPropVoxels(prop);
  const totalVoxelCount = allVoxels.length;
  const targetCount = Math.min(totalVoxelCount, Math.max(1, maxFragments));
  const woodVoxels = sortDeterministically(
    allVoxels.filter((voxel) => voxel.kind === "wood"),
    (voxel) => `${prop.id}:wood:${voxel.x}:${voxel.y}:${voxel.z}`
  );
  const leafVoxels = sortDeterministically(
    allVoxels.filter((voxel) => voxel.kind === "leaves"),
    (voxel) => `${prop.id}:leaves:${voxel.x}:${voxel.y}:${voxel.z}`
  );
  const allocation = allocateFragmentCounts(woodVoxels.length, leafVoxels.length, targetCount);
  const sampledVoxels = sortDeterministically(
    [
      ...sampleDeterministicSpread(woodVoxels, allocation.wood, `${prop.id}:wood-sample`),
      ...sampleDeterministicSpread(leafVoxels, allocation.leaves, `${prop.id}:leaf-sample`)
    ],
    (voxel) => `${prop.id}:sample:${voxel.x}:${voxel.y}:${voxel.z}`
  );

  const center = allVoxels.reduce<Vector3>(
    (accumulator, voxel) => ({
      x: accumulator.x + voxel.x + 0.5,
      y: accumulator.y + voxel.y + 0.5,
      z: accumulator.z + voxel.z + 0.5
    }),
    { x: 0, y: 0, z: 0 }
  );
  center.x /= Math.max(1, totalVoxelCount);
  center.y /= Math.max(1, totalVoxelCount);
  center.z /= Math.max(1, totalVoxelCount);

  return {
    id,
    propId: prop.id,
    kind: prop.kind,
    center,
    elapsed: 0,
    duration,
    fragments: sampledVoxels.map((voxel: MapPropVoxel) => ({
      materialKey: getPropShatterMaterialKey(prop.kind, voxel.kind),
      origin: {
        x: voxel.x + 0.5,
        y: voxel.y + 0.5,
        z: voxel.z + 0.5
      },
      voxelKind: voxel.kind
    }))
  };
};

export const getPropShatterFragmentState = (
  burst: PropShatterBurstState,
  fragmentIndex: number
): PropShatterFragmentState => {
  const fragment = burst.fragments[fragmentIndex]!;
  const progress = getProgress(burst.elapsed, burst.duration);
  const seed = hashString(`${burst.id}:${fragmentIndex}:${fragment.materialKey}`) * 0.0001;
  const isLeaf = fragment.voxelKind === "leaves";
  const centerDeltaX = fragment.origin.x - burst.center.x;
  const centerDeltaZ = fragment.origin.z - burst.center.z;
  const baseYaw =
    Math.abs(centerDeltaX) <= Number.EPSILON && Math.abs(centerDeltaZ) <= Number.EPSILON
      ? getNoise(seed, 1) * Math.PI * 2
      : Math.atan2(centerDeltaZ, centerDeltaX);
  const yaw = baseYaw + (getNoise(seed, 2) - 0.5) * (isLeaf ? 1.3 : 0.74);
  const driftYaw = yaw + (getNoise(seed, 3) - 0.5) * (isLeaf ? 1.18 : 0.4);
  const distanceStart = isLeaf ? 0.02 + getNoise(seed, 4) * 0.06 : 0.01 + getNoise(seed, 4) * 0.03;
  const distanceEnd = isLeaf ? 1.18 + getNoise(seed, 5) * 1.12 : 0.58 + getNoise(seed, 5) * 0.82;
  const lift =
    Math.sin(progress * Math.PI) * (isLeaf ? 1.08 : 0.62) * (0.78 + getNoise(seed, 6) * 0.52) -
    progress * progress * (isLeaf ? 0.54 : 1.26) * (0.74 + getNoise(seed, 7) * 0.58) +
    Math.sin(progress * Math.PI * (isLeaf ? 2.3 : 1.7) + getNoise(seed, 8) * Math.PI * 2) *
      (isLeaf ? 0.14 : 0.05);
  const lateralFlutter =
    Math.sin(progress * Math.PI * (isLeaf ? 1.9 : 1.3) + getNoise(seed, 9) * Math.PI * 2) *
    (isLeaf ? 0.18 : 0.04);
  const distance = lerp(distanceStart, distanceEnd, progress);
  const scaleStart = isLeaf ? 0.24 + getNoise(seed, 10) * 0.12 : 0.32 + getNoise(seed, 10) * 0.14;
  const scaleEnd = isLeaf ? 0.06 : 0.08;
  const spinX = progress * Math.PI * (isLeaf ? 2.8 + getNoise(seed, 11) * 2 : 1.8 + getNoise(seed, 11) * 1.6);
  const spinY = progress * Math.PI * (isLeaf ? 3.4 + getNoise(seed, 12) * 2.8 : 2.1 + getNoise(seed, 12) * 1.8);
  const spinZ = progress * Math.PI * (isLeaf ? 2.6 + getNoise(seed, 13) * 2.2 : 1.7 + getNoise(seed, 13) * 1.5);

  return {
    position: {
      x: fragment.origin.x + Math.cos(yaw) * distance + Math.cos(driftYaw + Math.PI / 2) * lateralFlutter,
      y: fragment.origin.y + lift,
      z: fragment.origin.z + Math.sin(yaw) * distance + Math.sin(driftYaw + Math.PI / 2) * lateralFlutter
    },
    rotationX: spinX,
    rotationY: spinY,
    rotationZ: spinZ,
    scale: lerp(scaleStart, scaleEnd, progress),
    opacity: clamp((isLeaf ? 1.04 : 1.12) - Math.pow(progress, isLeaf ? 1.26 : 1.12), 0, 1),
    materialKey: fragment.materialKey
  };
};

export const getVoxelBurstMaterialProfile = (burst: RuntimeVoxelBurstState): BlockRenderProfile | null => {
  if (burst.style === "harvest") {
    if (!burst.kind) {
      return null;
    }

    return getBlockRenderProfile(burst.kind, Math.floor(burst.position.y));
  }

  if (burst.style === "eggExplosion" || burst.style === "superBoomExplosion") {
    return getBlockRenderProfile("ground", Math.floor(burst.position.y));
  }

  return null;
};

export const getEggScatterDebrisVisualState = (
  debris: RuntimeEggScatterDebrisState,
  arcHeight: number
): EggScatterDebrisVisualState => {
  const progress = getProgress(debris.elapsed, debris.duration);
  const seed = hashString(debris.id) * 0.0001;
  const launchStretch = Math.sin(clamp(progress / 0.22, 0, 1) * Math.PI);
  const landingStretch = Math.sin(clamp((progress - 0.76) / 0.24, 0, 1) * Math.PI);
  const corkscrewBoost = Math.sin(progress * Math.PI) * 0.12;

  return {
    position: getEggScatterDebrisPosition(debris, arcHeight),
    rotationX: progress * Math.PI * (1.8 + getNoise(seed, 1) * 1.6),
    rotationY: progress * Math.PI * (3.2 + getNoise(seed, 2) * 3),
    rotationZ: progress * Math.PI * (1.45 + getNoise(seed, 3) * 1.85),
    scaleX: 1 + launchStretch * 0.26 - landingStretch * 0.12 + corkscrewBoost,
    scaleY: 1 - launchStretch * 0.18 + landingStretch * 0.24 - corkscrewBoost * 0.6,
    scaleZ: 1 + launchStretch * 0.26 - landingStretch * 0.12 + corkscrewBoost
  };
};

export const getVoxelBurstParticleState = (
  burst: RuntimeVoxelBurstState,
  particleIndex: number
): VoxelBurstParticleState => {
  const progress = getProgress(burst.elapsed, burst.duration);
  const seed = hashString(`${burst.id}:${particleIndex}`) * 0.0001;
  const yaw = getNoise(seed, 1) * Math.PI * 2;
  const radialJitter = 0.72 + getNoise(seed, 2) * 0.65;
  const liftJitter = 0.8 + getNoise(seed, 3) * 0.7;
  const gravityJitter = 0.08 + getNoise(seed, 4) * 0.34;
  const spinX = progress * Math.PI * (1.2 + getNoise(seed, 5) * 2.2);
  const spinY = progress * Math.PI * (1.6 + getNoise(seed, 6) * 3.1);
  const spinZ = progress * Math.PI * (1.1 + getNoise(seed, 7) * 2.4);

  if (burst.style === "eggExplosion") {
    const burstBand = particleIndex % 6;
    const bandDistanceStart = [0.02, 0.08, 0.2, 0.16, 0.12, 0.04][burstBand]!;
    const bandDistanceEnd = [0.86, 1.78, 2.38, 3.24, 2.18, 1.28][burstBand]!;
    const bandLift = [0.42, 2.18, 1.08, 0.18, 0.62, 0.88][burstBand]!;
    const bandGravity = [0.42, 0.62, 0.74, 0.2, 0.92, 0.28][burstBand]!;
    const bandScaleStart = [0.28, 0.22, 0.18, 0.12, 0.1, 0.08][burstBand]!;
    const bandScaleEnd = [0.04, 0.05, 0.045, 0.03, 0.03, 0.02][burstBand]!;
    const bandBucket: VoxelBurstParticleBucket =
      burstBand === 0 || burstBand === 5 ? "accent" : "terrain";
    const distance =
      lerp(bandDistanceStart, bandDistanceEnd, progress) * (0.72 + radialJitter * 0.74);
    const flutter =
      Math.sin(progress * Math.PI * (2.2 + burstBand * 0.2) + getNoise(seed, 8) * Math.PI) *
      (burstBand === 3 ? 0.035 : 0.08);
    const lift =
      Math.sin(progress * Math.PI) * bandLift * (0.62 + liftJitter * 0.44) -
      progress * progress * gravityJitter * bandGravity +
      flutter;
    const corePulse = 1 + Math.sin(progress * Math.PI) * (bandBucket === "accent" ? 0.36 : 0.22);
    return {
      position: {
        x: burst.position.x + Math.cos(yaw) * distance,
        y: burst.position.y + lift,
        z: burst.position.z + Math.sin(yaw) * distance
      },
      rotationX: spinX * 1.34,
      rotationY: spinY * 1.48,
      rotationZ: spinZ * 1.32,
      scale: lerp(bandScaleStart, bandScaleEnd, progress) * corePulse,
      opacity: clamp(
        (bandBucket === "accent" ? 1.18 : 1.08) - Math.pow(progress, bandBucket === "accent" ? 1.36 : 1.54),
        0,
        1
      ),
      bucket: bandBucket
    };
  }

  if (burst.style === "superBoomExplosion") {
    const burstBand = particleIndex % 8;
    const bandDistanceStart = [0.08, 0.18, 0.42, 0.78, 1.14, 0.34, 0.12, 0.56][burstBand]!;
    const bandDistanceEnd = [1.68, 2.74, 4.12, 5.64, 7.34, 4.82, 2.9, 6.4][burstBand]!;
    const bandLift = [0.66, 2.96, 1.82, 1.22, 0.22, 0.84, 1.1, 1.54][burstBand]!;
    const bandGravity = [0.48, 0.7, 0.96, 1.08, 0.24, 1.16, 0.32, 0.88][burstBand]!;
    const bandScaleStart = [0.34, 0.28, 0.24, 0.2, 0.14, 0.12, 0.1, 0.16][burstBand]!;
    const bandScaleEnd = [0.08, 0.07, 0.06, 0.05, 0.035, 0.03, 0.03, 0.04][burstBand]!;
    const bandBucket: VoxelBurstParticleBucket =
      burstBand === 0 || burstBand === 6 || burstBand === 7 ? "accent" : "terrain";
    const distance = lerp(bandDistanceStart, bandDistanceEnd, progress) * (0.88 + radialJitter * 0.86);
    const flutter =
      Math.sin(progress * Math.PI * (2.5 + burstBand * 0.16) + getNoise(seed, 8) * Math.PI * 2) *
      (burstBand === 4 ? 0.06 : 0.12);
    const lift =
      Math.sin(progress * Math.PI) * bandLift * (0.68 + liftJitter * 0.48) -
      progress * progress * gravityJitter * bandGravity +
      flutter;
    const corePulse = 1 + Math.sin(progress * Math.PI) * (bandBucket === "accent" ? 0.46 : 0.28);
    return {
      position: {
        x: burst.position.x + Math.cos(yaw) * distance,
        y: burst.position.y + lift,
        z: burst.position.z + Math.sin(yaw) * distance
      },
      rotationX: spinX * 1.46,
      rotationY: spinY * 1.6,
      rotationZ: spinZ * 1.42,
      scale: lerp(bandScaleStart, bandScaleEnd, progress) * corePulse,
      opacity: clamp(
        (bandBucket === "accent" ? 1.22 : 1.14) - Math.pow(progress, bandBucket === "accent" ? 1.28 : 1.42),
        0,
        1
      ),
      bucket: bandBucket
    };
  }

  const distance = lerp(0.04, 0.42, progress) * radialJitter;
  const lift = Math.sin(progress * Math.PI) * 0.38 * liftJitter - progress * progress * gravityJitter * 0.55;
  return {
    position: {
      x: burst.position.x + Math.cos(yaw) * distance,
      y: burst.position.y + lift,
      z: burst.position.z + Math.sin(yaw) * distance
    },
    rotationX: spinX * 0.9,
    rotationY: spinY * 0.82,
    rotationZ: spinZ * 0.9,
    scale: lerp(0.16, 0.035, progress),
    opacity: 1 - Math.pow(progress, 1.7),
    bucket: "terrain"
  };
};

export const getVoxelBurstShockwaveState = (
  burst: RuntimeVoxelBurstState
): VoxelBurstShockwaveState | null => {
  if (burst.style !== "eggExplosion" && burst.style !== "superBoomExplosion") {
    return null;
  }

  const progress = getProgress(burst.elapsed, burst.duration);
  if (burst.style === "superBoomExplosion") {
    return {
      position: {
        x: burst.position.x,
        y: burst.position.y + 0.14 + progress * 0.08,
        z: burst.position.z
      },
      scale: lerp(1.18, 8.2, progress),
      opacity: clamp(0.92 - Math.pow(progress, 0.94), 0, 1)
    };
  }

  return {
    position: {
      x: burst.position.x,
      y: burst.position.y + 0.1 + progress * 0.04,
      z: burst.position.z
    },
    scale: lerp(0.78, 5.4, progress),
    opacity: clamp(0.84 - Math.pow(progress, 1.04), 0, 1)
  };
};
