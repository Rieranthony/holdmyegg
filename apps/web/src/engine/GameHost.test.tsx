import { createRef, StrictMode } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultArenaMap } from "@out-of-bounds/map";
import type { RuntimeControlSettings } from "../game/runtimeControlSettings";
import type { GameHostHandle } from "./GameHost";

const gameClientState = vi.hoisted(() => {
  const mockClient = {
    dispatchShellIntent: vi.fn(),
    dispose: vi.fn(),
    requestPointerLock: vi.fn(() => true),
    requestEditorDocument: vi.fn(async () => createDefaultArenaMap()),
    resumeRuntime: vi.fn(),
    setRuntimePaused: vi.fn(),
    setShellState: vi.fn()
  };

  return {
    mockClient,
    mount: vi.fn(() => mockClient)
  };
});

vi.mock("./GameClient", () => ({
  GameClient: {
    mount: gameClientState.mount
  }
}));

import { GameHost } from "./GameHost";

describe("GameHost", () => {
  beforeEach(() => {
    gameClientState.mount.mockClear();
    gameClientState.mockClient.dispatchShellIntent.mockClear();
    gameClientState.mockClient.dispose.mockClear();
    gameClientState.mockClient.requestPointerLock.mockClear();
    gameClientState.mockClient.requestEditorDocument.mockReset();
    gameClientState.mockClient.resumeRuntime.mockClear();
    gameClientState.mockClient.setRuntimePaused.mockClear();
    gameClientState.mockClient.setShellState.mockClear();
    Object.defineProperty(HTMLCanvasElement.prototype, "transferControlToOffscreen", {
      configurable: true,
      value: vi.fn(() => ({ width: 640, height: 360 }))
    });
    vi.stubGlobal("Worker", vi.fn());
  });

  it("mounts the imperative game client when worker rendering is supported", async () => {
    render(
      <GameHost
        initialDocument={createDefaultArenaMap()}
        matchColorSeed={17}
        mode="explore"
      />
    );

    await waitFor(() => {
      expect(gameClientState.mount).toHaveBeenCalledTimes(1);
    });

    expect(gameClientState.mount).toHaveBeenCalledWith(
      expect.objectContaining({
        canvas: expect.any(HTMLCanvasElement),
        initialMode: "explore",
        matchColorSeed: 17
      })
    );
    expect(screen.getByTestId("runtime-reticle")).toBeInTheDocument();
  });

  it("shows a clear unsupported overlay instead of mounting the client", () => {
    vi.stubGlobal("Worker", undefined);
    Object.defineProperty(HTMLCanvasElement.prototype, "transferControlToOffscreen", {
      configurable: true,
      value: undefined
    });

    render(
      <GameHost
        initialDocument={createDefaultArenaMap()}
        matchColorSeed={5}
        mode="editor"
      />
    );

    expect(gameClientState.mount).not.toHaveBeenCalled();
    expect(screen.getByText("Worker rendering is required.")).toBeInTheDocument();
  });

  it("keeps the mounted client alive across StrictMode probe mounts", async () => {
    render(
      <StrictMode>
        <GameHost
          initialDocument={createDefaultArenaMap()}
          matchColorSeed={21}
          mode="explore"
        />
      </StrictMode>
    );

    await waitFor(() => {
      expect(gameClientState.mount).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(gameClientState.mockClient.dispose).not.toHaveBeenCalled();
  });

  it("forwards shell state updates without remounting", async () => {
    const initialDocument = createDefaultArenaMap();
    const runtimeSettings: RuntimeControlSettings = {
      lookSensitivity: 1.4,
      invertLookX: true,
      invertLookY: false
    };
    const { rerender } = render(
      <GameHost
        initialDocument={initialDocument}
        matchColorSeed={9}
        mode="editor"
      />
    );

    await waitFor(() => {
      expect(gameClientState.mount).toHaveBeenCalledTimes(1);
    });

    rerender(
      <GameHost
        initialDocument={initialDocument}
        initialSpawnStyle="sky"
        matchColorSeed={9}
        mode="playNpc"
        playerProfile={{ name: "Anthony", paletteName: "gold" }}
        presentation="menu"
        runtimeSettings={runtimeSettings}
      />
    );

    await waitFor(() => {
      expect(gameClientState.mockClient.setShellState).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: "playNpc",
          initialSpawnStyle: "sky",
          localPlayerName: "Anthony",
          localPlayerPaletteName: "gold",
          presentation: "menu",
          runtimeSettings
        })
      );
    });
  });

  it("forwards imperative handle calls to the mounted client", async () => {
    const ref = createRef<GameHostHandle>();

    render(
      <GameHost
        ref={ref}
        initialDocument={createDefaultArenaMap()}
        matchColorSeed={3}
        mode="explore"
      />
    );

    await waitFor(() => {
      expect(gameClientState.mount).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      await ref.current?.getEditorDocument();
    });
    ref.current?.loadMap(createDefaultArenaMap());
    ref.current?.requestPointerLock();
    ref.current?.resumeRuntime();
    ref.current?.setRuntimePaused(true);
    ref.current?.setEditorState({ tool: "erase" });
    ref.current?.setShellMode("playNpc");

    expect(gameClientState.mockClient.requestEditorDocument).toHaveBeenCalledTimes(1);
    expect(gameClientState.mockClient.dispatchShellIntent).toHaveBeenCalled();
    expect(gameClientState.mockClient.requestPointerLock).toHaveBeenCalledTimes(1);
    expect(gameClientState.mockClient.resumeRuntime).toHaveBeenCalledTimes(1);
    expect(gameClientState.mockClient.setRuntimePaused).toHaveBeenCalledWith(true);
    expect(gameClientState.mockClient.setShellState).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "playNpc"
      })
    );
  });
});
