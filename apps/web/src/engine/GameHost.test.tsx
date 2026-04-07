import { createRef } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultArenaMap } from "@out-of-bounds/map";
import type { RuntimeControlSettings } from "../game/runtimeControlSettings";
import type { GameHostHandle } from "./GameHost";
import type { ActiveShellMode } from "./types";

const gameClientState = vi.hoisted(() => {
  const mockClient = {
    dispatchShellIntent: vi.fn(),
    dispose: vi.fn(),
    requestPointerLock: vi.fn(),
    requestEditorDocument: vi.fn(),
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
  });

  it("mounts the imperative game client with the shell callbacks and initial mode", async () => {
    const initialDocument = createDefaultArenaMap();
    const onDiagnostics = vi.fn();
    const onEditorStateChange = vi.fn();
    const onHudStateChange = vi.fn();
    const onPauseStateChange = vi.fn();
    const onReadyToDisplay = vi.fn();
    const onStatus = vi.fn();

    render(
      <GameHost
        initialDocument={initialDocument}
        matchColorSeed={17}
        mode="explore"
        onDiagnostics={onDiagnostics}
        onEditorStateChange={onEditorStateChange}
        onHudStateChange={onHudStateChange}
        onPauseStateChange={onPauseStateChange}
        onReadyToDisplay={onReadyToDisplay}
        onStatus={onStatus}
      />
    );

    await waitFor(() => {
      expect(gameClientState.mount).toHaveBeenCalledTimes(1);
    });

    expect(gameClientState.mount).toHaveBeenCalledWith(
      expect.objectContaining({
        canvas: expect.any(HTMLCanvasElement),
        initialDocument,
        initialMode: "explore",
        matchColorSeed: 17,
        onDiagnostics,
        onEditorStateChange,
        onHudStateChange,
        onPauseStateChange,
        onReadyToDisplay,
        onStatus
      })
    );
    expect(screen.getByTestId("runtime-reticle")).toBeInTheDocument();
  });

  it("keeps the same mounted client when only the shell mode changes", async () => {
    const initialDocument = createDefaultArenaMap();
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
    expect(screen.queryByTestId("runtime-reticle")).not.toBeInTheDocument();

    gameClientState.mount.mockClear();
    gameClientState.mockClient.setShellState.mockClear();

    rerender(
      <GameHost
        initialDocument={initialDocument}
        matchColorSeed={9}
        mode="playNpc"
      />
    );

    await waitFor(() => {
      expect(gameClientState.mockClient.setShellState).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: "playNpc",
          presentation: "default"
        })
      );
    });

    expect(gameClientState.mount).not.toHaveBeenCalled();
    expect(screen.getByTestId("runtime-reticle")).toBeInTheDocument();
  });

  it("passes player profile and menu presentation through to the client shell state", async () => {
    const initialDocument = createDefaultArenaMap();
    const { rerender } = render(
      <GameHost
        initialDocument={initialDocument}
        matchColorSeed={5}
        mode="editor"
        playerProfile={{ name: "Anthony", paletteName: "gold" }}
        presentation="menu"
      />
    );

    await waitFor(() => {
      expect(gameClientState.mount).toHaveBeenCalledWith(
        expect.objectContaining({
          localPlayerName: "Anthony",
          localPlayerPaletteName: "gold",
          presentation: "menu"
        })
      );
    });

    gameClientState.mockClient.setShellState.mockClear();

    rerender(
      <GameHost
        initialDocument={initialDocument}
        initialSpawnStyle="sky"
        matchColorSeed={5}
        mode="explore"
        playerProfile={{ name: "Anthony", paletteName: "gold" }}
        presentation="default"
      />
    );

    await waitFor(() => {
      expect(gameClientState.mockClient.setShellState).toHaveBeenCalledWith({
        mode: "explore",
        initialSpawnStyle: "sky",
        localPlayerName: "Anthony",
        localPlayerPaletteName: "gold",
        presentation: "default"
      });
    });
  });

  it("forwards runtime settings through mount and live shell updates without remounting", async () => {
    const initialDocument = createDefaultArenaMap();
    const initialRuntimeSettings: RuntimeControlSettings = {
      lookSensitivity: 1.4,
      invertLookX: true,
      invertLookY: false
    };
    const nextRuntimeSettings: RuntimeControlSettings = {
      lookSensitivity: 0.8,
      invertLookX: false,
      invertLookY: true
    };
    const { rerender } = render(
      <GameHost
        initialDocument={initialDocument}
        matchColorSeed={12}
        mode="explore"
        runtimeSettings={initialRuntimeSettings}
      />
    );

    await waitFor(() => {
      expect(gameClientState.mount).toHaveBeenCalledWith(
        expect.objectContaining({
          runtimeSettings: initialRuntimeSettings
        })
      );
    });

    gameClientState.mount.mockClear();
    gameClientState.mockClient.setShellState.mockClear();

    rerender(
      <GameHost
        initialDocument={initialDocument}
        matchColorSeed={12}
        mode="explore"
        runtimeSettings={nextRuntimeSettings}
      />
    );

    await waitFor(() => {
      expect(gameClientState.mockClient.setShellState).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: "explore",
          runtimeSettings: nextRuntimeSettings
        })
      );
    });

    expect(gameClientState.mount).not.toHaveBeenCalled();
  });

  it("forwards the ready-to-display callback to the mounted client", async () => {
    const onReadyToDisplay = vi.fn();

    render(
      <GameHost
        initialDocument={createDefaultArenaMap()}
        matchColorSeed={5}
        mode="editor"
        onReadyToDisplay={onReadyToDisplay}
      />
    );

    await waitFor(() => {
      expect(gameClientState.mount).toHaveBeenCalledWith(
        expect.objectContaining({
          onReadyToDisplay
        })
      );
    });
  });

  it("forwards imperative host methods to the mounted game client", async () => {
    const initialDocument = createDefaultArenaMap();
    const nextDocument = {
      ...initialDocument,
      meta: {
        ...initialDocument.meta,
        name: "Imported Arena"
      }
    };
    const ref = createRef<GameHostHandle>();
    gameClientState.mockClient.requestEditorDocument.mockResolvedValue(nextDocument);

    render(
      <GameHost
        ref={ref}
        initialDocument={initialDocument}
        matchColorSeed={4}
        mode="explore"
      />
    );

    await waitFor(() => {
      expect(ref.current).not.toBeNull();
    });

    await act(async () => {
      expect(await ref.current?.getEditorDocument()).toEqual(nextDocument);
    });

    act(() => {
      ref.current?.loadMap(nextDocument);
      ref.current?.requestPointerLock();
      ref.current?.resumeRuntime();
      ref.current?.setRuntimePaused(true);
      ref.current?.setEditorState({ mapName: "Workshop Copy" });
      ref.current?.setShellMode("editor");
    });

    expect(gameClientState.mockClient.requestEditorDocument).toHaveBeenCalledTimes(1);
    expect(gameClientState.mockClient.dispatchShellIntent).toHaveBeenNthCalledWith(1, {
      type: "load_map",
      document: nextDocument
    });
    expect(gameClientState.mockClient.requestPointerLock).toHaveBeenCalledTimes(1);
    expect(gameClientState.mockClient.resumeRuntime).toHaveBeenCalledTimes(1);
    expect(gameClientState.mockClient.setRuntimePaused).toHaveBeenCalledWith(true);
    expect(gameClientState.mockClient.dispatchShellIntent).toHaveBeenNthCalledWith(2, {
      type: "set_editor_state",
      next: { mapName: "Workshop Copy" }
    });
    expect(gameClientState.mockClient.setShellState).toHaveBeenLastCalledWith({ mode: "editor" });
  });

  it("disposes the mounted client when the host unmounts", async () => {
    const initialDocument = createDefaultArenaMap();
    const { unmount } = render(
      <GameHost
        initialDocument={initialDocument}
        matchColorSeed={11}
        mode={"explore" satisfies ActiveShellMode}
      />
    );

    await waitFor(() => {
      expect(gameClientState.mount).toHaveBeenCalledTimes(1);
    });

    unmount();

    expect(gameClientState.mockClient.dispose).toHaveBeenCalledTimes(1);
  });
});
