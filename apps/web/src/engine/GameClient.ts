import { createDefaultArenaMap, type MapDocumentV1 } from "@out-of-bounds/map";
import type {
  HudState,
  SimulationInitialSpawnStyle,
  SimulationPlayerSpawnOverride
} from "@out-of-bounds/sim";
import type { ChickenPaletteName } from "../game/colors";
import type { QualityTier } from "../game/quality";
import type { RuntimeControlSettings } from "../game/runtimeControlSettings";
import type {
  WorkerRequestMessage,
  WorkerResponseMessage,
  SourceWorkerResponseMessage
} from "./protocol";
import {
  createLocalGameWorker,
  type GameWorkerFactory,
  type GameWorkerLike
} from "./workerBridge";
import type {
  ActiveShellMode,
  EditorPanelState,
  GameDiagnostics,
  PortalSceneConfig,
  PortalTraversalSnapshot,
  PointerCaptureFailureReason,
  RuntimeCaptureMode,
  RuntimePauseState,
  ShellPresentation
} from "./types";

interface GameClientCallbacks {
  onDiagnostics?: (diagnostics: GameDiagnostics) => void;
  onEditorStateChange?: (editorState: EditorPanelState) => void;
  onHudStateChange?: (hudState: HudState | null) => void;
  onPauseStateChange?: (state: RuntimePauseState) => void;
  onPortalTriggered?: (portalId: string, snapshot: PortalTraversalSnapshot) => void;
  onReadyToDisplay?: () => void;
  onStatus?: (message: string) => void;
}

interface GameClientMountOptions extends GameClientCallbacks {
  canvas: HTMLCanvasElement;
  initialDocument?: MapDocumentV1;
  initialMode: ActiveShellMode;
  initialSpawnStyle?: SimulationInitialSpawnStyle;
  localPlayerSpawnOverride?: SimulationPlayerSpawnOverride | null;
  localPlayerName?: string;
  localPlayerPaletteName?: ChickenPaletteName | null;
  matchColorSeed: number;
  captureMode?: RuntimeCaptureMode;
  portalScene?: PortalSceneConfig | null;
  presentation?: ShellPresentation;
  qualityTier?: QualityTier;
  runtimeSettings?: RuntimeControlSettings;
  workerFactory?: GameWorkerFactory;
}

type GameShellIntent =
  | { type: "load_map"; document: MapDocumentV1 }
  | { type: "set_editor_state"; next: Partial<EditorPanelState> };

const POINTER_CAPTURE_TIMEOUT_MS = 1_500;
const isRuntimeMode = (mode: ActiveShellMode) =>
  mode === "explore" || mode === "playNpc" || mode === "multiplayer";

const isFormElement = (target: EventTarget | null) =>
  target instanceof HTMLInputElement ||
  target instanceof HTMLTextAreaElement ||
  target instanceof HTMLSelectElement;

const getViewport = (canvas: HTMLCanvasElement) => {
  const rect = canvas.getBoundingClientRect();
  return {
    viewportWidth: Math.max(1, Math.round(rect.width || canvas.clientWidth || window.innerWidth)),
    viewportHeight: Math.max(1, Math.round(rect.height || canvas.clientHeight || window.innerHeight)),
    devicePixelRatio: typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1
  };
};

export class GameClient {
  static mount(options: GameClientMountOptions) {
    return new GameClient(options);
  }

