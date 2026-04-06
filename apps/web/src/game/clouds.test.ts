import { describe, expect, it } from "vitest";
import { cloudPresets, getVoxelCloudPosition, wrapSkyCoordinate } from "./clouds";

describe("clouds", () => {
  it("builds non-empty voxel cloud presets", () => {
    expect(cloudPresets).toHaveLength(9);
    for (const preset of cloudPresets) {
      expect(preset.cubes.length).toBeGreaterThan(0);
    }
  });

  it("wraps drifting clouds back across the arena sky", () => {
    expect(wrapSkyCoordinate(110, 80)).toBeLessThanOrEqual(106);
    expect(wrapSkyCoordinate(-40, 80)).toBeGreaterThanOrEqual(-26);
  });

  it("keeps voxel cloud motion decorative and above the arena", () => {
    const worldSize = { x: 80, y: 32, z: 80 };
    const position = getVoxelCloudPosition(cloudPresets[0]!, 180, worldSize);
    const highestCloud = getVoxelCloudPosition(cloudPresets[8]!, 180, worldSize);

    expect(position.y).toBeGreaterThan(20);
    expect(position.y).toBeLessThan(28);
    expect(highestCloud.y).toBeGreaterThan(33);
    expect(highestCloud.y).toBeLessThan(38);
    expect(position.x).toBeGreaterThanOrEqual(-26);
    expect(position.x).toBeLessThanOrEqual(worldSize.x + 26);
  });
});
