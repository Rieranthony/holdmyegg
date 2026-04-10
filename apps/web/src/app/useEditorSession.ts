import { useCallback, useEffect, useState } from "react";
import {
  MutableVoxelWorld,
  createDefaultArenaMap,
  normalizeArenaBudgetMapDocument,
  type BlockKind,
  type MapPropKind,
  type MapDocumentV1
} from "@out-of-bounds/map";
import type { EditorTool } from "../engine/types";

interface VoxelInteractPayload {
  voxel: {
    x: number;
    y: number;
    z: number;
  };
  normal: {
    x: number;
    y: number;
    z: number;
  };
}

interface UseEditorSessionOptions {
  onStatus: (message: string) => void;
}

export const blockKindOptions: BlockKind[] = ["ground", "boundary", "hazard", "water"];
export const propKindOptions: MapPropKind[] = ["tree-oak", "tree-pine", "tree-autumn"];

export function useEditorSession({ onStatus }: UseEditorSessionOptions) {
  const [editorWorld, setEditorWorld] = useState(() => new MutableVoxelWorld(createDefaultArenaMap()));
  const [editorRevision, setEditorRevision] = useState(0);
  const [editorDirtyChunkKeys, setEditorDirtyChunkKeys] = useState<string[]>([]);
  const [tool, setTool] = useState<EditorTool>("add");
  const [blockKind, setBlockKind] = useState<BlockKind>("ground");
  const [propKind, setPropKind] = useState<MapPropKind>("tree-oak");
  const [mapName, setMapName] = useState(editorWorld.meta.name);

  useEffect(() => {
    setMapName(editorWorld.meta.name);
  }, [editorWorld]);

  const setEditorMapName = useCallback(
    (nextName: string) => {
      const trimmed = nextName.trimStart();
      editorWorld.meta.name = trimmed || "Untitled Arena";
      editorWorld.touchMeta();
      setMapName(nextName);
    },
    [editorWorld]
  );

  const applyDocument = useCallback((document: MapDocumentV1) => {
    const nextWorld = new MutableVoxelWorld(normalizeArenaBudgetMapDocument(document));
    nextWorld.settleDetachedComponents();
    setEditorWorld(nextWorld);
    setEditorRevision(0);
    setEditorDirtyChunkKeys([]);
  }, []);

  const createFreshArena = useCallback(() => {
    applyDocument(createDefaultArenaMap());
  }, [applyDocument]);

  const handleEditorInteract = useCallback(
    ({ voxel, normal }: VoxelInteractPayload) => {
      let dirtyChunkKeys: string[] = [];
      let touchedTerrain = false;

      if (tool === "erase") {
        const prop = editorWorld.getPropAtVoxel(voxel.x, voxel.y, voxel.z);
        if (prop) {
          editorWorld.removeProp(prop.id);
          onStatus("Removed a tree.");
        } else {
          dirtyChunkKeys = [...editorWorld.removeVoxel(voxel.x, voxel.y, voxel.z)];
          touchedTerrain = dirtyChunkKeys.length > 0;
        }
      } else if (tool === "add") {
        const placement = {
          x: voxel.x + normal.x,
          y: voxel.y + normal.y,
          z: voxel.z + normal.z
        };
        if (editorWorld.hasOccupiedVoxel(placement.x, placement.y, placement.z)) {
          onStatus("That space is already occupied.");
        } else {
          dirtyChunkKeys = [...editorWorld.setVoxel(placement.x, placement.y, placement.z, blockKind)];
          touchedTerrain = dirtyChunkKeys.length > 0;
        }
      } else if (tool === "prop") {
        const placement = editorWorld.getEditablePropPlacement(propKind, voxel.x, voxel.z);
        if (!placement) {
          onStatus("Tree placement is blocked on that column.");
        } else {
          editorWorld.setProp(propKind, placement.x, placement.y, placement.z);
          onStatus("Placed a tree.");
        }
      } else {
        const spawn = editorWorld.getEditableSpawnPosition(voxel.x, voxel.z);
        editorWorld.setSpawn(spawn.x, spawn.y, spawn.z);
        onStatus("Placed a nest spawn.");
      }

      if (touchedTerrain) {
        const settleResult = editorWorld.settleDetachedComponents();
        dirtyChunkKeys = [...new Set([...dirtyChunkKeys, ...settleResult.dirtyChunkKeys])];
        const removedProps = editorWorld.pruneUnsupportedPropsAtColumns();

        if (settleResult.components.length > 0) {
          onStatus("Detached terrain settled into place.");
        }

        if (removedProps.length > 0) {
          onStatus(
            removedProps.length === 1
              ? "A floating tree was removed."
              : "Floating trees were removed."
          );
        }
      }

      if (touchedTerrain && dirtyChunkKeys.length > 0) {
        onStatus(`${tool === "add" ? "Added" : "Removed"} cubes in the arena.`);
      }

      setEditorDirtyChunkKeys(dirtyChunkKeys);
      setEditorRevision((value) => value + 1);
    },
    [blockKind, editorWorld, onStatus, propKind, tool]
  );

  return {
    editorWorld,
    editorRevision,
    editorDirtyChunkKeys,
    tool,
    setTool,
    blockKind,
    setBlockKind,
    propKind,
    setPropKind,
    mapName,
    setEditorMapName,
    applyDocument,
    createFreshArena,
    handleEditorInteract
  };
}
