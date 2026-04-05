import { describe, expect, it } from "vitest";
import {
  DEFAULT_FOUNDATION_DEPTH,
  DEFAULT_GROUND_TOP_Y,
  DEFAULT_MOUNTAIN_PEAK_RISE,
  MAX_PLAYABLE_ARENA_DEPTH,
  MAX_PLAYABLE_ARENA_WIDTH,
  createDefaultArenaMap,
  getDefaultArenaColumnTopY,
  getDefaultArenaSpawnPadBounds,
  getDefaultArenaSummitBounds,
  isInsideDefaultArenaFootprint,
  normalizeArenaBudgetMapDocument
} from "@out-of-bounds/map";
import type { MapDocumentV1 } from "../types";

const createOversizedDocument = ({
  spawns
}: {
  spawns: MapDocumentV1["spawns"];
}): MapDocumentV1 => ({
  version: 1,
  meta: {
    name: "Oversized Arena",
    theme: "party-grass",
    createdAt: "2026-04-04T00:00:00.000Z",
    updatedAt: "2026-04-04T00:00:00.000Z"
  },
  size: {
    x: 120,
    y: 32,
    z: 130
  },
  boundary: {
    fallY: -1
  },
  spawns,
  props: [],
  voxels: [
    { x: 10, y: 0, z: 10, kind: "ground" },
    { x: 95, y: 0, z: 10, kind: "ground" },
    { x: 10, y: 0, z: 110, kind: "boundary" }
  ]
});

