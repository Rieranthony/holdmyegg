import { describe, expect, it } from "vitest";
import {
  chickenPoseVisualDefaults,
  getChickenPoseVisualState,
  getChickenWingVisualState,
  getPlayerAvatarVisualState,
  shouldTriggerChickenLandingTumble
} from "./playerVisuals";

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
        planarSpeed: 0,
        jetpackActive: false,
        motionSeed: 0.4,
        stunned: false,
        elapsedTime: 0.2
      })
    ).toEqual({
      leftWingAngle: 0.22,
      rightWingAngle: 0.22,
      wingSpanScale: 1,
      traceIntensity: 0,
      traceLength: 0,
      motion: "folded"
    });
  });

  it("animates a wider asymmetric flap while rising from a jump", () => {
    const wingState = getChickenWingVisualState({
      alive: true,
      grounded: false,
      velocityY: 3,
      planarSpeed: 3.4,
      jetpackActive: false,
      motionSeed: 0.7,
      stunned: false,
      elapsedTime: 0.1
    });

    expect(wingState.motion).toBe("jump");
    expect(wingState.leftWingAngle).toBeGreaterThan(0.22);
    expect(wingState.rightWingAngle).toBeGreaterThan(0.22);
    expect(Math.abs(wingState.leftWingAngle - wingState.rightWingAngle)).toBeGreaterThan(0.01);
    expect(wingState.wingSpanScale).toBeGreaterThan(1);
    expect(wingState.traceIntensity).toBeGreaterThan(0);
    expect(wingState.traceLength).toBeGreaterThan(0.75);
  });

  it("starts the jump flap on any positive ascent", () => {
    const wingState = getChickenWingVisualState({
      alive: true,
      grounded: false,
      velocityY: 0.2,
      planarSpeed: 0.8,
      jetpackActive: false,
      motionSeed: 0.2,
      stunned: false,
      elapsedTime: 0.15
    });

    expect(wingState.motion).toBe("jump");
    expect(wingState.wingSpanScale).toBeGreaterThan(1);
    expect(wingState.traceIntensity).toBeGreaterThan(0);
  });

  it("keeps wings extended with traces while descending through the air", () => {
    const wingState = getChickenWingVisualState({
      alive: true,
      grounded: false,
      velocityY: -4.5,
      planarSpeed: 4.2,
      jetpackActive: false,
      motionSeed: 1.3,
      stunned: false,
      elapsedTime: 0.35
    });

    expect(wingState.motion).toBe("descend");
    expect(wingState.leftWingAngle).toBeGreaterThan(0.5);
    expect(wingState.rightWingAngle).toBeGreaterThan(0.5);
    expect(wingState.wingSpanScale).toBeGreaterThan(1.15);
    expect(wingState.traceIntensity).toBeGreaterThan(0.2);
    expect(wingState.traceLength).toBeGreaterThan(0.9);
  });

  it("uses a faster sustained flap while the jetpack is active", () => {
    const jumpState = getChickenWingVisualState({
      alive: true,
      grounded: false,
      velocityY: 2,
      planarSpeed: 3,
      jetpackActive: false,
      motionSeed: 0.9,
      stunned: false,
      elapsedTime: 0.05
    });
    const wingState = getChickenWingVisualState({
      alive: true,
      grounded: false,
      velocityY: 2,
      planarSpeed: 3,
      jetpackActive: true,
      motionSeed: 0.9,
      stunned: false,
      elapsedTime: 0.05
    });

    expect(wingState.motion).toBe("jetpack");
    expect(wingState.leftWingAngle).toBeGreaterThan(0.6);
    expect(wingState.wingSpanScale).toBeGreaterThan(jumpState.wingSpanScale);
    expect(wingState.traceIntensity).toBeGreaterThan(jumpState.traceIntensity);
    expect(wingState.traceLength).toBeGreaterThan(jumpState.traceLength);
  });

  it("stops flapping and hides traces when stunned", () => {
    expect(
      getChickenWingVisualState({
        alive: true,
        grounded: false,
        velocityY: 4,
        planarSpeed: 5,
        jetpackActive: true,
        motionSeed: 1.6,
        stunned: true,
        elapsedTime: 0.05
      })
    ).toEqual({
      leftWingAngle: 0.22,
      rightWingAngle: 0.22,
      wingSpanScale: 1,
      traceIntensity: 0,
      traceLength: 0,
      motion: "folded"
    });
  });
});

