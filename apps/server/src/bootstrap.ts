import { runDatabaseMigrations } from "@out-of-bounds/db";
import type { ServerEnv } from "./lib/env";
import { createRuntimeApp } from "./runtime";

export interface BootstrapServerAppDependencies {
  createRuntime?: typeof createRuntimeApp;
  migrateDatabase?: (databaseUrl: string) => Promise<void>;
}

export const bootstrapServerApp = async (
  env: ServerEnv,
  dependencies: BootstrapServerAppDependencies = {}
) => {
  await (dependencies.migrateDatabase ?? runDatabaseMigrations)(env.databaseUrl);
  return (dependencies.createRuntime ?? createRuntimeApp)(env);
};
