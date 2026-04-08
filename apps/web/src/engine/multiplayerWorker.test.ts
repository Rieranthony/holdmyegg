import { describe, expect, it, vi } from "vitest";
import { createDefaultArenaMap } from "@out-of-bounds/map";
import type {
  JoinedRoomState,
  ServerBootstrapFrame,
  ServerStateDeltaFrame
} from "@out-of-bounds/netcode";
import type { MultiplayerRealtimeEvent } from "../multiplayer/client";
import { MultiplayerWorkerBridge } from "./multiplayerWorker";

const createRoomState = (reason = "Waiting for countdown."): JoinedRoomState => ({
  roomId: "warm-1",
  roomName: "Warm Room 1",
  mapId: "map-1",
  mapName: "Arena",
  region: "local-us",
  phase: "live",
  capacity: 24,
  joinable: true,
  countdown: {
    active: false,
    startsAt: null,
    secondsRemaining: 0,
    reason
  },
  players: [],
  score: {
    updatedAt: new Date(0).toISOString(),
    entries: []
  }
});

const createSharedFrame = (terrainDeltaBatch: ServerStateDeltaFrame["sharedFrame"]["terrainDeltaBatch"] = null) => ({
  tick: 1,
  time: 0,
  mode: "multiplayer" as const,
  players: [],
  eggs: [],
  eggScatterDebris: [],
  voxelBursts: [],
  skyDrops: [],
  fallingClusters: [],
  authoritativeState: {
    tick: 1,
    time: 0,
    mode: "multiplayer" as const,
    localPlayerId: null,
    players: [],
    projectiles: [],
    hazards: {
      fallingClusters: [],
      skyDrops: [],
      eggScatterDebris: []
    },
    stats: {
      terrainRevision: 0
    },
    ranking: []
  },
  terrainDeltaBatch,
  gameplayEventBatch: null
});

const createBootstrapFrame = (): ServerBootstrapFrame => ({
  kind: "bootstrap",
  room: createRoomState(),
  world: {
    document: createDefaultArenaMap(),
    terrainRevision: 1
  },
  sharedFrame: createSharedFrame(),
  localOverlay: {
    localPlayerId: null,
    hudState: null,
    focusState: null
  },
  recentChat: []
});

const createDeltaFrame = (): ServerStateDeltaFrame => {
  const document = createDefaultArenaMap();
  const target = document.voxels[0]!;
  return {
    kind: "delta",
    room: createRoomState("Starting in 9s."),
    sharedFrame: createSharedFrame({
      tick: 2,
      terrainRevision: 2,
      changes: [
        {
          voxel: {
            x: target.x,
            y: target.y,
            z: target.z
          },
          kind: null,
          operation: "remove",
          source: "destroy"
        }
      ]
    }),
    localOverlay: {
      localPlayerId: null,
      hudState: null,
      focusState: null
    }
  };
};

class FakeMultiplayerClient {
  bootstrap: ServerBootstrapFrame | null = null;
  document = createDefaultArenaMap();
  snapshot = {
    statusMessage: "Multiplayer ready."
  };
  readonly sendRuntimeInput = vi.fn();
  private readonly listeners = new Set<(event: MultiplayerRealtimeEvent) => void>();

  getLastBootstrap() {
    return this.bootstrap;
  }

  getLastWorldDocument() {
    return this.document;
  }

  getSnapshot() {
    return this.snapshot as { statusMessage: string };
  }

  subscribeRealtime(listener: (event: MultiplayerRealtimeEvent) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(event: MultiplayerRealtimeEvent) {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

describe("MultiplayerWorkerBridge", () => {
  it("turns bootstrap frames into world, frame, hud, and status worker messages", () => {
    const client = new FakeMultiplayerClient();
    client.bootstrap = createBootstrapFrame();
    const worker = new MultiplayerWorkerBridge(client as never);
    const messages: { type: string }[] = [];
    worker.onmessage = (event) => {
      messages.push(event.data as { type: string });
    };

    worker.postMessage({
      type: "init",
      document: createDefaultArenaMap(),
      mode: "multiplayer"
    });

    expect(messages.map((message) => message.type)).toEqual([
      "world_sync",
      "frame",
      "hud_state",
      "status"
    ]);
  });

  it("applies delta terrain patches, forwards runtime input, and returns the latest editor document", () => {
    const client = new FakeMultiplayerClient();
    client.bootstrap = createBootstrapFrame();
    const worker = new MultiplayerWorkerBridge(client as never);
    const messages: { type: string; [key: string]: unknown }[] = [];
    worker.onmessage = (event) => {
      messages.push(event.data as { type: string; [key: string]: unknown });
    };

    worker.postMessage({
      type: "init",
      document: createDefaultArenaMap(),
      mode: "multiplayer"
    });
    messages.length = 0;

    client.emit({
      type: "delta",
      frame: createDeltaFrame()
    });
    const runtimeInputBuffer = new Uint8Array([1, 2, 3]).buffer;
    worker.postMessage({
      type: "set_runtime_input",
      buffer: runtimeInputBuffer
    }, [runtimeInputBuffer]);
    worker.postMessage({
      type: "request_editor_document",
      requestId: "req-1"
    });

    expect(messages.map((message) => message.type)).toEqual([
      "terrain_patches",
      "frame",
      "hud_state",
      "status",
      "editor_document"
    ]);
    expect(client.sendRuntimeInput).toHaveBeenCalledTimes(1);
    expect(client.sendRuntimeInput).toHaveBeenCalledWith(runtimeInputBuffer);
    expect(messages[0]?.patches).toBeTruthy();
    expect(messages.at(-1)).toMatchObject({
      type: "editor_document",
      requestId: "req-1"
    });
  });

  it("surfaces status events and ignores unsupported worker requests", () => {
    const client = new FakeMultiplayerClient();
    const worker = new MultiplayerWorkerBridge(client as never);
    const messages: { type: string; [key: string]: unknown }[] = [];
    worker.onmessage = (event) => {
      messages.push(event.data as { type: string; [key: string]: unknown });
    };

    worker.postMessage({
      type: "init",
      document: createDefaultArenaMap(),
      mode: "multiplayer"
    });
    messages.length = 0;

    client.emit({
      type: "status",
      message: "Connection lost."
    });
    client.emit({
      type: "control",
      message: {
        type: "error",
        code: "oops",
        message: "Reconnect failed."
      }
    });
    worker.postMessage({
      type: "set_mode",
      mode: "multiplayer"
    });
    worker.postMessage({
      type: "set_runtime_paused",
      paused: true
    });

    expect(messages).toEqual([
      {
        type: "status",
        message: "Connection lost."
      },
      {
        type: "status",
        message: "Reconnect failed."
      }
    ]);
  });
});
