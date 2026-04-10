import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultArenaMap } from "@out-of-bounds/map";
import type { WorkerResponseMessage } from "./protocol";

const workerState = vi.hoisted(() => {
  const renderWorker = {
    postMessage: vi.fn(),
    terminate: vi.fn(),
    onmessage: null as ((event: MessageEvent<WorkerResponseMessage>) => void) | null
  };
  const externalWorker = {
    postMessage: vi.fn(),
    terminate: vi.fn(),
    onmessage: null as ((event: MessageEvent<WorkerResponseMessage>) => void) | null
  };

  return {
    externalWorker,
    renderWorker
  };
});

vi.mock("./workerBridge", () => ({
  createLocalGameWorker: () => workerState.renderWorker
}));

import { GameClient } from "./GameClient";

const createCanvas = () => {
  const canvas = document.createElement("canvas");
  const offscreen = { width: 640, height: 360 } as OffscreenCanvas;
  Object.defineProperty(canvas, "clientWidth", {
    configurable: true,
    value: 640
  });
  Object.defineProperty(canvas, "clientHeight", {
    configurable: true,
    value: 360
  });
  canvas.getBoundingClientRect = () =>
    ({
      width: 640,
      height: 360,
      top: 0,
      left: 0,
      bottom: 360,
      right: 640,
      x: 0,
      y: 0,
      toJSON: () => ({})
    }) as DOMRect;
  Object.defineProperty(canvas, "transferControlToOffscreen", {
    configurable: true,
    value: vi.fn(() => offscreen)
  });
  Object.defineProperty(canvas, "requestPointerLock", {
    configurable: true,
    value: vi.fn()
  });
  return { canvas, offscreen };
};

const setPointerLockElement = (element: Element | null) => {
  Object.defineProperty(document, "pointerLockElement", {
    configurable: true,
    writable: true,
    value: element
  });
};

describe("GameClient worker controller", () => {
  beforeEach(() => {
    workerState.renderWorker.postMessage.mockClear();
    workerState.renderWorker.terminate.mockClear();
    workerState.renderWorker.onmessage = null;
    workerState.externalWorker.postMessage.mockClear();
    workerState.externalWorker.terminate.mockClear();
    workerState.externalWorker.onmessage = null;
    setPointerLockElement(null);
  });

  it("boots the OffscreenCanvas render worker with shell state", () => {
    const { canvas, offscreen } = createCanvas();
    GameClient.mount({
      canvas,
      initialDocument: createDefaultArenaMap(),
      initialMode: "explore",
      matchColorSeed: 11,
      qualityTier: "high",
      presentation: "default"
    });

    expect(workerState.renderWorker.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "init",
        offscreenCanvas: offscreen,
        matchColorSeed: 11,
        mode: "explore",
        qualityTier: "high",
        presentation: "default"
      }),
      [offscreen]
    );
  });

  it("forwards multiplayer bridge messages into the render worker", () => {
    const { canvas } = createCanvas();
    GameClient.mount({
      canvas,
      initialDocument: createDefaultArenaMap(),
      initialMode: "multiplayer",
      matchColorSeed: 5,
      workerFactory: () => workerState.externalWorker
    });

    workerState.externalWorker.onmessage?.({
      data: {
        type: "status",
        message: "Room ready."
      }
    } as MessageEvent<WorkerResponseMessage>);

    expect(workerState.renderWorker.postMessage).toHaveBeenCalledWith({
      type: "external_message",
      message: {
        type: "status",
        message: "Room ready."
      }
    });
  });

  it("relays worker diagnostics, ready, and multiplayer input packets", () => {
    const { canvas } = createCanvas();
    const onDiagnostics = vi.fn();
    const onHudStateChange = vi.fn();
    const onReadyToDisplay = vi.fn();
    const client = GameClient.mount({
      canvas,
      initialDocument: createDefaultArenaMap(),
      initialMode: "multiplayer",
      matchColorSeed: 7,
      onDiagnostics,
      onHudStateChange,
      onReadyToDisplay,
      workerFactory: () => workerState.externalWorker
    });

    const inputBuffer = new ArrayBuffer(16);
    workerState.renderWorker.onmessage?.({
      data: {
        type: "runtime_input_packet",
        buffer: inputBuffer
      }
    } as MessageEvent<WorkerResponseMessage>);
    workerState.renderWorker.onmessage?.({
      data: {
        type: "hud_state",
        hudState: null
      }
    } as MessageEvent<WorkerResponseMessage>);
    workerState.renderWorker.onmessage?.({
      data: {
        type: "diagnostics",
        diagnostics: {
          mode: "multiplayer",
          tick: 4,
          terrainRevision: 2,
          dirtyChunkCount: 1,
          runtime: {
            skyDropUpdateMs: 0,
            skyDropLandingMs: 0,
            detachedComponentMs: 0,
            fallingClusterLandingMs: 0,
            fixedStepMaxStepsPerFrame: 0,
            fixedStepClampedFrames: 0,
            fixedStepDroppedMs: 0
          },
          render: {
            fps: 60,
            p95FrameMs: 17,
            renderCalls: 8,
            renderTriangles: 256,
            geometries: 10,
            textures: 4,
            terrainChunkCount: 6,
            terrainDrawCalls: 12,
            terrainTriangles: 90,
            qualityTier: "medium",
            targetFps: 90,
            sunShadowsEnabled: false,
            shadowMapRefreshCount: 0
          }
        }
      }
    } as MessageEvent<WorkerResponseMessage>);
    workerState.renderWorker.onmessage?.({
      data: {
        type: "ready_to_display"
      }
    } as MessageEvent<WorkerResponseMessage>);

    expect(workerState.externalWorker.postMessage).toHaveBeenCalledWith(
      {
        type: "set_runtime_input",
        buffer: inputBuffer
      },
      [inputBuffer]
    );
    expect(onHudStateChange).toHaveBeenCalledWith(null);
    expect(onDiagnostics).toHaveBeenCalled();
    expect(onReadyToDisplay).toHaveBeenCalledTimes(1);

    client.dispose();
  });

  it("tracks pointer-lock pause state and forwards resize + pause commands", () => {
    const { canvas } = createCanvas();
    const onPauseStateChange = vi.fn();
    const client = GameClient.mount({
      canvas,
      initialDocument: createDefaultArenaMap(),
      initialMode: "explore",
      matchColorSeed: 3,
      onPauseStateChange
    });

    expect(client.requestPointerLock()).toBe(true);
    expect(canvas.requestPointerLock).toHaveBeenCalledTimes(1);

    setPointerLockElement(canvas);
    document.dispatchEvent(new Event("pointerlockchange"));

    expect(workerState.renderWorker.postMessage).toHaveBeenCalledWith({
      type: "pointer_lock_change",
      locked: true
    });
    expect(onPauseStateChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        pointerLocked: true
      })
    );

    client.setRuntimePaused(true);
    expect(workerState.renderWorker.postMessage).toHaveBeenCalledWith({
      type: "set_runtime_paused",
      paused: true
    });

    window.dispatchEvent(new Event("resize"));
    expect(workerState.renderWorker.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "resize",
        viewportWidth: 640,
        viewportHeight: 360
      })
    );
  });
});
