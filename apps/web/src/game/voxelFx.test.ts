import { describe, expect, it } from "vitest";
import { getEggScatterDebrisVisualState, getVoxelBurstMaterialProfile, getVoxelBurstParticleCount, getVoxelBurstParticleState } from "./voxelFx";

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
    expect(eggParticle.scale).toBeLessThan(0.24);
    expect(harvestParticle.opacity).toBeGreaterThan(0);
    expect(harvestParticle.opacity).toBeLessThan(1);
    expect(eggParticle.opacity).toBeGreaterThan(0);
    expect(eggParticle.opacity).toBeLessThan(1);
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
