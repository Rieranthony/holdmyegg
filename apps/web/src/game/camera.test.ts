import { describe, expect, it } from "vitest";
import {
  aimCameraConfig,
  applyFreeLookDelta,
  clampLookPitch,
  dampScalar,
  getAimRigState,
  getAimTarget,
  getChaseRigScalars,
  getForwardSpeedRatio,
  getPlanarForwardBetweenPoints,
  getPlanarVectorFromYaw,
  getRuntimeFocusRayDistance,
  getSpeedCameraBlend,
  getYawFromPlanarVector,
  stepAngleToward
} from "./camera";

describe("stepAngleToward", () => {
  it("takes the shortest path across the wrap boundary", () => {
    const current = Math.PI - 0.04;
    const target = -Math.PI + 0.04;
    const next = stepAngleToward(current, target, 0.02);

    expect(next).toBeCloseTo(Math.PI - 0.02, 5);
  });

  it("snaps to the target when the remaining turn is within the step size", () => {
    const current = 0.4;
    const target = 0.45;
    const next = stepAngleToward(current, target, 0.1);

    expect(next).toBe(target);
  });
});

describe("camera yaw helpers", () => {
  it("round-trips between planar yaw and forward vectors", () => {
    const yaw = Math.PI / 3;
    const vector = getPlanarVectorFromYaw(yaw);
    expect(getYawFromPlanarVector(vector)).toBeCloseTo(yaw, 5);
  });

  it("derives a planar forward vector from camera position and look target", () => {
    const forward = getPlanarForwardBetweenPoints(
      { x: 2, z: 4 },
      { x: 5, z: 8 }
    );

    expect(forward.x).toBeCloseTo(0.6, 5);
    expect(forward.z).toBeCloseTo(0.8, 5);
  });
});

describe("speed camera helpers", () => {
  it("returns a forward speed ratio only when moving into the camera forward vector", () => {
    expect(getForwardSpeedRatio({ x: 6, y: 0, z: 0 }, { x: 1, z: 0 }, 6)).toBeCloseTo(1, 5);
    expect(getForwardSpeedRatio({ x: -6, y: 0, z: 0 }, { x: 1, z: 0 }, 6)).toBe(0);
    expect(getForwardSpeedRatio({ x: 0, y: 0, z: 6 }, { x: 1, z: 0 }, 6)).toBe(0);
  });

  it("keeps the speed blend off until the threshold and ramps to full at max speed", () => {
    expect(getSpeedCameraBlend(0.65)).toBe(0);
    expect(getSpeedCameraBlend(0.825)).toBeCloseTo(0.5, 5);
    expect(getSpeedCameraBlend(1)).toBe(1);
  });

  it("damps scalar changes without snapping to the target", () => {
    const next = dampScalar(0, 1, 7, 1 / 60);

    expect(next).toBeGreaterThan(0);
    expect(next).toBeLessThan(1);
  });
});

describe("free-look helpers", () => {
  it("applies free-look mouse deltas to yaw and pitch", () => {
    const next = applyFreeLookDelta(
      { yaw: 0, pitch: 0 },
      { deltaX: 40, deltaY: 20 }
    );

    expect(next.yaw).toBeCloseTo(-0.2, 5);
    expect(next.pitch).toBeCloseTo(0.08, 5);
  });

  it("clamps look pitch into the supported aim range", () => {
    const next = applyFreeLookDelta(
      { yaw: 0, pitch: 0.35 },
      { deltaX: 0, deltaY: 500 }
    );

    expect(clampLookPitch(next.pitch)).toBeCloseTo(aimCameraConfig.maxPitch, 5);
  });

  it("moves the aim target above the horizon when the player looks up", () => {
    const aimTarget = getAimTarget(
      { x: 10, y: 2.6, z: 8 },
      0,
      (20 * Math.PI) / 180
    );

    expect(aimTarget.z).toBeGreaterThan(8);
    expect(aimTarget.y).toBeGreaterThan(2.6);
  });

  it("keeps the player centered without horizontal shoulder bias", () => {
    const forwardAim = getAimRigState({ x: 10, y: 2, z: 8 }, 0, 0.1, 0);
    const sideAim = getAimRigState({ x: 10, y: 2, z: 8 }, Math.PI / 2, 0.1, 0);

    expect(forwardAim.cameraPosition.x).toBeCloseTo(forwardAim.aimPivot.x, 5);
    expect(sideAim.cameraPosition.z).toBeCloseTo(sideAim.aimPivot.z, 5);
  });

  it("keeps speed blend on the chase framing instead of the aim target", () => {
    const slowAim = getAimRigState({ x: 10, y: 2, z: 8 }, Math.PI / 2, 0.1, 0);
    const fastAim = getAimRigState({ x: 10, y: 2, z: 8 }, Math.PI / 2, 0.1, 1);

    expect(fastAim.aimTarget).toEqual(slowAim.aimTarget);
    expect(fastAim.cameraPosition.x).toBeGreaterThan(slowAim.cameraPosition.x);
    expect(fastAim.cameraPosition.y).toBeLessThan(slowAim.cameraPosition.y);
    expect(fastAim.cameraPosition.z).toBeCloseTo(slowAim.cameraPosition.z, 5);
  });

  it("reduces chase distance and height at full speed blend", () => {
    const slowRig = getChaseRigScalars(0);
    const fastRig = getChaseRigScalars(1);

    expect(fastRig.chaseDistance).toBeLessThan(slowRig.chaseDistance);
    expect(fastRig.heightOffset).toBeLessThan(slowRig.heightOffset);
  });

  it("casts runtime focus rays far enough to cover the over-shoulder camera offset", () => {
    const rayDistance = getRuntimeFocusRayDistance(4.5);
    const slowRig = getChaseRigScalars(0);
    const minimumReach = 4.5 + slowRig.chaseDistance + slowRig.heightOffset + slowRig.shoulderOffset;

    expect(rayDistance).toBeGreaterThan(minimumReach);
    expect(rayDistance).toBeGreaterThan(4.5);
    expect(slowRig.shoulderOffset).toBe(0);
  });
});
