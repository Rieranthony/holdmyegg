import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  cloneTerrainChunkMaterials,
  getBlockRenderProfile,
  getTerrainChunkMaterials,
  getTerrainMaterialIndex,
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
    expect(terrainMaterialsByKey.waterTop.map).toBe(voxelTextures.waterTop);
    expect(terrainMaterialsByKey.waterSide.map).toBe(voxelTextures.waterSide);
    expect(terrainMaterialsByKey.waterTop.transparent).toBe(true);
    expect(terrainMaterialsByKey.waterSide.transparent).toBe(true);
    expect(terrainMaterialsByKey.waterTop.depthWrite).toBe(false);
    expect(terrainMaterialsByKey.waterSide.depthWrite).toBe(false);
  });

  it("clones terrain chunk materials for chamber rendering without mutating the shared terrain set", () => {
    const baseMaterials = getTerrainChunkMaterials();
    const clones = cloneTerrainChunkMaterials();

    expect(clones).toHaveLength(terrainMaterialOrder.length);
    clones.forEach((material: THREE.MeshStandardMaterial, index: number) => {
      expect(material).toBeInstanceOf(THREE.MeshStandardMaterial);
      expect(material).not.toBe(baseMaterials[index]);
      expect(material.map).toBe(baseMaterials[index]?.map ?? null);
      expect(material.transparent).toBe(baseMaterials[index]?.transparent ?? false);
      expect(material.opacity).toBe(baseMaterials[index]?.opacity ?? 1);
      expect(material.depthWrite).toBe(baseMaterials[index]?.depthWrite ?? true);
    });
  });
});
