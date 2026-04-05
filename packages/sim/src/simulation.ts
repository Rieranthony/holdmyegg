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
  SkyDropPhase,
  SkyDropViewState,
  SimulationConfig,
  SimulationResetOptions,
  SimulationSnapshot,
  Vector2,
  Vector3
} from "./types";
import { defaultSimulationConfig } from "./config";

const EPSILON = 0.0001;
const RING_OUT_FALL_CULL_DEPTH = 12;

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
  jetpackEligible: boolean;
  jetpackActive: boolean;
  jetpackOutsideBoundsGrace: boolean;
  pushCooldownRemaining: number;
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
}

interface SimEgg {
  id: string;
  ownerId: string;
  fuseRemaining: number;
  grounded: boolean;
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

interface SimSkyDrop {
  id: string;
  phase: SkyDropPhase;
  warningRemaining: number;
  landingVoxel: Vec3i;
  offsetY: number;
  velocityY: number;
  damagedPlayerIds: Set<string>;
}

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
  private readonly skyDrops = new Map<string, SimSkyDrop>();
  private dirtyChunkKeys = new Set<string>();
  private nextFallingClusterId = 1;
  private nextEggId = 1;
  private nextEggScatterDebrisId = 1;
  private nextSkyDropId = 1;
  private skyDropCooldown = 0;
  private rngState = 1;

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
    this.players.clear();
    this.fallingClusters.clear();
    this.eggs.clear();
    this.eggScatterDebris.clear();
    this.skyDrops.clear();
    this.dirtyChunkKeys.clear();
    this.nextFallingClusterId = 1;
    this.nextEggId = 1;
    this.nextEggScatterDebrisId = 1;
    this.nextSkyDropId = 1;
    this.rngState = hashString(`${mode}:${mapDocument.meta.name}:${mapDocument.meta.createdAt}:${mapDocument.meta.updatedAt}`) || 1;
    this.skyDropCooldown = this.nextSkyDropInterval();
    this.world = new MutableVoxelWorld(mapDocument);

    const local = this.spawnPlayer("human", options.localPlayerName ?? "You", 0);
    this.localPlayerId = local.id;

