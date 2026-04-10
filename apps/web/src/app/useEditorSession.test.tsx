import { act, renderHook } from "@testing-library/react";
import type { MapDocumentV1, VoxelCell } from "@out-of-bounds/map";
import { describe, expect, it, vi } from "vitest";
import { useEditorSession } from "./useEditorSession";

const createEditorArenaDocument = (): MapDocumentV1 => {
  const voxels: VoxelCell[] = [];

  for (let x = 0; x < 16; x += 1) {
    for (let z = 0; z < 16; z += 1) {
      voxels.push({ x, y: 0, z, kind: "ground" });
    }
  }

  return {
    version: 1,
    meta: {
      name: "Editor Test Arena",
      theme: "party-grass",
      createdAt: "2026-04-04T00:00:00.000Z",
      updatedAt: "2026-04-04T00:00:00.000Z"
    },
    size: { x: 16, y: 16, z: 16 },
    boundary: { fallY: -1 },
    spawns: [],
    props: [],
    waterfalls: [],
    voxels
  };
};

describe("useEditorSession", () => {
  it("places and erases tree props through the editor interaction flow", () => {
    const onStatus = vi.fn();
    const { result } = renderHook(() => useEditorSession({ onStatus }));

    act(() => {
      result.current.applyDocument(createEditorArenaDocument());
      result.current.setTool("prop");
    });

    act(() => {
      result.current.handleEditorInteract({
        voxel: { x: 8, y: 0, z: 8 },
        normal: { x: 0, y: 1, z: 0 }
      });
    });

    const placedTree = result.current.editorWorld.listProps()[0];
    expect(placedTree?.kind).toBe("tree-oak");

    act(() => {
      result.current.setTool("erase");
    });

    act(() => {
      result.current.handleEditorInteract({
        voxel: { x: placedTree!.x, y: placedTree!.y + 4, z: placedTree!.z },
        normal: { x: 0, y: 1, z: 0 }
      });
    });

    expect(result.current.editorWorld.listProps()).toHaveLength(0);
  });

  it("supports placing water blocks in the editor", () => {
    const onStatus = vi.fn();
    const { result } = renderHook(() => useEditorSession({ onStatus }));

    act(() => {
      result.current.applyDocument(createEditorArenaDocument());
      result.current.setTool("add");
      result.current.setBlockKind("water");
    });

    act(() => {
      result.current.handleEditorInteract({
        voxel: { x: 8, y: 0, z: 8 },
        normal: { x: 0, y: 1, z: 0 }
      });
    });

    expect(result.current.editorWorld.getVoxelKind(8, 1, 8)).toBe("water");
  });
});
