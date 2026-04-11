import { describe, expect, it, vi } from "vitest";
import {
  defaultSimulationConfig,
  type PlayerCommand,
  OutOfBoundsSimulation
} from "@out-of-bounds/sim";
import {
  createDefaultArenaMap,
  DEFAULT_SURFACE_Y,
  DEFAULT_WATERLINE_Y,
  SEA_LEVEL_Y,
  WORLD_FLOOR_Y,
  getMapPropVoxels
} from "@out-of-bounds/map";
import { createArenaDocument } from "@test/fixtures/maps";
import { destroy, idle, jump, layEgg, move, place, push } from "@test/helpers/commands";
import {
  advanceSimulation,
  advanceUntilGrounded,
  createTestSimulation,
  createTestWorld
} from "@test/helpers/simulation";
import {
  normalizeAuthoritativeMatchState,
  normalizeGameplayEventBatch,
  normalizeSnapshot,
  normalizeTerrainDeltaBatch
} from "@test/helpers/snapshot";

const getInternalPlayer = (simulation: OutOfBoundsSimulation, playerId: string) =>
  ((simulation as unknown as { players: Map<string, any> }).players.get(playerId) as {
    alive: boolean;
    fallingOut: boolean;
    grounded: boolean;
    jetpackEligible: boolean;
    jetpackActive: boolean;
    jetpackOutsideBoundsGrace: boolean;
    mass: number;
    livesRemaining: number;
    respawning: boolean;
    respawnRemaining: number;
    invulnerableRemaining: number;
    stunRemaining: number;
    position: { x: number; y: number; z: number };
    velocity: { x: number; y: number; z: number };
    facing: { x: number; z: number };
    jumpBufferRemaining: number;
    jetpackHoldActivationRemaining: number;
    pushCooldownRemaining: number;
    pushVisualRemaining: number;
    spacePhase: "none" | "float" | "reentry" | "superBoomDive" | "superBoomImpact";
    spacePhaseRemaining: number;
    spaceTriggerArmed: boolean;
    spaceChallengeTargetKey: string | null;
    spaceChallengeHits: number;
    spaceChallengeRequiredHits: number;
    spaceChallengePreviousKey: string | null;
  });

const getNpcId = (simulation: OutOfBoundsSimulation) =>
  simulation.getSnapshot().players.find((player) => player.kind === "npc")?.id ?? null;

const getNpcIds = (simulation: OutOfBoundsSimulation) =>
  simulation
    .getSnapshot()
    .players.filter((player) => player.kind === "npc")
    .map((player) => player.id);

const getNpcMemory = (simulation: OutOfBoundsSimulation, playerId: string) =>
  ((simulation as unknown as { npcMemories: Map<string, any> }).npcMemories.get(playerId) as {
    intentRemaining: number;
    targetPlayerId: string | null;
    targetLockRemaining: number;
  });

const getInternalEggMap = (simulation: OutOfBoundsSimulation) =>
  (simulation as unknown as { eggs: Map<string, any> }).eggs;

const getSimulationInternals = (simulation: OutOfBoundsSimulation) =>
  simulation as unknown as {
    explodeEgg: (egg: any) => void;
    fillWaterFloodReachableCells: () => void;
    resolveSuperBoomImpact: (player: any) => void;
    setTerrainVoxels: (
      voxels: Array<{ x: number; y: number; z: number; kind: "water" }>,
      source: "water_flood",
    ) => void;
    triggerWaterFloodAt: (voxel: { x: number; y: number; z: number }) => boolean;
    waterFlood: {
      active: boolean;
      breachSeedKeys: Set<string>;
      autoFloodVoxelKeys: Set<string>;
    };
  };

const getHorizontalDistance = (
  left: { position: { x: number; z: number } },
  right: { position: { x: number; z: number } }
) => Math.hypot(left.position.x - right.position.x, left.position.z - right.position.z);

const getSpawnQuadrant = (
  worldSize: { x: number; z: number },
  position: { x: number; z: number }
) => {
  const east = position.x >= worldSize.x / 2;
  const south = position.z >= worldSize.z / 2;
  if (!east && !south) {
    return "nw" as const;
  }

  if (east && !south) {
    return "ne" as const;
  }

  if (!east && south) {
    return "sw" as const;
  }

  return "se" as const;
};

const getDiagonalOppositeQuadrant = (quadrant: "nw" | "ne" | "sw" | "se") =>
  ({
    nw: "se",
    ne: "sw",
    sw: "ne",
    se: "nw"
  })[quadrant];

const normalizeAngle = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

const getYaw = (facing: { x: number; z: number }) => Math.atan2(facing.x, facing.z);
const PLAYER_GROUND_Y = DEFAULT_SURFACE_Y + 0.05;
const SURFACE_TOP_Y = DEFAULT_SURFACE_Y - 1;
const FLOATING_TEST_Y = DEFAULT_SURFACE_Y + 3;
const COLLAPSE_SUPPORT_Y = FLOATING_TEST_Y;

const createCollapseSimulation = () => {
  const simulation = new OutOfBoundsSimulation({
    skyDropIntervalMin: 999,
    skyDropIntervalMax: 999
  });
  simulation.reset(
    "explore",
    createArenaDocument((world) => {
      world.setVoxel(10, DEFAULT_SURFACE_Y, 10, "boundary");
      world.setVoxel(10, DEFAULT_SURFACE_Y + 1, 10, "boundary");
      world.setVoxel(10, DEFAULT_SURFACE_Y + 2, 10, "boundary");
      world.setVoxel(10, COLLAPSE_SUPPORT_Y, 10, "boundary");
      world.setVoxel(11, FLOATING_TEST_Y, 10, "ground");
      world.setVoxel(12, FLOATING_TEST_Y, 10, "ground");
      world.setVoxel(13, FLOATING_TEST_Y, 10, "ground");
    }),
    {
      localPlayerName: "You"
    }
  );

  const localPlayerId = simulation.getLocalPlayerId()!;
  const localPlayer = getInternalPlayer(simulation, localPlayerId);
  localPlayer.position = { x: 9.2, y: PLAYER_GROUND_Y, z: 10.5 };
  localPlayer.velocity = { x: 0, y: 0, z: 0 };
  localPlayer.facing = { x: 1, z: 0 };
  localPlayer.grounded = true;

  return {
    simulation,
    localPlayerId,
    localPlayer
  };
};

const createMultiplayerSlots = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: `human-${String(index + 1).padStart(2, "0")}`,
    name: `Player ${index + 1}`
  }));

const createMultiplayerSimulation = (
  playerCount: number,
  overrides: ConstructorParameters<typeof OutOfBoundsSimulation>[0] = {}
) => {
  const simulation = new OutOfBoundsSimulation({
    skyDropIntervalMin: 999,
    skyDropIntervalMax: 999,
    ...overrides
  });
  const humanPlayers = createMultiplayerSlots(playerCount);
  simulation.reset("multiplayer", createArenaDocument(), {
    humanPlayers,
    localPlayerId: humanPlayers[0]!.id,
    localPlayerName: humanPlayers[0]!.name,
    initialSpawnSeed: 11
  });

  return {
    simulation,
    humanPlayers
  };
};

const createBurningTreeSimulation = (kind: "tree-oak" | "tree-pine" | "tree-autumn" = "tree-oak") => {
  const world = createTestWorld((voxelWorld) => {
    voxelWorld.setProp(kind, 8, DEFAULT_SURFACE_Y, 6);
  });
  const simulation = new OutOfBoundsSimulation({
    tickRate: 10,
    skyDropIntervalMin: 999,
    skyDropIntervalMax: 999
  });
  simulation.reset("explore", world.toDocument(), {
    localPlayerName: "You"
  });
  return simulation;
};

const createExplosionEgg = (
  simulation: OutOfBoundsSimulation,
  id: string,
  position: { x: number; y: number; z: number }
) => {
  const egg = {
    id,
    ownerId: simulation.getLocalPlayerId()!,
    spawnTick: 0,
    visualSeed: 1,
    fuseRemaining: 0,
    grounded: false,
    orbital: false,
    explodeOnGroundContact: false,
    fuseArmedBelowY: null,
    position,
    velocity: { x: 0, y: 0, z: 0 }
  };
  getInternalEggMap(simulation).set(egg.id, egg);
  return egg;
};

