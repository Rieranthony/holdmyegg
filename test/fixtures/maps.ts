import {
  DEFAULT_BOUNDARY_HEIGHT,
  DEFAULT_FOUNDATION_DEPTH,
  DEFAULT_SURFACE_Y,
  MutableVoxelWorld,
  cloneMapDocument,
  type MapDocumentV1,
  type VoxelCell
} from "@out-of-bounds/map";

const TEST_ARENA_SIZE = {
  x: 48,
  y: 24,
  z: 48
};

let cachedTestArenaTemplate: MapDocumentV1 | null = null;

const buildTestArenaTemplate = (): MapDocumentV1 => {
  const voxels: VoxelCell[] = [];

  for (let x = 0; x < TEST_ARENA_SIZE.x; x += 1) {
    for (let z = 0; z < TEST_ARENA_SIZE.z; z += 1) {
      for (let y = 0; y < DEFAULT_FOUNDATION_DEPTH; y += 1) {
        voxels.push({ x, y, z, kind: "ground" });
      }
    }
  }

  for (let x = 0; x < TEST_ARENA_SIZE.x; x += 1) {
    for (let height = DEFAULT_SURFACE_Y; height < DEFAULT_SURFACE_Y + DEFAULT_BOUNDARY_HEIGHT; height += 1) {
      voxels.push({ x, y: height, z: 0, kind: "boundary" });
      voxels.push({ x, y: height, z: TEST_ARENA_SIZE.z - 1, kind: "boundary" });
    }
  }

  for (let z = 1; z < TEST_ARENA_SIZE.z - 1; z += 1) {
    for (let height = DEFAULT_SURFACE_Y; height < DEFAULT_SURFACE_Y + DEFAULT_BOUNDARY_HEIGHT; height += 1) {
      voxels.push({ x: 0, y: height, z, kind: "boundary" });
      voxels.push({ x: TEST_ARENA_SIZE.x - 1, y: height, z, kind: "boundary" });
    }
  }

  return {
    version: 1,
    meta: {
      name: "Test Arena",
      description: "Compact fixture arena for deterministic simulation tests.",
      theme: "party-grass",
      createdAt: "2026-04-04T00:00:00.000Z",
      updatedAt: "2026-04-04T00:00:00.000Z"
    },
    size: TEST_ARENA_SIZE,
    boundary: {
      fallY: -1
    },
    spawns: [
      { id: "spawn-1", x: 10.5, y: DEFAULT_SURFACE_Y + 0.05, z: 10.5 },
      { id: "spawn-2", x: 37.5, y: DEFAULT_SURFACE_Y + 0.05, z: 10.5 },
      { id: "spawn-3", x: 10.5, y: DEFAULT_SURFACE_Y + 0.05, z: 37.5 },
      { id: "spawn-4", x: 37.5, y: DEFAULT_SURFACE_Y + 0.05, z: 37.5 }
    ],
    props: [],
    voxels
  };
};

export const createArenaDocument = (mutate?: (world: MutableVoxelWorld) => void) => {
  cachedTestArenaTemplate ??= buildTestArenaTemplate();
  const world = new MutableVoxelWorld(cloneMapDocument(cachedTestArenaTemplate));
  mutate?.(world);
  return world.toDocument();
};
