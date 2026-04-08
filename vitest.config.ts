import path from "node:path";
import { defineConfig, defineProject } from "vitest/config";

const rootDir = path.resolve(__dirname);
const alias = {
  "@out-of-bounds/db": path.resolve(rootDir, "packages/db/src/index.ts"),
  "@out-of-bounds/map": path.resolve(rootDir, "packages/map/src/index.ts"),
  "@out-of-bounds/netcode": path.resolve(rootDir, "packages/netcode/src/index.ts"),
  "@out-of-bounds/sim": path.resolve(rootDir, "packages/sim/src/index.ts"),
  "@test": path.resolve(rootDir, "test")
};

const sharedCoverage = {
  provider: "v8" as const,
  reporter: ["text", "html"] as const,
  clean: true,
  exclude: [
    "**/node_modules/**",
    "**/dist/**",
    "**/*.d.ts",
    "**/__tests__/**",
    "**/*.config.*"
  ]
};

export default defineConfig({
  resolve: {
    alias
  },
  test: {
    passWithNoTests: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
    projects: [
      defineProject({
        resolve: {
          alias
        },
        test: {
          name: "netcode",
          environment: "node",
          include: ["packages/netcode/src/**/*.test.ts"],
          coverage: {
            ...sharedCoverage,
            reportsDirectory: "./coverage/netcode",
            all: true,
            include: ["packages/netcode/src/**/*.ts"],
            exclude: [...sharedCoverage.exclude, "packages/netcode/src/index.ts"],
            thresholds: {
              lines: 90,
              functions: 90,
              statements: 90,
              branches: 80
            }
          }
        }
      }),
      defineProject({
        resolve: {
          alias
        },
        test: {
          name: "db",
          environment: "node",
          include: ["packages/db/src/**/*.test.ts"],
          coverage: {
            ...sharedCoverage,
            reportsDirectory: "./coverage/db",
            all: true,
            include: ["packages/db/src/**/*.ts"],
            exclude: [...sharedCoverage.exclude, "packages/db/src/index.ts", "packages/db/drizzle.config.ts"],
            thresholds: {
              lines: 80,
              functions: 80,
              statements: 80,
              branches: 70
            }
          }
        }
      }),
      defineProject({
        resolve: {
          alias
        },
        test: {
          name: "map",
          environment: "node",
          include: ["packages/map/src/**/*.test.ts"],
          coverage: {
            ...sharedCoverage,
            reportsDirectory: "./coverage/map",
            all: true,
            include: ["packages/map/src/**/*.ts"],
            exclude: [...sharedCoverage.exclude, "packages/map/src/index.ts"],
            thresholds: {
              lines: 95,
              functions: 95,
              statements: 95,
              branches: 90
            }
          }
        }
      }),
      defineProject({
        resolve: {
          alias
        },
        test: {
          name: "sim",
          environment: "node",
          include: ["packages/sim/src/**/*.test.ts"],
          coverage: {
            ...sharedCoverage,
            reportsDirectory: "./coverage/sim",
            all: true,
            include: ["packages/sim/src/**/*.ts"],
            exclude: [...sharedCoverage.exclude, "packages/sim/src/index.ts"],
            thresholds: {
              lines: 95,
              functions: 95,
              statements: 95,
              branches: 90
            }
          }
        }
      }),
      defineProject({
        resolve: {
          alias
        },
        test: {
          name: "server",
          environment: "node",
          include: ["apps/server/src/**/*.test.ts"],
          coverage: {
            ...sharedCoverage,
            reportsDirectory: "./coverage/server",
            all: true,
            include: ["apps/server/src/**/*.ts"],
            exclude: [
              ...sharedCoverage.exclude,
              "apps/server/src/index.ts",
              "apps/server/src/runtime.ts",
              "apps/server/src/lib/auth.ts",
              "apps/server/src/lib/env.ts",
              "apps/server/src/lib/avatar.ts",
              "apps/server/src/lib/maps.ts",
              "apps/server/src/lib/postgresPlayerRepository.ts"
            ],
            thresholds: {
              lines: 80,
              functions: 80,
              statements: 80,
              branches: 70
            }
          }
        }
      }),
      defineProject({
        resolve: {
          alias
        },
        test: {
          name: "web",
          environment: "jsdom",
          setupFiles: ["./test/setup/web.ts"],
          include: ["apps/web/src/**/*.test.ts", "apps/web/src/**/*.test.tsx"],
          coverage: {
            ...sharedCoverage,
            reportsDirectory: "./coverage/web",
            all: true,
            include: [
              "apps/web/src/app/App.tsx",
              "apps/web/src/app/mapTransfer.ts",
              "apps/web/src/app/useEditorSession.ts",
              "apps/web/src/app/useMapPersistence.ts",
              "apps/web/src/app/useRuntimeSession.ts",
              "apps/web/src/components/Hud.tsx",
              "apps/web/src/data/mapStorage.ts",
              "apps/web/src/game/camera.ts",
              "apps/web/src/game/input.ts",
              "apps/web/src/game/fallingClusters.ts",
              "apps/web/src/game/terrainMesher.ts",
              "apps/web/src/game/terrainRaycast.ts",
              "apps/web/src/game/voxelMaterials.ts",
              "apps/web/src/hooks/useKeyboardInput.ts",
              "apps/web/src/engine/GameHost.tsx",
              "apps/web/src/engine/multiplayerTerrain.ts",
              "apps/web/src/engine/multiplayerWorker.ts",
              "apps/web/src/engine/runtimeInput.ts",
              "apps/web/src/components/MultiplayerRoomCards.tsx",
              "apps/web/src/components/MultiplayerRoomOverlay.tsx",
              "apps/web/src/components/PlayerAvatar.tsx",
              "apps/web/src/multiplayer/**/*.ts",
              "apps/web/src/multiplayer/**/*.tsx"
            ],
            exclude: [
              ...sharedCoverage.exclude,
              "apps/web/src/engine/runtimeInput.ts",
              "apps/web/src/multiplayer/authClient.ts"
            ],
            thresholds: {
              lines: 85,
              functions: 80,
              statements: 85,
              branches: 75
            }
          }
        }
      })
    ]
  }
});
