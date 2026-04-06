import {
  startTransition,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
} from "react";
import { flushSync } from "react-dom";
import { createDefaultArenaMap, type MapDocumentV1 } from "@out-of-bounds/map";
import type { GameMode, HudState } from "@out-of-bounds/sim";
import { ChickenPreview } from "../components/ChickenPreview";
import { preloadGameCanvas } from "../components/GameCanvasBoundary";
import { Hud } from "../components/Hud";
import {
  ShortcutLegend,
  runtimeShortcutBindings,
} from "../components/ShortcutLegend";
import { GameHost, type GameHostHandle } from "../engine/GameHost";
import {
  blockKindOptions,
  propKindOptions,
  type ActiveShellMode,
  type EditorPanelState,
  type GameDiagnostics,
  type PlayerProfile,
  type RuntimePauseState,
  type ShellMode,
} from "../engine/types";
import { chickenPalettes } from "../game/colors";
import { useMapPersistence } from "./useMapPersistence";

const defaultStatus =
  "Type your name, choose a chicken color, and drop into the arena.";
const launchTimings = {
  dim: 250,
  stage: 400,
  drop: 350,
} as const;

type LaunchPhase = "dimming" | "staging" | "awaiting-pointer-lock" | "dropping";
type RulesOrigin = "menu" | "pause";

interface LaunchState {
  mode: GameMode;
  phase: LaunchPhase;
}

const createDefaultEditorPanelState = (
  document: MapDocumentV1,
): EditorPanelState => ({
  mapName: document.meta.name,
  tool: "add",
  blockKind: "ground",
  propKind: "tree-oak",
});

const createDefaultPauseState = (): RuntimePauseState => ({
  hasStarted: false,
  paused: false,
  pointerLocked: false,
});

