import { describe, expect, it } from "vitest";
import {
  chunkCoordsFromPosition,
  chunkKeyFromCoords,
  chunkKeyFromPosition,
  collectDirtyChunkKeysAround,
  createVoxelKey,
  isInBounds,
  parseVoxelKey
} from "@out-of-bounds/map";

describe("map utils", () => {
  it("creates and parses voxel keys", () => {
    const key = createVoxelKey(4, 2, 9);

    expect(key).toBe("4,2,9");
    expect(parseVoxelKey(key)).toEqual({
      x: 4,
      y: 2,
      z: 9
    });
  });

  it("derives chunk coordinates and keys from positions", () => {
    const coords = chunkCoordsFromPosition(18, 3, 31);

    expect(coords).toEqual({
      x: 1,
      y: 0,
      z: 1
    });
    expect(chunkKeyFromCoords(coords)).toBe("1:0:1");
    expect(chunkKeyFromPosition(18, 3, 31)).toBe("1:0:1");
  });

  it("checks bounds and computes dirty chunks around edits", () => {
    expect(isInBounds({ x: 8, y: 4, z: 8 }, 2, 1, 2)).toBe(true);
    expect(isInBounds({ x: 8, y: 4, z: 8 }, 9, 1, 2)).toBe(false);

    const dirty = collectDirtyChunkKeysAround({ x: 32, y: 8, z: 32 }, 15, 1, 15);

    expect(dirty).toEqual(new Set(["0:0:0", "1:0:0", "0:0:1"]));
  });
});

