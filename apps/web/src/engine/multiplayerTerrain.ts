import {
  DEFAULT_CHUNK_SIZE,
  MutableVoxelWorld,
  type MapDocumentV1
} from "@out-of-bounds/map";
import type { TerrainDeltaBatch } from "@out-of-bounds/sim";
import { meshTerrainChunk } from "../game/terrainMesher";
import type { TerrainChunkPatchPayload } from "./types";

const mergeDirtyKeys = (target: Set<string>, next: Iterable<string>) => {
  for (const key of next) {
    target.add(key);
  }
};

export const buildTerrainChunkPatch = (
  world: MutableVoxelWorld,
  key: string
): TerrainChunkPatchPayload => {
  const chunk = world.buildVisibleChunkByKey(key, DEFAULT_CHUNK_SIZE);
  if (!chunk) {
    return {
      key,
      position: [0, 0, 0],
      materialGroups: [],
      visibleVoxelCount: 0,
      triangleCount: 0,
      drawCallCount: 0,
      remove: true
    };
  }

  const meshData = meshTerrainChunk(chunk);
  return {
    key,
    position: [meshData.chunkOffset.x, meshData.chunkOffset.y, meshData.chunkOffset.z],
    materialGroups: meshData.materialGroups.map((group) => ({
      materialIndex: group.materialIndex,
      start: group.start,
      count: group.count
    })),
    visibleVoxelCount: meshData.visibleVoxelCount,
    triangleCount: meshData.triangleCount,
    drawCallCount: meshData.drawCallCount,
    positions: new Float32Array(meshData.positions),
    normals: new Float32Array(meshData.normals),
    uvs: new Float32Array(meshData.uvs),
    colors: new Float32Array(meshData.colors),
    indices: new Uint32Array(meshData.indices)
  };
};

export const applyTerrainDeltaBatchToWorld = (
  world: MutableVoxelWorld,
  batch: TerrainDeltaBatch
): {
  document: MapDocumentV1;
  patches: TerrainChunkPatchPayload[];
} => {
  const dirtyChunkKeys = new Set<string>();
  for (const change of batch.changes) {
    if (change.operation === "remove" || change.kind === null) {
      mergeDirtyKeys(
        dirtyChunkKeys,
        world.removeVoxel(change.voxel.x, change.voxel.y, change.voxel.z)
      );
      continue;
    }

    mergeDirtyKeys(
      dirtyChunkKeys,
      world.setVoxel(change.voxel.x, change.voxel.y, change.voxel.z, change.kind)
    );
  }

  return {
    document: world.toDocument(),
    patches: [...dirtyChunkKeys].map((key) => buildTerrainChunkPatch(world, key))
  };
};
