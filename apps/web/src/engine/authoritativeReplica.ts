import type {
  AuthoritativeMatchState,
  GameplayEvent,
  GameplayEventBatch,
  TerrainDelta,
  TerrainDeltaBatch
} from "@out-of-bounds/sim";
import type { RuntimeAuthoritativeFrame } from "./types";

const cloneTerrainDelta = (change: TerrainDelta): TerrainDelta => ({
  voxel: { ...change.voxel },
  kind: change.kind,
  operation: change.operation,
  source: change.source
});

const cloneGameplayEvent = (event: GameplayEvent): GameplayEvent => {
  switch (event.type) {
    case "projectile_spawned":
      return {
        ...event,
        position: { ...event.position },
        velocity: { ...event.velocity }
      };
    case "projectile_hit_resolved":
      return {
        ...event,
        impactPosition: { ...event.impactPosition },
        hitPlayerIds: [...event.hitPlayerIds]
      };
    case "explosion_resolved":
      return {
        ...event,
        position: { ...event.position },
        hitPlayerIds: [...event.hitPlayerIds]
      };
    case "player_damaged":
      return {
        ...event,
        position: { ...event.position },
        velocity: { ...event.velocity }
      };
    case "player_eliminated":
      return {
        ...event,
        ranking: [...event.ranking]
      };
    case "terrain_changed":
      return { ...event };
  }
};

const cloneAuthoritativeState = (
  state: AuthoritativeMatchState
): AuthoritativeMatchState => ({
  tick: state.tick,
  time: state.time,
  mode: state.mode,
  localPlayerId: state.localPlayerId,
  players: state.players.map((player) => ({
    ...player,
    position: { ...player.position },
    velocity: { ...player.velocity },
    facing: { ...player.facing }
  })),
  projectiles: state.projectiles.map((projectile) => ({
    ...projectile,
    position: { ...projectile.position },
    velocity: { ...projectile.velocity }
  })),
  hazards: {
    fallingClusters: state.hazards.fallingClusters.map((cluster) => ({
      ...cluster,
      voxels: cluster.voxels.map((voxel) => ({ ...voxel }))
    })),
    skyDrops: state.hazards.skyDrops.map((skyDrop) => ({
      ...skyDrop,
      landingVoxel: { ...skyDrop.landingVoxel }
    })),
    eggScatterDebris: state.hazards.eggScatterDebris.map((debris) => ({
      ...debris,
      origin: { ...debris.origin },
      destination: { ...debris.destination }
    }))
  },
  stats: {
    terrainRevision: state.stats.terrainRevision
  },
  ranking: [...state.ranking]
});

const cloneTerrainDeltaBatch = (
  batch: TerrainDeltaBatch | null
): TerrainDeltaBatch | null =>
  batch
    ? {
        tick: batch.tick,
        terrainRevision: batch.terrainRevision,
        changes: batch.changes.map(cloneTerrainDelta)
      }
    : null;

const cloneGameplayEventBatch = (
  batch: GameplayEventBatch | null
): GameplayEventBatch | null =>
  batch
    ? {
        tick: batch.tick,
        events: batch.events.map(cloneGameplayEvent)
      }
    : null;

export class AuthoritativeReplica {
  private state: AuthoritativeMatchState | null = null;
  private latestTerrainDeltaBatch: TerrainDeltaBatch | null = null;
  private latestGameplayEventBatch: GameplayEventBatch | null = null;

  applyFrame(frame: RuntimeAuthoritativeFrame) {
    this.state = cloneAuthoritativeState(frame.state);
    this.latestTerrainDeltaBatch = cloneTerrainDeltaBatch(frame.terrainDeltaBatch);
    this.latestGameplayEventBatch = cloneGameplayEventBatch(
      frame.gameplayEventBatch
    );
  }

  reset() {
    this.state = null;
    this.latestTerrainDeltaBatch = null;
    this.latestGameplayEventBatch = null;
  }

  getState() {
    return this.state ? cloneAuthoritativeState(this.state) : null;
  }

  getLocalPlayer() {
    if (!this.state?.localPlayerId) {
      return null;
    }

    const localPlayer = this.state.players.find(
      (player) => player.id === this.state?.localPlayerId
    );
    return localPlayer
      ? {
          ...localPlayer,
          position: { ...localPlayer.position },
          velocity: { ...localPlayer.velocity },
          facing: { ...localPlayer.facing }
        }
      : null;
  }

  peekTerrainDeltaBatch() {
    return cloneTerrainDeltaBatch(this.latestTerrainDeltaBatch);
  }

  consumeTerrainDeltaBatch() {
    const batch = cloneTerrainDeltaBatch(this.latestTerrainDeltaBatch);
    this.latestTerrainDeltaBatch = null;
    return batch;
  }

  peekGameplayEventBatch() {
    return cloneGameplayEventBatch(this.latestGameplayEventBatch);
  }

  consumeGameplayEventBatch() {
    const batch = cloneGameplayEventBatch(this.latestGameplayEventBatch);
    this.latestGameplayEventBatch = null;
    return batch;
  }
}
