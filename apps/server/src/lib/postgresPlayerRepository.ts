import { desc, eq, sql } from "drizzle-orm";
import type { DatabaseClient } from "@out-of-bounds/db";
import {
  matchParticipants,
  matches,
  playerLifetimeStats,
  playerProfiles,
  touchUpdatedAt
} from "@out-of-bounds/db";
import type { MatchSummary } from "@out-of-bounds/netcode";
import type {
  CompletedMatchRecord,
  PlayerRepository
} from "./playerRepository";
import { emptyStats, toProfileSummary } from "./playerRepository";

export class PostgresPlayerRepository implements PlayerRepository {
  constructor(private readonly database: DatabaseClient["db"]) {}

  async ensureProfile(userId: string, fallbackName: string) {
    await this.database
      .insert(playerProfiles)
      .values({
        userId,
        displayName: fallbackName
      })
      .onConflictDoNothing();

    await this.database
      .insert(playerLifetimeStats)
      .values({
        userId
      })
      .onConflictDoNothing();

    const [profile] = await this.database
      .select()
      .from(playerProfiles)
      .where(eq(playerProfiles.userId, userId))
      .limit(1);

    return toProfileSummary(
      userId,
      profile?.displayName ?? fallbackName,
      profile?.customAvatarUrl ?? null
    );
  }

  async updateDisplayName(userId: string, displayName: string) {
    const profile = await this.ensureProfile(userId, displayName);
    await this.database
      .insert(playerProfiles)
      .values({
        userId,
        displayName
      })
      .onConflictDoUpdate({
        target: playerProfiles.userId,
        set: {
          displayName,
          updatedAt: sql`${touchUpdatedAt}`
        }
      });

    return {
      ...profile,
      displayName
    };
  }

  async getProfile(userId: string) {
    const [row] = await this.database
      .select({
        displayName: playerProfiles.displayName,
        customAvatarUrl: playerProfiles.customAvatarUrl,
        totalMatches: playerLifetimeStats.totalMatches,
        totalWins: playerLifetimeStats.totalWins,
        totalKills: playerLifetimeStats.totalKills,
        totalDeaths: playerLifetimeStats.totalDeaths,
        totalDamageDealt: playerLifetimeStats.totalDamageDealt,
        totalDamageTaken: playerLifetimeStats.totalDamageTaken,
        totalRingOuts: playerLifetimeStats.totalRingOuts,
        totalSurvivalMs: playerLifetimeStats.totalSurvivalMs
      })
      .from(playerProfiles)
      .leftJoin(playerLifetimeStats, eq(playerLifetimeStats.userId, playerProfiles.userId))
      .where(eq(playerProfiles.userId, userId))
      .limit(1);

    if (!row) {
      return null;
    }

    const recentMatches = await this.database
      .select({
        id: matches.id,
        roomId: matches.roomId,
        mapName: matches.mapName,
        phaseOutcome: matches.phaseOutcome,
        startedAt: matches.startedAt,
        endedAt: matches.endedAt,
        winnerUserId: matches.winnerUserId
      })
      .from(matchParticipants)
      .innerJoin(matches, eq(matches.id, matchParticipants.matchId))
      .where(eq(matchParticipants.userId, userId))
      .orderBy(desc(matches.startedAt))
      .limit(10);

    return {
      profile: toProfileSummary(userId, row.displayName, row.customAvatarUrl ?? null),
      stats: {
        ...emptyStats(),
        totalMatches: row.totalMatches ?? 0,
        totalWins: row.totalWins ?? 0,
        totalKills: row.totalKills ?? 0,
        totalDeaths: row.totalDeaths ?? 0,
        totalDamageDealt: row.totalDamageDealt ?? 0,
        totalDamageTaken: row.totalDamageTaken ?? 0,
        totalRingOuts: row.totalRingOuts ?? 0,
        totalSurvivalMs: row.totalSurvivalMs ?? 0
      },
      recentMatches: recentMatches.map(
        (match): MatchSummary => ({
          id: match.id,
          roomId: match.roomId,
          mapName: match.mapName,
          phaseOutcome: match.phaseOutcome,
          startedAt: match.startedAt.toISOString(),
          endedAt: match.endedAt.toISOString(),
          winnerUserId: match.winnerUserId
        })
      )
    };
  }

  async recordCompletedMatch(record: CompletedMatchRecord) {
    await this.database.transaction(async (tx) => {
      await tx.insert(matches).values({
        id: record.id,
        roomId: record.roomId,
        mapId: record.mapId,
        mapName: record.mapName,
        region: record.region,
        phaseOutcome: record.phaseOutcome,
        startedAt: new Date(record.startedAt),
        endedAt: new Date(record.endedAt),
        winnerUserId: record.winnerUserId,
        summaryJson: record.summaryJson
      });

      if (record.participants.length > 0) {
        await tx.insert(matchParticipants).values(
          record.participants.map((participant) => ({
            id: `${record.id}:${participant.userId}`,
            matchId: record.id,
            userId: participant.userId,
            roomPlayerId: participant.roomPlayerId,
            displayName: participant.displayName,
            placement: participant.placement,
            won: participant.won,
            joinMode: participant.joinMode,
            kills: participant.kills,
            deaths: participant.deaths,
            damageDealt: participant.damageDealt,
            damageTaken: participant.damageTaken,
            ringOuts: participant.ringOuts,
            survivalMs: participant.survivalMs
          }))
        );
      }

      for (const participant of record.participants) {
        await tx
          .insert(playerLifetimeStats)
          .values({
            userId: participant.userId,
            totalMatches: 1,
            totalWins: participant.won ? 1 : 0,
            totalKills: participant.kills,
            totalDeaths: participant.deaths,
            totalDamageDealt: participant.damageDealt,
            totalDamageTaken: participant.damageTaken,
            totalRingOuts: participant.ringOuts,
            totalSurvivalMs: participant.survivalMs
          })
          .onConflictDoUpdate({
            target: playerLifetimeStats.userId,
            set: {
              totalMatches: sql`${playerLifetimeStats.totalMatches} + ${participant.joinMode === "spectator" ? 0 : 1}`,
              totalWins: sql`${playerLifetimeStats.totalWins} + ${participant.won ? 1 : 0}`,
              totalKills: sql`${playerLifetimeStats.totalKills} + ${participant.kills}`,
              totalDeaths: sql`${playerLifetimeStats.totalDeaths} + ${participant.deaths}`,
              totalDamageDealt: sql`${playerLifetimeStats.totalDamageDealt} + ${participant.damageDealt}`,
              totalDamageTaken: sql`${playerLifetimeStats.totalDamageTaken} + ${participant.damageTaken}`,
              totalRingOuts: sql`${playerLifetimeStats.totalRingOuts} + ${participant.ringOuts}`,
              totalSurvivalMs: sql`${playerLifetimeStats.totalSurvivalMs} + ${participant.survivalMs}`,
              updatedAt: sql`${touchUpdatedAt}`
            }
          });
      }
    });
  }
}
