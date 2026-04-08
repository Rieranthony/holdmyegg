export interface ServerEnv {
  port: number;
  databaseUrl: string;
  betterAuthSecret: string;
  betterAuthUrl: string;
  publicServerUrl: string;
  webOrigin: string;
  region: string;
}

const requireEnv = (value: string | undefined, key: string) => {
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
};

export const readServerEnv = (): ServerEnv => ({
  port: Number(process.env.PORT ?? "3000"),
  databaseUrl: requireEnv(process.env.DATABASE_URL, "DATABASE_URL"),
  betterAuthSecret: requireEnv(process.env.BETTER_AUTH_SECRET, "BETTER_AUTH_SECRET"),
  betterAuthUrl: process.env.BETTER_AUTH_URL ?? process.env.PUBLIC_SERVER_URL ?? "http://localhost:3000",
  publicServerUrl: process.env.PUBLIC_SERVER_URL ?? process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:5173",
  region: process.env.RAILWAY_REGION ?? "local-us"
});
