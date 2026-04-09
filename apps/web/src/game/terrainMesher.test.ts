import { createDefaultArenaMap, MutableVoxelWorld } from "@out-of-bounds/map";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { buildTerrainChunkGeometry, getTerrainChunkMaterials, meshTerrainChunk } from "./terrainMesher";
import { terrainMaterialOrder } from "./voxelMaterials";

const createTinyWorld = (voxels: Array<{ x: number; y: number; z: number; kind: "ground" | "boundary" | "hazard" | "water" }>) =>
  new MutableVoxelWorld({
    version: 1,
    meta: {
      name: "Tiny Mesher Arena",
      theme: "party-grass",
      createdAt: "2026-04-04T00:00:00.000Z",
      updatedAt: "2026-04-04T00:00:00.000Z"
    },
    size: { x: 32, y: 16, z: 16 },
    boundary: { fallY: -1 },
    spawns: [],
    props: [],
    voxels
  });

const meshSingleChunk = (voxels: Parameters<typeof createTinyWorld>[0]) => {
  const world = createTinyWorld(voxels);
  const chunk = world.buildVisibleChunks()[0];
  expect(chunk).toBeDefined();
  return meshTerrainChunk(chunk!);
};

describe("meshTerrainChunk", () => {
  it("greedy-merges a 2x2 floor into one top quad, one bottom quad, and four side strips", () => {
    const mesh = meshSingleChunk([
      { x: 1, y: 1, z: 1, kind: "ground" },
      { x: 2, y: 1, z: 1, kind: "ground" },
      { x: 1, y: 1, z: 2, kind: "ground" },
      { x: 2, y: 1, z: 2, kind: "ground" }
    ]);

    const topQuads = mesh.quads.filter((quad) => quad.face === "posY");
    const bottomQuads = mesh.quads.filter((quad) => quad.face === "negY");

    expect(mesh.quadCount).toBe(6);
    expect(mesh.triangleCount).toBe(12);
    expect(mesh.drawCallCount).toBe(1);
    expect(topQuads).toEqual([{ face: "posY", materialKey: "earthSubsoil", width: 2, height: 2 }]);
    expect(bottomQuads).toEqual([{ face: "negY", materialKey: "earthSubsoil", width: 2, height: 2 }]);
  });

  it("merges broad wall faces into single rectangles", () => {
    const mesh = meshSingleChunk([
      { x: 1, y: 1, z: 1, kind: "ground" },
      { x: 1, y: 1, z: 2, kind: "ground" },
      { x: 1, y: 2, z: 1, kind: "ground" },
      { x: 1, y: 2, z: 2, kind: "ground" }
    ]);

    const positiveXFaces = mesh.quads.filter((quad) => quad.face === "posX");
    const negativeXFaces = mesh.quads.filter((quad) => quad.face === "negX");

    expect(positiveXFaces).toEqual([{ face: "posX", materialKey: "earthSubsoil", width: 2, height: 2 }]);
    expect(negativeXFaces).toEqual([{ face: "negX", materialKey: "earthSubsoil", width: 2, height: 2 }]);
  });

  it("does not merge an L-shaped corner into a fake rectangle", () => {
    const mesh = meshSingleChunk([
      { x: 1, y: 1, z: 1, kind: "ground" },
      { x: 2, y: 1, z: 1, kind: "ground" },
      { x: 1, y: 1, z: 2, kind: "ground" }
    ]);

    const topQuads = mesh.quads.filter((quad) => quad.face === "posY");
    const topArea = topQuads.reduce((sum, quad) => sum + quad.width * quad.height, 0);

    expect(topQuads).toHaveLength(2);
    expect(topArea).toBe(3);
  });

  it("preserves holes instead of merging across them", () => {
    const ring: Parameters<typeof createTinyWorld>[0] = [];
    for (let x = 1; x <= 3; x += 1) {
      for (let z = 1; z <= 3; z += 1) {
        if (x === 2 && z === 2) {
          continue;
        }

        ring.push({ x, y: 1, z, kind: "ground" });
      }
    }

    const mesh = meshSingleChunk(ring);
    const topQuads = mesh.quads.filter((quad) => quad.face === "posY");
    const topArea = topQuads.reduce((sum, quad) => sum + quad.width * quad.height, 0);

    expect(topQuads).toHaveLength(4);
    expect(topArea).toBe(8);
  });

  it("keeps mixed material groups when a chunk spans multiple terrain profiles", () => {
    const mesh = meshSingleChunk([
      { x: 1, y: 4, z: 1, kind: "ground" },
      { x: 1, y: 5, z: 1, kind: "ground" }
    ]);

    expect(mesh.materialKeys).toContain("earthSurfaceTop");
    expect(mesh.materialKeys).toContain("earthSurfaceSide");
    expect(mesh.materialKeys).toContain("earthSurfaceBottom");
    expect(mesh.materialGroups.map((group) => group.materialKey)).toEqual([
      "earthSurfaceTop",
      "earthSurfaceSide",
      "earthSurfaceBottom"
    ]);
    expect(mesh.drawCallCount).toBe(mesh.materialGroups.length);
    expect(mesh.drawCallCount).toBe(3);
  });

  it("keeps water faces in their own transparent material groups", () => {
    const mesh = meshSingleChunk([
      { x: 1, y: 1, z: 1, kind: "ground" },
      { x: 1, y: 2, z: 1, kind: "water" }
    ]);

    expect(mesh.materialGroups.map((group) => group.materialKey)).toContain("waterTop");
    expect(mesh.materialGroups.map((group) => group.materialKey)).toContain("waterSide");
  });

  it("builds geometry groups for stable terrain materials without a tile-index shader attribute", () => {
    const mesh = meshSingleChunk([{ x: 1, y: 5, z: 1, kind: "ground" }]);
    const geometry = buildTerrainChunkGeometry(mesh);
    const materials = getTerrainChunkMaterials();

    expect(geometry.getAttribute("tileIndex")).toBeUndefined();
    expect(geometry.groups).toHaveLength(3);
    expect(geometry.groups.map((group) => terrainMaterialOrder[group.materialIndex]!)).toEqual([
      "earthSurfaceTop",
      "earthSurfaceSide",
      "earthSurfaceBottom"
    ]);
    for (const material of materials) {
      expect(material).toBeInstanceOf(THREE.MeshStandardMaterial);
    }

    geometry.dispose();
  });

  it("keeps the smaller default arena near 25 chunks while slashing terrain triangles and staying within the grouped-material draw-call budget", () => {
    const world = new MutableVoxelWorld(createDefaultArenaMap());
    const chunks = world.buildVisibleChunks();
    const meshes = chunks.map(meshTerrainChunk);
    const totalVoxels = world.toDocument().voxels.length;
    const visibleVoxels = meshes.reduce((sum, mesh) => sum + mesh.visibleVoxelCount, 0);
    const meshedTriangles = meshes.reduce((sum, mesh) => sum + mesh.triangleCount, 0);
    const drawCalls = meshes.reduce((sum, mesh) => sum + mesh.drawCallCount, 0);
    const cubeTriangles = visibleVoxels * 12;

    expect(chunks.length).toBeLessThanOrEqual(25);
    expect(totalVoxels).toBeLessThanOrEqual(45_000);
    expect(meshedTriangles).toBeLessThanOrEqual(cubeTriangles * 0.2);
    expect(drawCalls).toBeGreaterThan(chunks.length);
    expect(drawCalls).toBeLessThanOrEqual(100);
  });
});
