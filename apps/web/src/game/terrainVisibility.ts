import * as THREE from "three";

type ChunkPosition = readonly [number, number, number];

export const createTerrainChunkBounds = (geometry: THREE.BufferGeometry, position: ChunkPosition) => {
  if (!geometry.boundingBox) {
    geometry.computeBoundingBox();
  }

  const bounds = geometry.boundingBox?.clone() ?? new THREE.Box3();
  return bounds.translate(new THREE.Vector3(position[0], position[1], position[2]));
};

export const countFrustumVisibleTerrainChunks = (chunkBounds: readonly THREE.Box3[], camera: THREE.Camera) => {
  if (chunkBounds.length === 0) {
    return 0;
  }

  camera.updateMatrixWorld();
  const projectionMatrix = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const frustum = new THREE.Frustum().setFromProjectionMatrix(projectionMatrix);
  let visibleChunkCount = 0;

  for (const bounds of chunkBounds) {
    if (frustum.intersectsBox(bounds)) {
      visibleChunkCount += 1;
    }
  }

  return visibleChunkCount;
};
