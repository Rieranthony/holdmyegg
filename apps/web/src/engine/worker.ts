/// <reference lib="webworker" />

import {
  DEFAULT_CHUNK_SIZE,
  MutableVoxelWorld,
  createDefaultArenaMap,
  normalizeArenaBudgetMapDocument,
  type MapDocumentV1
} from "@out-of-bounds/map";
import {
  OutOfBoundsSimulation,
  type GameMode,
  type SimulationInitialSpawnStyle,
  type SimulationPerformanceDiagnostics
} from "@out-of-bounds/sim";
import { meshTerrainChunk } from "../game/terrainMesher";
import { clearTransientRuntimeInputFlags, unpackRuntimeInputCommand, type RuntimeInputCommand } from "./runtimeInput";
import type { WorkerRequestMessage, WorkerResponseMessage } from "./protocol";
import type {
  ActiveShellMode,
  EditorPanelState,
  GameDiagnostics,
  RuntimeRenderFrame,
  StaticWorldPayload,
  TerrainChunkPatchPayload
} from "./types";

const workerScope = self as DedicatedWorkerGlobalScope;
const EMPTY_DIAGNOSTICS: SimulationPerformanceDiagnostics = {
  skyDropUpdateMs: 0,
  skyDropLandingMs: 0,
  detachedComponentMs: 0,
  fallingClusterLandingMs: 0,
  fixedStepMaxStepsPerFrame: 0,
  fixedStepClampedFrames: 0,
  fixedStepDroppedMs: 0
};

const createEditorWorld = (document: MapDocumentV1) => {
  const world = new MutableVoxelWorld(normalizeArenaBudgetMapDocument(document));
  world.settleDetachedComponents();
  return world;
};

const createDefaultEditorState = (world: MutableVoxelWorld): EditorPanelState => ({
  mapName: world.meta.name,
  tool: "add",
  blockKind: "ground",
  propKind: "tree-oak"
});

const createEmptyRuntimeInputCommand = (seq = 0): RuntimeInputCommand => ({
  seq,
  moveX: 0,
  moveZ: 0,
  lookX: 1,
  lookZ: 0,
  eggCharge: 0,
  eggPitch: 0,
  jump: false,
  jumpPressed: false,
  jumpReleased: false,
  destroy: false,
  place: false,
  push: false,
  layEgg: false,
  targetVoxel: null,
  targetNormal: null
});

let mode: ActiveShellMode = "editor";
let editorWorld = createEditorWorld(createDefaultArenaMap());
let editorState = createDefaultEditorState(editorWorld);
let runtime = new OutOfBoundsSimulation();
let runtimePaused = true;
let latestRuntimeInput = createEmptyRuntimeInputCommand();
let lastRuntimeTerrainRevision = 0;
let hudTickCounter = 0;
let diagnosticsTickCounter = 0;
let latestDirtyChunkCount = 0;
let tickTimer: number | null = null;
let localPlayerName = "You";
let initialSpawnStyle: SimulationInitialSpawnStyle = "ground";

const postToMain = (message: WorkerResponseMessage, transferables: Transferable[] = []) => {
  workerScope.postMessage(message, transferables);
};

const buildChunkPatch = (world: MutableVoxelWorld, key: string): TerrainChunkPatchPayload => {
  const chunk = world.buildVisibleChunkByKey(key, DEFAULT_CHUNK_SIZE);
  if (!chunk) {
    return {
      key,
      position: [0, 0, 0],
      materialGroups: [],
      visibleVoxelCount: 0,
      triangleCount: 0,
      drawCallCount: 0,
      remove: true
    };
  }

  const meshData = meshTerrainChunk(chunk);
  return {
    key,
    position: [meshData.chunkOffset.x, meshData.chunkOffset.y, meshData.chunkOffset.z],
    materialGroups: meshData.materialGroups.map((group) => ({
      materialIndex: group.materialIndex,
      start: group.start,
      count: group.count
    })),
    visibleVoxelCount: meshData.visibleVoxelCount,
    triangleCount: meshData.triangleCount,
    drawCallCount: meshData.drawCallCount,
    positions: new Float32Array(meshData.positions),
    normals: new Float32Array(meshData.normals),
    uvs: new Float32Array(meshData.uvs),
    colors: new Float32Array(meshData.colors),
    indices: new Uint32Array(meshData.indices)
  };
};

