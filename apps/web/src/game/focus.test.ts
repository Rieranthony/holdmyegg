import { describe, expect, it } from "vitest";
import { emptyFocusState, getFocusVisualState, resolveVoxelFocusState } from "./focus";

describe("resolveVoxelFocusState", () => {
  it("accepts in-range harvest targets and resolves placement to the adjacent face", () => {
    const focusState = resolveVoxelFocusState({
      hitVoxel: { x: 8, y: 1, z: 6 },
      hitNormal: { x: 0, y: 1, z: 0 },
      hitKind: "ground",
      worldSize: { x: 48, y: 12, z: 48 },
      playerChest: { x: 6.5, y: 2.2, z: 6.5 },
      interactRange: 4.5,
      placementOccupied: false,
      blockedByPlayer: false,
      blockedByDebris: false
    });

    expect(focusState.focusedVoxel).toEqual({ x: 8, y: 1, z: 6 });
    expect(focusState.placeVoxel).toEqual({ x: 8, y: 2, z: 6 });
    expect(focusState.destroyValid).toBe(true);
    expect(focusState.placeValid).toBe(true);
  });

  it("rejects out-of-range targets even when the camera ray hits them", () => {
    const focusState = resolveVoxelFocusState({
      hitVoxel: { x: 15, y: 1, z: 6 },
      hitNormal: { x: 0, y: 1, z: 0 },
      hitKind: "ground",
      worldSize: { x: 48, y: 12, z: 48 },
      playerChest: { x: 6.5, y: 2.2, z: 6.5 },
      interactRange: 4.5,
      placementOccupied: false,
      blockedByPlayer: false,
      blockedByDebris: false
    });

    expect(focusState.destroyValid).toBe(false);
    expect(focusState.placeValid).toBe(false);
    expect(focusState.invalidReason).toBe("outOfRange");
  });

  it("keeps hazards focusable while blocking harvesting mass from them", () => {
    const focusState = resolveVoxelFocusState({
      hitVoxel: { x: 16, y: 1, z: 24 },
      hitNormal: { x: 1, y: 0, z: 0 },
      hitKind: "hazard",
      worldSize: { x: 48, y: 12, z: 48 },
      playerChest: { x: 15.4, y: 2.2, z: 24.5 },
      interactRange: 4.5,
      placementOccupied: false,
      blockedByPlayer: false,
      blockedByDebris: false
    });

    expect(focusState.destroyValid).toBe(false);
    expect(focusState.placeValid).toBe(true);
  });

  it("reports placement blockers for occupied cells and player bodies", () => {
    const occupied = resolveVoxelFocusState({
      hitVoxel: { x: 8, y: 0, z: 6 },
      hitNormal: { x: 0, y: 1, z: 0 },
      hitKind: "ground",
      worldSize: { x: 48, y: 12, z: 48 },
      playerChest: { x: 6.5, y: 2.2, z: 6.5 },
      interactRange: 4.5,
      placementOccupied: true,
      blockedByPlayer: false,
      blockedByDebris: false
    });
    expect(occupied.placeValid).toBe(false);
    expect(occupied.invalidReason).toBe("occupied");

    const blockedByPlayer = resolveVoxelFocusState({
      hitVoxel: { x: 9, y: 0, z: 6 },
      hitNormal: { x: 0, y: 1, z: 0 },
      hitKind: "ground",
      worldSize: { x: 48, y: 12, z: 48 },
      playerChest: { x: 6.5, y: 2.2, z: 6.5 },
      interactRange: 4.5,
      placementOccupied: false,
      blockedByPlayer: true,
      blockedByDebris: false
    });
    expect(blockedByPlayer.placeValid).toBe(false);
    expect(blockedByPlayer.invalidReason).toBe("blockedByPlayer");
  });
});

describe("getFocusVisualState", () => {
  it("returns a readable invalid palette for blocked focus", () => {
    const visual = getFocusVisualState({
      focusedVoxel: { x: 8, y: 0, z: 6 },
      targetNormal: { x: 0, y: 1, z: 0 },
      placeVoxel: { x: 8, y: 1, z: 6 },
      destroyValid: false,
      placeValid: false,
      invalidReason: "occupied"
    });

    expect(visual.reticleColor).toBe("#ef6f64");
    expect(visual.ghostColor).toBe("#ef6f64");
  });

  it("keeps empty focus neutral and non-blocking", () => {
    const visual = getFocusVisualState(emptyFocusState());
    expect(visual.ghostOpacity).toBeGreaterThan(0);
  });
});
