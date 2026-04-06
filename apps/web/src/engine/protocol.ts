import type { MapDocumentV1 } from "@out-of-bounds/map";
import type { HudState, SimulationInitialSpawnStyle } from "@out-of-bounds/sim";
import type {
  ActiveShellMode,
  EditorPanelState,
  EditorTool,
  GameDiagnostics,
  RuntimeRenderFrame,
  StaticWorldPayload
} from "./types";

export interface WorkerInitMessage {
  type: "init";
  document: MapDocumentV1;
  mode: ActiveShellMode;
  localPlayerName?: string;
  initialSpawnStyle?: SimulationInitialSpawnStyle;
}

export interface WorkerSetModeMessage {
  type: "set_mode";
  mode: ActiveShellMode;
  localPlayerName?: string;
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

export type WorkerRequestMessage =
  | WorkerInitMessage
  | WorkerLoadMapMessage
  | WorkerPerformEditorActionMessage
  | WorkerRequestDocumentMessage
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

export type WorkerResponseMessage =
  | WorkerDiagnosticsMessage
  | WorkerDocumentResponseMessage
  | WorkerEditorStateMessage
  | WorkerFrameMessage
  | WorkerHudStateMessage
  | WorkerReadyMessage
  | WorkerStatusMessage
  | WorkerTerrainPatchesMessage
  | WorkerWorldSyncMessage;
