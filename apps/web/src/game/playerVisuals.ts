import type { SpacePhase } from "@out-of-bounds/sim";

const SMASHED_SCALE_X = 1.12;
const SMASHED_SCALE_Y = 0.34;
const SMASHED_SCALE_Z = 1.12;
const RECOVERY_WINDOW = 0.2;
const BLINK_INTERVAL = 0.12;
const FOLDED_WING_ANGLE = 0.22;
const JUMP_WING_MIN_ANGLE = 0.32;
const JUMP_WING_MAX_ANGLE = 1.1;
const JUMP_WING_SPEED = 14;
const DESCEND_WING_MIN_ANGLE = 0.62;
const DESCEND_WING_MAX_ANGLE = 1.02;
const DESCEND_WING_SPEED = 6.2;
const JETPACK_WING_MIN_ANGLE = 0.16;
const JETPACK_WING_MAX_ANGLE = 1.14;
const JETPACK_WING_SPEED = 24;
const JUMP_WING_SPAN_MIN = 1.24;
const JUMP_WING_SPAN_MAX = 1.46;
const DESCEND_WING_SPAN_MIN = 1.28;
const DESCEND_WING_SPAN_MAX = 1.56;
const JETPACK_WING_SPAN_MIN = 1.24;
const JETPACK_WING_SPAN_MAX = 1.52;
const JUMP_TRACE_INTENSITY_MIN = 0.2;
const JUMP_TRACE_INTENSITY_MAX = 0.58;
const DESCEND_TRACE_INTENSITY_MIN = 0.24;
const DESCEND_TRACE_INTENSITY_MAX = 0.72;
const JETPACK_TRACE_INTENSITY_MIN = 0.48;
const JETPACK_TRACE_INTENSITY_MAX = 1;
const JUMP_TRACE_LENGTH_MIN = 0.78;
const JUMP_TRACE_LENGTH_MAX = 1.18;
const DESCEND_TRACE_LENGTH_MIN = 0.92;
const DESCEND_TRACE_LENGTH_MAX = 1.48;
const JETPACK_TRACE_LENGTH_MIN = 1.12;
const JETPACK_TRACE_LENGTH_MAX = 1.68;
const MAX_WING_ANGLE = 1.24;
const TAU = Math.PI * 2;
const PUSH_VISUAL_DURATION = 0.24;
const PUSH_WING_BOOST = 0.3;
const PUSH_BODY_PITCH = 0.26;
const PUSH_BODY_ROLL = 0.08;
const PUSH_BODY_LUNGE = 0.14;
const DIVE_ENTRY_SPEED = 2.2;
const DIVE_FULL_SPEED = 9.5;
const DIVE_PITCH_MAX = 0.88;
const LANDING_TUMBLE_DURATION = 0.34;
const LANDING_TUMBLE_HARD_SPEED = 5.4;
const LANDING_TUMBLE_PITCH = 0.28;
const LANDING_TUMBLE_ROLL = 0.18;
const LANDING_TUMBLE_LUNGE = 0.08;
const SPACE_FLOAT_DURATION = 5.0;
const SPACE_FLOAT_ROLL = 0.32;
const SPACE_FLOAT_PITCH = 0.18;
const SPACE_FLOAT_YAW = 0.26;
const SPACE_FLOAT_HEAD_YAW = 0.16;
const SPACE_FLOAT_HEAD_PITCH = 0.08;
const SPACE_FLOAT_HEAD_BOB = 0.08;
const SPACE_FLOAT_LEG_TUCK = 0.24;
const SPACE_FLOAT_FEATHER_SWING = 0.08;
const SPACE_REENTRY_DIVE_BOOST = 0.44;
const SPACE_REENTRY_ROLL = 0.14;
const SPACE_REENTRY_HEAD_PITCH = 0.16;
const SPACE_REENTRY_LEG_TUCK = 0.16;
const RUN_ENTRY_SPEED = 0.32;
const RUN_FULL_SPEED = 4.8;
const RUN_PHASE_SPEED_MIN = 7.8;
const RUN_PHASE_SPEED_MAX = 13.8;
const RUN_BODY_YAW = 0.18;
const RUN_BODY_ROLL = 0.16;
const RUN_BODY_PITCH = 0.08;
const RUN_HEAD_PITCH = 0.38;
const RUN_HEAD_YAW = 0.18;
const RUN_HEAD_BOB = 0.12;
const RUN_LEG_PITCH = 0.8;
const RUN_FEATHER_SWING = 0.11;
const AIR_FEATHER_SWING = 0.1;
const LANDING_FEATHER_SWING = 0.09;
const PLAYER_STATUS_INVULNERABLE_PULSE_SPEED = 18;
const PLAYER_STATUS_INVULNERABLE_OPACITY_MIN = 0.68;
const PLAYER_STATUS_INVULNERABLE_OPACITY_MAX = 1.18;
const EGG_CHARGE_BODY_PITCH = 0.26;
const EGG_CHARGE_BODY_ROLL = 0.34;
const EGG_CHARGE_BODY_YAW = 0.12;
const EGG_CHARGE_HEAD_YAW = 0.22;
const EGG_CHARGE_HEAD_PITCH = 0.1;
const EGG_CHARGE_FORWARD_OFFSET = 0.13;
const EGG_CHARGE_WING_OFFSET = 0.18;
const EGG_CHARGE_RIGHT_WING_BOOST = 0.82;
const EGG_CHARGE_LEFT_WING_BOOST = 0.2;
const EGG_CHARGE_WING_SPAN_BOOST = 0.18;
const EGG_RELEASE_FOLLOW_THROUGH_DURATION = 0.24;
const EGG_RELEASE_BODY_PITCH = 0.28;
const EGG_RELEASE_BODY_ROLL = 0.28;
const EGG_RELEASE_FORWARD_OFFSET = 0.18;
const EGG_RELEASE_HEAD_YAW = 0.14;

