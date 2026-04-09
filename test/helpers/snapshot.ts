import type {
  AuthoritativeMatchState,
  GameplayEventBatch,
  SimulationSnapshot,
  TerrainDeltaBatch
} from "@out-of-bounds/sim";

const round = (value: number) => Number(value.toFixed(4));

export const normalizeSnapshot = (snapshot: SimulationSnapshot) => ({
  tick: snapshot.tick,
  time: round(snapshot.time),
  mode: snapshot.mode,
  terrainRevision: snapshot.terrainRevision,
  ranking: [...snapshot.ranking],
  waterFlood: {
    active: snapshot.waterFlood.active,
    breachLevelY: snapshot.waterFlood.breachLevelY,
    currentLevelY: snapshot.waterFlood.currentLevelY,
    targetLevelY: snapshot.waterFlood.targetLevelY
  },
  fallingClusters: snapshot.fallingClusters.map((cluster) => ({
    id: cluster.id,
    phase: cluster.phase,
    warningRemaining: round(cluster.warningRemaining),
    offsetY: round(cluster.offsetY),
    center: {
      x: round(cluster.center.x),
      y: round(cluster.center.y),
      z: round(cluster.center.z)
    },
    voxels: cluster.voxels.map((voxel) => ({
      x: voxel.x,
      y: voxel.y,
      z: voxel.z,
      kind: voxel.kind
    }))
  })),
  eggs: snapshot.eggs.map((egg) => ({
    id: egg.id,
    ownerId: egg.ownerId,
    fuseRemaining: round(egg.fuseRemaining),
    position: {
      x: round(egg.position.x),
      y: round(egg.position.y),
      z: round(egg.position.z)
    },
    velocity: {
      x: round(egg.velocity.x),
      y: round(egg.velocity.y),
      z: round(egg.velocity.z)
    }
  })),
  eggScatterDebris: snapshot.eggScatterDebris.map((debris) => ({
    id: debris.id,
    kind: debris.kind,
    origin: {
      x: round(debris.origin.x),
      y: round(debris.origin.y),
      z: round(debris.origin.z)
    },
    destination: {
      x: round(debris.destination.x),
      y: round(debris.destination.y),
      z: round(debris.destination.z)
    },
    elapsed: round(debris.elapsed),
    duration: round(debris.duration)
  })),
  voxelBursts: snapshot.voxelBursts.map((burst) => ({
    id: burst.id,
    style: burst.style,
    kind: burst.kind,
    position: {
      x: round(burst.position.x),
      y: round(burst.position.y),
      z: round(burst.position.z)
    },
    elapsed: round(burst.elapsed),
    duration: round(burst.duration)
  })),
  skyDrops: snapshot.skyDrops.map((skyDrop) => ({
    id: skyDrop.id,
    phase: skyDrop.phase,
    warningRemaining: round(skyDrop.warningRemaining),
    offsetY: round(skyDrop.offsetY),
    landingVoxel: {
      x: skyDrop.landingVoxel.x,
      y: skyDrop.landingVoxel.y,
      z: skyDrop.landingVoxel.z
    }
  })),
  players: snapshot.players.map((player) => ({
    id: player.id,
    alive: player.alive,
    grounded: player.grounded,
    jetpackActive: player.jetpackActive,
    mass: round(player.mass),
    livesRemaining: player.livesRemaining,
    maxLives: player.maxLives,
    respawning: player.respawning,
    invulnerableRemaining: round(player.invulnerableRemaining),
    stunRemaining: round(player.stunRemaining),
    position: {
      x: round(player.position.x),
      y: round(player.position.y),
      z: round(player.position.z)
    },
    velocity: {
      x: round(player.velocity.x),
      y: round(player.velocity.y),
      z: round(player.velocity.z)
    },
    facing: {
      x: round(player.facing.x),
      z: round(player.facing.z)
    }
  }))
});

