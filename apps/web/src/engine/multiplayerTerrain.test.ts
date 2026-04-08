import { describe, expect, it } from "vitest";
import {
  MutableVoxelWorld,
  createDefaultArenaMap,
  normalizeArenaBudgetMapDocument
} from "@out-of-bounds/map";
import { applyTerrainDeltaBatchToWorld } from "./multiplayerTerrain";

describe("applyTerrainDeltaBatchToWorld", () => {
  it("applies voxel changes and returns dirty chunk patches", () => {
    const document = normalizeArenaBudgetMapDocument(createDefaultArenaMap());
    const world = new MutableVoxelWorld(document);
    world.settleDetachedComponents();

    const target = document.voxels[0]!;
    const result = applyTerrainDeltaBatchToWorld(world, {
      tick: 1,
      terrainRevision: 2,
      changes: [
        {
          voxel: {
            x: target.x,
            y: target.y,
            z: target.z
          },
          kind: null,
          operation: "remove",
          source: "destroy"
        }
      ]
    });

    expect(result.document.voxels.some((voxel) => voxel.x === target.x && voxel.y === target.y && voxel.z === target.z)).toBe(false);
    expect(result.patches.length).toBeGreaterThan(0);
  });
});