  private readonly canvas: HTMLCanvasElement;
  private readonly callbacks: GameClientCallbacks;
  private readonly renderWorker: GameWorkerLike;
  private readonly externalWorker: GameWorkerLike | null;
  private readonly initialDocument: MapDocumentV1;
  private mode: ActiveShellMode;
  private presentation: ShellPresentation;
  private qualityTier: QualityTier;
  private runtimeSettings: RuntimeControlSettings | undefined;
  private localPlayerName: string | undefined;
  private localPlayerPaletteName: ChickenPaletteName | null | undefined;
  private initialSpawnStyle: SimulationInitialSpawnStyle;
  private localPlayerSpawnOverride: SimulationPlayerSpawnOverride | null;
  private matchColorSeed: number;
  private captureMode: RuntimeCaptureMode;
  private portalScene: PortalSceneConfig | null;
  private runtimePaused = true;
  private runtimeHasStarted = false;
  private pointerLocked = false;
  private pointerCapturePending = false;
  private pointerCaptureFailureReason: PointerCaptureFailureReason | null = null;
  private pointerCaptureTimeoutId: number | null = null;
  private pointerCaptureRequestVersion = 0;
  private pendingResumeAfterPointerLock = false;
  private pendingDocumentResolvers = new Map<string, (document: MapDocumentV1) => void>();

  private constructor({
    canvas,
    initialDocument,
    initialMode,
    initialSpawnStyle = "ground",
    localPlayerSpawnOverride = null,
    localPlayerName,
    localPlayerPaletteName,
    matchColorSeed,
    captureMode = "locked",
    portalScene = null,
    presentation = "default",
    qualityTier = "medium",
    runtimeSettings,
    workerFactory,
    ...callbacks
  }: GameClientMountOptions) {
    this.canvas = canvas;
    this.initialDocument = initialDocument ?? createDefaultArenaMap();
    this.mode = initialMode;
    this.presentation = presentation;
    this.qualityTier = qualityTier;
    this.runtimeSettings = runtimeSettings;
    this.localPlayerName = localPlayerName;
    this.localPlayerPaletteName = localPlayerPaletteName;
    this.initialSpawnStyle = initialSpawnStyle;
    this.localPlayerSpawnOverride = localPlayerSpawnOverride;
    this.matchColorSeed = matchColorSeed;
    this.captureMode = captureMode;
    this.portalScene = portalScene;
    this.runtimePaused = isRuntimeMode(this.mode) ? this.captureMode !== "free" : false;
    this.runtimeHasStarted = isRuntimeMode(this.mode) && this.captureMode === "free";
    this.callbacks = callbacks;
    this.renderWorker = createLocalGameWorker();
    this.externalWorker = workerFactory ? workerFactory() : null;

    this.attachRenderWorker();
    this.attachExternalWorker();
    this.attachHostEvents();
    this.bootRenderWorker();
    this.bootExternalWorker();
    this.emitPauseState();
  }

  private attachRenderWorker() {
    this.renderWorker.onmessage = (event: MessageEvent<WorkerResponseMessage>) => {
      const message = event.data;
      switch (message.type) {
        case "ready":
          this.callbacks.onEditorStateChange?.(message.editorState);
          return;
        case "editor_state":
          this.callbacks.onEditorStateChange?.(message.editorState);
          return;
        case "hud_state":
          this.callbacks.onHudStateChange?.(message.hudState);
          return;
        case "status":
          this.callbacks.onStatus?.(message.message);
          return;
        case "portal_triggered":
          this.callbacks.onPortalTriggered?.(message.portalId, message.snapshot);
          return;
        case "diagnostics":
          this.callbacks.onDiagnostics?.(message.diagnostics);
          return;
        case "editor_document": {
          const resolver = this.pendingDocumentResolvers.get(message.requestId);
          if (resolver) {
            this.pendingDocumentResolvers.delete(message.requestId);
            resolver(message.document);
          }
          return;
        }
        case "ready_to_display":
          this.callbacks.onReadyToDisplay?.();
          return;
        case "runtime_input_packet":
          if (!this.externalWorker) {
            return;
          }
          this.externalWorker.postMessage(
            {
              type: "set_runtime_input",
              buffer: message.buffer
            } satisfies WorkerRequestMessage,
            [message.buffer]
          );
          return;
        default:
          return;
      }
    };
  }

  private attachExternalWorker() {
    if (!this.externalWorker) {
      return;
    }

    this.externalWorker.onmessage = ((event: MessageEvent<SourceWorkerResponseMessage>) => {
      this.renderWorker.postMessage({
        type: "external_message",
        message: event.data
      } satisfies WorkerRequestMessage);
    }) as GameWorkerLike["onmessage"];
  }

