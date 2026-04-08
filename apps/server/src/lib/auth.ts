import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { anonymous } from "better-auth/plugins";
import type { DatabaseClient } from "@out-of-bounds/db";
import { schema } from "@out-of-bounds/db";
import type { ServerEnv } from "./env";

export const createAuth = (database: DatabaseClient["db"], env: ServerEnv) =>
  betterAuth({
    secret: env.betterAuthSecret,
    baseURL: env.betterAuthUrl,
    trustedOrigins: [env.webOrigin, env.publicServerUrl, env.betterAuthUrl],
    database: drizzleAdapter(database, {
      provider: "pg",
      schema
    }),
    plugins: [anonymous()],
    user: {
      additionalFields: {
        isAnonymous: {
          type: "boolean",
          required: false
        }
      }
    }
  });

export type BetterAuthInstance = ReturnType<typeof createAuth>;
