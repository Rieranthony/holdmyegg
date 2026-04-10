import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MutableVoxelWorld, createDefaultArenaMap } from "@out-of-bounds/map";

const buildSurfaceDecorationsMock = vi.hoisted(() => vi.fn(() => []));

vi.mock("../game/surfaceDecorations", async () => {
  const actual = await vi.importActual<typeof import("../game/surfaceDecorations")>("../game/surfaceDecorations");
  return {
    ...actual,
    buildSurfaceDecorations: buildSurfaceDecorationsMock
  };
});

vi.mock("./StaticInstancedMesh", () => ({
  StaticInstancedMesh: () => null
}));

import { WorldPropsLayer } from "./WorldProps";

const createWorld = () => new MutableVoxelWorld(createDefaultArenaMap());

describe("WorldPropsLayer", () => {
  beforeEach(() => {
    buildSurfaceDecorationsMock.mockClear();
  });

  it("rebuilds runtime ambience across terrain revisions", () => {
    const world = createWorld();
    const { rerender } = render(
      <WorldPropsLayer
        world={world}
        revision={0}
        updateMode="runtime-static"
      />
    );

    const initialCallCount = buildSurfaceDecorationsMock.mock.calls.length;

    const removedVoxel = world.toDocument().voxels[0]!;
    world.removeVoxel(removedVoxel.x, removedVoxel.y, removedVoxel.z);

    rerender(
      <WorldPropsLayer
        world={world}
        revision={1}
        updateMode="runtime-static"
      />
    );

    expect(buildSurfaceDecorationsMock.mock.calls.length).toBeGreaterThan(initialCallCount);
  });

  it("rebuilds props and decorations live in editor mode", () => {
    const world = createWorld();
    const { rerender } = render(
      <WorldPropsLayer
        world={world}
        revision={0}
        updateMode="editor-live"
      />
    );

    const initialCallCount = buildSurfaceDecorationsMock.mock.calls.length;

    const removedVoxel = world.toDocument().voxels[0]!;
    world.removeVoxel(removedVoxel.x, removedVoxel.y, removedVoxel.z);

    rerender(
      <WorldPropsLayer
        world={world}
        revision={1}
        updateMode="editor-live"
      />
    );

    expect(buildSurfaceDecorationsMock.mock.calls.length).toBeGreaterThan(initialCallCount);
  });
});
