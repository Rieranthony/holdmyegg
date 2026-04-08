import type {
  AuthoritativeMatchState,
  FallingClusterViewState,
  GameMode,
  GameplayEventBatch,
  HudState,
  RuntimeInteractionFocusState,
  RuntimeEggScatterDebrisState,
  RuntimeEggState,
  RuntimePlayerState,
  RuntimeSkyDropState,
  RuntimeVoxelBurstState,
  SimulationPerformanceDiagnostics,
  TerrainDeltaBatch
} from "@out-of-bounds/sim";
import type { BlockKind, MapDocumentV1, MapPropKind } from "@out-of-bounds/map";
import type { ChickenPaletteName } from "../game/colors";

export type ShellMode =
  | "boot"
  | "menu"
  | "multiplayerMenu"
  | "rules"
  | "editor"
  | GameMode;
export type ActiveShellMode = "editor" | GameMode;
export type ShellPresentation = "default" | "menu";
export type EditorTool = "add" | "erase" | "spawn" | "prop";
export type PointerCaptureFailureReason =
  | "unsupported"
  | "error"
  | "timeout"
  | "focus-lost";

export interface PlayerProfile {
  name: string;
  paletteName: ChickenPaletteName | null;
}

export interface RuntimePauseState {
  hasStarted: boolean;
  paused: boolean;
  pointerLocked: boolean;
  pointerCapturePending: boolean;
  pointerCaptureFailureReason: PointerCaptureFailureReason | null;
}

export interface RuntimeOverlayState {
  matterPulseActive: boolean;
  spaceFailPulseActive: boolean;
  spaceMistakePulseActive: boolean;
  spaceSuccessPulseActive: boolean;
  spaceLocalTargetKey: string | null;
  spaceLocalHitCount: number;
}

export const blockKindOptions: BlockKind[] = ["ground", "boundary", "hazard"];
export const propKindOptions: MapPropKind[] = ["tree-oak"];

export interface EditorPanelState {
  mapName: string;
  tool: EditorTool;
  blockKind: BlockKind;
  propKind: MapPropKind;
}

export interface TerrainChunkMaterialGroupPayload {
  materialIndex: number;
  start: number;
  count: number;
}

export interface TerrainChunkPatchPayload {
  key: string;
  position: [number, number, number];
  materialGroups: TerrainChunkMaterialGroupPayload[];
  visibleVoxelCount: number;
  triangleCount: number;
  drawCallCount: number;
  remove?: boolean;
  positions?: Float32Array;
  normals?: Float32Array;
  uvs?: Float32Array;
  colors?: Float32Array;
  indices?: Uint32Array;
}

export interface StaticWorldPayload {
  document: MapDocumentV1;
  terrainRevision: number;
  chunkPatches: TerrainChunkPatchPayload[];
}

export interface RuntimeAuthoritativeFrame {
  state: AuthoritativeMatchState;
  terrainDeltaBatch: TerrainDeltaBatch | null;
  gameplayEventBatch: GameplayEventBatch | null;
}

export interface RuntimeRenderFrame {
  tick: number;
  time: number;
  mode: GameMode;
  localPlayerId: string | null;
  hudState: HudState | null;
  focusState: RuntimeInteractionFocusState | null;
  authoritative?: RuntimeAuthoritativeFrame;
  players: RuntimePlayerState[];
  eggs: RuntimeEggState[];
  eggScatterDebris: RuntimeEggScatterDebrisState[];
  voxelBursts: RuntimeVoxelBurstState[];
  skyDrops: RuntimeSkyDropState[];
  fallingClusters: FallingClusterViewState[];
}

export interface GameDiagnostics {
  mode: ActiveShellMode;
  tick: number;
  terrainRevision: number;
  dirtyChunkCount: number;
  runtime: SimulationPerformanceDiagnostics;
}

export interface GameOverlayUpdate {
  hudState?: HudState | null;
  editorState?: EditorPanelState;
  diagnostics?: GameDiagnostics;
  statusMessage?: string;
}
