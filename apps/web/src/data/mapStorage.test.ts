import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import type { MapDocumentV1 } from "@out-of-bounds/map";
import { createMapStorage } from "./mapStorage";

const createTinyMap = (name: string): MapDocumentV1 => ({
  version: 1,
  meta: {
    name,
    theme: "party-grass",
    createdAt: "2026-04-04T00:00:00.000Z",
    updatedAt: "2026-04-04T00:00:00.000Z"
  },
  size: { x: 8, y: 8, z: 8 },
  boundary: { fallY: -1 },
  spawns: [{ id: "spawn-1", x: 2.5, y: 1.05, z: 2.5 }],
  props: [],
  waterfalls: [],
  voxels: [{ x: 2, y: 0, z: 2, kind: "ground" }]
});

describe("createMapStorage", () => {
  it("saves, loads, sorts, and deletes map records", async () => {
    const storage = createMapStorage({
      databaseName: `out-of-bounds-test-${crypto.randomUUID()}`
    });

    const alpha = createTinyMap("Arena Alpha");
    const beta = createTinyMap("Arena Beta");

    await storage.saveMap(alpha, "alpha");
    await new Promise((resolve) => setTimeout(resolve, 10));
    await storage.saveMap(beta, "beta");

    expect((await storage.listSavedMaps()).map((entry) => entry.id)).toEqual(["beta", "alpha"]);
    expect((await storage.loadSavedMap("alpha"))?.document.meta.name).toBe("Arena Alpha");

    await storage.deleteSavedMap("alpha");
    expect(await storage.loadSavedMap("alpha")).toBeUndefined();
  });
});
