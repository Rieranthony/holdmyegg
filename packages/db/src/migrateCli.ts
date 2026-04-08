import { DEFAULT_DATABASE_URL, runDatabaseMigrations } from "./migrate";

const databaseUrl = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;

await runDatabaseMigrations(databaseUrl);
