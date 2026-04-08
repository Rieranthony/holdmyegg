import { createDatabaseClient } from "@out-of-bounds/db";
import { createApp, type CreatedApp } from "./app";
import { createAuth } from "./lib/auth";
import type { ServerEnv } from "./lib/env";
import { readServerEnv } from "./lib/env";
import { createWarmPlaylistMaps } from "./lib/maps";
import { MemoryPlayerRepository } from "./lib/playerRepository";
import { PostgresPlayerRepository } from "./lib/postgresPlayerRepository";
import { RoomManager } from "./rooms/manager";

export const createRuntimeApp = (env = readServerEnv()): CreatedApp => {
  const databaseClient = createDatabaseClient(env.databaseUrl);
  const playerRepository =
    process.env.NODE_ENV === "test"
      ? new MemoryPlayerRepository()
      : new PostgresPlayerRepository(databaseClient.db);
  const auth = createAuth(databaseClient.db, env);
  const warmMaps = createWarmPlaylistMaps();
  const roomManager = new RoomManager({
    region: env.region,
    publicServerUrl: env.publicServerUrl,
    playerRepository,
    warmRooms: warmMaps.map((map, index) => ({
      id: `warm-${index + 1}`,
      name: `Warm Room ${index + 1}`,
      playlist: [map]
    }))
  });
  roomManager.start();

  return createApp({
    env,
    auth,
    roomManager,
    playerRepository
  });
};

export const readRuntimeEnv = (): ServerEnv => readServerEnv();
