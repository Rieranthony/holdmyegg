import { useCallback, useRef, useState } from "react";
import { normalizeArenaBudgetMapDocument, type MapDocumentV1 } from "@out-of-bounds/map";
import { OutOfBoundsSimulation, type GameMode } from "@out-of-bounds/sim";
import type { ActiveMode } from "../components/GameCanvas";

export type AppMode = "menu" | ActiveMode;

interface UseRuntimeSessionOptions {
  onStatus: (message: string) => void;
}

export function useRuntimeSession({ onStatus }: UseRuntimeSessionOptions) {
  const runtimeRef = useRef(new OutOfBoundsSimulation());
  const [mode, setMode] = useState<AppMode>("menu");
  const [runtimeRevision, setRuntimeRevision] = useState(0);
  const [runtimeDirtyChunkKeys, setRuntimeDirtyChunkKeys] = useState<string[]>([]);
  const [playerIds, setPlayerIds] = useState<string[]>([]);
  const [sessionKey, setSessionKey] = useState(0);

  const syncFromMatchState = useCallback(() => {
    setPlayerIds([...runtimeRef.current.getPlayerIds()]);
    setRuntimeRevision(runtimeRef.current.getWorld().getTerrainRevision());
  }, []);

  const enterEditor = useCallback(
    (message = "Editor ready.") => {
      setMode("editor");
      setRuntimeRevision(0);
      setRuntimeDirtyChunkKeys([]);
      setPlayerIds([]);
      setSessionKey((value) => value + 1);
      onStatus(message);
    },
    [onStatus]
  );

  const enterMenu = useCallback(
    (message = "Back to the main menu.") => {
      setMode("menu");
      setRuntimeRevision(0);
      setRuntimeDirtyChunkKeys([]);
      setPlayerIds([]);
      setSessionKey((value) => value + 1);
      onStatus(message);
    },
    [onStatus]
  );

  const beginMode = useCallback(
    (nextMode: GameMode, mapDocument: MapDocumentV1) => {
      runtimeRef.current.reset(nextMode, normalizeArenaBudgetMapDocument(mapDocument), {
        npcCount: nextMode === "skirmish" ? 4 : 0,
        localPlayerName: "You"
      });
      syncFromMatchState();
      setRuntimeDirtyChunkKeys([]);
      setMode(nextMode);
      setSessionKey((value) => value + 1);
      onStatus(nextMode === "explore" ? "Explore mode ready." : "Skirmish mode ready. Push the NPCs out.");
    },
    [onStatus, syncFromMatchState]
  );

  const handleRuntimeTerrainChange = useCallback((revision: number, dirtyChunkKeys: string[]) => {
    setRuntimeRevision(revision);
    setRuntimeDirtyChunkKeys(dirtyChunkKeys);
  }, []);

  return {
    runtime: runtimeRef.current,
    mode,
    runtimeRevision,
    runtimeDirtyChunkKeys,
    playerIds,
    sessionKey,
    beginMode,
    enterMenu,
    enterEditor,
    handleRuntimeTerrainChange
  };
}
