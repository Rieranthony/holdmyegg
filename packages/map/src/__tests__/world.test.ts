import { describe, expect, it } from "vitest";
import type { MapDocumentV1 } from "../types";
import {
  createDefaultArenaMap,
  DEFAULT_FOUNDATION_DEPTH,
  DEFAULT_GROUND_TOP_Y,
  DEFAULT_MOUNTAIN_PEAK_RISE,
  DEFAULT_SURFACE_Y,
  getDefaultArenaSummitBounds
} from "../default-map";
import { EXPOSED_FACE_BITS } from "../utils";
import { MutableVoxelWorld } from "../world";

const normalizeChunks = (entries: ReturnType<MutableVoxelWorld["buildVisibleChunks"]>) =>
  entries
    .map((chunk) => ({
      key: chunk.key,
      voxels: chunk.voxels
        .map((voxel) => `${voxel.key}:${voxel.faceMask}`)
        .sort()
    }))
    .sort((left, right) => left.key.localeCompare(right.key));

const createTinyDocument = ({
  voxels,
  spawns = []
}: {
  voxels: Array<{ x: number; y: number; z: number; kind: "ground" | "boundary" | "hazard" }>;
  spawns?: MapDocumentV1["spawns"];
}): MapDocumentV1 => ({
    version: 1,
    meta: {
      name: "Tiny Test Arena",
      theme: "party-grass",
      createdAt: "2026-04-04T00:00:00.000Z",
      updatedAt: "2026-04-04T00:00:00.000Z"
    },
    size: { x: 32, y: 20, z: 32 },
    boundary: { fallY: -1 },
    spawns,
    props: [],
    voxels
  });

const createTinyWorld = (
  voxels: Array<{ x: number; y: number; z: number; kind: "ground" | "boundary" | "hazard" }>,
  spawns: MapDocumentV1["spawns"] = []
) => new MutableVoxelWorld(createTinyDocument({ voxels, spawns }));

