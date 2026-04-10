import { describe, expect, it } from "vitest";
import {
  LOCAL_DEV_AUTH_SECRET,
  LOCAL_DEV_DATABASE_URL,
  LOCAL_DEV_SERVER_PORT,
  LOCAL_DEV_SERVER_URL,
  resolveServerEnv
} from "./env";

describe("resolveServerEnv", () => {
  it("uses tracked local defaults when env vars are missing", () => {
    expect(resolveServerEnv({})).toEqual({
      port: LOCAL_DEV_SERVER_PORT,
      databaseUrl: LOCAL_DEV_DATABASE_URL,
      betterAuthSecret: LOCAL_DEV_AUTH_SECRET,
      betterAuthUrl: LOCAL_DEV_SERVER_URL,
      publicServerUrl: LOCAL_DEV_SERVER_URL,
      webOrigin: "http://localhost:5173",
      region: "local-us"
    });
  });

  it("prefers explicit env overrides when they are provided", () => {
    expect(
      resolveServerEnv({
        PORT: "9999",
        DATABASE_URL: "postgres://remote.example.com/app",
        BETTER_AUTH_SECRET: "prod-secret",
        BETTER_AUTH_URL: "https://auth.example.com",
        PUBLIC_SERVER_URL: "https://api.example.com",
        WEB_ORIGIN: "https://game.example.com",
        RAILWAY_REGION: "asia-southeast1"
      })
    ).toEqual({
      port: 9999,
      databaseUrl: "postgres://remote.example.com/app",
      betterAuthSecret: "prod-secret",
      betterAuthUrl: "https://auth.example.com",
      publicServerUrl: "https://api.example.com",
      webOrigin: "https://game.example.com",
      region: "asia-southeast1"
    });
  });

  it("reuses the public server URL for auth when only one server URL is configured", () => {
    expect(
      resolveServerEnv({
        PUBLIC_SERVER_URL: "https://api.example.com"
      })
    ).toMatchObject({
      betterAuthUrl: "https://api.example.com",
      publicServerUrl: "https://api.example.com"
    });

    expect(
      resolveServerEnv({
        BETTER_AUTH_URL: "https://auth.example.com"
      })
    ).toMatchObject({
      betterAuthUrl: "https://auth.example.com",
      publicServerUrl: "https://auth.example.com"
    });
  });
});
