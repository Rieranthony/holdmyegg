import type { BlockKind, MapDocumentV1, Vec3i } from "@out-of-bounds/map";

export type GameMode = "explore" | "skirmish" | "multiplayer";
export type PlayerKind = "human" | "npc";

export interface Vector2 {
  x: number;
  z: number;
}

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface PlayerCommand {
  moveX: number;
  moveZ: number;
  lookX: number;
  lookZ: number;
  jump: boolean;
  jumpPressed: boolean;
  jumpReleased: boolean;
  destroy: boolean;
  place: boolean;
  push: boolean;
  layEgg: boolean;
  targetVoxel: Vec3i | null;
  targetNormal: Vec3i | null;
}

export interface SimulationConfig {
  tickRate: number;
  maxMass: number;
  startingMass: number;
  pushCost: number;
  destroyGain: number;
  placeCost: number;
  interactRange: number;
  gravity: number;
  jumpSpeed: number;
  jetpackLiftSpeed: number;
  jetpackMassDrainPerSecond: number;
  moveSpeed: number;
  turnSpeed: number;
  airControl: number;
  groundAcceleration: number;
  airAcceleration: number;
  friction: number;
  playerRadius: number;
  playerHeight: number;
  pushRange: number;
  pushImpulse: number;
  pushLift: number;
  pushCooldown: number;
  startingLives: number;
  maxLives: number;
  respawnDelay: number;
  respawnInvulnerableDuration: number;
  playerHitSeparationDistance: number;
  playerHitSurfaceClearance: number;
  eggCost: number;
  eggFuseDuration: number;
  eggGravity: number;
  eggThrowSpeed: number;
  eggDropOffsetForward: number;
  eggDropOffsetUp: number;
  eggRadius: number;
  eggBounceDamping: number;
  eggGroundFriction: number;
  eggGroundSpeedThreshold: number;
  maxActiveEggsPerPlayer: number;
  eggBlastVoxelRadius: number;
  eggBlastHitRadius: number;
  eggBlastDestroyDepth: number;
  eggBlastKnockback: number;
  eggBlastLift: number;
  eggBlastStunDuration: number;
  eggScatterBudget: number;
  eggScatterMaxDistance: number;
  eggScatterArcHeight: number;
  eggScatterFlightDuration: number;
  collapseWarningDuration: number;
  collapseGravity: number;
  skyDropIntervalMin: number;
  skyDropIntervalMax: number;
  skyDropWarningDuration: number;
  skyDropGravity: number;
  skyDropSpawnHeight: number;
  skyDropSpawnRadius: number;
  maxActiveSkyDrops: number;
  maxNpcCount: number;
}

export type FallingClusterPhase = "warning" | "falling";
export type SkyDropPhase = "warning" | "falling";
export type SpacePhase = "none" | "float" | "reentry";

export interface FallingClusterVoxelView {
  x: number;
  y: number;
  z: number;
  kind: BlockKind;
}

export interface FallingClusterViewState {
  id: string;
  phase: FallingClusterPhase;
  warningRemaining: number;
  offsetY: number;
  center: Vector3;
  voxels: FallingClusterVoxelView[];
}

export interface EggViewState {
  id: string;
  ownerId: string;
  fuseRemaining: number;
  position: Vector3;
  velocity: Vector3;
}

export interface EggScatterDebrisViewState {
  id: string;
  kind: BlockKind;
  origin: Vector3;
  destination: Vector3;
  elapsed: number;
  duration: number;
}

export type VoxelBurstStyle = "eggExplosion" | "harvest";

export interface VoxelBurstViewState {
  id: string;
  style: VoxelBurstStyle;
  kind: BlockKind | null;
  position: Vector3;
  elapsed: number;
  duration: number;
}

export interface SkyDropViewState {
  id: string;
  phase: SkyDropPhase;
  warningRemaining: number;
  landingVoxel: Vec3i;
  offsetY: number;
}

export interface PlayerViewState {
  id: string;
  name: string;
  kind: PlayerKind;
  alive: boolean;
  visible: boolean;
  grounded: boolean;
  jetpackActive: boolean;
  mass: number;
  maxMass: number;
  livesRemaining: number;
  maxLives: number;
  respawning: boolean;
  invulnerableRemaining: number;
  stunRemaining: number;
  position: Vector3;
  velocity: Vector3;
  facing: Vector2;
  eliminatedAt: number | null;
}

export interface RuntimePlayerState {
  id: string;
  name: string;
  kind: PlayerKind;
  alive: boolean;
  fallingOut: boolean;
  grounded: boolean;
  mass: number;
  livesRemaining: number;
  maxLives: number;
  respawning: boolean;
  invulnerableRemaining: number;
  stunRemaining: number;
  pushVisualRemaining: number;
  spacePhase: SpacePhase;
  spacePhaseRemaining: number;
  position: Vector3;
  velocity: Vector3;
  facing: Vector2;
  jetpackActive: boolean;
  eliminatedAt: number | null;
}

export interface RuntimeFallingClusterState {
  id: string;
  phase: FallingClusterPhase;
  warningRemaining: number;
  offsetY: number;
  voxels: FallingClusterVoxelView[];
}

export type RuntimeEggState = EggViewState;
export type RuntimeEggScatterDebrisState = EggScatterDebrisViewState;
export type RuntimeVoxelBurstState = VoxelBurstViewState;
export type RuntimeSkyDropState = SkyDropViewState;

export interface MatchPlayerState {
  id: string;
  name: string;
  kind: PlayerKind;
  alive: boolean;
  livesRemaining: number;
  respawning: boolean;
  eliminatedAt: number | null;
}

export interface MatchState {
  tick: number;
  time: number;
  mode: GameMode;
  terrainRevision: number;
  localPlayerId: string | null;
  playerIds: string[];
  players: MatchPlayerState[];
  ranking: string[];
}

export interface HudRankingEntry {
  id: string;
  name: string;
  alive: boolean;
}

export interface HudPlayerState {
  id: string;
  name: string;
  alive: boolean;
  grounded: boolean;
  mass: number;
  maxMass: number;
  livesRemaining: number;
  maxLives: number;
  respawning: boolean;
  invulnerableRemaining: number;
  stunRemaining: number;
}

export interface HudState {
  mode: GameMode;
  localPlayerId: string | null;
  localPlayer: HudPlayerState | null;
  ranking: HudRankingEntry[];
}

export interface SimulationPerformanceDiagnostics {
  skyDropUpdateMs: number;
  skyDropLandingMs: number;
  detachedComponentMs: number;
  fallingClusterLandingMs: number;
  fixedStepMaxStepsPerFrame: number;
  fixedStepClampedFrames: number;
  fixedStepDroppedMs: number;
}

export interface SimulationSnapshot {
  tick: number;
  time: number;
  mode: GameMode;
  map: MapDocumentV1;
  terrainRevision: number;
  localPlayerId: string | null;
  players: PlayerViewState[];
  fallingClusters: FallingClusterViewState[];
  eggs: EggViewState[];
  eggScatterDebris: EggScatterDebrisViewState[];
  voxelBursts: VoxelBurstViewState[];
  skyDrops: SkyDropViewState[];
  ranking: string[];
}

export type SimulationInitialSpawnStyle = "ground" | "sky";

export interface SimulationResetOptions {
  npcCount?: number;
  localPlayerName?: string;
  initialSpawnStyle?: SimulationInitialSpawnStyle;
}
