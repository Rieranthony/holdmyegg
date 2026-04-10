import type { Vec3i } from "@out-of-bounds/map";

export interface SkyBirdPreset {
  id: string;
  orbitRadiusX: number;
  orbitRadiusZ: number;
  baseY: number;
  speed: number;
  phase: number;
  bobAmplitude: number;
  flapSpeed: number;
}

export interface SkyBirdPose {
  position: {
    x: number;
    y: number;
    z: number;
  };
  yaw: number;
  flapAmount: number;
}

const hashSeed = (seed: number | string) => {
  const text = String(seed);
  let hash = 2166136261;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
};

const createSeededRandom = (seed: number | string) => {
  let state = hashSeed(seed) || 0x9e3779b9;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
};

const toFixedNumber = (value: number, digits = 2) =>
  Number(value.toFixed(digits));

export const birdPresets: readonly SkyBirdPreset[] = [
  {
    id: "bird-1",
    orbitRadiusX: 18,
    orbitRadiusZ: 10,
    baseY: 20.8,
    speed: 0.42,
    phase: 0.15,
    bobAmplitude: 0.65,
    flapSpeed: 7.4
  },
  {
    id: "bird-2",
    orbitRadiusX: 24,
    orbitRadiusZ: 14,
    baseY: 22.1,
    speed: 0.35,
    phase: 1.8,
    bobAmplitude: 0.52,
    flapSpeed: 6.7
  },
  {
    id: "bird-3",
    orbitRadiusX: 16,
    orbitRadiusZ: 8,
    baseY: 24.2,
    speed: 0.5,
    phase: 3.4,
    bobAmplitude: 0.48,
    flapSpeed: 8.1
  }
] as const;

export const buildSkyBirdFlock = ({
  seed,
  count
}: {
  seed: number | string;
  count: number;
}): SkyBirdPreset[] => {
  const targetCount = Math.max(0, count);
  const random = createSeededRandom(seed);
  const flock: SkyBirdPreset[] = [];

  for (let index = 0; index < targetCount; index += 1) {
    const template = birdPresets[Math.floor(random() * birdPresets.length) % birdPresets.length]!;
    const orbitRadiusX = template.orbitRadiusX * (0.84 + random() * 0.34);
    const orbitRadiusZ = template.orbitRadiusZ * (0.84 + random() * 0.34);
    const baseY = template.baseY + (random() - 0.5) * 2.4;
    const speed = template.speed * (0.9 + random() * 0.2);
    const bobAmplitude = template.bobAmplitude * (0.82 + random() * 0.26);
    const flapSpeed = template.flapSpeed * (0.92 + random() * 0.18);

    flock.push({
      id: `${template.id}-flock-${index + 1}`,
      orbitRadiusX: toFixedNumber(orbitRadiusX),
      orbitRadiusZ: toFixedNumber(orbitRadiusZ),
      baseY: toFixedNumber(baseY),
      speed: toFixedNumber(speed, 4),
      phase: toFixedNumber(template.phase + random() * Math.PI * 2, 4),
      bobAmplitude: toFixedNumber(bobAmplitude, 4),
      flapSpeed: toFixedNumber(flapSpeed, 4)
    });
  }

  return flock;
};

export const getSkyBirdPose = (preset: SkyBirdPreset, elapsedSeconds: number, worldSize: Vec3i): SkyBirdPose => {
  const centerX = worldSize.x / 2;
  const centerZ = worldSize.z / 2;
  const angle = elapsedSeconds * preset.speed + preset.phase;
  const nextAngle = angle + 0.08;
  const x = centerX + Math.cos(angle) * preset.orbitRadiusX;
  const z = centerZ + Math.sin(angle) * preset.orbitRadiusZ;
  const nextX = centerX + Math.cos(nextAngle) * preset.orbitRadiusX;
  const nextZ = centerZ + Math.sin(nextAngle) * preset.orbitRadiusZ;

  return {
    position: {
      x: Number(x.toFixed(2)),
      y: Number((preset.baseY + Math.sin(angle * 1.7) * preset.bobAmplitude).toFixed(2)),
      z: Number(z.toFixed(2))
    },
    yaw: Number(Math.atan2(nextX - x, nextZ - z).toFixed(4)),
    flapAmount: Number((((Math.sin(elapsedSeconds * preset.flapSpeed + preset.phase) + 1) * 0.5)).toFixed(4))
  };
};
