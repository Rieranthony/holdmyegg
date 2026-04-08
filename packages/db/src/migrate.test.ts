import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_DATABASE_URL,
  DRIZZLE_MIGRATIONS_FOLDER,
  runDatabaseMigrations
} from "./migrate";

describe("runDatabaseMigrations", () => {
  it("uses the committed drizzle folder and closes the SQL client after migrating", async () => {
    const sql = {
      end: vi.fn(async () => {})
    };
    const database = {
      label: "db"
    };
    const createSqlClient = vi.fn(() => sql);
    const createMigrationDatabase = vi.fn(() => database as never);
    const migrateFn = vi.fn(async () => {});

    await runDatabaseMigrations("postgres://example.test/out_of_bounds", {
      createMigrationDatabase,
      createSqlClient,
      migrateFn
    });

    expect(createSqlClient).toHaveBeenCalledWith("postgres://example.test/out_of_bounds");
    expect(createMigrationDatabase).toHaveBeenCalledWith(sql);
    expect(migrateFn).toHaveBeenCalledWith(database, {
      migrationsFolder: DRIZZLE_MIGRATIONS_FOLDER
    });
    expect(sql.end).toHaveBeenCalledWith({
      timeout: 5
    });
  });

  it("exports the local default database URL used by docker compose", () => {
    expect(DEFAULT_DATABASE_URL).toBe("postgres://postgres:postgres@localhost:5432/out_of_bounds");
  });
});
