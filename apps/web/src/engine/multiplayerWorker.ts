import {
  DEFAULT_CHUNK_SIZE,
  MutableVoxelWorld,
  createDefaultArenaMap,
  normalizeArenaBudgetMapDocument,
  type MapDocumentV1
} from "@out-of-bounds/map";
import {
  createRuntimeRenderFrame,
  type ServerBootstrapFrame,
  type ServerStateDeltaFrame
} from "@out-of-bounds/netcode";
import type { TerrainDeltaBatch } from "@out-of-bounds/sim";
import type {
  WorkerRequestMessage,
  WorkerResponseMessage
} from "./protocol";
import type {
  GameWorkerLike
} from "./workerBridge";
import type {
  StaticWorldPayload
} from "./types";
import type {
  MultiplayerClient,
  MultiplayerRealtimeEvent
} from "../multiplayer/client";
import {
  applyTerrainDeltaBatchToWorld,
  buildTerrainChunkPatch
} from "./multiplayerTerrain";

const createWorld = (document: MapDocumentV1) => {
  const world = new MutableVoxelWorld(normalizeArenaBudgetMapDocument(document));
  world.settleDetachedComponents();
  return world;
};

const postWorkerMessage = (
  handler: ((event: MessageEvent<WorkerResponseMessage>) => void) | null,
  message: WorkerResponseMessage
) => {
  handler?.({
    data: message
  } as MessageEvent<WorkerResponseMessage>);
};

export class MultiplayerWorkerBridge implements GameWorkerLike {
  onmessage: ((event: MessageEvent<WorkerResponseMessage>) => void) | null = null;
  private unsubscribeRealtime: (() => void) | null = null;
  private world: MutableVoxelWorld | null = null;
  private currentDocument: MapDocumentV1 | null = null;
  private lastStatusMessage: string | null = null;
  private initialized = false;

  constructor(private readonly client: MultiplayerClient) {}

  postMessage(message: WorkerRequestMessage, transfer?: Transferable[]) {
    void transfer;
    switch (message.type) {
      case "init":
        this.initialized = true;
        this.unsubscribeRealtime?.();
        this.unsubscribeRealtime = this.client.subscribeRealtime((event) => {
          this.handleRealtimeEvent(event);
        });
        this.emitBootstrapIfReady();
        return;
      case "set_runtime_input":
        this.client.sendRuntimeInput(message.buffer);
        return;
      case "request_editor_document":
        postWorkerMessage(this.onmessage, {
          type: "editor_document",
          requestId: message.requestId,
          document:
            this.currentDocument ??
            this.client.getLastWorldDocument() ??
            normalizeArenaBudgetMapDocument(createDefaultArenaMap())
        });
        return;
      case "set_runtime_paused":
      case "set_mode":
      case "load_map":
      case "perform_editor_action":
      case "set_editor_state":
        return;
    }
  }

  terminate() {
    this.unsubscribeRealtime?.();
    this.unsubscribeRealtime = null;
  }

  private emitBootstrapIfReady() {
    const bootstrap = this.client.getLastBootstrap();
    if (bootstrap) {
      this.applyBootstrap(bootstrap);
      return;
    }

    this.emitStatus(this.client.getSnapshot().statusMessage);
  }

  private handleRealtimeEvent(event: MultiplayerRealtimeEvent) {
    if (!this.initialized) {
      return;
    }

    switch (event.type) {
      case "bootstrap":
        this.applyBootstrap(event.frame);
        return;
      case "delta":
        this.applyDelta(event.frame);
        return;
      case "room_state":
        this.emitStatus(event.room.countdown.reason);
        return;
      case "status":
        this.emitStatus(event.message);
        return;
      case "control":
        if (event.message.type === "error") {
          this.emitStatus(event.message.message);
        }
        return;
    }
  }

  private applyBootstrap(frame: ServerBootstrapFrame) {
    this.currentDocument = normalizeArenaBudgetMapDocument(frame.world.document);
    this.world = createWorld(frame.world.document);
    const chunkPatches = this.world
      .buildVisibleChunks(DEFAULT_CHUNK_SIZE)
      .map((chunk) => buildTerrainChunkPatch(this.world!, chunk.key));

    postWorkerMessage(this.onmessage, {
      type: "world_sync",
      mode: "multiplayer",
      world: {
        document: this.currentDocument,
        terrainRevision: frame.world.terrainRevision,
        chunkPatches
      } satisfies StaticWorldPayload
    });

    const runtimeFrame = createRuntimeRenderFrame(frame.sharedFrame, frame.localOverlay);
    postWorkerMessage(this.onmessage, {
      type: "frame",
      frame: runtimeFrame
    });
    postWorkerMessage(this.onmessage, {
      type: "hud_state",
      hudState: runtimeFrame.hudState
    });
    this.emitStatus(frame.room.countdown.reason);
  }

  private applyDelta(frame: ServerStateDeltaFrame) {
    if (!this.world) {
      this.emitBootstrapIfReady();
      return;
    }

    if (frame.sharedFrame.terrainDeltaBatch) {
      const patches = this.applyTerrainDeltaBatch(frame.sharedFrame.terrainDeltaBatch);
      if (patches.length > 0) {
        postWorkerMessage(this.onmessage, {
          type: "terrain_patches",
          terrainRevision: frame.sharedFrame.terrainDeltaBatch.terrainRevision,
          patches
        });
      }
    }

    const runtimeFrame = createRuntimeRenderFrame(frame.sharedFrame, frame.localOverlay);
    postWorkerMessage(this.onmessage, {
      type: "frame",
      frame: runtimeFrame
    });
    postWorkerMessage(this.onmessage, {
      type: "hud_state",
      hudState: runtimeFrame.hudState
    });
    this.emitStatus(frame.room.countdown.reason);
  }

  private applyTerrainDeltaBatch(batch: TerrainDeltaBatch) {
    if (!this.world) {
      return [];
    }

    const result = applyTerrainDeltaBatchToWorld(this.world, batch);
    this.currentDocument = result.document;
    return result.patches;
  }

  private emitStatus(message: string) {
    if (!message || message === this.lastStatusMessage) {
      return;
    }

    this.lastStatusMessage = message;
    postWorkerMessage(this.onmessage, {
      type: "status",
      message
    });
  }
}
