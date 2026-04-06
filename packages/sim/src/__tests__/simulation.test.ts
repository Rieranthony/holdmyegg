import { describe, expect, it, vi } from "vitest";
import { defaultSimulationConfig, type PlayerCommand, OutOfBoundsSimulation } from "@out-of-bounds/sim";
import { DEFAULT_SURFACE_Y } from "@out-of-bounds/map";
import { createArenaDocument } from "@test/fixtures/maps";
import { destroy, idle, jump, layEgg, move, place, push } from "@test/helpers/commands";
import { advanceSimulation, advanceUntilGrounded, createTestSimulation } from "@test/helpers/simulation";
import { normalizeSnapshot } from "@test/helpers/snapshot";

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
    pushCooldownRemaining: number;
  });

const getNpcId = (simulation: OutOfBoundsSimulation) =>
  simulation.getSnapshot().players.find((player) => player.kind === "npc")?.id ?? null;

const getHorizontalDistance = (
  left: { position: { x: number; z: number } },
  right: { position: { x: number; z: number } }
) => Math.hypot(left.position.x - right.position.x, left.position.z - right.position.z);

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

describe("OutOfBoundsSimulation", () => {
  it("resets into predictable snapshots and spawns players", () => {
    const simulation = createTestSimulation("skirmish");
    const snapshot = simulation.getSnapshot();
    const localPlayerId = simulation.getLocalPlayerId();

    expect(snapshot.mode).toBe("skirmish");
    expect(localPlayerId).toBe("human-1");
    expect(snapshot.players.length).toBe(5);
    expect(snapshot.localPlayerId).toBe(localPlayerId);
    advanceSimulation(simulation, 30);
    expect(simulation.getPlayerState(localPlayerId!)?.alive).toBe(true);
  });

  it("exposes lightweight match, hud, and player selectors", () => {
    const simulation = createTestSimulation("skirmish");
    const localPlayerId = simulation.getLocalPlayerId()!;
    advanceUntilGrounded(simulation, localPlayerId);

    const matchState = simulation.getMatchState();
    const hudState = simulation.getHudState();
    const playerState = simulation.getPlayerState(localPlayerId);

    expect(matchState.playerIds).toContain(localPlayerId);
    expect(matchState.players.some((player) => player.kind === "npc")).toBe(true);
    expect("map" in matchState).toBe(false);
    expect(hudState.localPlayer?.id).toBe(localPlayerId);
    expect(hudState.ranking.length).toBe(matchState.ranking.length);
    expect(playerState?.id).toBe(localPlayerId);
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
    const simulation = createTestSimulation("skirmish");
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

  it("requires a fresh airborne press to activate the jetpack and still gates jumping on mass", () => {
    const simulation = createTestSimulation();
    const localPlayerId = simulation.getLocalPlayerId()!;
    advanceUntilGrounded(simulation, localPlayerId);

    const beforeJump = simulation.getPlayerViewState(localPlayerId)!;
    simulation.step({
      [localPlayerId]: jump()
    });
    const afterFirstJump = simulation.getPlayerViewState(localPlayerId)!;
    simulation.step({
      [localPlayerId]: idle({
        jump: true
      })
    });
    const afterHeldSpace = simulation.getPlayerViewState(localPlayerId)!;

    expect(afterFirstJump.mass).toBe(beforeJump.mass - simulation.config.jumpCost);
    expect(afterFirstJump.jetpackActive).toBe(false);
    expect(afterHeldSpace.mass).toBe(afterFirstJump.mass);
    expect(afterHeldSpace.jetpackActive).toBe(false);
    expect(afterHeldSpace.velocity.y).toBeLessThan(afterFirstJump.velocity.y);

    const internalPlayer = getInternalPlayer(simulation, localPlayerId);
    internalPlayer.grounded = true;
    internalPlayer.jetpackEligible = false;
    internalPlayer.mass = simulation.config.jumpCost - 1;
    internalPlayer.velocity.y = 0;
    simulation.step({
      [localPlayerId]: jump()
    });

    const blockedJump = simulation.getPlayerViewState(localPlayerId)!;
    expect(blockedJump.mass).toBe(simulation.config.jumpCost - 1);
    expect(blockedJump.velocity.y).toBeLessThanOrEqual(0);
  });

  it("activates the jetpack on a second airborne press, sustains while held, and stops on release", () => {
    const simulation = createTestSimulation();
    const localPlayerId = simulation.getLocalPlayerId()!;
    advanceUntilGrounded(simulation, localPlayerId);

    simulation.step({
      [localPlayerId]: jump()
    });
    simulation.step({
      [localPlayerId]: idle({
        jump: true
      })
    });
    const beforeSecondPress = simulation.getPlayerViewState(localPlayerId)!;

    simulation.step({
      [localPlayerId]: idle()
    });
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

  it("requires harvesting before building and spends mass on successful placement", () => {
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

    expect(simulation.getWorld().getVoxelKind(8, DEFAULT_SURFACE_Y, 6)).toBeUndefined();
    expect(simulation.getPlayerState(localPlayerId)!.mass).toBe(simulation.config.startingMass);

    simulation.step({
      [localPlayerId]: destroy({
        targetVoxel: { x: 7, y: DEFAULT_SURFACE_Y, z: 6 }
      })
    });
    expect(simulation.getPlayerState(localPlayerId)!.mass).toBe(
      simulation.config.startingMass + simulation.config.destroyGain
    );

    simulation.step({
      [localPlayerId]: place(
        { x: 8, y: SURFACE_TOP_Y, z: 6 },
        { x: 0, y: 1, z: 0 }
      )
    });

    expect(simulation.getWorld().getVoxelKind(8, DEFAULT_SURFACE_Y, 6)).toBe("ground");
    expect(simulation.getPlayerState(localPlayerId)!.mass).toBe(
      simulation.config.startingMass + simulation.config.destroyGain - simulation.config.placeCost
    );
  });

  it("treats tree props as solid build blockers without letting players harvest them", () => {
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

    expect(simulation.getPlayerState(localPlayerId)!.mass).toBe(simulation.config.startingMass);
    expect(simulation.getWorld().getPropAtVoxel(8, DEFAULT_SURFACE_Y, 6)?.kind).toBe("tree-oak");

    localPlayer.mass = simulation.config.maxMass;
    simulation.step({
      [localPlayerId]: place(
        { x: 8, y: SURFACE_TOP_Y, z: 6 },
        { x: 0, y: 1, z: 0 }
      )
    });

    expect(simulation.getWorld().getVoxelKind(8, DEFAULT_SURFACE_Y, 6)).toBeUndefined();
    expect(simulation.getPlayerState(localPlayerId)!.mass).toBe(simulation.config.maxMass);
  });

  it("rejects placement inside player bodies and active falling debris", () => {
    const simulation = createTestSimulation("skirmish");
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

    advanceSimulation(simulation, 20, {
      [localPlayerId]: idle()
    });

    expect(simulation.getEggs()).toEqual([]);
    expect(simulation.getWorld().getTerrainRevision()).toBeGreaterThan(terrainBefore);
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
  });

  it("keeps unrelated egg defaults intact when overriding one tuning field", () => {
    const simulation = new OutOfBoundsSimulation({
      eggCost: 11
    });

    expect(simulation.config.eggCost).toBe(11);
    expect(simulation.config.eggFuseDuration).toBe(defaultSimulationConfig.eggFuseDuration);
    expect(simulation.config.maxActiveEggsPerPlayer).toBe(defaultSimulationConfig.maxActiveEggsPerPlayer);
    expect(simulation.config.startingLives).toBe(defaultSimulationConfig.startingLives);
  });

  it("pushes valid targets and respects cooldown", () => {
    const simulation = createTestSimulation("skirmish");
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
    expect(simulation.getPlayerViewState(npcId)!.velocity.x).toBeGreaterThan(0);
    expect(afterFirstPush.mass).toBe(simulation.config.maxMass - simulation.config.pushCost);

    simulation.step({
      [localPlayerId]: push()
    });

    const afterCooldownAttempt = simulation.getPlayerViewState(localPlayerId)!;
    expect(afterCooldownAttempt.mass).toBe(afterFirstPush.mass);
  });

  it("scales push impulse upward with current mass", () => {
    const createPushSimulation = (mass: number) => {
      const simulation = createTestSimulation("skirmish");
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
    const simulation = createTestSimulation("skirmish");
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

    npcPlayer.position = { x: 9.7, y: PLAYER_GROUND_Y, z: 10.5 };
    simulation.step({
      [localPlayerId]: push()
    });
    expect(simulation.getPlayerViewState(localPlayerId)!.mass).toBe(simulation.config.maxMass);
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
    simulation.reset("skirmish", map, {
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
    const simulation = createTestSimulation("skirmish");
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
    simulation.reset("skirmish", createArenaDocument(), {
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
    simulationA.reset("skirmish", map, {
      npcCount: 2,
      localPlayerName: "You"
    });

    const simulationB = new OutOfBoundsSimulation();
    simulationB.reset("skirmish", map, {
      npcCount: 2,
      localPlayerName: "You"
    });

    const localPlayerId = simulationA.getLocalPlayerId()!;
    advanceSimulation(simulationA, 90, commandStream(localPlayerId));
    advanceSimulation(simulationB, 90, commandStream(localPlayerId));

    expect(normalizeSnapshot(simulationA.getSnapshot())).toEqual(normalizeSnapshot(simulationB.getSnapshot()));
  });

  it("covers npc command branches for centering, harvesting, pushing, and jumping", () => {
    const simulation = createTestSimulation("skirmish");
    const localPlayerId = simulation.getLocalPlayerId()!;
    const npcId = getNpcId(simulation)!;
    const npcPlayer = getInternalPlayer(simulation, npcId);
    const localPlayer = getInternalPlayer(simulation, localPlayerId);
    const generateNpcCommand = (simulation as unknown as { generateNpcCommand: (player: unknown) => PlayerCommand })
      .generateNpcCommand
      .bind(simulation);

    npcPlayer.position = { x: 1.2, y: PLAYER_GROUND_Y, z: 1.2 };
    npcPlayer.mass = simulation.config.maxMass;
    let command = generateNpcCommand(npcPlayer);
    expect(command.moveX).toBeGreaterThan(0);
    expect(command.moveZ).toBeGreaterThan(0);
    expect(command.push).toBe(false);

    npcPlayer.position = { x: 6.5, y: PLAYER_GROUND_Y, z: 6.5 };
    npcPlayer.facing = { x: 1, z: 0 };
    npcPlayer.mass = 10;
    command = generateNpcCommand(npcPlayer);
    expect(command.destroy).toBe(true);
    expect(command.targetVoxel).not.toBeNull();

    npcPlayer.position = { x: 20.5, y: PLAYER_GROUND_Y, z: 20.5 };
    npcPlayer.mass = simulation.config.maxMass;
    localPlayer.position = { x: 21.2, y: PLAYER_GROUND_Y, z: 20.5 };
    command = generateNpcCommand(npcPlayer);
    expect(command.push).toBe(true);

    npcPlayer.position = { x: 24.5, y: PLAYER_GROUND_Y, z: 24.5 };
    npcPlayer.grounded = true;
    localPlayer.position = { x: 26.5, y: PLAYER_GROUND_Y, z: 24.5 };
    simulation.getWorld().setVoxel(25, DEFAULT_SURFACE_Y, 24, "boundary");
    simulation.getWorld().removeVoxel(25, DEFAULT_SURFACE_Y + 1, 24);
    command = generateNpcCommand(npcPlayer);
    expect(command.jump).toBe(true);
  });
});
