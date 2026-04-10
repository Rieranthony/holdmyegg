import {
  MutableVoxelWorld,
  createDefaultArenaMap,
  type MapDocumentV1,
  type VoxelCell
} from "@out-of-bounds/map";
import { describe, expect, it } from "vitest";
import { buildSurfaceDecorations } from "./surfaceDecorations";

const getDecorationSpacing = (kind: string) =>
  kind === "grass" ? 1.6 : kind.startsWith("bush-") ? 2.42 : 2.02;
const isFlowerDecoration = (kind: string) => kind.startsWith("flower-");
const isBushDecoration = (kind: string) => kind.startsWith("bush-");

const createFlatArenaDocument = (): MapDocumentV1 => {
  const voxels: VoxelCell[] = [];

  for (let x = 0; x < 20; x += 1) {
    for (let z = 0; z < 20; z += 1) {
      voxels.push({ x, y: 0, z, kind: "ground" });
    }
  }

  return {
    version: 1,
    meta: {
      name: "Decoration Test Arena",
      theme: "party-grass",
      createdAt: "2026-04-04T00:00:00.000Z",
      updatedAt: "2026-04-04T00:00:00.000Z"
    },
    size: { x: 20, y: 12, z: 20 },
    boundary: { fallY: -1 },
    spawns: [{ id: "spawn-1", x: 2.5, y: 1.05, z: 2.5 }],
    props: [{ id: "prop-1", kind: "tree-oak", x: 12, y: 1, z: 12 }],
    waterfalls: [],
    voxels
  };
};

describe("buildSurfaceDecorations", () => {
  it("is deterministic and avoids spawn and tree footprints", () => {
    const world = new MutableVoxelWorld(createFlatArenaDocument());

    const first = buildSurfaceDecorations(world);
    const second = buildSurfaceDecorations(world);

    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(0);
    expect(first.some((decoration) => Math.floor(decoration.x) === 2 && Math.floor(decoration.z) === 2)).toBe(false);
    expect(first.some((decoration) => Math.floor(decoration.x) >= 11 && Math.floor(decoration.x) <= 13 && Math.floor(decoration.z) >= 11 && Math.floor(decoration.z) <= 13)).toBe(false);
    expect(
      first.every((decoration, index) =>
        first.slice(index + 1).every((other) =>
          Math.hypot(decoration.x - other.x, decoration.z - other.z) >=
          Math.max(getDecorationSpacing(decoration.kind), getDecorationSpacing(other.kind))
        )
      )
    ).toBe(true);
  });

  it("keeps flowers off water-covered columns and produces a healthier flower mix", () => {
    const document = createFlatArenaDocument();
    document.voxels.push({ x: 5, y: 1, z: 5, kind: "water" });
    document.voxels.push({ x: 5, y: 2, z: 5, kind: "water" });
    const world = new MutableVoxelWorld(document);
    const decorations = buildSurfaceDecorations(world);
    const flowerDecorations = decorations.filter((decoration) => isFlowerDecoration(decoration.kind));
    const flowerCount = flowerDecorations.length;
    const flowerKinds = new Set(flowerDecorations.map((decoration) => decoration.kind));

    expect(decorations.some((decoration) => Math.floor(decoration.x) === 5 && Math.floor(decoration.z) === 5)).toBe(false);
    expect(flowerCount).toBeGreaterThan(0);
    expect(flowerCount / decorations.length).toBeGreaterThan(0.18);
    expect(flowerCount / decorations.length).toBeLessThan(0.5);
    expect(flowerKinds.size).toBeGreaterThanOrEqual(2);
  });

  it("adds visible flower patches to the default arena", () => {
    const world = new MutableVoxelWorld(createDefaultArenaMap());
    const decorations = buildSurfaceDecorations(world);
    const flowerDecorations = decorations.filter((decoration) => isFlowerDecoration(decoration.kind));
    const bushDecorations = decorations.filter((decoration) => isBushDecoration(decoration.kind));

    expect(decorations.length).toBeGreaterThan(120);
    expect(flowerDecorations.length).toBeGreaterThan(24);
    expect(bushDecorations.length).toBeGreaterThan(12);
    expect(flowerDecorations.length + bushDecorations.length).toBeGreaterThan(45);
    expect(new Set(flowerDecorations.map((decoration) => decoration.kind)).size).toBeGreaterThanOrEqual(4);
  });
});