const getChunkTransferables = (patches: TerrainChunkPatchPayload[]) =>
  patches.flatMap((patch) => {
    const transferables: Transferable[] = [];
    if (patch.positions) transferables.push(patch.positions.buffer);
    if (patch.normals) transferables.push(patch.normals.buffer);
    if (patch.uvs) transferables.push(patch.uvs.buffer);
    if (patch.colors) transferables.push(patch.colors.buffer);
    if (patch.indices) transferables.push(patch.indices.buffer);
    return transferables;
  });

const postWorldSync = (world: MutableVoxelWorld) => {
  const chunkPatches = world.buildVisibleChunks(DEFAULT_CHUNK_SIZE).map((chunk) => buildChunkPatch(world, chunk.key));
  const message: WorkerResponseMessage = {
    type: "world_sync",
    mode,
    world: {
      document: world.toDocument(),
      terrainRevision: world.getTerrainRevision(),
      chunkPatches
    } satisfies StaticWorldPayload
  };

  postToMain(message, getChunkTransferables(chunkPatches));
};

const postTerrainPatches = (world: MutableVoxelWorld, keys: string[]) => {
  if (keys.length === 0) {
    return;
  }

  const patches = keys.map((key) => buildChunkPatch(world, key));
  postToMain(
    {
      type: "terrain_patches",
      terrainRevision: world.getTerrainRevision(),
      patches
    },
    getChunkTransferables(patches)
  );
};

const buildRuntimeFrame = (): RuntimeRenderFrame => {
  const matchState = runtime.getMatchState();
  return {
    tick: matchState.tick,
    time: matchState.time,
    mode: matchState.mode,
    localPlayerId: matchState.localPlayerId,
    players: runtime
      .getPlayerIds()
      .map((playerId) => runtime.getPlayerRuntimeState(playerId))
      .filter((player): player is NonNullable<ReturnType<typeof runtime.getPlayerRuntimeState>> => player !== null),
    eggs: runtime.getEggIds().map((eggId) => runtime.getEggRuntimeState(eggId)).filter((egg): egg is NonNullable<ReturnType<typeof runtime.getEggRuntimeState>> => egg !== null),
    eggScatterDebris: runtime.getEggScatterDebris(),
    voxelBursts: runtime.getVoxelBursts(),
    skyDrops: runtime.getSkyDrops(),
    fallingClusters: runtime.getFallingClusters()
  };
};

const postHudState = () => {
  postToMain({
    type: "hud_state",
    hudState: mode === "editor" ? null : runtime.getHudState()
  });
};

const postEditorState = () => {
  postToMain({
    type: "editor_state",
    editorState
  });
};

const postStatus = (message: string) => {
  postToMain({
    type: "status",
    message
  });
};

const postDiagnostics = () => {
  const diagnostics: GameDiagnostics = {
    mode,
    tick: mode === "editor" ? 0 : runtime.getMatchState().tick,
    terrainRevision: (mode === "editor" ? editorWorld : runtime.getWorld()).getTerrainRevision(),
    dirtyChunkCount: latestDirtyChunkCount,
    runtime: mode === "editor" ? EMPTY_DIAGNOSTICS : runtime.consumePerformanceDiagnostics()
  };

  postToMain({
    type: "diagnostics",
    diagnostics
  });
};

