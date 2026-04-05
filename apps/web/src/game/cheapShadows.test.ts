import { describe, expect, it } from "vitest";
import { getPlayerBlobShadowState, getSkyDropLandingShadowState } from "./cheapShadows";

describe("cheapShadows", () => {
  it("fades and widens player blob shadows as players lift away from the surface", () => {
    const grounded = getPlayerBlobShadowState({
      playerY: 5.05,
      surfaceY: 5.05,
      isLocal: true,
      stunned: false
    });
    const airborne = getPlayerBlobShadowState({
      playerY: 7.05,
      surfaceY: 5.05,
      isLocal: true,
      stunned: false
    });

    expect(grounded.opacity).toBeGreaterThan(airborne.opacity);
    expect(grounded.scale).toBeLessThan(airborne.scale);
    expect(grounded.yOffset).toBeGreaterThan(airborne.yOffset);
  });

  it("keeps local-player shadows slightly stronger and softens stunned shadows", () => {
    const local = getPlayerBlobShadowState({
      playerY: 5.05,
      surfaceY: 5.05,
      isLocal: true,
      stunned: false
    });
    const npc = getPlayerBlobShadowState({
      playerY: 5.05,
      surfaceY: 5.05,
      isLocal: false,
      stunned: false
    });
    const stunned = getPlayerBlobShadowState({
      playerY: 5.05,
      surfaceY: 5.05,
      isLocal: true,
      stunned: true
    });

    expect(local.opacity).toBeGreaterThan(npc.opacity);
    expect(stunned.opacity).toBeLessThan(local.opacity);
  });

  it("keeps sky-drop landing shadows readable before and during impact", () => {
    const warning = getSkyDropLandingShadowState({
      phase: "warning",
      warningOpacity: 0.5,
      warningScale: 1.4
    });
    const falling = getSkyDropLandingShadowState({
      phase: "falling",
      warningOpacity: 0.5,
      warningScale: 1.4
    });

    expect(warning.opacity).toBeGreaterThan(0);
    expect(falling.opacity).toBeGreaterThan(warning.opacity);
    expect(falling.scale).toBeGreaterThan(1);
  });
});
