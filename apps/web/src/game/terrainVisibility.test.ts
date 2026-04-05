import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { countFrustumVisibleTerrainChunks, createTerrainChunkBounds } from "./terrainVisibility";

describe("terrainVisibility", () => {
  it("creates world-space chunk bounds from local geometry bounds", () => {
    const geometry = new THREE.BoxGeometry(2, 2, 2);
    const bounds = createTerrainChunkBounds(geometry, [10, 4, -6]);

    expect(bounds.min.toArray()).toEqual([9, 3, -7]);
    expect(bounds.max.toArray()).toEqual([11, 5, -5]);
  });

  it("drops the frustum-visible chunk count when the camera turns away from terrain", () => {
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200);
    const frontChunk = new THREE.Box3(new THREE.Vector3(-4, -4, -30), new THREE.Vector3(4, 4, -20));
    const sideChunk = new THREE.Box3(new THREE.Vector3(60, -4, -5), new THREE.Vector3(70, 4, 5));

    camera.position.set(0, 8, 0);
    camera.lookAt(new THREE.Vector3(0, 8, -40));
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);

    expect(countFrustumVisibleTerrainChunks([frontChunk, sideChunk], camera)).toBe(1);

    camera.lookAt(new THREE.Vector3(0, 8, 40));
    camera.updateMatrixWorld(true);

    expect(countFrustumVisibleTerrainChunks([frontChunk, sideChunk], camera)).toBe(0);
  });
});