export const normalizeAuthoritativeMatchState = (
  state: AuthoritativeMatchState
) => ({
  tick: state.tick,
  time: round(state.time),
  mode: state.mode,
  localPlayerId: state.localPlayerId,
  stats: {
    terrainRevision: state.stats.terrainRevision
  },
  ranking: [...state.ranking],
  players: state.players.map((player) => ({
    entityId: player.entityId,
    spawnTick: player.spawnTick,
    visualSeed: player.visualSeed,
    id: player.id,
    name: player.name,
    kind: player.kind,
    alive: player.alive,
    fallingOut: player.fallingOut,
    grounded: player.grounded,
    mass: round(player.mass),
    livesRemaining: player.livesRemaining,
    maxLives: player.maxLives,
    respawning: player.respawning,
    invulnerableRemaining: round(player.invulnerableRemaining),
    stunRemaining: round(player.stunRemaining),
    pushVisualRemaining: round(player.pushVisualRemaining),
    spacePhase: player.spacePhase,
    spacePhaseRemaining: round(player.spacePhaseRemaining),
    position: {
      x: round(player.position.x),
      y: round(player.position.y),
      z: round(player.position.z)
    },
    velocity: {
      x: round(player.velocity.x),
      y: round(player.velocity.y),
      z: round(player.velocity.z)
    },
    facing: {
      x: round(player.facing.x),
      z: round(player.facing.z)
    },
    eggTauntSequence: player.eggTauntSequence,
    eggTauntRemaining: round(player.eggTauntRemaining),
    jetpackActive: player.jetpackActive,
    eliminatedAt: player.eliminatedAt
  })),
  projectiles: state.projectiles.map((projectile) => ({
    entityId: projectile.entityId,
    projectileKind: projectile.projectileKind,
    spawnTick: projectile.spawnTick,
    visualSeed: projectile.visualSeed,
    id: projectile.id,
    ownerId: projectile.ownerId,
    fuseRemaining: round(projectile.fuseRemaining),
    position: {
      x: round(projectile.position.x),
      y: round(projectile.position.y),
      z: round(projectile.position.z)
    },
    velocity: {
      x: round(projectile.velocity.x),
      y: round(projectile.velocity.y),
      z: round(projectile.velocity.z)
    }
  })),
  hazards: {
    fallingClusters: state.hazards.fallingClusters.map((cluster) => ({
      entityId: cluster.entityId,
      spawnTick: cluster.spawnTick,
      visualSeed: cluster.visualSeed,
      id: cluster.id,
      phase: cluster.phase,
      warningRemaining: round(cluster.warningRemaining),
      offsetY: round(cluster.offsetY),
      voxels: cluster.voxels.map((voxel) => ({
        x: voxel.x,
        y: voxel.y,
        z: voxel.z,
        kind: voxel.kind
      }))
    })),
    skyDrops: state.hazards.skyDrops.map((skyDrop) => ({
      entityId: skyDrop.entityId,
      spawnTick: skyDrop.spawnTick,
      visualSeed: skyDrop.visualSeed,
      id: skyDrop.id,
      phase: skyDrop.phase,
      warningRemaining: round(skyDrop.warningRemaining),
      offsetY: round(skyDrop.offsetY),
      landingVoxel: { ...skyDrop.landingVoxel }
    })),
    eggScatterDebris: state.hazards.eggScatterDebris.map((debris) => ({
      entityId: debris.entityId,
      spawnTick: debris.spawnTick,
      visualSeed: debris.visualSeed,
      id: debris.id,
      kind: debris.kind,
      origin: {
        x: round(debris.origin.x),
        y: round(debris.origin.y),
        z: round(debris.origin.z)
      },
      destination: {
        x: round(debris.destination.x),
        y: round(debris.destination.y),
        z: round(debris.destination.z)
      },
      elapsed: round(debris.elapsed),
      duration: round(debris.duration)
    })),
    waterFlood: {
      active: state.hazards.waterFlood.active,
      breachLevelY: state.hazards.waterFlood.breachLevelY,
      currentLevelY: state.hazards.waterFlood.currentLevelY,
      targetLevelY: state.hazards.waterFlood.targetLevelY
    }
  }
});

export const normalizeTerrainDeltaBatch = (batch: TerrainDeltaBatch | null) =>
  batch
    ? {
        tick: batch.tick,
        terrainRevision: batch.terrainRevision,
        changes: batch.changes.map((change) => ({
          voxel: { ...change.voxel },
          kind: change.kind,
          operation: change.operation,
          source: change.source
        }))
      }
    : null;

export const normalizeGameplayEventBatch = (batch: GameplayEventBatch | null) =>
  batch
    ? {
        tick: batch.tick,
        events: batch.events.map((event) => {
          switch (event.type) {
            case "projectile_spawned":
              return {
                ...event,
                position: {
                  x: round(event.position.x),
                  y: round(event.position.y),
                  z: round(event.position.z)
                },
                velocity: {
                  x: round(event.velocity.x),
                  y: round(event.velocity.y),
                  z: round(event.velocity.z)
                }
              };
            case "projectile_hit_resolved":
              return {
                ...event,
                impactPosition: {
                  x: round(event.impactPosition.x),
                  y: round(event.impactPosition.y),
                  z: round(event.impactPosition.z)
                },
                hitPlayerIds: [...event.hitPlayerIds]
              };
            case "explosion_resolved":
              return {
                ...event,
                position: {
                  x: round(event.position.x),
                  y: round(event.position.y),
                  z: round(event.position.z)
                },
                hitPlayerIds: [...event.hitPlayerIds]
              };
            case "player_damaged":
              return {
                ...event,
                stunRemaining: round(event.stunRemaining),
                position: {
                  x: round(event.position.x),
                  y: round(event.position.y),
                  z: round(event.position.z)
                },
                velocity: {
                  x: round(event.velocity.x),
                  y: round(event.velocity.y),
                  z: round(event.velocity.z)
                }
              };
            case "player_eliminated":
              return {
                ...event,
                ranking: [...event.ranking]
              };
            case "terrain_changed":
              return { ...event };
          }
        })
      }
    : null;
