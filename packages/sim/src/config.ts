import type { SimulationConfig } from "./types";

export const lifeConfigDefaults = {
  startingLives: 3,
  maxLives: 3
} as const;

export const respawnConfigDefaults = {
  respawnDelay: 0.9,
  respawnInvulnerableDuration: 1,
  playerHitSeparationDistance: 0.18,
  playerHitSurfaceClearance: 0.05
} as const;

export const eggConfigDefaults = {
  eggCost: 42,
  eggFuseDuration: 1.6,
  eggGravity: 24,
  eggThrowSpeed: 8.25,
  eggChargeDuration: 0.48,
  eggChargedThrowSpeed: 17.25,
  eggThrowPitchLiftBias: (58 * Math.PI) / 180,
  eggThrowPitchLiftMin: (22 * Math.PI) / 180,
  eggDropOffsetForward: 0.52,
  eggDropOffsetUp: 0.72,
  eggRadius: 0.22,
  eggBounceDamping: 0.32,
  eggGroundFriction: 12,
  eggGroundSpeedThreshold: 0.25,
  maxActiveEggsPerPlayer: 2
} as const;

export const eggBlastConfigDefaults = {
  eggBlastVoxelRadius: 2.35,
  eggBlastHitRadius: 3.15,
  eggBlastDestroyDepth: 0.35,
  eggBlastKnockback: 6,
  eggBlastLift: 8,
  eggBlastStunDuration: 3.2
} as const;

export const eggImpactConfigDefaults = {
  eggScatterBudget: 12,
  eggScatterMaxDistance: 4,
  eggScatterArcHeight: 2.4,
  eggScatterFlightDuration: 0.65
} as const;

export const defaultSimulationConfig: SimulationConfig = {
  tickRate: 60,
  maxMass: 300,
  startingMass: 24,
  pushCost: 18,
  destroyGain: 18,
  placeCost: 28,
  interactRange: 4.5,
  gravity: 34,
  jumpSpeed: 11,
  jumpBufferDuration: 0.12,
  jetpackLiftSpeed: 11.5,
  jetpackHoldActivationDelay: 0.08,
  jetpackMassDrainPerSecond: 24,
  moveSpeed: 6.6,
  turnSpeed: 7.5,
  airControl: 0.45,
  groundAcceleration: 30.8,
  airAcceleration: 13.2,
  friction: 18,
  playerRadius: 0.33,
  playerHeight: 1.7,
  pushRange: 1.6,
  pushImpulse: 9,
  pushLift: 3.4,
  pushCooldown: 0.45,
  ...lifeConfigDefaults,
  ...respawnConfigDefaults,
  ...eggConfigDefaults,
  ...eggBlastConfigDefaults,
  ...eggImpactConfigDefaults,
  collapseWarningDuration: 0.45,
  collapseGravity: 34,
  skyDropIntervalMin: 1.8,
  skyDropIntervalMax: 3.2,
  skyDropWarningDuration: 0.9,
  skyDropGravity: 38,
  skyDropSpawnHeight: 18,
  skyDropSpawnRadius: 12,
  maxActiveSkyDrops: 2,
  maxNpcCount: 12
};
