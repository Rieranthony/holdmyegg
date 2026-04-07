import { MutableVoxelWorld } from "@out-of-bounds/map";
import { OutOfBoundsSimulation, type GameMode, type PlayerCommand } from "@out-of-bounds/sim";
import { createArenaDocument } from "../fixtures/maps";

export const createTestWorld = (mutate?: (world: MutableVoxelWorld) => void) => {
  const world = new MutableVoxelWorld(createArenaDocument());
  mutate?.(world);
  return world;
};

export const createTestSimulation = (
  mode: GameMode = "explore",
  mutate?: (world: MutableVoxelWorld) => void
) => {
  const world = createTestWorld(mutate);
  const simulation = new OutOfBoundsSimulation();
  simulation.reset(mode, world.toDocument(), {
    npcCount: mode === "playNpc" ? 9 : 0,
    localPlayerName: "You",
    initialSpawnSeed: mode === "playNpc" ? 1 : undefined
  });
  return simulation;
};

export const advanceSimulation = (
  simulation: OutOfBoundsSimulation,
  frameCount: number,
  commands:
    | Record<string, PlayerCommand>
    | ((frame: number) => Record<string, PlayerCommand>) = {}
) => {
  for (let frame = 0; frame < frameCount; frame += 1) {
    simulation.step(typeof commands === "function" ? commands(frame) : commands);
  }
};

export const advanceUntilGrounded = (
  simulation: OutOfBoundsSimulation,
  playerId: string,
  maxFrames = 240
) => {
  for (let frame = 0; frame < maxFrames; frame += 1) {
    simulation.step({});
    const player = simulation.getPlayerViewState(playerId);
    if (player?.grounded) {
      return player;
    }
  }

  return simulation.getPlayerViewState(playerId);
};
