import type { RuntimePlayerState } from "@out-of-bounds/sim";

export interface TimeoutRankingEntry {
  roomPlayerId: string;
  joinMode: "active" | "waiting" | "spectator";
  joinedAtMs: number;
  kills: number;
  damageDealt: number;
}

export const buildTimeoutRanking = (
  players: RuntimePlayerState[],
  stats: Iterable<TimeoutRankingEntry>
) => {
  const byId = new Map(players.map((player) => [player.id, player]));
  return [...stats]
    .filter((entry) => entry.joinMode !== "spectator")
    .sort((left, right) => {
      const leftPlayer = byId.get(left.roomPlayerId);
      const rightPlayer = byId.get(right.roomPlayerId);
      const leftAlive = leftPlayer?.alive ?? false;
      const rightAlive = rightPlayer?.alive ?? false;
      if (leftAlive !== rightAlive) {
        return leftAlive ? -1 : 1;
      }

      const leftLives = leftPlayer?.livesRemaining ?? 0;
      const rightLives = rightPlayer?.livesRemaining ?? 0;
      if (leftLives !== rightLives) {
        return rightLives - leftLives;
      }

      if (left.kills !== right.kills) {
        return right.kills - left.kills;
      }

      if (left.damageDealt !== right.damageDealt) {
        return right.damageDealt - left.damageDealt;
      }

      return left.joinedAtMs - right.joinedAtMs;
    })
    .map((entry) => entry.roomPlayerId);
};
