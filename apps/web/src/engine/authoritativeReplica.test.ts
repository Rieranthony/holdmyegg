import { describe, expect, it } from "vitest";
import { AuthoritativeReplica } from "./authoritativeReplica";
import type { RuntimeAuthoritativeFrame } from "./types";

const createAuthoritativeFrame = (): RuntimeAuthoritativeFrame => ({
  state: {
    tick: 12,
    time: 0.2,
    mode: "multiplayer",
    localPlayerId: "human-01",
    players: [
      {
        entityId: "human-01",
        spawnTick: 0,
        visualSeed: 101,
        id: "human-01",
        name: "You",
        kind: "human",
        alive: true,
        fallingOut: false,
        grounded: true,
        mass: 84,
        livesRemaining: 3,
        maxLives: 3,
        respawning: false,
        invulnerableRemaining: 0,
        stunRemaining: 0,
        pushVisualRemaining: 0,
        spacePhase: "none",
        spacePhaseRemaining: 0,
        position: { x: 4, y: 2, z: 5 },
        velocity: { x: 0, y: 0, z: 0 },
        facing: { x: 1, z: 0 },
        eggTauntSequence: 0,
        eggTauntRemaining: 0,
        jetpackActive: false,
        eliminatedAt: null
      }
    ],
    projectiles: [
      {
        entityId: "egg-1",
        projectileKind: "egg",
        spawnTick: 12,
        visualSeed: 202,
        id: "egg-1",
        ownerId: "human-01",
        fuseRemaining: 1.2,
        position: { x: 5, y: 3, z: 5 },
        velocity: { x: 4, y: 3, z: 0 }
      }
    ],
    hazards: {
      fallingClusters: [],
      skyDrops: [],
      eggScatterDebris: [],
      waterFlood: {
        active: false,
        breachLevelY: 0,
        currentLevelY: 0,
        targetLevelY: 0
      }
    },
    stats: {
      terrainRevision: 9
    },
    ranking: ["human-01"]
  },
  terrainDeltaBatch: {
    tick: 12,
    terrainRevision: 9,
    changes: [
      {
        voxel: { x: 7, y: 2, z: 8 },
        kind: null,
        operation: "remove",
        source: "projectile_explosion"
      }
    ],
    propChanges: [
      {
        id: "prop-1",
        kind: "tree-pine",
        x: 9,
        y: 1,
        z: 9,
        operation: "remove"
      }
    ]
  },
  gameplayEventBatch: {
    tick: 12,
    events: [
      {
        type: "projectile_spawned",
        entityId: "egg-1",
        projectileKind: "egg",
        ownerId: "human-01",
        spawnTick: 12,
        visualSeed: 202,
        position: { x: 5, y: 3, z: 5 },
        velocity: { x: 4, y: 3, z: 0 }
      },
      {
        type: "terrain_changed",
        entityId: "terrain-1",
        terrainRevision: 9,
        source: "projectile_explosion",
        changeCount: 1
      }
    ]
  }
});

describe("AuthoritativeReplica", () => {
  it("applies authoritative state and exposes the local player view", () => {
    const replica = new AuthoritativeReplica();

    replica.applyFrame(createAuthoritativeFrame());

    expect(replica.getState()).toMatchObject({
      tick: 12,
      mode: "multiplayer",
      localPlayerId: "human-01",
      ranking: ["human-01"]
    });
    expect(replica.getLocalPlayer()).toMatchObject({
      id: "human-01",
      entityId: "human-01",
      position: { x: 4, y: 2, z: 5 }
    });
  });

  it("clones authoritative payloads so local mutations do not leak back in", () => {
    const replica = new AuthoritativeReplica();
    const frame = createAuthoritativeFrame();

    replica.applyFrame(frame);
    frame.state.players[0]!.position.x = 99;
    frame.terrainDeltaBatch!.changes[0]!.voxel.x = 42;
    frame.terrainDeltaBatch!.propChanges[0]!.id = "prop-99";
    if (frame.gameplayEventBatch?.events[0]?.type === "projectile_spawned") {
      frame.gameplayEventBatch.events[0].position.x = 77;
    }

    expect(replica.getState()?.players[0]?.position.x).toBe(4);
    expect(replica.peekTerrainDeltaBatch()?.changes[0]?.voxel.x).toBe(7);
    expect(replica.peekTerrainDeltaBatch()?.propChanges[0]?.id).toBe("prop-1");
    const gameplayBatch = replica.peekGameplayEventBatch();
    expect(gameplayBatch?.events[0]?.type).toBe("projectile_spawned");
    if (gameplayBatch?.events[0]?.type === "projectile_spawned") {
      expect(gameplayBatch.events[0].position.x).toBe(5);
    }
  });

  it("lets the renderer consume terrain and gameplay batches independently", () => {
    const replica = new AuthoritativeReplica();

    replica.applyFrame(createAuthoritativeFrame());

    expect(replica.consumeTerrainDeltaBatch()).toMatchObject({
      terrainRevision: 9
    });
    expect(replica.consumeTerrainDeltaBatch()).toBeNull();
    expect(replica.consumeGameplayEventBatch()?.events).toHaveLength(2);
    expect(replica.consumeGameplayEventBatch()).toBeNull();
  });
});
