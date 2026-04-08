import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { migrate as drizzleMigrate } from "drizzle-orm/postgres-js/migrator";

export const DEFAULT_DATABASE_URL =
  "postgres://postgres:postgres@localhost:55432/out_of_bounds";
export const DRIZZLE_MIGRATIONS_FOLDER = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../drizzle"
);

export interface MigrationSqlClient {
  end(options?: { timeout?: number }): Promise<void>;
}

type MigrationDatabase = PostgresJsDatabase<Record<string, never>>;

export interface RunDatabaseMigrationsDependencies {
  createMigrationDatabase?: (sql: MigrationSqlClient) => MigrationDatabase;
  createSqlClient?: (connectionString: string) => MigrationSqlClient;
  migrateFn?: (database: MigrationDatabase, config: { migrationsFolder: string }) => Promise<void>;
  migrationsFolder?: string;
}

const createMigrationSqlClient = (connectionString: string) =>
  postgres(connectionString, {
    max: 1,
    prepare: false
  });

const createMigrationDatabase = (sql: MigrationSqlClient): MigrationDatabase =>
  drizzle(sql as ReturnType<typeof postgres>);

export const runDatabaseMigrations = async (
  connectionString: string,
  dependencies: RunDatabaseMigrationsDependencies = {}
) => {
  const sql = (dependencies.createSqlClient ?? createMigrationSqlClient)(connectionString);

  try {
    const database = (dependencies.createMigrationDatabase ?? createMigrationDatabase)(sql);
    await (dependencies.migrateFn ?? drizzleMigrate)(database, {
      migrationsFolder: dependencies.migrationsFolder ?? DRIZZLE_MIGRATIONS_FOLDER
    });
  } finally {
    await sql.end({
      timeout: 5
    });
  }
};
