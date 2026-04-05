import { describe, expect, it } from "vitest";
import { getFallingClusterVisualState } from "./fallingClusters";

describe("getFallingClusterVisualState", () => {
  it("returns a visible pulse and shake while a cluster is warning", () => {
    const visual = getFallingClusterVisualState(
      {
        id: "collapse-1",
        phase: "warning",
        warningRemaining: 0.2,
        offsetY: 0,
        center: { x: 10, y: 5, z: 10 },
        voxels: [{ x: 10, y: 4, z: 10, kind: "ground" }]
      },
      1.25
    );

    expect(visual.emissiveIntensity).toBeGreaterThan(0);
    expect(Math.abs(visual.shakeX) + Math.abs(visual.shakeZ)).toBeGreaterThan(0);
  });

  it("returns no warning effect once the cluster is falling", () => {
    const visual = getFallingClusterVisualState(
      {
        id: "collapse-1",
        phase: "falling",
        warningRemaining: 0,
        offsetY: -1.5,
        center: { x: 10, y: 3.5, z: 10 },
        voxels: [{ x: 10, y: 4, z: 10, kind: "ground" }]
      },
      1.25
    );

    expect(visual).toEqual({
      emissiveIntensity: 0,
      shakeX: 0,
      shakeZ: 0
    });
  });
});
