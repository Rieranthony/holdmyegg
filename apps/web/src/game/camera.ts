import type { Vector2, Vector3 } from "@out-of-bounds/sim";

export interface AimAngles {
  yaw: number;
  pitch: number;
}

export interface PointerLookDelta {
  deltaX: number;
  deltaY: number;
}

export interface ChaseRigScalars {
  chaseDistance: number;
  heightOffset: number;
  shoulderOffset: number;
}

export interface AimRigState {
  aimPivot: Vector3;
  lookDirection: Vector3;
  aimTarget: Vector3;
  cameraPosition: Vector3;
  planarForward: Vector2;
}

export const chaseCameraConfig = {
  chaseDistance: 8.5,
  height: 6.8,
  lookAtHeight: 1.6,
  yawFollowSpeed: 8.5,
  positionDamping: 7,
  lookTargetDamping: 9
} as const;

export const fastChaseCameraConfig = {
  chaseDistance: 7.8,
  height: 5.4
} as const;

export const aimCameraConfig = {
  yawSensitivity: 0.005,
  pitchSensitivity: 0.004,
  minPitch: (-55 * Math.PI) / 180,
  maxPitch: (40 * Math.PI) / 180,
  aimDistance: 24,
  aimPivotHeight: 1.6,
  shoulderOffset: 0,
  defaultPitch: (-22 * Math.PI) / 180
} as const;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const lerp = (start: number, end: number, alpha: number) => start + (end - start) * alpha;

export const normalizePlanarVector = (x: number, z: number): Vector2 => {
  const length = Math.hypot(x, z);
  if (length === 0) {
    return { x: 1, z: 0 };
  }

  return {
    x: x / length,
    z: z / length
  };
};

export const getYawFromPlanarVector = (vector: Vector2) => Math.atan2(vector.x, vector.z);

export const getPlanarVectorFromYaw = (yaw: number): Vector2 => ({
  x: Math.sin(yaw),
  z: Math.cos(yaw)
});

export const normalizeAngle = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

export const stepAngleToward = (current: number, target: number, maxStep: number) => {
  const delta = normalizeAngle(target - current);
  if (Math.abs(delta) <= maxStep) {
    return target;
  }

  return normalizeAngle(current + Math.sign(delta) * maxStep);
};

export const dampScalar = (current: number, target: number, damping: number, delta: number) =>
  lerp(current, target, 1 - Math.exp(-delta * damping));

export const getForwardSpeedRatio = (velocity: Vector3, forward: Vector2, moveSpeed: number) => {
  if (moveSpeed <= 0) {
    return 0;
  }

  const direction = normalizePlanarVector(forward.x, forward.z);
  const forwardVelocity = velocity.x * direction.x + velocity.z * direction.z;
  return clamp(forwardVelocity / moveSpeed, 0, 1);
};

export const getSpeedCameraBlend = (forwardSpeedRatio: number) => {
  if (forwardSpeedRatio <= 0.65) {
    return 0;
  }

  return clamp((forwardSpeedRatio - 0.65) / 0.35, 0, 1);
};

export const clampLookPitch = (pitch: number) => clamp(pitch, aimCameraConfig.minPitch, aimCameraConfig.maxPitch);

export const applyFreeLookDelta = (angles: AimAngles, delta: PointerLookDelta): AimAngles => ({
  yaw: normalizeAngle(angles.yaw - delta.deltaX * aimCameraConfig.yawSensitivity),
  pitch: clampLookPitch(angles.pitch + delta.deltaY * aimCameraConfig.pitchSensitivity)
});

export const getLookDirection = (yaw: number, pitch: number): Vector3 => {
  const cosPitch = Math.cos(pitch);
  return {
    x: Math.sin(yaw) * cosPitch,
    y: Math.sin(pitch),
    z: Math.cos(yaw) * cosPitch
  };
};

export const getChaseRigScalars = (speedBlend = 0): ChaseRigScalars => {
  const blend = clamp(speedBlend, 0, 1);
  const chaseDistance = lerp(chaseCameraConfig.chaseDistance, fastChaseCameraConfig.chaseDistance, blend);
  const height = lerp(chaseCameraConfig.height, fastChaseCameraConfig.height, blend);

  return {
    chaseDistance,
    heightOffset: height - aimCameraConfig.aimPivotHeight,
    shoulderOffset: aimCameraConfig.shoulderOffset
  };
};

export const getRuntimeFocusRayDistance = (interactRange: number) => {
  const slowRig = getChaseRigScalars(0);
  const minimumCameraReach =
    interactRange + slowRig.chaseDistance + slowRig.heightOffset + slowRig.shoulderOffset + 1;

  return Math.max(aimCameraConfig.aimDistance, minimumCameraReach);
};

export const getAimPivot = (position: Vector3): Vector3 => ({
  x: position.x,
  y: position.y + aimCameraConfig.aimPivotHeight,
  z: position.z
});

export const getAimTarget = (aimPivot: Vector3, yaw: number, pitch: number): Vector3 => {
  const lookDirection = getLookDirection(yaw, pitch);
  return {
    x: aimPivot.x + lookDirection.x * aimCameraConfig.aimDistance,
    y: aimPivot.y + lookDirection.y * aimCameraConfig.aimDistance,
    z: aimPivot.z + lookDirection.z * aimCameraConfig.aimDistance
  };
};

export const getOverShoulderCameraPosition = (
  aimPivot: Vector3,
  yaw: number,
  speedBlend = 0
): Vector3 => {
  const planarForward = getPlanarVectorFromYaw(yaw);
  const rig = getChaseRigScalars(speedBlend);
  const right = {
    x: planarForward.z,
    z: -planarForward.x
  };

  return {
    x: aimPivot.x - planarForward.x * rig.chaseDistance + right.x * rig.shoulderOffset,
    y: aimPivot.y + rig.heightOffset,
    z: aimPivot.z - planarForward.z * rig.chaseDistance + right.z * rig.shoulderOffset
  };
};

export const getAimRigState = (position: Vector3, yaw: number, pitch: number, speedBlend = 0): AimRigState => {
  const aimPivot = getAimPivot(position);
  const lookDirection = getLookDirection(yaw, pitch);
  const aimTarget = getAimTarget(aimPivot, yaw, pitch);
  const cameraPosition = getOverShoulderCameraPosition(aimPivot, yaw, speedBlend);

  return {
    aimPivot,
    lookDirection,
    aimTarget,
    cameraPosition,
    planarForward: normalizePlanarVector(lookDirection.x, lookDirection.z)
  };
};

export const getPlanarForwardBetweenPoints = (
  from: Pick<Vector3, "x" | "z">,
  to: Pick<Vector3, "x" | "z">
): Vector2 => normalizePlanarVector(to.x - from.x, to.z - from.z);
