import { describe, expect, it } from "vitest";
import type { RuntimePlayerState } from "@out-of-bounds/sim";
import { buildTimeoutRanking } from "./ranking";

const createPlayer = (
  id: string,
  overrides: Partial<RuntimePlayerState> = {}
): RuntimePlayerState => ({
  id,
  name: id,
  kind: "human",
  alive: true,
  fallingOut: false,
  grounded: true,
  mass: 20,
  livesRemaining: 3,
  maxLives: 3,
  respawning: false,
  invulnerableRemaining: 0,
  stunRemaining: 0,
  pushVisualRemaining: 0,
  spacePhase: "none",
  spacePhaseRemaining: 0,
  position: { x: 0, y: 0, z: 0 },
  velocity: { x: 0, y: 0, z: 0 },
  facing: { x: 1, z: 0 },
  eggTauntSequence: 0,
  eggTauntRemaining: 0,
  jetpackActive: false,
  eliminatedAt: null,
  ...overrides
});

describe("buildTimeoutRanking", () => {
  it("ranks alive players first, then lives, kills, damage, and join order", () => {
    const ranking = buildTimeoutRanking(
      [
        createPlayer("alpha", {
          alive: true,
          livesRemaining: 2
        }),
        createPlayer("bravo", {
          alive: true,
          livesRemaining: 3
        }),
        createPlayer("charlie", {
          alive: false,
          livesRemaining: 3
        })
      ],
      [
        {
          roomPlayerId: "alpha",
          joinMode: "active",
          joinedAtMs: 10,
          kills: 5,
          damageDealt: 100
        },
        {
          roomPlayerId: "bravo",
          joinMode: "active",
          joinedAtMs: 20,
          kills: 1,
          damageDealt: 10
        },
        {
          roomPlayerId: "charlie",
          joinMode: "active",
          joinedAtMs: 0,
          kills: 10,
          damageDealt: 300
        },
        {
          roomPlayerId: "spectator",
          joinMode: "spectator",
          joinedAtMs: 5,
          kills: 99,
          damageDealt: 999
        }
      ]
    );

    expect(ranking).toEqual(["bravo", "alpha", "charlie"]);
  });
});
