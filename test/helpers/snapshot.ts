import type { SimulationSnapshot } from "@out-of-bounds/sim";

const round = (value: number) => Number(value.toFixed(4));

export const normalizeSnapshot = (snapshot: SimulationSnapshot) => ({
  tick: snapshot.tick,
  time: round(snapshot.time),
  mode: snapshot.mode,
  terrainRevision: snapshot.terrainRevision,
  ranking: [...snapshot.ranking],
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
