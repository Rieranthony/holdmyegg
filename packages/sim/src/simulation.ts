import { MutableVoxelWorld, createDefaultArenaMap, isInBounds } from "@out-of-bounds/map";
import type { BlockKind, DetachedVoxelComponent, MapDocumentV1, Vec3i, VoxelCell } from "@out-of-bounds/map";
import type {
  EggScatterDebrisViewState,
  EggViewState,
  FallingClusterPhase,
  FallingClusterViewState,
  GameMode,
  HudPlayerState,
  HudRankingEntry,
  HudState,
  MatchPlayerState,
  MatchState,
  PlayerCommand,
  PlayerKind,
  PlayerViewState,
  RuntimeEggScatterDebrisState,
  RuntimeEggState,
  RuntimeFallingClusterState,
  RuntimeInteractionFocusState,
  RuntimeInteractionInvalidReason,
  RuntimePlayerState,
  RuntimeSkyDropState,
  RuntimeVoxelBurstState,
  SkyDropPhase,
  SkyDropViewState,
  SpacePhase,
  SimulationPerformanceDiagnostics,
  SimulationConfig,
  SimulationInitialSpawnStyle,
  SimulationResetOptions,
  SimulationSnapshot,
  Vector2,
  Vector3,
  VoxelBurstStyle,
  VoxelBurstViewState
} from "./types";
import { defaultSimulationConfig } from "./config";
import { getHudEggStatus } from "./eggAvailability";
import { getGroundedEggLaunchVelocity } from "./eggLaunch";

const EPSILON = 0.0001;
const RING_OUT_FALL_CULL_DEPTH = 12;
const PUSH_VISUAL_DURATION = 0.24;
const JUMP_LEDGE_ASSIST_DURATION = 0.22;
const JUMP_LEDGE_ASSIST_MAX_HEIGHT = 1.1;
const JUMP_LEDGE_ASSIST_CLEARANCE = 0.05;
const HARVEST_VOXEL_BURST_DURATION = 0.24;
const EGG_EXPLOSION_VOXEL_BURST_DURATION = 0.42;
const INITIAL_SKY_ENTRY_SPEED = -2.4;
const SPACE_FLOAT_DURATION = 5.0;
const SPACE_FLOAT_GRAVITY_MULTIPLIER = 0.08;
const SPACE_REENTRY_GRAVITY_MULTIPLIER = 1.9;
const SPACE_FLOAT_DRIFT_SPEED = 1.4;
const SPACE_FLOAT_MOVE_SPEED_MULTIPLIER = 0.38;
const SPACE_FLOAT_ACCELERATION_MULTIPLIER = 0.55;
const ORBITAL_EGG_DROP_OFFSET_Y = 0.22;
const ORBITAL_EGG_DOWNWARD_SPEED = 15;
const ORBITAL_EGG_HORIZONTAL_INHERIT_FACTOR = 0.35;
const ORBITAL_EGG_HORIZONTAL_THROW_FACTOR = 0.18;
const ORBITAL_EGG_FUSE_DURATION = 4.8;
const ORBITAL_EGG_FUSE_ARM_MARGIN_Y = 1.5;
const ORBITAL_EGG_HIT_RADIUS_MULTIPLIER = 1.25;
const ORBITAL_EGG_KNOCKBACK_MULTIPLIER = 1.25;
const ORBITAL_EGG_LIFT_MULTIPLIER = 1.2;
const ORBITAL_EGG_STUN_MULTIPLIER = 1.25;
const MIN_GROUNDED_EGG_CHARGE = 0.18;
const EGG_GROUND_SETTLE_BOUNCE_SPEED_MULTIPLIER = 5;
const EGG_GROUND_IMPACT_CARRY = 0.94;
const EGG_GROUND_FRICTION_MULTIPLIER = 1.45;
const EGG_WALL_BOUNCE_DAMPING = 0.72;
const EGG_CEILING_BOUNCE_DAMPING = 0.82;
const EGG_TAUNT_DURATION = 1.6;
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

interface SimPlayer {
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
  respawnRemaining: number;
  invulnerableRemaining: number;
  stunRemaining: number;
  position: Vector3;
  velocity: Vector3;
  facing: Vector2;
  eggTauntSequence: number;
  eggTauntRemaining: number;
  jumpBufferRemaining: number;
  jumpAssistRemaining: number;
  jetpackHoldActivationRemaining: number;
  jetpackEligible: boolean;
  jetpackActive: boolean;
  jetpackOutsideBoundsGrace: boolean;
  pushCooldownRemaining: number;
  pushVisualRemaining: number;
  spacePhase: SpacePhase;
  spacePhaseRemaining: number;
  spaceTriggerArmed: boolean;
  eliminatedAt: number | null;
}

interface SimFallingCluster {
  id: string;
  phase: FallingClusterPhase;
  warningRemaining: number;
  voxels: VoxelCell[];
  offsetY: number;
  velocityY: number;
  damagedPlayerIds: Set<string>;
  cachedLandingDropDistance: number | null;
  cachedLandingOffsetY: number | null;
  footprintMinX: number;
  footprintMaxX: number;
  footprintMinZ: number;
  footprintMaxZ: number;
}

interface SimEgg {
  id: string;
  ownerId: string;
  fuseRemaining: number;
  grounded: boolean;
  orbital: boolean;
  explodeOnGroundContact: boolean;
  fuseArmedBelowY: number | null;
  position: Vector3;
  velocity: Vector3;
}

interface SimEggScatterDebris {
  id: string;
  kind: BlockKind;
  origin: Vector3;
  destination: Vector3;
  elapsed: number;
  duration: number;
}

interface SimVoxelBurst {
  id: string;
  style: VoxelBurstStyle;
  kind: BlockKind | null;
  position: Vector3;
  elapsed: number;
  duration: number;
}

interface SimSkyDrop {
  id: string;
  phase: SkyDropPhase;
  warningRemaining: number;
  landingVoxel: Vec3i;
  offsetY: number;
  velocityY: number;
  damagedPlayerIds: Set<string>;
}

type NpcArchetype = "hunter" | "opportunist" | "forager";
type NpcIntent = "pressure" | "harvest" | "build" | "recover" | "egg";

interface NpcMemory {
  archetype: NpcArchetype;
  intent: NpcIntent;
  intentRemaining: number;
  targetPlayerId: string | null;
  targetLockRemaining: number;
  jumpHoldRemaining: number;
}

interface NpcTargetPlan {
  target: SimPlayer | null;
  score: number;
  edgeDirection: Vector2;
  edgeDistance: number;
}

interface NpcPathProbe {
  move: Vector2;
  cardinal: Vec3i;
  frontCellX: number;
  frontCellZ: number;
  supportY: number;
  frontTopSolidY: number;
  heightDelta: number;
  gapDepth: number;
  obstacleAhead: boolean;
  blockedAhead: boolean;
  shortGapAhead: boolean;
  tallStepAhead: boolean;
}

interface HorizontalAxisCollision {
  next: number;
  blockerTopY: number;
}

interface NpcPlacementPlan {
  targetVoxel: Vec3i;
  targetNormal: Vec3i;
}

interface NpcHarvestCandidate {
  voxel: Vec3i;
  kind: BlockKind;
  distance: number;
  horizontalDistance: number;
  forwardDot: number;
  topGroundY: number;
  topSolidY: number;
  aboveGround: boolean;
  exposed: boolean;
  isSelfSupport: boolean;
}

interface NpcBuriedProbe {
  buried: boolean;
  exitTarget: Vector3 | null;
  moveDirection: Vector2;
  exitCardinal: Vec3i;
  headBlockedVoxel: Vec3i | null;
  sideBlockedVoxel: Vec3i | null;
  floorBlockedVoxel: Vec3i | null;
  headroomOpen: boolean;
}

type SpawnQuadrant = "nw" | "ne" | "sw" | "se";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const lerp = (start: number, end: number, alpha: number) => start + (end - start) * alpha;
const length2 = (x: number, z: number) => Math.hypot(x, z);
const distanceSquared3 = (left: Vector3, right: Vector3) => {
  const deltaX = left.x - right.x;
  const deltaY = left.y - right.y;
  const deltaZ = left.z - right.z;
  return deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ;
};

const normalize2 = (x: number, z: number): Vector2 => {
  const length = length2(x, z);
  if (length <= EPSILON) {
    return { x: 0, z: 0 };
  }

  return { x: x / length, z: z / length };
};

const approach = (current: number, target: number, maxDelta: number) => {
  if (current < target) {
    return Math.min(current + maxDelta, target);
  }

  return Math.max(current - maxDelta, target);
};

const hashString = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
};

const horizontalDistance = (left: SimPlayer, right: SimPlayer) =>
  Math.hypot(left.position.x - right.position.x, left.position.z - right.position.z);

const cloneCommand = (command?: PlayerCommand): PlayerCommand => ({
  moveX: command?.moveX ?? 0,
  moveZ: command?.moveZ ?? 0,
  lookX: command?.lookX ?? 0,
  lookZ: command?.lookZ ?? 0,
  eggCharge: command?.eggCharge ?? 0,
  eggPitch: command?.eggPitch ?? 0,
  jump: command?.jump ?? false,
  jumpPressed: command?.jumpPressed ?? false,
  jumpReleased: command?.jumpReleased ?? false,
  destroy: command?.destroy ?? false,
  place: command?.place ?? false,
  push: command?.push ?? false,
  layEgg: command?.layEgg ?? false,
  targetVoxel: command?.targetVoxel ? { ...command.targetVoxel } : null,
  targetNormal: command?.targetNormal ? { ...command.targetNormal } : null
});

export class OutOfBoundsSimulation {
  readonly config: SimulationConfig;

  private world = new MutableVoxelWorld(createDefaultArenaMap());
  private mode: GameMode = "explore";
  private tick = 0;
  private time = 0;
  private localPlayerId: string | null = null;
  private readonly players = new Map<string, SimPlayer>();
  private readonly fallingClusters = new Map<string, SimFallingCluster>();
  private readonly eggs = new Map<string, SimEgg>();
  private readonly eggScatterDebris = new Map<string, SimEggScatterDebris>();
  private readonly voxelBursts = new Map<string, SimVoxelBurst>();
  private readonly skyDrops = new Map<string, SimSkyDrop>();
  private readonly npcMemories = new Map<string, NpcMemory>();
  private playerCollectionVersion = 0;
  private fallingClusterCollectionVersion = 0;
  private eggCollectionVersion = 0;
  private eggScatterDebrisCollectionVersion = 0;
  private skyDropCollectionVersion = 0;
  private playerIdsDirty = true;
  private fallingClusterIdsDirty = true;
  private eggIdsDirty = true;
  private eggScatterDebrisIdsDirty = true;
  private skyDropIdsDirty = true;
  private playerIdsCache: string[] = [];
  private fallingClusterIdsCache: string[] = [];
  private eggIdsCache: string[] = [];
  private eggScatterDebrisIdsCache: string[] = [];
  private skyDropIdsCache: string[] = [];
  private dirtyChunkKeys = new Set<string>();
  private nextFallingClusterId = 1;
  private nextEggId = 1;
  private nextEggScatterDebrisId = 1;
  private nextVoxelBurstId = 1;
  private nextSkyDropId = 1;
  private skyDropCooldown = 0;
  private rngState = 1;
  private spawnCandidates: Vector3[] = [];
  private initialSpawnCandidates: Vector3[] = [];
  private readonly performanceDiagnostics: SimulationPerformanceDiagnostics = {
    skyDropUpdateMs: 0,
    skyDropLandingMs: 0,
    detachedComponentMs: 0,
    fallingClusterLandingMs: 0,
    fixedStepMaxStepsPerFrame: 0,
    fixedStepClampedFrames: 0,
    fixedStepDroppedMs: 0
  };

  constructor(config: Partial<SimulationConfig> = {}) {
    this.config = {
      ...defaultSimulationConfig,
      ...config
    };
  }

  reset(mode: GameMode, mapDocument: MapDocumentV1, options: SimulationResetOptions = {}) {
    this.mode = mode;
    this.tick = 0;
    this.time = 0;
    this.localPlayerId = null;
    this.players.clear();
    this.fallingClusters.clear();
    this.eggs.clear();
    this.eggScatterDebris.clear();
    this.voxelBursts.clear();
    this.skyDrops.clear();
    this.npcMemories.clear();
    this.dirtyChunkKeys.clear();
    this.nextFallingClusterId = 1;
    this.nextEggId = 1;
    this.nextEggScatterDebrisId = 1;
    this.nextVoxelBurstId = 1;
    this.nextSkyDropId = 1;
    this.rngState = hashString(`${mode}:${mapDocument.meta.name}:${mapDocument.meta.createdAt}:${mapDocument.meta.updatedAt}`) || 1;
    this.skyDropCooldown = this.nextSkyDropInterval();
    this.performanceDiagnostics.skyDropUpdateMs = 0;
    this.performanceDiagnostics.skyDropLandingMs = 0;
    this.performanceDiagnostics.detachedComponentMs = 0;
    this.performanceDiagnostics.fallingClusterLandingMs = 0;
    this.performanceDiagnostics.fixedStepMaxStepsPerFrame = 0;
    this.performanceDiagnostics.fixedStepClampedFrames = 0;
    this.performanceDiagnostics.fixedStepDroppedMs = 0;
    this.world = new MutableVoxelWorld(mapDocument);
    this.invalidatePlayerCollection();
    this.invalidateFallingClusterCollection();
    this.invalidateEggCollection();
    this.invalidateEggScatterDebrisCollection();
    this.invalidateSkyDropCollection();

    const initialSpawnStyle = options.initialSpawnStyle ?? "ground";
    const npcCount = mode === "playNpc" ? clamp(options.npcCount ?? 9, 1, this.config.maxNpcCount) : 0;
    this.spawnCandidates = this.buildSpawnCandidates(npcCount + 1);
    this.initialSpawnCandidates =
      mode === "playNpc"
        ? this.buildPlayNpcInitialSpawnCandidates(npcCount + 1, options.initialSpawnSeed)
        : this.spawnCandidates.map((spawn) => ({ ...spawn }));
    const local = this.spawnPlayer("human", options.localPlayerName ?? "You", 0, initialSpawnStyle);
    this.localPlayerId = local.id;

    if (mode === "playNpc") {
      for (let index = 0; index < npcCount; index += 1) {
        this.spawnPlayer("npc", `NPC ${index + 1}`, index + 1, initialSpawnStyle);
      }
    }

    this.resolvePlayerCollisions(4);
  }

  getWorld() {
    return this.world;
  }

  getLocalPlayerId() {
    return this.localPlayerId;
  }

  getPlayerIds() {
    if (this.playerIdsDirty) {
      this.playerIdsCache = [...this.players.keys()].sort();
      this.playerIdsDirty = false;
    }

    return this.playerIdsCache;
  }

  getPlayerCollectionVersion() {
    return this.playerCollectionVersion;
  }

  getPlayerRuntimeState(playerId: string): RuntimePlayerState | null {
    const player = this.players.get(playerId);
    return player ? (player as RuntimePlayerState) : null;
  }

  getPlayerState(playerId: string) {
    const player = this.players.get(playerId);
    return player ? this.toViewState(player) : null;
  }

  getPlayerViewState(playerId: string) {
    return this.getPlayerState(playerId);
  }

  getFallingClusters(): FallingClusterViewState[] {
    return [...this.fallingClusters.values()]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((cluster) => this.toFallingClusterViewState(cluster));
  }

  getFallingClusterIds() {
    if (this.fallingClusterIdsDirty) {
      this.fallingClusterIdsCache = [...this.fallingClusters.keys()].sort();
      this.fallingClusterIdsDirty = false;
    }

    return this.fallingClusterIdsCache;
  }

  getFallingClusterCollectionVersion() {
    return this.fallingClusterCollectionVersion;
  }

  getFallingClusterRuntimeState(clusterId: string): RuntimeFallingClusterState | null {
    const cluster = this.fallingClusters.get(clusterId);
    return cluster ? (cluster as RuntimeFallingClusterState) : null;
  }

  getFallingClusterState(clusterId: string) {
    const cluster = this.fallingClusters.get(clusterId);
    return cluster ? this.toFallingClusterViewState(cluster) : null;
  }

  getEggs(): EggViewState[] {
    return [...this.eggs.values()]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((egg) => this.toEggViewState(egg));
  }

  getEggIds() {
    if (this.eggIdsDirty) {
      this.eggIdsCache = [...this.eggs.keys()].sort();
      this.eggIdsDirty = false;
    }

    return this.eggIdsCache;
  }

  getEggCollectionVersion() {
    return this.eggCollectionVersion;
  }

  getEggRuntimeState(eggId: string): RuntimeEggState | null {
    const egg = this.eggs.get(eggId);
    return egg ? (egg as RuntimeEggState) : null;
  }

  getEggState(eggId: string) {
    const egg = this.eggs.get(eggId);
    return egg ? this.toEggViewState(egg) : null;
  }

  getEggScatterDebris(): EggScatterDebrisViewState[] {
    return [...this.eggScatterDebris.values()]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((debris) => this.toEggScatterDebrisViewState(debris));
  }

  getEggScatterDebrisIds() {
    if (this.eggScatterDebrisIdsDirty) {
      this.eggScatterDebrisIdsCache = [...this.eggScatterDebris.keys()].sort();
      this.eggScatterDebrisIdsDirty = false;
    }

    return this.eggScatterDebrisIdsCache;
  }

  getEggScatterDebrisCollectionVersion() {
    return this.eggScatterDebrisCollectionVersion;
  }

  getEggScatterDebrisRuntimeState(debrisId: string): RuntimeEggScatterDebrisState | null {
    const debris = this.eggScatterDebris.get(debrisId);
    return debris ? (debris as RuntimeEggScatterDebrisState) : null;
  }

  getEggScatterDebrisState(debrisId: string) {
    const debris = this.eggScatterDebris.get(debrisId);
    return debris ? this.toEggScatterDebrisViewState(debris) : null;
  }

  getVoxelBursts(): VoxelBurstViewState[] {
    return [...this.voxelBursts.values()]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((burst) => this.toVoxelBurstViewState(burst));
  }

  getVoxelBurstRuntimeState(burstId: string): RuntimeVoxelBurstState | null {
    const burst = this.voxelBursts.get(burstId);
    return burst ? (burst as RuntimeVoxelBurstState) : null;
  }

  getSkyDrops(): SkyDropViewState[] {
    return [...this.skyDrops.values()]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((skyDrop) => this.toSkyDropViewState(skyDrop));
  }

  getSkyDropIds() {
    if (this.skyDropIdsDirty) {
      this.skyDropIdsCache = [...this.skyDrops.keys()].sort();
      this.skyDropIdsDirty = false;
    }

    return this.skyDropIdsCache;
  }

  getSkyDropCollectionVersion() {
    return this.skyDropCollectionVersion;
  }

  getSkyDropRuntimeState(skyDropId: string): RuntimeSkyDropState | null {
    const skyDrop = this.skyDrops.get(skyDropId);
    return skyDrop ? (skyDrop as RuntimeSkyDropState) : null;
  }

  getSkyDropState(skyDropId: string) {
    const skyDrop = this.skyDrops.get(skyDropId);
    return skyDrop ? this.toSkyDropViewState(skyDrop) : null;
  }