const hexToRgba = (hex: string, alpha: number) => {
  const normalized = hex.replace("#", "");
  const expanded =
    normalized.length === 3
      ? normalized
          .split("")
          .map((channel) => `${channel}${channel}`)
          .join("")
      : normalized;
  const red = Number.parseInt(expanded.slice(0, 2), 16);
  const green = Number.parseInt(expanded.slice(2, 4), 16);
  const blue = Number.parseInt(expanded.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
};

const getModeStatusMessage = (mode: ActiveShellMode) => {
  if (mode === "editor") {
    return "Editor ready.";
  }

  return mode === "explore"
    ? "Explore mode ready."
    : "Brawl mode ready. Be the last chicken standing.";
};

const getModeLabel = (mode: ActiveShellMode) => {
  if (mode === "editor") {
    return "WORKSHOP";
  }

  return mode === "explore" ? "EXPLORE" : "BRAWL";
};

interface AppProps {
  initialMode?: ShellMode;
  onOpenSupportWidget?: () => void;
}

export function App({
  initialMode = "menu",
  onOpenSupportWidget,
}: AppProps = {}) {
  const hostRef = useRef<GameHostHandle>(null);
  const launchTimersRef = useRef<number[]>([]);
  const menuLoadTokenRef = useRef(1);
  const pauseStateRef = useRef<RuntimePauseState>(createDefaultPauseState());
  const runtimeModeRef = useRef<GameMode>("explore");
  const [statusMessage, setStatusMessage] = useState(() =>
    initialMode === "editor" ? getModeStatusMessage("editor") : defaultStatus,
  );
  const [mode, setMode] = useState<ShellMode>(initialMode);
  const [rulesOrigin, setRulesOrigin] = useState<RulesOrigin | null>(null);
  const [editorDocument, setEditorDocument] = useState<MapDocumentV1>(() =>
    createDefaultArenaMap(),
  );
  const [editorState, setEditorState] = useState<EditorPanelState>(() =>
    createDefaultEditorPanelState(createDefaultArenaMap()),
  );
  const [hudState, setHudState] = useState<HudState | null>(null);
  const [pauseState, setPauseState] = useState<RuntimePauseState>(
    createDefaultPauseState,
  );
  const [launchState, setLaunchState] = useState<LaunchState | null>(null);
  const [menuLoadToken, setMenuLoadToken] = useState(1);
  const [menuLoading, setMenuLoading] = useState(initialMode === "menu");
  const [matchColorSeed, setMatchColorSeed] = useState(0);
  const [diagnostics, setDiagnostics] = useState<GameDiagnostics | null>(null);
  const [playerProfile, setPlayerProfile] = useState<PlayerProfile>({
    name: "",
    paletteName: chickenPalettes[0]!.name,
  });

  const updateStatus = useCallback((message: string) => {
    startTransition(() => {
      setStatusMessage(message);
    });
  }, []);

  const mapPersistence = useMapPersistence({
    onStatus: updateStatus,
  });

  const clearLaunchTimers = useCallback(() => {
    for (const timer of launchTimersRef.current) {
      window.clearTimeout(timer);
    }
    launchTimersRef.current = [];
  }, []);

  const cancelLaunchSequence = useCallback(() => {
    clearLaunchTimers();
    setLaunchState(null);
  }, [clearLaunchTimers]);

  useEffect(() => {
    pauseStateRef.current = pauseState;
  }, [pauseState]);

  useEffect(() => () => clearLaunchTimers(), [clearLaunchTimers]);

  useEffect(() => {
    preloadGameCanvas();
  }, []);

  const rearmMenuLoading = useCallback(() => {
    const nextToken = menuLoadTokenRef.current + 1;
    menuLoadTokenRef.current = nextToken;
    setMenuLoadToken(nextToken);
    setMenuLoading(true);
  }, []);

  const handleMenuReadyToDisplay = useCallback(() => {
    if (menuLoadTokenRef.current !== menuLoadToken) {
      return;
    }

    setMenuLoading(false);
  }, [menuLoadToken]);

  const activePlayMode =
    mode === "explore" || mode === "skirmish"
      ? mode
      : mode === "rules" && rulesOrigin === "pause"
        ? runtimeModeRef.current
        : null;
  const isMenu = mode === "menu";
  const isRulesFromMenu = mode === "rules" && rulesOrigin === "menu";
  const isRulesFromPause = mode === "rules" && rulesOrigin === "pause";
  const isEditor = mode === "editor";
  const isRuntimePlay = activePlayMode !== null;
  const canvasTitle = "Map Workshop";
  const trimmedPlayerName = playerProfile.name.trim();
  const paletteUnlocked = trimmedPlayerName.length > 0;
  const canStartMatch = paletteUnlocked && playerProfile.paletteName !== null;
  const selectedPreviewPalette =
    chickenPalettes.find(
      (palette) => palette.name === playerProfile.paletteName,
    ) ?? chickenPalettes[0]!;
  const selectedPreviewPaletteName = selectedPreviewPalette.name;

  const releaseLaunchSequence = useCallback(() => {
    clearLaunchTimers();
    setLaunchState((current) =>
      current ? { ...current, phase: "dropping" } : current,
    );
    hostRef.current?.setRuntimePaused(false);
    launchTimersRef.current = [
      window.setTimeout(() => {
        setLaunchState(null);
      }, launchTimings.drop),
    ];
  }, [clearLaunchTimers]);

  useEffect(() => {
    if (
      launchState?.phase !== "awaiting-pointer-lock" ||
      !pauseState.pointerLocked
    ) {
      return;
    }

    releaseLaunchSequence();
  }, [launchState?.phase, pauseState.pointerLocked, releaseLaunchSequence]);

  const handleEditorStateChange = useCallback((nextState: EditorPanelState) => {
    setEditorState(nextState);
  }, []);

  const handlePlayerNameChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setPlayerProfile((current) => ({
        ...current,
        name: event.target.value,
      }));
    },
    [],
  );

  const handlePalettePick = useCallback(
    (paletteName: PlayerProfile["paletteName"]) => {
      if (!paletteUnlocked) {
        return;
      }

      setPlayerProfile((current) => ({
        ...current,
        paletteName,
      }));
    },
    [paletteUnlocked],
  );

  const handleLaunchCapture = useCallback(() => {
    hostRef.current?.requestPointerLock();
  }, []);

  const openRulesFromMenu = useCallback(() => {
    setRulesOrigin("menu");
    setMode("rules");
  }, []);

  const openRulesFromPause = useCallback(() => {
    if (!activePlayMode) {
      return;
    }

    runtimeModeRef.current = activePlayMode;
    setRulesOrigin("pause");
    setMode("rules");
  }, [activePlayMode]);

  const closeRules = useCallback(() => {
    if (rulesOrigin === "pause") {
      setMode(runtimeModeRef.current);
    } else {
      rearmMenuLoading();
      setMode("menu");
    }
    setRulesOrigin(null);
  }, [rearmMenuLoading, rulesOrigin]);

  const enterMode = useCallback(
    (nextMode: ActiveShellMode) => {
      if (nextMode === "explore" || nextMode === "skirmish") {
        runtimeModeRef.current = nextMode;
      }
      setRulesOrigin(null);
      setMode((currentMode) => {
        if (currentMode === "menu") {
          setMatchColorSeed((value) => value + 1);
        }
        return nextMode;
      });
      setHudState(null);
      setPauseState({
        hasStarted: false,
        paused: nextMode === "explore" || nextMode === "skirmish",
        pointerLocked: false,
      });
      updateStatus(getModeStatusMessage(nextMode));
    },
    [updateStatus],
  );

  const createFreshArena = useCallback(() => {
    const nextDocument = createDefaultArenaMap();
    setEditorDocument(nextDocument);
    setEditorState(createDefaultEditorPanelState(nextDocument));
    mapPersistence.setSelectedMapId(null);
    hostRef.current?.loadMap(nextDocument);
    updateStatus("Loaded a fresh default arena.");
  }, [mapPersistence, updateStatus]);

  const beginMode = useCallback(
    (nextMode: GameMode) => {
      if (!canStartMatch) {
        return;
      }

      clearLaunchTimers();
      flushSync(() => {
        enterMode(nextMode);
        setLaunchState({
          mode: nextMode,
          phase: "dimming",
        });
      });

      hostRef.current?.setRuntimePaused(true);
      hostRef.current?.requestPointerLock();

      launchTimersRef.current.push(
        window.setTimeout(() => {
          setLaunchState((current) =>
            current ? { ...current, phase: "staging" } : current,
          );
        }, launchTimings.dim),
      );
      launchTimersRef.current.push(
        window.setTimeout(() => {
          if (pauseStateRef.current.pointerLocked) {
            releaseLaunchSequence();
            return;
          }

          setLaunchState((current) =>
            current ? { ...current, phase: "awaiting-pointer-lock" } : current,
          );
        }, launchTimings.dim + launchTimings.stage),
      );
    },
    [canStartMatch, clearLaunchTimers, enterMode, releaseLaunchSequence],
  );

  const returnToEditor = useCallback(() => {
    cancelLaunchSequence();
    setRulesOrigin(null);
    enterMode("editor");
  }, [cancelLaunchSequence, enterMode]);

  const returnToMenu = useCallback(async () => {
    cancelLaunchSequence();
    setRulesOrigin(null);
    const nextDocument = await hostRef.current?.getEditorDocument();
    if (nextDocument) {
      setEditorDocument(nextDocument);
      setEditorState((current) => ({
        ...current,
        mapName: nextDocument.meta.name,
      }));
    }

    setHudState(null);
    setPauseState(createDefaultPauseState());
    setDiagnostics(null);
    rearmMenuLoading();
    setMode("menu");
    updateStatus("Back to the main menu.");
  }, [cancelLaunchSequence, rearmMenuLoading, updateStatus]);

  const saveCurrentMap = useCallback(async () => {
    const document =
      (await hostRef.current?.getEditorDocument()) ?? editorDocument;
    const id = await mapPersistence.saveCurrentMap(
      document,
      mapPersistence.selectedMapId,
    );
    setEditorDocument(document);
    mapPersistence.setSelectedMapId(id);
  }, [editorDocument, mapPersistence]);

  const loadSelectedMap = useCallback(async () => {
    const record = await mapPersistence.loadCurrentMap();
    if (!record) {
      return;
    }

    setEditorDocument(record.document);
    setEditorState((current) => ({
      ...current,
      mapName: record.document.meta.name,
    }));
    hostRef.current?.loadMap(record.document);
    updateStatus(`Loaded "${record.name}".`);
  }, [mapPersistence, updateStatus]);

  const deleteSelectedMap = useCallback(async () => {
    await mapPersistence.deleteCurrentMap();
  }, [mapPersistence]);

  const exportCurrentMap = useCallback(async () => {
    const document =
      (await hostRef.current?.getEditorDocument()) ?? editorDocument;
    mapPersistence.exportCurrentMap(document, editorState.mapName);
  }, [editorDocument, editorState.mapName, mapPersistence]);

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

        setEditorDocument(document);
        setEditorState((current) => ({
          ...current,
          mapName: document.meta.name,
        }));
        mapPersistence.setSelectedMapId(null);
        hostRef.current?.loadMap(document);
        updateStatus(`Imported "${document.meta.name}".`);
      } finally {
        event.target.value = "";
      }
    },
    [mapPersistence, updateStatus],
  );

  if (isRulesFromMenu) {
    return <RulesAndControlsScreen onBack={closeRules} />;
  }

  if (isMenu) {
    return (
      <main className="menu-shell">
        <div className="menu-background">
          <GameHost
            initialDocument={editorDocument}
            matchColorSeed={matchColorSeed}
            mode="editor"
            onReadyToDisplay={handleMenuReadyToDisplay}
            playerProfile={playerProfile}
            presentation="menu"
          />
        </div>
        <div
          className="menu-screen-gradient"
          style={
            {
              "--preview-gradient-solid": hexToRgba(
                selectedPreviewPalette.body,
                0.92,
              ),
              "--preview-gradient-mid": hexToRgba(
                selectedPreviewPalette.shade,
                0.54,
              ),
              "--preview-gradient-soft": hexToRgba(
                selectedPreviewPalette.body,
                0.14,
              ),
            } as CSSProperties
          }
        />
        <div className="menu-overlay">
          <section className="menu-sidebar">
            <div className="menu-sidebar__content">
              <h1 className="menu-title">HoldMyEgg</h1>
              <label className="field">
                <span>Player Name</span>
                <input
                  autoFocus
                  maxLength={18}
                  onChange={handlePlayerNameChange}
                  placeholder="TYPE YOUR NAME"
                  value={playerProfile.name}
                />
              </label>
              <div className="field">
                <span>Chicken Color</span>
                <div
                  aria-label="Chicken Color"
                  className={`menu-palette-grid ${paletteUnlocked ? "" : "menu-palette-grid--locked"}`.trim()}
                  role="radiogroup"
                >
                  {chickenPalettes.map((palette) => {
                    const selected = playerProfile.paletteName === palette.name;
                    return (
                      <button
                        aria-checked={selected}
                        aria-label={`${palette.name} chicken`}
                        className={`palette-swatch ${selected ? "palette-swatch--selected" : ""}`.trim()}
                        disabled={!paletteUnlocked}
                        key={palette.name}
                        onClick={() => handlePalettePick(palette.name)}
                        role="radio"
                        style={
                          {
                            "--swatch-body": palette.body,
                            "--swatch-shade": palette.shade,
                            "--swatch-ring": palette.ringAccent,
                          } as CSSProperties
                        }
                        title={palette.name}
                        type="button"
                      >
                        <span className="palette-swatch__chip" />
                        <span className="palette-swatch__name">
                          {palette.name}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {!paletteUnlocked && (
                  <span className="menu-hint">
                    Type your name to unlock the coop colors.
                  </span>
                )}
              </div>

              <div
                aria-label="Modes"
                className="menu-primary-actions"
                role="group"
              >
                <button
                  className="menu-action menu-action--full menu-action--hero"
                  disabled={!canStartMatch}
                  onClick={() => beginMode("explore")}
                  type="button"
                >
                  Explore
                </button>
                <button
                  className="menu-action menu-action--full menu-action--hero-secondary"
                  disabled={!canStartMatch}
                  onClick={() => beginMode("skirmish")}
                  type="button"
                >
                  Brawl
                </button>
              </div>
              <div className="menu-utility">
                <div
                  aria-label="Menu links"
                  className="menu-secondary-actions"
                  role="group"
                >
                  <button
                    className="menu-action menu-action--full menu-action--compact"
                    onClick={openRulesFromMenu}
                    type="button"
                  >
                    Rules and Controls
                  </button>
                  <button
                    className="menu-action menu-action--secondary menu-action--full menu-action--compact"
                    onClick={onOpenSupportWidget}
                    type="button"
                  >
                    Feedback / bug
                  </button>
                </div>
                <p className="menu-credit">
                  Made by Anthony Riera and{" "}
                  <a
                    href="https://cossistant.com"
                    rel="noreferrer"
                    target="_blank"
                  >
                    cossistant.com
                  </a>
                </p>
              </div>
            </div>
          </section>

          <section aria-label="Chicken Preview" className="menu-preview-stage">
            <ChickenPreview
              paletteName={selectedPreviewPaletteName}
              variant="menu"
            />
          </section>
        </div>
        {menuLoading && <BootSplashScreen />}
      </main>
    );
  }

  if (isRuntimePlay) {
    return (
      <main className="play-shell">
        <div className="play-canvas">
          <GameHost
            initialDocument={editorDocument}
            initialSpawnStyle="sky"
            matchColorSeed={matchColorSeed}
            mode={activePlayMode}
            playerProfile={playerProfile}
            onDiagnostics={setDiagnostics}
            onEditorStateChange={handleEditorStateChange}
            onHudStateChange={setHudState}
            onPauseStateChange={setPauseState}
            onStatus={updateStatus}
            ref={hostRef}
          />
          {launchState && (
            <LaunchOverlay
              mode={launchState.mode}
              onCapturePointerLock={handleLaunchCapture}
              onReturnToMenu={() => {
                void returnToMenu();
              }}
              paletteName={selectedPreviewPaletteName}
              phase={launchState.phase}
              pointerLocked={pauseState.pointerLocked}
            />
          )}
          {isRulesFromPause && <RulesAndControlsScreen onBack={closeRules} />}
          {!launchState && !isRulesFromPause && (
            <Hud hudState={hudState} mode={activePlayMode} />
          )}
          {pauseState.paused && !launchState && !isRulesFromPause && (
            <RuntimePauseOverlay
              hasStarted={pauseState.hasStarted}
              onResume={() => hostRef.current?.resumeRuntime()}
              onShowRules={openRulesFromPause}
              onReturnToMenu={() => {
                void returnToMenu();
              }}
            />
          )}
        </div>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <aside className="control-panel">
        <div className="panel-head">
          <p className="panel-kicker">Voxel Arena Prototype</p>
          <h1>HoldMyEgg</h1>
          <p className="panel-copy">
            Build the map, tune the feel, then launch back into the arena when
            the layout is ready.
          </p>
        </div>

        <section className="panel-section">
          <div className="section-title-row">
            <h2>Mode</h2>
            <span className="mode-chip">{getModeLabel("editor")}</span>
          </div>
          <div className="button-grid">
            <button
              className={isEditor ? "is-active" : ""}
              onClick={returnToEditor}
              type="button"
            >
              Workshop
            </button>
            <button
              disabled={!canStartMatch}
              onClick={() => beginMode("explore")}
              type="button"
            >
              Explore
            </button>
            <button
              disabled={!canStartMatch}
              onClick={() => beginMode("skirmish")}
              type="button"
            >
              Brawl
            </button>
          </div>
        </section>

        <section className="panel-section">
          <div className="section-title-row">
            <h2>Map</h2>
            <span className="mode-chip">
              {editorDocument.size.x} x {editorDocument.size.z}
            </span>
          </div>
          <label className="field">
            <span>Name</span>
            <input
              onChange={(event) =>
                hostRef.current?.setEditorState({ mapName: event.target.value })
              }
              value={editorState.mapName}
            />
          </label>
          <div className="button-row">
            <button onClick={createFreshArena} type="button">
              New Arena
            </button>
            <button onClick={saveCurrentMap} type="button">
              Save
            </button>
            <button
              onClick={() => {
                void exportCurrentMap();
              }}
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
              className={editorState.tool === "add" ? "is-active" : ""}
              onClick={() => hostRef.current?.setEditorState({ tool: "add" })}
              type="button"
            >
              Add
            </button>
            <button
              className={editorState.tool === "erase" ? "is-active" : ""}
              onClick={() => hostRef.current?.setEditorState({ tool: "erase" })}
              type="button"
            >
              Erase
            </button>
            <button
              className={editorState.tool === "spawn" ? "is-active" : ""}
              onClick={() => hostRef.current?.setEditorState({ tool: "spawn" })}
              type="button"
            >
              Spawn
            </button>
            <button
              className={editorState.tool === "prop" ? "is-active" : ""}
              onClick={() => hostRef.current?.setEditorState({ tool: "prop" })}
              type="button"
            >
              Prop
            </button>
          </div>
          <label className="field">
            <span>Cube Type</span>
            <select
              disabled={editorState.tool !== "add"}
              onChange={(event) =>
                hostRef.current?.setEditorState({
                  blockKind: event.target
                    .value as (typeof blockKindOptions)[number],
                })
              }
              value={editorState.blockKind}
            >
              {blockKindOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Prop Type</span>
            <select
              disabled={editorState.tool !== "prop"}
              onChange={(event) =>
                hostRef.current?.setEditorState({
                  propKind: event.target
                    .value as (typeof propKindOptions)[number],
                })
              }
              value={editorState.propKind}
            >
              {propKindOptions.map((option) => (
                <option key={option} value={option}>
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
              onChange={(event) =>
                mapPersistence.setSelectedMapId(event.target.value || null)
              }
              value={mapPersistence.selectedMapId ?? ""}
            >
              <option value="">Select a save</option>
              {mapPersistence.savedMaps.map((savedMap) => (
                <option key={savedMap.id} value={savedMap.id}>
                  {savedMap.name}
                </option>
              ))}
            </select>
          </label>
          <div className="button-row">
            <button onClick={loadSelectedMap} type="button">
              Load
            </button>
            <button onClick={deleteSelectedMap} type="button">
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
          <div className="stage-head__actions">
            <p className="stage-copy">
              Minecraft-like cubes, party-game pacing, and a renderer path
              designed to survive the jump to multiplayer.
            </p>
            <button
              onClick={() => {
                void returnToMenu();
              }}
              type="button"
            >
              Menu
            </button>
          </div>
        </header>

        <div className="canvas-card">
          <GameHost
            initialDocument={editorDocument}
            matchColorSeed={matchColorSeed}
            mode="editor"
            playerProfile={playerProfile}
            onDiagnostics={setDiagnostics}
            onEditorStateChange={handleEditorStateChange}
            onHudStateChange={setHudState}
            onPauseStateChange={setPauseState}
            onStatus={updateStatus}
            ref={hostRef}
          />
          <Hud hudState={hudState} mode="editor" />
          {import.meta.env.DEV && diagnostics && (
            <div className="terrain-stats-overlay">
              <p>Mode {diagnostics.mode.toUpperCase()}</p>
              <p>Tick {diagnostics.tick.toLocaleString()}</p>
              <p>Terrain Rev {diagnostics.terrainRevision.toLocaleString()}</p>
              <p>Dirty Chunks {diagnostics.dirtyChunkCount.toLocaleString()}</p>
              <p>
                Sky Update {diagnostics.runtime.skyDropUpdateMs.toFixed(2)}ms
              </p>
              <p>
                Sky Landing {diagnostics.runtime.skyDropLandingMs.toFixed(2)}ms
              </p>
              <p>
                Collapse Scan{" "}
                {diagnostics.runtime.detachedComponentMs.toFixed(2)}ms
              </p>
              <p>
                Cluster Landing{" "}
                {diagnostics.runtime.fallingClusterLandingMs.toFixed(2)}ms
              </p>
              <p>
                Catch-up Max{" "}
                {diagnostics.runtime.fixedStepMaxStepsPerFrame.toLocaleString()}
              </p>
              <p>
                Catch-up Clamps{" "}
                {diagnostics.runtime.fixedStepClampedFrames.toLocaleString()}
              </p>
              <p>
                Catch-up Dropped{" "}
                {diagnostics.runtime.fixedStepDroppedMs.toFixed(2)}ms
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function BootSplashScreen() {
  return (
    <div className="boot-splash" data-testid="boot-splash">
      <div className="boot-splash__wordmark">HoldMyEgg</div>
    </div>
  );
}

function RulesAndControlsScreen({ onBack }: { onBack: () => void }) {
  return (
    <section className="rules-screen" data-testid="rules-screen">
      <div aria-hidden="true" className="rules-screen__backdrop">
        <div className="rules-screen__backdrop-wordmark">HoldMyEgg</div>
      </div>
      <div className="rules-screen__content">
        <div className="rules-screen__header">
          <div>
            <p className="panel-kicker">HoldMyEgg</p>
            <h1>Rules and Controls</h1>
            <p>
              Last chicken standing. Harvest cubes, spend matter, and survive
              the mess you make.
            </p>
          </div>
          <button onClick={onBack} type="button">
            Back
          </button>
        </div>

        <div className="rules-screen__summary-grid">
          <section className="rules-screen__card">
            <h2>Win</h2>
            <p>Be the last one standing on the map.</p>
          </section>
          <section className="rules-screen__card">
            <h2>Lives</h2>
            <p>Every chicken gets 3 feathers. Lose all 3 and you are out.</p>
          </section>
          <section className="rules-screen__card">
            <h2>Matter</h2>
            <p>
              Only harvested cubes refill matter, and every big move spends it.
            </p>
          </section>
        </div>

        <section className="rules-screen__section rules-screen__section--controls">
          <div className="rules-screen__section-copy">
            <h2>Controls</h2>
            <p>Shortcuts are the same in Explore and Brawl.</p>
          </div>
          <ShortcutLegend bindings={runtimeShortcutBindings} />
        </section>

        <div className="rules-screen__detail-grid">
          <section className="rules-screen__section">
            <div className="rules-screen__section-copy">
              <h2>Modes</h2>
              <p>Same systems, different pressure.</p>
            </div>
            <div className="rules-screen__mode-grid">
              <article className="rules-screen__mini-card">
                <h3>Explore</h3>
                <p>
                  Solo practice for movement, flying, building, pushing, and
                  eggs.
                </p>
              </article>
              <article className="rules-screen__mini-card">
                <h3>Brawl</h3>
                <p>
                  Use that same toolkit to outlast everyone else on the arena.
                </p>
              </article>
            </div>
          </section>

          <section className="rules-screen__section">
            <div className="rules-screen__section-copy">
              <h2>Watch Out</h2>
              <p>Three fast ways to lose a life.</p>
            </div>
            <ul className="rules-screen__danger-list">
              <li>Getting crushed by the map</li>
              <li>Falling out of the map</li>
              <li>Getting hit by an egg blast</li>
            </ul>
            <p className="rules-screen__pause-note">
              Press <strong>`Esc`</strong> to unlock the mouse, pause, and head
              back when you need a breather.
            </p>
          </section>
        </div>
      </div>
    </section>
  );
}

function LaunchOverlay({
  mode,
  onCapturePointerLock,
  onReturnToMenu,
  paletteName,
  phase,
  pointerLocked,
}: {
  mode: GameMode;
  onCapturePointerLock: () => void;
  onReturnToMenu: () => void;
  paletteName: PlayerProfile["paletteName"];
  phase: LaunchPhase;
  pointerLocked: boolean;
}) {
  const needsCapture = phase === "awaiting-pointer-lock" && !pointerLocked;

  return (
    <div
      className={`launch-overlay launch-overlay--${phase}`.trim()}
      data-testid="launch-overlay"
    >
      <div className="launch-overlay__veil" />
      <div className="launch-overlay__content">
        <div className="launch-overlay__preview">
          {paletteName && (
            <ChickenPreview paletteName={paletteName} variant="launch" />
          )}
        </div>
        {needsCapture && (
          <div className="launch-overlay__copy">
            <p className="panel-kicker">
              {mode === "explore" ? "Explore" : "Brawl"}
            </p>
            <h2>Capture Mouse</h2>
            <p>One more click and the camera is yours.</p>
            <div className="launch-overlay__actions">
              <button onClick={onCapturePointerLock} type="button">
                Capture Mouse
              </button>
              <button
                className="menu-action--secondary"
                onClick={onReturnToMenu}
                type="button"
              >
                Menu
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function RuntimePauseOverlay({
  hasStarted,
  onResume,
  onShowRules,
  onReturnToMenu,
}: {
  hasStarted: boolean;
  onResume: () => void;
  onShowRules: () => void;
  onReturnToMenu: () => void;
}) {
  return (
    <div className="runtime-pause-overlay">
      <button
        aria-label="Resume play"
        className="runtime-pause-backdrop"
        onClick={onResume}
        type="button"
      />
      <div
        className="runtime-pause-strip"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="runtime-pause-strip__top">
          <div className="runtime-pause-strip__intro">
            <p className="panel-kicker">
              {hasStarted ? "Paused" : "Click To Start"}
            </p>
            <p className="runtime-pause-strip__message">
              {hasStarted
                ? "Mouse unlocked. Resume to jump back in."
                : "Click once to capture the mouse and drop into the arena."}
            </p>
          </div>
          <div className="runtime-pause-strip__actions">
            <button
              className="runtime-pause-strip__button"
              onClick={onResume}
              type="button"
            >
              Resume
            </button>
            <button
              className="runtime-pause-strip__button"
              onClick={onShowRules}
              type="button"
            >
              Rules and Controls
            </button>
            <button
              className="runtime-pause-strip__button"
              onClick={onReturnToMenu}
              type="button"
            >
              Menu
            </button>
          </div>
        </div>
        <div className="runtime-pause-strip__commands-shell">
          <p className="runtime-pause-strip__label">Commands</p>
          <ShortcutLegend
            bindings={runtimeShortcutBindings}
            className="runtime-pause-strip__commands"
            variant="pause"
          />
        </div>
      </div>
    </div>
  );
}
