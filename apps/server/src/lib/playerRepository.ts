import type {
  MatchSummary,
  PlayerProfileResponse,
  PlayerProfileSummary,
  ProfileStatsSummary
} from "@out-of-bounds/netcode";
import { getFacehashSeed } from "./avatar";

export interface MatchParticipantRecord {
  userId: string;
  roomPlayerId: string;
  displayName: string;
  placement: number | null;
  won: boolean;
  joinMode: "active" | "waiting" | "spectator";
  kills: number;
  deaths: number;
  damageDealt: number;
  damageTaken: number;
  ringOuts: number;
  survivalMs: number;
}

export interface CompletedMatchRecord {
  id: string;
  roomId: string;
  mapId: string;
  mapName: string;
  region: string;
  phaseOutcome: "winner" | "timeout" | "abandoned";
  startedAt: string;
  endedAt: string;
  winnerUserId: string | null;
  summaryJson: string;
  participants: MatchParticipantRecord[];
}

export interface PlayerRepository {
  getProfile(userId: string): Promise<PlayerProfileResponse | null>;
  ensureProfile(userId: string, fallbackName: string): Promise<PlayerProfileSummary>;
  updateDisplayName(userId: string, displayName: string): Promise<PlayerProfileSummary>;
  recordCompletedMatch(record: CompletedMatchRecord): Promise<void>;
}

export const emptyStats = (): ProfileStatsSummary => ({
  totalMatches: 0,
  totalWins: 0,
  totalKills: 0,
  totalDeaths: 0,
  totalDamageDealt: 0,
  totalDamageTaken: 0,
  totalRingOuts: 0,
  totalSurvivalMs: 0
});

export const toProfileSummary = (
  userId: string,
  displayName: string,
  customAvatarUrl: string | null
): PlayerProfileSummary => ({
  userId,
  displayName,
  avatarSeed: getFacehashSeed(userId),
  avatarUrl: customAvatarUrl
});

export class MemoryPlayerRepository implements PlayerRepository {
  readonly profiles = new Map<string, PlayerProfileSummary>();
  readonly stats = new Map<string, ProfileStatsSummary>();
  readonly matches: CompletedMatchRecord[] = [];

  async ensureProfile(userId: string, fallbackName: string) {
    const existing = this.profiles.get(userId);
    if (existing) {
      return existing;
    }

    const profile = toProfileSummary(userId, fallbackName, null);
    this.profiles.set(userId, profile);
    this.stats.set(userId, emptyStats());
    return profile;
  }

  async updateDisplayName(userId: string, displayName: string) {
    const profile = await this.ensureProfile(userId, displayName);
    const updated = {
      ...profile,
      displayName
    };
    this.profiles.set(userId, updated);
    return updated;
  }

  async getProfile(userId: string) {
    const profile = this.profiles.get(userId);
    if (!profile) {
      return null;
    }

    return {
      profile,
      stats: this.stats.get(userId) ?? emptyStats(),
      recentMatches: this.matches
        .filter((match) => match.participants.some((participant) => participant.userId === userId))
        .slice(-10)
        .reverse()
        .map(
          (match): MatchSummary => ({
            id: match.id,
            roomId: match.roomId,
            mapName: match.mapName,
            phaseOutcome: match.phaseOutcome,
            startedAt: match.startedAt,
            endedAt: match.endedAt,
            winnerUserId: match.winnerUserId
          })
        )
    };
  }

  async recordCompletedMatch(record: CompletedMatchRecord) {
    this.matches.push(record);
    for (const participant of record.participants) {
      const current = this.stats.get(participant.userId) ?? emptyStats();
      this.stats.set(participant.userId, {
        totalMatches: current.totalMatches + (participant.joinMode === "spectator" ? 0 : 1),
        totalWins: current.totalWins + (participant.won ? 1 : 0),
        totalKills: current.totalKills + participant.kills,
        totalDeaths: current.totalDeaths + participant.deaths,
        totalDamageDealt: current.totalDamageDealt + participant.damageDealt,
        totalDamageTaken: current.totalDamageTaken + participant.damageTaken,
        totalRingOuts: current.totalRingOuts + participant.ringOuts,
        totalSurvivalMs: current.totalSurvivalMs + participant.survivalMs
      });
    }
  }
}
