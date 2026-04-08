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
}

export interface VoxelBurstShockwaveState {
  position: Vector3;
  scale: number;
  opacity: number;
}

export const voxelBurstParticleCountByStyle = {
  eggExplosion: 132,
  harvest: 7,
  superBoomExplosion: 228
} as const;

export const getVoxelBurstParticleCount = (burst: RuntimeVoxelBurstState) =>
  voxelBurstParticleCountByStyle[burst.style];

export const getVoxelBurstMaterialProfile = (burst: RuntimeVoxelBurstState): BlockRenderProfile | null => {
  if (burst.style !== "harvest" || !burst.kind) {
    return null;
  }

  return getBlockRenderProfile(burst.kind, Math.floor(burst.position.y));
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
    const burstBand = particleIndex % 4;
    const bandDistanceStart = [0.08, 0.22, 0.42, 0.62][burstBand]!;
    const bandDistanceEnd = [1.34, 1.86, 2.36, 2.92][burstBand]!;
    const bandLift = [1.18, 1.54, 1.92, 1.08][burstBand]!;
    const bandScaleStart = [0.42, 0.34, 0.26, 0.19][burstBand]!;
    const distance = lerp(bandDistanceStart, bandDistanceEnd, progress) * radialJitter;
    const lift =
      Math.sin(progress * Math.PI) * bandLift * liftJitter -
      progress * progress * gravityJitter * 0.84 +
      Math.sin(progress * Math.PI * (2.5 + burstBand * 0.22)) * 0.12;
    const corePulse = 1 + Math.sin(progress * Math.PI) * 0.28;
    return {
      position: {
        x: burst.position.x + Math.cos(yaw) * distance,
        y: burst.position.y + lift,
        z: burst.position.z + Math.sin(yaw) * distance
      },
      rotationX: spinX * 1.34,
      rotationY: spinY * 1.48,
      rotationZ: spinZ * 1.32,
      scale: lerp(bandScaleStart, 0.08, progress) * corePulse,
      opacity: clamp(1.12 - Math.pow(progress, 1.62), 0, 1)
    };
  }

  if (burst.style === "superBoomExplosion") {
    const burstBand = particleIndex % 6;
    const bandDistanceStart = [0.18, 0.42, 0.72, 1.02, 1.34, 1.7][burstBand]!;
    const bandDistanceEnd = [2.4, 3.1, 4.05, 4.95, 5.9, 6.75][burstBand]!;
    const bandLift = [1.72, 2.14, 2.56, 2.94, 2.08, 1.46][burstBand]!;
    const bandScaleStart = [0.62, 0.5, 0.4, 0.32, 0.24, 0.18][burstBand]!;
    const distance = lerp(bandDistanceStart, bandDistanceEnd, progress) * (0.94 + radialJitter * 0.72);
    const lift =
      Math.sin(progress * Math.PI) * bandLift * liftJitter -
      progress * progress * gravityJitter * 1.18 +
      Math.sin(progress * Math.PI * (2.9 + burstBand * 0.18)) * 0.2;
    const corePulse = 1 + Math.sin(progress * Math.PI) * 0.36;
    return {
      position: {
        x: burst.position.x + Math.cos(yaw) * distance,
        y: burst.position.y + lift,
        z: burst.position.z + Math.sin(yaw) * distance
      },
      rotationX: spinX * 1.46,
      rotationY: spinY * 1.6,
      rotationZ: spinZ * 1.42,
      scale: lerp(bandScaleStart, 0.11, progress) * corePulse,
      opacity: clamp(1.2 - Math.pow(progress, 1.48), 0, 1)
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
    opacity: 1 - Math.pow(progress, 1.7)
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
