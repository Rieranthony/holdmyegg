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
  bucket: VoxelBurstParticleBucket;
}

export interface VoxelBurstShockwaveState {
  position: Vector3;
  scale: number;
  opacity: number;
}

export type VoxelBurstParticleBucket = "terrain" | "accent";

export const voxelBurstParticleCountByStyle = {
  eggExplosion: 288,
  harvest: 7,
  superBoomExplosion: 432
} as const;

export const getVoxelBurstParticleCount = (burst: RuntimeVoxelBurstState) =>
  voxelBurstParticleCountByStyle[burst.style];

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