const setEditorMapName = (nextName: string) => {
  const trimmed = nextName.trimStart();
  editorWorld.meta.name = trimmed || "Untitled Arena";
  editorWorld.touchMeta();
  editorState = {
    ...editorState,
    mapName: nextName
  };
  postEditorState();
};

const switchToMode = (nextMode: ActiveShellMode) => {
  mode = nextMode;
  latestRuntimeInput = createEmptyRuntimeInputCommand(latestRuntimeInput.seq);
  hudTickCounter = 0;
  diagnosticsTickCounter = 0;
  latestDirtyChunkCount = 0;

  if (nextMode === "editor") {
    runtimePaused = true;
    postWorldSync(editorWorld);
    postEditorState();
    postHudState();
    postDiagnostics();
    return;
  }

  runtime.reset(nextMode as GameMode, editorWorld.toDocument(), {
    npcCount: nextMode === "skirmish" ? 4 : 0,
    localPlayerName,
    initialSpawnStyle
  });
  runtimePaused = true;
  lastRuntimeTerrainRevision = runtime.getWorld().getTerrainRevision();
  postWorldSync(runtime.getWorld());
  postToMain({
    type: "frame",
    frame: buildRuntimeFrame()
  });
  postHudState();
  postDiagnostics();
};

const applyEditorAction = (voxel: { x: number; y: number; z: number }, normal: { x: number; y: number; z: number }) => {
  if (mode !== "editor") {
    return;
  }

  let dirtyChunkKeys: string[] = [];
  let touchedTerrain = false;
  let requiresFullWorldSync = false;

  if (editorState.tool === "erase") {
    const prop = editorWorld.getPropAtVoxel(voxel.x, voxel.y, voxel.z);
    if (prop) {
      editorWorld.removeProp(prop.id);
      requiresFullWorldSync = true;
      postStatus("Removed a tree.");
    } else {
      dirtyChunkKeys = [...editorWorld.removeVoxel(voxel.x, voxel.y, voxel.z)];
      touchedTerrain = dirtyChunkKeys.length > 0;
    }
  } else if (editorState.tool === "add") {
    const placement = {
      x: voxel.x + normal.x,
      y: voxel.y + normal.y,
      z: voxel.z + normal.z
    };
    if (editorWorld.hasSolid(placement.x, placement.y, placement.z)) {
      postStatus("That space is already occupied.");
    } else {
      dirtyChunkKeys = [...editorWorld.setVoxel(placement.x, placement.y, placement.z, editorState.blockKind)];
      touchedTerrain = dirtyChunkKeys.length > 0;
    }
  } else if (editorState.tool === "prop") {
    const placement = editorWorld.getEditablePropPlacement(editorState.propKind, voxel.x, voxel.z);
    if (!placement) {
      postStatus("Tree placement is blocked on that column.");
    } else {
      editorWorld.setProp(editorState.propKind, placement.x, placement.y, placement.z);
      requiresFullWorldSync = true;
      postStatus("Placed a tree.");
    }
  } else {
    const spawn = editorWorld.getEditableSpawnPosition(voxel.x, voxel.z);
    editorWorld.setSpawn(spawn.x, spawn.y, spawn.z);
    requiresFullWorldSync = true;
    postStatus("Placed a nest spawn.");
  }

  if (touchedTerrain) {
    const settleResult = editorWorld.settleDetachedComponents();
    dirtyChunkKeys = [...new Set([...dirtyChunkKeys, ...settleResult.dirtyChunkKeys])];
    if (settleResult.components.length > 0) {
      postStatus("Detached terrain settled into place.");
    } else {
      postStatus(`${editorState.tool === "add" ? "Added" : "Removed"} cubes in the arena.`);
    }
  }

  latestDirtyChunkCount = dirtyChunkKeys.length;
  if (requiresFullWorldSync) {
    postWorldSync(editorWorld);
  } else if (dirtyChunkKeys.length > 0) {
    postTerrainPatches(editorWorld, dirtyChunkKeys);
  }

  postDiagnostics();
};