  private attachHostEvents() {
    window.addEventListener("resize", this.handleResize);
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
    window.addEventListener("blur", this.handleWindowBlur);
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
    document.addEventListener("pointerlockchange", this.handlePointerLockChange);
    document.addEventListener("pointerlockerror", this.handlePointerLockError);
    this.canvas.addEventListener("pointerdown", this.handlePointerDown);
    window.addEventListener("pointerup", this.handlePointerUp);
    window.addEventListener("pointercancel", this.handlePointerCancel as EventListener);
    this.canvas.addEventListener("pointermove", this.handlePointerMove);
    this.canvas.addEventListener("contextmenu", this.handleContextMenu);
  }

  private bootRenderWorker() {
    const transferControlToOffscreen = (this.canvas as HTMLCanvasElement & {
      transferControlToOffscreen?: () => OffscreenCanvas;
    }).transferControlToOffscreen;
    const offscreenCanvas = transferControlToOffscreen?.call(this.canvas);
    const viewport = getViewport(this.canvas);

    this.renderWorker.postMessage(
      {
        type: "init",
        document: this.initialDocument,
        mode: this.mode,
        offscreenCanvas,
        viewportWidth: viewport.viewportWidth,
        viewportHeight: viewport.viewportHeight,
        devicePixelRatio: viewport.devicePixelRatio,
        presentation: this.presentation,
        qualityTier: this.qualityTier,
        runtimeSettings: this.runtimeSettings,
        matchColorSeed: this.matchColorSeed,
        ...(this.localPlayerName ? { localPlayerName: this.localPlayerName } : {}),
        ...(this.localPlayerPaletteName !== undefined
          ? { localPlayerPaletteName: this.localPlayerPaletteName }
          : {}),
        ...(isRuntimeMode(this.mode)
          ? {
              initialSpawnStyle: this.initialSpawnStyle,
              localPlayerSpawnOverride: this.localPlayerSpawnOverride,
              captureMode: this.captureMode,
              portalScene: this.portalScene
            }
          : {})
      } satisfies WorkerRequestMessage,
      offscreenCanvas ? [offscreenCanvas] : []
    );
  }

  private bootExternalWorker() {
    if (!this.externalWorker) {
      return;
    }

    this.externalWorker.postMessage({
      type: "init",
      document: this.initialDocument,
      mode: this.mode,
      ...(this.localPlayerName ? { localPlayerName: this.localPlayerName } : {}),
      ...(isRuntimeMode(this.mode)
        ? {
            initialSpawnStyle: this.initialSpawnStyle,
            localPlayerSpawnOverride: this.localPlayerSpawnOverride,
            captureMode: this.captureMode,
            portalScene: this.portalScene
          }
        : {})
    } satisfies WorkerRequestMessage);
  }