export interface ChickenFeatherOffset {
  x: number;
  y: number;
  z: number;
  rotationX: number;
  rotationY: number;
  rotationZ: number;
  scale: readonly [number, number, number];
  sway: number;
}

export const headFeatherOffsets = [
  {
    x: 0.12,
    y: 0.38,
    z: -0.04,
    rotationX: 0.12,
    rotationY: 0.02,
    rotationZ: -0.44,
    scale: [0.72, 0.9, 0.72] as const,
    sway: 0.22
  },
  {
    x: 0,
    y: 0.44,
    z: -0.08,
    rotationX: 0.06,
    rotationY: 0,
    rotationZ: 0,
    scale: [0.84, 1.06, 0.84] as const,
    sway: 0.28
  },
  {
    x: -0.12,
    y: 0.38,
    z: -0.04,
    rotationX: 0.12,
    rotationY: -0.02,
    rotationZ: 0.44,
    scale: [0.72, 0.9, 0.72] as const,
    sway: 0.22
  }
] as const satisfies readonly ChickenFeatherOffset[];

export const wingFeatherletOffsets = [
  {
    x: 0.02,
    y: -0.1,
    z: 0.16,
    rotationX: 0.18,
    rotationY: 0.12,
    rotationZ: -1.24,
    scale: [0.68, 0.8, 0.68] as const,
    sway: 0.34
  },
  {
    x: 0.14,
    y: -0.04,
    z: 0.14,
    rotationX: 0.12,
    rotationY: 0.08,
    rotationZ: -1.16,
    scale: [0.82, 0.92, 0.82] as const,
    sway: 0.26
  },
  {
    x: 0.26,
    y: 0.01,
    z: 0.1,
    rotationX: 0.08,
    rotationY: 0.04,
    rotationZ: -1.08,
    scale: [0.94, 1.02, 0.94] as const,
    sway: 0.18
  }
] as const satisfies readonly ChickenFeatherOffset[];

