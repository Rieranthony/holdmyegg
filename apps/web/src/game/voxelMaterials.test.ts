import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  getBlockRenderProfile,
  getTerrainChunkMaterials,
  getTerrainMaterialIndex,
  getVoxelMaterials,
  terrainMaterialOrder,
  terrainMaterialsByKey,
  voxelTextures
} from "./voxelMaterials";

describe("voxelMaterials", () => {
  it("creates tiny nearest-neighbor pixel textures", () => {
    expect(voxelTextures.earthTop).toBeInstanceOf(THREE.DataTexture);
    expect(voxelTextures.earthTop.image.width).toBe(16);
    expect(voxelTextures.earthTop.image.height).toBe(16);
    expect(voxelTextures.earthTop.magFilter).toBe(THREE.NearestFilter);
    expect(voxelTextures.earthTop.minFilter).toBe(THREE.NearestFilter);
    expect(voxelTextures.earthTop.generateMipmaps).toBe(false);
  });

  it("maps underground voxels to dirt-only materials and hazards to darkness", () => {
    expect(getBlockRenderProfile("ground", 3)).toBe("earthSubsoil");
    expect(getBlockRenderProfile("boundary", 4)).toBe("earthSurface");
    expect(getBlockRenderProfile("ground", 10)).toBe("earthSurface");
    expect(getBlockRenderProfile("ground", 1, 0)).toBe("earthSurface");
    expect(getBlockRenderProfile("ground", 10, 2)).toBe("earthSubsoil");
    expect(getBlockRenderProfile("hazard", 10)).toBe("darkness");
  });

  it("keeps terrain materials in a stable grouped-material order", () => {
    expect(terrainMaterialOrder).toEqual([
      "earthSurfaceTop",
      "earthSurfaceSide",
      "earthSurfaceBottom",
      "earthSubsoil",
      "darkness",
      "waterTop",
      "waterSide"
    ]);
    expect(getTerrainMaterialIndex("earthSurfaceTop")).not.toBe(getTerrainMaterialIndex("earthSurfaceSide"));
    expect(getTerrainMaterialIndex("earthSubsoil")).not.toBe(getTerrainMaterialIndex("darkness"));
    expect(getTerrainMaterialIndex("waterTop")).not.toBe(getTerrainMaterialIndex("waterSide"));
  });

  it("exposes textured transient voxel materials that do not require vertex colors", () => {
    const earthSurfaceMaterials = getVoxelMaterials("earthSurface");
    const earthSubsoilMaterials = getVoxelMaterials("earthSubsoil");
    const darknessMaterials = getVoxelMaterials("darkness");

    expect(earthSurfaceMaterials).toHaveLength(6);
    expect(earthSubsoilMaterials).toHaveLength(6);
    expect(darknessMaterials).toHaveLength(6);

    for (const material of [...earthSurfaceMaterials, ...earthSubsoilMaterials, ...darknessMaterials]) {
      expect(material).toBeInstanceOf(THREE.MeshStandardMaterial);
      expect(material.vertexColors).toBe(false);
    }

    expect(earthSurfaceMaterials[0]?.map).toBe(voxelTextures.earthSide);
    expect(earthSurfaceMaterials[1]?.map).toBe(voxelTextures.earthSide);
    expect(earthSurfaceMaterials[2]?.map).toBe(voxelTextures.earthTop);
    expect(earthSurfaceMaterials[3]?.map).toBe(voxelTextures.earthBottom);
    expect(earthSurfaceMaterials[4]?.map).toBe(voxelTextures.earthSide);
    expect(earthSurfaceMaterials[5]?.map).toBe(voxelTextures.earthSide);
    expect(earthSubsoilMaterials.every((material) => material.map === voxelTextures.earthBottom)).toBe(true);
    expect(darknessMaterials.every((material) => material.map === voxelTextures.darkness)).toBe(true);
  });

  it("exposes grouped standard materials for stable terrain rendering", () => {
    const terrainMaterials = getTerrainChunkMaterials();

    expect(terrainMaterials).toHaveLength(terrainMaterialOrder.length);
    for (const material of terrainMaterials) {
      expect(material).toBeInstanceOf(THREE.MeshStandardMaterial);
    }

    expect(terrainMaterialsByKey.earthSurfaceTop.map).toBe(voxelTextures.earthTop);
    expect(terrainMaterialsByKey.earthSurfaceSide.map).toBe(voxelTextures.earthSide);
    expect(terrainMaterialsByKey.earthSurfaceBottom.map).toBe(voxelTextures.earthBottom);
    expect(terrainMaterialsByKey.earthSubsoil.map).toBe(voxelTextures.earthBottom);
    expect(terrainMaterialsByKey.darkness.map).toBe(voxelTextures.darkness);
    expect(terrainMaterialsByKey.earthSurfaceTop.vertexColors).toBe(true);
    expect(terrainMaterialsByKey.earthSurfaceSide.vertexColors).toBe(true);
    expect(terrainMaterialsByKey.earthSubsoil.vertexColors).toBe(true);
    expect(terrainMaterialsByKey.waterTop.map).toBe(voxelTextures.waterTop);
    expect(terrainMaterialsByKey.waterSide.map).toBe(voxelTextures.waterSide);
    expect(terrainMaterialsByKey.waterTop.transparent).toBe(true);
    expect(terrainMaterialsByKey.waterSide.transparent).toBe(true);
    expect(terrainMaterialsByKey.waterTop.depthWrite).toBe(false);
    expect(terrainMaterialsByKey.waterSide.depthWrite).toBe(false);
  });
});
