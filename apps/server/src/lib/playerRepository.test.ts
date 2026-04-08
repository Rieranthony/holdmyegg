import { describe, expect, it } from "vitest";
import { MemoryPlayerRepository } from "./playerRepository";

describe("MemoryPlayerRepository", () => {
  it("creates and updates player profiles", async () => {
    const repository = new MemoryPlayerRepository();

    const created = await repository.ensureProfile("user-1", "Anthony");
    const updated = await repository.updateDisplayName("user-1", "Riera");

    expect(created).toMatchObject({
      userId: "user-1",
      displayName: "Anthony",
      avatarUrl: null
    });
    expect(updated.displayName).toBe("Riera");
    expect((await repository.getProfile("user-1"))?.profile.displayName).toBe("Riera");
  });

  it("records completed matches and accumulates lifetime stats", async () => {
    const repository = new MemoryPlayerRepository();
    await repository.ensureProfile("winner", "Winner");
    await repository.ensureProfile("spectator", "Spectator");

    await repository.recordCompletedMatch({
      id: "match-1",
      roomId: "warm-1",
      mapId: "map-1",
      mapName: "Arena",
      region: "us",
      phaseOutcome: "timeout",
      startedAt: "2026-04-08T00:00:00.000Z",
      endedAt: "2026-04-08T00:05:00.000Z",
      winnerUserId: "winner",
      summaryJson: "{}",
      participants: [
        {
          userId: "winner",
          roomPlayerId: "winner",
          displayName: "Winner",
          placement: 1,
          won: true,
          joinMode: "active",
          kills: 3,
          deaths: 0,
          damageDealt: 12,
          damageTaken: 2,
          ringOuts: 1,
          survivalMs: 300_000
        },
        {
          userId: "spectator",
          roomPlayerId: "spectator",
          displayName: "Spectator",
          placement: null,
          won: false,
          joinMode: "spectator",
          kills: 0,
          deaths: 0,
          damageDealt: 0,
          damageTaken: 0,
          ringOuts: 0,
          survivalMs: 0
        }
      ]
    });

    expect(repository.matches).toHaveLength(1);
    expect((await repository.getProfile("winner"))?.stats).toMatchObject({
      totalMatches: 1,
      totalWins: 1,
      totalKills: 3,
      totalDamageDealt: 12
    });
    expect((await repository.getProfile("spectator"))?.stats.totalMatches).toBe(0);
    expect((await repository.getProfile("winner"))?.recentMatches[0]).toMatchObject({
      id: "match-1",
      winnerUserId: "winner"
    });
  });
});