export const tailFeatherOffsets = [
  {
    x: 0.12,
    y: 0.02,
    z: -0.04,
    rotationX: -0.96,
    rotationY: 0.08,
    rotationZ: -0.42,
    scale: [0.74, 0.94, 0.74] as const,
    sway: 0.12
  },
  {
    x: 0,
    y: 0.08,
    z: -0.08,
    rotationX: -1.08,
    rotationY: 0,
    rotationZ: 0,
    scale: [0.86, 1.08, 0.86] as const,
    sway: 0.16
  },
  {
    x: -0.12,
    y: 0.02,
    z: -0.04,
    rotationX: -0.96,
    rotationY: -0.08,
    rotationZ: 0.42,
    scale: [0.74, 0.94, 0.74] as const,
    sway: 0.12
  }
] as const satisfies readonly ChickenFeatherOffset[];

export const chickenFeatherGeometry = {
  plumePositionY: 0.12,
  plumeSize: [0.1, 0.34, 0.1] as const,
  quillPositionY: -0.03,
  quillSize: [0.14, 0.1, 0.14] as const
} as const;

export const chickenWingRigGeometry = {
  baseHalfWidth: 0.09,
  innerOffsetX: 0.06,
  traceGapX: 0.12,
  traceHighDetailY: 0.08,
  traceLowDetailY: 0.06,
  lowDetailTraceBaseX: 0.54
} as const;

const lerp = (start: number, end: number, alpha: number) => start + (end - start) * alpha;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const stabilizeZero = (value: number) => (Math.abs(value) < 1e-6 ? 0 : value);
const normalizedSine = (elapsedTime: number, speed: number, phase = 0) =>
  (Math.sin(elapsedTime * speed + phase) + 1) * 0.5;
const hashString = (value: string) => {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
};

const getWingFlutter = (elapsedTime: number, speed: number, phase: number, amplitude: number) => {
  const primary = Math.sin(elapsedTime * speed + phase);
  const secondary = Math.sin(elapsedTime * speed * 1.67 + phase * 0.61);
  return (primary * 0.65 + secondary * 0.35) * amplitude;
};

const clampWingAngle = (value: number) => clamp(value, FOLDED_WING_ANGLE, MAX_WING_ANGLE);

const createWingVisualState = ({
  baseAngle,
  flutter,
  motion,
  traceIntensity,
  traceLength,
  wingSpanScale
}: {
  baseAngle: number;
  flutter: number;
  motion: ChickenWingVisualState["motion"];
  traceIntensity: number;
  traceLength: number;
  wingSpanScale: number;
}): ChickenWingVisualState => ({
  leftWingAngle: clampWingAngle(baseAngle + flutter),
  rightWingAngle: clampWingAngle(baseAngle - flutter * 0.85),
  wingSpanScale,
  traceIntensity,
  traceLength,
  motion
});

export interface PlayerAvatarVisualState {
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  blinkVisible: boolean;
}

export interface ChickenWingVisualInput {
  alive: boolean;
  grounded: boolean;
  velocityY: number;
  planarSpeed: number;
  jetpackActive: boolean;
  motionSeed: number;
  stunned: boolean;
  elapsedTime: number;
  eggLaunchChargeAlpha?: number;
  eggLaunchReleaseRemaining?: number;
}

export interface ChickenWingVisualState {
  leftWingAngle: number;
  rightWingAngle: number;
  wingSpanScale: number;
  traceIntensity: number;
  traceLength: number;
  motion: "folded" | "jump" | "descend" | "jetpack";
}

export interface PlayerStatusVisualState {
  ringOpacityMultiplier: number;
}

export interface ChickenPoseVisualInput {
  grounded: boolean;
  velocityY: number;
  planarSpeed?: number;
  elapsedTime?: number;
  motionSeed?: number;
  pushVisualRemaining: number;
  landingRollRemaining: number;
  spacePhase?: SpacePhase;
  spacePhaseRemaining?: number;
  stunned?: boolean;
  eggLaunchChargeAlpha?: number;
  eggLaunchReleaseRemaining?: number;
}

