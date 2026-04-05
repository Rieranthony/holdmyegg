import { describe, expect, it } from "vitest";
import { birdPresets, getSkyBirdPose } from "./birds";

describe("birds", () => {
  it("keeps decorative bird poses within a stable orbit above the arena", () => {
    const worldSize = { x: 80, y: 32, z: 80 };
    const pose = getSkyBirdPose(birdPresets[0]!, 12, worldSize);

    expect(pose.position.x).toBeGreaterThan(0);
    expect(pose.position.x).toBeLessThan(worldSize.x);
    expect(pose.position.z).toBeGreaterThan(0);
    expect(pose.position.z).toBeLessThan(worldSize.z);
    expect(pose.position.y).toBeGreaterThan(19);
    expect(pose.position.y).toBeLessThan(26);
    expect(pose.flapAmount).toBeGreaterThanOrEqual(0);
    expect(pose.flapAmount).toBeLessThanOrEqual(1);
  });

  it("changes yaw as birds move along their looping path", () => {
    const worldSize = { x: 80, y: 32, z: 80 };
    const before = getSkyBirdPose(birdPresets[1]!, 2, worldSize);
    const after = getSkyBirdPose(birdPresets[1]!, 6, worldSize);

    expect(before.yaw).not.toBe(after.yaw);
  });
});
