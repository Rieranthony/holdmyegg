import { MutableVoxelWorld, type MapDocumentV1, type VoxelCell } from "@out-of-bounds/map";
import { describe, expect, it } from "vitest";
import { buildSurfaceDecorations } from "./surfaceDecorations";

const createFlatArenaDocument = (): MapDocumentV1 => {
  const voxels: VoxelCell[] = [];

  for (let x = 0; x < 12; x += 1) {
    for (let z = 0; z < 12; z += 1) {
      voxels.push({ x, y: 0, z, kind: "ground" });
    }
  }

  return {
    version: 1,
    meta: {
      name: "Decoration Test Arena",
      theme: "party-grass",
      createdAt: "2026-04-04T00:00:00.000Z",
      updatedAt: "2026-04-04T00:00:00.000Z"
    },
    size: { x: 12, y: 12, z: 12 },
    boundary: { fallY: -1 },
    spawns: [{ id: "spawn-1", x: 2.5, y: 1.05, z: 2.5 }],
    props: [{ id: "prop-1", kind: "tree-oak", x: 8, y: 1, z: 8 }],
    voxels
  };
};

describe("buildSurfaceDecorations", () => {
  it("is deterministic and avoids spawn and tree footprints", () => {
    const world = new MutableVoxelWorld(createFlatArenaDocument());

    const first = buildSurfaceDecorations(world);
    const second = buildSurfaceDecorations(world);

    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(0);
    expect(first.some((decoration) => Math.floor(decoration.x) === 2 && Math.floor(decoration.z) === 2)).toBe(false);
    expect(first.some((decoration) => Math.floor(decoration.x) >= 7 && Math.floor(decoration.x) <= 9 && Math.floor(decoration.z) >= 7 && Math.floor(decoration.z) <= 9)).toBe(false);
    expect(
      first.every((decoration, index) =>
        first.slice(index + 1).every((other) => Math.hypot(decoration.x - other.x, decoration.z - other.z) >= 1.7)
      )
    ).toBe(true);
  });
});