export interface ChickenPoseVisualState {
  bodyPitch: number;
  bodyRoll: number;
  bodyYaw: number;
  bodyForwardOffset: number;
  wingAngleOffset: number;
  headPitch: number;
  headYaw: number;
  headYOffset: number;
  leftLegPitch: number;
  rightLegPitch: number;
  featherSwing: number;
}

export const chickenPoseVisualDefaults = {
  pushDuration: PUSH_VISUAL_DURATION,
  landingTumbleDuration: LANDING_TUMBLE_DURATION,
  landingTumbleHardSpeed: LANDING_TUMBLE_HARD_SPEED,
  spaceFloatDuration: SPACE_FLOAT_DURATION,
  eggLaunchReleaseDuration: EGG_RELEASE_FOLLOW_THROUGH_DURATION
} as const;

export const getChickenMotionSeed = (playerId: string) => ((hashString(playerId) % 4096) / 4096) * TAU;

export const getChickenWingMeshOffsetX = (wingSpanScale: number) =>
  chickenWingRigGeometry.innerOffsetX + chickenWingRigGeometry.baseHalfWidth * wingSpanScale;

export const getChickenLowDetailWingMeshOffsetX = (wingSpanScale: number) =>
  Math.max(0.24, getChickenWingMeshOffsetX(wingSpanScale) - 0.06);

export const getChickenWingTraceOffsetX = (wingSpanScale: number) =>
  getChickenWingMeshOffsetX(wingSpanScale) +
  chickenWingRigGeometry.baseHalfWidth * wingSpanScale +
  chickenWingRigGeometry.traceGapX;

export const getChickenLowDetailTraceOffsetX = (wingSpanScale: number) =>
  chickenWingRigGeometry.lowDetailTraceBaseX + (wingSpanScale - 1) * 0.28;

export const getChickenWingHeightScale = (wingSpanScale: number) => 1 + (wingSpanScale - 1) * 0.22;

export const getChickenWingDepthScale = (wingSpanScale: number) => 1 + (wingSpanScale - 1) * 0.68;

export const getChickenWingTraceHeightScale = (traceIntensity: number) => 0.86 + traceIntensity * 0.38;

export const getChickenLowDetailWingTraceHeightScale = (traceIntensity: number) => 0.68 + traceIntensity * 0.24;

export const getChickenHeadFeatherRotation = (
  feather: ChickenFeatherOffset,
  featherSwing: number,
  swingScale = 1
) => ({
  x: feather.rotationX + featherSwing * (0.24 + feather.sway * 0.44) * swingScale,
  y: feather.rotationY + featherSwing * feather.sway * 0.12 * swingScale,
  z: feather.rotationZ + featherSwing * feather.sway * 0.72 * swingScale
});

export const getChickenWingFeatherletRotation = (
  feather: ChickenFeatherOffset,
  featherSwing: number,
  side: 1 | -1
) => ({
  x: feather.rotationX + featherSwing * (0.18 + feather.sway * 0.34),
  y: feather.rotationY * side + featherSwing * feather.sway * 0.28 * side,
  z: feather.rotationZ * side + featherSwing * feather.sway * 0.9 * side
});

export const getChickenTailMotion = (featherSwing: number) => ({
  x: featherSwing * 0.3,
  z: featherSwing * 0.16
});

export const getPlayerAvatarVisualState = (stunRemaining: number, elapsedTime: number): PlayerAvatarVisualState => {
  if (stunRemaining <= 0) {
    return {
      scaleX: 1,
      scaleY: 1,
      scaleZ: 1,
      blinkVisible: true
    };
  }

  const recoveryAlpha =
    stunRemaining < RECOVERY_WINDOW ? 1 - stunRemaining / RECOVERY_WINDOW : 0;
  const blinkVisible = Math.floor(elapsedTime / BLINK_INTERVAL) % 2 === 0;

  return {
    scaleX: lerp(SMASHED_SCALE_X, 1, recoveryAlpha),
    scaleY: lerp(SMASHED_SCALE_Y, 1, recoveryAlpha),
    scaleZ: lerp(SMASHED_SCALE_Z, 1, recoveryAlpha),
    blinkVisible
  };
};

