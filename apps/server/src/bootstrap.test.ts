import { describe, expect, it, vi } from "vitest";
import type { ServerEnv } from "./lib/env";
import { LOCAL_DEV_SERVER_PORT, LOCAL_DEV_SERVER_URL } from "./lib/env";

vi.mock("./runtime", () => ({
  createRuntimeApp: vi.fn(),
  readRuntimeEnv: vi.fn()
}));

import { bootstrapServerApp } from "./bootstrap";

const env: ServerEnv = {
  port: LOCAL_DEV_SERVER_PORT,
  databaseUrl: "postgres://postgres:postgres@localhost:55432/out_of_bounds",
  betterAuthSecret: "secret",
  betterAuthUrl: LOCAL_DEV_SERVER_URL,
  publicServerUrl: LOCAL_DEV_SERVER_URL,
  webOrigin: "http://localhost:5173",
  region: "local-us"
};

describe("bootstrapServerApp", () => {
  it("runs migrations before creating the runtime app", async () => {
    const calls: string[] = [];
    const runtimeApp = {
      app: {
        fetch: vi.fn()
      },
      auth: {} as never,
      roomManager: {} as never,
      playerRepository: {} as never
    };
    const migrateDatabase = vi.fn(async () => {
      calls.push("migrate");
    });
    const createRuntime = vi.fn(() => {
      calls.push("runtime");
      return runtimeApp as never;
    });

    const result = await bootstrapServerApp(env, {
      createRuntime,
      migrateDatabase
    });

    expect(calls).toEqual(["migrate", "runtime"]);
    expect(migrateDatabase).toHaveBeenCalledWith(env.databaseUrl);
    expect(result).toBe(runtimeApp);
  });

  it("fails fast when migrations throw", async () => {
    const migrateDatabase = vi.fn(async () => {
      throw new Error("boom");
    });
    const createRuntime = vi.fn();

    await expect(
      bootstrapServerApp(env, {
        createRuntime,
        migrateDatabase
      })
    ).rejects.toThrow("boom");
    expect(createRuntime).not.toHaveBeenCalled();
  });
});
