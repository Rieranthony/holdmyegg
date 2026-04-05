import { describe, expect, it } from "vitest";
import { getChickenWingVisualState, getPlayerAvatarVisualState } from "./playerVisuals";

describe("getPlayerAvatarVisualState", () => {
  it("returns a smashed scale while stunned", () => {
    const visualState = getPlayerAvatarVisualState(4.6, 1);

    expect(visualState.scaleX).toBeGreaterThan(1);
    expect(visualState.scaleY).toBeLessThan(0.4);
    expect(visualState.scaleZ).toBeGreaterThan(1);
  });

  it("eases back toward normal scale near the end of stun", () => {
    const visualState = getPlayerAvatarVisualState(0.1, 1);

    expect(visualState.scaleX).toBeLessThan(1.12);
    expect(visualState.scaleY).toBeGreaterThan(0.34);
    expect(visualState.scaleY).toBeLessThan(1);
  });

  it("stays fully visible and unsquashed when not stunned", () => {
    expect(getPlayerAvatarVisualState(0, 1)).toEqual({
      scaleX: 1,
      scaleY: 1,
      scaleZ: 1,
      blinkVisible: true
    });
  });
});

describe("getChickenWingVisualState", () => {
  it("keeps wings folded while grounded", () => {
    expect(
      getChickenWingVisualState({
        alive: true,
        grounded: true,
        velocityY: 0,
        jetpackActive: false,
        stunned: false,
        elapsedTime: 0.2
      })
    ).toEqual({
      wingAngle: 0.22,
      motion: "folded"
    });
  });

  it("animates a softer flap while rising from a jump", () => {
    const wingState = getChickenWingVisualState({
      alive: true,
      grounded: false,
      velocityY: 3,
      jetpackActive: false,
      stunned: false,
      elapsedTime: 0.1
    });

    expect(wingState.motion).toBe("jump");
    expect(wingState.wingAngle).toBeGreaterThan(0.22);
  });

  it("uses a faster sustained flap while the jetpack is active", () => {
    const wingState = getChickenWingVisualState({
      alive: true,
      grounded: false,
      velocityY: 2,
      jetpackActive: true,
      stunned: false,
      elapsedTime: 0.05
    });

    expect(wingState.motion).toBe("jetpack");
    expect(wingState.wingAngle).toBeGreaterThan(0.6);
  });

  it("stops flapping when stunned", () => {
    expect(
      getChickenWingVisualState({
        alive: true,
        grounded: false,
        velocityY: 4,
        jetpackActive: true,
        stunned: true,
        elapsedTime: 0.05
      })
    ).toEqual({
      wingAngle: 0.22,
      motion: "folded"
    });
  });
});
