import { getMapPropVoxels } from "@out-of-bounds/map";
import { describe, expect, it } from "vitest";

describe("map props", () => {
  it("varies tree canopies deterministically by position", () => {
    const leftTree = getMapPropVoxels({ kind: "tree-oak", x: 10, y: 5, z: 10 });
    const rightTree = getMapPropVoxels({ kind: "tree-oak", x: 11, y: 5, z: 10 });

    expect(leftTree).not.toEqual(rightTree);
    expect(getMapPropVoxels({ kind: "tree-oak", x: 10, y: 5, z: 10 })).toEqual(leftTree);
  });

  it("builds distinct deterministic silhouettes for pine and autumn trees", () => {
    const pine = getMapPropVoxels({ kind: "tree-pine", x: 14, y: 4, z: 14 });
    const autumn = getMapPropVoxels({ kind: "tree-autumn", x: 14, y: 4, z: 14 });

    expect(pine).not.toEqual(autumn);
    expect(getMapPropVoxels({ kind: "tree-pine", x: 14, y: 4, z: 14 })).toEqual(pine);
    expect(getMapPropVoxels({ kind: "tree-autumn", x: 14, y: 4, z: 14 })).toEqual(autumn);
  });
});