  getMatchState(): MatchState {
    const players = [...this.players.values()].map((player) => this.toMatchPlayerState(player));
    players.sort((left, right) => left.id.localeCompare(right.id));

    return {
      tick: this.tick,
      time: this.time,
      mode: this.mode,
      terrainRevision: this.world.getTerrainRevision(),
      localPlayerId: this.localPlayerId,
      playerIds: players.map((player) => player.id),
      players,
      ranking: this.getRanking()
    };
  }

  getRuntimeInteractionFocusState(
    targetVoxel: Vec3i | null,
    targetNormal: Vec3i | null,
    playerId: string | null = this.localPlayerId
  ): RuntimeInteractionFocusState | null {
    if (!playerId || !targetVoxel || !targetNormal) {
      return null;
    }

    const player = this.players.get(playerId);
    if (!player || !player.alive || player.fallingOut || player.respawning) {
      return null;
    }

    const kind = this.world.getVoxelKind(targetVoxel.x, targetVoxel.y, targetVoxel.z);
    if (!kind) {
      return null;
    }

    const placeVoxel = {
      x: targetVoxel.x + targetNormal.x,
      y: targetVoxel.y + targetNormal.y,
      z: targetVoxel.z + targetNormal.z
    };
    const inRange = this.isTargetInInteractRange(player, targetVoxel);
    const destroyValid = inRange && this.isHarvestable(kind);

    let placeValid = false;
    let invalidReason: RuntimeInteractionInvalidReason | null = null;

    if (!inRange) {
      invalidReason = "outOfRange";
    } else if (!isInBounds(this.world.size, placeVoxel.x, placeVoxel.y, placeVoxel.z)) {
      invalidReason = "outOfBounds";
    } else if (this.world.hasSolid(placeVoxel.x, placeVoxel.y, placeVoxel.z)) {
      invalidReason = "occupied";
    } else if (this.isVoxelBlockedByAnyPlayer(placeVoxel)) {
      invalidReason = "blockedByPlayer";
    } else if (
      this.isVoxelBlockedByFallingCluster(placeVoxel) ||
      this.isVoxelBlockedBySkyDrop(placeVoxel) ||
      this.isVoxelBlockedByEgg(placeVoxel) ||
      this.isVoxelBlockedByEggScatterDebris(placeVoxel)
    ) {
      invalidReason = "blockedByDebris";
    } else {
      placeValid = true;
    }

    if (!destroyValid && kind === "hazard" && !placeValid) {
      invalidReason = "hazard";
    }

    return {
      focusedVoxel: targetVoxel,
      targetNormal,
      placeVoxel,
      destroyValid,
      placeValid,
      invalidReason: destroyValid || placeValid ? invalidReason : invalidReason ?? "hazard"
    };
  }

  getHudState(): HudState {
    const localPlayer = this.localPlayerId ? this.players.get(this.localPlayerId) ?? null : null;

    return {
      mode: this.mode,
      localPlayerId: this.localPlayerId,
      localPlayer: localPlayer ? this.toHudPlayerState(localPlayer) : null,
      eggStatus: localPlayer
        ? getHudEggStatus({
            localPlayerId: localPlayer.id,
            localPlayerMass: localPlayer.mass,
            localPlayer: this.getPlayerRuntimeState(localPlayer.id),
            eggs: this.getEggs(),
            eggCost: this.config.eggCost,
            maxActiveEggsPerPlayer: this.config.maxActiveEggsPerPlayer,
            eggFuseDuration: this.config.eggFuseDuration
          })
        : null,
      ranking: this.getRanking()
        .map((playerId) => {
          const player = this.players.get(playerId);
          return player ? this.toHudRankingEntry(player) : null;
        })
        .filter((entry): entry is HudRankingEntry => entry !== null)
    };
  }

  consumeDirtyChunkKeys() {
    const keys = [...this.dirtyChunkKeys];
    this.dirtyChunkKeys.clear();
    return keys;
  }

  consumePerformanceDiagnostics(): SimulationPerformanceDiagnostics {
    const diagnostics = { ...this.performanceDiagnostics };
    this.performanceDiagnostics.skyDropUpdateMs = 0;
    this.performanceDiagnostics.skyDropLandingMs = 0;
    this.performanceDiagnostics.detachedComponentMs = 0;
    this.performanceDiagnostics.fallingClusterLandingMs = 0;
    this.performanceDiagnostics.fixedStepMaxStepsPerFrame = 0;
    this.performanceDiagnostics.fixedStepClampedFrames = 0;
    this.performanceDiagnostics.fixedStepDroppedMs = 0;
    return diagnostics;
  }

  getSnapshot(): SimulationSnapshot {
    const match = this.getMatchState();
    const players = [...this.players.values()].map((player) => this.toViewState(player));
    players.sort((left, right) => left.id.localeCompare(right.id));

    return {
      tick: match.tick,
      time: match.time,
      mode: match.mode,
      map: this.world.toDocument(),
      terrainRevision: match.terrainRevision,
      localPlayerId: match.localPlayerId,
      players,
      fallingClusters: this.getFallingClusters(),
      eggs: this.getEggs(),
      eggScatterDebris: this.getEggScatterDebris(),
      voxelBursts: this.getVoxelBursts(),
      skyDrops: this.getSkyDrops(),
      ranking: match.ranking
    };
  }

  step(commands: Record<string, PlayerCommand> = {}, dt = 1 / this.config.tickRate) {
    this.tick += 1;
    this.time += dt;

    const effectiveCommands = new Map<string, PlayerCommand>();
    const targetCommitments = new Map<string, number>();
    for (const [playerId, player] of this.players) {
      if (!player.alive || player.respawning) {
        effectiveCommands.set(playerId, cloneCommand());
        continue;
      }

      if (player.kind === "npc") {
        const npcCommand = this.generateNpcCommand(player, dt, targetCommitments);
        effectiveCommands.set(playerId, npcCommand);
        const targetPlayerId = this.npcMemories.get(playerId)?.targetPlayerId;
        if (targetPlayerId) {
          targetCommitments.set(targetPlayerId, (targetCommitments.get(targetPlayerId) ?? 0) + 1);
        }
      } else {
        effectiveCommands.set(playerId, cloneCommand(commands[playerId]));
      }
    }

    for (const player of this.players.values()) {
      if (!player.alive || player.respawning) {
        continue;
      }

      const command = effectiveCommands.get(player.id)!;
      this.applyIntent(player, command, dt);
    }

    for (const player of this.players.values()) {
      if (player.alive && !player.respawning) {
        this.integratePlayer(player, dt);
        continue;
      }

      if (player.alive && player.respawning) {
        this.integrateRespawningPlayer(player, dt);
        continue;
      }

      if (!player.alive && player.fallingOut) {
        this.integrateEliminatedPlayer(player, dt);
      }
    }

    this.resolvePlayerCollisions();
    this.updateEggs(dt);
    this.updateEggScatterDebris(dt);
    this.updateVoxelBursts(dt);
    this.updateFallingClusters(dt);
    this.updateSkyDrops(dt);
    this.resolvePlayerCollisions();

    for (const player of this.players.values()) {
      if (player.alive && !player.respawning) {
        this.resolveOutOfBounds(player);
        continue;
      }

      if (player.fallingOut) {
        this.updateEliminationVisibility(player);
      }
    }

    this.updateRespawningPlayers(dt);
    this.resolvePlayerCollisions(4);
  }

  private spawnPlayer(
    kind: PlayerKind,
    name: string,
    spawnIndex: number,
    initialSpawnStyle: SimulationInitialSpawnStyle = "ground"
  ) {
    const id = `${kind}-${spawnIndex + 1}`;
    const spawn = this.getSpawnPosition(spawnIndex);
    const entryState = this.createInitialSpawnState(spawn, initialSpawnStyle);

    const player: SimPlayer = {
      id,
      name,
      kind,
      alive: true,
      fallingOut: false,
      grounded: false,
      mass: this.config.startingMass,
      livesRemaining: this.config.startingLives,
      maxLives: this.config.maxLives,
      respawning: false,
      respawnRemaining: 0,
      invulnerableRemaining: 0,
      stunRemaining: 0,
      position: entryState.position,
      velocity: entryState.velocity,
      facing: kind === "npc" ? { x: -1, z: 0 } : { x: 1, z: 0 },
      eggTauntSequence: 0,
      eggTauntRemaining: 0,
      jumpBufferRemaining: 0,
      jumpAssistRemaining: 0,
      jetpackHoldActivationRemaining: 0,
      jetpackEligible: false,
      jetpackActive: false,
      jetpackOutsideBoundsGrace: false,
      pushCooldownRemaining: 0,
      pushVisualRemaining: 0,
      spacePhase: "none",
      spacePhaseRemaining: 0,
      spaceTriggerArmed: true,
      eliminatedAt: null
    };

    this.players.set(id, player);
    if (kind === "npc") {
      this.npcMemories.set(id, {
        archetype: this.getNpcArchetype(spawnIndex - 1),
        intent: "pressure",
        intentRemaining: 0,
        targetPlayerId: null,
        targetLockRemaining: 0,
        jumpHoldRemaining: 0
      });
    }
    this.invalidatePlayerCollection();
    return player;
  }

  private createInitialSpawnState(spawn: Vector3, initialSpawnStyle: SimulationInitialSpawnStyle) {
    if (initialSpawnStyle !== "sky") {
      return {
        position: { ...spawn },
        velocity: { x: 0, y: 0, z: 0 }
      };
    }

    return {
      position: {
        x: spawn.x,
        y: spawn.y + this.config.skyDropSpawnHeight,
        z: spawn.z
      },
      velocity: { x: 0, y: INITIAL_SKY_ENTRY_SPEED, z: 0 }
    };
  }

  private getSpawnPosition(spawnIndex: number): Vector3 {
    const fallback = {
      x: this.world.size.x / 2 + 0.5,
      y: this.world.getTopSolidY(Math.floor(this.world.size.x / 2), Math.floor(this.world.size.z / 2)) + 1.05,
      z: this.world.size.z / 2 + 0.5
    };
    const initialSpawns = this.initialSpawnCandidates.length > 0 ? this.initialSpawnCandidates : this.spawnCandidates;
    const spawn =
      initialSpawns[spawnIndex] ??
      initialSpawns[spawnIndex % Math.max(1, initialSpawns.length)] ??
      fallback;
    return {
      x: spawn.x,
      y: spawn.y,
      z: spawn.z
    };
  }

  private buildPlayNpcInitialSpawnCandidates(requiredCount: number, initialSpawnSeed?: number) {
    const candidates = this.spawnCandidates.length > 0 ? this.spawnCandidates : this.buildSpawnCandidates(requiredCount);
    if (candidates.length <= 1 || requiredCount <= 1) {
      return candidates.map((spawn) => ({ ...spawn }));
    }

    const derivedSeed =
      initialSpawnSeed ??
      (hashString(`${Date.now()}:${Math.random()}:${requiredCount}:${this.world.meta.updatedAt}`) || 1);
    const random = this.createSeededRandom(derivedSeed);
    const buckets = this.groupSpawnsByQuadrant(candidates);
    const populatedQuadrants = this.getSpawnQuadrants().filter((quadrant) => buckets[quadrant].length > 0);
    if (populatedQuadrants.length === 0) {
      return candidates.map((spawn) => ({ ...spawn }));
    }

    for (const quadrant of this.getSpawnQuadrants()) {
      buckets[quadrant] = this.shuffleSpawnBucket(buckets[quadrant], random);
    }

    const humanQuadrant = populatedQuadrants[Math.floor(random() * populatedQuadrants.length)] ?? populatedQuadrants[0]!;
    const playerSpawn = buckets[humanQuadrant][0] ?? candidates[0]!;
    const usedKeys = new Set<string>([this.getSpawnKey(playerSpawn)]);
    const orderedSpawns: Vector3[] = [{ ...playerSpawn }];

    for (const quadrant of this.getNpcQuadrantPriority(humanQuadrant, random)) {
      for (const spawn of buckets[quadrant]) {
        const key = this.getSpawnKey(spawn);
        if (usedKeys.has(key)) {
          continue;
        }

        orderedSpawns.push({ ...spawn });
        usedKeys.add(key);
        if (orderedSpawns.length >= requiredCount) {
          return orderedSpawns;
        }
      }
    }

    for (const spawn of this.shuffleSpawnBucket(candidates, random)) {
      const key = this.getSpawnKey(spawn);
      if (usedKeys.has(key)) {
        continue;
      }

      orderedSpawns.push({ ...spawn });
      usedKeys.add(key);
      if (orderedSpawns.length >= requiredCount) {
        break;
      }
    }

    return orderedSpawns;
  }