describe("OutOfBoundsSimulation", () => {
  it("resets into predictable snapshots and spawns players", () => {
    const simulation = createTestSimulation("playNpc");
    const snapshot = simulation.getSnapshot();
    const localPlayerId = simulation.getLocalPlayerId();

    expect(snapshot.mode).toBe("playNpc");
    expect(localPlayerId).toBe("human-1");
    expect(snapshot.players.length).toBe(10);
    expect(snapshot.localPlayerId).toBe(localPlayerId);
    advanceSimulation(simulation, 30);
    expect(simulation.getPlayerState(localPlayerId!)?.alive).toBe(true);
  });

  it("auto-spreads overflow spawn positions in playNpc matches", () => {
    const simulation = createTestSimulation("playNpc");
    const players = simulation.getSnapshot().players;

    expect(players).toHaveLength(10);
    for (let index = 0; index < players.length; index += 1) {
      for (let otherIndex = index + 1; otherIndex < players.length; otherIndex += 1) {
        const distance = Math.hypot(
          players[index]!.position.x - players[otherIndex]!.position.x,
          players[index]!.position.z - players[otherIndex]!.position.z
        );
        expect(distance).toBeGreaterThan(1.6);
      }
    }
  });

  it("starts the human on one seeded side and keeps NPCs on the opposite quadrants", () => {
    const simulation = new OutOfBoundsSimulation();
    simulation.reset("playNpc", createArenaDocument(), {
      npcCount: 9,
      localPlayerName: "You",
      initialSpawnSeed: 17
    });

    const snapshot = simulation.getSnapshot();
    const localPlayer = snapshot.players.find((player) => player.id === simulation.getLocalPlayerId())!;
    const npcPlayers = snapshot.players.filter((player) => player.kind === "npc");
    const humanQuadrant = getSpawnQuadrant(simulation.getWorld().size, localPlayer.position);
    const oppositeQuadrant = getDiagonalOppositeQuadrant(humanQuadrant);

    expect(npcPlayers).toHaveLength(9);
    expect(npcPlayers.every((player) => getSpawnQuadrant(simulation.getWorld().size, player.position) !== humanQuadrant)).toBe(true);
    expect(npcPlayers.some((player) => getSpawnQuadrant(simulation.getWorld().size, player.position) === oppositeQuadrant)).toBe(true);
  });

  it("supports sky-drop entry without changing the default grounded spawn flow", () => {
    const map = createArenaDocument();
    const groundedSimulation = new OutOfBoundsSimulation();
    groundedSimulation.reset("explore", map, {
      localPlayerName: "You"
    });

    const skySimulation = new OutOfBoundsSimulation();
    skySimulation.reset("explore", map, {
      localPlayerName: "You",
      initialSpawnStyle: "sky"
    });

    const groundedPlayerId = groundedSimulation.getLocalPlayerId()!;
    const skyPlayerId = skySimulation.getLocalPlayerId()!;
    const groundedPlayer = groundedSimulation.getPlayerState(groundedPlayerId)!;
    const skyPlayer = skySimulation.getPlayerState(skyPlayerId)!;

    expect(groundedPlayer.position.y).toBeLessThan(skyPlayer.position.y);
    expect(skyPlayer.position.y - groundedPlayer.position.y).toBeCloseTo(
      skySimulation.config.skyDropSpawnHeight,
      5
    );
    expect(groundedPlayer.velocity.y).toBe(0);
    expect(skyPlayer.velocity.y).toBeLessThan(0);

    advanceSimulation(skySimulation, 6);
    expect(skySimulation.getPlayerState(skyPlayerId)!.position.y).toBeLessThan(skyPlayer.position.y);

    const respawnedPlayer = getInternalPlayer(skySimulation, skyPlayerId);
    (skySimulation as unknown as { respawnPlayer: (player: typeof respawnedPlayer) => void }).respawnPlayer(respawnedPlayer);
    expect(respawnedPlayer.position.y - groundedPlayer.position.y).toBeCloseTo(
      skySimulation.config.skyDropSpawnHeight,
      5
    );
    expect(respawnedPlayer.velocity.y).toBeLessThan(0);
  });

  it("fills waterline breaches immediately and expands as the cavity grows", () => {
    const simulation = createTestSimulation("explore");
    const localPlayerId = simulation.getLocalPlayerId()!;
    const localPlayer = getInternalPlayer(simulation, localPlayerId);
    localPlayer.position = { x: 10.5, y: PLAYER_GROUND_Y, z: 10.5 };
    localPlayer.velocity = { x: 0, y: 0, z: 0 };
    localPlayer.facing = { x: 1, z: 0 };
    localPlayer.grounded = true;
    localPlayer.mass = 120;

    for (const y of [SURFACE_TOP_Y, SURFACE_TOP_Y - 1, SURFACE_TOP_Y - 2]) {
      simulation.step({
        [localPlayerId]: destroy({
          targetVoxel: { x: 12, y, z: 10 }
        })
      });
    }

    expect(simulation.getSnapshot().waterFlood).toEqual({
      active: true,
      breachLevelY: DEFAULT_WATERLINE_Y,
      currentLevelY: DEFAULT_WATERLINE_Y,
      targetLevelY: DEFAULT_WATERLINE_Y
    });
    expect(simulation.getWorld().getVoxelKind(12, DEFAULT_WATERLINE_Y, 10)).toBe("water");
    expect(simulation.getWorld().getVoxelKind(12, DEFAULT_WATERLINE_Y - 1, 10)).toBe("water");

    localPlayer.position = { x: 11.5, y: DEFAULT_WATERLINE_Y - 0.95, z: 10.5 };
    localPlayer.velocity = { x: 0, y: 0, z: 0 };
    localPlayer.grounded = true;

    simulation.step({
      [localPlayerId]: destroy({
        targetVoxel: { x: 13, y: DEFAULT_WATERLINE_Y, z: 10 }
      })
    });

    localPlayer.position = { x: 11.5, y: DEFAULT_WATERLINE_Y - 1.95, z: 10.5 };
    localPlayer.velocity = { x: 0, y: 0, z: 0 };
    localPlayer.grounded = true;

    simulation.step({
      [localPlayerId]: destroy({
        targetVoxel: { x: 13, y: DEFAULT_WATERLINE_Y - 1, z: 10 }
      })
    });

    expect(simulation.getWorld().getVoxelKind(13, DEFAULT_WATERLINE_Y, 10)).toBe("water");
    expect(simulation.getWorld().getVoxelKind(13, DEFAULT_WATERLINE_Y - 1, 10)).toBe("water");
    expect(simulation.getSnapshot().waterFlood.currentLevelY).toBe(DEFAULT_WATERLINE_Y);
    expect(simulation.getWorld().getVoxelKind(13, WORLD_FLOOR_Y, 10)).not.toBe("water");
  });

  it("fills waterline gaps after projectile explosions", () => {
    const simulation = createTestSimulation("explore", (world) => {
      for (const y of [SURFACE_TOP_Y, DEFAULT_WATERLINE_Y]) {
        world.removeVoxel(12, y, 10);
      }
    });
    const localPlayerId = simulation.getLocalPlayerId()!;
    const egg = {
      id: "sea-level-egg",
      ownerId: localPlayerId,
      spawnTick: 0,
      visualSeed: 1,
      fuseRemaining: 0,
      grounded: false,
      orbital: false,
      explodeOnGroundContact: false,
      fuseArmedBelowY: null,
      position: { x: 12.5, y: DEFAULT_WATERLINE_Y - 0.5, z: 10.5 },
      velocity: { x: 0, y: 0, z: 0 }
    };

    getInternalEggMap(simulation).set(egg.id, egg);
    getSimulationInternals(simulation).explodeEgg(egg);

    const terrainBatch = simulation.consumeTerrainDeltaBatch();
    expect(terrainBatch?.changes.some((change) => change.source === "projectile_explosion")).toBe(true);
    expect(terrainBatch?.changes.some((change) => change.source === "water_flood")).toBe(true);
    expect(simulation.getWorld().getVoxelKind(12, DEFAULT_WATERLINE_Y, 10)).toBe("water");
    expect(simulation.getWorld().getVoxelKind(12, DEFAULT_WATERLINE_Y - 1, 10)).toBe("water");
  });

  it("fills waterline gaps after super boom explosions", () => {
    const simulation = createTestSimulation("explore", (world) => {
      for (const y of [SURFACE_TOP_Y, DEFAULT_WATERLINE_Y]) {
        world.removeVoxel(12, y, 10);
      }
    });
    const localPlayerId = simulation.getLocalPlayerId()!;
    const localPlayer = getInternalPlayer(simulation, localPlayerId);

    localPlayer.position = { x: 12.5, y: DEFAULT_WATERLINE_Y - 0.5, z: 10.5 };
    localPlayer.velocity = { x: 0, y: 0, z: 0 };
    localPlayer.grounded = false;

    getSimulationInternals(simulation).resolveSuperBoomImpact(localPlayer);

    const terrainBatch = simulation.consumeTerrainDeltaBatch();
    expect(terrainBatch?.changes.some((change) => change.source === "super_boom_explosion")).toBe(true);
    expect(terrainBatch?.changes.some((change) => change.source === "water_flood")).toBe(true);
    expect(simulation.getWorld().getVoxelKind(12, DEFAULT_WATERLINE_Y, 10)).toBe("water");
    expect(simulation.getWorld().getVoxelKind(12, DEFAULT_WATERLINE_Y - 1, 10)).toBe("water");
  });

  it("keeps water voxels intact during explosions", () => {
    const simulation = createTestSimulation("explore", (world) => {
      world.removeVoxel(12, SURFACE_TOP_Y, 10);
      world.setVoxel(12, DEFAULT_WATERLINE_Y, 10, "water");
      world.setVoxel(12, DEFAULT_WATERLINE_Y - 1, 10, "water");
    });
    const localPlayerId = simulation.getLocalPlayerId()!;
    const egg = {
      id: "water-safe-egg",
      ownerId: localPlayerId,
      spawnTick: 0,
      visualSeed: 1,
      fuseRemaining: 0,
      grounded: false,
      orbital: false,
      explodeOnGroundContact: false,
      fuseArmedBelowY: null,
      position: { x: 12.5, y: DEFAULT_WATERLINE_Y - 0.2, z: 10.5 },
      velocity: { x: 0, y: 0, z: 0 }
    };

    getInternalEggMap(simulation).set(egg.id, egg);
    getSimulationInternals(simulation).explodeEgg(egg);

    expect(simulation.getWorld().getVoxelKind(12, DEFAULT_WATERLINE_Y, 10)).toBe("water");
    expect(simulation.getWorld().getVoxelKind(12, DEFAULT_WATERLINE_Y - 1, 10)).toBe("water");
  });

  it("ignores authored water above the waterline as an automatic flood source", () => {
    const simulation = createTestSimulation("explore", (world) => {
      world.removeVoxel(20, DEFAULT_WATERLINE_Y, 20);
      world.setVoxel(20, DEFAULT_WATERLINE_Y + 1, 20, "water");
    });
    const internals = getSimulationInternals(simulation);

    internals.waterFlood.active = true;
    internals.fillWaterFloodReachableCells();

    expect(simulation.getWorld().getVoxelKind(20, DEFAULT_WATERLINE_Y, 20)).toBeUndefined();
  });

  it("removes tree props when flood-sourced water replaces their support voxel", () => {
    const simulation = createTestSimulation("explore", (world) => {
      const treeOrigin = { kind: "tree-oak" as const, x: 20, y: WORLD_FLOOR_Y + 1, z: 20 };
      for (const voxel of getMapPropVoxels(treeOrigin)) {
        world.removeVoxel(voxel.x, voxel.y, voxel.z);
      }
      world.setProp("tree-oak", treeOrigin.x, treeOrigin.y, treeOrigin.z);
    });
    const internals = getSimulationInternals(simulation);

    internals.setTerrainVoxels(
      [{ x: 20, y: WORLD_FLOOR_Y, z: 20, kind: "water" }],
      "water_flood"
    );
    const terrainBatch = simulation.consumeTerrainDeltaBatch();

    expect(simulation.getWorld().getVoxelKind(20, WORLD_FLOOR_Y, 20)).toBe("water");
    expect(simulation.getWorld().getPropAtVoxel(20, WORLD_FLOOR_Y + 1, 20)).toBeUndefined();
    expect(terrainBatch?.propChanges).toContainEqual({
      id: "prop-1",
      kind: "tree-oak",
      x: 20,
      y: 1,
      z: 20,
      operation: "remove"
    });
  });

  it("treats the deepest water band as lethal", () => {
    const simulation = createTestSimulation("explore", (world) => {
      world.removeVoxel(10, SURFACE_TOP_Y, 10);
      world.removeVoxel(10, DEFAULT_WATERLINE_Y, 10);
      world.removeVoxel(10, DEFAULT_WATERLINE_Y - 1, 10);
      world.removeVoxel(10, DEFAULT_WATERLINE_Y - 2, 10);
      world.setVoxel(10, DEFAULT_WATERLINE_Y, 10, "water");
      world.setVoxel(10, DEFAULT_WATERLINE_Y - 1, 10, "water");
      world.setVoxel(10, DEFAULT_WATERLINE_Y - 2, 10, "water");
    });
    const localPlayerId = simulation.getLocalPlayerId()!;
    const localPlayer = getInternalPlayer(simulation, localPlayerId);

    localPlayer.position = { x: 10.5, y: WORLD_FLOOR_Y + 0.35, z: 10.5 };
    localPlayer.velocity = { x: 0, y: 0, z: 0 };
    localPlayer.grounded = false;

    simulation.step({
      [localPlayerId]: idle()
    });

    expect(simulation.getPlayerState(localPlayerId)!.livesRemaining).toBe(
      simulation.config.startingLives - 1
    );
    expect(simulation.getPlayerViewState(localPlayerId)!.respawning).toBe(true);
  });

  it("keeps the default waterfall basin shallow enough to survive while still behaving like water", () => {
    const createDefaultArenaSimulation = () => {
      const simulation = new OutOfBoundsSimulation();
      simulation.reset("explore", createDefaultArenaMap(), {
        localPlayerName: "You"
      });
      return simulation;
    };

    const drySimulation = createDefaultArenaSimulation();
    const wetSimulation = createDefaultArenaSimulation();
    const dryPlayerId = drySimulation.getLocalPlayerId()!;
    const wetPlayerId = wetSimulation.getLocalPlayerId()!;
    const dryPlayer = getInternalPlayer(drySimulation, dryPlayerId);
    const wetPlayer = getInternalPlayer(wetSimulation, wetPlayerId);

    dryPlayer.position = { x: 20.5, y: 4.05, z: 20.5 };
    dryPlayer.velocity = { x: 0, y: 0, z: 0 };
    dryPlayer.facing = { x: 1, z: 0 };
    dryPlayer.grounded = true;

    wetPlayer.position = { x: 10.5, y: DEFAULT_WATERLINE_Y - 1 + 0.35, z: 10.5 };
    wetPlayer.velocity = { x: 0, y: 0, z: 0 };
    wetPlayer.facing = { x: 1, z: 0 };
    wetPlayer.grounded = true;

    advanceSimulation(drySimulation, 30, {
      [dryPlayerId]: move(1, 0, { lookX: 1, lookZ: 0 })
    });
    advanceSimulation(wetSimulation, 30, {
      [wetPlayerId]: move(1, 0, { lookX: 1, lookZ: 0 })
    });

    expect(wetSimulation.getPlayerState(wetPlayerId)!.livesRemaining).toBe(
      wetSimulation.config.startingLives
    );
    expect(wetSimulation.getPlayerViewState(wetPlayerId)!.respawning).toBe(false);
    expect(wetSimulation.getPlayerState(wetPlayerId)!.position.x).toBeLessThan(
      drySimulation.getPlayerState(dryPlayerId)!.position.x
    );
  });

  it("slows players while they move through water", () => {
    const createMovementSimulation = (withWater: boolean) =>
      createTestSimulation("explore", (world) => {
        if (!withWater) {
          return;
        }

        for (let x = 10; x <= 14; x += 1) {
          world.setVoxel(x, DEFAULT_SURFACE_Y, 10, "water");
        }
      });

    const drySimulation = createMovementSimulation(false);
    const wetSimulation = createMovementSimulation(true);
    const dryPlayerId = drySimulation.getLocalPlayerId()!;
    const wetPlayerId = wetSimulation.getLocalPlayerId()!;
    const dryPlayer = getInternalPlayer(drySimulation, dryPlayerId);
    const wetPlayer = getInternalPlayer(wetSimulation, wetPlayerId);

    dryPlayer.position = { x: 10.5, y: PLAYER_GROUND_Y, z: 10.5 };
    dryPlayer.velocity = { x: 0, y: 0, z: 0 };
    dryPlayer.facing = { x: 1, z: 0 };
    dryPlayer.grounded = true;

    wetPlayer.position = { x: 10.5, y: PLAYER_GROUND_Y, z: 10.5 };
    wetPlayer.velocity = { x: 0, y: 0, z: 0 };
    wetPlayer.facing = { x: 1, z: 0 };
    wetPlayer.grounded = true;

    advanceSimulation(drySimulation, 30, {
      [dryPlayerId]: move(1, 0, { lookX: 1, lookZ: 0 })
    });
    advanceSimulation(wetSimulation, 30, {
      [wetPlayerId]: move(1, 0, { lookX: 1, lookZ: 0 })
    });

    expect(wetSimulation.getPlayerViewState(wetPlayerId)!.position.x).toBeLessThan(
      drySimulation.getPlayerViewState(dryPlayerId)!.position.x - 0.4
    );
  });

  it("adds extra drag to eggs in water", () => {
    const createEggSimulation = (withWater: boolean) =>
      createTestSimulation("explore", (world) => {
        if (!withWater) {
          return;
        }

        world.setVoxel(10, DEFAULT_SURFACE_Y, 10, "water");
        world.setVoxel(11, DEFAULT_SURFACE_Y, 10, "water");
      });

    const drySimulation = createEggSimulation(false);
    const wetSimulation = createEggSimulation(true);
    getInternalEggMap(drySimulation).set("egg-dry", {
      id: "egg-dry",
      ownerId: drySimulation.getLocalPlayerId()!,
      spawnTick: 0,
      visualSeed: 1,
      fuseRemaining: 10,
      grounded: false,
      orbital: false,
      explodeOnGroundContact: false,
      fuseArmedBelowY: null,
      position: { x: 10.5, y: DEFAULT_SURFACE_Y + 0.4, z: 10.5 },
      velocity: { x: 4, y: 0, z: 0 }
    });
    getInternalEggMap(wetSimulation).set("egg-wet", {
      id: "egg-wet",
      ownerId: wetSimulation.getLocalPlayerId()!,
      spawnTick: 0,
      visualSeed: 1,
      fuseRemaining: 10,
      grounded: false,
      orbital: false,
      explodeOnGroundContact: false,
      fuseArmedBelowY: null,
      position: { x: 10.5, y: DEFAULT_SURFACE_Y + 0.4, z: 10.5 },
      velocity: { x: 4, y: 0, z: 0 }
    });

    advanceSimulation(drySimulation, 10);
    advanceSimulation(wetSimulation, 10);

    expect(drySimulation.getEggState("egg-dry")!.velocity.x).toBeGreaterThan(
      wetSimulation.getEggState("egg-wet")!.velocity.x + 0.5
    );
  });

  it("supports multiplayer reset with stable human slots from 2 to 24 players", () => {
    for (const playerCount of [2, 8, 16, 24]) {
      const humanPlayers = createMultiplayerSlots(playerCount);
      const simulation = new OutOfBoundsSimulation();
      simulation.reset("multiplayer", createArenaDocument(), {
        humanPlayers,
        localPlayerId: humanPlayers[Math.min(2, humanPlayers.length - 1)]!.id,
        initialSpawnSeed: 17
      });

      const authoritativeState = simulation.getAuthoritativeMatchState(
        humanPlayers[Math.min(2, humanPlayers.length - 1)]!.id
      );

      expect(authoritativeState.mode).toBe("multiplayer");
      expect(authoritativeState.localPlayerId).toBe(
        humanPlayers[Math.min(2, humanPlayers.length - 1)]!.id
      );
      expect(authoritativeState.players).toHaveLength(playerCount);
      expect(authoritativeState.players.every((player) => player.kind === "human")).toBe(
        true
      );
      expect(new Set(authoritativeState.players.map((player) => player.id)).size).toBe(
        playerCount
      );
      expect(
        authoritativeState.players.every(
          (player) =>
            player.entityId === player.id &&
            player.spawnTick === 0 &&
            Number.isInteger(player.visualSeed)
        )
      ).toBe(true);
      expect(authoritativeState.ranking).toHaveLength(playerCount);
    }
  });

  it("exposes lightweight match, hud, and player selectors", () => {
    const simulation = createTestSimulation("playNpc");
    const localPlayerId = simulation.getLocalPlayerId()!;
    advanceUntilGrounded(simulation, localPlayerId);
    getInternalPlayer(simulation, localPlayerId).mass = simulation.config.eggCost + 12;

    const matchState = simulation.getMatchState();
    const hudState = simulation.getHudState();
    const playerState = simulation.getPlayerState(localPlayerId);

    expect(matchState.playerIds).toContain(localPlayerId);
    expect(matchState.players.some((player) => player.kind === "npc")).toBe(true);
    expect("map" in matchState).toBe(false);
    expect(hudState.localPlayer?.id).toBe(localPlayerId);
    expect(hudState.eggStatus).toEqual({
      reason: "ready",
      hasMatter: true,
      ready: true,
      activeCount: 0,
      maxActiveCount: simulation.config.maxActiveEggsPerPlayer,
      cost: simulation.config.eggCost,
      cooldownRemaining: 0,
      cooldownDuration: simulation.config.eggFuseDuration,
      canQuickEgg: true,
      canChargedThrow: true
    });
    expect(hudState.ranking.length).toBe(matchState.ranking.length);
    expect(playerState?.id).toBe(localPlayerId);
  });

  it("produces deterministic authoritative state, terrain deltas, and gameplay events for the same multiplayer command stream", () => {
    const createPreparedSimulation = () => {
      const { simulation, humanPlayers } = createMultiplayerSimulation(2, {
        eggFuseDuration: 0.2
      });
      const attacker = getInternalPlayer(simulation, humanPlayers[0]!.id);
      const defender = getInternalPlayer(simulation, humanPlayers[1]!.id);
      attacker.position = { x: 20.5, y: PLAYER_GROUND_Y, z: 20.5 };
      attacker.velocity = { x: 0, y: 0, z: 0 };
      attacker.facing = { x: 1, z: 0 };
      attacker.grounded = true;
      attacker.mass = 220;
      defender.position = { x: 23.1, y: PLAYER_GROUND_Y, z: 20.5 };
      defender.velocity = { x: 0, y: 0, z: 0 };
      defender.facing = { x: -1, z: 0 };
      defender.grounded = true;
      defender.mass = 220;
      return {
        simulation,
        humanPlayers
      };
    };
    const first = createPreparedSimulation();
    const second = createPreparedSimulation();
    const attackerId = first.humanPlayers[0]!.id;
    const defenderId = first.humanPlayers[1]!.id;

    const commandStream = (frame: number): Record<string, PlayerCommand> => {
      if (frame === 0) {
        return {
          [attackerId]: layEgg({
            lookX: 1,
            lookZ: 0
          }),
          [defenderId]: idle()
        };
      }

      return {
        [attackerId]: idle({
          lookX: 1,
          lookZ: 0
        }),
        [defenderId]: idle({
          lookX: -1,
          lookZ: 0
        })
      };
    };

    advanceSimulation(first.simulation, 32, commandStream);
    advanceSimulation(second.simulation, 32, commandStream);

    expect(
      normalizeAuthoritativeMatchState(first.simulation.getAuthoritativeMatchState(attackerId))
    ).toEqual(
      normalizeAuthoritativeMatchState(second.simulation.getAuthoritativeMatchState(attackerId))
    );
    expect(
      normalizeTerrainDeltaBatch(first.simulation.consumeTerrainDeltaBatch())
    ).toEqual(normalizeTerrainDeltaBatch(second.simulation.consumeTerrainDeltaBatch()));
    expect(
      normalizeGameplayEventBatch(first.simulation.consumeGameplayEventBatch())
    ).toEqual(normalizeGameplayEventBatch(second.simulation.consumeGameplayEventBatch()));
  });

  it("keeps projectile hits server-authored and resolves them after spawn, not at launch input time", () => {
    const { simulation, humanPlayers } = createMultiplayerSimulation(2, {
      eggFuseDuration: 0.2
    });
    const attackerId = humanPlayers[0]!.id;
    const defenderId = humanPlayers[1]!.id;
    const attacker = getInternalPlayer(simulation, attackerId);
    const defender = getInternalPlayer(simulation, defenderId);
    attacker.position = { x: 24.5, y: PLAYER_GROUND_Y, z: 24.5 };
    attacker.velocity = { x: 0, y: 0, z: 0 };
    attacker.facing = { x: 1, z: 0 };
    attacker.grounded = true;
    attacker.mass = 220;
    defender.position = { x: 26.4, y: PLAYER_GROUND_Y, z: 24.5 };
    defender.velocity = { x: 0, y: 0, z: 0 };
    defender.grounded = true;

    simulation.step({
      [attackerId]: layEgg({
        lookX: 1,
        lookZ: 0
      }),
      [defenderId]: idle()
    });

    const spawnBatch = simulation.consumeGameplayEventBatch();
    expect(spawnBatch?.events.map((event) => event.type)).toContain("projectile_spawned");
    expect(
      spawnBatch?.events.some(
        (event) =>
          event.type === "projectile_hit_resolved" ||
          event.type === "explosion_resolved"
      )
    ).toBe(false);

    advanceSimulation(simulation, 24, {
      [attackerId]: idle({
        lookX: 1,
        lookZ: 0
      }),
      [defenderId]: idle()
    });

    const resolutionBatch = simulation.consumeGameplayEventBatch();
    expect(
      resolutionBatch?.events.some(
        (event) => event.type === "projectile_hit_resolved"
      )
    ).toBe(true);
    expect(
      resolutionBatch?.events.some((event) => event.type === "explosion_resolved")
    ).toBe(true);
  });

  it("emits authoritative explosion damage, elimination, terrain deltas, and ranking updates", () => {
    const { simulation, humanPlayers } = createMultiplayerSimulation(2, {
      eggFuseDuration: 0.2,
      startingLives: 1,
      maxLives: 1,
      eggBlastHitRadius: 4.2
    });
    const attackerId = humanPlayers[0]!.id;
    const defenderId = humanPlayers[1]!.id;
    const attacker = getInternalPlayer(simulation, attackerId);
    const defender = getInternalPlayer(simulation, defenderId);
    attacker.position = { x: 28.5, y: PLAYER_GROUND_Y, z: 28.5 };
    attacker.velocity = { x: 0, y: 0, z: 0 };
    attacker.facing = { x: 1, z: 0 };
    attacker.grounded = true;
    attacker.mass = 220;
    defender.position = { x: 30.2, y: PLAYER_GROUND_Y, z: 28.5 };
    defender.velocity = { x: 0, y: 0, z: 0 };
    defender.grounded = true;

    simulation.step({
      [attackerId]: layEgg({
        lookX: 1,
        lookZ: 0
      }),
      [defenderId]: idle()
    });
    simulation.consumeGameplayEventBatch();
    const spawnedEgg = (
      simulation as unknown as { eggs: Map<string, { fuseRemaining: number; position: { x: number; y: number; z: number }; velocity: { x: number; y: number; z: number } }> }
    ).eggs.values().next().value;
    if (!spawnedEgg) {
      throw new Error("Expected spawned egg to exist");
    }
    spawnedEgg.fuseRemaining = 0;
    spawnedEgg.position = {
      x: 29.3,
      y: PLAYER_GROUND_Y + 0.3,
      z: 28.5
    };
    spawnedEgg.velocity = { x: 0, y: 0, z: 0 };

    advanceSimulation(simulation, 1, {
      [attackerId]: idle({
        lookX: 1,
        lookZ: 0
      }),
      [defenderId]: idle()
    });

    const gameplayBatch = simulation.consumeGameplayEventBatch();
    const terrainBatch = simulation.consumeTerrainDeltaBatch();
    const authoritativeState = simulation.getAuthoritativeMatchState(attackerId);
    const damagedEvent = gameplayBatch?.events.find(
      (event) => event.type === "player_damaged" && event.playerId === defenderId
    );
    const eliminatedEvent = gameplayBatch?.events.find(
      (event) => event.type === "player_eliminated" && event.playerId === defenderId
    );

    expect(damagedEvent).toBeDefined();
    expect(eliminatedEvent).toBeDefined();
    expect(
      gameplayBatch?.events.some((event) => event.type === "explosion_resolved")
    ).toBe(true);
    expect(terrainBatch).not.toBeNull();
    expect((terrainBatch?.changes.length ?? 0) > 0).toBe(true);
    expect(authoritativeState.players.find((player) => player.id === defenderId)?.alive).toBe(
      false
    );
    expect(authoritativeState.ranking.at(-1)).toBe(defenderId);
  });

  it("reports egg hud status as unavailable when the player lacks matter", () => {
    const simulation = createTestSimulation("explore");
    const localPlayerId = simulation.getLocalPlayerId()!;
    advanceUntilGrounded(simulation, localPlayerId);
    getInternalPlayer(simulation, localPlayerId).mass = simulation.config.eggCost - 1;

    expect(simulation.getHudState().eggStatus).toEqual({
      reason: "notEnoughMatter",
      hasMatter: false,
      ready: false,
      activeCount: 0,
      maxActiveCount: simulation.config.maxActiveEggsPerPlayer,
      cost: simulation.config.eggCost,
      cooldownRemaining: 0,
      cooldownDuration: simulation.config.eggFuseDuration,
      canQuickEgg: false,
      canChargedThrow: false
    });
  });

  it("reports egg hud state as blocked while the player is stunned even with matter ready", () => {
    const simulation = createTestSimulation("explore");
    const localPlayerId = simulation.getLocalPlayerId()!;
    advanceUntilGrounded(simulation, localPlayerId);
    const localPlayer = getInternalPlayer(simulation, localPlayerId);
    localPlayer.mass = simulation.config.eggCost + 20;
    localPlayer.stunRemaining = 0.6;

    expect(simulation.getHudState().eggStatus).toEqual({
      reason: "stateBlocked",
      hasMatter: true,
      ready: false,
      activeCount: 0,
      maxActiveCount: simulation.config.maxActiveEggsPerPlayer,
      cost: simulation.config.eggCost,
      cooldownRemaining: 0,
      cooldownDuration: simulation.config.eggFuseDuration,
      canQuickEgg: false,
      canChargedThrow: false
    });
  });

  it("applies movement, friction, and air control", () => {
    const simulation = createTestSimulation();
    const localPlayerId = simulation.getLocalPlayerId()!;
    advanceUntilGrounded(simulation, localPlayerId);

    advanceSimulation(simulation, 20, {
      [localPlayerId]: move(1, 0)
    });
    const moving = simulation.getPlayerViewState(localPlayerId)!;
    expect(moving.velocity.x).toBeGreaterThan(0);

    advanceSimulation(simulation, 20, {
      [localPlayerId]: idle()
    });
    const slowed = simulation.getPlayerViewState(localPlayerId)!;
    expect(Math.abs(slowed.velocity.x)).toBeLessThan(Math.abs(moving.velocity.x));

    simulation.step({
      [localPlayerId]: jump()
    });
    advanceSimulation(simulation, 5, {
      [localPlayerId]: move(0, 1)
    });
    const airborne = simulation.getPlayerViewState(localPlayerId)!;
    expect(airborne.velocity.z).toBeGreaterThan(0);
    expect(Math.abs(airborne.velocity.z)).toBeLessThan(simulation.config.moveSpeed);
  });

  it("uses jump ledge assist to climb short stair-like obstacles without making walking auto-step", () => {
    const createStairSimulation = () => {
      const simulation = createTestSimulation("explore", (world) => {
        world.setVoxel(7, DEFAULT_SURFACE_Y, 6, "boundary");
        world.setVoxel(8, DEFAULT_SURFACE_Y, 6, "boundary");
        world.setVoxel(8, DEFAULT_SURFACE_Y + 1, 6, "boundary");
      });
      const localPlayerId = simulation.getLocalPlayerId()!;
      const localPlayer = getInternalPlayer(simulation, localPlayerId);
      localPlayer.position = { x: 6.65, y: PLAYER_GROUND_Y, z: 6.5 };
      localPlayer.velocity = { x: 0, y: 0, z: 0 };
      localPlayer.facing = { x: 1, z: 0 };
      localPlayer.grounded = true;
      return { simulation, localPlayerId };
    };

    const { simulation: jumpedSimulation, localPlayerId: jumpedPlayerId } = createStairSimulation();
    jumpedSimulation.step({
      [jumpedPlayerId]: move(1, 0, {
        jump: true,
        jumpPressed: true
      })
    });
    advanceSimulation(jumpedSimulation, 19, {
      [jumpedPlayerId]: move(1, 0)
    });
    const jumpedPlayer = jumpedSimulation.getPlayerViewState(jumpedPlayerId)!;

    const { simulation: walkingSimulation, localPlayerId: walkingPlayerId } = createStairSimulation();
    advanceSimulation(walkingSimulation, 20, {
      [walkingPlayerId]: move(1, 0)
    });
    const walkingPlayer = walkingSimulation.getPlayerViewState(walkingPlayerId)!;

    expect(jumpedPlayer.position.x).toBeGreaterThan(walkingPlayer.position.x + 0.35);
    expect(jumpedPlayer.position.y).toBeGreaterThan(PLAYER_GROUND_Y + 1.2);
    expect(walkingPlayer.position.x).toBeLessThan(6.75);
    expect(walkingPlayer.position.y).toBeLessThan(PLAYER_GROUND_Y + 0.1);
  });

  it("keeps jump ledge assist from bypassing tall walls or blocked headroom", () => {
    const createObstacleSimulation = (mutateWorld: Parameters<typeof createTestSimulation>[1]) => {
      const simulation = createTestSimulation("explore", mutateWorld);
      const localPlayerId = simulation.getLocalPlayerId()!;
      const localPlayer = getInternalPlayer(simulation, localPlayerId);
      localPlayer.position = { x: 6.65, y: PLAYER_GROUND_Y, z: 6.5 };
      localPlayer.velocity = { x: 0, y: 0, z: 0 };
      localPlayer.facing = { x: 1, z: 0 };
      localPlayer.grounded = true;
      return { simulation, localPlayerId };
    };

    const { simulation: tallWallSimulation, localPlayerId: tallWallPlayerId } = createObstacleSimulation((world) => {
      world.setVoxel(7, DEFAULT_SURFACE_Y, 6, "boundary");
      world.setVoxel(7, DEFAULT_SURFACE_Y + 1, 6, "boundary");
    });
    tallWallSimulation.step({
      [tallWallPlayerId]: move(1, 0, {
        jump: true,
        jumpPressed: true
      })
    });
    advanceSimulation(tallWallSimulation, 9, {
      [tallWallPlayerId]: move(1, 0)
    });
    expect(tallWallSimulation.getPlayerViewState(tallWallPlayerId)!.position.x).toBeLessThan(6.7);

    const { simulation: blockedHeadroomSimulation, localPlayerId: blockedHeadroomPlayerId } = createObstacleSimulation(
      (world) => {
        world.setVoxel(7, DEFAULT_SURFACE_Y, 6, "boundary");
        world.setVoxel(7, DEFAULT_SURFACE_Y + 2, 6, "boundary");
      }
    );
    blockedHeadroomSimulation.step({
      [blockedHeadroomPlayerId]: move(1, 0, {
        jump: true,
        jumpPressed: true
      })
    });
    advanceSimulation(blockedHeadroomSimulation, 9, {
      [blockedHeadroomPlayerId]: move(1, 0)
    });
    expect(blockedHeadroomSimulation.getPlayerViewState(blockedHeadroomPlayerId)!.position.x).toBeLessThan(6.7);
  });

  it("rotates facing gradually toward a new move direction instead of snapping", () => {
    const simulation = new OutOfBoundsSimulation({
      turnSpeed: 1
    });
    simulation.reset("explore", createArenaDocument(), {
      localPlayerName: "You"
    });

    const localPlayerId = simulation.getLocalPlayerId()!;
    const internalPlayer = getInternalPlayer(simulation, localPlayerId);
    internalPlayer.facing = { x: 1, z: 0 };
    internalPlayer.grounded = true;

    simulation.step(
      {
        [localPlayerId]: move(0, 1)
      },
      1 / 60
    );

    const facing = simulation.getPlayerState(localPlayerId)!.facing;
    expect(facing.x).toBeGreaterThan(0.95);
    expect(facing.z).toBeGreaterThan(0);
    expect(facing.z).toBeLessThan(0.1);
  });

  it("keeps facing unchanged when there is no movement input", () => {
    const simulation = createTestSimulation();
    const localPlayerId = simulation.getLocalPlayerId()!;
    const internalPlayer = getInternalPlayer(simulation, localPlayerId);
    internalPlayer.facing = { x: 0.6, z: 0.8 };

    simulation.step({
      [localPlayerId]: idle()
    });

    expect(simulation.getPlayerState(localPlayerId)!.facing.x).toBeCloseTo(0.6, 5);
    expect(simulation.getPlayerState(localPlayerId)!.facing.z).toBeCloseTo(0.8, 5);
  });

  it("turns toward the supplied look vector while idle", () => {
    const simulation = new OutOfBoundsSimulation({
      turnSpeed: Math.PI
    });
    simulation.reset("explore", createArenaDocument(), {
      localPlayerName: "You"
    });

    const localPlayerId = simulation.getLocalPlayerId()!;
    const internalPlayer = getInternalPlayer(simulation, localPlayerId);
    internalPlayer.facing = { x: 0, z: 1 };
    internalPlayer.grounded = true;

    advanceSimulation(simulation, 30, {
      [localPlayerId]: idle({
        lookX: 1,
        lookZ: 0
      })
    });

    const facing = simulation.getPlayerState(localPlayerId)!.facing;
    expect(facing.x).toBeGreaterThan(0.8);
    expect(facing.z).toBeLessThan(0.3);
  });

  it("uses look direction for push alignment when the player is standing still", () => {
    const simulation = createTestSimulation("playNpc");
    const simulationInternals = simulation as unknown as { generateNpcCommand: (player: unknown) => PlayerCommand };
    simulationInternals.generateNpcCommand = () => idle();
    const localPlayerId = simulation.getLocalPlayerId()!;
    const npcId = getNpcId(simulation)!;
    const localPlayer = getInternalPlayer(simulation, localPlayerId);
    const npcPlayer = getInternalPlayer(simulation, npcId);
    const otherNpcIds = simulation
      .getSnapshot()
      .players.filter((player) => player.kind === "npc" && player.id !== npcId)
      .map((player) => player.id);

    localPlayer.position = { x: 10.5, y: PLAYER_GROUND_Y, z: 10.5 };
    localPlayer.velocity = { x: 0, y: 0, z: 0 };
    localPlayer.facing = { x: 0, z: 1 };
    localPlayer.grounded = true;
    localPlayer.mass = simulation.config.maxMass;
    npcPlayer.position = { x: 11.4, y: PLAYER_GROUND_Y, z: 10.5 };
    npcPlayer.velocity = { x: 0, y: 0, z: 0 };
    npcPlayer.grounded = true;
    otherNpcIds.forEach((otherNpcId, index) => {
      const otherNpc = getInternalPlayer(simulation, otherNpcId);
      otherNpc.position = { x: 30 + index * 2, y: PLAYER_GROUND_Y, z: 30 };
      otherNpc.velocity = { x: 0, y: 0, z: 0 };
      otherNpc.grounded = true;
    });

    advanceSimulation(simulation, 30, {
      [localPlayerId]: idle({
        lookX: 1,
        lookZ: 0
      })
    });

    npcPlayer.position = { x: 11.4, y: PLAYER_GROUND_Y, z: 10.5 };
    npcPlayer.velocity = { x: 0, y: 0, z: 0 };

    simulation.step({
      [localPlayerId]: push({
        lookX: 1,
        lookZ: 0
      })
    });

    expect(simulation.getPlayerViewState(npcId)!.velocity.x).toBeGreaterThan(0);
  });

  it("prioritizes look direction over movement direction when both are present", () => {
    const simulation = new OutOfBoundsSimulation({
      turnSpeed: 1
    });
    simulation.reset("explore", createArenaDocument(), {
      localPlayerName: "You"
    });

    const localPlayerId = simulation.getLocalPlayerId()!;
    const internalPlayer = getInternalPlayer(simulation, localPlayerId);
    internalPlayer.facing = { x: 0, z: 1 };
    internalPlayer.grounded = true;

    simulation.step(
      {
        [localPlayerId]: move(1, 0, {
          lookX: -1,
          lookZ: 0
        })
      },
      1 / 60
    );

    const facing = simulation.getPlayerState(localPlayerId)!.facing;
    expect(facing.x).toBeLessThan(0);
    expect(facing.z).toBeGreaterThan(0);
  });

  it("turns across the wrap boundary using the shortest angular path", () => {
    const simulation = new OutOfBoundsSimulation({
      turnSpeed: 1
    });
    simulation.reset("explore", createArenaDocument(), {
      localPlayerName: "You"
    });

    const localPlayerId = simulation.getLocalPlayerId()!;
    const internalPlayer = getInternalPlayer(simulation, localPlayerId);
    const currentYaw = Math.PI - 0.04;
    const targetYaw = -Math.PI + 0.04;
    internalPlayer.facing = {
      x: Math.sin(currentYaw),
      z: Math.cos(currentYaw)
    };

    simulation.step(
      {
        [localPlayerId]: move(Math.sin(targetYaw), Math.cos(targetYaw))
      },
      1 / 60
    );

    const nextYaw = getYaw(simulation.getPlayerState(localPlayerId)!.facing);
    expect(normalizeAngle(nextYaw - currentYaw)).toBeGreaterThan(0);
    expect(normalizeAngle(nextYaw - currentYaw)).toBeLessThan(0.03);
    expect(Math.abs(normalizeAngle(targetYaw - nextYaw))).toBeLessThan(Math.abs(normalizeAngle(targetYaw - currentYaw)));
  });

  it("buffers a jump pressed just before landing so the player rebounds without a grounded dead zone", () => {
    const simulation = createTestSimulation();
    const localPlayerId = simulation.getLocalPlayerId()!;
    const internalPlayer = getInternalPlayer(simulation, localPlayerId);

    internalPlayer.position = { x: 10.5, y: PLAYER_GROUND_Y + 0.04, z: 10.5 };
    internalPlayer.velocity = { x: 0, y: -6, z: 0 };
    internalPlayer.grounded = false;
    internalPlayer.jetpackEligible = false;
    internalPlayer.mass = 0;

    simulation.step({
      [localPlayerId]: jump()
    });
    const afterBufferedLandingJump = simulation.getPlayerViewState(localPlayerId)!;

    expect(afterBufferedLandingJump.grounded).toBe(false);
    expect(afterBufferedLandingJump.jetpackActive).toBe(false);
    expect(afterBufferedLandingJump.mass).toBe(0);
    expect(afterBufferedLandingJump.velocity.y).toBe(simulation.config.jumpSpeed);
  });

  it("keeps grounded jumps free even when the player has no matter", () => {
    const simulation = createTestSimulation();
    const localPlayerId = simulation.getLocalPlayerId()!;
    advanceUntilGrounded(simulation, localPlayerId);
    const internalPlayer = getInternalPlayer(simulation, localPlayerId);

    internalPlayer.grounded = true;
    internalPlayer.jetpackEligible = false;
    internalPlayer.mass = 0;
    internalPlayer.velocity.y = 0;
    simulation.step({
      [localPlayerId]: jump()
    });

    const freeJump = simulation.getPlayerViewState(localPlayerId)!;
    expect(freeJump.mass).toBe(0);
    expect(freeJump.grounded).toBe(false);
    expect(freeJump.velocity.y).toBeGreaterThan(0);
  });

  it("activates the jetpack after holding Space through takeoff for the hold delay", () => {
    const simulation = createTestSimulation();
    const localPlayerId = simulation.getLocalPlayerId()!;
    advanceUntilGrounded(simulation, localPlayerId);

    const initialMass = simulation.getPlayerViewState(localPlayerId)!.mass;
    const framesToHoldBeforeActivation = Math.ceil(
      simulation.config.jetpackHoldActivationDelay * simulation.config.tickRate
    );

    simulation.step({
      [localPlayerId]: jump()
    });

    for (let frame = 0; frame < Math.max(0, framesToHoldBeforeActivation - 2); frame += 1) {
      simulation.step({
        [localPlayerId]: idle({
          jump: true
        })
      });
    }

    const beforeActivation = simulation.getPlayerViewState(localPlayerId)!;
    expect(beforeActivation.jetpackActive).toBe(false);
    expect(beforeActivation.mass).toBe(initialMass);

    simulation.step({
      [localPlayerId]: idle({
        jump: true
      })
    });
    const afterActivation = simulation.getPlayerViewState(localPlayerId)!;

    expect(afterActivation.jetpackActive).toBe(true);
    expect(afterActivation.mass).toBeLessThan(initialMass);
    expect(afterActivation.velocity.y).toBeGreaterThan(beforeActivation.velocity.y);
  });

  it("keeps a tap jump free and does not ignite the jetpack after release", () => {
    const simulation = createTestSimulation();
    const localPlayerId = simulation.getLocalPlayerId()!;
    advanceUntilGrounded(simulation, localPlayerId);

    const initialMass = simulation.getPlayerViewState(localPlayerId)!.mass;
    simulation.step({
      [localPlayerId]: jump()
    });
    simulation.step({
      [localPlayerId]: idle({
        jumpReleased: true
      })
    });
    advanceSimulation(simulation, 5, {
      [localPlayerId]: idle()
    });

    const afterTapJump = simulation.getPlayerViewState(localPlayerId)!;
    expect(afterTapJump.jetpackActive).toBe(false);
    expect(afterTapJump.mass).toBe(initialMass);
  });

  it("activates the jetpack on a fresh airborne press after releasing the initial jump, sustains while held, and stops on release", () => {
    const simulation = createTestSimulation();
    const localPlayerId = simulation.getLocalPlayerId()!;
    advanceUntilGrounded(simulation, localPlayerId);

    simulation.step({
      [localPlayerId]: jump()
    });
    simulation.step({
      [localPlayerId]: idle({
        jumpReleased: true
      })
    });
    simulation.step({
      [localPlayerId]: idle()
    });
    const beforeSecondPress = simulation.getPlayerViewState(localPlayerId)!;

    simulation.step({
      [localPlayerId]: jump()
    });
    const afterActivation = simulation.getPlayerViewState(localPlayerId)!;

    expect(afterActivation.mass).toBeLessThan(beforeSecondPress.mass);
    expect(afterActivation.jetpackActive).toBe(true);
    expect(afterActivation.velocity.y).toBeGreaterThan(beforeSecondPress.velocity.y);

    const massAfterActivation = afterActivation.mass;
    simulation.step({
      [localPlayerId]: idle({
        jump: true
      })
    });
    const afterSustain = simulation.getPlayerViewState(localPlayerId)!;

    expect(afterSustain.mass).toBeLessThan(massAfterActivation);
    expect(afterSustain.jetpackActive).toBe(true);
    expect(afterSustain.velocity.y).toBeGreaterThan(0);

    simulation.step({
      [localPlayerId]: idle({
        jumpReleased: true
      })
    });
    const afterRelease = simulation.getPlayerViewState(localPlayerId)!;

    expect(afterRelease.mass).toBe(afterSustain.mass);
    expect(afterRelease.jetpackActive).toBe(false);
    expect(afterRelease.velocity.y).toBeLessThan(afterSustain.velocity.y);
  });

  it("destroys harvestable voxels, caps mass, and reports dirty chunks", () => {
    const simulation = createTestSimulation("explore", (world) => {
      world.setVoxel(7, DEFAULT_SURFACE_Y, 6, "boundary");
    });
    const localPlayerId = simulation.getLocalPlayerId()!;
    advanceUntilGrounded(simulation, localPlayerId);

    const internalPlayer = getInternalPlayer(simulation, localPlayerId);
    internalPlayer.position = { x: 6.5, y: PLAYER_GROUND_Y, z: 6.5 };
    internalPlayer.grounded = true;
    internalPlayer.mass = simulation.config.maxMass - 3;
    simulation.step({
      [localPlayerId]: destroy({
        targetVoxel: { x: 7, y: DEFAULT_SURFACE_Y, z: 6 }
      })
    });

    const afterDestroy = simulation.getSnapshot();
    expect(afterDestroy.players[0]?.mass).toBe(simulation.config.maxMass);
    expect(afterDestroy.map.voxels.some((voxel) => voxel.x === 7 && voxel.y === DEFAULT_SURFACE_Y && voxel.z === 6)).toBe(false);
    const dirtyChunkKeys = simulation.consumeDirtyChunkKeys();
    expect(dirtyChunkKeys.length).toBeGreaterThan(0);

    const normalizeChunks = (entries: Array<{ key: string; voxels: Array<{ key: string }> }>) =>
      entries.map((chunk) => ({
        key: chunk.key,
        voxels: chunk.voxels.map((voxel) => voxel.key).sort()
      }));

    const world = simulation.getWorld();
    const fullChunks = world
      .buildVisibleChunks()
      .filter((chunk) => dirtyChunkKeys.includes(chunk.key));
    const rebuiltChunks = world.buildVisibleChunksForKeys(dirtyChunkKeys);

    expect(normalizeChunks(rebuiltChunks)).toEqual(normalizeChunks(fullChunks));
  });

  it("emits and expires harvest voxel bursts when a cube is destroyed", () => {
    const simulation = createTestSimulation("explore", (world) => {
      world.setVoxel(7, DEFAULT_SURFACE_Y, 6, "boundary");
    });
    const localPlayerId = simulation.getLocalPlayerId()!;
    advanceUntilGrounded(simulation, localPlayerId);

    const internalPlayer = getInternalPlayer(simulation, localPlayerId);
    internalPlayer.position = { x: 6.5, y: PLAYER_GROUND_Y, z: 6.5 };
    internalPlayer.grounded = true;

    simulation.step({
      [localPlayerId]: destroy({
        targetVoxel: { x: 7, y: DEFAULT_SURFACE_Y, z: 6 }
      })
    });

    expect(simulation.getSnapshot().voxelBursts).toEqual([
      expect.objectContaining({
        style: "harvest",
        kind: "boundary",
        position: {
          x: 7.5,
          y: DEFAULT_SURFACE_Y + 0.5,
          z: 6.5
        }
      })
    ]);

    advanceSimulation(simulation, 30, {
      [localPlayerId]: idle()
    });

    expect(simulation.getSnapshot().voxelBursts).toEqual([]);
  });

  it("does not harvest hazards or out-of-range voxels", () => {
    const simulation = createTestSimulation("explore", (world) => {
      world.setVoxel(7, DEFAULT_SURFACE_Y, 6, "hazard");
      world.setVoxel(15, DEFAULT_SURFACE_Y, 6, "ground");
    });
    const localPlayerId = simulation.getLocalPlayerId()!;
    advanceUntilGrounded(simulation, localPlayerId);

    const before = simulation.getPlayerViewState(localPlayerId)!;
    simulation.step({
      [localPlayerId]: destroy({
        targetVoxel: { x: 7, y: DEFAULT_SURFACE_Y, z: 6 }
      })
    });
    const after = simulation.getPlayerViewState(localPlayerId)!;

    expect(after.mass).toBe(before.mass);
    expect(simulation.consumeDirtyChunkKeys()).toEqual([]);
  });

  it("reports runtime interaction focus for harvestable targets", () => {
    const simulation = createTestSimulation("explore", (world) => {
      world.setVoxel(7, DEFAULT_SURFACE_Y, 6, "boundary");
    });
    const localPlayerId = simulation.getLocalPlayerId()!;
    advanceUntilGrounded(simulation, localPlayerId);

    const localPlayer = getInternalPlayer(simulation, localPlayerId);
    localPlayer.position = { x: 6.5, y: PLAYER_GROUND_Y, z: 6.5 };
    localPlayer.grounded = true;

    expect(
      simulation.getRuntimeInteractionFocusState(
        { x: 7, y: DEFAULT_SURFACE_Y, z: 6 },
        { x: 0, y: 1, z: 0 },
        localPlayerId
      )
    ).toEqual({
      focusedVoxel: { x: 7, y: DEFAULT_SURFACE_Y, z: 6 },
      targetNormal: { x: 0, y: 1, z: 0 },
      placeVoxel: { x: 7, y: DEFAULT_SURFACE_Y + 1, z: 6 },
      destroyValid: true,
      placeValid: true,
      invalidReason: null
    });
  });

  it("reports out-of-range and hazard focus states truthfully", () => {
    const simulation = createTestSimulation("explore", (world) => {
      world.setVoxel(7, DEFAULT_SURFACE_Y, 6, "hazard");
      world.setVoxel(15, DEFAULT_SURFACE_Y, 6, "ground");
    });
    const localPlayerId = simulation.getLocalPlayerId()!;
    advanceUntilGrounded(simulation, localPlayerId);

    const localPlayer = getInternalPlayer(simulation, localPlayerId);
    localPlayer.position = { x: 6.5, y: PLAYER_GROUND_Y, z: 6.5 };
    localPlayer.grounded = true;

    expect(
      simulation.getRuntimeInteractionFocusState(
        { x: 15, y: DEFAULT_SURFACE_Y, z: 6 },
        { x: 0, y: 1, z: 0 },
        localPlayerId
      )
    ).toEqual({
      focusedVoxel: { x: 15, y: DEFAULT_SURFACE_Y, z: 6 },
      targetNormal: { x: 0, y: 1, z: 0 },
      placeVoxel: { x: 15, y: DEFAULT_SURFACE_Y + 1, z: 6 },
      destroyValid: false,
      placeValid: false,
      invalidReason: "outOfRange"
    });

    expect(
      simulation.getRuntimeInteractionFocusState(
        { x: 7, y: DEFAULT_SURFACE_Y, z: 6 },
        { x: 0, y: 1, z: 0 },
        localPlayerId
      )
    ).toEqual({
      focusedVoxel: { x: 7, y: DEFAULT_SURFACE_Y, z: 6 },
      targetNormal: { x: 0, y: 1, z: 0 },
      placeVoxel: { x: 7, y: DEFAULT_SURFACE_Y + 1, z: 6 },
      destroyValid: false,
      placeValid: true,
      invalidReason: null
    });
  });

  it("reports player and debris placement blockers in runtime interaction focus", () => {
    const simulation = createTestSimulation("playNpc");
    const localPlayerId = simulation.getLocalPlayerId()!;
    const npcId = getNpcId(simulation)!;
    advanceUntilGrounded(simulation, localPlayerId);

    const localPlayer = getInternalPlayer(simulation, localPlayerId);
    const npcPlayer = getInternalPlayer(simulation, npcId);
    localPlayer.position = { x: 6.5, y: PLAYER_GROUND_Y, z: 6.5 };
    localPlayer.grounded = true;
    npcPlayer.position = { x: 8.5, y: PLAYER_GROUND_Y, z: 6.5 };
    npcPlayer.grounded = true;

    expect(
      simulation.getRuntimeInteractionFocusState(
        { x: 8, y: SURFACE_TOP_Y, z: 6 },
        { x: 0, y: 1, z: 0 },
        localPlayerId
      )
    ).toEqual({
      focusedVoxel: { x: 8, y: SURFACE_TOP_Y, z: 6 },
      targetNormal: { x: 0, y: 1, z: 0 },
      placeVoxel: { x: 8, y: DEFAULT_SURFACE_Y, z: 6 },
      destroyValid: true,
      placeValid: false,
      invalidReason: "blockedByPlayer"
    });

    const fallingClusters = (simulation as unknown as { fallingClusters: Map<string, any> }).fallingClusters;
    fallingClusters.set("manual-cluster", {
      id: "manual-cluster",
      phase: "falling",
      warningRemaining: 0,
      voxels: [{ x: 9, y: DEFAULT_SURFACE_Y, z: 6, kind: "ground" }],
      offsetY: 0.4,
      velocityY: 0,
      damagedPlayerIds: new Set<string>()
    });

    expect(
      simulation.getRuntimeInteractionFocusState(
        { x: 9, y: SURFACE_TOP_Y, z: 6 },
        { x: 0, y: 1, z: 0 },
        localPlayerId
      )
    ).toEqual({
      focusedVoxel: { x: 9, y: SURFACE_TOP_Y, z: 6 },
      targetNormal: { x: 0, y: 1, z: 0 },
      placeVoxel: { x: 9, y: DEFAULT_SURFACE_Y, z: 6 },
      destroyValid: true,
      placeValid: false,
      invalidReason: "blockedByDebris"
    });
  });

  it("uses explicit destroy targeting instead of facing inference", () => {
    const simulation = createTestSimulation("explore", (world) => {
      world.setVoxel(7, DEFAULT_SURFACE_Y, 6, "boundary");
    });
    const localPlayerId = simulation.getLocalPlayerId()!;
    advanceUntilGrounded(simulation, localPlayerId);

    const localPlayer = getInternalPlayer(simulation, localPlayerId);
    localPlayer.position = { x: 6.5, y: PLAYER_GROUND_Y, z: 6.5 };
    localPlayer.facing = { x: -1, z: 0 };
    localPlayer.grounded = true;

    simulation.step({
      [localPlayerId]: destroy({
        targetVoxel: { x: 7, y: DEFAULT_SURFACE_Y, z: 6 }
      })
    });

    expect(simulation.getWorld().getVoxelKind(7, DEFAULT_SURFACE_Y, 6)).toBeUndefined();
  });

  it("lets starting matter place blocks immediately and keeps harvest/build flow balanced", () => {
    const simulation = createTestSimulation("explore", (world) => {
      world.setVoxel(7, DEFAULT_SURFACE_Y, 6, "boundary");
    });
    const localPlayerId = simulation.getLocalPlayerId()!;
    advanceUntilGrounded(simulation, localPlayerId);

    const localPlayer = getInternalPlayer(simulation, localPlayerId);
    localPlayer.position = { x: 6.5, y: PLAYER_GROUND_Y, z: 6.5 };
    localPlayer.grounded = true;

    simulation.step({
      [localPlayerId]: place(
        { x: 8, y: SURFACE_TOP_Y, z: 6 },
        { x: 0, y: 1, z: 0 }
      )
    });

    expect(simulation.getWorld().getVoxelKind(8, DEFAULT_SURFACE_Y, 6)).toBe("ground");
    expect(simulation.getPlayerState(localPlayerId)!.mass).toBe(
      simulation.config.startingMass - simulation.config.placeCost
    );

    simulation.step({
      [localPlayerId]: destroy({
        targetVoxel: { x: 7, y: DEFAULT_SURFACE_Y, z: 6 }
      })
    });
    expect(simulation.getPlayerState(localPlayerId)!.mass).toBe(
      simulation.config.startingMass - simulation.config.placeCost + simulation.config.destroyGain
    );
    expect(simulation.getPlayerState(localPlayerId)!.mass).toBe(simulation.config.startingMass);
  });

  it("destroys targeted tree props without granting Matter", () => {
    const simulation = createTestSimulation("explore", (world) => {
      world.setProp("tree-oak", 8, DEFAULT_SURFACE_Y, 6);
    });
    const localPlayerId = simulation.getLocalPlayerId()!;
    advanceUntilGrounded(simulation, localPlayerId);

    const localPlayer = getInternalPlayer(simulation, localPlayerId);
    localPlayer.position = { x: 7.5, y: PLAYER_GROUND_Y, z: 6.5 };
    localPlayer.grounded = true;
    localPlayer.mass = simulation.config.startingMass;

    simulation.step({
      [localPlayerId]: destroy({
        targetVoxel: { x: 8, y: DEFAULT_SURFACE_Y, z: 6 }
      })
    });

    const terrainBatch = simulation.consumeTerrainDeltaBatch();
    expect(simulation.getPlayerState(localPlayerId)!.mass).toBe(simulation.config.startingMass);
    expect(simulation.getWorld().getPropAtVoxel(8, DEFAULT_SURFACE_Y, 6)).toBeUndefined();
    expect(terrainBatch?.propChanges).toContainEqual({
      id: "prop-1",
      kind: "tree-oak",
      x: 8,
      y: DEFAULT_SURFACE_Y,
      z: 6,
      operation: "remove"
    });

    localPlayer.mass = simulation.config.maxMass;
    simulation.step({
      [localPlayerId]: place(
        { x: 8, y: SURFACE_TOP_Y, z: 6 },
        { x: 0, y: 1, z: 0 }
      )
    });

    expect(simulation.getWorld().getVoxelKind(8, DEFAULT_SURFACE_Y, 6)).toBe("ground");
    expect(simulation.getPlayerState(localPlayerId)!.mass).toBe(
      simulation.config.maxMass - simulation.config.placeCost
    );
  });

  it("ignites nearby trees from egg explosions and removes them only after the full burn", () => {
    const simulation = createBurningTreeSimulation("tree-oak");
    const egg = createExplosionEgg(simulation, "burn-egg-1", {
      x: 8.5,
      y: DEFAULT_SURFACE_Y + 0.4,
      z: 6.5
    });

    getSimulationInternals(simulation).explodeEgg(egg);

    const initialBatch = simulation.consumeTerrainDeltaBatch();
    expect(simulation.getSnapshot().burningProps).toContainEqual(
      expect.objectContaining({
        id: "prop-1",
        kind: "tree-oak",
        sourceKind: "eggExplosion"
      })
    );
    expect(simulation.getWorld().getPropAtVoxel(8, DEFAULT_SURFACE_Y, 6)?.id).toBe("prop-1");
    expect(simulation.getWorld().hasBlockingVoxel(8, DEFAULT_SURFACE_Y, 6)).toBe(true);
    expect(initialBatch?.propChanges ?? []).toEqual([]);

    advanceSimulation(simulation, 149);
    expect(simulation.getWorld().getPropAtVoxel(8, DEFAULT_SURFACE_Y, 6)?.id).toBe("prop-1");
    expect(simulation.getSnapshot().burningProps).toHaveLength(1);

    simulation.step({});
    const removalBatch = simulation.consumeTerrainDeltaBatch();
    expect(removalBatch?.propChanges).toEqual([
      {
        id: "prop-1",
        kind: "tree-oak",
        x: 8,
        y: DEFAULT_SURFACE_Y,
        z: 6,
        operation: "remove"
      }
    ]);
    expect(simulation.getSnapshot().burningProps).toEqual([]);
    expect(simulation.getWorld().getPropAtVoxel(8, DEFAULT_SURFACE_Y, 6)).toBeUndefined();
  });

  it("keeps ignited trees standing even when the explosion destroys their support voxel", () => {
    const simulation = createBurningTreeSimulation("tree-pine");
    const supportY = DEFAULT_SURFACE_Y - 1;
    const egg = createExplosionEgg(simulation, "burn-egg-2", {
      x: 8.5,
      y: supportY + 0.5,
      z: 6.5
    });

    getSimulationInternals(simulation).explodeEgg(egg);

    const terrainBatch = simulation.consumeTerrainDeltaBatch();
    expect(terrainBatch?.changes).toContainEqual({
      voxel: { x: 8, y: supportY, z: 6 },
      kind: null,
      operation: "remove",
      source: "projectile_explosion"
    });
    expect(terrainBatch?.propChanges ?? []).toEqual([]);
    expect(simulation.getWorld().getVoxelKind(8, supportY, 6)).toBeUndefined();
    expect(simulation.getWorld().getPropAtVoxel(8, DEFAULT_SURFACE_Y, 6)?.id).toBe("prop-1");
    expect(simulation.getSnapshot().burningProps).toContainEqual(
      expect.objectContaining({
        id: "prop-1",
        sourceKind: "eggExplosion"
      })
    );
  });

  it("refreshes the burn timer when a burning tree is hit by another bomb", () => {
    const simulation = createBurningTreeSimulation("tree-autumn");
    const firstEgg = createExplosionEgg(simulation, "burn-egg-3", {
      x: 8.5,
      y: DEFAULT_SURFACE_Y + 0.6,
      z: 6.5
    });

    getSimulationInternals(simulation).explodeEgg(firstEgg);
    simulation.consumeTerrainDeltaBatch();
    advanceSimulation(simulation, 80);

    const remainingBeforeRefresh = simulation.getSnapshot().burningProps[0]?.remaining ?? 0;
    expect(remainingBeforeRefresh).toBeLessThan(8);
    expect(remainingBeforeRefresh).toBeGreaterThan(6);

    const secondEgg = createExplosionEgg(simulation, "burn-egg-4", {
      x: 8.5,
      y: DEFAULT_SURFACE_Y + 0.6,
      z: 6.5
    });
    getSimulationInternals(simulation).explodeEgg(secondEgg);

    const burningProps = simulation.getSnapshot().burningProps;
    expect(burningProps).toHaveLength(1);
    expect(burningProps[0]?.id).toBe("prop-1");
    expect(burningProps[0]?.remaining).toBeCloseTo(15, 4);
  });

  it("ignites nearby trees from super boom impacts", () => {
    const simulation = createBurningTreeSimulation("tree-oak");
    const localPlayerId = simulation.getLocalPlayerId()!;
    const localPlayer = getInternalPlayer(simulation, localPlayerId);

    localPlayer.position = { x: 8.5, y: DEFAULT_SURFACE_Y + 0.3, z: 6.5 };
    localPlayer.velocity = { x: 0, y: 0, z: 0 };
    localPlayer.grounded = false;

    getSimulationInternals(simulation).resolveSuperBoomImpact(localPlayer);

    expect(simulation.getSnapshot().burningProps).toContainEqual(
      expect.objectContaining({
        id: "prop-1",
        sourceKind: "superBoomExplosion"
      })
    );
    expect(simulation.getWorld().getPropAtVoxel(8, DEFAULT_SURFACE_Y, 6)?.id).toBe("prop-1");
  });

  it("removes supported tree props from runtime deltas when their base voxel is harvested", () => {
    const simulation = createTestSimulation("explore", (world) => {
      world.setProp("tree-pine", 8, DEFAULT_SURFACE_Y, 6);
    });
    const localPlayerId = simulation.getLocalPlayerId()!;
    advanceUntilGrounded(simulation, localPlayerId);

    const localPlayer = getInternalPlayer(simulation, localPlayerId);
    localPlayer.position = { x: 7.5, y: PLAYER_GROUND_Y, z: 6.5 };
    localPlayer.grounded = true;

    simulation.step({
      [localPlayerId]: destroy({
        targetVoxel: { x: 8, y: DEFAULT_SURFACE_Y - 1, z: 6 }
      })
    });

    const terrainBatch = simulation.consumeTerrainDeltaBatch();
    expect(simulation.getWorld().getPropAtVoxel(8, DEFAULT_SURFACE_Y, 6)).toBeUndefined();
    expect(terrainBatch?.propChanges).toContainEqual({
      id: "prop-1",
      kind: "tree-pine",
      x: 8,
      y: DEFAULT_SURFACE_Y,
      z: 6,
      operation: "remove"
    });
  });

  it("rejects placement inside player bodies and active falling debris", () => {
    const simulation = createTestSimulation("playNpc");
    const localPlayerId = simulation.getLocalPlayerId()!;
    const npcId = getNpcId(simulation)!;
    advanceUntilGrounded(simulation, localPlayerId);

    const localPlayer = getInternalPlayer(simulation, localPlayerId);
    const npcPlayer = getInternalPlayer(simulation, npcId);
    localPlayer.position = { x: 6.5, y: PLAYER_GROUND_Y, z: 6.5 };
    localPlayer.mass = simulation.config.maxMass;
    localPlayer.grounded = true;
    npcPlayer.position = { x: 8.5, y: PLAYER_GROUND_Y, z: 6.5 };
    npcPlayer.grounded = true;

    simulation.step({
      [localPlayerId]: place(
        { x: 8, y: SURFACE_TOP_Y, z: 6 },
        { x: 0, y: 1, z: 0 }
      )
    });
    expect(simulation.getWorld().getVoxelKind(8, DEFAULT_SURFACE_Y, 6)).toBeUndefined();

    const fallingClusters = (simulation as unknown as { fallingClusters: Map<string, any> }).fallingClusters;
    fallingClusters.set("manual-cluster", {
      id: "manual-cluster",
      phase: "falling",
      warningRemaining: 0,
      voxels: [{ x: 9, y: DEFAULT_SURFACE_Y, z: 6, kind: "ground" }],
      offsetY: 0.4,
      velocityY: 0,
      damagedPlayerIds: new Set<string>()
    });

    simulation.step({
      [localPlayerId]: place(
        { x: 9, y: SURFACE_TOP_Y, z: 6 },
        { x: 0, y: 1, z: 0 }
      )
    });

    expect(simulation.getWorld().getVoxelKind(9, DEFAULT_SURFACE_Y, 6)).toBeUndefined();
  });

  it("spawns falling clusters when support is removed", () => {
    const { simulation, localPlayerId } = createCollapseSimulation();

    simulation.step({
      [localPlayerId]: destroy({
        targetVoxel: { x: 10, y: COLLAPSE_SUPPORT_Y, z: 10 }
      })
    });

    const clusters = simulation.getFallingClusters();

    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.phase).toBe("warning");
    expect(simulation.getWorld().getVoxelKind(11, FLOATING_TEST_Y, 10)).toBeUndefined();
    expect(simulation.getWorld().getVoxelKind(12, FLOATING_TEST_Y, 10)).toBeUndefined();
    expect(simulation.getWorld().getVoxelKind(13, FLOATING_TEST_Y, 10)).toBeUndefined();
  });

  it("keeps collapse warnings active for 0.45 seconds before descent begins", () => {
    const { simulation, localPlayerId } = createCollapseSimulation();
    simulation.step({
      [localPlayerId]: destroy({
        targetVoxel: { x: 10, y: COLLAPSE_SUPPORT_Y, z: 10 }
      })
    });

    advanceSimulation(simulation, 20, {
      [localPlayerId]: idle()
    });
    expect(simulation.getFallingClusters()[0]?.phase).toBe("warning");
    expect(simulation.getFallingClusters()[0]?.offsetY).toBe(0);

    advanceSimulation(simulation, 7, {
      [localPlayerId]: idle()
    });
    expect(simulation.getFallingClusters()[0]?.phase).toBe("falling");
    const offsetAfterWarning = simulation.getFallingClusters()[0]?.offsetY ?? 0;
    expect(offsetAfterWarning).toBeLessThanOrEqual(0);

    simulation.step({
      [localPlayerId]: idle()
    });
    expect(simulation.getFallingClusters()[0]?.offsetY ?? 0).toBeLessThan(offsetAfterWarning);
  });

  it("lands falling clusters back into the world deterministically", () => {
    const setupRun = () => {
      const { simulation, localPlayerId } = createCollapseSimulation();
      simulation.step({
        [localPlayerId]: destroy({
          targetVoxel: { x: 10, y: COLLAPSE_SUPPORT_Y, z: 10 }
        })
      });
      advanceSimulation(simulation, 120, {
        [localPlayerId]: idle()
      });
      return simulation;
    };

    const simulationA = setupRun();
    const simulationB = setupRun();

    expect(simulationA.getFallingClusters()).toEqual([]);
    expect(simulationA.getWorld().getVoxelKind(11, DEFAULT_SURFACE_Y, 10)).toBe("ground");
    expect(simulationA.getWorld().getVoxelKind(12, DEFAULT_SURFACE_Y, 10)).toBe("ground");
    expect(simulationA.getWorld().getVoxelKind(13, DEFAULT_SURFACE_Y, 10)).toBe("ground");
    expect(normalizeSnapshot(simulationA.getSnapshot())).toEqual(normalizeSnapshot(simulationB.getSnapshot()));
  });

  it("caches falling-cluster landing distance while the cluster is descending", () => {
    const { simulation, localPlayerId } = createCollapseSimulation();
    const dropDistanceSpy = vi.spyOn(simulation.getWorld(), "getComponentDropDistance");

    simulation.step({
      [localPlayerId]: destroy({
        targetVoxel: { x: 10, y: COLLAPSE_SUPPORT_Y, z: 10 }
      })
    });

    advanceSimulation(simulation, 120, {
      [localPlayerId]: idle()
    });

    expect(dropDistanceSpy).toHaveBeenCalledTimes(1);
  });

  it("applies crush damage and knockback without directly eliminating the player", () => {
    const { simulation, localPlayerId, localPlayer } = createCollapseSimulation();
    simulation.step({
      [localPlayerId]: destroy({
        targetVoxel: { x: 10, y: COLLAPSE_SUPPORT_Y, z: 10 }
      })
    });

    localPlayer.position = { x: 12.5, y: DEFAULT_SURFACE_Y + 2.05, z: 10.5 };
    localPlayer.velocity = { x: 0, y: 0, z: 0 };
    localPlayer.mass = simulation.config.maxMass;
    localPlayer.grounded = true;

    let damagedPlayer = simulation.getPlayerState(localPlayerId)!;
    for (let frame = 0; frame < 120; frame += 1) {
      simulation.step({
        [localPlayerId]: idle()
      });
      damagedPlayer = simulation.getPlayerState(localPlayerId)!;
      if (damagedPlayer.livesRemaining < damagedPlayer.maxLives) {
        break;
      }
    }

    expect(damagedPlayer.mass).toBe(simulation.config.maxMass);
    expect(damagedPlayer.livesRemaining).toBe(simulation.config.maxLives - 1);
    expect(damagedPlayer.velocity.y).toBeGreaterThanOrEqual(simulation.config.eggBlastLift);
    expect(damagedPlayer.stunRemaining).toBeGreaterThan(0);
    expect(damagedPlayer.alive).toBe(true);
  });

  it("only damages a player once per falling cluster before landing", () => {
    const { simulation, localPlayerId, localPlayer } = createCollapseSimulation();
    simulation.step({
      [localPlayerId]: destroy({
        targetVoxel: { x: 10, y: COLLAPSE_SUPPORT_Y, z: 10 }
      })
    });

    localPlayer.position = { x: 12.5, y: DEFAULT_SURFACE_Y + 2.05, z: 10.5 };
    localPlayer.velocity = { x: 0, y: 0, z: 0 };
    localPlayer.mass = simulation.config.maxMass;
    localPlayer.grounded = true;

    let postHitLives = simulation.config.maxLives;
    for (let frame = 0; frame < 120; frame += 1) {
      simulation.step({
        [localPlayerId]: idle()
      });
      postHitLives = simulation.getPlayerState(localPlayerId)!.livesRemaining;
      if (postHitLives < simulation.config.maxLives) {
        break;
      }
    }

    advanceSimulation(simulation, 120, {
      [localPlayerId]: idle()
    });

    expect(simulation.getPlayerState(localPlayerId)!.livesRemaining).toBe(postHitLives);
  });

  it("spawns falling clusters when an egg blast removes the supporting voxel", () => {
    const simulation = new OutOfBoundsSimulation({
      eggBlastVoxelRadius: 1.1,
      eggBlastDestroyDepth: 10,
      skyDropIntervalMin: 999,
      skyDropIntervalMax: 999
    });
    simulation.reset(
      "explore",
      createArenaDocument((world) => {
        world.setVoxel(10, DEFAULT_SURFACE_Y, 10, "boundary");
        world.setVoxel(10, DEFAULT_SURFACE_Y + 1, 10, "boundary");
        world.setVoxel(10, DEFAULT_SURFACE_Y + 2, 10, "boundary");
        world.setVoxel(10, COLLAPSE_SUPPORT_Y, 10, "boundary");
        world.setVoxel(11, FLOATING_TEST_Y, 10, "ground");
        world.setVoxel(12, FLOATING_TEST_Y, 10, "ground");
        world.setVoxel(13, FLOATING_TEST_Y, 10, "ground");
      }),
      {
        localPlayerName: "You"
      }
    );

    const localPlayerId = simulation.getLocalPlayerId()!;
    const localPlayer = getInternalPlayer(simulation, localPlayerId);
    localPlayer.position = { x: 9.2, y: PLAYER_GROUND_Y, z: 10.5 };
    localPlayer.velocity = { x: 0, y: 0, z: 0 };
    localPlayer.facing = { x: 1, z: 0 };
    localPlayer.grounded = true;

    const eggs = (simulation as unknown as { eggs: Map<string, any> }).eggs;
    eggs.set("manual-egg", {
      id: "manual-egg",
      ownerId: localPlayerId,
      fuseRemaining: 0,
      grounded: true,
      position: { x: 10.2, y: COLLAPSE_SUPPORT_Y + 0.5, z: 10.5 },
      velocity: { x: 0, y: 0, z: 0 }
    });

    simulation.step({
      [localPlayerId]: idle()
    });

    const clusters = simulation.getFallingClusters();
    expect(clusters).toHaveLength(1);
    expect(simulation.getWorld().getVoxelKind(11, FLOATING_TEST_Y, 10)).toBeUndefined();
    expect(simulation.getWorld().getVoxelKind(12, FLOATING_TEST_Y, 10)).toBeUndefined();
    expect(simulation.getWorld().getVoxelKind(13, FLOATING_TEST_Y, 10)).toBeUndefined();
  });

  it("spawns sky drops near alive players and lands them as permanent ground blocks", () => {
    const simulation = new OutOfBoundsSimulation({
      skyDropIntervalMin: 0.01,
      skyDropIntervalMax: 0.01,
      skyDropWarningDuration: 0.1,
      skyDropSpawnHeight: 3,
      skyDropGravity: 48,
      maxActiveSkyDrops: 1
    });
    simulation.reset("explore", createArenaDocument(), {
      localPlayerName: "You"
    });

    const localPlayerId = simulation.getLocalPlayerId()!;
    const localPlayer = getInternalPlayer(simulation, localPlayerId);
    localPlayer.position = { x: 20.5, y: PLAYER_GROUND_Y, z: 20.5 };
    localPlayer.velocity = { x: 0, y: 0, z: 0 };
    localPlayer.grounded = true;

    (simulation as unknown as { skyDropCooldown: number }).skyDropCooldown = 0;

    simulation.step({
      [localPlayerId]: idle()
    });

    const spawned = simulation.getSkyDrops();
    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.phase).toBe("warning");

    const landingVoxel = spawned[0]!.landingVoxel;
    expect(Math.abs(landingVoxel.x + 0.5 - localPlayer.position.x)).toBeLessThanOrEqual(simulation.config.skyDropSpawnRadius);
    expect(Math.abs(landingVoxel.z + 0.5 - localPlayer.position.z)).toBeLessThanOrEqual(simulation.config.skyDropSpawnRadius);
    expect(simulation.getWorld().getVoxelKind(landingVoxel.x, landingVoxel.y - 1, landingVoxel.z)).toBe("ground");
    (simulation as unknown as { skyDropCooldown: number }).skyDropCooldown = 999;

    advanceSimulation(simulation, 90, {
      [localPlayerId]: idle()
    });

    expect(simulation.getSkyDrops()).toEqual([]);
    expect(simulation.getWorld().getVoxelKind(landingVoxel.x, landingVoxel.y, landingVoxel.z)).toBe("ground");
  });

  it("applies sky-drop stun and ignores movement and action spending until recovery", () => {
    const simulation = createTestSimulation("explore", (world) => {
      world.setVoxel(21, DEFAULT_SURFACE_Y, 20, "boundary");
    });
    const localPlayerId = simulation.getLocalPlayerId()!;
    const localPlayer = getInternalPlayer(simulation, localPlayerId);
    localPlayer.position = { x: 20.5, y: PLAYER_GROUND_Y, z: 20.5 };
    localPlayer.velocity = { x: 0, y: 0, z: 0 };
    localPlayer.mass = simulation.config.maxMass;
    localPlayer.grounded = true;

    const skyDrops = (simulation as unknown as { skyDrops: Map<string, any> }).skyDrops;
    skyDrops.set("manual-sky", {
      id: "manual-sky",
      phase: "falling",
      warningRemaining: 0,
      landingVoxel: { x: 20, y: DEFAULT_SURFACE_Y, z: 20 },
      offsetY: 0.7,
      velocityY: 0,
      damagedPlayerIds: new Set<string>()
    });

    simulation.step({
      [localPlayerId]: idle()
    });

    const stunned = simulation.getPlayerState(localPlayerId)!;
    expect(stunned.mass).toBe(simulation.config.maxMass);
    expect(stunned.livesRemaining).toBe(simulation.config.maxLives - 1);
    expect(stunned.stunRemaining).toBeGreaterThan(0);
    expect(stunned.velocity.y).toBeGreaterThanOrEqual(simulation.config.eggBlastLift);

    const massAfterImpact = stunned.mass;
    simulation.step({
      [localPlayerId]: idle({
        moveX: 1,
        jump: true,
        jumpPressed: true,
        push: true,
        destroy: true,
        place: true,
        targetVoxel: { x: 21, y: DEFAULT_SURFACE_Y, z: 20 },
        targetNormal: { x: 0, y: 1, z: 0 }
      })
    });

    expect(simulation.getPlayerState(localPlayerId)!.mass).toBe(massAfterImpact);
    expect(simulation.getWorld().getVoxelKind(21, DEFAULT_SURFACE_Y, 20)).toBe("boundary");
    expect(simulation.getWorld().getVoxelKind(21, DEFAULT_SURFACE_Y + 1, 20)).toBeUndefined();
  });

  it("lays eggs, spends mass once, and explodes through shared terrain updates", () => {
    const simulation = new OutOfBoundsSimulation({
      eggCost: 20,
      eggFuseDuration: 0.12,
      eggThrowSpeed: 0,
      eggGravity: 0,
      eggScatterFlightDuration: 0.12,
      skyDropIntervalMin: 999,
      skyDropIntervalMax: 999
    });
    simulation.reset("explore", createArenaDocument(), {
      localPlayerName: "You"
    });

    const localPlayerId = simulation.getLocalPlayerId()!;
    const localPlayer = getInternalPlayer(simulation, localPlayerId);
    localPlayer.position = { x: 20.5, y: PLAYER_GROUND_Y, z: 20.5 };
    localPlayer.velocity = { x: 0, y: 0, z: 0 };
    localPlayer.facing = { x: 1, z: 0 };
    localPlayer.mass = 80;
    localPlayer.grounded = true;

    const terrainBefore = simulation.getWorld().getTerrainRevision();
    simulation.step({
      [localPlayerId]: layEgg()
    });

    expect(simulation.getEggs()).toHaveLength(1);
    expect(simulation.getPlayerState(localPlayerId)!.mass).toBe(60);
    expect(simulation.getPlayerState(localPlayerId)!.eggTauntSequence).toBe(1);
    expect(simulation.getPlayerState(localPlayerId)!.eggTauntRemaining).toBeCloseTo(1.6, 5);

    advanceSimulation(simulation, 20, {
      [localPlayerId]: idle()
    });

    expect(simulation.getEggs()).toEqual([]);
    expect(simulation.getWorld().getTerrainRevision()).toBeGreaterThan(terrainBefore);
  });

  it("expires egg taunts after the configured duration", () => {
    const simulation = createTestSimulation("explore");
    const localPlayerId = simulation.getLocalPlayerId()!;
    const localPlayer = getInternalPlayer(simulation, localPlayerId);
    localPlayer.mass = simulation.config.maxMass;
    localPlayer.grounded = true;

    simulation.step({
      [localPlayerId]: layEgg()
    });

    advanceSimulation(simulation, 96, {
      [localPlayerId]: idle()
    });

    expect(simulation.getPlayerState(localPlayerId)!.eggTauntRemaining).toBeLessThan(1e-9);
  });

  it("emits an egg explosion burst while keeping scatter debris available to the renderer", () => {
    const simulation = new OutOfBoundsSimulation({
      eggCost: 20,
      eggFuseDuration: 0.12,
      eggThrowSpeed: 0,
      eggGravity: 0,
      eggBlastDestroyDepth: 999,
      eggScatterBudget: 4,
      eggScatterFlightDuration: 0.24,
      skyDropIntervalMin: 999,
      skyDropIntervalMax: 999
    });
    simulation.reset("explore", createArenaDocument(), {
      localPlayerName: "You"
    });

    const localPlayerId = simulation.getLocalPlayerId()!;
    const localPlayer = getInternalPlayer(simulation, localPlayerId);
    localPlayer.position = { x: 20.5, y: PLAYER_GROUND_Y, z: 20.5 };
    localPlayer.velocity = { x: 0, y: 0, z: 0 };
    localPlayer.facing = { x: 1, z: 0 };
    localPlayer.mass = 80;
    localPlayer.grounded = true;

    simulation.step({
      [localPlayerId]: layEgg()
    });
    advanceSimulation(simulation, 8, {
      [localPlayerId]: idle()
    });

    const snapshot = simulation.getSnapshot();
    expect(snapshot.voxelBursts.some((burst) => burst.style === "eggExplosion")).toBe(true);
    expect(snapshot.eggScatterDebris.length).toBeGreaterThan(0);
  });

  it("does not spend extra mass when egg placement is blocked by the active-egg cap", () => {
    const simulation = new OutOfBoundsSimulation({
      eggCost: 15,
      eggFuseDuration: 999,
      maxActiveEggsPerPlayer: 1,
      skyDropIntervalMin: 999,
      skyDropIntervalMax: 999
    });
    simulation.reset("explore", createArenaDocument(), {
      localPlayerName: "You"
    });

    const localPlayerId = simulation.getLocalPlayerId()!;
    const localPlayer = getInternalPlayer(simulation, localPlayerId);
    localPlayer.mass = 90;
    localPlayer.grounded = true;

    simulation.step({
      [localPlayerId]: layEgg()
    });
    simulation.step({
      [localPlayerId]: layEgg()
    });

    expect(simulation.getEggs()).toHaveLength(1);
    expect(simulation.getPlayerState(localPlayerId)!.mass).toBe(75);
    expect(simulation.getPlayerState(localPlayerId)!.eggTauntSequence).toBe(1);
  });

  it("reports egg hud loading progress while the player is capped on active eggs", () => {
    const simulation = new OutOfBoundsSimulation({
      eggCost: 15,
      eggFuseDuration: 999,
      maxActiveEggsPerPlayer: 1,
      skyDropIntervalMin: 999,
      skyDropIntervalMax: 999
    });
    simulation.reset("explore", createArenaDocument(), {
      localPlayerName: "You"
    });

    const localPlayerId = simulation.getLocalPlayerId()!;
    const localPlayer = getInternalPlayer(simulation, localPlayerId);
    localPlayer.mass = 90;
    localPlayer.grounded = true;

    simulation.step({
      [localPlayerId]: layEgg()
    });

    expect(simulation.getHudState().eggStatus).toEqual(
      expect.objectContaining({
        reason: "cooldown",
        hasMatter: true,
        ready: false,
        activeCount: 1,
        maxActiveCount: 1,
        cost: 15,
        cooldownDuration: 999,
        canQuickEgg: false,
        canChargedThrow: false
      })
    );
    expect(simulation.getHudState().eggStatus?.cooldownRemaining).toBeCloseTo(999 - 1 / simulation.config.tickRate, 4);
  });

  it("treats grounded tap throws as a minimum-charge lob and lets longer holds launch harder", () => {
    const createGroundedThrowVelocity = (eggCharge: number) => {
      const simulation = new OutOfBoundsSimulation({
        eggGravity: 0,
        skyDropIntervalMin: 999,
        skyDropIntervalMax: 999
      });
      simulation.reset("explore", createArenaDocument(), {
        localPlayerName: "You"
      });

      const localPlayerId = simulation.getLocalPlayerId()!;
      const localPlayer = getInternalPlayer(simulation, localPlayerId);
      localPlayer.position = { x: 20.5, y: PLAYER_GROUND_Y, z: 20.5 };
      localPlayer.velocity = { x: 0, y: 0, z: 0 };
      localPlayer.facing = { x: 1, z: 0 };
      localPlayer.mass = 80;
      localPlayer.grounded = true;

      simulation.step({
        [localPlayerId]: layEgg({
          eggCharge,
          eggPitch: (-22 * Math.PI) / 180
        })
      });

      return ((simulation as unknown as { eggs: Map<string, { velocity: { x: number; y: number; z: number } }> }).eggs
        .values()
        .next()
        .value as { velocity: { x: number; y: number; z: number } }).velocity;
    };

    const tapVelocity = createGroundedThrowVelocity(0);
    const minChargeVelocity = createGroundedThrowVelocity(0.18);
    const heldVelocity = createGroundedThrowVelocity(1);

    expect(tapVelocity.x).toBeCloseTo(minChargeVelocity.x, 5);
    expect(tapVelocity.y).toBeCloseTo(minChargeVelocity.y, 5);
    expect(Math.hypot(heldVelocity.x, heldVelocity.z)).toBeGreaterThan(Math.hypot(tapVelocity.x, tapVelocity.z));
    expect(heldVelocity.y).toBeGreaterThan(tapVelocity.y);
    expect(heldVelocity.x).toBeGreaterThan(tapVelocity.x * 1.45);
    expect(heldVelocity.y).toBeGreaterThan(tapVelocity.y * 1.7);
  });

  it("keeps airborne throws on the legacy immediate path instead of applying the grounded charge arc", () => {
    const createAirborneThrowVelocity = (eggCharge: number, eggPitch: number) => {
      const simulation = new OutOfBoundsSimulation({
        skyDropIntervalMin: 999,
        skyDropIntervalMax: 999
      });
      simulation.reset("explore", createArenaDocument(), {
        localPlayerName: "You"
      });

      const localPlayerId = simulation.getLocalPlayerId()!;
      const localPlayer = getInternalPlayer(simulation, localPlayerId);
      localPlayer.position = { x: 20.5, y: PLAYER_GROUND_Y + 1.2, z: 20.5 };
      localPlayer.velocity = { x: 1.25, y: 0.8, z: -0.4 };
      localPlayer.facing = { x: 1, z: 0 };
      localPlayer.mass = 80;
      localPlayer.grounded = false;
      localPlayer.spacePhase = "none";

      simulation.step({
        [localPlayerId]: layEgg({
          eggCharge,
          eggPitch
        })
      });

      return ((simulation as unknown as { eggs: Map<string, { velocity: { x: number; y: number; z: number } }> }).eggs
        .values()
        .next()
        .value as { velocity: { x: number; y: number; z: number } }).velocity;
    };

    const defaultAirborneVelocity = createAirborneThrowVelocity(0, 0);
    const chargedAirborneVelocity = createAirborneThrowVelocity(1, 0.7);

    expect(chargedAirborneVelocity.x).toBeCloseTo(defaultAirborneVelocity.x, 5);
    expect(chargedAirborneVelocity.y).toBeCloseTo(defaultAirborneVelocity.y, 5);
    expect(chargedAirborneVelocity.z).toBeCloseTo(defaultAirborneVelocity.z, 5);
  });

  it("keeps grenade-like tangential carry on impact but settles quickly after the first bounce", () => {
    const simulation = new OutOfBoundsSimulation({
      eggFuseDuration: 999,
      eggGravity: 24,
      skyDropIntervalMin: 999,
      skyDropIntervalMax: 999
    });
    simulation.reset("explore", createArenaDocument(), {
      localPlayerName: "You"
    });

    const eggs = (simulation as unknown as { eggs: Map<string, any> }).eggs;
    eggs.set("manual-bounce-egg", {
      id: "manual-bounce-egg",
      ownerId: simulation.getLocalPlayerId()!,
      fuseRemaining: 999,
      grounded: false,
      orbital: false,
      explodeOnGroundContact: false,
      fuseArmedBelowY: null,
      position: { x: 20.5, y: PLAYER_GROUND_Y + 0.42, z: 20.5 },
      velocity: { x: 5, y: -6, z: 0.4 }
    });

    advanceSimulation(simulation, 4, {
      [simulation.getLocalPlayerId()!]: idle()
    });

    const bouncedEgg = eggs.get("manual-bounce-egg")!;
    expect(bouncedEgg.velocity.x).toBeGreaterThan(3.5);
    expect(bouncedEgg.velocity.y).toBeGreaterThan(0);
    expect(bouncedEgg.velocity.y).toBeLessThan(2.5);

    advanceSimulation(simulation, 75, {
      [simulation.getLocalPlayerId()!]: idle()
    });

    expect(Math.abs(bouncedEgg.velocity.y)).toBeLessThan(0.001);
    expect(Math.hypot(bouncedEgg.velocity.x, bouncedEgg.velocity.z)).toBeLessThan(0.5);
  });

  it("extends the default blast enough to catch slightly farther players and voxels", () => {
    const map = createArenaDocument((world) => {
      world.setVoxel(20, DEFAULT_SURFACE_Y, 19, "ground");
    });
    const simulation = createTestSimulation("playNpc");
    simulation.reset("playNpc", map, {
      npcCount: 4,
      localPlayerName: "You"
    });
    const simulationInternals = simulation as unknown as { generateNpcCommand: (player: unknown) => PlayerCommand };
    simulationInternals.generateNpcCommand = () => idle();
    const localPlayerId = simulation.getLocalPlayerId()!;
    const npcId = getNpcId(simulation)!;
    const localPlayer = getInternalPlayer(simulation, localPlayerId);
    const npcPlayer = getInternalPlayer(simulation, npcId);
    const otherNpcIds = simulation
      .getSnapshot()
      .players.filter((player) => player.kind === "npc" && player.id !== npcId)
      .map((player) => player.id);

    localPlayer.position = { x: 18.5, y: PLAYER_GROUND_Y, z: 18.5 };
    localPlayer.grounded = true;
    npcPlayer.position = { x: 21.3, y: PLAYER_GROUND_Y, z: 18.5 };
    npcPlayer.velocity = { x: 0, y: 0, z: 0 };
    npcPlayer.grounded = true;
    otherNpcIds.forEach((otherNpcId, index) => {
      const otherNpc = getInternalPlayer(simulation, otherNpcId);
      otherNpc.position = { x: 32 + index * 3, y: PLAYER_GROUND_Y, z: 32 };
      otherNpc.velocity = { x: 0, y: 0, z: 0 };
      otherNpc.grounded = true;
    });

    const eggs = (simulation as unknown as { eggs: Map<string, any> }).eggs;
    eggs.set("manual-radius-egg", {
      id: "manual-radius-egg",
      ownerId: localPlayerId,
      fuseRemaining: 0,
      grounded: true,
      orbital: false,
      explodeOnGroundContact: false,
      fuseArmedBelowY: null,
      position: { x: 18.5, y: PLAYER_GROUND_Y + 0.22, z: 18.5 },
      velocity: { x: 0, y: 0, z: 0 }
    });

    simulation.step({
      [localPlayerId]: idle()
    });

    expect(simulation.getPlayerState(npcId)!.livesRemaining).toBe(simulation.config.maxLives - 1);
    expect(simulation.getWorld().getVoxelKind(20, DEFAULT_SURFACE_Y, 19)).toBeUndefined();
  });

  it("keeps unrelated egg defaults intact when overriding one tuning field", () => {
    const simulation = new OutOfBoundsSimulation({
      eggCost: 11
    });

    expect(simulation.config.eggCost).toBe(11);
    expect(simulation.config.eggFuseDuration).toBe(defaultSimulationConfig.eggFuseDuration);
    expect(simulation.config.maxActiveEggsPerPlayer).toBe(defaultSimulationConfig.maxActiveEggsPerPlayer);
    expect(simulation.config.jumpBufferDuration).toBe(defaultSimulationConfig.jumpBufferDuration);
    expect(simulation.config.jetpackHoldActivationDelay).toBe(
      defaultSimulationConfig.jetpackHoldActivationDelay
    );
    expect(simulation.config.startingLives).toBe(defaultSimulationConfig.startingLives);
  });

  it("keeps the tuned shared movement defaults available through the live simulation config", () => {
    const simulation = new OutOfBoundsSimulation();

    expect(simulation.config.moveSpeed).toBe(defaultSimulationConfig.moveSpeed);
    expect(simulation.config.moveSpeed).toBe(6.6);
    expect(simulation.config.groundAcceleration).toBe(defaultSimulationConfig.groundAcceleration);
    expect(simulation.config.groundAcceleration).toBe(30.8);
    expect(simulation.config.airAcceleration).toBe(defaultSimulationConfig.airAcceleration);
    expect(simulation.config.airAcceleration).toBe(13.2);
  });

  it("exposes the tuned default matter economy through the live simulation config", () => {
    const simulation = new OutOfBoundsSimulation();

    expect(simulation.config.maxMass).toBe(defaultSimulationConfig.maxMass);
    expect(simulation.config.maxMass).toBe(500);
    expect(simulation.config.startingMass).toBe(defaultSimulationConfig.startingMass);
    expect(simulation.config.startingMass).toBe(24);
    expect(simulation.config.placeCost).toBe(defaultSimulationConfig.placeCost);
    expect(simulation.config.placeCost).toBe(10);
    expect(simulation.config.destroyGain).toBe(defaultSimulationConfig.destroyGain);
    expect(simulation.config.destroyGain).toBe(10);
  });

  it("pushes valid targets and respects cooldown", () => {
    const simulation = createTestSimulation("playNpc");
    const simulationInternals = simulation as unknown as { generateNpcCommand: (player: unknown) => PlayerCommand };
    simulationInternals.generateNpcCommand = () => idle();
    const localPlayerId = simulation.getLocalPlayerId()!;
    const npcId = getNpcId(simulation)!;
    const otherNpcIds = simulation
      .getSnapshot()
      .players.filter((player) => player.kind === "npc" && player.id !== npcId)
      .map((player) => player.id);

    const localPlayer = getInternalPlayer(simulation, localPlayerId);
    const npcPlayer = getInternalPlayer(simulation, npcId);
    localPlayer.position = { x: 10.5, y: PLAYER_GROUND_Y, z: 10.5 };
    localPlayer.velocity = { x: 0, y: 0, z: 0 };
    localPlayer.facing = { x: 1, z: 0 };
    localPlayer.grounded = true;
    localPlayer.mass = simulation.config.maxMass;
    npcPlayer.position = { x: 11.4, y: PLAYER_GROUND_Y, z: 10.5 };
    npcPlayer.velocity = { x: 0, y: 0, z: 0 };
    npcPlayer.grounded = true;
    otherNpcIds.forEach((otherNpcId, index) => {
      const otherNpc = getInternalPlayer(simulation, otherNpcId);
      otherNpc.position = { x: 30 + index * 3, y: PLAYER_GROUND_Y, z: 30 };
      otherNpc.velocity = { x: 0, y: 0, z: 0 };
      otherNpc.grounded = true;
    });

    simulation.step({
      [localPlayerId]: push()
    });

    const afterFirstPush = simulation.getPlayerViewState(localPlayerId)!;
    const afterFirstPushVisualRemaining = simulation.getPlayerRuntimeState(localPlayerId)!.pushVisualRemaining;
    expect(simulation.getPlayerViewState(npcId)!.velocity.x).toBeGreaterThan(0);
    expect(afterFirstPush.mass).toBe(simulation.config.maxMass - simulation.config.pushCost);
    expect(afterFirstPushVisualRemaining).toBeGreaterThan(0);

    simulation.step({
      [localPlayerId]: push()
    });

    const afterCooldownAttempt = simulation.getPlayerViewState(localPlayerId)!;
    const afterCooldownRuntime = simulation.getPlayerRuntimeState(localPlayerId)!;
    expect(afterCooldownAttempt.mass).toBe(afterFirstPush.mass);
    expect(afterCooldownRuntime.pushVisualRemaining).toBeLessThan(afterFirstPushVisualRemaining);
  });

  it("scales push impulse upward with current mass", () => {
    const createPushSimulation = (mass: number) => {
      const simulation = createTestSimulation("playNpc");
      const simulationInternals = simulation as unknown as { generateNpcCommand: (player: unknown) => PlayerCommand };
      simulationInternals.generateNpcCommand = () => idle();
      const localPlayerId = simulation.getLocalPlayerId()!;
      const npcId = getNpcId(simulation)!;
      const localPlayer = getInternalPlayer(simulation, localPlayerId);
      const npcPlayer = getInternalPlayer(simulation, npcId);
      const otherNpcIds = simulation
        .getSnapshot()
        .players.filter((player) => player.kind === "npc" && player.id !== npcId)
        .map((player) => player.id);

      localPlayer.position = { x: 10.5, y: PLAYER_GROUND_Y, z: 10.5 };
      localPlayer.velocity = { x: 0, y: 0, z: 0 };
      localPlayer.facing = { x: 1, z: 0 };
      localPlayer.grounded = true;
      localPlayer.mass = mass;
      npcPlayer.position = { x: 11.4, y: PLAYER_GROUND_Y, z: 10.5 };
      npcPlayer.velocity = { x: 0, y: 0, z: 0 };
      npcPlayer.grounded = true;
      otherNpcIds.forEach((otherNpcId, index) => {
        const otherNpc = getInternalPlayer(simulation, otherNpcId);
        otherNpc.position = { x: 30 + index * 3, y: PLAYER_GROUND_Y, z: 30 };
        otherNpc.velocity = { x: 0, y: 0, z: 0 };
        otherNpc.grounded = true;
      });

      simulation.step({
        [localPlayerId]: push()
      });

      return simulation.getPlayerViewState(npcId)!.velocity.x;
    };

    const lowMassImpulse = createPushSimulation(20);
    const highMassImpulse = createPushSimulation(100);

    expect(highMassImpulse).toBeGreaterThan(lowMassImpulse);
  });

  it("refuses invalid pushes when targets are out of range or behind the player", () => {
    const simulation = createTestSimulation("playNpc");
    const simulationInternals = simulation as unknown as { generateNpcCommand: (player: unknown) => PlayerCommand };
    simulationInternals.generateNpcCommand = () => idle();
    const localPlayerId = simulation.getLocalPlayerId()!;
    const npcId = getNpcId(simulation)!;
    const localPlayer = getInternalPlayer(simulation, localPlayerId);
    const npcPlayer = getInternalPlayer(simulation, npcId);
    const otherNpcIds = simulation
      .getSnapshot()
      .players.filter((player) => player.kind === "npc" && player.id !== npcId)
      .map((player) => player.id);

    localPlayer.position = { x: 10.5, y: PLAYER_GROUND_Y, z: 10.5 };
    localPlayer.velocity = { x: 0, y: 0, z: 0 };
    localPlayer.facing = { x: 1, z: 0 };
    localPlayer.mass = simulation.config.maxMass;
    localPlayer.grounded = true;
    otherNpcIds.forEach((otherNpcId, index) => {
      const otherNpc = getInternalPlayer(simulation, otherNpcId);
      otherNpc.position = { x: 30 + index * 3, y: PLAYER_GROUND_Y, z: 30 };
      otherNpc.velocity = { x: 0, y: 0, z: 0 };
      otherNpc.grounded = true;
    });

    npcPlayer.position = { x: 15.5, y: PLAYER_GROUND_Y, z: 10.5 };
    simulation.step({
      [localPlayerId]: push()
    });
    expect(simulation.getPlayerViewState(localPlayerId)!.mass).toBe(simulation.config.maxMass);
    expect(simulation.getPlayerRuntimeState(localPlayerId)!.pushVisualRemaining).toBeGreaterThan(0);

    npcPlayer.position = { x: 9.7, y: PLAYER_GROUND_Y, z: 10.5 };
    simulation.step({
      [localPlayerId]: push()
    });
    expect(simulation.getPlayerViewState(localPlayerId)!.mass).toBe(simulation.config.maxMass);
  });

  it("does not start the push visual when the attempt is blocked by cooldown or insufficient mass", () => {
    const simulation = createTestSimulation("playNpc");
    const simulationInternals = simulation as unknown as { generateNpcCommand: (player: unknown) => PlayerCommand };
    simulationInternals.generateNpcCommand = () => idle();
    const localPlayerId = simulation.getLocalPlayerId()!;
    const npcId = getNpcId(simulation)!;
    const localPlayer = getInternalPlayer(simulation, localPlayerId);
    const npcPlayer = getInternalPlayer(simulation, npcId);

    localPlayer.position = { x: 10.5, y: PLAYER_GROUND_Y, z: 10.5 };
    localPlayer.velocity = { x: 0, y: 0, z: 0 };
    localPlayer.facing = { x: 1, z: 0 };
    localPlayer.mass = simulation.config.maxMass;
    localPlayer.grounded = true;
    npcPlayer.position = { x: 11.2, y: PLAYER_GROUND_Y, z: 10.5 };
    npcPlayer.velocity = { x: 0, y: 0, z: 0 };
    npcPlayer.grounded = true;

    simulation.step({
      [localPlayerId]: push()
    });
    expect(simulation.getPlayerRuntimeState(localPlayerId)!.pushVisualRemaining).toBeGreaterThan(0);

    localPlayer.pushCooldownRemaining = simulation.config.pushCooldown;
    localPlayer.pushVisualRemaining = 0;
    simulation.step({
      [localPlayerId]: push()
    });
    expect(simulation.getPlayerRuntimeState(localPlayerId)!.pushVisualRemaining).toBe(0);

    localPlayer.pushCooldownRemaining = 0;
    localPlayer.mass = simulation.config.pushCost - 1;
    simulation.step({
      [localPlayerId]: push()
    });
    expect(simulation.getPlayerRuntimeState(localPlayerId)!.pushVisualRemaining).toBe(0);
  });

  it("enters a space float only after crossing the altitude threshold upward", () => {
    const simulation = createTestSimulation("explore");
    const localPlayerId = simulation.getLocalPlayerId()!;
    const localPlayer = getInternalPlayer(simulation, localPlayerId);

    localPlayer.position = { x: 10.5, y: 59.9, z: 10.5 };
    localPlayer.velocity = { x: 0, y: 12, z: 0 };
    localPlayer.grounded = false;
    localPlayer.jetpackActive = true;
    localPlayer.spacePhase = "none";
    localPlayer.spacePhaseRemaining = 0;
    localPlayer.spaceTriggerArmed = true;

    simulation.step({
      [localPlayerId]: idle()
    }, 0.16);

    const runtimePlayer = simulation.getPlayerRuntimeState(localPlayerId)!;
    expect(runtimePlayer.spacePhase).toBe("float");
    expect(runtimePlayer.spacePhaseRemaining).toBeGreaterThan(4.8);
    expect(runtimePlayer.jetpackActive).toBe(false);
    expect(runtimePlayer.position.y).toBeGreaterThan(60);
  });

  it("starts space float without arming the default super-boom challenge", () => {
    const simulation = createTestSimulation("explore");
    const localPlayerId = simulation.getLocalPlayerId()!;
    const localPlayer = getInternalPlayer(simulation, localPlayerId);

    localPlayer.position = { x: 10.5, y: 59.9, z: 10.5 };
    localPlayer.velocity = { x: 0, y: 12, z: 0 };
    localPlayer.grounded = false;
    localPlayer.jetpackActive = true;
    localPlayer.spacePhase = "none";
    localPlayer.spacePhaseRemaining = 0;
    localPlayer.spaceTriggerArmed = true;

    simulation.step({
      [localPlayerId]: idle()
    }, 0.16);

    expect(localPlayer.spacePhase).toBe("float");
    expect(localPlayer.spaceChallengeTargetKey).toBeNull();
    expect(localPlayer.spaceChallengeHits).toBe(0);
    expect(localPlayer.spaceChallengeRequiredHits).toBe(0);
    expect(simulation.getHudState().spaceChallenge).toBeNull();
  });

  it("ignores typed mash input during default space float and keeps the bomb path disabled", () => {
    const simulation = createTestSimulation("explore");
    const localPlayerId = simulation.getLocalPlayerId()!;
    const localPlayer = getInternalPlayer(simulation, localPlayerId);
    const startingMass = localPlayer.mass;

    localPlayer.position = { x: 10.5, y: 76, z: 10.5 };
    localPlayer.velocity = { x: 0, y: 0.8, z: 0 };
    localPlayer.grounded = false;
    localPlayer.spacePhase = "float";
    localPlayer.spacePhaseRemaining = 5;
    localPlayer.spaceTriggerArmed = false;
    localPlayer.spaceChallengeTargetKey = null;
    localPlayer.spaceChallengeHits = 0;
    localPlayer.spaceChallengeRequiredHits = 0;

    simulation.step({
      [localPlayerId]: idle({ typedText: "x" })
    });
    expect(localPlayer.spaceChallengeHits).toBe(0);
    expect(localPlayer.spacePhase).toBe("float");

    simulation.step({
      [localPlayerId]: idle({ typedText: "g" })
    });
    expect(localPlayer.spaceChallengeHits).toBe(0);

    simulation.step({
      [localPlayerId]: idle({ typedText: "gg" })
    });
    expect(localPlayer.spaceChallengeHits).toBe(0);
    expect(localPlayer.spacePhase).toBe("float");

    simulation.step({
      [localPlayerId]: idle({ typedText: "xgg" })
    });

    expect(localPlayer.spaceChallengeHits).toBe(0);
    expect(localPlayer.spacePhase).toBe("float");
    expect(localPlayer.mass).toBe(startingMass);
    expect(localPlayer.velocity.y).toBeGreaterThan(0);
    expect(simulation.getHudState().spaceChallenge).toBeNull();
  });

  it("allows light drift and orbital egg drops during the float window while keeping push locked", () => {
    const simulation = createTestSimulation("playNpc");
    const simulationInternals = simulation as unknown as { generateNpcCommand: (player: unknown) => PlayerCommand };
    simulationInternals.generateNpcCommand = () => idle();
    const localPlayerId = simulation.getLocalPlayerId()!;
    const npcId = getNpcId(simulation)!;
    const localPlayer = getInternalPlayer(simulation, localPlayerId);
    const npcPlayer = getInternalPlayer(simulation, npcId);
    const otherNpcIds = simulation
      .getSnapshot()
      .players.filter((player) => player.kind === "npc" && player.id !== npcId)
      .map((player) => player.id);

    localPlayer.position = { x: 10.5, y: 76, z: 10.5 };
    localPlayer.velocity = { x: 0, y: 1.4, z: 0 };
    localPlayer.facing = { x: 1, z: 0 };
    localPlayer.grounded = false;
    localPlayer.mass = simulation.config.maxMass;
    localPlayer.spacePhase = "float";
    localPlayer.spacePhaseRemaining = 5;
    localPlayer.spaceTriggerArmed = false;
    localPlayer.pushVisualRemaining = 0;

    npcPlayer.position = { x: 13.4, y: 76, z: 10.5 };
    npcPlayer.velocity = { x: 0, y: 0, z: 0 };
    npcPlayer.grounded = false;
    otherNpcIds.forEach((otherNpcId, index) => {
      const otherNpc = getInternalPlayer(simulation, otherNpcId);
      otherNpc.position = { x: 30 + index * 3, y: PLAYER_GROUND_Y, z: 30 };
      otherNpc.velocity = { x: 0, y: 0, z: 0 };
      otherNpc.grounded = true;
    });

    simulation.step({
      [localPlayerId]: {
        ...move(1, 0),
        push: true,
        layEgg: true
      }
    });

    expect(simulation.getEggs()).toHaveLength(1);
    expect(simulation.getPlayerState(localPlayerId)!.mass).toBe(simulation.config.maxMass - simulation.config.eggCost);
    expect(simulation.getPlayerRuntimeState(localPlayerId)!.pushVisualRemaining).toBe(0);
    expect(simulation.getPlayerState(npcId)!.velocity.x).toBe(0);

    advanceSimulation(simulation, 45, {
      [localPlayerId]: move(1, 0)
    });

    const driftingPlayer = simulation.getPlayerRuntimeState(localPlayerId)!;
    expect(driftingPlayer.spacePhase).toBe("float");
    expect(driftingPlayer.velocity.x).toBeGreaterThan(0.8);
    expect(driftingPlayer.velocity.x).toBeLessThanOrEqual(simulation.config.moveSpeed * 0.38 + 0.05);
  });

  it("spawns orbital eggs above the map and keeps them alive past the base fuse while still in space", () => {
    const simulation = new OutOfBoundsSimulation({
      eggFuseDuration: 1.6,
      skyDropIntervalMin: 999,
      skyDropIntervalMax: 999
    });
    simulation.reset("explore", createArenaDocument(), {
      localPlayerName: "You"
    });

    const localPlayerId = simulation.getLocalPlayerId()!;
    const localPlayer = getInternalPlayer(simulation, localPlayerId);
    localPlayer.position = { x: 10.5, y: 200, z: 10.5 };
    localPlayer.velocity = { x: 2.4, y: 1.4, z: 0 };
    localPlayer.facing = { x: 1, z: 0 };
    localPlayer.grounded = false;
    localPlayer.mass = simulation.config.maxMass;
    localPlayer.spacePhase = "float";
    localPlayer.spacePhaseRemaining = 5;
    localPlayer.spaceTriggerArmed = false;

    simulation.step({
      [localPlayerId]: layEgg()
    });

    const eggs = (simulation as unknown as { eggs: Map<string, any> }).eggs;
    const orbitalEgg = eggs.values().next().value;
    expect(orbitalEgg.orbital).toBe(true);
    expect(orbitalEgg.position.y).toBeGreaterThan(simulation.getWorld().size.y);
    expect(orbitalEgg.velocity.y).toBeLessThan(-10);
    expect(orbitalEgg.fuseRemaining).toBeGreaterThan(simulation.config.eggFuseDuration);

    advanceSimulation(simulation, 120, {
      [localPlayerId]: idle()
    });

    expect(simulation.getEggs()).toHaveLength(1);
    expect(simulation.getEggs()[0]!.position.y).toBeGreaterThan(simulation.getWorld().size.y);
  });

  it("gives orbital eggs a stronger blast without increasing life loss per hit", () => {
    const createBlastOutcome = (orbital: boolean) => {
      const simulation = createTestSimulation("playNpc");
      const simulationInternals = simulation as unknown as { generateNpcCommand: (player: unknown) => PlayerCommand };
      simulationInternals.generateNpcCommand = () => idle();
      const localPlayerId = simulation.getLocalPlayerId()!;
      const npcId = getNpcId(simulation)!;
      const localPlayer = getInternalPlayer(simulation, localPlayerId);
      const npcPlayer = getInternalPlayer(simulation, npcId);
      const otherNpcIds = simulation
        .getSnapshot()
        .players.filter((player) => player.kind === "npc" && player.id !== npcId)
        .map((player) => player.id);

      localPlayer.position = { x: 18.5, y: PLAYER_GROUND_Y, z: 18.5 };
      localPlayer.grounded = true;
      npcPlayer.position = { x: 20.2, y: PLAYER_GROUND_Y, z: 18.5 };
      npcPlayer.velocity = { x: 0, y: 0, z: 0 };
      npcPlayer.grounded = true;
      otherNpcIds.forEach((otherNpcId, index) => {
        const otherNpc = getInternalPlayer(simulation, otherNpcId);
        otherNpc.position = { x: 30 + index * 3, y: PLAYER_GROUND_Y, z: 30 };
        otherNpc.velocity = { x: 0, y: 0, z: 0 };
        otherNpc.grounded = true;
      });

      const eggs = (simulation as unknown as { eggs: Map<string, any> }).eggs;
      eggs.set("manual-egg", {
        id: "manual-egg",
        ownerId: localPlayerId,
        fuseRemaining: 0,
        grounded: true,
        orbital,
        explodeOnGroundContact: orbital,
        fuseArmedBelowY: null,
        position: { x: 18.5, y: PLAYER_GROUND_Y + 0.22, z: 18.5 },
        velocity: { x: 0, y: 0, z: 0 }
      });

      simulation.step({
        [localPlayerId]: idle()
      });

      return simulation.getPlayerState(npcId)!;
    };

    const normalHit = createBlastOutcome(false);
    const orbitalHit = createBlastOutcome(true);

    expect(normalHit.livesRemaining).toBe(normalHit.maxLives - 1);
    expect(orbitalHit.livesRemaining).toBe(orbitalHit.maxLives - 1);
    expect(orbitalHit.velocity.y).toBeGreaterThan(normalHit.velocity.y);
    expect(orbitalHit.stunRemaining).toBeGreaterThan(normalHit.stunRemaining);
    expect(Math.abs(orbitalHit.velocity.x)).toBeGreaterThan(Math.abs(normalHit.velocity.x));
  });

  it("switches from float to reentry and rearms after descending", () => {
    const simulation = createTestSimulation("explore");
    const localPlayerId = simulation.getLocalPlayerId()!;
    const localPlayer = getInternalPlayer(simulation, localPlayerId);

    localPlayer.position = { x: 10.5, y: 60.6, z: 10.5 };
    localPlayer.velocity = { x: 0, y: 1.4, z: 0 };
    localPlayer.grounded = false;
    localPlayer.mass = simulation.config.maxMass;
    localPlayer.spacePhase = "float";
    localPlayer.spacePhaseRemaining = 0.35;
    localPlayer.spaceTriggerArmed = false;
    localPlayer.pushVisualRemaining = 0;

    simulation.step({
      [localPlayerId]: idle()
    }, 0.1);

    simulation.step({
      [localPlayerId]: idle()
    }, 0.3);

    const reentryPlayer = getInternalPlayer(simulation, localPlayerId);
    expect(reentryPlayer.spacePhase).toBe("reentry");
    expect(reentryPlayer.velocity.y).toBeLessThanOrEqual(-12);
    expect(reentryPlayer.jetpackEligible).toBe(false);
    expect(simulation.getHudState().spaceChallenge).toBeNull();

    simulation.step({
      [localPlayerId]: idle()
    }, 0.45);

    expect(reentryPlayer.spacePhase).toBe("none");
    expect(reentryPlayer.position.y).toBeLessThanOrEqual(48.5);
    expect(reentryPlayer.spaceTriggerArmed).toBe(true);
  });

  it("resolves super boom impacts with a visible impact hold before the rebound", () => {
    const simulation = createTestSimulation("playNpc");
    const simulationInternals = simulation as unknown as { generateNpcCommand: (player: unknown) => PlayerCommand };
    simulationInternals.generateNpcCommand = () => idle();
    const localPlayerId = simulation.getLocalPlayerId()!;
    const npcId = getNpcId(simulation)!;
    const localPlayer = getInternalPlayer(simulation, localPlayerId);
    const npcPlayer = getInternalPlayer(simulation, npcId);
    const otherNpcIds = simulation
      .getSnapshot()
      .players.filter((player) => player.kind === "npc" && player.id !== npcId)
      .map((player) => player.id);

    localPlayer.position = { x: 18.5, y: PLAYER_GROUND_Y + 1.5, z: 18.5 };
    localPlayer.velocity = { x: 0, y: -48, z: 0 };
    localPlayer.grounded = false;
    localPlayer.spacePhase = "superBoomDive";
    localPlayer.spacePhaseRemaining = 0;
    localPlayer.spaceTriggerArmed = false;
    localPlayer.spaceChallengeTargetKey = "g";
    localPlayer.spaceChallengeHits = 5;
    localPlayer.spaceChallengeRequiredHits = 5;

    npcPlayer.position = { x: 20.4, y: PLAYER_GROUND_Y, z: 18.5 };
    npcPlayer.velocity = { x: 0, y: 0, z: 0 };
    npcPlayer.grounded = true;
    otherNpcIds.forEach((otherNpcId, index) => {
      const otherNpc = getInternalPlayer(simulation, otherNpcId);
      otherNpc.position = { x: 32 + index * 3, y: PLAYER_GROUND_Y, z: 32 };
      otherNpc.velocity = { x: 0, y: 0, z: 0 };
      otherNpc.grounded = true;
    });

    const impactOrigin = { ...localPlayer.position };

    simulation.step({
      [localPlayerId]: idle()
    }, 0.08);

    const impactTerrainBatch = simulation.consumeTerrainDeltaBatch();
    const impactGameplayBatch = simulation.consumeGameplayEventBatch();
    const impactPlayer = getInternalPlayer(simulation, localPlayerId);
    const damagedNpc = simulation.getPlayerState(npcId)!;

    expect(impactTerrainBatch?.changes.some((change) => change.source === "super_boom_explosion")).toBe(true);
    expect(impactGameplayBatch?.events.some((event) => event.type === "explosion_resolved")).toBe(true);
    expect(simulation.getSnapshot().voxelBursts.some((burst) => burst.style === "superBoomExplosion")).toBe(true);
    expect(damagedNpc.livesRemaining).toBe(damagedNpc.maxLives - 1);
    expect(damagedNpc.velocity.y).toBeGreaterThan(simulation.config.eggBlastLift);
    expect(damagedNpc.stunRemaining).toBeGreaterThan(simulation.config.eggBlastStunDuration);
    expect(impactPlayer.mass).toBe(0);
    expect(impactPlayer.spacePhase).toBe("superBoomImpact");
    expect(impactPlayer.spacePhaseRemaining).toBeGreaterThan(0);
    expect(impactPlayer.velocity).toEqual({ x: 0, y: 0, z: 0 });

    simulation.step({
      [localPlayerId]: idle()
    }, 0.17);

    const reboundPlayer = getInternalPlayer(simulation, localPlayerId);
    const reboundTerrainBatch = simulation.consumeTerrainDeltaBatch();
    const reboundGameplayBatch = simulation.consumeGameplayEventBatch();
    const reboundDistance = Math.hypot(
      reboundPlayer.position.x - impactOrigin.x,
      reboundPlayer.position.z - impactOrigin.z
    );

    expect(reboundTerrainBatch).toBeNull();
    expect(reboundGameplayBatch).toBeNull();
    expect(simulation.getPlayerState(npcId)!.livesRemaining).toBe(damagedNpc.maxLives - 1);
    expect(reboundPlayer.spacePhase).toBe("none");
    expect(reboundPlayer.mass).toBe(0);
    expect(reboundPlayer.spaceTriggerArmed).toBe(false);
    expect(reboundPlayer.position.y).toBeGreaterThanOrEqual(PLAYER_GROUND_Y);
    expect(reboundDistance).toBeGreaterThanOrEqual(4);
    expect(reboundDistance).toBeLessThanOrEqual(10.5);
  });

  it("forces a failed challenge into a downward reentry even if jump is held", () => {
    const simulation = createTestSimulation("explore");
    const localPlayerId = simulation.getLocalPlayerId()!;
    const localPlayer = getInternalPlayer(simulation, localPlayerId);

    localPlayer.position = { x: 10.5, y: 60.6, z: 10.5 };
    localPlayer.velocity = { x: 0, y: 5.8, z: 0 };
    localPlayer.grounded = false;
    localPlayer.mass = simulation.config.maxMass;
    localPlayer.spacePhase = "float";
    localPlayer.spacePhaseRemaining = 0.04;
    localPlayer.spaceTriggerArmed = false;
    localPlayer.spaceChallengeTargetKey = "g";
    localPlayer.spaceChallengeHits = 0;
    localPlayer.spaceChallengeRequiredHits = 5;
    localPlayer.jetpackEligible = false;
    localPlayer.jetpackActive = false;

    simulation.step({
      [localPlayerId]: { ...idle(), jump: true }
    }, 0.08);

    const failedPlayer = simulation.getPlayerRuntimeState(localPlayerId)!;
    expect(failedPlayer.spacePhase).toBe("reentry");
    expect(failedPlayer.jetpackActive).toBe(false);
    expect(failedPlayer.velocity.y).toBeLessThanOrEqual(-12);
  });

  it("does not reactivate jetpack during failed reentry even on a fresh jump press", () => {
    const simulation = createTestSimulation("explore");
    const localPlayerId = simulation.getLocalPlayerId()!;
    const localPlayer = getInternalPlayer(simulation, localPlayerId);

    localPlayer.position = { x: 10.5, y: 55, z: 10.5 };
    localPlayer.velocity = { x: 0, y: -4, z: 0 };
    localPlayer.grounded = false;
    localPlayer.mass = simulation.config.maxMass;
    localPlayer.spacePhase = "reentry";
    localPlayer.spacePhaseRemaining = 0;
    localPlayer.spaceTriggerArmed = false;
    localPlayer.jetpackEligible = false;
    localPlayer.jetpackActive = false;

    simulation.step({
      [localPlayerId]: jump()
    });

    const unrecoveredPlayer = simulation.getPlayerRuntimeState(localPlayerId)!;
    expect(unrecoveredPlayer.spacePhase).toBe("reentry");
    expect(unrecoveredPlayer.jetpackActive).toBe(false);
    expect(unrecoveredPlayer.mass).toBe(simulation.config.maxMass);
    expect(unrecoveredPlayer.velocity.y).toBeLessThan(-4);
  });

  it("separates overlapping players during reset when spawns collide", () => {
    const map = createArenaDocument((world) => {
      for (const spawn of world.listSpawns()) {
        world.removeSpawn(spawn.id);
      }

      world.setSpawn(10.5, PLAYER_GROUND_Y, 10.5, "spawn-1");
      world.setSpawn(10.5, PLAYER_GROUND_Y, 10.5, "spawn-2");
      world.setSpawn(10.5, PLAYER_GROUND_Y, 10.5, "spawn-3");
    });

    const simulation = new OutOfBoundsSimulation();
    simulation.reset("playNpc", map, {
      npcCount: 2,
      localPlayerName: "You"
    });

    const players = simulation.getSnapshot().players;
    const minimumDistance = simulation.config.playerRadius * 2 - 0.01;

    for (let leftIndex = 0; leftIndex < players.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < players.length; rightIndex += 1) {
        expect(getHorizontalDistance(players[leftIndex]!, players[rightIndex]!)).toBeGreaterThanOrEqual(minimumDistance);
      }
    }
  });

  it("prevents overlap during normal movement and still allows sliding past another player", () => {
    const simulation = createTestSimulation("playNpc");
    const localPlayerId = simulation.getLocalPlayerId()!;
    const npcId = getNpcId(simulation)!;

    const localPlayer = getInternalPlayer(simulation, localPlayerId);
    const npcPlayer = getInternalPlayer(simulation, npcId);
    localPlayer.position = { x: 10.5, y: PLAYER_GROUND_Y, z: 10.5 };
    localPlayer.velocity = { x: 0, y: 0, z: 0 };
    localPlayer.facing = { x: 1, z: 0 };
    localPlayer.grounded = true;
    npcPlayer.position = { x: 11.1, y: PLAYER_GROUND_Y, z: 10.95 };
    npcPlayer.velocity = { x: 0, y: 0, z: 0 };
    npcPlayer.grounded = true;

    advanceSimulation(simulation, 12, {
      [localPlayerId]: move(1, 1)
    });

    const localAfter = simulation.getPlayerState(localPlayerId)!;
    const npcAfter = simulation.getPlayerState(npcId)!;

    expect(getHorizontalDistance(localAfter, npcAfter)).toBeGreaterThanOrEqual(simulation.config.playerRadius * 2 - 0.01);
    expect(Math.abs(localAfter.position.z - 10.5)).toBeGreaterThan(0.01);
    expect(localAfter.position.x).toBeLessThan(npcAfter.position.x);
  });

  it("eliminates players immediately when ring-outs hit the last feather", () => {
    const simulation = new OutOfBoundsSimulation({
      startingLives: 1,
      maxLives: 1
    });
    simulation.reset("playNpc", createArenaDocument(), {
      npcCount: 4,
      localPlayerName: "You"
    });
    const localPlayerId = simulation.getLocalPlayerId()!;
    const npcId = getNpcId(simulation)!;

    getInternalPlayer(simulation, npcId).position.y = simulation.getWorld().boundary.fallY - 1;
    simulation.step({});

    const afterFall = simulation.getSnapshot();
    expect(afterFall.players.find((player) => player.id === npcId)?.alive).toBe(false);
    expect(afterFall.players.find((player) => player.id === npcId)?.visible).toBe(false);
    expect(afterFall.ranking.at(-1)).toBe(npcId);

    getInternalPlayer(simulation, localPlayerId).position.x = -1;
    simulation.step({});
    expect(simulation.getPlayerViewState(localPlayerId)?.alive).toBe(false);
    expect(simulation.getPlayerViewState(localPlayerId)?.visible).toBe(false);
  });

  it("consumes one feather and respawns players on ring-out while lives remain", () => {
    const simulation = createTestSimulation();
    const localPlayerId = simulation.getLocalPlayerId()!;
    const localPlayer = getInternalPlayer(simulation, localPlayerId);

    localPlayer.position = {
      x: 10.5,
      y: simulation.getWorld().boundary.fallY - 1,
      z: 10.5
    };
    localPlayer.velocity = { x: 0, y: 0, z: 0 };

    simulation.step({});

    const ringedOut = simulation.getPlayerViewState(localPlayerId)!;
    expect(ringedOut.alive).toBe(true);
    expect(ringedOut.respawning).toBe(true);
    expect(ringedOut.visible).toBe(false);
    expect(ringedOut.livesRemaining).toBe(simulation.config.maxLives - 1);

    advanceSimulation(simulation, Math.ceil(simulation.config.respawnDelay * simulation.config.tickRate) + 2);

    const respawned = simulation.getPlayerViewState(localPlayerId)!;
    expect(respawned.alive).toBe(true);
    expect(respawned.respawning).toBe(false);
    expect(respawned.visible).toBe(true);
    expect(respawned.invulnerableRemaining).toBeGreaterThan(0);
  });

  it("respawns at a random valid spawn candidate instead of choosing the safest open slot", () => {
    const simulation = new OutOfBoundsSimulation();
    simulation.reset("playNpc", createArenaDocument(), {
      npcCount: 4,
      localPlayerName: "You",
      initialSpawnSeed: 5
    });

    const localPlayerId = simulation.getLocalPlayerId()!;
    const localPlayer = getInternalPlayer(simulation, localPlayerId);
    const internals = simulation as unknown as {
      respawnPlayer: (player: typeof localPlayer) => void;
      rngState: number;
      spawnCandidates: Array<{ x: number; y: number; z: number }>;
      canPlayerFitAt: (position: { x: number; y: number; z: number }) => boolean;
    };
    const validSpawnCandidates = internals.spawnCandidates.filter((spawn) => internals.canPlayerFitAt(spawn));
    expect(validSpawnCandidates.length).toBeGreaterThan(0);
    const firstRandom = ((Math.imul(0, 1664525) + 1013904223) >>> 0) / 0x100000000;
    const chosenSpawn =
      validSpawnCandidates[Math.floor(firstRandom * validSpawnCandidates.length)] ?? validSpawnCandidates[0]!;
    const npcIds = getNpcIds(simulation);

    npcIds.forEach((npcId, index) => {
      const npcPlayer = getInternalPlayer(simulation, npcId);
      npcPlayer.position =
        index === 0
          ? { ...chosenSpawn }
          : { x: 34.5 + index, y: PLAYER_GROUND_Y, z: 36.5 };
      npcPlayer.velocity = { x: 0, y: 0, z: 0 };
      npcPlayer.grounded = true;
    });

    internals.rngState = 0;
    internals.respawnPlayer(localPlayer);

    const respawned = simulation.getPlayerState(localPlayerId)!;
    expect(respawned.position.x).toBeCloseTo(chosenSpawn.x, 5);
    expect(respawned.position.z).toBeCloseTo(chosenSpawn.z, 5);
    expect(respawned.position.y - chosenSpawn.y).toBeCloseTo(simulation.config.skyDropSpawnHeight, 5);
    expect(respawned.velocity.y).toBeLessThan(0);
  });

  it("ignores hit damage during respawn invulnerability", () => {
    const simulation = new OutOfBoundsSimulation({
      skyDropIntervalMin: 999,
      skyDropIntervalMax: 999
    });
    simulation.reset("explore", createArenaDocument(), {
      localPlayerName: "You"
    });

    const localPlayerId = simulation.getLocalPlayerId()!;
    const localPlayer = getInternalPlayer(simulation, localPlayerId);
    localPlayer.position = {
      x: 10.5,
      y: simulation.getWorld().boundary.fallY - 1,
      z: 10.5
    };

    simulation.step({});
    advanceSimulation(simulation, Math.ceil(simulation.config.respawnDelay * simulation.config.tickRate) + 2);

    const respawned = simulation.getPlayerState(localPlayerId)!;
    expect(respawned.invulnerableRemaining).toBeGreaterThan(0);

    const skyDrops = (simulation as unknown as { skyDrops: Map<string, any> }).skyDrops;
    skyDrops.set("manual-sky", {
      id: "manual-sky",
      phase: "falling",
      warningRemaining: 0,
      landingVoxel: {
        x: Math.floor(respawned.position.x),
        y: Math.floor(respawned.position.y),
        z: Math.floor(respawned.position.z)
      },
      offsetY: 0.6,
      velocityY: 0,
      damagedPlayerIds: new Set<string>()
    });

    simulation.step({
      [localPlayerId]: idle()
    });

    expect(simulation.getPlayerState(localPlayerId)!.livesRemaining).toBe(respawned.livesRemaining);
  });

  it("lets active jetpack grace horizontal ring-out until thrust ends, then starts respawn", () => {
    const simulation = createTestSimulation();
    const localPlayerId = simulation.getLocalPlayerId()!;
    const localPlayer = getInternalPlayer(simulation, localPlayerId);

    localPlayer.position = { x: -0.2, y: PLAYER_GROUND_Y + 2.4, z: 10.5 };
    localPlayer.velocity = { x: -2.5, y: -1.5, z: 0 };
    localPlayer.facing = { x: -1, z: 0 };
    localPlayer.grounded = false;
    localPlayer.mass = 36;
    localPlayer.jetpackEligible = true;

    simulation.step({
      [localPlayerId]: jump()
    });

    const whileThrusting = simulation.getPlayerViewState(localPlayerId)!;
    expect(whileThrusting.alive).toBe(true);
    expect(whileThrusting.visible).toBe(true);
    expect(whileThrusting.jetpackActive).toBe(true);
    expect(whileThrusting.position.x).toBeLessThan(0);

    simulation.step({
      [localPlayerId]: idle({
        jumpReleased: true
      })
    });

    const afterRelease = simulation.getPlayerViewState(localPlayerId)!;
    expect(afterRelease.alive).toBe(true);
    expect(afterRelease.respawning).toBe(true);
    expect(afterRelease.visible).toBe(true);
    expect(afterRelease.jetpackActive).toBe(false);
    expect(afterRelease.livesRemaining).toBe(simulation.config.maxLives - 1);

    advanceSimulation(simulation, 120);
    expect(simulation.getPlayerViewState(localPlayerId)?.respawning).toBe(false);
    expect(simulation.getPlayerViewState(localPlayerId)?.visible).toBe(true);
  });

  it("still forces a respawn below fallY even if the jetpack is active", () => {
    const simulation = createTestSimulation();
    const localPlayerId = simulation.getLocalPlayerId()!;
    const localPlayer = getInternalPlayer(simulation, localPlayerId);

    localPlayer.position = {
      x: 10.5,
      y: simulation.getWorld().boundary.fallY - 1,
      z: 10.5
    };
    localPlayer.velocity = { x: 0, y: 0, z: 0 };
    localPlayer.grounded = false;
    localPlayer.mass = 36;
    localPlayer.jetpackEligible = true;
    localPlayer.jetpackActive = true;

    simulation.step({
      [localPlayerId]: idle({
        jump: true
      })
    });

    const afterFall = simulation.getPlayerViewState(localPlayerId)!;
    expect(afterFall.alive).toBe(true);
    expect(afterFall.respawning).toBe(true);
    expect(afterFall.visible).toBe(false);
    expect(afterFall.jetpackActive).toBe(false);
    expect(afterFall.livesRemaining).toBe(simulation.config.maxLives - 1);
  });

  it("produces deterministic snapshots for the same map and command stream", () => {
    const map = createArenaDocument((world) => {
      world.setVoxel(7, DEFAULT_SURFACE_Y, 6, "ground");
      world.setVoxel(8, DEFAULT_SURFACE_Y, 6, "boundary");
    });

    const commandStream = (playerId: string) => (frame: number): Record<string, PlayerCommand> => ({
      [playerId]:
        frame === 5
            ? jump()
            : frame === 15
            ? destroy({
                targetVoxel: { x: 7, y: DEFAULT_SURFACE_Y, z: 6 }
              })
              : frame === 40
                ? push()
                : move(0.6, 0.2)
    });

    const simulationA = new OutOfBoundsSimulation();
    simulationA.reset("playNpc", map, {
      npcCount: 2,
      localPlayerName: "You",
      initialSpawnSeed: 11
    });

    const simulationB = new OutOfBoundsSimulation();
    simulationB.reset("playNpc", map, {
      npcCount: 2,
      localPlayerName: "You",
      initialSpawnSeed: 11
    });

    const localPlayerId = simulationA.getLocalPlayerId()!;
    advanceSimulation(simulationA, 90, commandStream(localPlayerId));
    advanceSimulation(simulationB, 90, commandStream(localPlayerId));

    expect(normalizeSnapshot(simulationA.getSnapshot())).toEqual(normalizeSnapshot(simulationB.getSnapshot()));
  });

  it("covers npc command branches for centering, harvesting, edge pushing, and jumping", () => {
    const simulation = createTestSimulation("playNpc");
    const localPlayerId = simulation.getLocalPlayerId()!;
    const npcId = getNpcId(simulation)!;
    const otherNpcIds = getNpcIds(simulation).filter((candidateNpcId) => candidateNpcId !== npcId);
    const npcPlayer = getInternalPlayer(simulation, npcId);
    const localPlayer = getInternalPlayer(simulation, localPlayerId);
    const npcMemory = getNpcMemory(simulation, npcId);
    const generateNpcCommand = (simulation as unknown as { generateNpcCommand: (player: unknown) => PlayerCommand })
      .generateNpcCommand
      .bind(simulation);

    otherNpcIds.forEach((otherNpcId, index) => {
      const otherNpc = getInternalPlayer(simulation, otherNpcId);
      otherNpc.position = { x: 30 + index, y: PLAYER_GROUND_Y, z: 38 };
      otherNpc.grounded = true;
      otherNpc.mass = simulation.config.maxMass;
    });

    npcPlayer.position = { x: 1.2, y: PLAYER_GROUND_Y, z: 1.2 };
    npcPlayer.mass = simulation.config.maxMass;
    npcMemory.targetPlayerId = null;
    npcMemory.targetLockRemaining = 0;
    npcMemory.intentRemaining = 0;
    let command = generateNpcCommand(npcPlayer);
    expect(command.moveX).toBeGreaterThan(0);
    expect(command.moveZ).toBeGreaterThan(0);
    expect(command.push).toBe(false);

    npcPlayer.position = { x: 6.5, y: PLAYER_GROUND_Y, z: 6.5 };
    npcPlayer.facing = { x: 1, z: 0 };
    npcPlayer.mass = 10;
    npcMemory.targetPlayerId = null;
    npcMemory.targetLockRemaining = 0;
    npcMemory.intentRemaining = 0;
    command = generateNpcCommand(npcPlayer);
    expect(command.destroy).toBe(true);
    expect(command.targetVoxel).not.toBeNull();

    npcPlayer.position = { x: 42.5, y: PLAYER_GROUND_Y, z: 20.5 };
    npcPlayer.facing = { x: 1, z: 0 };
    npcPlayer.mass = simulation.config.maxMass;
    localPlayer.position = { x: 43.4, y: PLAYER_GROUND_Y, z: 20.5 };
    npcMemory.targetPlayerId = null;
    npcMemory.targetLockRemaining = 0;
    npcMemory.intentRemaining = 0;
    command = generateNpcCommand(npcPlayer);
    expect(command.push).toBe(true);

    npcPlayer.position = { x: 24.5, y: PLAYER_GROUND_Y, z: 24.5 };
    npcPlayer.grounded = true;
    localPlayer.position = { x: 26.5, y: PLAYER_GROUND_Y, z: 24.5 };
    simulation.getWorld().setVoxel(25, DEFAULT_SURFACE_Y, 24, "boundary");
    simulation.getWorld().removeVoxel(25, DEFAULT_SURFACE_Y + 1, 24);
    npcMemory.targetPlayerId = null;
    npcMemory.targetLockRemaining = 0;
    npcMemory.intentRemaining = 0;
    command = generateNpcCommand(npcPlayer);
    expect(command.jump).toBe(true);
  });

  it("splits npc aggro instead of sending the full flock at the human", () => {
    const simulation = createTestSimulation("playNpc");
    const localPlayerId = simulation.getLocalPlayerId()!;
    const npcIds = getNpcIds(simulation);
    const generateNpcCommand = (
      simulation as unknown as {
        generateNpcCommand: (player: unknown, dt?: number, targetCommitments?: Map<string, number>) => PlayerCommand;
      }
    ).generateNpcCommand.bind(simulation);
    const commitments = new Map<string, number>();

    const localPlayer = getInternalPlayer(simulation, localPlayerId);
    localPlayer.position = { x: 24.5, y: PLAYER_GROUND_Y, z: 24.5 };
    localPlayer.grounded = true;

    const edgeBait = getInternalPlayer(simulation, npcIds[0]!);
    edgeBait.position = { x: 46.1, y: PLAYER_GROUND_Y, z: 24.5 };
    edgeBait.grounded = true;
    edgeBait.stunRemaining = 1;

    npcIds.slice(1, 5).forEach((npcId, index) => {
      const npcPlayer = getInternalPlayer(simulation, npcId);
      npcPlayer.position = { x: 20.5 + index, y: PLAYER_GROUND_Y, z: 24.5 + (index % 2 === 0 ? 0 : 1.2) };
      npcPlayer.grounded = true;
      npcPlayer.mass = simulation.config.maxMass;
    });

    npcIds.slice(5).forEach((npcId, index) => {
      const npcPlayer = getInternalPlayer(simulation, npcId);
      npcPlayer.position = { x: 39.5 + index, y: PLAYER_GROUND_Y, z: 24.5 + (index % 2 === 0 ? 0 : 1.1) };
      npcPlayer.grounded = true;
      npcPlayer.mass = simulation.config.maxMass;
    });

    const chosenTargets = npcIds.map((npcId) => {
      const npcPlayer = getInternalPlayer(simulation, npcId);
      generateNpcCommand(npcPlayer, 1 / 60, commitments);
      const targetPlayerId = getNpcMemory(simulation, npcId).targetPlayerId;
      if (targetPlayerId) {
        commitments.set(targetPlayerId, (commitments.get(targetPlayerId) ?? 0) + 1);
      }
      return targetPlayerId;
    });

    const humanFocusCount = chosenTargets.filter((targetPlayerId) => targetPlayerId === localPlayerId).length;
    expect(humanFocusCount).toBeGreaterThan(0);
    expect(humanFocusCount).toBeLessThan(npcIds.length);
    expect(new Set(chosenTargets.filter((targetPlayerId): targetPlayerId is string => targetPlayerId !== null)).size).toBeGreaterThan(1);
  });

  it("builds short bridges when the path opens into a gap", () => {
    const simulation = createTestSimulation("playNpc");
    const npcId = getNpcId(simulation)!;
    const npcPlayer = getInternalPlayer(simulation, npcId);
    const localPlayer = getInternalPlayer(simulation, simulation.getLocalPlayerId()!);
    const generateNpcCommand = (simulation as unknown as { generateNpcCommand: (player: unknown) => PlayerCommand })
      .generateNpcCommand
      .bind(simulation);

    npcPlayer.position = { x: 10.5, y: PLAYER_GROUND_Y, z: 10.5 };
    npcPlayer.facing = { x: 1, z: 0 };
    npcPlayer.grounded = true;
    npcPlayer.mass = simulation.config.maxMass;
    localPlayer.position = { x: 16.5, y: PLAYER_GROUND_Y, z: 10.5 };
    simulation.getWorld().removeVoxel(11, SURFACE_TOP_Y, 10);

    const command = generateNpcCommand(npcPlayer);
    expect(command.place).toBe(true);
    expect(command.targetNormal).toEqual({ x: 1, y: 0, z: 0 });
  });

  it("prefers exposed elevated harvest blocks over ground surface", () => {
    const simulation = createTestSimulation("playNpc");
    const npcId = getNpcId(simulation)!;
    const npcPlayer = getInternalPlayer(simulation, npcId);
    const localPlayer = getInternalPlayer(simulation, simulation.getLocalPlayerId()!);
    const otherNpcIds = getNpcIds(simulation).filter((candidateNpcId) => candidateNpcId !== npcId);
    const generateNpcCommand = (simulation as unknown as { generateNpcCommand: (player: unknown) => PlayerCommand })
      .generateNpcCommand
      .bind(simulation);

    npcPlayer.position = { x: 10.5, y: PLAYER_GROUND_Y, z: 10.5 };
    npcPlayer.facing = { x: 1, z: 0 };
    npcPlayer.grounded = true;
    npcPlayer.mass = 6;
    localPlayer.position = { x: 34.5, y: PLAYER_GROUND_Y, z: 34.5 };
    localPlayer.grounded = true;
    otherNpcIds.forEach((otherNpcId, index) => {
      const otherNpc = getInternalPlayer(simulation, otherNpcId);
      otherNpc.position = { x: 30.5 + index, y: PLAYER_GROUND_Y, z: 39.5 };
      otherNpc.grounded = true;
    });
    simulation.getWorld().setVoxel(11, DEFAULT_SURFACE_Y, 10, "boundary");

    const command = generateNpcCommand(npcPlayer);
    expect(command.destroy).toBe(true);
    expect(command.targetVoxel).toEqual({ x: 11, y: DEFAULT_SURFACE_Y, z: 10 });
  });

  it("falls back to ground harvest when no elevated block is available", () => {
    const simulation = createTestSimulation("playNpc");
    const npcId = getNpcId(simulation)!;
    const npcPlayer = getInternalPlayer(simulation, npcId);
    const localPlayer = getInternalPlayer(simulation, simulation.getLocalPlayerId()!);
    const otherNpcIds = getNpcIds(simulation).filter((candidateNpcId) => candidateNpcId !== npcId);
    const generateNpcCommand = (simulation as unknown as { generateNpcCommand: (player: unknown) => PlayerCommand })
      .generateNpcCommand
      .bind(simulation);

    npcPlayer.position = { x: 10.5, y: PLAYER_GROUND_Y, z: 10.5 };
    npcPlayer.facing = { x: 1, z: 0 };
    npcPlayer.grounded = true;
    npcPlayer.mass = 6;
    localPlayer.position = { x: 34.5, y: PLAYER_GROUND_Y, z: 34.5 };
    localPlayer.grounded = true;
    otherNpcIds.forEach((otherNpcId, index) => {
      const otherNpc = getInternalPlayer(simulation, otherNpcId);
      otherNpc.position = { x: 30.5 + index, y: PLAYER_GROUND_Y, z: 39.5 };
      otherNpc.grounded = true;
    });

    const command = generateNpcCommand(npcPlayer);
    expect(command.destroy).toBe(true);
    expect(command.targetVoxel?.y).toBe(SURFACE_TOP_Y);
    expect(Math.abs((command.targetVoxel?.x ?? 0) - 10)).toBeLessThanOrEqual(1);
    expect(Math.abs((command.targetVoxel?.z ?? 0) - 10)).toBeLessThanOrEqual(1);
  });

  it("holds jump after takeoff when a gap needs jetpack follow-through", () => {
    const simulation = createTestSimulation("playNpc");
    const npcId = getNpcId(simulation)!;
    const localPlayer = getInternalPlayer(simulation, simulation.getLocalPlayerId()!);
    const npcPlayer = getInternalPlayer(simulation, npcId);
    const otherNpcIds = getNpcIds(simulation).filter((candidateNpcId) => candidateNpcId !== npcId);
    const generateNpcCommand = (simulation as unknown as { generateNpcCommand: (player: unknown) => PlayerCommand })
      .generateNpcCommand
      .bind(simulation);

    npcPlayer.position = { x: 24.5, y: PLAYER_GROUND_Y, z: 24.5 };
    npcPlayer.facing = { x: 1, z: 0 };
    npcPlayer.grounded = true;
    npcPlayer.mass = 12;
    localPlayer.position = { x: 32.5, y: PLAYER_GROUND_Y, z: 24.5 };
    otherNpcIds.forEach((otherNpcId, index) => {
      const otherNpc = getInternalPlayer(simulation, otherNpcId);
      otherNpc.position = { x: 10.5 + index, y: PLAYER_GROUND_Y, z: 37.5 };
      otherNpc.grounded = true;
    });
    simulation.getWorld().setVoxel(25, DEFAULT_SURFACE_Y, 24, "boundary");
    simulation.getWorld().removeVoxel(25, DEFAULT_SURFACE_Y + 1, 24);

    const takeoffCommand = generateNpcCommand(npcPlayer);
    expect(takeoffCommand.jumpPressed).toBe(true);
    expect(takeoffCommand.jump).toBe(true);

    npcPlayer.grounded = false;
    const followThroughCommand = generateNpcCommand(npcPlayer);
    expect(followThroughCommand.jump).toBe(true);
    expect(followThroughCommand.jumpPressed).toBe(false);
  });

  it("throws eggs at good mid-range targets", () => {
    const simulation = createTestSimulation("playNpc");
    const npcId = getNpcId(simulation)!;
    const npcPlayer = getInternalPlayer(simulation, npcId);
    const localPlayer = getInternalPlayer(simulation, simulation.getLocalPlayerId()!);
    const otherNpcIds = getNpcIds(simulation).filter((candidateNpcId) => candidateNpcId !== npcId);
    const generateNpcCommand = (simulation as unknown as { generateNpcCommand: (player: unknown) => PlayerCommand })
      .generateNpcCommand
      .bind(simulation);

    npcPlayer.position = { x: 10.5, y: PLAYER_GROUND_Y, z: 10.5 };
    npcPlayer.facing = { x: 1, z: 0 };
    npcPlayer.grounded = true;
    npcPlayer.mass = simulation.config.maxMass;
    localPlayer.position = { x: 17.5, y: PLAYER_GROUND_Y, z: 10.5 };
    localPlayer.grounded = true;
    otherNpcIds.forEach((otherNpcId, index) => {
      const otherNpc = getInternalPlayer(simulation, otherNpcId);
      otherNpc.position = { x: 34.5 + index, y: PLAYER_GROUND_Y, z: 36.5 };
      otherNpc.grounded = true;
    });

    const command = generateNpcCommand(npcPlayer);
    expect(command.layEgg).toBe(true);
    expect(command.eggCharge).toBeGreaterThan(0.35);
  });

  it("switches buried NPCs into recovery and climbs back up after clearing overhead terrain", () => {
    const simulation = createTestSimulation("playNpc");
    const npcId = getNpcId(simulation)!;
    const npcPlayer = getInternalPlayer(simulation, npcId);
    const npcMemory = getNpcMemory(simulation, npcId);
    const localPlayer = getInternalPlayer(simulation, simulation.getLocalPlayerId()!);
    const otherNpcIds = getNpcIds(simulation).filter((candidateNpcId) => candidateNpcId !== npcId);
    const generateNpcCommand = (simulation as unknown as { generateNpcCommand: (player: unknown) => PlayerCommand })
      .generateNpcCommand
      .bind(simulation);

    localPlayer.position = { x: 34.5, y: PLAYER_GROUND_Y, z: 34.5 };
    localPlayer.grounded = true;
    otherNpcIds.forEach((otherNpcId, index) => {
      const otherNpc = getInternalPlayer(simulation, otherNpcId);
      otherNpc.position = { x: 30.5 + index, y: PLAYER_GROUND_Y, z: 39.5 };
      otherNpc.grounded = true;
    });

    simulation.getWorld().removeVoxel(10, SURFACE_TOP_Y, 10);
    simulation.getWorld().setVoxel(10, DEFAULT_SURFACE_Y, 10, "boundary");
    npcPlayer.position = { x: 10.5, y: PLAYER_GROUND_Y - 1, z: 10.5 };
    npcPlayer.facing = { x: 1, z: 0 };
    npcPlayer.grounded = true;
    npcPlayer.mass = simulation.config.maxMass;

    const clearCommand = generateNpcCommand(npcPlayer);
    expect(clearCommand.destroy).toBe(true);
    expect(clearCommand.targetVoxel).toEqual({ x: 10, y: DEFAULT_SURFACE_Y, z: 10 });
    expect(npcMemory.targetLockRemaining).toBe(0);

    simulation.getWorld().removeVoxel(10, DEFAULT_SURFACE_Y, 10);
    const climbCommand = generateNpcCommand(npcPlayer);
    expect(climbCommand.jumpPressed).toBe(true);
    expect(climbCommand.jump).toBe(true);

    npcPlayer.grounded = false;
    const jetpackCommand = generateNpcCommand(npcPlayer);
    expect(jetpackCommand.jump).toBe(true);
    expect(jetpackCommand.jumpPressed).toBe(false);
  });
});
