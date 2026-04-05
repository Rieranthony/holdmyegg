import { startTransition, useCallback, useDeferredValue, useEffect, useState } from "react";
import { normalizeArenaBudgetMapDocument, type MapDocumentV1 } from "@out-of-bounds/map";
import {
  deleteSavedMap,
  listSavedMaps,
  loadSavedMap,
  saveMap,
  type SavedMapRecord,
  type SavedMapSummary
} from "../data/mapStorage";
import { exportMapDocument, importMapDocument } from "./mapTransfer";

interface UseMapPersistenceOptions {
  onStatus: (message: string) => void;
}

export function useMapPersistence({ onStatus }: UseMapPersistenceOptions) {
  const [savedMaps, setSavedMaps] = useState<SavedMapSummary[]>([]);
  const deferredSavedMaps = useDeferredValue(savedMaps);
  const [selectedMapId, setSelectedMapId] = useState<string | null>(null);

  const refreshSavedMaps = useCallback(async () => {
    const summaries = await listSavedMaps();
    startTransition(() => {
      setSavedMaps(summaries);
    });
  }, []);

  useEffect(() => {
    void refreshSavedMaps();
  }, [refreshSavedMaps]);

  const saveCurrentMap = useCallback(
    async (document: MapDocumentV1, currentMapId?: string | null) => {
      const normalizedDocument = normalizeArenaBudgetMapDocument(document);
      const id = await saveMap(normalizedDocument, currentMapId ?? undefined);
      setSelectedMapId(id);
      await refreshSavedMaps();
      onStatus("Saved the current map locally.");
      return id;
    },
    [onStatus, refreshSavedMaps]
  );

  const loadCurrentMap = useCallback(async (): Promise<SavedMapRecord | null> => {
    if (!selectedMapId) {
      onStatus("Pick a saved map first.");
      return null;
    }

    const record = await loadSavedMap(selectedMapId);
    if (!record) {
      onStatus("That saved map could not be found.");
      return null;
    }

    const document = normalizeArenaBudgetMapDocument(record.document);

    return {
      ...record,
      name: document.meta.name,
      document
    };
  }, [onStatus, selectedMapId]);

  const deleteCurrentMap = useCallback(async () => {
    if (!selectedMapId) {
      onStatus("Pick a saved map to delete.");
      return false;
    }

    await deleteSavedMap(selectedMapId);
    setSelectedMapId(null);
    await refreshSavedMaps();
    onStatus("Deleted the selected saved map.");
    return true;
  }, [onStatus, refreshSavedMaps, selectedMapId]);

  const exportCurrentMap = useCallback(
    (document: MapDocumentV1, mapName: string) => {
      exportMapDocument(document, mapName);
      onStatus("Exported the map as JSON.");
    },
    [onStatus]
  );

  const importMapFile = useCallback(
    async (file: File) => {
      try {
        return normalizeArenaBudgetMapDocument(await importMapDocument(file));
      } catch {
        onStatus("Import failed. Check that the JSON is a valid Out of Bounds map.");
        return null;
      }
    },
    [onStatus]
  );

  return {
    savedMaps: deferredSavedMaps,
    selectedMapId,
    setSelectedMapId,
    saveCurrentMap,
    loadCurrentMap,
    deleteCurrentMap,
    exportCurrentMap,
    importMapFile
  };
}