  setShellState(nextState: {
    mode: ActiveShellMode;
    initialSpawnStyle?: SimulationInitialSpawnStyle;
    localPlayerSpawnOverride?: SimulationPlayerSpawnOverride | null;
    localPlayerName?: string;
    localPlayerPaletteName?: ChickenPaletteName | null;
    captureMode?: RuntimeCaptureMode;
    portalScene?: PortalSceneConfig | null;
    presentation?: ShellPresentation;
    qualityTier?: QualityTier;
    runtimeSettings?: RuntimeControlSettings;
  }) {
    const previousMode = this.mode;
    const previousCaptureMode = this.captureMode;
    this.mode = nextState.mode;
    this.captureMode = nextState.captureMode ?? this.captureMode;
    this.portalScene =
      "portalScene" in nextState ? nextState.portalScene ?? null : this.portalScene;
    this.presentation = nextState.presentation ?? this.presentation;
    this.qualityTier = nextState.qualityTier ?? this.qualityTier;
    this.runtimeSettings =
      "runtimeSettings" in nextState && nextState.runtimeSettings
        ? nextState.runtimeSettings
        : this.runtimeSettings;
    if ("localPlayerName" in nextState) {
      this.localPlayerName = nextState.localPlayerName;
    }
    if ("localPlayerPaletteName" in nextState) {
      this.localPlayerPaletteName = nextState.localPlayerPaletteName ?? null;
    }
    this.initialSpawnStyle = nextState.initialSpawnStyle ?? this.initialSpawnStyle;
    if ("localPlayerSpawnOverride" in nextState) {
      this.localPlayerSpawnOverride = nextState.localPlayerSpawnOverride ?? null;
    }

    this.renderWorker.postMessage({
      type: "set_mode",
      mode: this.mode,
      captureMode: this.captureMode,
      portalScene: this.portalScene,
      presentation: this.presentation,
      qualityTier: this.qualityTier,
      runtimeSettings: this.runtimeSettings,
      ...(this.localPlayerName ? { localPlayerName: this.localPlayerName } : {}),
      ...(this.localPlayerPaletteName !== undefined
        ? { localPlayerPaletteName: this.localPlayerPaletteName }
        : {}),
      ...(isRuntimeMode(this.mode)
        ? {
            initialSpawnStyle: this.initialSpawnStyle,
            localPlayerSpawnOverride: this.localPlayerSpawnOverride
          }
        : {})
    } satisfies WorkerRequestMessage);

    if (this.externalWorker) {
      this.externalWorker.postMessage({
        type: "set_mode",
        mode: this.mode,
        captureMode: this.captureMode,
        portalScene: this.portalScene,
        ...(this.localPlayerName ? { localPlayerName: this.localPlayerName } : {}),
        ...(isRuntimeMode(this.mode)
          ? {
              initialSpawnStyle: this.initialSpawnStyle,
              localPlayerSpawnOverride: this.localPlayerSpawnOverride
            }
          : {})
      } satisfies WorkerRequestMessage);
    }

    if (!isRuntimeMode(this.mode)) {
      this.runtimePaused = false;
      this.pendingResumeAfterPointerLock = false;
    } else if (!isRuntimeMode(previousMode) || previousCaptureMode !== this.captureMode) {
      this.pendingResumeAfterPointerLock = false;
      if (this.captureMode === "free") {
        this.runtimePaused = false;
        this.runtimeHasStarted = true;
        this.resetPointerCaptureState();
      } else {
        this.runtimePaused = true;
      }
    }
    this.emitPauseState();
  }

  dispatchShellIntent(intent: GameShellIntent) {
    if (intent.type === "load_map") {
      this.renderWorker.postMessage({
        type: "load_map",
        document: intent.document
      } satisfies WorkerRequestMessage);
      return;
    }

    this.renderWorker.postMessage({
      type: "set_editor_state",
      ...intent.next
    } satisfies WorkerRequestMessage);
  }

