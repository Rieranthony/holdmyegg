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
