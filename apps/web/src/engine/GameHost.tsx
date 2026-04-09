import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, type MutableRefObject } from "react";
import type { MapDocumentV1 } from "@out-of-bounds/map";
import type { HudState, SimulationInitialSpawnStyle } from "@out-of-bounds/sim";
import type { QualityTier } from "../game/quality";
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
  qualityTier?: QualityTier;
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

interface GameClientLease {
  client: GameClient;
  disposeTimeoutId: number | null;
}

const gameClientLeases = new WeakMap<HTMLCanvasElement, GameClientLease>();
const gameClientDisposalGraceMs = 32;

const cancelLeaseDisposal = (lease: GameClientLease) => {
  if (lease.disposeTimeoutId === null) {
    return;
  }

  window.clearTimeout(lease.disposeTimeoutId);
  lease.disposeTimeoutId = null;
};

const scheduleLeaseDisposal = (
  canvas: HTMLCanvasElement,
  lease: GameClientLease,
  clientRef: MutableRefObject<GameClient | null>
) => {
  cancelLeaseDisposal(lease);
  lease.disposeTimeoutId = window.setTimeout(() => {
    const currentLease = gameClientLeases.get(canvas);
    if (!currentLease || currentLease.client !== lease.client) {
      return;
    }

    currentLease.client.dispose();
    gameClientLeases.delete(canvas);
    if (clientRef.current === currentLease.client) {
      clientRef.current = null;
    }
  }, gameClientDisposalGraceMs);
};

export const GameHost = forwardRef<GameHostHandle, GameHostProps>(function GameHost(
  {
    initialDocument,
    initialSpawnStyle = "ground",
    matchColorSeed,
    mode,
    playerProfile,
    presentation = "default",
    qualityTier = "medium",
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
  const callbackStateRef = useRef({
    onDiagnostics,
    onEditorStateChange,
    onHudStateChange,
    onRuntimeOverlayChange,
    onPauseStateChange,
    onReadyToDisplay,
    onStatus
  });
  const stableCallbackBridgeRef = useRef({
    onDiagnostics: (diagnostics: GameDiagnostics) => callbackStateRef.current.onDiagnostics?.(diagnostics),
    onEditorStateChange: (editorState: EditorPanelState) => callbackStateRef.current.onEditorStateChange?.(editorState),
    onHudStateChange: (hudState: HudState | null) => callbackStateRef.current.onHudStateChange?.(hudState),
    onRuntimeOverlayChange: (state: RuntimeOverlayState | null) =>
      callbackStateRef.current.onRuntimeOverlayChange?.(state),
    onPauseStateChange: (state: RuntimePauseState) => callbackStateRef.current.onPauseStateChange?.(state),
    onReadyToDisplay: () => callbackStateRef.current.onReadyToDisplay?.(),
    onStatus: (message: string) => callbackStateRef.current.onStatus?.(message)
  });

  callbackStateRef.current = {
    onDiagnostics,
    onEditorStateChange,
    onHudStateChange,
    onRuntimeOverlayChange,
    onPauseStateChange,
    onReadyToDisplay,
    onStatus
  };

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const existingLease = gameClientLeases.get(canvas);
    if (existingLease) {
      cancelLeaseDisposal(existingLease);
      clientRef.current = existingLease.client;

      return () => {
        scheduleLeaseDisposal(canvas, existingLease, clientRef);
      };
    }

    const lease: GameClientLease = {
      client: GameClient.mount({
        canvas,
        initialDocument,
        initialMode: mode,
        initialSpawnStyle,
        matchColorSeed,
        localPlayerName: playerProfile?.name,
        localPlayerPaletteName: playerProfile?.paletteName,
        presentation,
        qualityTier,
        runtimeSettings,
        workerFactory,
        ...stableCallbackBridgeRef.current
      }),
      disposeTimeoutId: null
    };
    gameClientLeases.set(canvas, lease);
    clientRef.current = lease.client;

    return () => {
      scheduleLeaseDisposal(canvas, lease, clientRef);
    };
  }, []);

  useEffect(() => {
    clientRef.current?.setShellState({
      mode,
      initialSpawnStyle,
      localPlayerName: playerProfile?.name,
      localPlayerPaletteName: playerProfile?.paletteName,
      presentation,
      qualityTier,
      runtimeSettings
    });
  }, [
    initialSpawnStyle,
    mode,
    playerProfile?.name,
    playerProfile?.paletteName,
    presentation,
    qualityTier,
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
