export interface ServerEnv {
  port: number;
  databaseUrl: string;
  betterAuthSecret: string;
  betterAuthUrl: string;
  publicServerUrl: string;
  webOrigin: string;
  region: string;
}

export const LOCAL_DEV_SERVER_PORT = 8787;
export const LOCAL_DEV_SERVER_URL = `http://localhost:${LOCAL_DEV_SERVER_PORT}`;
export const LOCAL_DEV_DATABASE_URL =
  "postgres://postgres:postgres@localhost:55432/out_of_bounds";
export const LOCAL_DEV_AUTH_SECRET = "local-dev-auth-secret-change-me-1234567890";

const readNonEmptyEnv = (value: string | undefined) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

export const resolveServerEnv = (
  env: Record<string, string | undefined>
): ServerEnv => {
  const betterAuthUrl = readNonEmptyEnv(env.BETTER_AUTH_URL);
  const publicServerUrl = readNonEmptyEnv(env.PUBLIC_SERVER_URL);

  return {
    port: Number(readNonEmptyEnv(env.PORT) ?? String(LOCAL_DEV_SERVER_PORT)),
    databaseUrl: readNonEmptyEnv(env.DATABASE_URL) ?? LOCAL_DEV_DATABASE_URL,
    betterAuthSecret: readNonEmptyEnv(env.BETTER_AUTH_SECRET) ?? LOCAL_DEV_AUTH_SECRET,
    betterAuthUrl: betterAuthUrl ?? publicServerUrl ?? LOCAL_DEV_SERVER_URL,
    publicServerUrl: publicServerUrl ?? betterAuthUrl ?? LOCAL_DEV_SERVER_URL,
    webOrigin: readNonEmptyEnv(env.WEB_ORIGIN) ?? "http://localhost:5173",
    region: readNonEmptyEnv(env.RAILWAY_REGION) ?? "local-us"
  };
};

export const readServerEnv = (): ServerEnv => resolveServerEnv(process.env);