export const getChickenWingVisualState = ({
  alive,
  grounded,
  velocityY,
  planarSpeed,
  jetpackActive,
  motionSeed,
  stunned,
  elapsedTime,
  eggLaunchChargeAlpha = 0,
  eggLaunchReleaseRemaining = 0
}: ChickenWingVisualInput): ChickenWingVisualState => {
  if (!alive || stunned) {
    return createWingVisualState({
      baseAngle: FOLDED_WING_ANGLE,
      flutter: 0,
      motion: "folded",
      traceIntensity: 0,
      traceLength: 0,
      wingSpanScale: 1
    });
  }

  const chargeAlpha = clamp(eggLaunchChargeAlpha, 0, 1);
  const releaseAlpha = clamp(eggLaunchReleaseRemaining / EGG_RELEASE_FOLLOW_THROUGH_DURATION, 0, 1);
  const releasePulse = Math.sin((1 - releaseAlpha) * Math.PI) * releaseAlpha;

  if (grounded && (chargeAlpha > 0 || releaseAlpha > 0)) {
    return {
      leftWingAngle: clampWingAngle(
        FOLDED_WING_ANGLE +
          chargeAlpha * EGG_CHARGE_LEFT_WING_BOOST +
          releasePulse * 0.12
      ),
      rightWingAngle: clampWingAngle(
        FOLDED_WING_ANGLE +
          chargeAlpha * EGG_CHARGE_RIGHT_WING_BOOST +
          releasePulse * 0.28
      ),
      wingSpanScale: 1 + chargeAlpha * EGG_CHARGE_WING_SPAN_BOOST + releasePulse * 0.08,
      traceIntensity: 0,
      traceLength: 0,
      motion: "folded"
    };
  }

  if (jetpackActive) {
    const speedAlpha = clamp(planarSpeed / 6, 0, 1);
    const liftAlpha = clamp((Math.max(velocityY, 0) + planarSpeed * 0.16) / 5.6, 0, 1);
    const motionAlpha = clamp(liftAlpha * 0.65 + speedAlpha * 0.35, 0, 1);
    const baseAngle = lerp(
      JETPACK_WING_MIN_ANGLE,
      JETPACK_WING_MAX_ANGLE,
      normalizedSine(elapsedTime, JETPACK_WING_SPEED + speedAlpha * 6, motionSeed * 0.41)
    );
    return createWingVisualState({
      baseAngle,
      flutter: getWingFlutter(elapsedTime, JETPACK_WING_SPEED * 0.46, motionSeed + 0.8, 0.04 + motionAlpha * 0.1),
      motion: "jetpack",
      traceIntensity: lerp(JETPACK_TRACE_INTENSITY_MIN, JETPACK_TRACE_INTENSITY_MAX, motionAlpha),
      traceLength: lerp(JETPACK_TRACE_LENGTH_MIN, JETPACK_TRACE_LENGTH_MAX, motionAlpha),
      wingSpanScale: lerp(JETPACK_WING_SPAN_MIN, JETPACK_WING_SPAN_MAX, motionAlpha)
    });
  }

  if (!grounded && velocityY > 0) {
    const climbAlpha = clamp(velocityY / 4.8, 0, 1);
    const speedAlpha = clamp(planarSpeed / 6, 0, 1);
    const motionAlpha = clamp(climbAlpha * 0.72 + speedAlpha * 0.28, 0, 1);
    const baseAngle = lerp(
      JUMP_WING_MIN_ANGLE,
      JUMP_WING_MAX_ANGLE,
      normalizedSine(elapsedTime, JUMP_WING_SPEED + speedAlpha * 3, motionSeed * 0.28)
    );
    return createWingVisualState({
      baseAngle,
      flutter: getWingFlutter(elapsedTime, JUMP_WING_SPEED * 0.7, motionSeed + 0.35, 0.03 + motionAlpha * 0.08),
      motion: "jump",
      traceIntensity: lerp(JUMP_TRACE_INTENSITY_MIN, JUMP_TRACE_INTENSITY_MAX, motionAlpha),
      traceLength: lerp(JUMP_TRACE_LENGTH_MIN, JUMP_TRACE_LENGTH_MAX, motionAlpha),
      wingSpanScale: lerp(JUMP_WING_SPAN_MIN, JUMP_WING_SPAN_MAX, motionAlpha)
    });
  }

  if (!grounded) {
    const descentAlpha = clamp((-velocityY + 0.3) / 6.4, 0, 1);
    const speedAlpha = clamp(planarSpeed / 6, 0, 1);
    const motionAlpha = clamp(descentAlpha * 0.58 + speedAlpha * 0.42, 0, 1);
    const baseAngle = lerp(
      DESCEND_WING_MIN_ANGLE,
      DESCEND_WING_MAX_ANGLE,
      normalizedSine(elapsedTime, DESCEND_WING_SPEED + speedAlpha * 2.2, motionSeed * 0.63)
    );
    return createWingVisualState({
      baseAngle,
      flutter: getWingFlutter(elapsedTime, DESCEND_WING_SPEED * 0.74, motionSeed + 1.2, 0.04 + motionAlpha * 0.08),
      motion: "descend",
      traceIntensity: lerp(DESCEND_TRACE_INTENSITY_MIN, DESCEND_TRACE_INTENSITY_MAX, motionAlpha),
      traceLength: lerp(DESCEND_TRACE_LENGTH_MIN, DESCEND_TRACE_LENGTH_MAX, motionAlpha),
      wingSpanScale: lerp(DESCEND_WING_SPAN_MIN, DESCEND_WING_SPAN_MAX, motionAlpha)
    });
  }

  return createWingVisualState({
    baseAngle: FOLDED_WING_ANGLE,
    flutter: 0,
    motion: "folded",
    traceIntensity: 0,
    traceLength: 0,
    wingSpanScale: 1
  });
};

