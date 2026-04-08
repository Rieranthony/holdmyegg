import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { schema } from "./schema";

export const createDatabaseClient = (connectionString: string) => {
  const sql = postgres(connectionString, {
    max: 10,
    prepare: false
  });

  return {
    sql,
    db: drizzle(sql, { schema })
  };
};

export type DatabaseClient = ReturnType<typeof createDatabaseClient>;
