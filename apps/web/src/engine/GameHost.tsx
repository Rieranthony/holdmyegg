import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from "react";
import type { MapDocumentV1 } from "@out-of-bounds/map";
import type { HudState, SimulationInitialSpawnStyle } from "@out-of-bounds/sim";
import type { RuntimeControlSettings } from "../game/runtimeControlSettings";
import { GameClient } from "./GameClient";
import type { GameWorkerFactory } from "./workerBridge";
import type {
  ActiveShellMode,
  EditorPanelState,
  GameDiagnostics,
  PlayerProfile,
  RuntimeOverlayState,
  RuntimePauseState,
  ShellPresentation
} from "./types";

export interface GameHostHandle {
  getEditorDocument: () => Promise<MapDocumentV1>;
  loadMap: (document: MapDocumentV1) => void;
  requestPointerLock: () => boolean;
  resumeRuntime: () => void;
  setRuntimePaused: (paused: boolean) => void;
  setEditorState: (next: Partial<EditorPanelState>) => void;
  setShellMode: (mode: ActiveShellMode) => void;
}

interface GameHostProps {
  initialDocument: MapDocumentV1;
  initialSpawnStyle?: SimulationInitialSpawnStyle;
  matchColorSeed: number;
  mode: ActiveShellMode;
  playerProfile?: PlayerProfile;
  presentation?: ShellPresentation;
  runtimeSettings?: RuntimeControlSettings;
  workerFactory?: GameWorkerFactory;
  onDiagnostics?: (diagnostics: GameDiagnostics) => void;
  onEditorStateChange?: (editorState: EditorPanelState) => void;
  onHudStateChange?: (hudState: HudState | null) => void;
  onRuntimeOverlayChange?: (state: RuntimeOverlayState | null) => void;
  onPauseStateChange?: (state: RuntimePauseState) => void;
  onReadyToDisplay?: () => void;
  onStatus?: (message: string) => void;
}

export const GameHost = forwardRef<GameHostHandle, GameHostProps>(function GameHost(
  {
    initialDocument,
    initialSpawnStyle = "ground",
    matchColorSeed,
    mode,
    playerProfile,
    presentation = "default",
    runtimeSettings,
    workerFactory,
    onDiagnostics,
    onEditorStateChange,
    onHudStateChange,
    onRuntimeOverlayChange,
    onPauseStateChange,
    onReadyToDisplay,
    onStatus
  },
  ref
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const clientRef = useRef<GameClient | null>(null);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const client = GameClient.mount({
      canvas,
      initialDocument,
      initialMode: mode,
      initialSpawnStyle,
      matchColorSeed,
      localPlayerName: playerProfile?.name,
      localPlayerPaletteName: playerProfile?.paletteName,
      presentation,
      runtimeSettings,
      workerFactory,
      onDiagnostics,
      onEditorStateChange,
      onHudStateChange,
      onRuntimeOverlayChange,
      onPauseStateChange,
      onReadyToDisplay,
      onStatus
    });
    clientRef.current = client;
    return () => {
      client.dispose();
      clientRef.current = null;
    };
  }, [matchColorSeed, onDiagnostics, onEditorStateChange, onHudStateChange, onPauseStateChange, onReadyToDisplay, onRuntimeOverlayChange, onStatus, workerFactory]);

  useEffect(() => {
    clientRef.current?.setShellState({
      mode,
      initialSpawnStyle,
      localPlayerName: playerProfile?.name,
      localPlayerPaletteName: playerProfile?.paletteName,
      presentation,
      runtimeSettings
    });
  }, [
    initialSpawnStyle,
    mode,
    playerProfile?.name,
    playerProfile?.paletteName,
    presentation,
    runtimeSettings?.invertLookX,
    runtimeSettings?.invertLookY,
    runtimeSettings?.lookSensitivity
  ]);

  useImperativeHandle(
    ref,
    () => ({
      async getEditorDocument() {
        if (!clientRef.current) {
          return initialDocument;
        }

        return clientRef.current.requestEditorDocument();
      },
      loadMap(document) {
        clientRef.current?.dispatchShellIntent({
          type: "load_map",
          document
        });
      },
      requestPointerLock() {
        return clientRef.current?.requestPointerLock() ?? false;
      },
      resumeRuntime() {
        clientRef.current?.resumeRuntime();
      },
      setRuntimePaused(paused) {
        clientRef.current?.setRuntimePaused(paused);
      },
      setEditorState(next) {
        clientRef.current?.dispatchShellIntent({
          type: "set_editor_state",
          next
        });
      },
      setShellMode(nextMode) {
        clientRef.current?.setShellState({ mode: nextMode });
      }
    }),
    [initialDocument]
  );

  return (
    <div className={`game-host ${presentation === "menu" ? "game-host--menu" : ""}`.trim()}>
      <canvas
        className="game-host__canvas"
        ref={canvasRef}
      />
      {mode !== "editor" && presentation !== "menu" && (
        <div
          aria-hidden="true"
          className="game-reticle"
          data-testid="runtime-reticle"
        >
          <span className="game-reticle__ring" />
          <span className="game-reticle__dot" />
        </div>
      )}
    </div>
  );
});