export const getPlayerStatusVisualState = (
  invulnerableRemaining: number,
  elapsedTime: number
): PlayerStatusVisualState => {
  if (invulnerableRemaining <= 0) {
    return {
      ringOpacityMultiplier: 1
    };
  }

  return {
    ringOpacityMultiplier: lerp(
      PLAYER_STATUS_INVULNERABLE_OPACITY_MIN,
      PLAYER_STATUS_INVULNERABLE_OPACITY_MAX,
      normalizedSine(elapsedTime, PLAYER_STATUS_INVULNERABLE_PULSE_SPEED)
    )
  };
};

export const shouldTriggerChickenLandingTumble = ({
  wasGrounded,
  grounded,
  previousVelocityY
}: {
  wasGrounded: boolean;
  grounded: boolean;
  previousVelocityY: number;
}) => !wasGrounded && grounded && previousVelocityY <= -LANDING_TUMBLE_HARD_SPEED;

export const getChickenPoseVisualState = ({
  grounded,
  velocityY,
  planarSpeed = 0,
  elapsedTime = 0,
  motionSeed = 0,
  pushVisualRemaining,
  landingRollRemaining,
  spacePhase = "none",
  spacePhaseRemaining = 0,
  stunned = false,
  eggLaunchChargeAlpha = 0,
  eggLaunchReleaseRemaining = 0
}: ChickenPoseVisualInput): ChickenPoseVisualState => {
  const pushProgress = 1 - clamp(pushVisualRemaining / PUSH_VISUAL_DURATION, 0, 1);
  const pushAlpha = Math.sin(pushProgress * Math.PI);
  const eggChargeAlpha = grounded && !stunned ? clamp(eggLaunchChargeAlpha, 0, 1) : 0;
  const eggReleaseAlpha =
    grounded && !stunned
      ? clamp(eggLaunchReleaseRemaining / EGG_RELEASE_FOLLOW_THROUGH_DURATION, 0, 1)
      : 0;
  const eggReleasePulse = Math.sin((1 - eggReleaseAlpha) * Math.PI) * eggReleaseAlpha;
  const floatProgress = 1 - clamp(spacePhaseRemaining / SPACE_FLOAT_DURATION, 0, 1);
  const floatEnvelope = spacePhase === "float" ? 0.58 + Math.sin(floatProgress * Math.PI) * 0.42 : 0;
  const floatPhase = elapsedTime * 1.24 + motionSeed * 0.7;
  const diveAlpha =
    grounded || velocityY >= -DIVE_ENTRY_SPEED
      ? 0
      : clamp((-velocityY - DIVE_ENTRY_SPEED) / (DIVE_FULL_SPEED - DIVE_ENTRY_SPEED), 0, 1);
  const reentryAlpha = spacePhase === "reentry" ? 1 : 0;
  const landingProgress = 1 - clamp(landingRollRemaining / LANDING_TUMBLE_DURATION, 0, 1);
  const landingEnvelope = clamp(landingRollRemaining / LANDING_TUMBLE_DURATION, 0, 1);
  const landingPitch = Math.sin(landingProgress * Math.PI) * LANDING_TUMBLE_PITCH * landingEnvelope;
  const landingRoll = Math.sin(landingProgress * Math.PI * 2.4) * LANDING_TUMBLE_ROLL * landingEnvelope;
  const groundedStrideAlpha =
    grounded && !stunned ? clamp((planarSpeed - RUN_ENTRY_SPEED) / (RUN_FULL_SPEED - RUN_ENTRY_SPEED), 0, 1) : 0;
  const runSuppression = Math.max(pushAlpha, landingEnvelope, diveAlpha, floatEnvelope, reentryAlpha);
  const runAlpha = groundedStrideAlpha * clamp(1 - runSuppression * 1.4, 0, 1);
  const runPhase =
    elapsedTime * lerp(RUN_PHASE_SPEED_MIN, RUN_PHASE_SPEED_MAX, runAlpha) + motionSeed;
  const runBodyYaw = Math.sin(runPhase - Math.PI * 0.12) * RUN_BODY_YAW * runAlpha;
  const runBodyRoll = Math.sin(runPhase + Math.PI * 0.36) * RUN_BODY_ROLL * runAlpha;
  const runBodyPitch = Math.max(0, Math.sin(runPhase * 2.08 + 0.42)) * RUN_BODY_PITCH * runAlpha;
  const headBang = Math.max(0, Math.sin(runPhase * 2.12 + 0.42));
  const runHeadPitch = (0.06 + headBang * RUN_HEAD_PITCH) * runAlpha;
  const runHeadYaw = -Math.sin(runPhase - Math.PI * 0.08) * RUN_HEAD_YAW * runAlpha;
  const runHeadYOffset = headBang * RUN_HEAD_BOB * runAlpha;
  const runLegPitch = Math.sin(runPhase) * RUN_LEG_PITCH * runAlpha;
  const airborneFeatherSwing =
    !grounded && !stunned
      ? Math.sin(elapsedTime * 10.6 + motionSeed * 0.7) * AIR_FEATHER_SWING * clamp(Math.abs(velocityY) / 6, 0, 1)
      : 0;
  const landingFeatherSwing =
    Math.sin(landingProgress * Math.PI * 2.8 + motionSeed * 0.22) * LANDING_FEATHER_SWING * landingEnvelope;
  const runFeatherSwing = Math.sin(runPhase * 1.7 + motionSeed * 0.48) * RUN_FEATHER_SWING * runAlpha;
  const floatBodyPitch = Math.sin(floatPhase * 0.86 + 0.2) * SPACE_FLOAT_PITCH * floatEnvelope;
  const floatBodyRoll = Math.sin(floatPhase * 1.08 + 1.1) * SPACE_FLOAT_ROLL * floatEnvelope;
  const floatBodyYaw = Math.sin(floatPhase * 0.74 - 0.4) * SPACE_FLOAT_YAW * floatEnvelope;
  const floatHeadPitch = Math.sin(floatPhase * 0.92 + 0.8) * SPACE_FLOAT_HEAD_PITCH * floatEnvelope;
  const floatHeadYaw = Math.sin(floatPhase * 0.84 - 0.1) * SPACE_FLOAT_HEAD_YAW * floatEnvelope;
  const floatHeadYOffset = Math.sin(floatPhase * 1.34) * SPACE_FLOAT_HEAD_BOB * floatEnvelope;
  const floatLegPitch = SPACE_FLOAT_LEG_TUCK * floatEnvelope;
  const floatFeatherSwing = Math.sin(floatPhase * 1.2 + motionSeed * 0.3) * SPACE_FLOAT_FEATHER_SWING * floatEnvelope;
  const reentryPitch = reentryAlpha * SPACE_REENTRY_DIVE_BOOST;
  const reentryRoll = Math.sin(elapsedTime * 6.4 + motionSeed * 0.3) * SPACE_REENTRY_ROLL * reentryAlpha;
  const reentryHeadPitch = SPACE_REENTRY_HEAD_PITCH * reentryAlpha;
  const reentryLegPitch = SPACE_REENTRY_LEG_TUCK * reentryAlpha;

  return {
    bodyPitch: stabilizeZero(
      pushAlpha * PUSH_BODY_PITCH +
        eggChargeAlpha * EGG_CHARGE_BODY_PITCH +
        eggReleasePulse * EGG_RELEASE_BODY_PITCH +
        diveAlpha * DIVE_PITCH_MAX +
        reentryPitch +
        floatBodyPitch +
        landingPitch +
        runBodyPitch
    ),
    bodyRoll: stabilizeZero(
      pushAlpha * PUSH_BODY_ROLL -
        eggChargeAlpha * EGG_CHARGE_BODY_ROLL +
        eggReleasePulse * EGG_RELEASE_BODY_ROLL +
        floatBodyRoll +
        reentryRoll +
        landingRoll +
        runBodyRoll
    ),
    bodyYaw: stabilizeZero(runBodyYaw + floatBodyYaw - eggChargeAlpha * EGG_CHARGE_BODY_YAW),
    bodyForwardOffset: stabilizeZero(
      pushAlpha * PUSH_BODY_LUNGE +
        eggChargeAlpha * EGG_CHARGE_FORWARD_OFFSET +
        eggReleasePulse * EGG_RELEASE_FORWARD_OFFSET +
        Math.sin(landingProgress * Math.PI) * LANDING_TUMBLE_LUNGE * landingEnvelope
    ),
    wingAngleOffset: stabilizeZero(pushAlpha * PUSH_WING_BOOST + eggChargeAlpha * EGG_CHARGE_WING_OFFSET),
    headPitch: stabilizeZero(runHeadPitch + floatHeadPitch + reentryHeadPitch + eggChargeAlpha * EGG_CHARGE_HEAD_PITCH),
    headYaw: stabilizeZero(
      runHeadYaw + floatHeadYaw - eggChargeAlpha * EGG_CHARGE_HEAD_YAW + eggReleasePulse * EGG_RELEASE_HEAD_YAW
    ),
    headYOffset: stabilizeZero(runHeadYOffset + floatHeadYOffset),
    leftLegPitch: stabilizeZero(runLegPitch + floatLegPitch + reentryLegPitch),
    rightLegPitch: stabilizeZero(-runLegPitch - floatLegPitch - reentryLegPitch),
    featherSwing: stabilizeZero(runFeatherSwing + airborneFeatherSwing + landingFeatherSwing + floatFeatherSwing)
  };
};