    if (mode === "skirmish") {
      const npcCount = clamp(options.npcCount ?? 4, 1, this.config.maxNpcCount);
      for (let index = 0; index < npcCount; index += 1) {
        this.spawnPlayer("npc", `NPC ${index + 1}`, index + 1);
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

  getFallingClusterState(clusterId: string) {
    const cluster = this.fallingClusters.get(clusterId);
    return cluster ? this.toFallingClusterViewState(cluster) : null;
  }

  getEggs(): EggViewState[] {
    return [...this.eggs.values()]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((egg) => this.toEggViewState(egg));
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

  getEggScatterDebrisState(debrisId: string) {
    const debris = this.eggScatterDebris.get(debrisId);
    return debris ? this.toEggScatterDebrisViewState(debris) : null;
  }

  getSkyDrops(): SkyDropViewState[] {
    return [...this.skyDrops.values()]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((skyDrop) => this.toSkyDropViewState(skyDrop));
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

  getHudState(): HudState {
    const localPlayer = this.localPlayerId ? this.players.get(this.localPlayerId) ?? null : null;

    return {
      mode: this.mode,
      localPlayerId: this.localPlayerId,
      localPlayer: localPlayer ? this.toHudPlayerState(localPlayer) : null,
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
      skyDrops: this.getSkyDrops(),
      ranking: match.ranking
    };
  }

  step(commands: Record<string, PlayerCommand> = {}, dt = 1 / this.config.tickRate) {
    this.tick += 1;
    this.time += dt;

    const effectiveCommands = new Map<string, PlayerCommand>();
    for (const [playerId, player] of this.players) {
      if (!player.alive || player.respawning) {
        effectiveCommands.set(playerId, cloneCommand());
        continue;
      }

      if (player.kind === "npc") {
        effectiveCommands.set(playerId, this.generateNpcCommand(player));
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

  private spawnPlayer(kind: PlayerKind, name: string, spawnIndex: number) {
    const id = `${kind}-${spawnIndex + 1}`;
    const spawns = this.world.listSpawns();
    const fallback = {
      x: this.world.size.x / 2 + 0.5,
      y: this.world.getTopSolidY(Math.floor(this.world.size.x / 2), Math.floor(this.world.size.z / 2)) + 1.05,
      z: this.world.size.z / 2 + 0.5
    };
    const spawn = spawns[spawnIndex % Math.max(1, spawns.length)] ?? { id: "fallback", ...fallback };

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
      position: {
        x: spawn.x,
        y: spawn.y,
        z: spawn.z
      },
      velocity: { x: 0, y: 0, z: 0 },
      facing: kind === "npc" ? { x: -1, z: 0 } : { x: 1, z: 0 },
      jetpackEligible: false,
      jetpackActive: false,
      jetpackOutsideBoundsGrace: false,
      pushCooldownRemaining: 0,
      eliminatedAt: null
    };

    this.players.set(id, player);
    return player;
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
    player.stunRemaining = Math.max(0, player.stunRemaining - dt);
    player.invulnerableRemaining = Math.max(0, player.invulnerableRemaining - dt);

    const stunned = player.stunRemaining > EPSILON;
    if (stunned) {
      this.stopJetpack(player);
    }

    const moveInput = stunned ? { x: 0, z: 0 } : normalize2(command.moveX, command.moveZ);
    const lookInput = stunned ? { x: 0, z: 0 } : normalize2(command.lookX, command.lookZ);
    if (length2(lookInput.x, lookInput.z) > EPSILON) {
      player.facing = this.rotateFacingToward(player.facing, lookInput, this.config.turnSpeed * dt);
    } else if (length2(moveInput.x, moveInput.z) > EPSILON) {
      player.facing = this.rotateFacingToward(player.facing, moveInput, this.config.turnSpeed * dt);
    }

    const moveSpeed = this.config.moveSpeed;
    const desiredX = moveInput.x * moveSpeed;
    const desiredZ = moveInput.z * moveSpeed;
    const acceleration = (player.grounded ? this.config.groundAcceleration : this.config.airAcceleration) * dt;
    const airControl = player.grounded ? 1 : this.config.airControl;

    player.velocity.x = approach(player.velocity.x, desiredX, acceleration * airControl);
    player.velocity.z = approach(player.velocity.z, desiredZ, acceleration * airControl);

    if (moveInput.x === 0 && moveInput.z === 0 && player.grounded) {
      const frictionAmount = this.config.friction * dt;
      player.velocity.x = approach(player.velocity.x, 0, frictionAmount);
      player.velocity.z = approach(player.velocity.z, 0, frictionAmount);
    }

    let jumpedThisFrame = false;
    if (!stunned && command.jumpPressed && player.grounded && player.mass >= this.config.jumpCost) {
      player.velocity.y = this.config.jumpSpeed;
      player.mass -= this.config.jumpCost;
      player.grounded = false;
      player.jetpackEligible = true;
      player.jetpackOutsideBoundsGrace = false;
      jumpedThisFrame = true;
    }

    if (!stunned && !jumpedThisFrame && !player.grounded && player.jetpackEligible && command.jumpPressed && player.mass > EPSILON) {
      player.jetpackActive = true;
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

    if (!stunned && command.push) {
      this.tryPush(player);
    }

    if (!stunned && command.destroy) {
      this.tryDestroy(player, command.targetVoxel);
    }

    if (!stunned && command.place) {
      this.tryPlace(player, command.targetVoxel, command.targetNormal);
    }

    if (!stunned && command.layEgg) {
      this.tryLayEgg(player);
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

    const dirty = this.world.removeVoxel(targetVoxel.x, targetVoxel.y, targetVoxel.z);
    for (const chunkKey of dirty) {
      this.dirtyChunkKeys.add(chunkKey);
    }

    this.spawnDetachedComponentsAsFallingClusters();
    player.mass = clamp(player.mass + this.config.destroyGain, 0, this.config.maxMass);
  }

  private tryPlace(player: SimPlayer, targetVoxel: Vec3i | null, targetNormal: Vec3i | null) {
    if (!targetVoxel || !targetNormal || player.mass < this.config.placeCost) {
      return;
    }

    const placement = {
      x: targetVoxel.x + targetNormal.x,
      y: targetVoxel.y + targetNormal.y,
      z: targetVoxel.z + targetNormal.z
    };

    if (!isInBounds(this.world.size, placement.x, placement.y, placement.z)) {
      return;
    }

    if (!this.isTargetInInteractRange(player, targetVoxel)) {
      return;
    }

    if (this.world.hasSolid(placement.x, placement.y, placement.z)) {
      return;
    }

    if (this.isVoxelBlockedByAnyPlayer(placement)) {
      return;
    }

    if (this.isVoxelBlockedByFallingCluster(placement)) {
      return;
    }

    if (this.isVoxelBlockedBySkyDrop(placement)) {
      return;
    }

    if (this.isVoxelBlockedByEgg(placement) || this.isVoxelBlockedByEggScatterDebris(placement)) {
      return;
    }

    const dirty = this.world.setVoxel(placement.x, placement.y, placement.z, "ground");
    for (const chunkKey of dirty) {
      this.dirtyChunkKeys.add(chunkKey);
    }

    player.mass -= this.config.placeCost;
  }

  private tryLayEgg(player: SimPlayer) {
    if (player.mass < this.config.eggCost || this.getActiveEggCountForOwner(player.id) >= this.config.maxActiveEggsPerPlayer) {
      return;
    }

    const eggId = `egg-${this.nextEggId}`;
    this.nextEggId += 1;

    const spawnX = player.position.x + player.facing.x * this.config.eggDropOffsetForward;
    const spawnY = player.position.y + this.config.eggDropOffsetUp;
    const spawnZ = player.position.z + player.facing.z * this.config.eggDropOffsetForward;
    const egg: SimEgg = {
      id: eggId,
      ownerId: player.id,
      fuseRemaining: this.config.eggFuseDuration,
      grounded: false,
      position: {
        x: clamp(spawnX, this.config.eggRadius + EPSILON, this.world.size.x - this.config.eggRadius - EPSILON),
        y: clamp(spawnY, this.config.eggRadius + EPSILON, this.world.size.y - this.config.eggRadius - EPSILON),
        z: clamp(spawnZ, this.config.eggRadius + EPSILON, this.world.size.z - this.config.eggRadius - EPSILON)
      },
      velocity: {
        x: player.velocity.x + player.facing.x * this.config.eggThrowSpeed,
        y: Math.max(player.velocity.y * 0.35, 0) + this.config.eggThrowSpeed * 0.38,
        z: player.velocity.z + player.facing.z * this.config.eggThrowSpeed
      }
    };

    this.eggs.set(egg.id, egg);
    player.mass -= this.config.eggCost;
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
    player.velocity.y -= this.config.gravity * dt;

    this.resolveAxis(player, "x", player.velocity.x * dt);
    const groundedByY = this.resolveAxis(player, "y", player.velocity.y * dt);
    this.resolveAxis(player, "z", player.velocity.z * dt);
    player.grounded = groundedByY;
    if (player.grounded) {
      this.clearJetpackState(player);
    }
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
      this.integrateEgg(egg, dt);

      if (egg.fuseRemaining <= EPSILON || egg.position.y < this.world.boundary.fallY) {
        this.explodeEgg(egg);
      }
    }
  }

  private integrateEgg(egg: SimEgg, dt: number) {
    egg.velocity.y -= this.config.eggGravity * dt;

    this.resolveEggAxis(egg, "x", egg.velocity.x * dt);
    const groundedByY = this.resolveEggAxis(egg, "y", egg.velocity.y * dt);
    this.resolveEggAxis(egg, "z", egg.velocity.z * dt);
    egg.grounded = groundedByY;

    if (egg.grounded) {
      egg.velocity.x = approach(egg.velocity.x, 0, this.config.eggGroundFriction * dt);
      egg.velocity.z = approach(egg.velocity.z, 0, this.config.eggGroundFriction * dt);
      if (Math.abs(egg.velocity.x) < this.config.eggGroundSpeedThreshold) {
        egg.velocity.x = 0;
      }
      if (Math.abs(egg.velocity.z) < this.config.eggGroundSpeedThreshold) {
        egg.velocity.z = 0;
      }
    }

    egg.position.x = clamp(egg.position.x, this.config.eggRadius + EPSILON, this.world.size.x - this.config.eggRadius - EPSILON);
    egg.position.z = clamp(egg.position.z, this.config.eggRadius + EPSILON, this.world.size.z - this.config.eggRadius - EPSILON);
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
        egg.velocity.y = Math.abs(egg.velocity.y) * this.config.eggBounceDamping;
        if (egg.velocity.y < this.config.eggGroundSpeedThreshold) {
          egg.velocity.y = 0;
        }
      } else {
        egg.velocity.y = -Math.abs(egg.velocity.y) * this.config.eggBounceDamping;
      }
    } else {
      egg.velocity[axis] = -egg.velocity[axis] * this.config.eggBounceDamping;
    }

    return grounded;
  }

  private updateEggScatterDebris(dt: number) {
    const debrisEntries = [...this.eggScatterDebris.values()].sort((left, right) => left.id.localeCompare(right.id));
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
      if (!this.world.hasSolid(landingVoxel.x, landingVoxel.y, landingVoxel.z)) {
        const dirtyChunkKeys = this.world.setVoxel(landingVoxel.x, landingVoxel.y, landingVoxel.z, debris.kind);
        for (const chunkKey of dirtyChunkKeys) {
          this.dirtyChunkKeys.add(chunkKey);
        }
      }

      this.eggScatterDebris.delete(debris.id);
      this.spawnDetachedComponentsAsFallingClusters();
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

  private explodeEgg(egg: SimEgg) {
    if (!this.eggs.has(egg.id)) {
      return;
    }

    const explosionCenter = { ...egg.position };
    const hitRadiusSquared = this.config.eggBlastHitRadius * this.config.eggBlastHitRadius;
    for (const player of this.players.values()) {
      if (!player.alive || player.respawning) {
        continue;
      }

      if (distanceSquared3(this.getPlayerChestPosition(player), explosionCenter) > hitRadiusSquared) {
        continue;
      }

      this.applyPlayerHit(player, explosionCenter, {
        knockback: this.config.eggBlastKnockback,
        lift: this.config.eggBlastLift,
        stunDuration: this.config.eggBlastStunDuration
      });
    }

    const reservedLandingKeys = new Set<string>();
    let scatterCount = 0;
    for (const voxel of this.collectEggExplosionVoxels(explosionCenter)) {
      const dirtyChunkKeys = this.world.removeVoxel(voxel.x, voxel.y, voxel.z);
      for (const chunkKey of dirtyChunkKeys) {
        this.dirtyChunkKeys.add(chunkKey);
      }

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
    this.spawnDetachedComponentsAsFallingClusters();
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
    player.jetpackEligible = false;
    player.jetpackOutsideBoundsGrace = false;
    player.stunRemaining = 0;

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
    player.jetpackActive = false;
    player.jetpackEligible = false;
    player.jetpackOutsideBoundsGrace = false;
  }

  private selectRespawnPosition(playerId: string): Vector3 {
    const spawns = this.world.listSpawns();
    const fallback = {
      x: this.world.size.x / 2 + 0.5,
      y: this.world.getTopSolidY(Math.floor(this.world.size.x / 2), Math.floor(this.world.size.z / 2)) + 1.05,
      z: this.world.size.z / 2 + 0.5
    };
    if (spawns.length === 0) {
      return fallback;
    }

    const opponents = [...this.players.values()].filter((player) => player.id !== playerId && player.alive && !player.respawning);
    const minimumSeparation = this.config.playerRadius * 2 + this.config.playerHitSeparationDistance;
    let bestSpawn = { x: spawns[0]!.x, y: spawns[0]!.y, z: spawns[0]!.z };
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const spawn of spawns) {
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
      if (nearestOpponentDistance > bestScore) {
        bestScore = nearestOpponentDistance;
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
      const landingDropDistance = this.world.getComponentDropDistance(cluster.voxels);
      const landingOffsetY = -landingDropDistance;
      const proposedOffsetY = cluster.offsetY + cluster.velocityY * dt;
      cluster.offsetY = Math.max(proposedOffsetY, landingOffsetY);

      this.applyCollapseDamage(cluster);

      if (cluster.offsetY <= landingOffsetY + EPSILON) {
        this.landFallingCluster(cluster, landingDropDistance);
      }
    }
  }

  private updateSkyDrops(dt: number) {
    if (this.mode !== "explore" && this.mode !== "skirmish") {
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
        this.landSkyDrop(skyDrop);
      }
    }
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

  private spawnDetachedComponentsAsFallingClusters() {
    const detachedComponents = this.world.collectDetachedComponents();
    if (detachedComponents.length === 0) {
      return;
    }

    for (const component of detachedComponents) {
      for (const voxel of component.voxels) {
        const dirtyChunkKeys = this.world.removeVoxel(voxel.x, voxel.y, voxel.z);
        for (const chunkKey of dirtyChunkKeys) {
          this.dirtyChunkKeys.add(chunkKey);
        }
      }
    }

    for (const component of detachedComponents) {
      const cluster = this.createFallingCluster(component);
      this.fallingClusters.set(cluster.id, cluster);
    }
  }

  private createFallingCluster(component: DetachedVoxelComponent): SimFallingCluster {
    const clusterId = `collapse-${this.nextFallingClusterId}`;
    this.nextFallingClusterId += 1;

    return {
      id: clusterId,
      phase: "warning",
      warningRemaining: this.config.collapseWarningDuration,
      voxels: component.voxels.map((voxel) => ({ ...voxel })),
      offsetY: 0,
      velocityY: 0,
      damagedPlayerIds: new Set()
    };
  }

  private landFallingCluster(cluster: SimFallingCluster, dropDistance: number) {
    this.applyCollapseDamage(cluster);

    for (const voxel of cluster.voxels) {
      const dirtyChunkKeys = this.world.setVoxel(voxel.x, voxel.y - dropDistance, voxel.z, voxel.kind);
      for (const chunkKey of dirtyChunkKeys) {
        this.dirtyChunkKeys.add(chunkKey);
      }
    }

    this.fallingClusters.delete(cluster.id);
    this.spawnDetachedComponentsAsFallingClusters();
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

    const dirtyChunkKeys = this.world.setVoxel(
      skyDrop.landingVoxel.x,
      skyDrop.landingVoxel.y,
      skyDrop.landingVoxel.z,
      "ground"
    );
    for (const chunkKey of dirtyChunkKeys) {
      this.dirtyChunkKeys.add(chunkKey);
    }

    this.skyDrops.delete(skyDrop.id);
    this.spawnDetachedComponentsAsFallingClusters();
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

  private generateNpcCommand(player: SimPlayer): PlayerCommand {
    const center = {
      x: this.world.size.x / 2,
      z: this.world.size.z / 2
    };
    const nearestOpponent = [...this.players.values()]
      .filter((other) => other.alive && !other.respawning && other.id !== player.id)
      .sort((left, right) => horizontalDistance(player, left) - horizontalDistance(player, right))[0];

    const distanceToEdge = Math.min(
      player.position.x,
      player.position.z,
      this.world.size.x - player.position.x,
      this.world.size.z - player.position.z
    );

    let targetX = center.x;
    let targetZ = center.z;
    let shouldPush = false;
    let destroyTarget: Vec3i | null = null;
    let shouldDestroy = player.mass < this.config.maxMass * 0.55;

    if (distanceToEdge < 4) {
      targetX = center.x;
      targetZ = center.z;
    } else if (nearestOpponent) {
      targetX = nearestOpponent.position.x;
      targetZ = nearestOpponent.position.z;
      shouldPush = horizontalDistance(player, nearestOpponent) < this.config.pushRange * 1.1 && player.mass > this.config.pushCost;
    }

    const move = normalize2(targetX - player.position.x, targetZ - player.position.z);
    const probeX = Math.floor(player.position.x + move.x * 0.9);
    const probeZ = Math.floor(player.position.z + move.z * 0.9);
    const frontY = Math.floor(player.position.y + 0.2);

    const obstacleAhead =
      this.world.hasSolid(probeX, frontY, probeZ) &&
      !this.world.hasSolid(probeX, frontY + 1, probeZ);

    if (player.mass < this.config.maxMass * 0.8) {
      destroyTarget = this.findDestroyTarget(player);
      shouldDestroy = destroyTarget !== null;
    }

    return {
      moveX: move.x,
      moveZ: move.z,
      lookX: move.x !== 0 || move.z !== 0 ? move.x : player.facing.x,
      lookZ: move.x !== 0 || move.z !== 0 ? move.z : player.facing.z,
      jump: obstacleAhead && player.grounded,
      jumpPressed: false,
      jumpReleased: false,
      destroy: shouldDestroy,
      place: false,
      push: shouldPush,
      layEgg: false,
      targetVoxel: destroyTarget,
      targetNormal: null
    };
  }

  private findDestroyTarget(player: SimPlayer): Vec3i | null {
    const sampleHeights = [-0.25, 0.15, 0.6, 1.1];

    for (const height of sampleHeights) {
      for (let distance = 0.65; distance <= this.config.interactRange; distance += 0.25) {
        const sampleX = player.position.x + player.facing.x * distance;
        const sampleY = player.position.y + height;
        const sampleZ = player.position.z + player.facing.z * distance;
        const targetVoxel = {
          x: Math.floor(sampleX),
          y: Math.floor(sampleY),
          z: Math.floor(sampleZ)
        };
        const kind = this.world.getVoxelKind(targetVoxel.x, targetVoxel.y, targetVoxel.z);

        if (!kind || !this.isHarvestable(kind) || !this.isTargetInInteractRange(player, targetVoxel)) {
          continue;
        }

        return targetVoxel;
      }
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
    player.jetpackEligible = false;
    player.jetpackOutsideBoundsGrace = false;
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
