const SMASHED_SCALE_X = 1.12;
const SMASHED_SCALE_Y = 0.34;
const SMASHED_SCALE_Z = 1.12;
const RECOVERY_WINDOW = 0.2;
const BLINK_INTERVAL = 0.12;
const FOLDED_WING_ANGLE = 0.22;
const JUMP_WING_MIN_ANGLE = 0.28;
const JUMP_WING_MAX_ANGLE = 0.6;
const JUMP_WING_SPEED = 10;
const JETPACK_WING_MIN_ANGLE = 0.16;
const JETPACK_WING_MAX_ANGLE = 0.88;
const JETPACK_WING_SPEED = 24;
const PLAYER_STATUS_INVULNERABLE_PULSE_SPEED = 18;
const PLAYER_STATUS_INVULNERABLE_OPACITY_MIN = 0.68;
const PLAYER_STATUS_INVULNERABLE_OPACITY_MAX = 1.18;

export const chickenFeatherOffsets = [
  { x: -0.22, y: 0.98, z: -0.08, rotationZ: 0.42 },
  { x: 0, y: 1.04, z: -0.02, rotationZ: 0 },
  { x: 0.22, y: 0.98, z: -0.08, rotationZ: -0.42 }
] as const;

export const chickenFeatherGeometry = {
  plumePositionY: 0.14,
  plumeSize: [0.12, 0.42, 0.12] as const,
  quillPositionY: -0.04,
  quillSize: [0.16, 0.12, 0.16] as const
} as const;

const lerp = (start: number, end: number, alpha: number) => start + (end - start) * alpha;
const normalizedSine = (elapsedTime: number, speed: number) => (Math.sin(elapsedTime * speed) + 1) * 0.5;

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
  jetpackActive: boolean;
  stunned: boolean;
  elapsedTime: number;
}

export interface ChickenWingVisualState {
  wingAngle: number;
  motion: "folded" | "jump" | "jetpack";
}

export interface PlayerStatusVisualState {
  ringOpacityMultiplier: number;
}

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
  jetpackActive,
  stunned,
  elapsedTime
}: ChickenWingVisualInput): ChickenWingVisualState => {
  if (!alive || stunned) {
    return {
      wingAngle: FOLDED_WING_ANGLE,
      motion: "folded"
    };
  }

  if (jetpackActive) {
    return {
      wingAngle: lerp(
        JETPACK_WING_MIN_ANGLE,
        JETPACK_WING_MAX_ANGLE,
        normalizedSine(elapsedTime, JETPACK_WING_SPEED)
      ),
      motion: "jetpack"
    };
  }

  if (!grounded && velocityY > 0.5) {
    return {
      wingAngle: lerp(
        JUMP_WING_MIN_ANGLE,
        JUMP_WING_MAX_ANGLE,
        normalizedSine(elapsedTime, JUMP_WING_SPEED)
      ),
      motion: "jump"
    };
  }

  return {
    wingAngle: FOLDED_WING_ANGLE,
    motion: "folded"
  };
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
