import type { SimulationConfig, Vector2, Vector3 } from "./types";

const GROUNDED_EGG_LAUNCH_PITCH_SCALE = 0.68;
const GROUNDED_EGG_LAUNCH_PITCH_MAX = (78 * Math.PI) / 180;
const GROUNDED_EGG_CHARGE_LIFT_BOOST = (8 * Math.PI) / 180;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const lerp = (start: number, end: number, alpha: number) => start + (end - start) * alpha;

export const getEggChargeAlpha = (elapsed: number, chargeDuration: number) =>
  clamp(chargeDuration <= 0 ? 1 : elapsed / chargeDuration, 0, 1);

export const getGroundedEggThrowSpeed = (
  config: Pick<SimulationConfig, "eggThrowSpeed" | "eggChargedThrowSpeed">,
  eggCharge: number
) => lerp(config.eggThrowSpeed, config.eggChargedThrowSpeed, clamp(eggCharge, 0, 1));

export const getGroundedEggLaunchPitch = (
  cameraPitch: number,
  eggCharge: number,
  config: Pick<SimulationConfig, "eggThrowPitchLiftBias" | "eggThrowPitchLiftMin">
) =>
  clamp(
    config.eggThrowPitchLiftBias +
      cameraPitch * GROUNDED_EGG_LAUNCH_PITCH_SCALE +
      clamp(eggCharge, 0, 1) * GROUNDED_EGG_CHARGE_LIFT_BOOST,
    config.eggThrowPitchLiftMin,
    GROUNDED_EGG_LAUNCH_PITCH_MAX
  );

export const getGroundedEggLaunchVelocity = ({
  playerVelocity,
  facing,
  eggCharge,
  cameraPitch,
  config
}: {
  playerVelocity: Vector3;
  facing: Vector2;
  eggCharge: number;
  cameraPitch: number;
  config: Pick<
    SimulationConfig,
    "eggThrowSpeed" | "eggChargedThrowSpeed" | "eggThrowPitchLiftBias" | "eggThrowPitchLiftMin"
  >;
}): Vector3 => {
  const speed = getGroundedEggThrowSpeed(config, eggCharge);
  const launchPitch = getGroundedEggLaunchPitch(cameraPitch, eggCharge, config);
  const planarSpeed = Math.cos(launchPitch) * speed;
  return {
    x: playerVelocity.x + facing.x * planarSpeed,
    y: Math.max(playerVelocity.y * 0.35, 0) + Math.sin(launchPitch) * speed,
    z: playerVelocity.z + facing.z * planarSpeed
  };
};

export const getEggTrajectoryPosition = ({
  origin,
  velocity,
  gravity,
  elapsed
}: {
  origin: Vector3;
  velocity: Vector3;
  gravity: number;
  elapsed: number;
}): Vector3 => ({
  x: origin.x + velocity.x * elapsed,
  y: origin.y + velocity.y * elapsed - 0.5 * gravity * elapsed * elapsed,
  z: origin.z + velocity.z * elapsed
});
