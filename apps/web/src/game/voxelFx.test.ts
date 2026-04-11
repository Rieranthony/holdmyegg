import { describe, expect, it } from "vitest";
import { getMapPropVoxels } from "@out-of-bounds/map";
import {
  createBurningTreeFxState,
  createPropRemainsState,
  getEggScatterDebrisVisualState,
  getBurningTreeActiveVoxelIndices,
  getBurningTreeVoxelVisualState,
  getPropRemainsDuration,
  getPropRemainsFragmentState,
  getPropShatterMaterialKey,
  getVoxelBurstMaterialProfile,
  getVoxelBurstParticleCount,
  getVoxelBurstParticleState,
  getVoxelBurstShockwaveState,
  SETTLED_PROP_REMAINS_SCALE
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
    ).toBe("earthSurface");
    expect(
      getVoxelBurstMaterialProfile({
        id: "super-boom",
        style: "superBoomExplosion",
        kind: null,
        position: { x: 4.5, y: 10.5, z: 6.5 },
        elapsed: 0.05,
        duration: 0.56
      })
    ).toBe("earthSurface");
  });

  it("routes harvest debris to terrain materials and egg blasts to denser terrain plus accent buckets", () => {
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

    expect(getVoxelBurstParticleCount(harvestBurst)).toBe(7);
    expect(getVoxelBurstParticleCount(eggBurst)).toBe(288);
    expect(getVoxelBurstParticleCount(harvestBurst)).toBeLessThan(getVoxelBurstParticleCount(eggBurst));
    expect(eggDistance).toBeGreaterThan(harvestDistance);
    expect(harvestParticle.scale).toBeLessThan(0.16);
    expect(eggParticle.scale).toBeLessThan(0.36);
    expect(harvestParticle.bucket).toBe("terrain");
    expect(eggParticle.bucket).toBe("accent");
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

    expect(getVoxelBurstParticleCount(superBoomBurst)).toBe(432);
    expect(getVoxelBurstParticleCount(superBoomBurst)).toBeGreaterThan(getVoxelBurstParticleCount(eggBurst));
    expect(superBoomDistance).toBeGreaterThan(eggDistance);
    expect(superBoomParticle.scale).toBeGreaterThan(eggParticle.scale);
    expect(superBoomParticle.bucket).toBe("accent");
    expect(superBoomParticle.opacity).toBeGreaterThan(0);
    expect(superBoomParticle.opacity).toBeLessThanOrEqual(1);
  });

  it("keeps low-skimmer egg particles close to the surface while spraying outward", () => {
    const burst = {
      id: "egg-surface",
      style: "eggExplosion" as const,
      kind: null,
      position: { x: 10, y: 6, z: 8 },
      elapsed: 0.21,
      duration: 0.42
    };

    const skimmerParticle = getVoxelBurstParticleState(burst, 3);
    const horizontalDistance = Math.hypot(skimmerParticle.position.x - 10, skimmerParticle.position.z - 8);

    expect(skimmerParticle.bucket).toBe("terrain");
    expect(horizontalDistance).toBeGreaterThan(1);
    expect(Math.abs(skimmerParticle.position.y - 6)).toBeLessThan(0.45);
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

  it("uses every authored tree voxel when building settled remains", () => {
    const oakProp = {
      id: "prop-oak",
      kind: "tree-oak" as const,
      x: 12,
      y: 4,
      z: 9
    };
    const pineProp = {
      id: "prop-pine",
      kind: "tree-pine" as const,
      x: 10,
      y: 4,
      z: 10
    };
    const autumnProp = {
      id: "prop-autumn",
      kind: "tree-autumn" as const,
      x: 14,
      y: 4,
      z: 12
    };
    const oakRemains = createPropRemainsState({
      id: "remains-oak",
      prop: oakProp,
      settleHeightAt: () => 2
    });
    const pineRemains = createPropRemainsState({
      id: "remains-pine",
      prop: pineProp,
      settleHeightAt: () => 2
    });
    const autumnRemains = createPropRemainsState({
      id: "remains-autumn",
      prop: autumnProp,
      settleHeightAt: () => 2
    });

    expect(oakRemains.fragments).toHaveLength(getMapPropVoxels(oakProp).length);
    expect(pineRemains.fragments).toHaveLength(getMapPropVoxels(pineProp).length);
    expect(autumnRemains.fragments).toHaveLength(getMapPropVoxels(autumnProp).length);
    expect(oakRemains.fragments.some((fragment) => fragment.materialKey === "bark")).toBe(true);
    expect(oakRemains.fragments.some((fragment) => fragment.materialKey === "leavesOak")).toBe(true);
    expect(pineRemains.fragments.some((fragment) => fragment.materialKey === "leavesPine")).toBe(true);
    expect(autumnRemains.fragments.some((fragment) => fragment.materialKey === "leavesAutumn")).toBe(true);
  });

  it("routes prop remains leaves to the matching tree material family", () => {
    expect(getPropShatterMaterialKey("tree-oak", "wood")).toBe("bark");
    expect(getPropShatterMaterialKey("tree-oak", "leaves")).toBe("leavesOak");
    expect(getPropShatterMaterialKey("tree-pine", "leaves")).toBe("leavesPine");
    expect(getPropShatterMaterialKey("tree-autumn", "leaves")).toBe("leavesAutumn");

    const pineRemains = createPropRemainsState({
      id: "tree-remains-2",
      prop: {
        id: "prop-2",
        kind: "tree-pine",
        x: 10,
        y: 4,
        z: 10
      },
      settleHeightAt: () => 3
    });
    const autumnRemains = createPropRemainsState({
      id: "tree-remains-3",
      prop: {
        id: "prop-3",
        kind: "tree-autumn",
        x: 10,
        y: 4,
        z: 10
      },
      settleHeightAt: () => 3
    });

    expect(pineRemains.fragments.some((fragment) => fragment.materialKey === "leavesPine")).toBe(true);
    expect(pineRemains.fragments.some((fragment) => fragment.materialKey === "leavesAutumn")).toBe(false);
    expect(autumnRemains.fragments.some((fragment) => fragment.materialKey === "leavesAutumn")).toBe(true);
    expect(autumnRemains.fragments.some((fragment) => fragment.materialKey === "leavesPine")).toBe(false);
  });

  it("starts tree ignition from blast-facing wood pockets and keeps untouched voxels unburned", () => {
    const state = createBurningTreeFxState({
      id: "burn-tree-1",
      prop: {
        id: "prop-burn-1",
        kind: "tree-oak",
        x: 11,
        y: 4,
        z: 11
      },
      ignitionOrigin: {
        x: 7.5,
        y: 6.5,
        z: 11.5
      }
    });

    const earliestWood = state.voxels
      .filter((voxel) => voxel.voxelKind === "wood")
      .sort((left, right) => left.ignitionTime - right.ignitionTime)[0]!;
    const earliestLeafIgnition = Math.min(
      ...state.voxels
        .filter((voxel) => voxel.voxelKind === "leaves")
        .map((voxel) => voxel.ignitionTime)
    );
    const lateLeafIndex = state.voxels.findIndex(
      (voxel) =>
        voxel.voxelKind === "leaves" &&
        voxel.ignitionTime > earliestWood.ignitionTime + 1.5
    );

    expect(earliestWood.position.x).toBeLessThanOrEqual(state.center.x + 0.25);
    expect(earliestWood.ignitionTime).toBeLessThan(earliestLeafIgnition);
    expect(lateLeafIndex).toBeGreaterThanOrEqual(0);
    expect(
      getBurningTreeVoxelVisualState(
        state,
        lateLeafIndex,
        earliestWood.ignitionTime + 0.45
      )
    ).toEqual(
      expect.objectContaining({
        charAlpha: 0,
        flameAlpha: 0,
        phase: "untouched"
      })
    );

    const earlyIgnitedCount = state.voxels.filter(
      (_, index) =>
        getBurningTreeVoxelVisualState(state, index, 6).phase !== "untouched"
    ).length;
    expect(earlyIgnitedCount).toBeGreaterThan(Math.floor(state.voxels.length * 0.52));
  });

  it("limits active burn emitters to currently hot voxel subsets", () => {
    const state = createBurningTreeFxState({
      id: "burn-tree-2",
      prop: {
        id: "prop-burn-2",
        kind: "tree-pine",
        x: 10,
        y: 4,
        z: 10
      },
      ignitionOrigin: {
        x: 14.5,
        y: 6.5,
        z: 10.5
      }
    });

    const activeIndices = getBurningTreeActiveVoxelIndices(state, 6.8, 18);
    const charredVoxel = state.voxels.findIndex(
      (voxel) => voxel.burnoutTime < 6.8
    );

    expect(activeIndices.length).toBeGreaterThan(0);
    expect(activeIndices.length).toBeGreaterThan(8);
    expect(activeIndices.length).toBeLessThanOrEqual(18);
    expect(
      activeIndices.every(
        (index) => getBurningTreeVoxelVisualState(state, index, 6.8).activeScore > 0
      )
    ).toBe(true);
    expect(charredVoxel).toBeGreaterThanOrEqual(0);
    expect(
      getBurningTreeVoxelVisualState(state, charredVoxel, 6.8)
    ).toEqual(
      expect.objectContaining({
        phase: "charred"
      })
    );
    expect(
      getBurningTreeVoxelVisualState(state, charredVoxel, 6.8).charAlpha
    ).toBeGreaterThan(0.8);
    expect(
      getBurningTreeVoxelVisualState(state, charredVoxel, 6.8).activeScore
    ).toBeGreaterThan(0.1);
  });

  it("settles remains onto sampled ground and transitions through collapse, settled, and fade", () => {
    const remains = createPropRemainsState({
      id: "tree-remains-phases",
      burning: true,
      prop: {
        id: "prop-4",
        kind: "tree-oak",
        x: 11,
        y: 4,
        z: 11
      },
      settleHeightAt: (x, z) => (x + z > 23 ? 5 : 3)
    });
    const collapseFragment = getPropRemainsFragmentState(
      {
        ...remains,
        elapsed: 0.2
      },
      0
    );
    const settledFragment = getPropRemainsFragmentState(
      {
        ...remains,
        elapsed: remains.collapseDuration + 0.8
      },
      0
    );
    const fadeFragment = getPropRemainsFragmentState(
      {
        ...remains,
        elapsed: remains.collapseDuration + remains.settledDuration + 1.2
      },
      0
    );

    expect(remains.fragments[0]?.target.y).toBeGreaterThanOrEqual(3.5);
    expect(getPropRemainsDuration(remains)).toBeCloseTo(
      remains.collapseDuration + remains.settledDuration + remains.fadeDuration
    );
    expect(collapseFragment.phase).toBe("collapse");
    expect(collapseFragment.scale).toBeGreaterThan(SETTLED_PROP_REMAINS_SCALE);
    expect(collapseFragment.position.y).not.toBe(remains.fragments[0]?.target.y);
    expect(settledFragment.phase).toBe("settled");
    expect(settledFragment.scale).toBeCloseTo(SETTLED_PROP_REMAINS_SCALE, 2);
    expect(settledFragment.position.y).toBeGreaterThanOrEqual((remains.fragments[0]?.target.y ?? 0) - 0.02);
    expect(settledFragment.burningAlpha).toBeGreaterThan(0);
    expect(fadeFragment.phase).toBe("fade");
    expect(fadeFragment.scale).toBeLessThan(SETTLED_PROP_REMAINS_SCALE);
    expect(fadeFragment.opacity).toBeLessThan(1);
  });
});
