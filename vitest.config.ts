import path from "node:path";
import { defineConfig, defineProject } from "vitest/config";

const rootDir = path.resolve(__dirname);
const alias = {
  "@out-of-bounds/map": path.resolve(rootDir, "packages/map/src/index.ts"),
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
              "apps/web/src/engine/runtimeInput.ts"
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
