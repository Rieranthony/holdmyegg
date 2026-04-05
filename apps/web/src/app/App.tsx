import { startTransition, useCallback, useState, type ChangeEvent } from "react";
import type { GameMode } from "@out-of-bounds/sim";
import { GameCanvasBoundary, preloadGameCanvas } from "../components/GameCanvasBoundary";
import { Hud } from "../components/Hud";
import { blockKindOptions, propKindOptions, useEditorSession } from "./useEditorSession";
import { useMapPersistence } from "./useMapPersistence";
import { useRuntimeSession } from "./useRuntimeSession";

const defaultStatus = "Choose a mode to start the match, or open the workshop to build an arena.";

export function App() {
  const [statusMessage, setStatusMessage] = useState(defaultStatus);

  const updateStatus = useCallback((message: string) => {
    startTransition(() => {
      setStatusMessage(message);
    });
  }, []);

  const editorSession = useEditorSession({
    onStatus: updateStatus
  });
  const runtimeSession = useRuntimeSession({
    onStatus: updateStatus
  });
  const mapPersistence = useMapPersistence({
    onStatus: updateStatus
  });

  const createFreshArena = useCallback(() => {
    preloadGameCanvas();
    editorSession.createFreshArena();
    mapPersistence.setSelectedMapId(null);
    runtimeSession.enterEditor("Loaded a fresh default arena.");
  }, [editorSession, mapPersistence, preloadGameCanvas, runtimeSession]);

  const beginMode = useCallback(
    (nextMode: GameMode) => {
      preloadGameCanvas();
      runtimeSession.beginMode(nextMode, editorSession.editorWorld.toDocument());
    },
    [editorSession.editorWorld, preloadGameCanvas, runtimeSession]
  );

  const returnToEditor = useCallback(() => {
    preloadGameCanvas();
    runtimeSession.enterEditor();
  }, [preloadGameCanvas, runtimeSession]);

  const returnToMenu = useCallback(() => {
    runtimeSession.enterMenu();
  }, [runtimeSession]);

  const saveCurrentMap = useCallback(async () => {
    await mapPersistence.saveCurrentMap(editorSession.editorWorld.toDocument(), mapPersistence.selectedMapId);
  }, [editorSession.editorWorld, mapPersistence]);

  const loadSelectedMap = useCallback(async () => {
    const record = await mapPersistence.loadCurrentMap();
    if (!record) {
      return;
    }

    preloadGameCanvas();
    editorSession.applyDocument(record.document);
    runtimeSession.enterEditor(`Loaded "${record.name}".`);
  }, [editorSession, mapPersistence, preloadGameCanvas, runtimeSession]);

  const deleteSelectedMap = useCallback(async () => {
    await mapPersistence.deleteCurrentMap();
  }, [mapPersistence]);

  const exportCurrentMap = useCallback(() => {
    mapPersistence.exportCurrentMap(editorSession.editorWorld.toDocument(), editorSession.mapName);
  }, [editorSession.editorWorld, editorSession.mapName, mapPersistence]);

  const handleImportMap = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) {
        return;
      }

      try {
        const document = await mapPersistence.importMapFile(file);
        if (!document) {
          return;
        }

        preloadGameCanvas();
        editorSession.applyDocument(document);
        mapPersistence.setSelectedMapId(null);
        runtimeSession.enterEditor(`Imported "${document.meta.name}".`);
      } finally {
        event.target.value = "";
      }
    },
    [editorSession, mapPersistence, preloadGameCanvas, runtimeSession]
  );

  const canvasTitle = "Map Workshop";

  const isMenu = runtimeSession.mode === "menu";
  const isEditor = runtimeSession.mode === "editor";
  const isRuntimePlay = runtimeSession.mode === "explore" || runtimeSession.mode === "skirmish";

  if (isMenu) {
    return (
      <main className="menu-shell">
        <section className="menu-card">
          <p className="panel-kicker">Voxel Arena Prototype</p>
          <h1>Out of Bounds</h1>
          <p className="menu-copy">
            Knock rivals out of the arena, harvest cubes for Mass, and reshape the map before they do the same to you.
          </p>
          <div className="menu-action-grid">
            <button
              className="menu-action menu-action--primary"
              onClick={() => beginMode("explore")}
              onFocus={preloadGameCanvas}
              onMouseEnter={preloadGameCanvas}
              type="button"
            >
              Explore
            </button>
            <button
              className="menu-action menu-action--primary"
              onClick={() => beginMode("skirmish")}
              onFocus={preloadGameCanvas}
              onMouseEnter={preloadGameCanvas}
              type="button"
            >
              Skirmish
            </button>
          </div>
          <button
            className="menu-action menu-action--secondary"
            onClick={returnToEditor}
            onFocus={preloadGameCanvas}
            onMouseEnter={preloadGameCanvas}
            type="button"
          >
            Map Workshop
          </button>
          <p className="menu-status">{statusMessage}</p>
        </section>
      </main>
    );
  }

  if (runtimeSession.mode === "explore" || runtimeSession.mode === "skirmish") {
    const playMode = runtimeSession.mode;

    return (
      <main className="play-shell">
        <div className="play-canvas">
          <GameCanvasBoundary
            key={`${playMode}-${runtimeSession.sessionKey}`}
            loadingLabel="Loading arena renderer"
            mode={playMode}
            editorWorld={editorSession.editorWorld}
            editorRevision={editorSession.editorRevision}
            editorDirtyChunkKeys={editorSession.editorDirtyChunkKeys}
            matchColorSeed={runtimeSession.sessionKey}
            runtime={runtimeSession.runtime}
            runtimeRevision={runtimeSession.runtimeRevision}
            runtimeDirtyChunkKeys={runtimeSession.runtimeDirtyChunkKeys}
            playerIds={runtimeSession.playerIds}
            onEditorInteract={editorSession.handleEditorInteract}
            onRuntimeTerrainChange={runtimeSession.handleRuntimeTerrainChange}
            onReturnToMenu={returnToMenu}
          />
          <Hud
            runtime={runtimeSession.runtime}
            mode={playMode}
          />
        </div>
      </main>
    );
  }

  const editorMode = "editor";

  return (
    <div className="app-shell">
      <aside className="control-panel">
        <div className="panel-head">
          <p className="panel-kicker">Voxel Arena Prototype</p>
          <h1>Out of Bounds</h1>
          <p className="panel-copy">
            Build the map, tune the feel, then launch back into the arena when the layout is ready.
          </p>
        </div>

        <section className="panel-section">
          <div className="section-title-row">
            <h2>Mode</h2>
            <span className="mode-chip">{runtimeSession.mode.toUpperCase()}</span>
          </div>
        <div className="button-grid">
          <button
            className={isEditor ? "is-active" : ""}
            onClick={returnToEditor}
            onFocus={preloadGameCanvas}
            onMouseEnter={preloadGameCanvas}
            type="button"
          >
            Editor
          </button>
          <button
            onClick={() => beginMode("explore")}
            onFocus={preloadGameCanvas}
            onMouseEnter={preloadGameCanvas}
            type="button"
          >
            Explore
          </button>
          <button
            onClick={() => beginMode("skirmish")}
            onFocus={preloadGameCanvas}
            onMouseEnter={preloadGameCanvas}
            type="button"
          >
            Skirmish
            </button>
          </div>
        </section>

        <section className="panel-section">
          <div className="section-title-row">
            <h2>Map</h2>
            <span className="mode-chip">{editorSession.editorWorld.size.x} x {editorSession.editorWorld.size.z}</span>
          </div>
          <label className="field">
            <span>Name</span>
            <input
              onChange={(event) => editorSession.setEditorMapName(event.target.value)}
              value={editorSession.mapName}
            />
          </label>
          <div className="button-row">
            <button
              onClick={createFreshArena}
              type="button"
            >
              New Arena
            </button>
            <button
              onClick={saveCurrentMap}
              type="button"
            >
              Save
            </button>
            <button
              onClick={exportCurrentMap}
              type="button"
            >
              Export
            </button>
          </div>
          <label className="field">
            <span>Import JSON</span>
            <input
              accept=".json,application/json"
              onChange={handleImportMap}
              type="file"
            />
          </label>
        </section>

        <section className="panel-section">
          <div className="section-title-row">
            <h2>Editor</h2>
            <span className="mode-chip">Left click</span>
          </div>
          <div className="button-grid">
            <button
              className={editorSession.tool === "add" ? "is-active" : ""}
              onClick={() => editorSession.setTool("add")}
              type="button"
            >
              Add
            </button>
            <button
              className={editorSession.tool === "erase" ? "is-active" : ""}
              onClick={() => editorSession.setTool("erase")}
              type="button"
            >
              Erase
            </button>
            <button
              className={editorSession.tool === "spawn" ? "is-active" : ""}
              onClick={() => editorSession.setTool("spawn")}
              type="button"
            >
              Spawn
            </button>
            <button
              className={editorSession.tool === "prop" ? "is-active" : ""}
              onClick={() => editorSession.setTool("prop")}
              type="button"
            >
              Prop
            </button>
          </div>
          <label className="field">
            <span>Cube Type</span>
            <select
              disabled={editorSession.tool !== "add"}
              onChange={(event) => editorSession.setBlockKind(event.target.value as (typeof blockKindOptions)[number])}
              value={editorSession.blockKind}
            >
              {blockKindOptions.map((option) => (
                <option
                  key={option}
                  value={option}
                >
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Prop Type</span>
            <select
              disabled={editorSession.tool !== "prop"}
              onChange={(event) => editorSession.setPropKind(event.target.value as (typeof propKindOptions)[number])}
              value={editorSession.propKind}
            >
              {propKindOptions.map((option) => (
                <option
                  key={option}
                  value={option}
                >
                  {option}
                </option>
              ))}
            </select>
          </label>
        </section>

        <section className="panel-section">
          <div className="section-title-row">
            <h2>Saved Maps</h2>
            <span className="mode-chip">{mapPersistence.savedMaps.length}</span>
          </div>
          <label className="field">
            <span>Saved Slot</span>
            <select
              onChange={(event) => mapPersistence.setSelectedMapId(event.target.value || null)}
              value={mapPersistence.selectedMapId ?? ""}
            >
              <option value="">Select a save</option>
              {mapPersistence.savedMaps.map((savedMap) => (
                <option
                  key={savedMap.id}
                  value={savedMap.id}
                >
                  {savedMap.name}
                </option>
              ))}
            </select>
          </label>
          <div className="button-row">
            <button
              onClick={loadSelectedMap}
              type="button"
            >
              Load
            </button>
            <button
              onClick={deleteSelectedMap}
              type="button"
            >
              Delete
            </button>
          </div>
        </section>

        <section className="panel-section panel-section--status">
          <h2>Status</h2>
          <p>{statusMessage}</p>
        </section>
      </aside>

      <main className="stage">
        <header className="stage-head">
          <div>
            <p className="panel-kicker">Current View</p>
            <h2>{canvasTitle}</h2>
          </div>
          <p className="stage-copy">
            Minecraft-like cubes, party-game pacing, and a renderer path designed to survive the jump to multiplayer.
          </p>
        </header>

        <div className="canvas-card">
          <GameCanvasBoundary
            key={`${editorMode}-${runtimeSession.sessionKey}`}
            loadingLabel="Loading workshop renderer"
            mode={editorMode}
            editorWorld={editorSession.editorWorld}
            editorRevision={editorSession.editorRevision}
            editorDirtyChunkKeys={editorSession.editorDirtyChunkKeys}
            matchColorSeed={runtimeSession.sessionKey}
            runtime={runtimeSession.runtime}
            runtimeRevision={runtimeSession.runtimeRevision}
            runtimeDirtyChunkKeys={runtimeSession.runtimeDirtyChunkKeys}
            playerIds={runtimeSession.playerIds}
            onEditorInteract={editorSession.handleEditorInteract}
            onRuntimeTerrainChange={runtimeSession.handleRuntimeTerrainChange}
          />
          <Hud
            runtime={runtimeSession.runtime}
            mode={editorMode}
          />
        </div>
      </main>
    </div>
  );
}
