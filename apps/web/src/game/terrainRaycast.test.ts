import { MutableVoxelWorld, type MapDocumentV1 } from "@out-of-bounds/map";
import { describe, expect, it } from "vitest";
import { raycastVoxelWorld, resolveTerrainRaycastHit } from "./terrainRaycast";

const createTinyWorld = (
  voxels: Array<{ x: number; y: number; z: number; kind: "ground" | "boundary" | "hazard" }>,
  props: MapDocumentV1["props"] = []
) =>
  new MutableVoxelWorld({
    version: 1,
    meta: {
      name: "Raycast Test Arena",
      theme: "party-grass",
      createdAt: "2026-04-04T00:00:00.000Z",
      updatedAt: "2026-04-04T00:00:00.000Z"
    },
    size: { x: 32, y: 16, z: 32 },
    boundary: { fallY: -1 },
    spawns: [],
    props,
    voxels
  });

describe("resolveTerrainRaycastHit", () => {
  it("resolves the clicked voxel correctly for all six face normals", () => {
    expect(resolveTerrainRaycastHit({ x: 2, y: 2.4, z: 3.6 }, { x: 1, y: 0, z: 0 })).toEqual({
      voxel: { x: 1, y: 2, z: 3 },
      normal: { x: 1, y: 0, z: 0 }
    });
    expect(resolveTerrainRaycastHit({ x: 1, y: 2.4, z: 3.6 }, { x: -1, y: 0, z: 0 })).toEqual({
      voxel: { x: 1, y: 2, z: 3 },
      normal: { x: -1, y: 0, z: 0 }
    });
    expect(resolveTerrainRaycastHit({ x: 1.4, y: 3, z: 3.6 }, { x: 0, y: 1, z: 0 })).toEqual({
      voxel: { x: 1, y: 2, z: 3 },
      normal: { x: 0, y: 1, z: 0 }
    });
    expect(resolveTerrainRaycastHit({ x: 1.4, y: 2, z: 3.6 }, { x: 0, y: -1, z: 0 })).toEqual({
      voxel: { x: 1, y: 2, z: 3 },
      normal: { x: 0, y: -1, z: 0 }
    });
    expect(resolveTerrainRaycastHit({ x: 1.4, y: 2.4, z: 4 }, { x: 0, y: 0, z: 1 })).toEqual({
      voxel: { x: 1, y: 2, z: 3 },
      normal: { x: 0, y: 0, z: 1 }
    });
    expect(resolveTerrainRaycastHit({ x: 1.4, y: 2.4, z: 3 }, { x: 0, y: 0, z: -1 })).toEqual({
      voxel: { x: 1, y: 2, z: 3 },
      normal: { x: 0, y: 0, z: -1 }
    });
  });

  it("keeps chunk-seam hits on the voxel that was actually clicked", () => {
    expect(resolveTerrainRaycastHit({ x: 16, y: 1.5, z: 1.5 }, { x: 1, y: 0, z: 0 })).toEqual({
      voxel: { x: 15, y: 1, z: 1 },
      normal: { x: 1, y: 0, z: 0 }
    });
  });

  it("returns null when the face normal is unavailable", () => {
    expect(resolveTerrainRaycastHit({ x: 1, y: 1, z: 1 }, null)).toBeNull();
  });
});

describe("raycastVoxelWorld", () => {
  it("hits top faces directly from the camera ray", () => {
    const world = createTinyWorld([{ x: 2, y: 1, z: 2, kind: "ground" }]);

    expect(raycastVoxelWorld(world, { x: 2.5, y: 4, z: 2.5 }, { x: 0, y: -1, z: 0 }, 8)).toEqual({
      voxel: { x: 2, y: 1, z: 2 },
      normal: { x: 0, y: 1, z: 0 },
      distance: 2
    });
  });

  it("resolves cliff and chunk-seam side hits with the correct face normal", () => {
    const world = createTinyWorld([{ x: 16, y: 1, z: 1, kind: "ground" }]);

    expect(raycastVoxelWorld(world, { x: 19.5, y: 1.5, z: 1.5 }, { x: -1, y: 0, z: 0 }, 8)).toEqual({
      voxel: { x: 16, y: 1, z: 1 },
      normal: { x: 1, y: 0, z: 0 },
      distance: 2.5
    });
  });

  it("hits solid tree props even though they are not terrain voxels", () => {
    const world = createTinyWorld([{ x: 4, y: 0, z: 4, kind: "ground" }], [
      { id: "prop-1", kind: "tree-oak", x: 4, y: 1, z: 4 }
    ]);
    const hit = raycastVoxelWorld(world, { x: 4.5, y: 8, z: 4.5 }, { x: 0, y: -1, z: 0 }, 8);

    expect(hit).not.toBeNull();
    expect(hit?.voxel).toEqual({ x: 4, y: world.getTopSolidY(4, 4), z: 4 });
    expect(hit?.normal).toEqual({ x: 0, y: 1, z: 0 });
  });

  it("skips holes and respects interact range", () => {
    const world = createTinyWorld([
      { x: 3, y: 1, z: 3, kind: "ground" },
      { x: 4, y: 1, z: 3, kind: "ground" }
    ]);

    expect(raycastVoxelWorld(world, { x: 2.5, y: 1.5, z: 3.5 }, { x: 1, y: 0, z: 0 }, 0.4)).toBeNull();
    expect(raycastVoxelWorld(world, { x: 3.5, y: 4, z: 4.5 }, { x: 0, y: -1, z: 0 }, 8)).toBeNull();
  });
});