const loadEditorWorld = (document: MapDocumentV1) => {
  editorWorld = createEditorWorld(document);
  editorState = {
    ...editorState,
    mapName: editorWorld.meta.name
  };
  postEditorState();
  if (mode === "editor") {
    postWorldSync(editorWorld);
    postHudState();
    postDiagnostics();
  }
};

const runRuntimeTick = () => {
  if (mode === "editor" || runtimePaused) {
    return;
  }

  const localPlayerId = runtime.getLocalPlayerId();
  runtime.step(localPlayerId ? { [localPlayerId]: latestRuntimeInput } : {}, 1 / runtime.config.tickRate);
  latestRuntimeInput = clearTransientRuntimeInputFlags(latestRuntimeInput);

  const terrainRevision = runtime.getWorld().getTerrainRevision();
  if (terrainRevision !== lastRuntimeTerrainRevision) {
    lastRuntimeTerrainRevision = terrainRevision;
    const dirtyChunkKeys = runtime.consumeDirtyChunkKeys();
    latestDirtyChunkCount = dirtyChunkKeys.length;
    postTerrainPatches(runtime.getWorld(), dirtyChunkKeys);
  } else {
    latestDirtyChunkCount = 0;
  }

  postToMain({
    type: "frame",
    frame: buildRuntimeFrame()
  });

  hudTickCounter += 1;
  if (hudTickCounter >= 15) {
    hudTickCounter = 0;
    postHudState();
  }

  diagnosticsTickCounter += 1;
  if (diagnosticsTickCounter >= 30) {
    diagnosticsTickCounter = 0;
    postDiagnostics();
  }
};

const ensureTickLoop = () => {
  if (tickTimer !== null) {
    return;
  }

  tickTimer = workerScope.setInterval(runRuntimeTick, 1000 / runtime.config.tickRate);
};

const handleMessage = (message: WorkerRequestMessage) => {
  switch (message.type) {
    case "init":
      editorWorld = createEditorWorld(message.document);
      editorState = createDefaultEditorState(editorWorld);
      localPlayerName = message.localPlayerName?.trim() || "You";
      initialSpawnStyle = message.initialSpawnStyle ?? "ground";
      latestRuntimeInput = createEmptyRuntimeInputCommand();
      postToMain({
        type: "ready",
        editorState
      });
      switchToMode(message.mode);
      ensureTickLoop();
      return;
    case "set_mode":
      localPlayerName = message.localPlayerName?.trim() || localPlayerName;
      initialSpawnStyle = message.initialSpawnStyle ?? "ground";
      switchToMode(message.mode);
      return;
    case "set_runtime_input":
      latestRuntimeInput = unpackRuntimeInputCommand(message.buffer);
      return;
    case "set_editor_state":
      if (message.tool) {
        editorState = {
          ...editorState,
          tool: message.tool
        };
      }
      if (message.blockKind) {
        editorState = {
          ...editorState,
          blockKind: message.blockKind
        };
      }
      if (message.propKind) {
        editorState = {
          ...editorState,
          propKind: message.propKind
        };
      }
      if (typeof message.mapName === "string") {
        setEditorMapName(message.mapName);
      } else {
        postEditorState();
      }
      return;
    case "perform_editor_action":
      applyEditorAction(message.voxel, message.normal);
      return;
    case "load_map":
      loadEditorWorld(message.document);
      return;
    case "request_editor_document":
      postToMain({
        type: "editor_document",
        requestId: message.requestId,
        document: editorWorld.toDocument()
      });
      return;
    case "set_runtime_paused":
      runtimePaused = message.paused;
      if (!runtimePaused) {
        postToMain({
          type: "frame",
          frame: buildRuntimeFrame()
        });
        postHudState();
      }
      return;
  }
};

workerScope.onmessage = (event: MessageEvent<WorkerRequestMessage>) => {
  handleMessage(event.data);
};

export {};
