import { describe, expect, it } from "vitest";
import {
  getEggScatterDebrisVisualState,
  getVoxelBurstMaterialProfile,
  getVoxelBurstParticleCount,
  getVoxelBurstParticleState,
  getVoxelBurstShockwaveState
} from "./voxelFx";

describe("voxelFx", () => {
  it("resolves harvest burst material profiles from the removed cube kind and height", () => {
    expect(
      getVoxelBurstMaterialProfile({
        id: "harvest-surface",
        style: "harvest",
        kind: "ground",
        position: { x: 4.5, y: 10.5, z: 6.5 },
        elapsed: 0.05,
        duration: 0.24
      })
    ).toBe("earthSurface");
    expect(
      getVoxelBurstMaterialProfile({
        id: "harvest-darkness",
        style: "harvest",
        kind: "hazard",
        position: { x: 4.5, y: 1.5, z: 6.5 },
        elapsed: 0.05,
        duration: 0.24
      })
    ).toBe("darkness");
    expect(
      getVoxelBurstMaterialProfile({
        id: "egg-burst",
        style: "eggExplosion",
        kind: null,
        position: { x: 4.5, y: 10.5, z: 6.5 },
        elapsed: 0.05,
        duration: 0.42
      })
    ).toBeNull();
    expect(
      getVoxelBurstMaterialProfile({
        id: "super-boom",
        style: "superBoomExplosion",
        kind: null,
        position: { x: 4.5, y: 10.5, z: 6.5 },
        elapsed: 0.05,
        duration: 0.56
      })
    ).toBeNull();
  });

  it("drives tighter harvest particles and wider egg explosion particles with shrinking opacity", () => {
    const harvestBurst = {
      id: "harvest-1",
      style: "harvest" as const,
      kind: "ground" as const,
      position: { x: 10, y: 6, z: 8 },
      elapsed: 0.12,
      duration: 0.24
    };
    const eggBurst = {
      id: "egg-1",
      style: "eggExplosion" as const,
      kind: null,
      position: { x: 10, y: 6, z: 8 },
      elapsed: 0.21,
      duration: 0.42
    };

    const harvestParticle = getVoxelBurstParticleState(harvestBurst, 0);
    const eggParticle = getVoxelBurstParticleState(eggBurst, 0);
    const harvestDistance = Math.hypot(harvestParticle.position.x - 10, harvestParticle.position.z - 8);
    const eggDistance = Math.hypot(eggParticle.position.x - 10, eggParticle.position.z - 8);

    expect(getVoxelBurstParticleCount(harvestBurst)).toBeLessThan(getVoxelBurstParticleCount(eggBurst));
    expect(eggDistance).toBeGreaterThan(harvestDistance);
    expect(harvestParticle.scale).toBeLessThan(0.16);
    expect(eggParticle.scale).toBeLessThan(0.36);
    expect(harvestParticle.opacity).toBeGreaterThan(0);
    expect(harvestParticle.opacity).toBeLessThan(1);
    expect(eggParticle.opacity).toBeGreaterThan(0);
    expect(eggParticle.opacity).toBeLessThan(1);
  });

  it("renders super boom bursts wider and denser than regular egg explosions", () => {
    const eggBurst = {
      id: "egg-1",
      style: "eggExplosion" as const,
      kind: null,
      position: { x: 10, y: 6, z: 8 },
      elapsed: 0.24,
      duration: 0.42
    };
    const superBoomBurst = {
      id: "boom-1",
      style: "superBoomExplosion" as const,
      kind: null,
      position: { x: 10, y: 6, z: 8 },
      elapsed: 0.28,
      duration: 0.56
    };

    const eggParticle = getVoxelBurstParticleState(eggBurst, 0);
    const superBoomParticle = getVoxelBurstParticleState(superBoomBurst, 0);
    const eggDistance = Math.hypot(eggParticle.position.x - 10, eggParticle.position.z - 8);
    const superBoomDistance = Math.hypot(superBoomParticle.position.x - 10, superBoomParticle.position.z - 8);

    expect(getVoxelBurstParticleCount(superBoomBurst)).toBeGreaterThan(getVoxelBurstParticleCount(eggBurst));
    expect(superBoomDistance).toBeGreaterThan(eggDistance);
    expect(superBoomParticle.scale).toBeGreaterThan(eggParticle.scale);
    expect(superBoomParticle.opacity).toBeGreaterThan(0);
    expect(superBoomParticle.opacity).toBeLessThanOrEqual(1);
  });

  it("adds a fast shockwave ring for egg explosions only", () => {
    const eggShockwave = getVoxelBurstShockwaveState({
      id: "egg-1",
      style: "eggExplosion",
      kind: null,
      position: { x: 10, y: 6, z: 8 },
      elapsed: 0.12,
      duration: 0.42
    });

    expect(eggShockwave).not.toBeNull();
    expect(eggShockwave?.scale).toBeGreaterThan(0.7);
    expect(eggShockwave?.opacity).toBeGreaterThan(0);
    const superBoomShockwave = getVoxelBurstShockwaveState({
      id: "boom-1",
      style: "superBoomExplosion",
      kind: null,
      position: { x: 10, y: 6, z: 8 },
      elapsed: 0.12,
      duration: 0.56
    });

    expect(superBoomShockwave).not.toBeNull();
    expect(superBoomShockwave?.scale).toBeGreaterThan(eggShockwave?.scale ?? 0);
    expect(superBoomShockwave?.opacity).toBeGreaterThan(0);
    expect(
      getVoxelBurstShockwaveState({
        id: "harvest-1",
        style: "harvest",
        kind: "ground",
        position: { x: 10, y: 6, z: 8 },
        elapsed: 0.12,
        duration: 0.24
      })
    ).toBeNull();
  });

  it("adds spin and squash stretch to relocating egg debris without changing the sim path", () => {
    const visual = getEggScatterDebrisVisualState(
      {
        id: "egg-debris-1",
        kind: "ground",
        origin: { x: 4.5, y: 10.5, z: 5.5 },
        destination: { x: 8.5, y: 11.5, z: 9.5 },
        elapsed: 0.08,
        duration: 0.65
      },
      2.4
    );

    expect(visual.position.y).toBeGreaterThan(10.5);
    expect(Math.abs(visual.rotationY)).toBeGreaterThan(0);
    expect(visual.scaleX).not.toBe(1);
    expect(visual.scaleY).not.toBe(1);
  });
});