describe("MutableVoxelWorld", () => {
  it("builds visible chunks and can rebuild the same chunks by key", () => {
    const world = createTinyWorld([
      { x: 4, y: 3, z: 4, kind: "ground" },
      { x: 5, y: 3, z: 4, kind: "ground" },
      { x: 18, y: 4, z: 17, kind: "boundary" }
    ]);
    const chunks = world.buildVisibleChunks();
    const rebuiltChunks = world.buildVisibleChunksForKeys(chunks.map((chunk) => chunk.key));

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.some((chunk) => chunk.voxels.length > 0)).toBe(true);

    expect(normalizeChunks(rebuiltChunks)).toEqual(normalizeChunks(chunks));
    expect(world.buildVisibleChunkByKey("missing-chunk")).toBeNull();
  });

  it("mutates terrain only for real edits and ignores invalid edits", () => {
    const world = createTinyWorld([{ x: 0, y: 0, z: 0, kind: "ground" }]);
    const initialRevision = world.getTerrainRevision();
    const firstVoxel = world.toDocument().voxels[0];

    expect(world.setVoxel(-1, 0, 0, "ground").size).toBe(0);
    expect(world.removeVoxel(200, 0, 200).size).toBe(0);
    expect(world.setVoxel(firstVoxel.x, firstVoxel.y, firstVoxel.z, firstVoxel.kind).size).toBe(0);
    expect(world.getTerrainRevision()).toBe(initialRevision);

    const addDirty = world.setVoxel(12, DEFAULT_SURFACE_Y, 12, "ground");
    expect(addDirty.size).toBeGreaterThan(0);
    expect(world.getTerrainRevision()).toBe(initialRevision + 1);

    const afterAddRevision = world.getTerrainRevision();
    expect(world.removeVoxel(12, DEFAULT_SURFACE_Y, 12).size).toBeGreaterThan(0);
    expect(world.getTerrainRevision()).toBe(afterAddRevision + 1);
    expect(world.removeVoxel(12, DEFAULT_SURFACE_Y, 12).size).toBe(0);
  });

  it("computes spawn placement on top of terrain", () => {
    const world = createTinyWorld([
      { x: 24, y: 0, z: 24, kind: "ground" },
      { x: 24, y: 1, z: 24, kind: "ground" },
      { x: 24, y: 2, z: 24, kind: "ground" }
    ]);
    const position = world.getEditableSpawnPosition(24, 24);

    expect(position.y).toBe(3.05);
  });

  it("manages spawns and dirty chunks near chunk boundaries", () => {
    const world = createTinyWorld([]);
    const spawnId = world.setSpawn(5.5, 1.05, 5.5);

    expect(world.listSpawns().some((spawn) => spawn.id === spawnId)).toBe(true);
    expect(world.removeSpawn("missing-spawn")).toBe(false);
    expect(world.removeSpawn(spawnId)).toBe(true);

    const dirty = world.setVoxel(15, 1, 15, "ground");
    expect(dirty).toEqual(new Set(["0:0:0", "1:0:0", "0:0:1"]));
  });

  it("tracks solid tree props separately from terrain voxels", () => {
    const world = createTinyWorld([{ x: 4, y: 0, z: 4, kind: "ground" }]);
    const propId = world.setProp("tree-oak", 4, 1, 4);
    const topSolidY = world.getTopSolidY(4, 4);

    expect(propId).toBe("prop-1");
    expect(world.listProps()).toHaveLength(1);
    expect(topSolidY).toBeGreaterThanOrEqual(5);
    expect(world.hasVoxel(4, topSolidY, 4)).toBe(false);
    expect(world.hasSolid(4, topSolidY, 4)).toBe(true);
    expect(world.getSolidKind(4, topSolidY, 4)).toBe("tree-oak");
    expect(world.getPropAtVoxel(4, topSolidY, 4)?.id).toBe(propId);
    expect(world.getEditablePropPlacement("tree-oak", 4, 4)).toBeNull();
    expect(world.removeProp(propId!)).toBe(true);
    expect(world.getTopSolidY(4, 4)).toBe(0);
  });

  it("keeps spawn ids monotonic after deletions", () => {
    const world = createTinyWorld([], [
      { id: "spawn-1", x: 4.5, y: 1.05, z: 4.5 },
      { id: "spawn-2", x: 8.5, y: 1.05, z: 4.5 },
      { id: "spawn-3", x: 4.5, y: 1.05, z: 8.5 },
      { id: "spawn-4", x: 8.5, y: 1.05, z: 8.5 }
    ]);

    expect(world.nextSpawnId()).toBe("spawn-5");
    expect(world.removeSpawn("spawn-2")).toBe(true);
    expect(world.nextSpawnId()).toBe("spawn-5");

    const addedSpawnId = world.setSpawn(10.5, 1.05, 10.5);
    expect(addedSpawnId).toBe("spawn-5");
    expect(world.nextSpawnId()).toBe("spawn-6");
  });

  it("rebuilds dirty chunks from the indexed surface map after edits", () => {
    const world = createTinyWorld([]);

    const dirtyAfterAdd = [...world.setVoxel(16, 1, 16, "ground")];
    const fullAfterAdd = world
      .buildVisibleChunks()
      .filter((chunk) => dirtyAfterAdd.includes(chunk.key));
    const rebuiltAfterAdd = world.buildVisibleChunksForKeys(dirtyAfterAdd);

    expect(normalizeChunks(rebuiltAfterAdd)).toEqual(normalizeChunks(fullAfterAdd));

    const dirtyAfterRemove = [...world.removeVoxel(16, 1, 16)];
    const fullAfterRemove = world
      .buildVisibleChunks()
      .filter((chunk) => dirtyAfterRemove.includes(chunk.key));
    const rebuiltAfterRemove = world.buildVisibleChunksForKeys(dirtyAfterRemove);

    expect(normalizeChunks(rebuiltAfterRemove)).toEqual(normalizeChunks(fullAfterRemove));
  });

  it("records exposed face masks for isolated and adjacent voxels", () => {
    const isolatedWorld = createTinyWorld([{ x: 4, y: 3, z: 4, kind: "ground" }]);
    const isolatedVoxel = isolatedWorld.buildVisibleChunks()[0]?.voxels[0];
    expect(isolatedVoxel?.faceMask).toBe(
      EXPOSED_FACE_BITS.posX |
        EXPOSED_FACE_BITS.negX |
        EXPOSED_FACE_BITS.posY |
        EXPOSED_FACE_BITS.negY |
        EXPOSED_FACE_BITS.posZ |
        EXPOSED_FACE_BITS.negZ
    );

    const adjacentWorld = createTinyWorld([
      { x: 4, y: 3, z: 4, kind: "ground" },
      { x: 5, y: 3, z: 4, kind: "ground" }
    ]);
    const adjacentVoxels = adjacentWorld.buildVisibleChunks()[0]?.voxels ?? [];
    const leftVoxel = adjacentVoxels.find((voxel) => voxel.position.x === 4);
    const rightVoxel = adjacentVoxels.find((voxel) => voxel.position.x === 5);

    expect(leftVoxel).toBeDefined();
    expect(rightVoxel).toBeDefined();
    expect((leftVoxel!.faceMask ?? 0) & EXPOSED_FACE_BITS.posX).toBe(0);
    expect((rightVoxel!.faceMask ?? 0) & EXPOSED_FACE_BITS.negX).toBe(0);
    expect((leftVoxel!.faceMask ?? 0) & EXPOSED_FACE_BITS.negX).toBe(EXPOSED_FACE_BITS.negX);
    expect((rightVoxel!.faceMask ?? 0) & EXPOSED_FACE_BITS.posX).toBe(EXPOSED_FACE_BITS.posX);
  });

  it("updates exposed face masks correctly across chunk boundaries after dirty rebuilds", () => {
    const world = createTinyWorld([
      { x: 15, y: 3, z: 4, kind: "ground" },
      { x: 16, y: 3, z: 4, kind: "ground" }
    ]);

    const beforeChunks = world.buildVisibleChunks();
    const leftBefore = beforeChunks
      .flatMap((chunk) => chunk.voxels)
      .find((voxel) => voxel.position.x === 15);
    const rightBefore = beforeChunks
      .flatMap((chunk) => chunk.voxels)
      .find((voxel) => voxel.position.x === 16);

    expect(leftBefore).toBeDefined();
    expect(rightBefore).toBeDefined();
    expect((leftBefore!.faceMask ?? 0) & EXPOSED_FACE_BITS.posX).toBe(0);
    expect((rightBefore!.faceMask ?? 0) & EXPOSED_FACE_BITS.negX).toBe(0);

    const dirtyChunkKeys = [...world.removeVoxel(16, 3, 4)];
    const rebuilt = world.buildVisibleChunksForKeys(dirtyChunkKeys);
    const leftAfter = rebuilt
      .flatMap((chunk) => chunk.voxels)
      .find((voxel) => voxel.position.x === 15);

    expect(dirtyChunkKeys).toContain("0:0:0");
    expect(dirtyChunkKeys).toContain("1:0:0");
    expect(leftAfter).toBeDefined();
    expect((leftAfter!.faceMask ?? 0) & EXPOSED_FACE_BITS.posX).toBe(EXPOSED_FACE_BITS.posX);
  });

  it("keeps the default arena invariants intact", () => {
    const world = new MutableVoxelWorld(createDefaultArenaMap());
    const summitBounds = getDefaultArenaSummitBounds(world.size);

    expect(world.listSpawns().length).toBeGreaterThanOrEqual(4);
    expect(world.size).toEqual({ x: 80, y: 32, z: 80 });
    expect(world.boundary.fallY).toBe(-1);
    expect(world.getVoxelKind(0, DEFAULT_GROUND_TOP_Y, 0)).toBeUndefined();
    expect(world.getVoxelKind(16, DEFAULT_GROUND_TOP_Y, 16)).toBe("ground");
    expect(world.getTopSolidY(16, 16)).toBe(DEFAULT_GROUND_TOP_Y);
    expect(world.getTopSolidY(4, 40)).toBeGreaterThanOrEqual(DEFAULT_GROUND_TOP_Y + 4);
    expect(world.getTopSolidY(4, 40)).toBeGreaterThan(world.getTopSolidY(6, 40));
    expect(world.getTopSolidY(6, 40)).toBeGreaterThan(world.getTopSolidY(8, 40));
    expect(world.getTopSolidY(8, 40)).toBeGreaterThanOrEqual(world.getTopSolidY(10, 40));
    expect(world.getTopSolidY(40, 40)).toBe(DEFAULT_GROUND_TOP_Y + DEFAULT_MOUNTAIN_PEAK_RISE);
    expect(world.getTopSolidY(summitBounds.minX, summitBounds.minZ)).toBe(DEFAULT_GROUND_TOP_Y + DEFAULT_MOUNTAIN_PEAK_RISE);
    expect(world.getVoxelKind(16, DEFAULT_FOUNDATION_DEPTH, 16)).toBeUndefined();
    expect(world.listSpawns().every((spawn) => spawn.x >= 0 && spawn.z >= 0)).toBe(true);
  });

  it("keeps bridges stable when they stay connected to anchor voxels", () => {
    const world = createTinyWorld([]);
    world.setVoxel(0, 14, 10, "boundary");
    world.setVoxel(1, 14, 10, "ground");
    world.setVoxel(2, 14, 10, "ground");
    world.setVoxel(3, 14, 10, "ground");

    const detachedKeys = world
      .collectDetachedComponents()
      .flatMap((component) => component.voxels.map((voxel) => `${voxel.x},${voxel.y},${voxel.z}`));

    expect(detachedKeys).not.toContain("1,14,10");
    expect(detachedKeys).not.toContain("2,14,10");
    expect(detachedKeys).not.toContain("3,14,10");
  });

  it("returns detached floating islands as components", () => {
    const world = createTinyWorld([]);
    world.setVoxel(10, 14, 10, "ground");
    world.setVoxel(11, 14, 10, "boundary");

    const detached = world.collectDetachedComponents();

    expect(detached).toHaveLength(1);
    expect(detached[0]?.voxels).toEqual([
      { x: 10, y: 14, z: 10, kind: "ground" },
      { x: 11, y: 14, z: 10, kind: "boundary" }
    ]);
  });

  it("settles detached components onto stable terrain immediately", () => {
    const world = createTinyWorld([]);
    world.setVoxel(10, 14, 10, "ground");
    world.setVoxel(11, 14, 10, "boundary");

    const result = world.settleDetachedComponents();

    expect(result.components).toHaveLength(1);
    expect(result.dirtyChunkKeys.size).toBeGreaterThan(0);
    expect(world.getVoxelKind(10, 14, 10)).toBeUndefined();
    expect(world.getVoxelKind(11, 14, 10)).toBeUndefined();
    expect(world.getVoxelKind(10, 0, 10)).toBe("ground");
    expect(world.getVoxelKind(11, 0, 10)).toBe("boundary");
  });

  it("returns correct dirty chunk rebuilds after settling detached terrain", () => {
    const world = createTinyWorld([]);
    world.setVoxel(16, 14, 16, "ground");
    world.setVoxel(17, 14, 16, "ground");

    const result = world.settleDetachedComponents();
    const dirtyChunkKeys = [...result.dirtyChunkKeys];
    const rebuilt = world.buildVisibleChunksForKeys(dirtyChunkKeys);
    const full = world
      .buildVisibleChunks()
      .filter((chunk) => dirtyChunkKeys.includes(chunk.key));

    expect(normalizeChunks(rebuilt)).toEqual(normalizeChunks(full));
  });
});
