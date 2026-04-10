import type { MapDocumentV1 } from "@out-of-bounds/map";
import type { HudState, SimulationInitialSpawnStyle } from "@out-of-bounds/sim";
import type { ChickenPaletteName } from "../game/colors";
import type { QualityTier } from "../game/quality";
import type { RuntimeControlSettings } from "../game/runtimeControlSettings";
import type {
  ActiveShellMode,
  EditorPanelState,
  EditorTool,
  GameDiagnostics,
  RuntimeRenderFrame,
  ShellPresentation,
  StaticWorldPayload
} from "./types";

export interface WorkerInitMessage {
  type: "init";
  document: MapDocumentV1;
  mode: ActiveShellMode;
  matchColorSeed?: number;
  offscreenCanvas?: OffscreenCanvas;
  presentation?: ShellPresentation;
  qualityTier?: QualityTier;
  runtimeSettings?: RuntimeControlSettings;
  viewportHeight?: number;
  viewportWidth?: number;
  devicePixelRatio?: number;
  localPlayerName?: string;
  localPlayerPaletteName?: ChickenPaletteName | null;
  initialSpawnStyle?: SimulationInitialSpawnStyle;
}

export interface WorkerSetModeMessage {
  type: "set_mode";
  mode: ActiveShellMode;
  presentation?: ShellPresentation;
  qualityTier?: QualityTier;
  runtimeSettings?: RuntimeControlSettings;
  localPlayerName?: string;
  localPlayerPaletteName?: ChickenPaletteName | null;
  initialSpawnStyle?: SimulationInitialSpawnStyle;
}

export interface WorkerRuntimeInputMessage {
  type: "set_runtime_input";
  buffer: ArrayBuffer;
}

export interface WorkerSetEditorStateMessage {
  type: "set_editor_state";
  tool?: EditorTool;
  blockKind?: EditorPanelState["blockKind"];
  propKind?: EditorPanelState["propKind"];
  featureKind?: EditorPanelState["featureKind"];
  featureDirection?: EditorPanelState["featureDirection"];
  mapName?: string;
}

export interface WorkerPerformEditorActionMessage {
  type: "perform_editor_action";
  voxel: { x: number; y: number; z: number };
  normal: { x: number; y: number; z: number };
}

export interface WorkerLoadMapMessage {
  type: "load_map";
  document: MapDocumentV1;
}

export interface WorkerRequestDocumentMessage {
  type: "request_editor_document";
  requestId: string;
}

export interface WorkerSetPausedMessage {
  type: "set_runtime_paused";
  paused: boolean;
}

export interface WorkerResizeMessage {
  type: "resize";
  viewportHeight: number;
  viewportWidth: number;
  devicePixelRatio: number;
}

export interface WorkerKeyEventMessage {
  type: "key_event";
  code: string;
  key: string;
  eventType: "down" | "up";
  repeat: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  timeMs: number;
}

export interface WorkerPointerMoveMessage {
  type: "pointer_move";
  clientX: number;
  clientY: number;
  movementX: number;
  movementY: number;
}

export interface WorkerPointerButtonMessage {
  type: "pointer_button";
  button: number;
  clientX: number;
  clientY: number;
  eventType: "down" | "up" | "cancel";
}

export interface WorkerPointerLockChangeMessage {
  type: "pointer_lock_change";
  locked: boolean;
}

export interface WorkerForwardExternalMessage {
  type: "external_message";
  message: SourceWorkerResponseMessage;
}

export type WorkerRequestMessage =
  | WorkerInitMessage
  | WorkerForwardExternalMessage
  | WorkerKeyEventMessage
  | WorkerLoadMapMessage
  | WorkerPointerButtonMessage
  | WorkerPointerLockChangeMessage
  | WorkerPointerMoveMessage
  | WorkerPerformEditorActionMessage
  | WorkerRequestDocumentMessage
  | WorkerResizeMessage
  | WorkerRuntimeInputMessage
  | WorkerSetEditorStateMessage
  | WorkerSetModeMessage
  | WorkerSetPausedMessage;

export interface WorkerReadyMessage {
  type: "ready";
  editorState: EditorPanelState;
}

export interface WorkerWorldSyncMessage {
  type: "world_sync";
  mode: ActiveShellMode;
  world: StaticWorldPayload;
}

export interface WorkerFrameMessage {
  type: "frame";
  frame: RuntimeRenderFrame;
}

export interface WorkerTerrainPatchesMessage {
  type: "terrain_patches";
  terrainRevision: number;
  patches: StaticWorldPayload["chunkPatches"];
}

export interface WorkerHudStateMessage {
  type: "hud_state";
  hudState: HudState | null;
}

export interface WorkerEditorStateMessage {
  type: "editor_state";
  editorState: EditorPanelState;
}

export interface WorkerStatusMessage {
  type: "status";
  message: string;
}

export interface WorkerDocumentResponseMessage {
  type: "editor_document";
  requestId: string;
  document: MapDocumentV1;
}

export interface WorkerDiagnosticsMessage {
  type: "diagnostics";
  diagnostics: GameDiagnostics;
}

export interface WorkerReadyToDisplayMessage {
  type: "ready_to_display";
}

export interface WorkerRuntimeInputPacketMessage {
  type: "runtime_input_packet";
  buffer: ArrayBuffer;
}

export type SourceWorkerResponseMessage =
  | WorkerDiagnosticsMessage
  | WorkerDocumentResponseMessage
  | WorkerEditorStateMessage
  | WorkerFrameMessage
  | WorkerHudStateMessage
  | WorkerReadyMessage
  | WorkerStatusMessage
  | WorkerTerrainPatchesMessage
  | WorkerWorldSyncMessage;

export type WorkerResponseMessage =
  | SourceWorkerResponseMessage
  | WorkerReadyToDisplayMessage
  | WorkerRuntimeInputPacketMessage;