describe("getChickenPoseVisualState", () => {
  it("peaks into an aggressive pose during push visuals and settles back to neutral", () => {
    const activePose = getChickenPoseVisualState({
      grounded: true,
      velocityY: 0,
      planarSpeed: 0,
      elapsedTime: 0.4,
      motionSeed: 0.3,
      pushVisualRemaining: chickenPoseVisualDefaults.pushDuration * 0.5,
      landingRollRemaining: 0,
      stunned: false
    });
    const neutralPose = getChickenPoseVisualState({
      grounded: true,
      velocityY: 0,
      planarSpeed: 0,
      elapsedTime: 0.4,
      motionSeed: 0.3,
      pushVisualRemaining: 0,
      landingRollRemaining: 0,
      stunned: false
    });

    expect(activePose.bodyPitch).toBeGreaterThan(0);
    expect(activePose.bodyForwardOffset).toBeGreaterThan(0);
    expect(activePose.wingAngleOffset).toBeGreaterThan(0);
    expect(neutralPose).toMatchObject({
      bodyPitch: 0,
      bodyRoll: 0,
      bodyYaw: 0,
      bodyForwardOffset: 0,
      wingAngleOffset: 0,
      headPitch: 0,
      headYaw: 0,
      headYOffset: 0,
      leftLegPitch: 0,
      rightLegPitch: 0,
      featherSwing: 0
    });
  });

  it("adds a goofy run cycle while grounded and moving", () => {
    const runPose = getChickenPoseVisualState({
      grounded: true,
      velocityY: 0,
      planarSpeed: 4.2,
      elapsedTime: 0.37,
      motionSeed: 0.8,
      pushVisualRemaining: 0,
      landingRollRemaining: 0,
      stunned: false
    });

    expect(Math.abs(runPose.bodyYaw)).toBeGreaterThan(0.03);
    expect(runPose.headPitch).toBeGreaterThan(0.05);
    expect(Math.abs(runPose.headYaw)).toBeGreaterThan(0.02);
    expect(Math.abs(runPose.leftLegPitch)).toBeGreaterThan(0.1);
    expect(Math.abs(runPose.rightLegPitch)).toBeGreaterThan(0.1);
    expect(runPose.leftLegPitch).toBe(-runPose.rightLegPitch);
  });

  it("keeps idle or stunned chickens near neutral on the ground", () => {
    const idlePose = getChickenPoseVisualState({
      grounded: true,
      velocityY: 0,
      planarSpeed: 0,
      elapsedTime: 0.37,
      motionSeed: 0.8,
      pushVisualRemaining: 0,
      landingRollRemaining: 0,
      stunned: false
    });
    const stunnedPose = getChickenPoseVisualState({
      grounded: true,
      velocityY: 0,
      planarSpeed: 4.2,
      elapsedTime: 0.37,
      motionSeed: 0.8,
      pushVisualRemaining: 0,
      landingRollRemaining: 0,
      stunned: true
    });

    expect(idlePose.bodyYaw).toBe(0);
    expect(idlePose.headPitch).toBe(0);
    expect(idlePose.leftLegPitch).toBe(0);
    expect(stunnedPose.bodyYaw).toBe(0);
    expect(stunnedPose.headPitch).toBe(0);
    expect(stunnedPose.leftLegPitch).toBe(0);
  });

  it("blends airborne descending chickens into a nose-down dive pose", () => {
    const divePose = getChickenPoseVisualState({
      grounded: false,
      velocityY: -6,
      planarSpeed: 4.4,
      elapsedTime: 0.37,
      motionSeed: 0.8,
      pushVisualRemaining: 0,
      landingRollRemaining: 0,
      stunned: false
    });

    expect(divePose.bodyPitch).toBeGreaterThan(0.25);
    expect(divePose.bodyForwardOffset).toBe(0);
    expect(divePose.leftLegPitch).toBe(0);
    expect(divePose.headPitch).toBe(0);
  });

  it("suppresses the grounded run exaggeration during landing tumbles", () => {
    const runPose = getChickenPoseVisualState({
      grounded: true,
      velocityY: 0,
      planarSpeed: 4.2,
      elapsedTime: 0.37,
      motionSeed: 0.8,
      pushVisualRemaining: 0,
      landingRollRemaining: 0,
      stunned: false
    });
    const landingPose = getChickenPoseVisualState({
      grounded: true,
      velocityY: 0,
      planarSpeed: 4.2,
      elapsedTime: 0.37,
      motionSeed: 0.8,
      pushVisualRemaining: 0,
      landingRollRemaining: chickenPoseVisualDefaults.landingTumbleDuration * 0.8,
      stunned: false
    });

    expect(Math.abs(runPose.leftLegPitch)).toBeGreaterThan(0.1);
    expect(Math.abs(landingPose.leftLegPitch)).toBeLessThan(0.02);
    expect(Math.abs(landingPose.headPitch)).toBeLessThan(runPose.headPitch);
  });

  it("adds a slow astronaut-like float pose during the space phase", () => {
    const floatPose = getChickenPoseVisualState({
      grounded: false,
      velocityY: 1.4,
      planarSpeed: 0.6,
      elapsedTime: 0.81,
      motionSeed: 0.42,
      pushVisualRemaining: 0,
      landingRollRemaining: 0,
      spacePhase: "float",
      spacePhaseRemaining: chickenPoseVisualDefaults.spaceFloatDuration * 0.55,
      stunned: false
    });

    expect(Math.abs(floatPose.bodyRoll)).toBeGreaterThan(0.04);
    expect(Math.abs(floatPose.bodyYaw)).toBeGreaterThan(0.03);
    expect(Math.abs(floatPose.headYaw)).toBeGreaterThan(0.02);
    expect(floatPose.leftLegPitch).toBeGreaterThan(0.08);
    expect(floatPose.rightLegPitch).toBeLessThan(-0.08);
  });

  it("pushes reentry into a steeper dive than a normal fall", () => {
    const divePose = getChickenPoseVisualState({
      grounded: false,
      velocityY: -6,
      planarSpeed: 3.2,
      elapsedTime: 0.41,
      motionSeed: 0.36,
      pushVisualRemaining: 0,
      landingRollRemaining: 0,
      stunned: false
    });
    const reentryPose = getChickenPoseVisualState({
      grounded: false,
      velocityY: -6,
      planarSpeed: 3.2,
      elapsedTime: 0.41,
      motionSeed: 0.36,
      pushVisualRemaining: 0,
      landingRollRemaining: 0,
      spacePhase: "reentry",
      spacePhaseRemaining: 0,
      stunned: false
    });

    expect(reentryPose.bodyPitch).toBeGreaterThan(divePose.bodyPitch);
    expect(reentryPose.headPitch).toBeGreaterThan(divePose.headPitch);
    expect(Math.abs(reentryPose.bodyRoll)).toBeGreaterThan(Math.abs(divePose.bodyRoll));
  });

  it("increases feather sway with motion energy but stays subtle at idle", () => {
    const idlePose = getChickenPoseVisualState({
      grounded: true,
      velocityY: 0,
      planarSpeed: 0,
      elapsedTime: 0.25,
      motionSeed: 0.5,
      pushVisualRemaining: 0,
      landingRollRemaining: 0,
      stunned: false
    });
    const runPose = getChickenPoseVisualState({
      grounded: true,
      velocityY: 0,
      planarSpeed: 4.4,
      elapsedTime: 0.25,
      motionSeed: 0.5,
      pushVisualRemaining: 0,
      landingRollRemaining: 0,
      stunned: false
    });
    const airbornePose = getChickenPoseVisualState({
      grounded: false,
      velocityY: -5.2,
      planarSpeed: 3.1,
      elapsedTime: 0.25,
      motionSeed: 0.5,
      pushVisualRemaining: 0,
      landingRollRemaining: 0,
      stunned: false
    });

    expect(Math.abs(idlePose.featherSwing)).toBeLessThan(0.005);
    expect(Math.abs(runPose.featherSwing)).toBeGreaterThan(Math.abs(idlePose.featherSwing));
    expect(Math.abs(airbornePose.featherSwing)).toBeGreaterThan(0.01);
  });
});

describe("shouldTriggerChickenLandingTumble", () => {
  it("triggers on hard airborne landings only", () => {
    expect(
      shouldTriggerChickenLandingTumble({
        wasGrounded: false,
        grounded: true,
        previousVelocityY: -(chickenPoseVisualDefaults.landingTumbleHardSpeed + 0.1)
      })
    ).toBe(true);
    expect(
      shouldTriggerChickenLandingTumble({
        wasGrounded: false,
        grounded: true,
        previousVelocityY: -2
      })
    ).toBe(false);
    expect(
      shouldTriggerChickenLandingTumble({
        wasGrounded: true,
        grounded: true,
        previousVelocityY: -9
      })
    ).toBe(false);
  });
});
