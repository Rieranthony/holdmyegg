import { describe, expect, it } from "vitest";
import { getSkyDropVisualState } from "./skyDrops";

describe("getSkyDropVisualState", () => {
  it("returns a pulsing warning marker during the warning phase", () => {
    const visualState = getSkyDropVisualState(
      {
        id: "sky-1",
        phase: "warning",
        warningRemaining: 0.6,
        landingVoxel: { x: 10, y: 10, z: 10 },
        offsetY: 18
      },
      1
    );

    expect(visualState.warningVisible).toBe(true);
    expect(visualState.warningOpacity).toBeGreaterThan(0.3);
    expect(visualState.warningScale).toBeGreaterThan(0.9);
  });

  it("hides the warning marker once the cube is falling", () => {
    expect(
      getSkyDropVisualState(
        {
          id: "sky-2",
          phase: "falling",
          warningRemaining: 0,
          landingVoxel: { x: 10, y: 10, z: 10 },
          offsetY: 7.5
        },
        1
      )
    ).toEqual({
      warningVisible: false,
      warningScale: 1,
      warningOpacity: 0,
      warningEmissive: 0
    });
  });
});