describe("arena budget normalization", () => {
  it("builds the curved default arena with summit plateau and spawn pads", () => {
    const document = createDefaultArenaMap();
    const summitBounds = getDefaultArenaSummitBounds(document.size);
    const spawnPadBounds = getDefaultArenaSpawnPadBounds(document.size);
    const summitHeights = new Set<number>();

    expect(document.size).toEqual({ x: 80, y: 32, z: 80 });
    expect(document.props).toHaveLength(42);
    expect(document.props.every((prop) => prop.kind === "tree-oak")).toBe(true);
    expect(document.spawns).toEqual([
      { id: "spawn-1", x: 16.5, y: DEFAULT_FOUNDATION_DEPTH + 0.05, z: 16.5 },
      { id: "spawn-2", x: 63.5, y: DEFAULT_FOUNDATION_DEPTH + 0.05, z: 16.5 },
      { id: "spawn-3", x: 16.5, y: DEFAULT_FOUNDATION_DEPTH + 0.05, z: 63.5 },
      { id: "spawn-4", x: 63.5, y: DEFAULT_FOUNDATION_DEPTH + 0.05, z: 63.5 }
    ]);
    expect(isInsideDefaultArenaFootprint(document.size, 0, 0)).toBe(false);
    expect(isInsideDefaultArenaFootprint(document.size, 16, 16)).toBe(true);
    expect(document.voxels.some((voxel) => voxel.x === 0 && voxel.y === DEFAULT_GROUND_TOP_Y && voxel.z === 0)).toBe(false);
    expect(document.voxels.some((voxel) => voxel.x === 16 && voxel.y === DEFAULT_GROUND_TOP_Y && voxel.z === 16)).toBe(true);
    expect(getDefaultArenaColumnTopY(document.size, 4, 40)).toBeGreaterThanOrEqual(DEFAULT_GROUND_TOP_Y + 4);
    expect(getDefaultArenaColumnTopY(document.size, 4, 40)).toBeGreaterThan(getDefaultArenaColumnTopY(document.size, 6, 40));
    expect(getDefaultArenaColumnTopY(document.size, 6, 40)).toBeGreaterThan(getDefaultArenaColumnTopY(document.size, 8, 40));
    expect(getDefaultArenaColumnTopY(document.size, 8, 40)).toBeGreaterThanOrEqual(getDefaultArenaColumnTopY(document.size, 10, 40));
    expect(
      document.props.every(
        (prop) =>
          !spawnPadBounds.some(
            (bounds) =>
              prop.x >= bounds.minX - 2 &&
              prop.x <= bounds.maxX + 2 &&
              prop.z >= bounds.minZ - 2 &&
              prop.z <= bounds.maxZ + 2
          )
      )
    ).toBe(true);
    expect(
      document.props.every(
        (prop) =>
          !(
            prop.x >= summitBounds.minX - 4 &&
            prop.x <= summitBounds.maxX + 4 &&
            prop.z >= summitBounds.minZ - 4 &&
            prop.z <= summitBounds.maxZ + 4
          )
      )
    ).toBe(true);
    expect(
      document.props.filter((prop) => prop.x < 20 || prop.x > 59 || prop.z < 20 || prop.z > 59).length
    ).toBeGreaterThan(
      document.props.filter((prop) => prop.x >= 28 && prop.x <= 51 && prop.z >= 28 && prop.z <= 51).length
    );

    for (let x = summitBounds.minX; x <= summitBounds.maxX; x += 1) {
      for (let z = summitBounds.minZ; z <= summitBounds.maxZ; z += 1) {
        summitHeights.add(getDefaultArenaColumnTopY(document.size, x, z));
        expect(document.voxels.some((voxel) => voxel.x === x && voxel.z === z)).toBe(true);
      }
    }

    expect(summitBounds.maxX - summitBounds.minX + 1).toBe(6);
    expect(summitBounds.maxZ - summitBounds.minZ + 1).toBe(6);
    expect(summitHeights).toEqual(new Set([DEFAULT_GROUND_TOP_Y + DEFAULT_MOUNTAIN_PEAK_RISE]));
  });

  it("trims oversized maps to the 80x80 budget and drops out-of-bounds terrain and spawns", () => {
    const normalized = normalizeArenaBudgetMapDocument(
      createOversizedDocument({
        spawns: [
          { id: "spawn-1", x: 12.5, y: 5.05, z: 12.5 },
          { id: "spawn-2", x: 100.5, y: 5.05, z: 12.5 },
          { id: "spawn-3", x: 12.5, y: 5.05, z: 100.5 }
        ]
      })
    );

    expect(normalized.size.x).toBe(MAX_PLAYABLE_ARENA_WIDTH);
    expect(normalized.size.z).toBe(MAX_PLAYABLE_ARENA_DEPTH);
    expect(normalized.voxels).toEqual([{ x: 10, y: 0, z: 10, kind: "ground" }]);
    expect(normalized.spawns).toEqual([{ id: "spawn-1", x: 12.5, y: 5.05, z: 12.5 }]);
  });

  it("replaces empty spawn results with the default corner layout after trimming", () => {
    const normalized = normalizeArenaBudgetMapDocument(
      createOversizedDocument({
        spawns: [{ id: "spawn-9", x: 110.5, y: 5.05, z: 110.5 }]
      })
    );

    expect(normalized.spawns).toEqual([
      { id: "spawn-1", x: 11.5, y: DEFAULT_FOUNDATION_DEPTH + 0.05, z: 11.5 },
      { id: "spawn-2", x: 68.5, y: DEFAULT_FOUNDATION_DEPTH + 0.05, z: 11.5 },
      { id: "spawn-3", x: 11.5, y: DEFAULT_FOUNDATION_DEPTH + 0.05, z: 68.5 },
      { id: "spawn-4", x: 68.5, y: DEFAULT_FOUNDATION_DEPTH + 0.05, z: 68.5 }
    ]);
  });

  it("drops out-of-bounds and spawn-overlapping tree props during normalization", () => {
    const document = createOversizedDocument({
      spawns: [{ id: "spawn-1", x: 10.5, y: 5.05, z: 10.5 }]
    });
    document.voxels.push({ x: 12, y: 0, z: 10, kind: "ground" });
    document.props = [
      { id: "prop-1", kind: "tree-oak", x: 10, y: 1, z: 10 },
      { id: "prop-2", kind: "tree-oak", x: 12, y: 1, z: 10 },
      { id: "prop-3", kind: "tree-oak", x: 95, y: 1, z: 10 }
    ];

    const normalized = normalizeArenaBudgetMapDocument(document);

    expect(normalized.props).toEqual([{ id: "prop-2", kind: "tree-oak", x: 12, y: 1, z: 10 }]);
  });
});
