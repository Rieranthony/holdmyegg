import {
  bigint,
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
};

export const avatarModeEnum = pgEnum("avatar_mode", ["facehash", "custom"]);
export const matchOutcomeEnum = pgEnum("match_outcome", ["winner", "timeout", "abandoned"]);
export const participantJoinModeEnum = pgEnum("participant_join_mode", ["active", "waiting", "spectator"]);

export const users = pgTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    isAnonymous: boolean("is_anonymous").notNull().default(false),
    ...timestamps
  },
  (table) => ({
    emailKey: uniqueIndex("user_email_key").on(table.email)
  })
);

export const sessions = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    ...timestamps
  },
  (table) => ({
    tokenKey: uniqueIndex("session_token_key").on(table.token),
    userIdIdx: index("session_user_id_idx").on(table.userId)
  })
);

export const accounts = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    idToken: text("id_token"),
    password: text("password"),
    ...timestamps
  },
  (table) => ({
    providerAccountKey: uniqueIndex("account_provider_account_key").on(
      table.providerId,
      table.accountId
    ),
    userIdIdx: index("account_user_id_idx").on(table.userId)
  })
);

export const verifications = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...timestamps
  },
  (table) => ({
    identifierIdx: index("verification_identifier_idx").on(table.identifier)
  })
);

export const playerProfiles = pgTable("player_profiles", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  displayName: text("display_name").notNull(),
  avatarMode: avatarModeEnum("avatar_mode").notNull().default("facehash"),
  customAvatarUrl: text("custom_avatar_url"),
  ...timestamps
});

export const playerLifetimeStats = pgTable("player_lifetime_stats", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  totalMatches: integer("total_matches").notNull().default(0),
  totalWins: integer("total_wins").notNull().default(0),
  totalKills: integer("total_kills").notNull().default(0),
  totalDeaths: integer("total_deaths").notNull().default(0),
  totalDamageDealt: bigint("total_damage_dealt", { mode: "number" }).notNull().default(0),
  totalDamageTaken: bigint("total_damage_taken", { mode: "number" }).notNull().default(0),
  totalRingOuts: integer("total_ring_outs").notNull().default(0),
  totalSurvivalMs: bigint("total_survival_ms", { mode: "number" }).notNull().default(0),
  ...timestamps
});

export const matches = pgTable(
  "matches",
  {
    id: text("id").primaryKey(),
    roomId: text("room_id").notNull(),
    mapId: text("map_id").notNull(),
    mapName: text("map_name").notNull(),
    region: text("region").notNull(),
    phaseOutcome: matchOutcomeEnum("phase_outcome").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }).notNull(),
    winnerUserId: text("winner_user_id").references(() => users.id, {
      onDelete: "set null"
    }),
    summaryJson: text("summary_json").notNull().default("{}"),
    ...timestamps
  },
  (table) => ({
    roomStartedIdx: index("matches_room_started_idx").on(table.roomId, table.startedAt)
  })
);

export const matchParticipants = pgTable(
  "match_participants",
  {
    id: text("id").primaryKey(),
    matchId: text("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roomPlayerId: text("room_player_id").notNull(),
    displayName: text("display_name").notNull(),
    placement: integer("placement"),
    won: boolean("won").notNull().default(false),
    joinMode: participantJoinModeEnum("join_mode").notNull().default("active"),
    kills: integer("kills").notNull().default(0),
    deaths: integer("deaths").notNull().default(0),
    damageDealt: bigint("damage_dealt", { mode: "number" }).notNull().default(0),
    damageTaken: bigint("damage_taken", { mode: "number" }).notNull().default(0),
    ringOuts: integer("ring_outs").notNull().default(0),
    survivalMs: bigint("survival_ms", { mode: "number" }).notNull().default(0),
    ...timestamps
  },
  (table) => ({
    matchUserKey: uniqueIndex("match_participants_match_user_key").on(table.matchId, table.userId),
    participantMatchIdx: index("match_participants_match_idx").on(table.matchId)
  })
);

export const usersRelations = relations(users, ({ many, one }) => ({
  sessions: many(sessions),
  accounts: many(accounts),
  profile: one(playerProfiles, {
    fields: [users.id],
    references: [playerProfiles.userId]
  }),
  lifetimeStats: one(playerLifetimeStats, {
    fields: [users.id],
    references: [playerLifetimeStats.userId]
  }),
  matchesWon: many(matches),
  matchParticipants: many(matchParticipants)
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, {
    fields: [sessions.userId],
    references: [users.id]
  })
}));

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, {
    fields: [accounts.userId],
    references: [users.id]
  })
}));

export const playerProfilesRelations = relations(playerProfiles, ({ one }) => ({
  user: one(users, {
    fields: [playerProfiles.userId],
    references: [users.id]
  })
}));

export const playerLifetimeStatsRelations = relations(playerLifetimeStats, ({ one }) => ({
  user: one(users, {
    fields: [playerLifetimeStats.userId],
    references: [users.id]
  })
}));

export const matchesRelations = relations(matches, ({ one, many }) => ({
  winner: one(users, {
    fields: [matches.winnerUserId],
    references: [users.id]
  }),
  participants: many(matchParticipants)
}));

export const matchParticipantsRelations = relations(matchParticipants, ({ one }) => ({
  match: one(matches, {
    fields: [matchParticipants.matchId],
    references: [matches.id]
  }),
  user: one(users, {
    fields: [matchParticipants.userId],
    references: [users.id]
  })
}));

export const schema = {
  user: users,
  session: sessions,
  account: accounts,
  verification: verifications,
  playerProfiles,
  playerLifetimeStats,
  matches,
  matchParticipants,
  usersRelations,
  sessionsRelations,
  accountsRelations,
  playerProfilesRelations,
  playerLifetimeStatsRelations,
  matchesRelations,
  matchParticipantsRelations
};

export type AppDatabaseSchema = typeof schema;
export type MatchOutcome = (typeof matchOutcomeEnum.enumValues)[number];
export type ParticipantJoinMode = (typeof participantJoinModeEnum.enumValues)[number];
export type AvatarMode = (typeof avatarModeEnum.enumValues)[number];

export const touchUpdatedAt = sql`timezone('utc', now())`;
