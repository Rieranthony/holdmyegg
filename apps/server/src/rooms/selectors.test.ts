import { describe, expect, it } from "vitest";
import { createWarmPlaylistMaps } from "../lib/maps";
import {
  buildCountdownState,
  buildRoomSummary,
  getQueuedHumanCount
} from "./selectors";

const warmMap = createWarmPlaylistMaps()[0]!;

describe("room selectors", () => {
  it("counts queued humans from connected active members only", () => {
    expect(
      getQueuedHumanCount([
        {
          connected: true,
          joinMode: "active"
        },
        {
          connected: false,
          joinMode: "active"
        },
        {
          connected: true,
          joinMode: "spectator"
        }
      ])
    ).toBe(1);
  });

  it("builds countdown copy for waiting, countdown, and live phases", () => {
    expect(
      buildCountdownState({
        phase: "waiting",
        countdownEndsAt: null,
        nowMs: 100,
        activeHumans: 1
      })
    ).toMatchObject({
      active: false,
      reason: "Waiting for 1 more player."
    });

    expect(
      buildCountdownState({
        phase: "countdown",
        countdownEndsAt: 4_900,
        nowMs: 100,
        activeHumans: 2
      })
    ).toMatchObject({
      active: true,
      secondsRemaining: 5,
      reason: "Starting in 5s."
    });

    expect(
      buildCountdownState({
        phase: "live",
        countdownEndsAt: null,
        nowMs: 100,
        activeHumans: 4
      })
    ).toMatchObject({
      active: false,
      reason: "Round live, next join enters as spectator."
    });
  });

  it("builds room summaries with joinability, counts, and status text", () => {
    const summary = buildRoomSummary({
      config: {
        id: "warm-1",
        name: "Warm Room 1",
        region: "us",
        capacity: 4,
        warm: true
      },
      currentMap: warmMap,
      phase: "waiting",
      countdownEndsAt: null,
      nowMs: 100,
      members: [
        {
          connected: true,
          joinMode: "active",
          presence: "waiting"
        },
        {
          connected: true,
          joinMode: "active",
          presence: "alive"
        },
        {
          connected: true,
          joinMode: "spectator",
          presence: "mid_round_spectating"
        }
      ]
    });

    expect(summary).toMatchObject({
      id: "warm-1",
      humans: 2,
      spectators: 1,
      connected: 3,
      joinable: true,
      statusText: "Waiting for countdown."
    });
  });
});
