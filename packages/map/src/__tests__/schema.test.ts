import { describe, expect, it } from "vitest";
import {
  MutableVoxelWorld,
  mapDocumentSchema,
  parseMapDocument,
  serializeMapDocument
} from "@out-of-bounds/map";
import type { MapDocumentV1 } from "../types";

const createTinyDocument = (): MapDocumentV1 => ({
  version: 1,
  meta: {
    name: "Schema Test Arena",
    theme: "party-grass",
    createdAt: "2026-04-04T00:00:00.000Z",
    updatedAt: "2026-04-04T00:00:00.000Z"
  },
  size: { x: 16, y: 16, z: 16 },
  boundary: { fallY: -1 },
  spawns: [{ id: "spawn-1", x: 4.5, y: 1.05, z: 4.5 }],
  props: [],
  voxels: [
    { x: 4, y: 0, z: 4, kind: "ground" },
    { x: 5, y: 0, z: 4, kind: "boundary" },
    { x: 6, y: 0, z: 4, kind: "water" }
  ]
});

describe("map schemas and serialization", () => {
  it("applies schema defaults and rejects invalid documents", () => {
    const document = createTinyDocument();
    const rawDocument = {
      ...document,
      meta: {
        ...document.meta
      }
    };
    delete (rawDocument.meta as { theme?: string }).theme;

    const parsed = mapDocumentSchema.parse(rawDocument);
    expect(parsed.meta.theme).toBe("party-grass");

    const invalidDocument = {
      ...document,
      voxels: document.voxels.map((voxel, index) =>
        index === 0 ? { ...voxel, x: -1 } : voxel
      )
    };

    expect(() => mapDocumentSchema.parse(invalidDocument)).toThrow();
  });

  it("round-trips through JSON and refreshes updatedAt after mutation", () => {
    const document = createTinyDocument();
    document.meta.updatedAt = "2000-01-01T00:00:00.000Z";

    const world = new MutableVoxelWorld(document);
    world.setVoxel(12, 3, 12, "ground");
    world.setProp("tree-oak", 10, 1, 10);

    const roundTripped = parseMapDocument(serializeMapDocument(world.toDocument()));

    expect(roundTripped.meta.updatedAt).not.toBe("2000-01-01T00:00:00.000Z");
    expect(roundTripped.props).toEqual([{ id: "prop-1", kind: "tree-oak", x: 10, y: 1, z: 10 }]);
    expect(roundTripped.voxels.some((voxel) => voxel.x === 12 && voxel.y === 3 && voxel.z === 12)).toBe(true);
    expect(roundTripped.voxels.some((voxel) => voxel.x === 6 && voxel.y === 0 && voxel.z === 4 && voxel.kind === "water")).toBe(true);
  });
});