  private createSeededRandom(seed: number) {
    let state = seed >>> 0 || 1;
    return () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x100000000;
    };
  }

  private getSpawnQuadrants(): SpawnQuadrant[] {
    return ["nw", "ne", "sw", "se"];
  }

  private groupSpawnsByQuadrant(spawns: Vector3[]) {
    const buckets: Record<SpawnQuadrant, Vector3[]> = {
      nw: [],
      ne: [],
      sw: [],
      se: []
    };

    for (const spawn of spawns) {
      buckets[this.getSpawnQuadrant(spawn)].push({ ...spawn });
    }

    return buckets;
  }

  private getSpawnQuadrant(spawn: Vector3): SpawnQuadrant {
    const midX = this.world.size.x / 2;
    const midZ = this.world.size.z / 2;
    const east = spawn.x >= midX;
    const south = spawn.z >= midZ;

    if (!east && !south) {
      return "nw";
    }

    if (east && !south) {
      return "ne";
    }

    if (!east && south) {
      return "sw";
    }

    return "se";
  }

  private getNpcQuadrantPriority(humanQuadrant: SpawnQuadrant, random: () => number): SpawnQuadrant[] {
    const diagonallyOpposite = {
      nw: "se",
      ne: "sw",
      sw: "ne",
      se: "nw"
    } satisfies Record<SpawnQuadrant, SpawnQuadrant>;
    const adjacentQuadrants = {
      nw: ["ne", "sw"],
      ne: ["nw", "se"],
      sw: ["se", "nw"],
      se: ["sw", "ne"]
    } satisfies Record<SpawnQuadrant, [SpawnQuadrant, SpawnQuadrant]>;
    const adjacent = [...adjacentQuadrants[humanQuadrant]];
    if (random() >= 0.5) {
      adjacent.reverse();
    }

    return [diagonallyOpposite[humanQuadrant], ...adjacent, humanQuadrant];
  }

  private shuffleSpawnBucket(spawns: Vector3[], random: () => number) {
    const shuffled = spawns.map((spawn) => ({ ...spawn }));
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(random() * (index + 1));
      const current = shuffled[index]!;
      shuffled[index] = shuffled[swapIndex]!;
      shuffled[swapIndex] = current;
    }

    return shuffled;
  }

  private getSpawnKey(spawn: Vector3) {
    return `${spawn.x}:${spawn.y}:${spawn.z}`;
  }

  private buildSpawnCandidates(requiredCount: number): Vector3[] {
    const candidates: Vector3[] = [];
    const minimumSeparation = Math.max(this.config.playerRadius * 3.5, 1.7);
    const authoredSpawns = this.world.listSpawns().map((spawn) => ({
      x: spawn.x,
      y: spawn.y,
      z: spawn.z
    }));
    const fallback = {
      x: this.world.size.x / 2 + 0.5,
      y: this.world.getTopSolidY(Math.floor(this.world.size.x / 2), Math.floor(this.world.size.z / 2)) + 1.05,
      z: this.world.size.z / 2 + 0.5
    };
    const anchors = authoredSpawns.length > 0 ? authoredSpawns : [fallback];

    for (const spawn of anchors) {
      if (this.isSpawnCandidateSeparated(spawn, candidates, minimumSeparation)) {
        candidates.push({ ...spawn });
      }
    }

    const cardinalOffsets = [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
      [1, 1],
      [-1, 1],
      [-1, -1],
      [1, -1]
    ] as const;

    for (let radius = 2; candidates.length < requiredCount && radius <= 9; radius += 1) {
      for (const anchor of anchors) {
        for (const [offsetX, offsetZ] of cardinalOffsets) {
          const candidate = this.createOverflowSpawnCandidate(anchor, offsetX * radius, offsetZ * radius);
          if (
            candidate &&
            this.isSpawnCandidateSeparated(candidate, candidates, minimumSeparation)
          ) {
            candidates.push(candidate);
            if (candidates.length >= requiredCount) {
              break;
            }
          }
        }
      }
    }

    if (candidates.length < requiredCount) {
      for (let x = 2; candidates.length < requiredCount && x < this.world.size.x - 2; x += 3) {
        for (let z = 2; candidates.length < requiredCount && z < this.world.size.z - 2; z += 3) {
          const candidate = this.createOverflowSpawnCandidate(
            { x: x + 0.5, y: 0, z: z + 0.5 },
            0,
            0
          );
          if (
            candidate &&
            this.isSpawnCandidateSeparated(candidate, candidates, minimumSeparation)
          ) {
            candidates.push(candidate);
          }
        }
      }
    }

    return candidates.length > 0 ? candidates : [fallback];
  }

  private createOverflowSpawnCandidate(anchor: Vector3, offsetX: number, offsetZ: number): Vector3 | null {
    const snappedX = clamp(Math.round(anchor.x + offsetX - 0.5) + 0.5, 0.5, this.world.size.x - 0.5);
    const snappedZ = clamp(Math.round(anchor.z + offsetZ - 0.5) + 0.5, 0.5, this.world.size.z - 0.5);
    const cellX = Math.floor(snappedX);
    const cellZ = Math.floor(snappedZ);
    const supportY = this.world.getTopSolidY(cellX, cellZ);
    if (supportY < 0) {
      return null;
    }

    const supportKind = this.world.getSolidKind(cellX, supportY, cellZ);
    if (supportKind !== "ground") {
      return null;
    }

    const candidate = {
      x: snappedX,
      y: supportY + 1.05,
      z: snappedZ
    };

    return this.canPlayerFitAt(candidate) ? candidate : null;
  }

  private isSpawnCandidateSeparated(candidate: Vector3, existing: Vector3[], minimumSeparation: number) {
    return existing.every(
      (entry) => Math.hypot(entry.x - candidate.x, entry.z - candidate.z) >= minimumSeparation
    );
  }

  private canPlayerFitAt(position: Vector3) {
    if (!this.hasPlayerSupportAt(position)) {
      return false;
    }

    return this.isPlayerVolumeClear(position);
  }

  private hasPlayerSupportAt(position: Vector3) {
    const supportY = Math.floor(position.y - 0.1);
    if (supportY < 0) {
      return false;
    }

    const minX = Math.floor(position.x - this.config.playerRadius + EPSILON);
    const maxX = Math.floor(position.x + this.config.playerRadius - EPSILON);
    const minZ = Math.floor(position.z - this.config.playerRadius + EPSILON);
    const maxZ = Math.floor(position.z + this.config.playerRadius - EPSILON);

    for (let x = minX; x <= maxX; x += 1) {
      for (let z = minZ; z <= maxZ; z += 1) {
        if (!this.world.hasSolid(x, supportY, z)) {
          continue;
        }

        if (this.doesPlayerFootprintOverlapVoxelAt(position, x, z)) {
          return true;
        }
      }
    }

    return false;
  }

  private isPlayerVolumeClear(position: Vector3) {
    if (position.y + this.config.playerHeight >= this.world.size.y - EPSILON) {
      return false;
    }

    const minX = Math.floor(position.x - this.config.playerRadius + EPSILON);
    const maxX = Math.floor(position.x + this.config.playerRadius - EPSILON);
    const minY = Math.floor(position.y + EPSILON);
    const maxY = Math.floor(position.y + this.config.playerHeight - EPSILON);
    const minZ = Math.floor(position.z - this.config.playerRadius + EPSILON);
    const maxZ = Math.floor(position.z + this.config.playerRadius - EPSILON);

    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        for (let z = minZ; z <= maxZ; z += 1) {
          if (this.world.hasSolid(x, y, z)) {
            return false;
          }
        }
      }
    }

    return true;
  }

  private doesPlayerFootprintOverlapVoxelAt(position: Vector3, voxelX: number, voxelZ: number) {
    const closestX = clamp(position.x, voxelX, voxelX + 1);
    const closestZ = clamp(position.z, voxelZ, voxelZ + 1);
    const deltaX = position.x - closestX;
    const deltaZ = position.z - closestZ;

    return deltaX * deltaX + deltaZ * deltaZ < this.config.playerRadius * this.config.playerRadius - EPSILON;
  }

  private getNpcArchetype(index: number): NpcArchetype {
    const cycle = index % 3;
    if (cycle === 0) {
      return "hunter";
    }

    if (cycle === 1) {
      return "opportunist";
    }

    return "forager";
  }

  private invalidatePlayerCollection() {
    this.playerCollectionVersion += 1;
    this.playerIdsDirty = true;
  }

  private invalidateFallingClusterCollection() {
    this.fallingClusterCollectionVersion += 1;
    this.fallingClusterIdsDirty = true;
  }

  private invalidateEggCollection() {
    this.eggCollectionVersion += 1;
    this.eggIdsDirty = true;
  }

  private invalidateEggScatterDebrisCollection() {
    this.eggScatterDebrisCollectionVersion += 1;
    this.eggScatterDebrisIdsDirty = true;
  }

  private invalidateSkyDropCollection() {
    this.skyDropCollectionVersion += 1;
    this.skyDropIdsDirty = true;
  }

  private toViewState(player: SimPlayer): PlayerViewState {
    return {
      id: player.id,
      name: player.name,
      kind: player.kind,
      alive: player.alive,
      visible: player.fallingOut || (player.alive && !player.respawning),
      grounded: player.grounded,
      jetpackActive: player.jetpackActive,
      mass: player.mass,
      maxMass: this.config.maxMass,
      livesRemaining: player.livesRemaining,
      maxLives: player.maxLives,
      respawning: player.respawning,
      invulnerableRemaining: player.invulnerableRemaining,
      stunRemaining: player.stunRemaining,
      position: { ...player.position },
      velocity: { ...player.velocity },
      facing: { ...player.facing },
      eggTauntSequence: player.eggTauntSequence,
      eggTauntRemaining: player.eggTauntRemaining,
      eliminatedAt: player.eliminatedAt
    };
  }

  private toMatchPlayerState(player: SimPlayer): MatchPlayerState {
    return {
      id: player.id,
      name: player.name,
      kind: player.kind,
      alive: player.alive,
      livesRemaining: player.livesRemaining,
      respawning: player.respawning,
      eliminatedAt: player.eliminatedAt
    };
  }

  private toHudPlayerState(player: SimPlayer): HudPlayerState {
    return {
      id: player.id,
      name: player.name,
      alive: player.alive,
      grounded: player.grounded,
      mass: player.mass,
      maxMass: this.config.maxMass,
      livesRemaining: player.livesRemaining,
      maxLives: player.maxLives,
      respawning: player.respawning,
      invulnerableRemaining: player.invulnerableRemaining,
      stunRemaining: player.stunRemaining
    };
  }

  private toHudRankingEntry(player: SimPlayer): HudRankingEntry {
    return {
      id: player.id,
      name: player.name,
      alive: player.alive
    };
  }

  private toFallingClusterViewState(cluster: SimFallingCluster): FallingClusterViewState {
    return {
      id: cluster.id,
      phase: cluster.phase,
      warningRemaining: cluster.warningRemaining,
      offsetY: cluster.offsetY,
      center: this.getClusterCenter(cluster),
      voxels: cluster.voxels.map((voxel) => ({
        x: voxel.x,
        y: voxel.y,
        z: voxel.z,
        kind: voxel.kind
      }))
    };
  }

  private toEggViewState(egg: SimEgg): EggViewState {
    return {
      id: egg.id,
      ownerId: egg.ownerId,
      fuseRemaining: egg.fuseRemaining,
      position: { ...egg.position },
      velocity: { ...egg.velocity }
    };
  }

  private toEggScatterDebrisViewState(debris: SimEggScatterDebris): EggScatterDebrisViewState {
    return {
      id: debris.id,
      kind: debris.kind,
      origin: { ...debris.origin },
      destination: { ...debris.destination },
      elapsed: debris.elapsed,
      duration: debris.duration
    };
  }

  private toVoxelBurstViewState(burst: SimVoxelBurst): VoxelBurstViewState {
    return {
      id: burst.id,
      style: burst.style,
      kind: burst.kind,
      position: { ...burst.position },
      elapsed: burst.elapsed,
      duration: burst.duration
    };
  }

  private toSkyDropViewState(skyDrop: SimSkyDrop): SkyDropViewState {
    return {
      id: skyDrop.id,
      phase: skyDrop.phase,
      warningRemaining: skyDrop.warningRemaining,
      landingVoxel: { ...skyDrop.landingVoxel },
      offsetY: skyDrop.offsetY
    };
  }

  private getRanking() {
    const players = [...this.players.values()];
    players.sort((left, right) => {
      if (left.alive !== right.alive) {
        return left.alive ? -1 : 1;
      }

      if (left.alive && right.alive) {
        if (left.livesRemaining !== right.livesRemaining) {
          return right.livesRemaining - left.livesRemaining;
        }

        return right.mass - left.mass;
      }

      return (left.eliminatedAt ?? 0) - (right.eliminatedAt ?? 0);
    });

    return players.map((player) => player.id);
  }

  private applyIntent(player: SimPlayer, command: PlayerCommand, dt: number) {
    player.pushCooldownRemaining = Math.max(0, player.pushCooldownRemaining - dt);
    player.pushVisualRemaining = Math.max(0, player.pushVisualRemaining - dt);
    player.eggTauntRemaining = Math.max(0, player.eggTauntRemaining - dt);
    player.stunRemaining = Math.max(0, player.stunRemaining - dt);
    player.invulnerableRemaining = Math.max(0, player.invulnerableRemaining - dt);
    player.jumpBufferRemaining = Math.max(0, player.jumpBufferRemaining - dt);
    player.jumpAssistRemaining = Math.max(0, player.jumpAssistRemaining - dt);
    if (command.jumpPressed) {
      player.jumpBufferRemaining = this.config.jumpBufferDuration;
    }
    if (player.spacePhase === "float") {
      player.spacePhaseRemaining = Math.max(0, player.spacePhaseRemaining - dt);
      if (player.spacePhaseRemaining <= EPSILON) {
        player.spacePhase = "reentry";
        player.spacePhaseRemaining = 0;
        player.jetpackEligible = true;
        player.jetpackHoldActivationRemaining = 0;
      }
    }

    const stunned = player.stunRemaining > EPSILON;
    const floatingInSpace = player.spacePhase === "float";
    const jumpLockedBySpace = floatingInSpace;
    const suppressGameplayActions = floatingInSpace;
    if (stunned || jumpLockedBySpace) {
      this.stopJetpack(player);
    }

    const moveInput = stunned ? { x: 0, z: 0 } : normalize2(command.moveX, command.moveZ);
    const lookInput = stunned ? { x: 0, z: 0 } : normalize2(command.lookX, command.lookZ);
    if (length2(lookInput.x, lookInput.z) > EPSILON) {
      player.facing = this.rotateFacingToward(player.facing, lookInput, this.config.turnSpeed * dt);
    } else if (length2(moveInput.x, moveInput.z) > EPSILON) {
      player.facing = this.rotateFacingToward(player.facing, moveInput, this.config.turnSpeed * dt);
    }

    const moveSpeed =
      floatingInSpace
        ? this.config.moveSpeed * SPACE_FLOAT_MOVE_SPEED_MULTIPLIER
        : this.config.moveSpeed;
    const desiredX = moveInput.x * moveSpeed;
    const desiredZ = moveInput.z * moveSpeed;
    const acceleration =
      floatingInSpace
        ? this.config.airAcceleration * SPACE_FLOAT_ACCELERATION_MULTIPLIER * dt
        : (player.grounded ? this.config.groundAcceleration : this.config.airAcceleration) * dt;
    const airControl = floatingInSpace ? 1 : player.grounded ? 1 : this.config.airControl;

    player.velocity.x = approach(player.velocity.x, desiredX, acceleration * airControl);
    player.velocity.z = approach(player.velocity.z, desiredZ, acceleration * airControl);

    if (moveInput.x === 0 && moveInput.z === 0 && player.grounded) {
      const frictionAmount = this.config.friction * dt;
      player.velocity.x = approach(player.velocity.x, 0, frictionAmount);
      player.velocity.z = approach(player.velocity.z, 0, frictionAmount);
    }

    let jumpedThisFrame = false;
    if (!stunned && !jumpLockedBySpace && command.jumpPressed && player.grounded) {
      this.startGroundJump(player);
      jumpedThisFrame = true;
    }

    if (!player.grounded && player.jetpackHoldActivationRemaining > 0) {
      if (!command.jump || stunned || jumpLockedBySpace) {
        player.jetpackHoldActivationRemaining = 0;
      } else {
        player.jetpackHoldActivationRemaining = Math.max(0, player.jetpackHoldActivationRemaining - dt);
      }
    }

    if (
      !stunned &&
      player.spacePhase === "reentry" &&
      command.jumpPressed &&
      player.mass > EPSILON
    ) {
      this.cancelReentryForJetpack(player);
      this.activateJetpack(player);
    }

    if (
      !stunned &&
      !jumpLockedBySpace &&
      !jumpedThisFrame &&
      !player.grounded &&
      player.jetpackEligible &&
      (command.jumpPressed || (command.jump && player.jetpackHoldActivationRemaining <= EPSILON)) &&
      player.mass > EPSILON
    ) {
      this.activateJetpack(player);
    }

    if (
      player.jetpackActive &&
      (stunned || player.grounded || !player.jetpackEligible || command.jumpReleased || !command.jump)
    ) {
      this.stopJetpack(player);
    }

    if (player.jetpackActive) {
      player.velocity.y = Math.max(player.velocity.y, this.config.jetpackLiftSpeed);
      player.mass = Math.max(0, player.mass - this.config.jetpackMassDrainPerSecond * dt);
      if (player.mass <= EPSILON) {
        player.mass = 0;
        this.stopJetpack(player);
      }
    }

    if (!stunned && !suppressGameplayActions && command.push) {
      this.tryPush(player);
    }

    if (!stunned && !suppressGameplayActions && command.destroy) {
      this.tryDestroy(player, command.targetVoxel);
    }

    if (!stunned && !suppressGameplayActions && command.place) {
      this.tryPlace(player, command.targetVoxel, command.targetNormal);
    }

    if (!stunned && player.spacePhase !== "reentry" && command.layEgg) {
      this.tryLayEgg(player, command);
    }

    player.mass = clamp(player.mass, 0, this.config.maxMass);
  }

  private rotateFacingToward(current: Vector2, target: Vector2, maxStep: number): Vector2 {
    const normalizedTarget = normalize2(target.x, target.z);
    if (length2(normalizedTarget.x, normalizedTarget.z) <= EPSILON) {
      return current;
    }

    const normalizedCurrent = normalize2(current.x, current.z);
    if (length2(normalizedCurrent.x, normalizedCurrent.z) <= EPSILON) {
      return normalizedTarget;
    }

    const currentYaw = Math.atan2(normalizedCurrent.x, normalizedCurrent.z);
    const targetYaw = Math.atan2(normalizedTarget.x, normalizedTarget.z);
    const delta = Math.atan2(Math.sin(targetYaw - currentYaw), Math.cos(targetYaw - currentYaw));

    if (Math.abs(delta) <= maxStep) {
      return normalizedTarget;
    }

    const nextYaw = currentYaw + clamp(delta, -maxStep, maxStep);
    return {
      x: Math.sin(nextYaw),
      z: Math.cos(nextYaw)
    };
  }

  private nextRandom() {
    this.rngState = (Math.imul(this.rngState, 1664525) + 1013904223) >>> 0;
    return this.rngState / 0x100000000;
  }

  private nextSkyDropInterval() {
    return lerp(this.config.skyDropIntervalMin, this.config.skyDropIntervalMax, this.nextRandom());
  }

  private tryPush(player: SimPlayer) {
    if (player.pushCooldownRemaining > 0 || player.mass < this.config.pushCost) {
      return;
    }

    player.pushVisualRemaining = PUSH_VISUAL_DURATION;

    let candidate: SimPlayer | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const other of this.players.values()) {
      if (!other.alive || other.respawning || other.id === player.id) {
        continue;
      }

      const distance = horizontalDistance(player, other);
      if (distance > this.config.pushRange || distance >= bestDistance) {
        continue;
      }

      const awayX = other.position.x - player.position.x;
      const awayZ = other.position.z - player.position.z;
      const normalized = normalize2(awayX, awayZ);
      const dot = normalized.x * player.facing.x + normalized.z * player.facing.z;
      if (dot < 0.35) {
        continue;
      }

      bestDistance = distance;
      candidate = other;
    }

    if (!candidate) {
      return;
    }

    const pushScale = lerp(0.8, 1.25, clamp(player.mass / this.config.maxMass, 0, 1));
    const effectivePushImpulse = this.config.pushImpulse * pushScale;

    candidate.velocity.x += player.facing.x * effectivePushImpulse;
    candidate.velocity.z += player.facing.z * effectivePushImpulse;
    candidate.velocity.y = Math.max(candidate.velocity.y, this.config.pushLift);
    player.velocity.x -= player.facing.x * effectivePushImpulse * 0.15;
    player.velocity.z -= player.facing.z * effectivePushImpulse * 0.15;
    player.mass -= this.config.pushCost;
    player.pushCooldownRemaining = this.config.pushCooldown;
  }

  private tryDestroy(player: SimPlayer, targetVoxel: Vec3i | null) {
    if (!targetVoxel) {
      return;
    }

    const kind = this.world.getVoxelKind(targetVoxel.x, targetVoxel.y, targetVoxel.z);
    if (!kind || !this.isHarvestable(kind) || !this.isTargetInInteractRange(player, targetVoxel)) {
      return;
    }

    const removedVoxel = {
      x: targetVoxel.x,
      y: targetVoxel.y,
      z: targetVoxel.z
    };
    this.addDirtyChunkKeys(this.world.removeVoxels([removedVoxel]));
    this.invalidateFallingClusterLandingCacheForMutations([removedVoxel]);
    this.spawnDetachedComponentsNearMutations([removedVoxel]);
    this.createVoxelBurst(
      "harvest",
      {
        x: removedVoxel.x + 0.5,
        y: removedVoxel.y + 0.5,
        z: removedVoxel.z + 0.5
      },
      HARVEST_VOXEL_BURST_DURATION,
      kind
    );
    player.mass = clamp(player.mass + this.config.destroyGain, 0, this.config.maxMass);
  }

  private tryPlace(player: SimPlayer, targetVoxel: Vec3i | null, targetNormal: Vec3i | null) {
    if (player.mass < this.config.placeCost) {
      return;
    }

    const focusState = this.getRuntimeInteractionFocusState(targetVoxel, targetNormal, player.id);
    if (!focusState?.placeValid) {
      return;
    }

    const placedVoxel = {
      x: focusState.placeVoxel.x,
      y: focusState.placeVoxel.y,
      z: focusState.placeVoxel.z,
      kind: "ground" as const
    };
    this.addDirtyChunkKeys(this.world.setVoxels([placedVoxel]));
    this.invalidateFallingClusterLandingCacheForMutations([placedVoxel]);

    player.mass -= this.config.placeCost;
  }

  private tryLayEgg(player: SimPlayer, command: PlayerCommand) {
    if (player.mass < this.config.eggCost || this.getActiveEggCountForOwner(player.id) >= this.config.maxActiveEggsPerPlayer) {
      return;
    }

    const eggId = `egg-${this.nextEggId}`;
    this.nextEggId += 1;
    const orbital = player.spacePhase === "float";
    const groundedThrow = player.grounded && !orbital;

    const spawnX = player.position.x + player.facing.x * this.config.eggDropOffsetForward;
    const spawnY = orbital
      ? player.position.y + ORBITAL_EGG_DROP_OFFSET_Y
      : player.position.y + this.config.eggDropOffsetUp;
    const spawnZ = player.position.z + player.facing.z * this.config.eggDropOffsetForward;
    const groundedLaunchVelocity = getGroundedEggLaunchVelocity({
      playerVelocity: player.velocity,
      facing: player.facing,
      eggCharge: clamp(Math.max(command.eggCharge, MIN_GROUNDED_EGG_CHARGE), 0, 1),
      cameraPitch: command.eggPitch,
      config: this.config
    });
    const egg: SimEgg = {
      id: eggId,
      ownerId: player.id,
      fuseRemaining: orbital
        ? Math.max(this.config.eggFuseDuration, ORBITAL_EGG_FUSE_DURATION)
        : this.config.eggFuseDuration,
      grounded: false,
      orbital,
      explodeOnGroundContact: orbital,
      fuseArmedBelowY: orbital ? this.world.size.y + ORBITAL_EGG_FUSE_ARM_MARGIN_Y : null,
      position: {
        x: clamp(spawnX, this.config.eggRadius + EPSILON, this.world.size.x - this.config.eggRadius - EPSILON),
        y: orbital ? Math.max(this.config.eggRadius + EPSILON, spawnY) : clamp(spawnY, this.config.eggRadius + EPSILON, this.world.size.y - this.config.eggRadius - EPSILON),
        z: clamp(spawnZ, this.config.eggRadius + EPSILON, this.world.size.z - this.config.eggRadius - EPSILON)
      },
      velocity: {
        x: orbital
          ? player.velocity.x * ORBITAL_EGG_HORIZONTAL_INHERIT_FACTOR + player.facing.x * this.config.eggThrowSpeed * ORBITAL_EGG_HORIZONTAL_THROW_FACTOR
          : groundedThrow
            ? groundedLaunchVelocity.x
            : player.velocity.x + player.facing.x * this.config.eggThrowSpeed,
        y: orbital
          ? -ORBITAL_EGG_DOWNWARD_SPEED
          : groundedThrow
            ? groundedLaunchVelocity.y
            : Math.max(player.velocity.y * 0.35, 0) + this.config.eggThrowSpeed * 0.38,
        z: orbital
          ? player.velocity.z * ORBITAL_EGG_HORIZONTAL_INHERIT_FACTOR + player.facing.z * this.config.eggThrowSpeed * ORBITAL_EGG_HORIZONTAL_THROW_FACTOR
          : groundedThrow
            ? groundedLaunchVelocity.z
            : player.velocity.z + player.facing.z * this.config.eggThrowSpeed
      }
    };

    this.eggs.set(egg.id, egg);
    this.invalidateEggCollection();
    player.mass -= this.config.eggCost;
    player.eggTauntSequence += 1;
    player.eggTauntRemaining = EGG_TAUNT_DURATION;
  }

  private isHarvestable(kind: BlockKind) {
    return kind === "ground" || kind === "boundary";
  }

  private getPlayerChestPosition(player: SimPlayer): Vector3 {
    return {
      x: player.position.x,
      y: player.position.y + this.config.playerHeight * 0.7,
      z: player.position.z
    };
  }

  private isTargetInInteractRange(player: SimPlayer, targetVoxel: Vec3i) {
    const chest = this.getPlayerChestPosition(player);
    const targetCenter = {
      x: targetVoxel.x + 0.5,
      y: targetVoxel.y + 0.5,
      z: targetVoxel.z + 0.5
    };

    return (
      Math.hypot(
        targetCenter.x - chest.x,
        targetCenter.y - chest.y,
        targetCenter.z - chest.z
      ) <= this.config.interactRange
    );
  }

  private isVoxelBlockedByAnyPlayer(targetVoxel: Vec3i) {
    for (const player of this.players.values()) {
      if (!player.alive || player.respawning) {
        continue;
      }

      if (this.doesPlayerOverlapVoxel(player, targetVoxel)) {
        return true;
      }
    }

    return false;
  }

  private doesPlayerOverlapVoxel(player: SimPlayer, targetVoxel: Vec3i) {
    const voxelMinY = targetVoxel.y;
    const voxelMaxY = targetVoxel.y + 1;
    const playerMinY = player.position.y;
    const playerMaxY = player.position.y + this.config.playerHeight;

    if (playerMaxY <= voxelMinY + EPSILON || playerMinY >= voxelMaxY - EPSILON) {
      return false;
    }

    const closestX = clamp(player.position.x, targetVoxel.x, targetVoxel.x + 1);
    const closestZ = clamp(player.position.z, targetVoxel.z, targetVoxel.z + 1);
    const deltaX = player.position.x - closestX;
    const deltaZ = player.position.z - closestZ;

    return deltaX * deltaX + deltaZ * deltaZ < this.config.playerRadius * this.config.playerRadius - EPSILON;
  }

  private isVoxelBlockedByFallingCluster(targetVoxel: Vec3i) {
    for (const cluster of this.fallingClusters.values()) {
      for (const voxel of cluster.voxels) {
        if (voxel.x !== targetVoxel.x || voxel.z !== targetVoxel.z) {
          continue;
        }

        const voxelMinY = voxel.y + cluster.offsetY;
        const voxelMaxY = voxelMinY + 1;
        if (targetVoxel.y + 1 <= voxelMinY + EPSILON || targetVoxel.y >= voxelMaxY - EPSILON) {
          continue;
        }

        return true;
      }
    }

    return false;
  }

  private isVoxelBlockedBySkyDrop(targetVoxel: Vec3i) {
    for (const skyDrop of this.skyDrops.values()) {
      if (skyDrop.landingVoxel.x !== targetVoxel.x || skyDrop.landingVoxel.z !== targetVoxel.z) {
        continue;
      }

      const voxelMinY = skyDrop.landingVoxel.y + skyDrop.offsetY;
      const voxelMaxY = voxelMinY + 1;
      if (targetVoxel.y + 1 <= voxelMinY + EPSILON || targetVoxel.y >= voxelMaxY - EPSILON) {
        continue;
      }

      return true;
    }

    return false;
  }

  private isVoxelBlockedByEgg(targetVoxel: Vec3i) {
    for (const egg of this.eggs.values()) {
      const eggMinY = egg.position.y - this.config.eggRadius;
      const eggMaxY = egg.position.y + this.config.eggRadius;
      if (targetVoxel.y + 1 <= eggMinY + EPSILON || targetVoxel.y >= eggMaxY - EPSILON) {
        continue;
      }

      const closestX = clamp(egg.position.x, targetVoxel.x, targetVoxel.x + 1);
      const closestZ = clamp(egg.position.z, targetVoxel.z, targetVoxel.z + 1);
      const deltaX = egg.position.x - closestX;
      const deltaZ = egg.position.z - closestZ;
      if (deltaX * deltaX + deltaZ * deltaZ <= this.config.eggRadius * this.config.eggRadius) {
        return true;
      }
    }

    return false;
  }

  private isVoxelBlockedByEggScatterDebris(targetVoxel: Vec3i) {
    for (const debris of this.eggScatterDebris.values()) {
      const position = this.getEggScatterDebrisPosition(debris);
      const voxelMinY = position.y - 0.5;
      const voxelMaxY = position.y + 0.5;
      if (targetVoxel.y + 1 <= voxelMinY + EPSILON || targetVoxel.y >= voxelMaxY - EPSILON) {
        continue;
      }

      if (
        position.x >= targetVoxel.x &&
        position.x <= targetVoxel.x + 1 &&
        position.z >= targetVoxel.z &&
        position.z <= targetVoxel.z + 1
      ) {
        return true;
      }
    }

    return false;
  }

  private integratePlayer(player: SimPlayer, dt: number) {
    const previousY = player.position.y;
    const gravityMultiplier =
      player.spacePhase === "float"
        ? SPACE_FLOAT_GRAVITY_MULTIPLIER
        : player.spacePhase === "reentry"
          ? SPACE_REENTRY_GRAVITY_MULTIPLIER
          : 1;
    player.velocity.y -= this.config.gravity * gravityMultiplier * dt;
    if (player.spacePhase === "float") {
      player.velocity.y = Math.max(player.velocity.y, SPACE_FLOAT_DRIFT_SPEED);
    }

    this.resolveHorizontalMovement(player, "x", player.velocity.x * dt);
    const groundedByY = this.resolveAxis(player, "y", player.velocity.y * dt);
    this.resolveHorizontalMovement(player, "z", player.velocity.z * dt);
    player.grounded = groundedByY;
    if (player.grounded) {
      this.clearJetpackState(player);
      player.jumpAssistRemaining = 0;
      player.spacePhase = "none";
      player.spacePhaseRemaining = 0;
      player.spaceTriggerArmed = true;
      if (player.jumpBufferRemaining > EPSILON && player.stunRemaining <= EPSILON) {
        this.startGroundJump(player);
      }
      return;
    }

    const spaceEnterY = this.getSpaceEnterY();
    const spaceResetY = this.getSpaceResetY();
    if (
      player.spacePhase === "none" &&
      player.spaceTriggerArmed &&
      previousY < spaceEnterY &&
      player.position.y >= spaceEnterY &&
      player.velocity.y > EPSILON
    ) {
      this.startSpaceFloat(player);
      return;
    }

    if (player.spacePhase === "reentry" && player.position.y <= spaceResetY) {
      player.spacePhase = "none";
      player.spacePhaseRemaining = 0;
    }

    if (player.spacePhase === "none" && player.position.y <= spaceResetY) {
      player.spaceTriggerArmed = true;
    }
  }

  private getSpaceEnterY() {
    return Math.max(this.world.size.y + 28, 60);
  }

  private getSpaceResetY() {
    return this.getSpaceEnterY() - 12;
  }

  private startSpaceFloat(player: SimPlayer) {
    this.stopJetpack(player);
    player.jumpBufferRemaining = 0;
    player.jetpackHoldActivationRemaining = 0;
    player.jetpackEligible = false;
    player.jetpackOutsideBoundsGrace = false;
    player.spacePhase = "float";
    player.spacePhaseRemaining = SPACE_FLOAT_DURATION;
    player.spaceTriggerArmed = false;
    player.velocity.y = SPACE_FLOAT_DRIFT_SPEED;
  }

  private startGroundJump(player: SimPlayer) {
    player.velocity.y = this.config.jumpSpeed;
    player.grounded = false;
    player.jumpBufferRemaining = 0;
    player.jumpAssistRemaining = JUMP_LEDGE_ASSIST_DURATION;
    player.jetpackHoldActivationRemaining = this.config.jetpackHoldActivationDelay;
    player.jetpackEligible = true;
    player.jetpackOutsideBoundsGrace = false;
  }

  private activateJetpack(player: SimPlayer) {
    player.jetpackActive = true;
    player.jumpBufferRemaining = 0;
    player.jetpackHoldActivationRemaining = 0;
  }

  private cancelReentryForJetpack(player: SimPlayer) {
    player.spacePhase = "none";
    player.spacePhaseRemaining = 0;
    player.spaceTriggerArmed = false;
  }

  private integrateEliminatedPlayer(player: SimPlayer, dt: number) {
    player.velocity.y -= this.config.gravity * dt;
    player.position.x += player.velocity.x * dt;
    player.position.y += player.velocity.y * dt;
    player.position.z += player.velocity.z * dt;
  }

  private integrateRespawningPlayer(player: SimPlayer, dt: number) {
    player.invulnerableRemaining = Math.max(0, player.invulnerableRemaining - dt);
    if (!player.fallingOut) {
      return;
    }

    player.velocity.y -= this.config.gravity * dt;
    player.position.x += player.velocity.x * dt;
    player.position.y += player.velocity.y * dt;
    player.position.z += player.velocity.z * dt;
  }

  private updateEggs(dt: number) {
    const eggs = [...this.eggs.values()].sort((left, right) => left.id.localeCompare(right.id));
    for (const egg of eggs) {
      if (!this.eggs.has(egg.id)) {
        continue;
      }

      egg.fuseRemaining = Math.max(0, egg.fuseRemaining - dt);
      const explodedOnImpact = this.integrateEgg(egg, dt);
      if (explodedOnImpact) {
        this.explodeEgg(egg);
        continue;
      }

      const fuseArmed = egg.fuseArmedBelowY == null || egg.position.y <= egg.fuseArmedBelowY;
      if ((fuseArmed && egg.fuseRemaining <= EPSILON) || egg.position.y < this.world.boundary.fallY) {
        this.explodeEgg(egg);
      }
    }
  }

  private integrateEgg(egg: SimEgg, dt: number) {
    egg.velocity.y -= this.config.eggGravity * dt;

    this.resolveEggAxis(egg, "x", egg.velocity.x * dt);
    const groundedByY = this.resolveEggAxis(egg, "y", egg.velocity.y * dt);
    egg.grounded = groundedByY;
    if (groundedByY && egg.explodeOnGroundContact) {
      egg.position.x = clamp(egg.position.x, this.config.eggRadius + EPSILON, this.world.size.x - this.config.eggRadius - EPSILON);
      egg.position.z = clamp(egg.position.z, this.config.eggRadius + EPSILON, this.world.size.z - this.config.eggRadius - EPSILON);
      return true;
    }
    this.resolveEggAxis(egg, "z", egg.velocity.z * dt);

    if (egg.grounded) {
      egg.velocity.x = approach(egg.velocity.x, 0, this.config.eggGroundFriction * EGG_GROUND_FRICTION_MULTIPLIER * dt);
      egg.velocity.z = approach(egg.velocity.z, 0, this.config.eggGroundFriction * EGG_GROUND_FRICTION_MULTIPLIER * dt);
      if (Math.abs(egg.velocity.x) < this.config.eggGroundSpeedThreshold) {
        egg.velocity.x = 0;
      }
      if (Math.abs(egg.velocity.z) < this.config.eggGroundSpeedThreshold) {
        egg.velocity.z = 0;
      }
    }

    egg.position.x = clamp(egg.position.x, this.config.eggRadius + EPSILON, this.world.size.x - this.config.eggRadius - EPSILON);
    egg.position.z = clamp(egg.position.z, this.config.eggRadius + EPSILON, this.world.size.z - this.config.eggRadius - EPSILON);
    return false;
  }

  private resolveEggAxis(egg: SimEgg, axis: "x" | "y" | "z", delta: number) {
    if (Math.abs(delta) <= EPSILON) {
      return false;
    }

    const direction = Math.sign(delta);
    let next = egg.position[axis] + delta;
    let collided = false;
    let grounded = false;

    if (axis === "x") {
      const minY = Math.floor(egg.position.y - this.config.eggRadius + EPSILON);
      const maxY = Math.floor(egg.position.y + this.config.eggRadius - EPSILON);
      const minZ = Math.floor(egg.position.z - this.config.eggRadius + EPSILON);
      const maxZ = Math.floor(egg.position.z + this.config.eggRadius - EPSILON);
      const start = Math.floor((direction > 0 ? egg.position.x + this.config.eggRadius : egg.position.x - this.config.eggRadius) + EPSILON * direction);
      const end = Math.floor((direction > 0 ? next + this.config.eggRadius : next - this.config.eggRadius) + EPSILON * direction);

      for (let x = start; direction > 0 ? x <= end : x >= end; x += direction) {
        for (let y = minY; y <= maxY; y += 1) {
          for (let z = minZ; z <= maxZ; z += 1) {
            if (!this.world.hasSolid(x, y, z)) {
              continue;
            }

            collided = true;
            next =
              direction > 0
                ? Math.min(next, x - this.config.eggRadius - EPSILON)
                : Math.max(next, x + 1 + this.config.eggRadius + EPSILON);
          }
        }
      }
    } else if (axis === "y") {
      const minX = Math.floor(egg.position.x - this.config.eggRadius + EPSILON);
      const maxX = Math.floor(egg.position.x + this.config.eggRadius - EPSILON);
      const minZ = Math.floor(egg.position.z - this.config.eggRadius + EPSILON);
      const maxZ = Math.floor(egg.position.z + this.config.eggRadius - EPSILON);
      const start = Math.floor((direction > 0 ? egg.position.y + this.config.eggRadius : egg.position.y - this.config.eggRadius) + EPSILON * direction);
      const end = Math.floor((direction > 0 ? next + this.config.eggRadius : next - this.config.eggRadius) + EPSILON * direction);

      for (let y = start; direction > 0 ? y <= end : y >= end; y += direction) {
        for (let x = minX; x <= maxX; x += 1) {
          for (let z = minZ; z <= maxZ; z += 1) {
            if (!this.world.hasSolid(x, y, z)) {
              continue;
            }

            collided = true;
            if (direction > 0) {
              next = Math.min(next, y - this.config.eggRadius - EPSILON);
            } else {
              next = Math.max(next, y + 1 + this.config.eggRadius + EPSILON);
              grounded = true;
            }
          }
        }
      }
    } else {
      const minX = Math.floor(egg.position.x - this.config.eggRadius + EPSILON);
      const maxX = Math.floor(egg.position.x + this.config.eggRadius - EPSILON);
      const minY = Math.floor(egg.position.y - this.config.eggRadius + EPSILON);
      const maxY = Math.floor(egg.position.y + this.config.eggRadius - EPSILON);
      const start = Math.floor((direction > 0 ? egg.position.z + this.config.eggRadius : egg.position.z - this.config.eggRadius) + EPSILON * direction);
      const end = Math.floor((direction > 0 ? next + this.config.eggRadius : next - this.config.eggRadius) + EPSILON * direction);

      for (let z = start; direction > 0 ? z <= end : z >= end; z += direction) {
        for (let x = minX; x <= maxX; x += 1) {
          for (let y = minY; y <= maxY; y += 1) {
            if (!this.world.hasSolid(x, y, z)) {
              continue;
            }

            collided = true;
            next =
              direction > 0
                ? Math.min(next, z - this.config.eggRadius - EPSILON)
                : Math.max(next, z + 1 + this.config.eggRadius + EPSILON);
          }
        }
      }
    }

    egg.position[axis] = next;
    if (!collided) {
      return grounded;
    }

    if (axis === "y") {
      if (grounded) {
        if (egg.explodeOnGroundContact) {
          return grounded;
        }
        egg.velocity.x *= EGG_GROUND_IMPACT_CARRY;
        egg.velocity.z *= EGG_GROUND_IMPACT_CARRY;
        egg.velocity.y = Math.abs(egg.velocity.y) * this.config.eggBounceDamping;
        if (egg.velocity.y < this.config.eggGroundSpeedThreshold * EGG_GROUND_SETTLE_BOUNCE_SPEED_MULTIPLIER) {
          egg.velocity.y = 0;
        }
      } else {
        egg.velocity.y = -Math.abs(egg.velocity.y) * this.config.eggBounceDamping * EGG_CEILING_BOUNCE_DAMPING;
      }
    } else {
      egg.velocity[axis] = -egg.velocity[axis] * this.config.eggBounceDamping * EGG_WALL_BOUNCE_DAMPING;
    }

    return grounded;
  }

  private updateEggScatterDebris(dt: number) {
    const debrisEntries = [...this.eggScatterDebris.values()].sort((left, right) => left.id.localeCompare(right.id));
    const landedVoxelsByKey = new Map<string, VoxelCell>();
    const settledDebrisIds: string[] = [];

    for (const debris of debrisEntries) {
      if (!this.eggScatterDebris.has(debris.id)) {
        continue;
      }

      debris.elapsed = Math.min(debris.duration, debris.elapsed + dt);
      if (debris.elapsed + EPSILON < debris.duration) {
        continue;
      }

      const landingVoxel = {
        x: Math.floor(debris.destination.x),
        y: Math.floor(debris.destination.y),
        z: Math.floor(debris.destination.z)
      };
      const landingKey = `${landingVoxel.x},${landingVoxel.y},${landingVoxel.z}`;
      if (
        !landedVoxelsByKey.has(landingKey) &&
        !this.world.hasSolid(landingVoxel.x, landingVoxel.y, landingVoxel.z)
      ) {
        landedVoxelsByKey.set(landingKey, {
          x: landingVoxel.x,
          y: landingVoxel.y,
          z: landingVoxel.z,
          kind: debris.kind
        });
      }

      settledDebrisIds.push(debris.id);
    }

    if (landedVoxelsByKey.size > 0) {
      const landedVoxels = [...landedVoxelsByKey.values()];
      this.addDirtyChunkKeys(this.world.setVoxels(landedVoxels));
      this.invalidateFallingClusterLandingCacheForMutations(landedVoxels);
    }

    if (settledDebrisIds.length > 0) {
      for (const debrisId of settledDebrisIds) {
        this.eggScatterDebris.delete(debrisId);
      }

      this.invalidateEggScatterDebrisCollection();
    }
  }

  private getEggScatterDebrisPosition(debris: SimEggScatterDebris): Vector3 {
    const progress = debris.duration <= EPSILON ? 1 : clamp(debris.elapsed / debris.duration, 0, 1);
    return {
      x: lerp(debris.origin.x, debris.destination.x, progress),
      y:
        lerp(debris.origin.y, debris.destination.y, progress) +
        Math.sin(progress * Math.PI) * this.config.eggScatterArcHeight,
      z: lerp(debris.origin.z, debris.destination.z, progress)
    };
  }

  private updateVoxelBursts(dt: number) {
    const expiredBurstIds: string[] = [];

    for (const burst of this.voxelBursts.values()) {
      burst.elapsed = Math.min(burst.duration, burst.elapsed + dt);
      if (burst.elapsed + EPSILON < burst.duration) {
        continue;
      }

      expiredBurstIds.push(burst.id);
    }

    for (const burstId of expiredBurstIds) {
      this.voxelBursts.delete(burstId);
    }
  }

  private resolveAxis(player: SimPlayer, axis: "x" | "y" | "z", delta: number) {
    if (Math.abs(delta) <= EPSILON) {
      return false;
    }

    const direction = Math.sign(delta);
    let next = player.position[axis] + delta;
    let collided = false;
    let grounded = false;

    if (axis === "x") {
      const minY = Math.floor(player.position.y + EPSILON);
      const maxY = Math.floor(player.position.y + this.config.playerHeight - EPSILON);
      const minZ = Math.floor(player.position.z - this.config.playerRadius + EPSILON);
      const maxZ = Math.floor(player.position.z + this.config.playerRadius - EPSILON);

      const start = Math.floor((direction > 0 ? player.position.x + this.config.playerRadius : player.position.x - this.config.playerRadius) + EPSILON * direction);
      const end = Math.floor((direction > 0 ? next + this.config.playerRadius : next - this.config.playerRadius) + EPSILON * direction);

      for (let x = start; direction > 0 ? x <= end : x >= end; x += direction) {
        for (let y = minY; y <= maxY; y += 1) {
          for (let z = minZ; z <= maxZ; z += 1) {
            if (!this.world.hasSolid(x, y, z)) {
              continue;
            }

            collided = true;
            next =
              direction > 0
                ? Math.min(next, x - this.config.playerRadius - EPSILON)
                : Math.max(next, x + 1 + this.config.playerRadius + EPSILON);
          }
        }
      }
    } else if (axis === "y") {
      const minX = Math.floor(player.position.x - this.config.playerRadius + EPSILON);
      const maxX = Math.floor(player.position.x + this.config.playerRadius - EPSILON);
      const minZ = Math.floor(player.position.z - this.config.playerRadius + EPSILON);
      const maxZ = Math.floor(player.position.z + this.config.playerRadius - EPSILON);

      const start = Math.floor((direction > 0 ? player.position.y + this.config.playerHeight : player.position.y) + EPSILON * direction);
      const end = Math.floor((direction > 0 ? next + this.config.playerHeight : next) + EPSILON * direction);

      for (let y = start; direction > 0 ? y <= end : y >= end; y += direction) {
        for (let x = minX; x <= maxX; x += 1) {
          for (let z = minZ; z <= maxZ; z += 1) {
            if (!this.world.hasSolid(x, y, z)) {
              continue;
            }

            collided = true;
            if (direction > 0) {
              next = Math.min(next, y - this.config.playerHeight - EPSILON);
            } else {
              next = Math.max(next, y + 1 + EPSILON);
              grounded = true;
            }
          }
        }
      }
    } else {
      const minX = Math.floor(player.position.x - this.config.playerRadius + EPSILON);
      const maxX = Math.floor(player.position.x + this.config.playerRadius - EPSILON);
      const minY = Math.floor(player.position.y + EPSILON);
      const maxY = Math.floor(player.position.y + this.config.playerHeight - EPSILON);

      const start = Math.floor((direction > 0 ? player.position.z + this.config.playerRadius : player.position.z - this.config.playerRadius) + EPSILON * direction);
      const end = Math.floor((direction > 0 ? next + this.config.playerRadius : next - this.config.playerRadius) + EPSILON * direction);

      for (let z = start; direction > 0 ? z <= end : z >= end; z += direction) {
        for (let x = minX; x <= maxX; x += 1) {
          for (let y = minY; y <= maxY; y += 1) {
            if (!this.world.hasSolid(x, y, z)) {
              continue;
            }

            collided = true;
            next =
              direction > 0
                ? Math.min(next, z - this.config.playerRadius - EPSILON)
                : Math.max(next, z + 1 + this.config.playerRadius + EPSILON);
          }
        }
      }
    }

    player.position[axis] = next;
    if (collided) {
      player.velocity[axis] = 0;
    }

    return grounded;
  }

  private resolveHorizontalMovement(player: SimPlayer, axis: "x" | "z", delta: number) {
    const collision = this.getHorizontalAxisCollision(player, axis, delta);
    if (!collision) {
      player.position[axis] += delta;
      return;
    }

    if (this.tryJumpLedgeAssist(player, axis, delta, collision)) {
      return;
    }

    player.position[axis] = collision.next;
    player.velocity[axis] = 0;
  }

  private getHorizontalAxisCollision(
    player: SimPlayer,
    axis: "x" | "z",
    delta: number
  ): HorizontalAxisCollision | null {
    if (Math.abs(delta) <= EPSILON) {
      return null;
    }

    const direction = Math.sign(delta);
    let next = player.position[axis] + delta;
    let collided = false;
    let blockerTopY = Number.NEGATIVE_INFINITY;

    if (axis === "x") {
      const minY = Math.floor(player.position.y + EPSILON);
      const maxY = Math.floor(player.position.y + this.config.playerHeight - EPSILON);
      const minZ = Math.floor(player.position.z - this.config.playerRadius + EPSILON);
      const maxZ = Math.floor(player.position.z + this.config.playerRadius - EPSILON);
      const start = Math.floor(
        (direction > 0 ? player.position.x + this.config.playerRadius : player.position.x - this.config.playerRadius) +
          EPSILON * direction
      );
      const end = Math.floor((direction > 0 ? next + this.config.playerRadius : next - this.config.playerRadius) + EPSILON * direction);

      for (let x = start; direction > 0 ? x <= end : x >= end; x += direction) {
        for (let y = minY; y <= maxY; y += 1) {
          for (let z = minZ; z <= maxZ; z += 1) {
            if (!this.world.hasSolid(x, y, z)) {
              continue;
            }

            collided = true;
            blockerTopY = Math.max(blockerTopY, y + 1);
            next =
              direction > 0
                ? Math.min(next, x - this.config.playerRadius - EPSILON)
                : Math.max(next, x + 1 + this.config.playerRadius + EPSILON);
          }
        }
      }
    } else {
      const minX = Math.floor(player.position.x - this.config.playerRadius + EPSILON);
      const maxX = Math.floor(player.position.x + this.config.playerRadius - EPSILON);
      const minY = Math.floor(player.position.y + EPSILON);
      const maxY = Math.floor(player.position.y + this.config.playerHeight - EPSILON);
      const start = Math.floor(
        (direction > 0 ? player.position.z + this.config.playerRadius : player.position.z - this.config.playerRadius) +
          EPSILON * direction
      );
      const end = Math.floor((direction > 0 ? next + this.config.playerRadius : next - this.config.playerRadius) + EPSILON * direction);

      for (let z = start; direction > 0 ? z <= end : z >= end; z += direction) {
        for (let x = minX; x <= maxX; x += 1) {
          for (let y = minY; y <= maxY; y += 1) {
            if (!this.world.hasSolid(x, y, z)) {
              continue;
            }

            collided = true;
            blockerTopY = Math.max(blockerTopY, y + 1);
            next =
              direction > 0
                ? Math.min(next, z - this.config.playerRadius - EPSILON)
                : Math.max(next, z + 1 + this.config.playerRadius + EPSILON);
          }
        }
      }
    }

    return collided ? { next, blockerTopY } : null;
  }

  private tryJumpLedgeAssist(
    player: SimPlayer,
    axis: "x" | "z",
    delta: number,
    collision: HorizontalAxisCollision
  ) {
    if (player.grounded || player.jumpAssistRemaining <= EPSILON) {
      return false;
    }

    const targetY = collision.blockerTopY + JUMP_LEDGE_ASSIST_CLEARANCE;
    const liftHeight = targetY - player.position.y;
    if (liftHeight <= EPSILON || liftHeight > JUMP_LEDGE_ASSIST_MAX_HEIGHT) {
      return false;
    }

    const candidatePosition = {
      x: player.position.x,
      y: targetY,
      z: player.position.z
    };
    candidatePosition[axis] += delta;

    if (!this.hasPlayerSupportAt(candidatePosition) || !this.isPlayerVolumeClear(candidatePosition)) {
      return false;
    }

    player.position.y = targetY;
    player.position[axis] += delta;
    return true;
  }

  private resolveOutOfBounds(player: SimPlayer) {
    if (player.position.y < this.world.boundary.fallY) {
      this.handleRingOut(player, false);
      return;
    }

    if (!this.isOutsideHorizontalBounds(player)) {
      player.jetpackOutsideBoundsGrace = false;
      return;
    }

    if (player.jetpackActive) {
      player.jetpackOutsideBoundsGrace = true;
      return;
    }

    this.handleRingOut(player, player.jetpackOutsideBoundsGrace);
  }

  private getActiveEggCountForOwner(ownerId: string) {
    let count = 0;
    for (const egg of this.eggs.values()) {
      if (egg.ownerId === ownerId) {
        count += 1;
      }
    }

    return count;
  }

  private getEggBlastImpact(egg: SimEgg) {
    if (!egg.orbital) {
      return {
        hitRadius: this.config.eggBlastHitRadius,
        knockback: this.config.eggBlastKnockback,
        lift: this.config.eggBlastLift,
        stunDuration: this.config.eggBlastStunDuration
      };
    }

    return {
      hitRadius: this.config.eggBlastHitRadius * ORBITAL_EGG_HIT_RADIUS_MULTIPLIER,
      knockback: this.config.eggBlastKnockback * ORBITAL_EGG_KNOCKBACK_MULTIPLIER,
      lift: this.config.eggBlastLift * ORBITAL_EGG_LIFT_MULTIPLIER,
      stunDuration: this.config.eggBlastStunDuration * ORBITAL_EGG_STUN_MULTIPLIER
    };
  }

  private explodeEgg(egg: SimEgg) {
    if (!this.eggs.has(egg.id)) {
      return;
    }

    const explosionCenter = { ...egg.position };
    const blastImpact = this.getEggBlastImpact(egg);
    const hitRadiusSquared = blastImpact.hitRadius * blastImpact.hitRadius;
    for (const player of this.players.values()) {
      if (!player.alive || player.respawning) {
        continue;
      }

      if (distanceSquared3(this.getPlayerChestPosition(player), explosionCenter) > hitRadiusSquared) {
        continue;
      }

      this.applyPlayerHit(player, explosionCenter, {
        knockback: blastImpact.knockback,
        lift: blastImpact.lift,
        stunDuration: blastImpact.stunDuration
      });
    }

    const explodedVoxels = this.collectEggExplosionVoxels(explosionCenter);
    if (explodedVoxels.length > 0) {
      this.addDirtyChunkKeys(this.world.removeVoxels(explodedVoxels));
      this.invalidateFallingClusterLandingCacheForMutations(explodedVoxels);
    }
    this.createVoxelBurst("eggExplosion", explosionCenter, EGG_EXPLOSION_VOXEL_BURST_DURATION, null);

    const reservedLandingKeys = new Set<string>();
    let scatterCount = 0;
    for (const voxel of explodedVoxels) {
      const destroyDepth = explosionCenter.y - (voxel.y + 0.5);
      if (destroyDepth > this.config.eggBlastDestroyDepth || scatterCount >= this.config.eggScatterBudget) {
        continue;
      }

      const landingVoxel = this.findEggScatterLandingVoxel(explosionCenter, reservedLandingKeys);
      if (!landingVoxel) {
        continue;
      }

      reservedLandingKeys.add(`${landingVoxel.x},${landingVoxel.y},${landingVoxel.z}`);
      this.createEggScatterDebris(voxel, landingVoxel);
      scatterCount += 1;
    }

    this.eggs.delete(egg.id);
    this.invalidateEggCollection();
    this.spawnDetachedComponentsNearMutations(explodedVoxels);
  }

  private collectEggExplosionVoxels(center: Vector3) {
    const radius = this.config.eggBlastVoxelRadius;
    const radiusSquared = radius * radius;
    const candidates: VoxelCell[] = [];

    for (let x = Math.max(0, Math.floor(center.x - radius)); x <= Math.min(this.world.size.x - 1, Math.ceil(center.x + radius)); x += 1) {
      for (let y = Math.max(0, Math.floor(center.y - radius)); y <= Math.min(this.world.size.y - 1, Math.ceil(center.y + radius)); y += 1) {
        for (let z = Math.max(0, Math.floor(center.z - radius)); z <= Math.min(this.world.size.z - 1, Math.ceil(center.z + radius)); z += 1) {
          const voxel = this.world.getVoxel(x, y, z);
          if (!voxel) {
            continue;
          }

          const voxelCenter = { x: x + 0.5, y: y + 0.5, z: z + 0.5 };
          if (distanceSquared3(voxelCenter, center) > radiusSquared) {
            continue;
          }

          candidates.push({ ...voxel });
        }
      }
    }

    candidates.sort((left, right) => {
      const leftDistance = distanceSquared3(
        { x: left.x + 0.5, y: left.y + 0.5, z: left.z + 0.5 },
        center
      );
      const rightDistance = distanceSquared3(
        { x: right.x + 0.5, y: right.y + 0.5, z: right.z + 0.5 },
        center
      );
      if (leftDistance !== rightDistance) {
        return leftDistance - rightDistance;
      }

      if (left.y !== right.y) {
        return right.y - left.y;
      }

      if (left.z !== right.z) {
        return left.z - right.z;
      }

      return left.x - right.x;
    });

    return candidates;
  }

  private findEggScatterLandingVoxel(center: Vector3, reservedLandingKeys: Set<string>): Vec3i | null {
    const candidates: Vec3i[] = [];
    const maxDistance = this.config.eggScatterMaxDistance;

    for (let x = Math.max(0, Math.floor(center.x - maxDistance)); x <= Math.min(this.world.size.x - 1, Math.ceil(center.x + maxDistance)); x += 1) {
      for (let z = Math.max(0, Math.floor(center.z - maxDistance)); z <= Math.min(this.world.size.z - 1, Math.ceil(center.z + maxDistance)); z += 1) {
        const horizontalDistanceToCenter = Math.hypot(x + 0.5 - center.x, z + 0.5 - center.z);
        if (horizontalDistanceToCenter < 1 || horizontalDistanceToCenter > maxDistance) {
          continue;
        }

        const topSolidY = this.world.getTopSolidY(x, z);
        const landingY = topSolidY + 1;
        if (landingY < 0 || landingY >= this.world.size.y) {
          continue;
        }

        const landingVoxel = { x, y: landingY, z };
        const landingKey = `${landingVoxel.x},${landingVoxel.y},${landingVoxel.z}`;
        if (
          reservedLandingKeys.has(landingKey) ||
          this.world.hasSolid(landingVoxel.x, landingVoxel.y, landingVoxel.z) ||
          this.isVoxelBlockedByAnyPlayer(landingVoxel) ||
          this.isVoxelBlockedByFallingCluster(landingVoxel) ||
          this.isVoxelBlockedBySkyDrop(landingVoxel) ||
          this.isVoxelBlockedByEgg(landingVoxel) ||
          this.isVoxelBlockedByEggScatterDebris(landingVoxel)
        ) {
          continue;
        }

        candidates.push(landingVoxel);
      }
    }

    if (candidates.length === 0) {
      return null;
    }

    candidates.sort((left, right) => {
      const leftDistance = Math.hypot(left.x + 0.5 - center.x, left.z + 0.5 - center.z);
      const rightDistance = Math.hypot(right.x + 0.5 - center.x, right.z + 0.5 - center.z);
      if (leftDistance !== rightDistance) {
        return leftDistance - rightDistance;
      }

      if (left.y !== right.y) {
        return left.y - right.y;
      }

      if (left.z !== right.z) {
        return left.z - right.z;
      }

      return left.x - right.x;
    });

    const startIndex = Math.floor(this.nextRandom() * candidates.length);
    return candidates[startIndex] ?? candidates[0] ?? null;
  }

  private createEggScatterDebris(voxel: VoxelCell, landingVoxel: Vec3i) {
    const debrisId = `egg-debris-${this.nextEggScatterDebrisId}`;
    this.nextEggScatterDebrisId += 1;

    this.eggScatterDebris.set(debrisId, {
      id: debrisId,
      kind: voxel.kind,
      origin: {
        x: voxel.x + 0.5,
        y: voxel.y + 0.5,
        z: voxel.z + 0.5
      },
      destination: {
        x: landingVoxel.x + 0.5,
        y: landingVoxel.y + 0.5,
        z: landingVoxel.z + 0.5
      },
      elapsed: 0,
      duration: this.config.eggScatterFlightDuration
    });
    this.invalidateEggScatterDebrisCollection();
  }

  private createVoxelBurst(
    style: VoxelBurstStyle,
    position: Vector3,
    duration: number,
    kind: BlockKind | null
  ) {
    const burstId = `voxel-burst-${this.nextVoxelBurstId}`;
    this.nextVoxelBurstId += 1;
    this.voxelBursts.set(burstId, {
      id: burstId,
      style,
      kind,
      position: { ...position },
      elapsed: 0,
      duration
    });
  }

  private handleRingOut(player: SimPlayer, fallingOut: boolean) {
    const livesRemaining = this.removeLife(player);
    if (livesRemaining <= 0) {
      this.eliminatePlayer(player, fallingOut);
      return;
    }

    this.startRespawn(player, fallingOut);
  }

  private removeLife(player: SimPlayer) {
    player.livesRemaining = Math.max(0, player.livesRemaining - 1);
    return player.livesRemaining;
  }

  private startRespawn(player: SimPlayer, fallingOut: boolean) {
    this.stopJetpack(player);
    player.respawning = true;
    player.respawnRemaining = this.config.respawnDelay;
    player.fallingOut = fallingOut;
    player.grounded = false;
    player.jumpBufferRemaining = 0;
    player.jumpAssistRemaining = 0;
    player.jetpackHoldActivationRemaining = 0;
    player.jetpackEligible = false;
    player.jetpackOutsideBoundsGrace = false;
    player.stunRemaining = 0;
    player.pushVisualRemaining = 0;
    player.eggTauntSequence = 0;
    player.eggTauntRemaining = 0;
    player.spacePhase = "none";
    player.spacePhaseRemaining = 0;
    player.spaceTriggerArmed = true;

    if (!fallingOut) {
      player.velocity = { x: 0, y: 0, z: 0 };
    }
  }

  private updateRespawningPlayers(dt: number) {
    for (const player of this.players.values()) {
      if (!player.respawning) {
        continue;
      }

      player.respawnRemaining = Math.max(0, player.respawnRemaining - dt);
      if (player.respawnRemaining > EPSILON) {
        continue;
      }

      this.respawnPlayer(player);
    }
  }

  private respawnPlayer(player: SimPlayer) {
    const spawn = this.selectRespawnPosition(player.id);
    player.position = { ...spawn };
    player.velocity = { x: 0, y: 0, z: 0 };
    player.facing = normalize2(this.world.size.x / 2 - spawn.x, this.world.size.z / 2 - spawn.z);
    player.grounded = false;
    player.fallingOut = false;
    player.respawning = false;
    player.respawnRemaining = 0;
    player.invulnerableRemaining = this.config.respawnInvulnerableDuration;
    player.stunRemaining = 0;
    player.jumpBufferRemaining = 0;
    player.jumpAssistRemaining = 0;
    player.jetpackHoldActivationRemaining = 0;
    player.jetpackActive = false;
    player.jetpackEligible = false;
    player.jetpackOutsideBoundsGrace = false;
    player.pushVisualRemaining = 0;
    player.eggTauntSequence = 0;
    player.eggTauntRemaining = 0;
    player.spacePhase = "none";
    player.spacePhaseRemaining = 0;
    player.spaceTriggerArmed = true;
  }

  private selectRespawnPosition(playerId: string): Vector3 {
    const fallback = {
      x: this.world.size.x / 2 + 0.5,
      y: this.world.getTopSolidY(Math.floor(this.world.size.x / 2), Math.floor(this.world.size.z / 2)) + 1.05,
      z: this.world.size.z / 2 + 0.5
    };
    const spawns = this.spawnCandidates.length > 0 ? this.spawnCandidates : [fallback];
    if (spawns.length === 0) {
      return fallback;
    }

    const opponents = [...this.players.values()].filter((player) => player.id !== playerId && player.alive && !player.respawning);
    const minimumSeparation = this.config.playerRadius * 2 + this.config.playerHitSeparationDistance;
    let bestSpawn = { x: spawns[0]!.x, y: spawns[0]!.y, z: spawns[0]!.z };
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const spawn of spawns) {
      if (!this.canPlayerFitAt(spawn)) {
        continue;
      }

      const overlapsOpponent = opponents.some((opponent) =>
        Math.hypot(opponent.position.x - spawn.x, opponent.position.z - spawn.z) < minimumSeparation
      );
      if (overlapsOpponent) {
        continue;
      }

      const nearestOpponentDistance =
        opponents.length === 0
          ? Number.POSITIVE_INFINITY
          : Math.min(...opponents.map((opponent) => Math.hypot(opponent.position.x - spawn.x, opponent.position.z - spawn.z)));
      const edgeDistance = this.getEdgePressure(spawn).distance;
      const spawnScore = nearestOpponentDistance + edgeDistance * 0.4;
      if (spawnScore > bestScore) {
        bestScore = spawnScore;
        bestSpawn = {
          x: spawn.x,
          y: spawn.y,
          z: spawn.z
        };
      }
    }

    return bestSpawn;
  }

  private updateFallingClusters(dt: number) {
    const activeClusters = [...this.fallingClusters.values()].sort((left, right) => left.id.localeCompare(right.id));

    for (const cluster of activeClusters) {
      if (!this.fallingClusters.has(cluster.id)) {
        continue;
      }

      if (cluster.phase === "warning") {
        cluster.warningRemaining = Math.max(0, cluster.warningRemaining - dt);
        if (cluster.warningRemaining <= EPSILON) {
          cluster.phase = "falling";
          cluster.warningRemaining = 0;
        }
        continue;
      }

      cluster.velocityY -= this.config.collapseGravity * dt;
      const landingDropDistance = this.getCachedClusterLandingDropDistance(cluster);
      const landingOffsetY = cluster.cachedLandingOffsetY ?? -landingDropDistance;
      const proposedOffsetY = cluster.offsetY + cluster.velocityY * dt;
      cluster.offsetY = Math.max(proposedOffsetY, landingOffsetY);

      this.applyCollapseDamage(cluster);

      if (cluster.offsetY <= landingOffsetY + EPSILON) {
        const landingStart = now();
        this.landFallingCluster(cluster, landingDropDistance);
        this.recordPerformanceDiagnostic("fallingClusterLandingMs", landingStart);
      }
    }
  }

  private updateSkyDrops(dt: number) {
    const updateStart = now();
    if (this.mode !== "explore" && this.mode !== "playNpc") {
      return;
    }

    this.skyDropCooldown -= dt;
    if (this.skyDropCooldown <= 0 && this.skyDrops.size < this.config.maxActiveSkyDrops) {
      const skyDrop = this.trySpawnSkyDrop();
      this.skyDropCooldown = skyDrop ? this.nextSkyDropInterval() : Math.min(0.8, this.config.skyDropIntervalMin);
    }

    const activeSkyDrops = [...this.skyDrops.values()].sort((left, right) => left.id.localeCompare(right.id));
    for (const skyDrop of activeSkyDrops) {
      if (!this.skyDrops.has(skyDrop.id)) {
        continue;
      }

      if (skyDrop.phase === "warning") {
        skyDrop.warningRemaining = Math.max(0, skyDrop.warningRemaining - dt);
        if (skyDrop.warningRemaining <= EPSILON) {
          skyDrop.phase = "falling";
          skyDrop.warningRemaining = 0;
        }
        continue;
      }

      skyDrop.velocityY -= this.config.skyDropGravity * dt;
      const proposedOffsetY = skyDrop.offsetY + skyDrop.velocityY * dt;
      skyDrop.offsetY = Math.max(proposedOffsetY, 0);
      this.applySkyDropDamage(skyDrop);

      if (skyDrop.offsetY <= EPSILON) {
        const landingStart = now();
        this.landSkyDrop(skyDrop);
        this.recordPerformanceDiagnostic("skyDropLandingMs", landingStart);
      }
    }

    this.recordPerformanceDiagnostic("skyDropUpdateMs", updateStart);
  }

  private resolvePlayerCollisions(iterations = 2) {
    const alivePlayers = [...this.players.values()].filter((player) => player.alive && !player.respawning);
    const minimumDistance = this.config.playerRadius * 2;

    for (let iteration = 0; iteration < iterations; iteration += 1) {
      let changed = false;

      for (let leftIndex = 0; leftIndex < alivePlayers.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < alivePlayers.length; rightIndex += 1) {
          changed =
            this.resolvePlayerPairCollision(alivePlayers[leftIndex]!, alivePlayers[rightIndex]!, minimumDistance) ||
            changed;
        }
      }

      if (!changed) {
        break;
      }
    }
  }

  private resolvePlayerPairCollision(left: SimPlayer, right: SimPlayer, minimumDistance: number) {
    const deltaX = right.position.x - left.position.x;
    const deltaZ = right.position.z - left.position.z;
    const distanceSquared = deltaX * deltaX + deltaZ * deltaZ;

    if (distanceSquared >= minimumDistance * minimumDistance - EPSILON) {
      return false;
    }

    const distance = Math.sqrt(distanceSquared);
    const normal =
      distance <= EPSILON
        ? {
            x: left.id.localeCompare(right.id) <= 0 ? 1 : -1,
            z: 0
          }
        : {
            x: deltaX / distance,
            z: deltaZ / distance
          };
    const overlap = minimumDistance - Math.max(distance, EPSILON);
    const separation = overlap / 2 + EPSILON;

    left.position.x -= normal.x * separation;
    left.position.z -= normal.z * separation;
    right.position.x += normal.x * separation;
    right.position.z += normal.z * separation;

    this.removeInwardHorizontalVelocity(left, normal.x, normal.z, 1);
    this.removeInwardHorizontalVelocity(right, normal.x, normal.z, -1);
    return true;
  }

  private removeInwardHorizontalVelocity(player: SimPlayer, normalX: number, normalZ: number, direction: 1 | -1) {
    const velocityAlongNormal = (player.velocity.x * normalX + player.velocity.z * normalZ) * direction;
    if (velocityAlongNormal <= 0) {
      return;
    }

    player.velocity.x -= normalX * velocityAlongNormal * direction;
    player.velocity.z -= normalZ * velocityAlongNormal * direction;
  }

  private spawnDetachedComponentsNearMutations(mutatedVoxels: Iterable<Pick<VoxelCell, "x" | "y" | "z">>) {
    const mutations = [...mutatedVoxels].map((voxel) => ({
      x: voxel.x,
      y: voxel.y,
      z: voxel.z
    }));
    if (mutations.length === 0) {
      return;
    }

    const collectionStart = now();
    const detachedComponents = this.world.collectDetachedComponentsNear(mutations);
    this.recordPerformanceDiagnostic("detachedComponentMs", collectionStart);
    if (detachedComponents.length === 0) {
      return;
    }

    this.addDirtyChunkKeys(this.world.removeVoxels(detachedComponents.flatMap((component) => component.voxels)));
    this.invalidateFallingClusterLandingCacheForMutations(detachedComponents.flatMap((component) => component.voxels));

    for (const component of detachedComponents) {
      const cluster = this.createFallingCluster(component);
      this.fallingClusters.set(cluster.id, cluster);
    }

    this.invalidateFallingClusterCollection();
  }

  private createFallingCluster(component: DetachedVoxelComponent): SimFallingCluster {
    const clusterId = `collapse-${this.nextFallingClusterId}`;
    this.nextFallingClusterId += 1;
    const voxels = component.voxels.map((voxel) => ({ ...voxel }));
    const footprint = this.getClusterFootprint(voxels);

    return {
      id: clusterId,
      phase: "warning",
      warningRemaining: this.config.collapseWarningDuration,
      voxels,
      offsetY: 0,
      velocityY: 0,
      damagedPlayerIds: new Set(),
      cachedLandingDropDistance: null,
      cachedLandingOffsetY: null,
      footprintMinX: footprint.minX,
      footprintMaxX: footprint.maxX,
      footprintMinZ: footprint.minZ,
      footprintMaxZ: footprint.maxZ
    };
  }

  private landFallingCluster(cluster: SimFallingCluster, dropDistance: number) {
    this.applyCollapseDamage(cluster);
    const settledVoxels = cluster.voxels.map((voxel) => ({
      x: voxel.x,
      y: voxel.y - dropDistance,
      z: voxel.z,
      kind: voxel.kind
    }));

    this.addDirtyChunkKeys(this.world.setVoxels(settledVoxels));
    this.invalidateFallingClusterLandingCacheForMutations(settledVoxels);

    this.fallingClusters.delete(cluster.id);
    this.invalidateFallingClusterCollection();
  }

  private applyCollapseDamage(cluster: SimFallingCluster) {
    for (const player of this.players.values()) {
      if (!player.alive || player.respawning || cluster.damagedPlayerIds.has(player.id)) {
        continue;
      }

      const overlapTopY = this.getClusterOverlapTopY(cluster, player);
      if (overlapTopY === null) {
        continue;
      }

      const center = this.getClusterCenter(cluster);
      if (this.applyPlayerHit(player, center, {
        knockback: this.config.eggBlastKnockback,
        lift: this.config.eggBlastLift,
        stunDuration: this.config.eggBlastStunDuration,
        overlapTopY
      })) {
        cluster.damagedPlayerIds.add(player.id);
      }
    }
  }

  private trySpawnSkyDrop() {
    const target = this.selectSkyDropTarget();
    if (!target) {
      return null;
    }

    const skyDrop: SimSkyDrop = {
      id: `sky-${this.nextSkyDropId}`,
      phase: "warning",
      warningRemaining: this.config.skyDropWarningDuration,
      landingVoxel: target,
      offsetY: this.config.skyDropSpawnHeight,
      velocityY: 0,
      damagedPlayerIds: new Set()
    };
    this.nextSkyDropId += 1;
    this.skyDrops.set(skyDrop.id, skyDrop);
    this.invalidateSkyDropCollection();
    return skyDrop;
  }

  private selectSkyDropTarget(): Vec3i | null {
    const alivePlayers = [...this.players.values()]
      .filter((player) => player.alive && !player.respawning)
      .sort((left, right) => left.id.localeCompare(right.id));

    if (alivePlayers.length === 0) {
      return null;
    }

    const startIndex = Math.floor(this.nextRandom() * alivePlayers.length);
    for (let attempt = 0; attempt < alivePlayers.length; attempt += 1) {
      const player = alivePlayers[(startIndex + attempt) % alivePlayers.length]!;
      const candidates = this.findSkyDropCandidatesNearPlayer(player);
      if (candidates.length === 0) {
        continue;
      }

      return candidates[Math.floor(this.nextRandom() * candidates.length)] ?? null;
    }

    return null;
  }

  private findSkyDropCandidatesNearPlayer(player: SimPlayer): Vec3i[] {
    const centerX = Math.floor(player.position.x);
    const centerZ = Math.floor(player.position.z);
    const candidates: Vec3i[] = [];
    const seen = new Set<string>();

    for (let x = Math.max(0, centerX - this.config.skyDropSpawnRadius); x <= Math.min(this.world.size.x - 1, centerX + this.config.skyDropSpawnRadius); x += 1) {
      for (let z = Math.max(0, centerZ - this.config.skyDropSpawnRadius); z <= Math.min(this.world.size.z - 1, centerZ + this.config.skyDropSpawnRadius); z += 1) {
        if (Math.hypot(x + 0.5 - player.position.x, z + 0.5 - player.position.z) > this.config.skyDropSpawnRadius) {
          continue;
        }

        const topSolidY = this.world.getTopSolidY(x, z);
        if (topSolidY < 0 || this.world.getVoxelKind(x, topSolidY, z) !== "ground") {
          continue;
        }

        const landingY = topSolidY + 1;
        if (landingY >= this.world.size.y) {
          continue;
        }

        if (this.world.hasSolid(x, landingY, z)) {
          continue;
        }

        const key = `${x},${landingY},${z}`;
        if (
          seen.has(key) ||
          this.isVoxelBlockedByFallingCluster({ x, y: landingY, z }) ||
          this.isVoxelBlockedByEgg({ x, y: landingY, z }) ||
          this.isVoxelBlockedByEggScatterDebris({ x, y: landingY, z }) ||
          this.isSkyDropTargetOccupied(x, landingY, z)
        ) {
          continue;
        }

        seen.add(key);
        candidates.push({ x, y: landingY, z });
      }
    }

    return candidates;
  }

  private isSkyDropTargetOccupied(x: number, y: number, z: number) {
    return [...this.skyDrops.values()].some((skyDrop) =>
      skyDrop.landingVoxel.x === x &&
      skyDrop.landingVoxel.y === y &&
      skyDrop.landingVoxel.z === z
    );
  }

  private applySkyDropDamage(skyDrop: SimSkyDrop) {
    for (const player of this.players.values()) {
      if (!player.alive || player.respawning || skyDrop.damagedPlayerIds.has(player.id)) {
        continue;
      }

      const overlapTopY = this.getSkyDropOverlapTopY(skyDrop, player);
      if (overlapTopY === null) {
        continue;
      }

      if (this.applyPlayerHit(player, this.getSkyDropCenter(skyDrop), {
        knockback: this.config.eggBlastKnockback,
        lift: this.config.eggBlastLift,
        stunDuration: this.config.eggBlastStunDuration,
        overlapTopY
      })) {
        skyDrop.damagedPlayerIds.add(player.id);
      }
    }
  }

  private landSkyDrop(skyDrop: SimSkyDrop) {
    this.applySkyDropDamage(skyDrop);
    const landedVoxel = {
      x: skyDrop.landingVoxel.x,
      y: skyDrop.landingVoxel.y,
      z: skyDrop.landingVoxel.z,
      kind: "ground" as const
    };

    this.addDirtyChunkKeys(this.world.setVoxels([landedVoxel]));
    this.invalidateFallingClusterLandingCacheForMutations([landedVoxel]);

    this.skyDrops.delete(skyDrop.id);
    this.invalidateSkyDropCollection();
  }

  private getClusterCenter(cluster: SimFallingCluster): Vector3 {
    const total = cluster.voxels.reduce(
      (sum, voxel) => ({
        x: sum.x + voxel.x + 0.5,
        y: sum.y + voxel.y + 0.5 + cluster.offsetY,
        z: sum.z + voxel.z + 0.5
      }),
      { x: 0, y: 0, z: 0 }
    );
    const count = Math.max(1, cluster.voxels.length);

    return {
      x: total.x / count,
      y: total.y / count,
      z: total.z / count
    };
  }

  private addDirtyChunkKeys(chunkKeys: Iterable<string>) {
    for (const chunkKey of chunkKeys) {
      this.dirtyChunkKeys.add(chunkKey);
    }
  }

  private getClusterFootprint(voxels: Iterable<Pick<VoxelCell, "x" | "z">>) {
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;

    for (const voxel of voxels) {
      minX = Math.min(minX, voxel.x);
      maxX = Math.max(maxX, voxel.x);
      minZ = Math.min(minZ, voxel.z);
      maxZ = Math.max(maxZ, voxel.z);
    }

    return {
      minX: Number.isFinite(minX) ? minX : 0,
      maxX: Number.isFinite(maxX) ? maxX : 0,
      minZ: Number.isFinite(minZ) ? minZ : 0,
      maxZ: Number.isFinite(maxZ) ? maxZ : 0
    };
  }

  private refreshClusterLandingCache(cluster: SimFallingCluster) {
    const landingDropDistance = this.world.getComponentDropDistance(cluster.voxels);
    cluster.cachedLandingDropDistance = landingDropDistance;
    cluster.cachedLandingOffsetY = -landingDropDistance;
    return landingDropDistance;
  }

  private getCachedClusterLandingDropDistance(cluster: SimFallingCluster) {
    if (cluster.cachedLandingDropDistance === null) {
      return this.refreshClusterLandingCache(cluster);
    }

    return cluster.cachedLandingDropDistance;
  }

  private invalidateFallingClusterLandingCacheForMutations(mutatedVoxels: Iterable<Pick<VoxelCell, "x" | "z">>) {
    const mutations = [...mutatedVoxels];
    if (mutations.length === 0 || this.fallingClusters.size === 0) {
      return;
    }

    for (const cluster of this.fallingClusters.values()) {
      if (cluster.phase !== "falling") {
        continue;
      }

      const overlapsMutation = mutations.some(
        (voxel) =>
          voxel.x >= cluster.footprintMinX &&
          voxel.x <= cluster.footprintMaxX &&
          voxel.z >= cluster.footprintMinZ &&
          voxel.z <= cluster.footprintMaxZ
      );
      if (!overlapsMutation) {
        continue;
      }

      cluster.cachedLandingDropDistance = null;
      cluster.cachedLandingOffsetY = null;
    }
  }

  private recordPerformanceDiagnostic(
    key: keyof SimulationPerformanceDiagnostics,
    startTimeMs: number
  ) {
    this.performanceDiagnostics[key] = Math.max(this.performanceDiagnostics[key], now() - startTimeMs);
  }

  private getSkyDropCenter(skyDrop: SimSkyDrop): Vector3 {
    return {
      x: skyDrop.landingVoxel.x + 0.5,
      y: skyDrop.landingVoxel.y + 0.5 + skyDrop.offsetY,
      z: skyDrop.landingVoxel.z + 0.5
    };
  }

  private getClusterOverlapTopY(cluster: SimFallingCluster, player: SimPlayer) {
    const playerBottomY = player.position.y;
    const playerTopY = player.position.y + this.config.playerHeight;
    let overlapTopY: number | null = null;

    for (const voxel of cluster.voxels) {
      const voxelMinY = voxel.y + cluster.offsetY;
      const voxelMaxY = voxelMinY + 1;
      if (playerTopY <= voxelMinY + EPSILON || playerBottomY >= voxelMaxY - EPSILON) {
        continue;
      }

      const closestX = clamp(player.position.x, voxel.x, voxel.x + 1);
      const closestZ = clamp(player.position.z, voxel.z, voxel.z + 1);
      const deltaX = player.position.x - closestX;
      const deltaZ = player.position.z - closestZ;
      if (deltaX * deltaX + deltaZ * deltaZ > this.config.playerRadius * this.config.playerRadius) {
        continue;
      }

      overlapTopY = Math.max(overlapTopY ?? voxelMaxY, voxelMaxY);
    }

    return overlapTopY;
  }

  private getSkyDropOverlapTopY(skyDrop: SimSkyDrop, player: SimPlayer) {
    const voxelMinY = skyDrop.landingVoxel.y + skyDrop.offsetY;
    const voxelMaxY = voxelMinY + 1;
    const playerBottomY = player.position.y;
    const playerTopY = player.position.y + this.config.playerHeight;

    if (playerTopY <= voxelMinY + EPSILON || playerBottomY >= voxelMaxY - EPSILON) {
      return null;
    }

    const closestX = clamp(player.position.x, skyDrop.landingVoxel.x, skyDrop.landingVoxel.x + 1);
    const closestZ = clamp(player.position.z, skyDrop.landingVoxel.z, skyDrop.landingVoxel.z + 1);
    const deltaX = player.position.x - closestX;
    const deltaZ = player.position.z - closestZ;
    if (deltaX * deltaX + deltaZ * deltaZ > this.config.playerRadius * this.config.playerRadius) {
      return null;
    }

    return voxelMaxY;
  }

  private applyPlayerHit(
    player: SimPlayer,
    impactCenter: Vector3,
    options: {
      knockback: number;
      lift: number;
      stunDuration: number;
      overlapTopY?: number | null;
    }
  ) {
    if (!player.alive || player.respawning || player.invulnerableRemaining > EPSILON) {
      return false;
    }

    const away = normalize2(player.position.x - impactCenter.x, player.position.z - impactCenter.z);
    const direction =
      length2(away.x, away.z) <= EPSILON
        ? {
            x: Math.sin(hashString(`${player.id}:${this.tick}`) % 360 * (Math.PI / 180)),
            z: Math.cos(hashString(`${player.id}:${this.tick}`) % 360 * (Math.PI / 180))
          }
        : away;

    this.stopJetpack(player);
    player.jetpackEligible = false;
    player.velocity.y = Math.max(player.velocity.y, options.lift);
    player.velocity.x += direction.x * options.knockback;
    player.velocity.z += direction.z * options.knockback;
    player.position.x += direction.x * this.config.playerHitSeparationDistance;
    player.position.z += direction.z * this.config.playerHitSeparationDistance;
    if (options.overlapTopY !== undefined && options.overlapTopY !== null) {
      player.position.y = Math.max(player.position.y, options.overlapTopY + this.config.playerHitSurfaceClearance);
    }
    player.grounded = false;
    player.stunRemaining = Math.max(player.stunRemaining, options.stunDuration);

    if (this.removeLife(player) <= 0) {
      this.eliminatePlayer(player, false);
    }

    return true;
  }

  private generateNpcCommand(
    player: SimPlayer,
    dt = 1 / this.config.tickRate,
    targetCommitments: Map<string, number> = new Map()
  ): PlayerCommand {
    const memory = this.npcMemories.get(player.id);
    if (!memory) {
      return cloneCommand();
    }

    memory.intentRemaining = Math.max(0, memory.intentRemaining - dt);
    memory.targetLockRemaining = Math.max(0, memory.targetLockRemaining - dt);
    memory.jumpHoldRemaining = Math.max(0, memory.jumpHoldRemaining - dt);

    const buriedProbe = this.createNpcBuriedProbe(player);
    if (buriedProbe.buried) {
      return this.generateBuriedRecoveryCommand(player, memory, buriedProbe);
    }

    const center = {
      x: this.world.size.x / 2,
      z: this.world.size.z / 2
    };
    const selfEdge = this.getEdgePressure(player.position);
    const targetPlan = this.selectNpcTarget(player, memory, targetCommitments);
    const target = targetPlan.target;
    const lowMatterThreshold =
      memory.archetype === "forager"
        ? this.config.placeCost + 8
        : this.config.pushCost + 8;
    const lowMatter = player.mass < lowMatterThreshold;
    const needRecovery = selfEdge.distance < 2.4;
    const desiredCenterMove = normalize2(center.x - player.position.x, center.z - player.position.z);

    let moveGoalX = center.x;
    let moveGoalZ = center.z;
    let desiredLook = desiredCenterMove;
    let desiredIntent: NpcIntent = needRecovery ? "recover" : "pressure";

    if (target) {
      const pushAnchorDistance = Math.max(0.9, this.config.pushRange * 0.75);
      const pressureAnchor =
        targetPlan.edgeDistance < 5
          ? {
              x: target.position.x - targetPlan.edgeDirection.x * pushAnchorDistance,
              z: target.position.z - targetPlan.edgeDirection.z * pushAnchorDistance
            }
          : {
              x: target.position.x,
              z: target.position.z
            };
      moveGoalX = pressureAnchor.x;
      moveGoalZ = pressureAnchor.z;
      desiredLook =
        targetPlan.edgeDistance < 4
          ? targetPlan.edgeDirection
          : normalize2(target.position.x - player.position.x, target.position.z - player.position.z);
    }

    if (needRecovery) {
      moveGoalX = center.x;
      moveGoalZ = center.z;
      desiredLook = desiredCenterMove;
    }

    let move = normalize2(moveGoalX - player.position.x, moveGoalZ - player.position.z);
    if (length2(move.x, move.z) <= EPSILON) {
      move = target
        ? normalize2(target.position.x - player.position.x, target.position.z - player.position.z)
        : desiredCenterMove;
    }

    const probe = this.createNpcPathProbe(player, move, needRecovery ? desiredCenterMove : desiredLook);
    const buildPlan =
      player.mass >= this.config.placeCost + Math.min(this.config.pushCost, this.config.eggCost) * 0.75
        ? this.findNpcPlacementPlan(player, probe)
        : null;
    const supportDestroyTarget = target ? this.findSupportCollapseTarget(player, target) : null;
    const harvestTarget =
      this.findDestroyTarget(
        player,
        target ? normalize2(target.position.x - player.position.x, target.position.z - player.position.z) : move,
        {
          supportCollapseTarget: supportDestroyTarget,
          allowGroundFallback: lowMatter || probe.blockedAhead || probe.tallStepAhead || needRecovery,
          allowSelfSupport: false
        }
      );
    const eggPlan = target
      ? this.getNpcEggPlan(player, target, targetPlan.edgeDistance)
      : null;
    const pushReady = target
      ? this.isNpcPushReady(player, target, targetPlan.edgeDirection, targetPlan.edgeDistance)
      : false;
    const shouldBridge =
      buildPlan !== null &&
      (needRecovery || probe.shortGapAhead || (probe.frontTopSolidY < 0 && player.mass >= this.config.placeCost + 4));
    const shouldHarvest =
      harvestTarget !== null &&
      (
        supportDestroyTarget !== null ||
        lowMatter ||
        probe.blockedAhead ||
        (memory.intent === "harvest" && memory.intentRemaining > EPSILON)
      );

    let jump = memory.jumpHoldRemaining > EPSILON && !player.grounded;
    let jumpPressed = false;
    let place = false;
    let destroy = false;
    let push = false;
    let layEgg = false;
    let targetVoxel: Vec3i | null = null;
    let targetNormal: Vec3i | null = null;
    let eggCharge = 0;
    let eggPitch = 0;

    if (
      player.grounded &&
      (probe.obstacleAhead || probe.shortGapAhead || probe.tallStepAhead) &&
      !shouldBridge
    ) {
      jump = true;
      jumpPressed = true;
      if (probe.shortGapAhead || probe.tallStepAhead) {
        memory.jumpHoldRemaining = 0.22;
      }
    }

    if (shouldBridge && buildPlan) {
      desiredIntent = needRecovery ? "recover" : "build";
      place = true;
      targetVoxel = buildPlan.targetVoxel;
      targetNormal = buildPlan.targetNormal;
    } else if (shouldHarvest) {
      desiredIntent = "harvest";
      destroy = true;
      targetVoxel = harvestTarget;
      if (supportDestroyTarget && target && harvestTarget && this.isSameVoxel(harvestTarget, supportDestroyTarget)) {
        move = normalize2(target.position.x - player.position.x, target.position.z - player.position.z);
      }
    } else if (pushReady && target) {
      desiredIntent = "pressure";
      move =
        horizontalDistance(player, target) <= this.config.pushRange * 0.9
          ? { x: 0, z: 0 }
          : normalize2(moveGoalX - player.position.x, moveGoalZ - player.position.z);
      desiredLook = targetPlan.edgeDirection;
      push = true;
    } else if (eggPlan) {
      desiredIntent = "egg";
      desiredLook = normalize2(target!.position.x - player.position.x, target!.position.z - player.position.z);
      layEgg = true;
      eggCharge = eggPlan.charge;
      eggPitch = eggPlan.pitch;
    } else if (needRecovery) {
      desiredIntent = "recover";
      move = desiredCenterMove;
      desiredLook = desiredCenterMove;
    }

    if (
      memory.intent === "build" &&
      memory.intentRemaining > EPSILON &&
      buildPlan &&
      !place &&
      !destroy &&
      !push &&
      !layEgg
    ) {
      place = true;
      desiredIntent = "build";
      targetVoxel = buildPlan.targetVoxel;
      targetNormal = buildPlan.targetNormal;
    }

    if (length2(move.x, move.z) <= EPSILON) {
      move = desiredLook;
    }

    if (length2(desiredLook.x, desiredLook.z) <= EPSILON) {
      desiredLook = move;
    }

    memory.intent = desiredIntent;
    memory.intentRemaining =
      desiredIntent === "pressure"
        ? 0.18
        : desiredIntent === "egg"
          ? 0.24
          : 0.3;

    return {
      moveX: move.x,
      moveZ: move.z,
      lookX: desiredLook.x !== 0 || desiredLook.z !== 0 ? desiredLook.x : player.facing.x,
      lookZ: desiredLook.x !== 0 || desiredLook.z !== 0 ? desiredLook.z : player.facing.z,
      eggCharge,
      eggPitch,
      jump,
      jumpPressed,
      jumpReleased: false,
      destroy,
      place,
      push,
      layEgg,
      targetVoxel,
      targetNormal
    };
  }

  private getEdgePressure(position: Vector3) {
    const distances = [
      { distance: position.x, direction: { x: -1, z: 0 } },
      { distance: this.world.size.x - position.x, direction: { x: 1, z: 0 } },
      { distance: position.z, direction: { x: 0, z: -1 } },
      { distance: this.world.size.z - position.z, direction: { x: 0, z: 1 } }
    ];

    distances.sort((left, right) => left.distance - right.distance);
    return distances[0]!;
  }

  private selectNpcTarget(
    player: SimPlayer,
    memory: NpcMemory,
    targetCommitments: Map<string, number>
  ): NpcTargetPlan {
    const currentTarget =
      memory.targetPlayerId !== null ? this.players.get(memory.targetPlayerId) ?? null : null;
    const currentTargetValid =
      currentTarget &&
      currentTarget.alive &&
      !currentTarget.respawning &&
      currentTarget.id !== player.id;

    if (currentTargetValid && memory.targetLockRemaining > EPSILON) {
      const currentEdge = this.getEdgePressure(currentTarget.position);
      const currentCommitments = targetCommitments.get(currentTarget.id) ?? 0;
      const shouldBreakFocus =
        currentTarget.id === this.localPlayerId &&
        currentCommitments >= 3 &&
        currentEdge.distance > 2.2 &&
        horizontalDistance(player, currentTarget) > this.config.pushRange * 0.95;

      if (!shouldBreakFocus) {
        return {
          target: currentTarget,
          score: Number.POSITIVE_INFINITY,
          edgeDirection: currentEdge.direction,
          edgeDistance: currentEdge.distance
        };
      }
    }

    let bestPlan: NpcTargetPlan = {
      target: null,
      score: Number.NEGATIVE_INFINITY,
      edgeDirection: { x: 0, z: 0 },
      edgeDistance: Number.POSITIVE_INFINITY
    };

    for (const candidate of this.players.values()) {
      if (!candidate.alive || candidate.respawning || candidate.id === player.id) {
        continue;
      }

      const edge = this.getEdgePressure(candidate.position);
      const distance = horizontalDistance(player, candidate);
      const targetAlignment = normalize2(
        candidate.position.x - player.position.x,
        candidate.position.z - player.position.z
      );
      const canPressureWithPush =
        distance <= this.config.pushRange * 1.25 && edge.distance < 5;
      const canPressureWithEgg =
        distance >= 4.5 &&
        distance <= 12 &&
        player.mass >= this.config.eggCost &&
        this.getActiveEggCountForOwner(player.id) < this.config.maxActiveEggsPerPlayer;

      let score = -distance * 1.8;
      score += Math.max(0, 6 - edge.distance) * 2.4;
      score += candidate.stunRemaining > EPSILON ? 3.4 : 0;
      score += player.position.y - candidate.position.y > 1 ? 1.25 : 0;
      score += canPressureWithPush ? 3.5 : 0;
      score += canPressureWithEgg ? 1.5 : 0;

      if (candidate.id === this.localPlayerId) {
        score += memory.archetype === "hunter" ? 3.75 : memory.archetype === "opportunist" ? 1.4 : 0.8;
      } else if (memory.archetype === "opportunist" && edge.distance < 4) {
        score += 1.2;
      }

      if (memory.archetype === "forager" && player.mass < this.config.placeCost + 6) {
        score -= distance * 0.25;
      }

      score -= (targetCommitments.get(candidate.id) ?? 0) * (candidate.id === this.localPlayerId ? 4.8 : 2.35);
      if (candidate.id === memory.targetPlayerId) {
        score += 2.2;
      }
      if (candidate.id === this.localPlayerId && (targetCommitments.get(candidate.id) ?? 0) >= 3 && edge.distance > 2.2) {
        score -= 18;
      }
      if (length2(targetAlignment.x, targetAlignment.z) <= EPSILON) {
        score -= 3;
      }

      if (score <= bestPlan.score) {
        continue;
      }

      bestPlan = {
        target: candidate,
        score,
        edgeDirection: edge.direction,
        edgeDistance: edge.distance
      };
    }

    memory.targetPlayerId = bestPlan.target?.id ?? null;
    memory.targetLockRemaining = bestPlan.target ? (bestPlan.target.id === this.localPlayerId ? 0.45 : 0.65) : 0;
    return bestPlan;
  }

  private isSameVoxel(left: Vec3i, right: Vec3i) {
    return left.x === right.x && left.y === right.y && left.z === right.z;
  }

  private createNpcBuriedProbe(player: SimPlayer): NpcBuriedProbe {
    const cellX = Math.floor(player.position.x);
    const cellZ = Math.floor(player.position.z);
    const supportY = Math.floor(player.position.y - 0.1);
    const chestY = Math.floor(player.position.y + this.config.playerHeight * 0.5);
    const headY = Math.floor(player.position.y + this.config.playerHeight - 0.2);
    const topGroundY = this.world.getTopGroundY(cellX, cellZ);
    const feetBelowGround = topGroundY >= 0 && player.position.y < topGroundY + 0.9;
    let nearbyTopGroundY = topGroundY;
    for (const direction of [
      { x: 1, y: 0, z: 0 },
      { x: -1, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 0, y: 0, z: -1 }
    ] as const) {
      nearbyTopGroundY = Math.max(
        nearbyTopGroundY,
        this.world.getTopGroundY(cellX + direction.x, cellZ + direction.z)
      );
    }

    const belowNearbySurface = nearbyTopGroundY >= 0 && player.position.y < nearbyTopGroundY + 0.85;
    const embeddedByTerrain =
      this.world.hasSolid(cellX, chestY, cellZ) ||
      this.world.hasSolid(cellX, headY, cellZ);
    const exitTarget = this.findNpcRecoveryExit(player);
    const moveDirection =
      exitTarget
        ? normalize2(exitTarget.x - player.position.x, exitTarget.z - player.position.z)
        : normalize2(this.world.size.x / 2 - player.position.x, this.world.size.z / 2 - player.position.z);
    const exitCardinal =
      length2(moveDirection.x, moveDirection.z) > EPSILON
        ? this.toCardinalDirection(moveDirection)
        : this.toCardinalDirection(player.facing);
    const headBlockedVoxel = this.findNpcRecoveryBlockedVoxel(player, { x: 0, y: 0, z: 0 }, [headY, headY + 1, chestY]);
    const sideBlockedVoxel = this.findNpcRecoveryBlockedVoxel(
      player,
      exitCardinal,
      [Math.max(supportY + 2, chestY), headY, headY + 1]
    );
    const floorBlockedVoxel =
      exitTarget === null
        ? this.findNpcRecoveryBlockedVoxel(player, exitCardinal, [supportY], true)
        : null;
    return {
      buried:
        embeddedByTerrain ||
        feetBelowGround ||
        belowNearbySurface,
      exitTarget,
      moveDirection,
      exitCardinal,
      headBlockedVoxel,
      sideBlockedVoxel,
      floorBlockedVoxel,
      headroomOpen:
        headBlockedVoxel === null &&
        !this.world.hasSolid(cellX, chestY, cellZ) &&
        !this.world.hasSolid(cellX, headY, cellZ)
    };
  }

  private findNpcRecoveryExit(player: SimPlayer): Vector3 | null {
    const originCellX = Math.floor(player.position.x);
    const originCellZ = Math.floor(player.position.z);
    let bestTarget: Vector3 | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let radius = 0; radius <= 5; radius += 1) {
      for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
        for (let offsetZ = -radius; offsetZ <= radius; offsetZ += 1) {
          if (radius > 0 && Math.max(Math.abs(offsetX), Math.abs(offsetZ)) !== radius) {
            continue;
          }

          const cellX = originCellX + offsetX;
          const cellZ = originCellZ + offsetZ;
          if (!isInBounds(this.world.size, cellX, 0, cellZ)) {
            continue;
          }

          const topSolidY = this.world.getTopSolidY(cellX, cellZ);
          if (topSolidY < 0) {
            continue;
          }

          const candidate = {
            x: cellX + 0.5,
            y: topSolidY + 1.05,
            z: cellZ + 0.5
          };
          if (candidate.y <= player.position.y + 0.1) {
            continue;
          }

          if (!this.canPlayerFitAt(candidate)) {
            continue;
          }

          const horizontal = Math.hypot(candidate.x - player.position.x, candidate.z - player.position.z);
          const verticalGain = Math.max(0, candidate.y - player.position.y);
          const score = horizontal + verticalGain * 0.45 - (this.world.getTopGroundY(cellX, cellZ) === topSolidY ? 0.15 : 0);
          if (score >= bestScore - EPSILON) {
            continue;
          }

          bestScore = score;
          bestTarget = candidate;
        }
      }
    }

    return bestTarget;
  }

  private findNpcRecoveryBlockedVoxel(
    player: SimPlayer,
    direction: Vec3i,
    yLevels: number[],
    allowFloorTarget = false
  ): Vec3i | null {
    const baseX = Math.floor(player.position.x) + direction.x;
    const baseZ = Math.floor(player.position.z) + direction.z;

    for (const y of yLevels) {
      const candidate = { x: baseX, y, z: baseZ };
      const kind = this.world.getVoxelKind(candidate.x, candidate.y, candidate.z);
      if (!kind || !this.isHarvestable(kind) || !this.isTargetInInteractRange(player, candidate)) {
        continue;
      }

      if (!allowFloorTarget && this.isNpcDirectSupportVoxel(player, candidate)) {
        continue;
      }

      return candidate;
    }

    return null;
  }

  private generateBuriedRecoveryCommand(player: SimPlayer, memory: NpcMemory, buriedProbe: NpcBuriedProbe): PlayerCommand {
    let move =
      length2(buriedProbe.moveDirection.x, buriedProbe.moveDirection.z) > EPSILON
        ? buriedProbe.moveDirection
        : normalize2(this.world.size.x / 2 - player.position.x, this.world.size.z / 2 - player.position.z);
    let desiredLook = move;
    const pathProbe = this.createNpcPathProbe(player, move, desiredLook);
    const buildPlan =
      player.mass >= this.config.placeCost + 2
        ? this.findNpcPlacementPlan(player, pathProbe)
        : null;
    const recoveryDestroyTarget =
      buriedProbe.headBlockedVoxel ??
      buriedProbe.sideBlockedVoxel ??
      buriedProbe.floorBlockedVoxel;

    let jump = memory.jumpHoldRemaining > EPSILON && !player.grounded;
    let jumpPressed = false;
    let destroy = false;
    let place = false;
    let targetVoxel: Vec3i | null = null;
    let targetNormal: Vec3i | null = null;

    if (recoveryDestroyTarget) {
      destroy = true;
      targetVoxel = recoveryDestroyTarget;
      if (buriedProbe.headBlockedVoxel && this.isSameVoxel(recoveryDestroyTarget, buriedProbe.headBlockedVoxel)) {
        move = { x: 0, z: 0 };
      }
    } else if (
      buildPlan &&
      (pathProbe.shortGapAhead ||
        pathProbe.tallStepAhead ||
        pathProbe.frontTopSolidY < 0 ||
        (buriedProbe.exitTarget !== null && buriedProbe.exitTarget.y > player.position.y + 0.7))
    ) {
      place = true;
      targetVoxel = buildPlan.targetVoxel;
      targetNormal = buildPlan.targetNormal;
    }

    const shouldClimb =
      buriedProbe.headroomOpen &&
      (
        pathProbe.obstacleAhead ||
        pathProbe.shortGapAhead ||
        pathProbe.tallStepAhead ||
        (buriedProbe.exitTarget !== null && buriedProbe.exitTarget.y > player.position.y + 0.35)
      );

    if (!destroy && player.grounded && shouldClimb) {
      jump = true;
      jumpPressed = true;
      memory.jumpHoldRemaining = 0.36;
    } else if (
      !destroy &&
      !player.grounded &&
      (
        memory.jumpHoldRemaining > EPSILON ||
        (buriedProbe.headroomOpen && buriedProbe.exitTarget !== null && buriedProbe.exitTarget.y >= player.position.y - 0.1)
      )
    ) {
      jump = true;
    }

    if (length2(move.x, move.z) <= EPSILON) {
      move = desiredLook;
    }

    if (length2(desiredLook.x, desiredLook.z) <= EPSILON) {
      desiredLook = move;
    }

    memory.intent = "recover";
    memory.intentRemaining = 0.34;
    memory.targetLockRemaining = 0;

    return {
      moveX: move.x,
      moveZ: move.z,
      lookX: desiredLook.x !== 0 || desiredLook.z !== 0 ? desiredLook.x : player.facing.x,
      lookZ: desiredLook.x !== 0 || desiredLook.z !== 0 ? desiredLook.z : player.facing.z,
      eggCharge: 0,
      eggPitch: 0,
      jump,
      jumpPressed,
      jumpReleased: false,
      destroy,
      place,
      push: false,
      layEgg: false,
      targetVoxel,
      targetNormal
    };
  }

  private createNpcPathProbe(player: SimPlayer, move: Vector2, fallbackLook: Vector2): NpcPathProbe {
    const probeDirection =
      length2(move.x, move.z) > EPSILON ? move : length2(fallbackLook.x, fallbackLook.z) > EPSILON ? fallbackLook : player.facing;
    const cardinal = this.toCardinalDirection(probeDirection);
    const frontCellX = Math.floor(player.position.x + cardinal.x);
    const frontCellZ = Math.floor(player.position.z + cardinal.z);
    const secondCellX = frontCellX + cardinal.x;
    const secondCellZ = frontCellZ + cardinal.z;
    const supportY = Math.floor(player.position.y - 0.1);
    const frontTopSolidY = this.world.getTopSolidY(frontCellX, frontCellZ);
    const secondTopSolidY = this.world.getTopSolidY(secondCellX, secondCellZ);
    const frontFloorY = frontTopSolidY + 1.05;
    const heightDelta = frontFloorY - player.position.y;
    const gapDepth = frontTopSolidY < 0 ? Number.POSITIVE_INFINITY : player.position.y - frontFloorY;
    const footProbeY = Math.floor(player.position.y + 0.2);
    const headProbeY = Math.floor(player.position.y + 1.15);
    const obstacleAhead =
      this.world.hasSolid(frontCellX, footProbeY, frontCellZ) &&
      !this.world.hasSolid(frontCellX, footProbeY + 1, frontCellZ);

    return {
      move: probeDirection,
      cardinal,
      frontCellX,
      frontCellZ,
      supportY,
      frontTopSolidY,
      heightDelta,
      gapDepth,
      obstacleAhead,
      blockedAhead: this.world.hasSolid(frontCellX, headProbeY, frontCellZ),
      shortGapAhead:
        player.grounded &&
        (frontTopSolidY < 0 || gapDepth > 0.85) &&
        gapDepth <= 3.35 &&
        secondTopSolidY >= supportY - 1,
      tallStepAhead: player.grounded && heightDelta > 0.75
    };
  }

  private toCardinalDirection(direction: Vector2): Vec3i {
    if (Math.abs(direction.x) >= Math.abs(direction.z)) {
      return {
        x: direction.x >= 0 ? 1 : -1,
        y: 0,
        z: 0
      };
    }

    return {
      x: 0,
      y: 0,
      z: direction.z >= 0 ? 1 : -1
    };
  }

  private findNpcPlacementPlan(player: SimPlayer, probe: NpcPathProbe): NpcPlacementPlan | null {
    if (!player.grounded) {
      return null;
    }

    const currentSupportVoxel = {
      x: Math.floor(player.position.x),
      y: probe.supportY,
      z: Math.floor(player.position.z)
    };

    if (!this.world.hasSolid(currentSupportVoxel.x, currentSupportVoxel.y, currentSupportVoxel.z)) {
      return null;
    }

    if (
      this.canPlaceFromTarget(player, currentSupportVoxel, probe.cardinal) &&
      (probe.shortGapAhead || probe.frontTopSolidY < 0 || probe.heightDelta > 0.6)
    ) {
      return {
        targetVoxel: currentSupportVoxel,
        targetNormal: probe.cardinal
      };
    }

    return null;
  }

  private canPlaceFromTarget(player: SimPlayer, targetVoxel: Vec3i, targetNormal: Vec3i) {
    const placement = {
      x: targetVoxel.x + targetNormal.x,
      y: targetVoxel.y + targetNormal.y,
      z: targetVoxel.z + targetNormal.z
    };

    if (!isInBounds(this.world.size, placement.x, placement.y, placement.z)) {
      return false;
    }

    if (!this.isTargetInInteractRange(player, targetVoxel)) {
      return false;
    }

    if (this.world.hasSolid(placement.x, placement.y, placement.z)) {
      return false;
    }

    if (this.isVoxelBlockedByAnyPlayer(placement)) {
      return false;
    }

    if (this.isVoxelBlockedByFallingCluster(placement) || this.isVoxelBlockedBySkyDrop(placement)) {
      return false;
    }

    return !this.isVoxelBlockedByEgg(placement) && !this.isVoxelBlockedByEggScatterDebris(placement);
  }

  private findSupportCollapseTarget(player: SimPlayer, target: SimPlayer): Vec3i | null {
    const edge = this.getEdgePressure(target.position);
    if (edge.distance > 4.25 && target.stunRemaining <= EPSILON) {
      return null;
    }

    const targetSupportY = Math.floor(target.position.y - 0.1);
    const candidateColumns = [
      { x: Math.floor(target.position.x), z: Math.floor(target.position.z) },
      {
        x: Math.floor(target.position.x - edge.direction.x * 0.75),
        z: Math.floor(target.position.z - edge.direction.z * 0.75)
      }
    ];

    for (const column of candidateColumns) {
      for (let y = targetSupportY; y >= Math.max(0, targetSupportY - 2); y -= 1) {
        const candidate = { x: column.x, y, z: column.z };
        const kind = this.world.getVoxelKind(candidate.x, candidate.y, candidate.z);
        if (
          kind &&
          this.isHarvestable(kind) &&
          this.isTargetInInteractRange(player, candidate) &&
          Math.hypot(player.position.x - (candidate.x + 0.5), player.position.z - (candidate.z + 0.5)) > this.config.playerRadius * 1.6
        ) {
          return candidate;
        }
      }
    }

    return null;
  }

  private getNpcEggPlan(player: SimPlayer, target: SimPlayer, targetEdgeDistance: number) {
    if (
      player.mass < this.config.eggCost + 6 ||
      this.getActiveEggCountForOwner(player.id) >= this.config.maxActiveEggsPerPlayer
    ) {
      return null;
    }

    const deltaX = target.position.x - player.position.x;
    const deltaY = target.position.y + this.config.playerHeight * 0.45 - (player.position.y + this.config.eggDropOffsetUp);
    const deltaZ = target.position.z - player.position.z;
    const horizontal = Math.hypot(deltaX, deltaZ);
    if (horizontal < 4.5 || horizontal > 12) {
      return null;
    }

    const aim = normalize2(deltaX, deltaZ);
    const facingDot = aim.x * player.facing.x + aim.z * player.facing.z;
    if (facingDot < 0.65 && target.stunRemaining <= EPSILON && targetEdgeDistance > 3.5) {
      return null;
    }

    return {
      charge: clamp((horizontal - 3.5) / 5.5, 0.35, 1),
      pitch: clamp(
        Math.atan2(deltaY, Math.max(horizontal, EPSILON)),
        -this.config.eggThrowPitchLiftMin,
        this.config.eggThrowPitchLiftBias
      )
    };
  }

  private isNpcPushReady(player: SimPlayer, target: SimPlayer, edgeDirection: Vector2, edgeDistance: number) {
    if (
      player.mass < this.config.pushCost ||
      player.pushCooldownRemaining > EPSILON ||
      edgeDistance > 5
    ) {
      return false;
    }

    const distance = horizontalDistance(player, target);
    if (distance > this.config.pushRange * 1.05) {
      return false;
    }

    const targetDirection = normalize2(target.position.x - player.position.x, target.position.z - player.position.z);
    const outwardDot = targetDirection.x * edgeDirection.x + targetDirection.z * edgeDirection.z;
    const facingDot = player.facing.x * edgeDirection.x + player.facing.z * edgeDirection.z;
    return outwardDot > 0.15 && (facingDot > 0.78 || target.stunRemaining > EPSILON);
  }

  private isNpcDirectSupportVoxel(player: SimPlayer, targetVoxel: Vec3i) {
    return (
      targetVoxel.x === Math.floor(player.position.x) &&
      targetVoxel.z === Math.floor(player.position.z) &&
      targetVoxel.y === Math.floor(player.position.y - 0.1)
    );
  }

  private collectNpcHarvestCandidates(player: SimPlayer, direction = player.facing): NpcHarvestCandidate[] {
    const chest = this.getPlayerChestPosition(player);
    const normalizedDirection = normalize2(direction.x, direction.z);
    const minX = Math.max(0, Math.floor(chest.x - this.config.interactRange));
    const maxX = Math.min(this.world.size.x - 1, Math.ceil(chest.x + this.config.interactRange));
    const minY = Math.max(0, Math.floor(chest.y - this.config.interactRange));
    const maxY = Math.min(this.world.size.y - 1, Math.ceil(chest.y + this.config.interactRange));
    const minZ = Math.max(0, Math.floor(chest.z - this.config.interactRange));
    const maxZ = Math.min(this.world.size.z - 1, Math.ceil(chest.z + this.config.interactRange));
    const candidates: NpcHarvestCandidate[] = [];

    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        for (let z = minZ; z <= maxZ; z += 1) {
          const kind = this.world.getVoxelKind(x, y, z);
          if (!kind || !this.isHarvestable(kind)) {
            continue;
          }

          const voxel = { x, y, z };
          if (!this.isTargetInInteractRange(player, voxel)) {
            continue;
          }

          const centerX = x + 0.5;
          const centerY = y + 0.5;
          const centerZ = z + 0.5;
          const deltaX = centerX - chest.x;
          const deltaZ = centerZ - chest.z;
          const horizontalDistance = Math.hypot(deltaX, deltaZ);
          const aim = normalize2(deltaX, deltaZ);
          const forwardDot =
            length2(normalizedDirection.x, normalizedDirection.z) > EPSILON
              ? aim.x * normalizedDirection.x + aim.z * normalizedDirection.z
              : 0;

          candidates.push({
            voxel,
            kind,
            distance: Math.hypot(deltaX, centerY - chest.y, deltaZ),
            horizontalDistance,
            forwardDot,
            topGroundY: this.world.getTopGroundY(x, z),
            topSolidY: this.world.getTopSolidY(x, z),
            aboveGround: y > this.world.getTopGroundY(x, z),
            exposed: this.world.isSurfaceVoxel(x, y, z),
            isSelfSupport: this.isNpcDirectSupportVoxel(player, voxel)
          });
        }
      }
    }

    candidates.sort((left, right) => left.distance - right.distance);
    return candidates;
  }

  private findElevatedHarvestTarget(candidates: NpcHarvestCandidate[]) {
    let bestCandidate: NpcHarvestCandidate | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const candidate of candidates) {
      if (!candidate.aboveGround || candidate.isSelfSupport || candidate.forwardDot < -0.35) {
        continue;
      }

      const elevation = candidate.voxel.y - candidate.topGroundY;
      const score =
        elevation * 3.1 +
        candidate.forwardDot * 2.6 +
        (candidate.exposed ? 1.4 : 0.5) -
        candidate.distance * 0.7;
      if (score <= bestScore) {
        continue;
      }

      bestScore = score;
      bestCandidate = candidate;
    }

    return bestCandidate?.voxel ?? null;
  }

  private findBlockingHarvestTarget(player: SimPlayer, candidates: NpcHarvestCandidate[]) {
    const supportY = Math.floor(player.position.y - 0.1);
    const headThreshold = Math.floor(player.position.y + this.config.playerHeight * 0.5);
    let bestCandidate: NpcHarvestCandidate | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const candidate of candidates) {
      if (
        candidate.isSelfSupport ||
        candidate.voxel.y < supportY + 1 ||
        (candidate.forwardDot < -0.15 && candidate.horizontalDistance > 1.25)
      ) {
        continue;
      }

      const sameColumn =
        candidate.voxel.x === Math.floor(player.position.x) &&
        candidate.voxel.z === Math.floor(player.position.z);
      const score =
        candidate.forwardDot * 2.2 +
        (sameColumn ? 2.8 : 0) +
        (candidate.voxel.y >= headThreshold ? 1.3 : 0.4) +
        (candidate.exposed ? 0.6 : 0) -
        candidate.distance * 0.85;
      if (score <= bestScore) {
        continue;
      }

      bestScore = score;
      bestCandidate = candidate;
    }

    return bestCandidate?.voxel ?? null;
  }

  private findGroundFallbackHarvestTarget(candidates: NpcHarvestCandidate[], allowSelfSupport: boolean) {
    let bestCandidate: NpcHarvestCandidate | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const candidate of candidates) {
      const isSurfaceGround = candidate.voxel.y >= candidate.topGroundY;
      if (
        candidate.aboveGround ||
        (!allowSelfSupport && candidate.isSelfSupport) ||
        (!isSurfaceGround && candidate.voxel.y < candidate.topGroundY - 1)
      ) {
        continue;
      }

      const score =
        candidate.forwardDot * 1.9 +
        (candidate.exposed ? 0.75 : 0.2) -
        candidate.distance * 0.9 -
        Math.max(0, candidate.topGroundY - candidate.voxel.y) * 1.2;
      if (score <= bestScore) {
        continue;
      }

      bestScore = score;
      bestCandidate = candidate;
    }

    return bestCandidate?.voxel ?? null;
  }

  private findDestroyTarget(
    player: SimPlayer,
    direction = player.facing,
    options: {
      supportCollapseTarget?: Vec3i | null;
      allowGroundFallback?: boolean;
      allowSelfSupport?: boolean;
    } = {}
  ): Vec3i | null {
    const candidates = this.collectNpcHarvestCandidates(player, direction);
    const elevatedTarget = this.findElevatedHarvestTarget(candidates);
    if (elevatedTarget) {
      return elevatedTarget;
    }

    if (options.supportCollapseTarget) {
      return options.supportCollapseTarget;
    }

    const blockingTarget = this.findBlockingHarvestTarget(player, candidates);
    if (blockingTarget) {
      return blockingTarget;
    }

    if (options.allowGroundFallback) {
      return this.findGroundFallbackHarvestTarget(candidates, options.allowSelfSupport ?? false);
    }

    return null;
  }

  private isOutsideHorizontalBounds(player: SimPlayer) {
    return (
      player.position.x < 0 ||
      player.position.z < 0 ||
      player.position.x >= this.world.size.x ||
      player.position.z >= this.world.size.z
    );
  }

  private stopJetpack(player: SimPlayer) {
    if (player.jetpackActive && this.isOutsideHorizontalBounds(player)) {
      player.jetpackOutsideBoundsGrace = true;
    }

    player.jetpackActive = false;
  }

  private clearJetpackState(player: SimPlayer) {
    this.stopJetpack(player);
    player.jetpackHoldActivationRemaining = 0;
    player.jetpackEligible = false;
    player.jetpackOutsideBoundsGrace = false;
  }

  private eliminatePlayer(player: SimPlayer, fallingOut: boolean) {
    this.stopJetpack(player);
    player.alive = false;
    player.fallingOut = fallingOut;
    player.grounded = false;
    player.respawning = false;
    player.respawnRemaining = 0;
    player.invulnerableRemaining = 0;
    player.jumpBufferRemaining = 0;
    player.jumpAssistRemaining = 0;
    player.jetpackHoldActivationRemaining = 0;
    player.jetpackEligible = false;
    player.jetpackOutsideBoundsGrace = false;
    player.pushVisualRemaining = 0;
    player.eggTauntSequence = 0;
    player.eggTauntRemaining = 0;
    player.spacePhase = "none";
    player.spacePhaseRemaining = 0;
    player.spaceTriggerArmed = true;
    player.eliminatedAt ??= this.tick;

    if (!fallingOut) {
      player.velocity = { x: 0, y: 0, z: 0 };
    }
  }

  private updateEliminationVisibility(player: SimPlayer) {
    if (player.position.y >= this.world.boundary.fallY - RING_OUT_FALL_CULL_DEPTH) {
      return;
    }

    player.fallingOut = false;
    player.velocity = { x: 0, y: 0, z: 0 };
  }
}
