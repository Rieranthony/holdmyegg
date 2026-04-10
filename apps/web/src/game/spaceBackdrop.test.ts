import { describe, expect, it } from "vitest";
import {
  SPACE_STAR_COUNT,
  buildVoxelPlanetMatrices,
  createSpaceStarGeometry,
  spacePlanetDescriptors
} from "./spaceBackdrop";

describe("spaceBackdrop", () => {
  it("creates a fixed-size star geometry", () => {
    const geometry = createSpaceStarGeometry();
    const positions = geometry.getAttribute("position");

    expect(positions.count).toBe(SPACE_STAR_COUNT);

    geometry.dispose();
  });

  it("builds stable voxel planet matrix buckets", () => {
    const first = buildVoxelPlanetMatrices(spacePlanetDescriptors[0]!);
    const second = buildVoxelPlanetMatrices(spacePlanetDescriptors[0]!);

    expect(first.mainMatrices).toHaveLength(second.mainMatrices.length);
    expect(first.shadeMatrices).toHaveLength(second.shadeMatrices.length);
    expect(first.mainMatrices[0]?.elements).toEqual(second.mainMatrices[0]?.elements);
  });

  it("adds accent land voxels for the far blue-green planet", () => {
    const farPlanet = buildVoxelPlanetMatrices(spacePlanetDescriptors[3]!);

    expect(farPlanet.accentMatrices.length).toBeGreaterThan(0);
    expect(farPlanet.mainMatrices.length).toBeGreaterThan(0);
    expect(farPlanet.shadeMatrices.length).toBeGreaterThan(0);
  });
});