  requestEditorDocument() {
    const requestId = `editor-doc-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return new Promise<MapDocumentV1>((resolve) => {
      this.pendingDocumentResolvers.set(requestId, resolve);
      this.renderWorker.postMessage({
        type: "request_editor_document",
        requestId
      } satisfies WorkerRequestMessage);
    });
  }

  requestPointerLock() {
    if (!isRuntimeMode(this.mode) || this.presentation === "menu") {
      return false;
    }

    if (this.captureMode === "free") {
      this.runtimeHasStarted = true;
      this.resetPointerCaptureState();
      this.emitPauseState();
      return true;
    }

    if (this.pointerLocked) {
      this.resetPointerCaptureState();
      this.emitPauseState();
      return true;
    }

    if (typeof this.canvas.requestPointerLock !== "function") {
      this.resolvePointerCaptureFailure("unsupported");
      return false;
    }

    const requestVersion = this.beginPointerCaptureRequest();

    try {
      const requestResult = this.canvas.requestPointerLock();
      if (requestResult && typeof (requestResult as PromiseLike<unknown>).then === "function") {
        void (requestResult as PromiseLike<unknown>).then(undefined, () => {
          if (this.pointerCapturePending && this.pointerCaptureRequestVersion === requestVersion) {
            this.resolvePointerCaptureFailure("error");
          }
        });
      }
    } catch {
      if (this.pointerCaptureRequestVersion === requestVersion) {
        this.resolvePointerCaptureFailure("error");
      }
      return false;
    }

    return true;
  }

  resumeRuntime() {
    if (!isRuntimeMode(this.mode)) {
      return;
    }

    if (this.captureMode === "free") {
      this.runtimeHasStarted = true;
      this.setRuntimePaused(false);
      return;
    }

    if (this.pointerLocked) {
      this.pendingResumeAfterPointerLock = false;
      this.setRuntimePaused(false);
      return;
    }

    this.pendingResumeAfterPointerLock = true;
    if (!this.requestPointerLock()) {
      this.pendingResumeAfterPointerLock = false;
    }
  }

  setRuntimePaused(paused: boolean) {
    this.runtimePaused = paused;
    if (!paused && isRuntimeMode(this.mode)) {
      this.runtimeHasStarted = true;
    }
    this.renderWorker.postMessage({
      type: "set_runtime_paused",
      paused
    } satisfies WorkerRequestMessage);
    if (!paused) {
      this.pendingResumeAfterPointerLock = false;
    }
    this.emitPauseState();
  }

  dispose() {
    window.removeEventListener("resize", this.handleResize);
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    window.removeEventListener("blur", this.handleWindowBlur);
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    document.removeEventListener("pointerlockchange", this.handlePointerLockChange);
    document.removeEventListener("pointerlockerror", this.handlePointerLockError);
    this.canvas.removeEventListener("pointerdown", this.handlePointerDown);
    window.removeEventListener("pointerup", this.handlePointerUp);
    window.removeEventListener("pointercancel", this.handlePointerCancel as EventListener);
    this.canvas.removeEventListener("pointermove", this.handlePointerMove);
    this.canvas.removeEventListener("contextmenu", this.handleContextMenu);
    this.clearPointerCaptureTimeout();
    this.externalWorker?.terminate();
    this.renderWorker.terminate();
  }

  private readonly handleResize = () => {
    const viewport = getViewport(this.canvas);
    this.renderWorker.postMessage({
      type: "resize",
      ...viewport
    } satisfies WorkerRequestMessage);
  };

  private readonly handleKeyDown = (event: KeyboardEvent) => {
    if (isFormElement(event.target)) {
      return;
    }

    if (
      this.captureMode === "free" &&
      isRuntimeMode(this.mode) &&
      event.code === "Escape" &&
      !event.repeat
    ) {
      event.preventDefault();
      if (!this.runtimePaused) {
        this.setRuntimePaused(true);
      }
      return;
    }

    this.renderWorker.postMessage({
      type: "key_event",
      code: event.code,
      key: event.key,
      eventType: "down",
      repeat: event.repeat,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      timeMs: performance.now()
    } satisfies WorkerRequestMessage);
  };

  private readonly handleKeyUp = (event: KeyboardEvent) => {
    if (isFormElement(event.target)) {
      return;
    }

    this.renderWorker.postMessage({
      type: "key_event",
      code: event.code,
      key: event.key,
      eventType: "up",
      repeat: false,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      timeMs: performance.now()
    } satisfies WorkerRequestMessage);
  };

  private readonly handlePointerDown = (event: PointerEvent) => {
    if (this.presentation === "menu") {
      return;
    }

    if (
      isRuntimeMode(this.mode) &&
      this.captureMode !== "free" &&
      !this.pointerLocked
    ) {
      this.requestPointerLock();
      return;
    }

    if (isRuntimeMode(this.mode) && this.runtimePaused) {
      return;
    }

    this.renderWorker.postMessage({
      type: "pointer_button",
      button: event.button,
      clientX: event.clientX,
      clientY: event.clientY,
      eventType: "down"
    } satisfies WorkerRequestMessage);
  };

  private readonly handlePointerMove = (event: PointerEvent) => {
    this.renderWorker.postMessage({
      type: "pointer_move",
      clientX: event.clientX,
      clientY: event.clientY,
      movementX: event.movementX,
      movementY: event.movementY
    } satisfies WorkerRequestMessage);
  };

  private readonly handlePointerUp = (event: PointerEvent) => {
    this.renderWorker.postMessage({
      type: "pointer_button",
      button: event.button,
      clientX: event.clientX,
      clientY: event.clientY,
      eventType: "up"
    } satisfies WorkerRequestMessage);
  };

  private readonly handlePointerCancel = () => {
    this.renderWorker.postMessage({
      type: "pointer_button",
      button: -1,
      clientX: 0,
      clientY: 0,
      eventType: "cancel"
    } satisfies WorkerRequestMessage);
  };

  private readonly handleContextMenu = (event: MouseEvent) => {
    event.preventDefault();
  };

  private readonly handlePointerLockChange = () => {
    const locked = document.pointerLockElement === this.canvas;
    this.pointerLocked = locked;
    this.runtimeHasStarted = this.runtimeHasStarted || locked;
    this.renderWorker.postMessage({
      type: "pointer_lock_change",
      locked
    } satisfies WorkerRequestMessage);

    if (!isRuntimeMode(this.mode)) {
      return;
    }

    if (!locked) {
      this.resetPointerCaptureState();
      this.pendingResumeAfterPointerLock = false;
      this.setRuntimePaused(true);
      return;
    }

    this.resetPointerCaptureState();
    if (this.pendingResumeAfterPointerLock) {
      this.pendingResumeAfterPointerLock = false;
      this.setRuntimePaused(false);
      return;
    }

    this.emitPauseState();
  };

  private readonly handlePointerLockError = () => {
    if (!isRuntimeMode(this.mode) || !this.pointerCapturePending) {
      return;
    }

    this.resolvePointerCaptureFailure("error");
  };

  private readonly handleVisibilityChange = () => {
    if (!isRuntimeMode(this.mode) || !this.pointerCapturePending || !document.hidden) {
      return;
    }

    this.resolvePointerCaptureFailure("focus-lost");
  };

  private readonly handleWindowBlur = () => {
    if (!isRuntimeMode(this.mode) || !this.pointerCapturePending) {
      return;
    }

    this.resolvePointerCaptureFailure("focus-lost");
  };

  private clearPointerCaptureTimeout() {
    if (this.pointerCaptureTimeoutId !== null) {
      window.clearTimeout(this.pointerCaptureTimeoutId);
      this.pointerCaptureTimeoutId = null;
    }
  }

  private beginPointerCaptureRequest() {
    this.clearPointerCaptureTimeout();
    this.pointerCaptureRequestVersion += 1;
    this.pointerCapturePending = true;
    this.pointerCaptureFailureReason = null;
    const requestVersion = this.pointerCaptureRequestVersion;
    this.pointerCaptureTimeoutId = window.setTimeout(() => {
      if (this.pointerCapturePending && this.pointerCaptureRequestVersion === requestVersion) {
        this.resolvePointerCaptureFailure("timeout");
      }
    }, POINTER_CAPTURE_TIMEOUT_MS);
    this.emitPauseState();
    return requestVersion;
  }

  private resetPointerCaptureState() {
    this.pointerCapturePending = false;
    this.pointerCaptureFailureReason = null;
    this.clearPointerCaptureTimeout();
  }

  private resolvePointerCaptureFailure(reason: PointerCaptureFailureReason) {
    this.pointerCapturePending = false;
    this.pointerCaptureFailureReason = reason;
    this.pendingResumeAfterPointerLock = false;
    this.clearPointerCaptureTimeout();

    if (this.runtimePaused) {
      this.emitPauseState();
      return;
    }

    this.setRuntimePaused(true);
  }

  private emitPauseState() {
    this.callbacks.onPauseStateChange?.({
      paused: this.runtimePaused,
      hasStarted: this.runtimeHasStarted,
      pointerLocked: this.pointerLocked,
      pointerCapturePending: this.pointerCapturePending,
      pointerCaptureFailureReason: this.pointerCaptureFailureReason
    });
  }
}
