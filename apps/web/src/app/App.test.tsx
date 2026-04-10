import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultArenaMap, serializeMapDocument } from "@out-of-bounds/map";
import type { HudState } from "@out-of-bounds/sim";
import { RUNTIME_CONTROL_SETTINGS_STORAGE_KEY } from "../data/runtimeControlSettingsStorage";
import type { EditorPanelState } from "../engine/types";

vi.mock("../game/quality", () => ({
  useRendererQualityProfile: () => ({
    tier: "medium"
  })
}));

const createHudState = (mode: "explore" | "playNpc", playerName = "You"): HudState => ({
  mode,
  localPlayerId: "human-1",
  localPlayer: {
    id: "human-1",
    name: playerName,
    alive: true,
    grounded: true,
    mass: 24,
    maxMass: 500,
    livesRemaining: 3,
    maxLives: 3,
    respawning: false,
    invulnerableRemaining: 0,
    stunRemaining: 0
  },
  eggStatus: {
    hasMatter: true,
    ready: true,
    reason: "ready",
    canQuickEgg: true,
    canChargedThrow: true,
    activeCount: 0,
    maxActiveCount: 2,
    cost: 42,
    cooldownRemaining: 0,
    cooldownDuration: 1.6
  },
  spaceChallenge: null,
  ranking:
    mode === "playNpc"
      ? [
          { id: "human-1", name: playerName, alive: true },
          { id: "npc-1", name: "NPC 1", alive: true }
        ]
      : [{ id: "human-1", name: playerName, alive: true }]
});

const storageState = vi.hoisted(() => {
  const records = new Map<
    string,
    {
      id: string;
      name: string;
      updatedAt: string;
      document: ReturnType<typeof createDefaultArenaMap>;
    }
  >();

  return {
    records,
    reset() {
      records.clear();
    }
  };
});

const gameHostState = vi.hoisted(() => {
  let menuReadyCallback: (() => void) | null = null;
  let pointerLockBehavior: "success" | "pending" | "unsupported" = "success";
  let pauseBridge: {
    failPendingPointerLock: (
      reason: "unsupported" | "error" | "timeout" | "focus-lost",
    ) => void;
    resolvePendingPointerLock: () => void;
  } | null = null;

  return {
    reset() {
      menuReadyCallback = null;
      pointerLockBehavior = "success";
      pauseBridge = null;
    },
    setMenuReadyCallback(callback: (() => void) | null) {
      menuReadyCallback = callback;
    },
    signalMenuReady() {
      menuReadyCallback?.();
    },
    setPointerLockBehavior(behavior: "success" | "pending" | "unsupported") {
      pointerLockBehavior = behavior;
    },
    getPointerLockBehavior() {
      return pointerLockBehavior;
    },
    registerPauseBridge(
      bridge: {
        failPendingPointerLock: (
          reason: "unsupported" | "error" | "timeout" | "focus-lost",
        ) => void;
        resolvePendingPointerLock: () => void;
      } | null,
    ) {
      pauseBridge = bridge;
    },
    failPendingPointerLock(reason: "unsupported" | "error" | "timeout" | "focus-lost") {
      pauseBridge?.failPendingPointerLock(reason);
    },
    resolvePendingPointerLock() {
      pauseBridge?.resolvePendingPointerLock();
    },
  };
});

vi.mock("../engine/GameHost", () => ({
  GameHost: forwardRef(
    (
      {
        mode,
        initialDocument,
        presentation,
        playerProfile,
        onEditorStateChange,
        onDiagnostics,
        onHudStateChange,
        onPauseStateChange,
        onReadyToDisplay
      }: {
        initialDocument: ReturnType<typeof createDefaultArenaMap>;
        mode: string;
        presentation?: string;
        playerProfile?: { name: string };
        onEditorStateChange?: (state: EditorPanelState) => void;
        onDiagnostics?: (diagnostics: {
          mode: "editor" | "explore" | "playNpc";
          tick: number;
          terrainRevision: number;
          dirtyChunkCount: number;
          runtime: {
            skyDropUpdateMs: number;
            skyDropLandingMs: number;
            detachedComponentMs: number;
            fallingClusterLandingMs: number;
            fixedStepMaxStepsPerFrame: number;
            fixedStepClampedFrames: number;
            fixedStepDroppedMs: number;
          };
          render?: {
            fps: number;
            p95FrameMs: number;
            renderCalls: number;
            renderTriangles: number;
            geometries: number;
            textures: number;
            terrainChunkCount: number;
            terrainDrawCalls: number;
            terrainTriangles: number;
            qualityTier: "medium";
            targetFps: number;
            sunShadowsEnabled: boolean;
            shadowMapRefreshCount: number;
          };
        }) => void;
        onHudStateChange?: (state: HudState | null) => void;
        onPauseStateChange?: (state: {
          hasStarted: boolean;
          paused: boolean;
          pointerCaptureFailureReason:
            | "unsupported"
            | "error"
            | "timeout"
            | "focus-lost"
            | null;
          pointerCapturePending: boolean;
          pointerLocked: boolean;
        }) => void;
        onReadyToDisplay?: () => void;
      },
      ref
    ) => {
      const [document, setDocument] = useState(initialDocument);
      const [editorState, setEditorState] = useState<EditorPanelState>({
        mapName: initialDocument.meta.name,
        tool: "add",
        blockKind: "ground",
        propKind: "tree-oak",
        featureKind: "waterfall",
        featureDirection: "west"
      });
      const pointerLockedRef = useRef(false);
      const hasStartedRef = useRef(false);
      const pausedRef = useRef(false);
      const pointerCaptureFailureReasonRef = useRef<
        "unsupported" | "error" | "timeout" | "focus-lost" | null
      >(null);
      const pointerCapturePendingRef = useRef(false);
      const pendingResumeAfterPointerLockRef = useRef(false);

      const emitPauseState = () => {
        onPauseStateChange?.({
          hasStarted: hasStartedRef.current,
          paused: pausedRef.current,
          pointerCaptureFailureReason: pointerCaptureFailureReasonRef.current,
          pointerCapturePending: pointerCapturePendingRef.current,
          pointerLocked: pointerLockedRef.current,
        });
      };

      useEffect(() => {
        setDocument(initialDocument);
        setEditorState((current) => ({
          ...current,
          mapName: initialDocument.meta.name
        }));
      }, [initialDocument]);

      useEffect(() => {
        onEditorStateChange?.(editorState);
      }, [editorState, onEditorStateChange]);

      useEffect(() => {
        if (mode === "editor" && presentation === "menu") {
          gameHostState.setMenuReadyCallback(onReadyToDisplay ?? null);
          return () => {
            gameHostState.setMenuReadyCallback(null);
          };
        }

        gameHostState.setMenuReadyCallback(null);
      }, [mode, onReadyToDisplay, presentation]);

      useEffect(() => {
        if (mode === "editor") {
          pointerLockedRef.current = false;
          hasStartedRef.current = false;
          pausedRef.current = false;
          pointerCaptureFailureReasonRef.current = null;
          pointerCapturePendingRef.current = false;
          pendingResumeAfterPointerLockRef.current = false;
          onHudStateChange?.(null);
          emitPauseState();
          return;
        }

        pointerLockedRef.current = false;
        hasStartedRef.current = false;
        pausedRef.current = true;
        pointerCaptureFailureReasonRef.current = null;
        pointerCapturePendingRef.current = false;
        pendingResumeAfterPointerLockRef.current = false;
        onDiagnostics?.({
          mode: mode as "explore" | "playNpc",
          tick: 1,
          terrainRevision: 1,
          dirtyChunkCount: 0,
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
            fps: 57.4,
            p95FrameMs: 18,
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
        });
        onHudStateChange?.(createHudState(mode as "explore" | "playNpc", playerProfile?.name || "You"));
        emitPauseState();
      }, [mode, onDiagnostics, onHudStateChange, onPauseStateChange, playerProfile?.name]);

      useEffect(() => {
        gameHostState.registerPauseBridge({
          failPendingPointerLock(reason) {
            pointerLockedRef.current = false;
            pausedRef.current = true;
            pointerCapturePendingRef.current = false;
            pointerCaptureFailureReasonRef.current = reason;
            pendingResumeAfterPointerLockRef.current = false;
            emitPauseState();
          },
          resolvePendingPointerLock() {
            pointerLockedRef.current = true;
            hasStartedRef.current = true;
            pointerCapturePendingRef.current = false;
            pointerCaptureFailureReasonRef.current = null;
            pausedRef.current = !pendingResumeAfterPointerLockRef.current;
            pendingResumeAfterPointerLockRef.current = false;
            emitPauseState();
          },
        });
        return () => {
          gameHostState.registerPauseBridge(null);
        };
      }, [onPauseStateChange]);

      useImperativeHandle(
        ref,
        () => ({
          async getEditorDocument() {
            return document;
          },
          loadMap(nextDocument: ReturnType<typeof createDefaultArenaMap>) {
            setDocument(nextDocument);
            setEditorState((current) => ({
              ...current,
              mapName: nextDocument.meta.name
            }));
          },
          requestPointerLock() {
            pendingResumeAfterPointerLockRef.current = false;
            pointerCaptureFailureReasonRef.current = null;

            switch (gameHostState.getPointerLockBehavior()) {
              case "success":
                pointerLockedRef.current = true;
                hasStartedRef.current = true;
                pausedRef.current = true;
                pointerCapturePendingRef.current = false;
                emitPauseState();
                return true;
              case "pending":
                pointerLockedRef.current = false;
                pausedRef.current = true;
                pointerCapturePendingRef.current = true;
                emitPauseState();
                return true;
              case "unsupported":
                pointerLockedRef.current = false;
                pausedRef.current = true;
                pointerCapturePendingRef.current = false;
                pointerCaptureFailureReasonRef.current = "unsupported";
                emitPauseState();
                return false;
            }
          },
          resumeRuntime() {
            pointerCaptureFailureReasonRef.current = null;

            switch (gameHostState.getPointerLockBehavior()) {
              case "success":
                pointerLockedRef.current = true;
                hasStartedRef.current = true;
                pausedRef.current = false;
                pointerCapturePendingRef.current = false;
                pendingResumeAfterPointerLockRef.current = false;
                emitPauseState();
                return;
              case "pending":
                pointerLockedRef.current = false;
                pausedRef.current = true;
                pointerCapturePendingRef.current = true;
                pendingResumeAfterPointerLockRef.current = true;
                emitPauseState();
                return;
              case "unsupported":
                pointerLockedRef.current = false;
                pausedRef.current = true;
                pointerCapturePendingRef.current = false;
                pointerCaptureFailureReasonRef.current = "unsupported";
                pendingResumeAfterPointerLockRef.current = false;
                emitPauseState();
                return;
            }
          },
          setRuntimePaused(paused: boolean) {
            pausedRef.current = paused;
            hasStartedRef.current =
              hasStartedRef.current || pointerLockedRef.current || !paused;
            if (!paused) {
              pointerCapturePendingRef.current = false;
              pointerCaptureFailureReasonRef.current = null;
              pendingResumeAfterPointerLockRef.current = false;
            }
            emitPauseState();
          },
          setEditorState(
            next: Partial<{
              blockKind: "ground" | "boundary" | "hazard" | "water";
              featureDirection: "north" | "south" | "east" | "west";
              featureKind: "waterfall";
              mapName: string;
              propKind: "tree-oak" | "tree-pine" | "tree-autumn";
              tool: "add" | "erase" | "spawn" | "prop" | "feature";
            }>
          ) {
            setEditorState((current) => ({
              ...current,
              ...next
            }));
            if (typeof next.mapName === "string") {
              setDocument((current) => ({
                ...current,
                meta: {
                  ...current.meta,
                  name: next.mapName!
                }
              }));
            }
          },
          setShellMode() {}
        }),
        [document, onPauseStateChange]
      );

      return (
        <div>
          <div data-testid="game-host">{mode}</div>
          {mode !== "editor" && (
            <button
              onClick={() => {
                pointerLockedRef.current = false;
                hasStartedRef.current = true;
                pausedRef.current = true;
                pointerCapturePendingRef.current = false;
                pointerCaptureFailureReasonRef.current = null;
                pendingResumeAfterPointerLockRef.current = false;
                emitPauseState();
              }}
              type="button"
            >
              Pause runtime
            </button>
          )}
        </div>
      );
    }
  )
}));

vi.mock("../components/ChickenPreview", () => ({
  ChickenPreview: ({ paletteName }: { paletteName: string }) => <div data-testid="chicken-preview">{paletteName}</div>
}));

vi.mock("../data/mapStorage", () => ({
  listSavedMaps: vi.fn(async () =>
    [...storageState.records.values()]
      .map(({ id, name, updatedAt }) => ({
        id,
        name,
        updatedAt
      }))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  ),
  loadSavedMap: vi.fn(async (id: string) => storageState.records.get(id)),
  saveMap: vi.fn(async (document: ReturnType<typeof createDefaultArenaMap>, id?: string) => {
    const nextId = id ?? `map-${storageState.records.size + 1}`;
    storageState.records.set(nextId, {
      id: nextId,
      name: document.meta.name,
      updatedAt: new Date().toISOString(),
      document
    });
    return nextId;
  }),
  deleteSavedMap: vi.fn(async (id: string) => {
    storageState.records.delete(id);
  })
}));

import { App } from "./App";

const APP_FLOW_TIMEOUT = 60_000;
const bootSplashTotalMs = 10;
const launchIntroTotalMs = 1_100;
const advanceBootSplash = async () => {
  await act(async () => {
    vi.advanceTimersByTime(bootSplashTotalMs);
  });
};
const signalMenuReady = async () => {
  await act(async () => {
    gameHostState.signalMenuReady();
  });
};
const advanceLaunchIntro = async () => {
  await act(async () => {
    vi.advanceTimersByTime(launchIntroTotalMs);
  });
};
const setPointerLockBehavior = (
  behavior: "success" | "pending" | "unsupported",
) => {
  gameHostState.setPointerLockBehavior(behavior);
};
const failPendingPointerLock = async (
  reason: "unsupported" | "error" | "timeout" | "focus-lost",
) => {
  await act(async () => {
    gameHostState.failPendingPointerLock(reason);
  });
};
const resolvePendingPointerLock = async () => {
  await act(async () => {
    gameHostState.resolvePendingPointerLock();
  });
};

const unlockMenuPlayer = () => {
  fireEvent.change(screen.getByLabelText("Player Name"), {
    target: { value: "Anthony" }
  });
};
const openMenuControls = () => {
  fireEvent.click(screen.getByRole("button", { name: /Controls/i }));
};

const createTinyArenaDocument = (name: string) => ({
  version: 1 as const,
  meta: {
    name,
    description: "Tiny import fixture.",
    theme: "party-grass",
    createdAt: "2026-04-04T00:00:00.000Z",
    updatedAt: "2026-04-04T00:00:00.000Z"
  },
  size: { x: 8, y: 8, z: 8 },
  boundary: { fallY: -1 },
  spawns: [{ id: "spawn-1", x: 2.5, y: 1.05, z: 2.5 }],
  props: [],
  waterfalls: [],
  voxels: [{ x: 2, y: 0, z: 2, kind: "ground" as const }]
});

describe("App", () => {
  beforeEach(() => {
    gameHostState.reset();
    storageState.reset();
    window.localStorage.clear();
    vi.useRealTimers();
    vi.stubGlobal("open", vi.fn());
  });

  it("shows the HoldMyEgg splash before the menu on first load", async () => {
    vi.useFakeTimers();
    render(<App />);

    expect(screen.getByTestId("boot-splash")).toBeInTheDocument();

    await advanceBootSplash();
    expect(screen.getByTestId("boot-splash")).toBeInTheDocument();

    await signalMenuReady();

    expect(screen.queryByTestId("boot-splash")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "HoldMyEgg" })).toBeInTheDocument();
  });

  it("renders the start menu by default", async () => {
    render(<App />);

    expect(screen.getByTestId("boot-splash")).toBeInTheDocument();
    await signalMenuReady();

    expect(await screen.findByRole("heading", { name: "HoldMyEgg" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Explore/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /PLAY NPC/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Rules / Shortcuts" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Controls/i })).toBeInTheDocument();
    expect(screen.queryByLabelText("Look Sensitivity")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Feedback / bug" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Build/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Map Workshop" })).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Anthony Riera" })
    ).toHaveAttribute("href", "https://x.com/anthonyriera");
    expect(
      screen.getByRole("link", { name: "cossistant.com" })
    ).toHaveAttribute("href", "https://cossistant.com");
    expect(screen.getByTestId("game-host")).toHaveTextContent("editor");
    expect(screen.getByTestId("chicken-preview")).toHaveTextContent("cream");
    expect(screen.getByLabelText("Player Name")).toHaveValue("");
    expect(screen.getByRole("radio", { name: "cream chicken" })).toHaveAttribute(
      "aria-checked",
      "true"
    );

    fireEvent.change(screen.getByLabelText("Player Name"), {
      target: { value: "Anthony" }
    });

    expect(screen.getByRole("button", { name: /Explore/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /PLAY NPC/i })).toBeEnabled();
  });

  it("persists menu control settings locally across app remounts", async () => {
    const { unmount } = render(<App />);

    await signalMenuReady();
    openMenuControls();

    fireEvent.change(screen.getByLabelText("Look Sensitivity"), {
      target: { value: "1.7" }
    });
    fireEvent.click(screen.getByLabelText("Invert X"));
    fireEvent.click(screen.getByLabelText("Invert Y"));

    expect(
      JSON.parse(
        window.localStorage.getItem(RUNTIME_CONTROL_SETTINGS_STORAGE_KEY)!
      )
    ).toEqual({
      version: 2,
      settings: {
        lookSensitivity: 1.7,
        invertLookX: true,
        invertLookY: true
      }
    });

    unmount();

    render(<App />);
    await signalMenuReady();
    openMenuControls();

    expect(
      (screen.getByLabelText("Look Sensitivity") as HTMLInputElement).value
    ).toBe("1.7");
    expect(screen.getByLabelText("Invert X")).toBeChecked();
    expect(screen.getByLabelText("Invert Y")).toBeChecked();
  });

  it(
    "keeps menu and pause control settings in sync",
    async () => {
      vi.useFakeTimers();
      render(<App />);

      await signalMenuReady();
      openMenuControls();

      fireEvent.change(screen.getByLabelText("Look Sensitivity"), {
        target: { value: "1.5" }
      });
      fireEvent.click(screen.getByLabelText("Invert X"));

      unlockMenuPlayer();
      fireEvent.click(screen.getByRole("button", { name: /Explore/i }));
      await advanceLaunchIntro();

      fireEvent.click(screen.getByRole("button", { name: "Pause runtime" }));
      fireEvent.click(screen.getByRole("button", { name: "Tune Controls" }));

      expect(
        (screen.getByLabelText("Look Sensitivity") as HTMLInputElement).value
      ).toBe("1.5");
      expect(screen.getByLabelText("Invert X")).toBeChecked();
      expect(screen.getByLabelText("Invert Y")).not.toBeChecked();

      fireEvent.change(screen.getByLabelText("Look Sensitivity"), {
        target: { value: "0.8" }
      });
      fireEvent.click(screen.getByLabelText("Invert Y"));

      fireEvent.click(screen.getByRole("button", { name: "Menu" }));
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.getByTestId("boot-splash")).toBeInTheDocument();
      await signalMenuReady();

      expect(
        (screen.getByLabelText("Look Sensitivity") as HTMLInputElement).value
      ).toBe("0.8");
      expect(screen.getByLabelText("Invert X")).toBeChecked();
      expect(screen.getByLabelText("Invert Y")).toBeChecked();
    },
    APP_FLOW_TIMEOUT
  );

  it(
    "renders the editor shell when started there directly",
    async () => {
    render(<App initialMode="editor" />);

    expect(screen.queryByTestId("boot-splash")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("Default Arena")).toBeInTheDocument();
    expect(await screen.findByTestId("game-host")).toHaveTextContent("editor");

    await waitFor(() => {
      expect(screen.getByRole("option", { name: "Select a save" })).toBeInTheDocument();
    });
    },
    APP_FLOW_TIMEOUT
  );

  it(
    "exposes waterfall feature controls in the editor",
    async () => {
      render(<App initialMode="editor" />);

      expect(await screen.findByTestId("game-host")).toHaveTextContent("editor");

      fireEvent.click(screen.getByRole("button", { name: "Feature" }));
      expect(screen.getByRole("button", { name: "Feature" })).toHaveClass("is-active");
      expect(screen.getByLabelText("Feature Type")).toBeEnabled();
      expect(screen.getByLabelText("Feature Direction")).toBeEnabled();

      fireEvent.change(screen.getByLabelText("Feature Direction"), {
        target: { value: "south" }
      });

      expect(screen.getByLabelText("Feature Direction")).toHaveValue("south");
    },
    APP_FLOW_TIMEOUT
  );

  it(
    "switches runtime modes into the play view and returns to the menu",
    async () => {
    vi.useFakeTimers();
    render(<App />);

    await signalMenuReady();
    unlockMenuPlayer();

    fireEvent.click(screen.getByRole("button", { name: /Explore/i }));
    expect(screen.getByTestId("launch-overlay")).toBeInTheDocument();
    expect(screen.queryByText("Matter")).not.toBeInTheDocument();

    await advanceLaunchIntro();

    expect(screen.getByLabelText("Matter 24 of 500")).toBeInTheDocument();
    expect(screen.getByLabelText("Feathers 3 of 3")).toBeInTheDocument();
    expect(screen.getByTestId("hud-matter-amount")).toHaveTextContent("24/500");
    expect(screen.queryByText("MATTER FLOW")).not.toBeInTheDocument();
    expect(screen.queryByText("Jump / Fly")).not.toBeInTheDocument();
    expect(screen.queryByText("Drop Eggs")).not.toBeInTheDocument();
    expect(screen.queryByText("WASD")).not.toBeInTheDocument();
    expect(screen.queryByText("Anthony")).not.toBeInTheDocument();
    expect(screen.queryByText("NPC 1")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Pause runtime" }));
    expect(screen.getByText("Jump / Fly")).toBeInTheDocument();
    expect(screen.getByText("WASD")).toBeInTheDocument();
    expect(screen.getByText("jump, jetpack, recover")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resume" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tune Controls" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rules / Shortcuts" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Menu" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId("boot-splash")).toBeInTheDocument();
    await signalMenuReady();
    expect(screen.getByRole("button", { name: /PLAY NPC/i })).toBeInTheDocument();
    expect(screen.getByTestId("chicken-preview")).toHaveTextContent("cream");

    fireEvent.click(screen.getByRole("button", { name: /PLAY NPC/i }));
    expect(screen.getByTestId("launch-overlay")).toBeInTheDocument();
    await advanceLaunchIntro();
    expect(screen.getByText("Anthony")).toBeInTheDocument();
    expect(screen.getByText("NPC 1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Pause runtime" }));
    fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId("boot-splash")).toBeInTheDocument();
    await signalMenuReady();
    expect(screen.queryByRole("button", { name: "Feedback / bug" })).not.toBeInTheDocument();
    },
    APP_FLOW_TIMEOUT
  );

  it(
    "shows the worker-sourced FPS badge during runtime play only",
    async () => {
      vi.useFakeTimers();
      render(<App />);

      await signalMenuReady();
      expect(screen.queryByTestId("runtime-fps-badge")).not.toBeInTheDocument();

      unlockMenuPlayer();
      fireEvent.click(screen.getByRole("button", { name: /Explore/i }));
      await advanceLaunchIntro();

      expect(screen.getByTestId("runtime-fps-badge")).toHaveTextContent("FPS 57.4");
      expect(screen.getByTestId("runtime-fps-badge")).toHaveTextContent("MEDIUM");

      fireEvent.click(screen.getByRole("button", { name: "Pause runtime" }));
      expect(screen.getByTestId("runtime-fps-badge")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Menu" }));
      await act(async () => {
        await Promise.resolve();
      });
      await signalMenuReady();

      expect(screen.queryByTestId("runtime-fps-badge")).not.toBeInTheDocument();
    },
    APP_FLOW_TIMEOUT
  );

  it(
    "hands off a stalled launch into the pause overlay instead of leaving the launch overlay stuck",
    async () => {
      vi.useFakeTimers();
      setPointerLockBehavior("pending");
      render(<App />);

      await signalMenuReady();
      unlockMenuPlayer();

      fireEvent.click(screen.getByRole("button", { name: /Explore/i }));
      expect(screen.getByTestId("launch-overlay")).toBeInTheDocument();

      await advanceLaunchIntro();

      expect(screen.queryByTestId("launch-overlay")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Capturing..." })).toBeDisabled();
      expect(
        screen.getByText(/trying to capture the mouse now/i)
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Menu" })).toBeInTheDocument();
    },
    APP_FLOW_TIMEOUT
  );

  it(
    "shows pointer-capture failures in the pause overlay and lets the player retry successfully",
    async () => {
      vi.useFakeTimers();
      setPointerLockBehavior("pending");
      render(<App />);

      await signalMenuReady();
      unlockMenuPlayer();

      fireEvent.click(screen.getByRole("button", { name: /Explore/i }));
      await advanceLaunchIntro();

      await failPendingPointerLock("timeout");

      expect(
        screen.getByText(/mouse capture took too long/i)
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Capture Mouse" })
      ).toBeInTheDocument();

      setPointerLockBehavior("success");
      fireEvent.click(screen.getByRole("button", { name: "Capture Mouse" }));

      expect(screen.queryByRole("button", { name: "Capture Mouse" })).not.toBeInTheDocument();
      expect(screen.getByLabelText("Matter 24 of 500")).toBeInTheDocument();
      expect(screen.queryByText(/mouse capture took too long/i)).not.toBeInTheDocument();
    },
    APP_FLOW_TIMEOUT
  );

  it(
    "resets capture failure UI after returning to the menu and starting again",
    async () => {
      vi.useFakeTimers();
      setPointerLockBehavior("pending");
      render(<App />);

      await signalMenuReady();
      unlockMenuPlayer();

      fireEvent.click(screen.getByRole("button", { name: /Explore/i }));
      await advanceLaunchIntro();
      await failPendingPointerLock("error");

      expect(screen.getByText(/mouse capture was blocked/i)).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Menu" }));
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.getByTestId("boot-splash")).toBeInTheDocument();
      await signalMenuReady();

      setPointerLockBehavior("pending");
      fireEvent.click(screen.getByRole("button", { name: /Explore/i }));
      await advanceLaunchIntro();

      expect(
        screen.getByText(/trying to capture the mouse now/i)
      ).toBeInTheDocument();
      expect(screen.queryByText(/mouse capture was blocked/i)).not.toBeInTheDocument();

      await resolvePendingPointerLock();

      expect(screen.getByLabelText("Matter 24 of 500")).toBeInTheDocument();
    },
    APP_FLOW_TIMEOUT
  );

  it(
    "opens the shared rules screen from the menu and from paused runtime",
    async () => {
    vi.useFakeTimers();
    render(<App />);

    await signalMenuReady();

    fireEvent.click(screen.getByRole("button", { name: "Rules / Shortcuts" }));
    expect(screen.getByTestId("rules-screen")).toBeInTheDocument();
    expect(screen.getByText("Rules / Shortcuts")).toBeInTheDocument();
    expect(screen.getByText(/survive the mess you make/i)).toBeInTheDocument();
    expect(screen.getByText(/Every chicken gets 3 feathers/i)).toBeInTheDocument();
    expect(screen.getByText(/Only harvested cubes refill matter/i)).toBeInTheDocument();
    expect(screen.getByText(/Solo practice for movement/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByTestId("boot-splash")).toBeInTheDocument();
    await signalMenuReady();
    expect(screen.queryByRole("button", { name: "Feedback / bug" })).not.toBeInTheDocument();

    unlockMenuPlayer();
    fireEvent.click(screen.getByRole("button", { name: /Explore/i }));
    await advanceLaunchIntro();

    fireEvent.click(screen.getByRole("button", { name: "Pause runtime" }));
    fireEvent.click(screen.getByRole("button", { name: "Rules / Shortcuts" }));
    expect(screen.getByTestId("rules-screen")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("button", { name: "Resume" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Menu" })).toBeInTheDocument();
    },
    APP_FLOW_TIMEOUT
  );

  it(
    "saves, loads, and deletes maps through the control panel",
    async () => {
    render(<App initialMode="editor" />);

    const importFile = new File(
      [serializeMapDocument(createTinyArenaDocument("Imported Arena"))],
      "imported-arena.json",
      {
        type: "application/json"
      }
    );
    fireEvent.change(screen.getByLabelText("Import JSON"), {
      target: {
        files: [importFile]
      }
    });
    await waitFor(
      () => {
        expect(screen.getByLabelText("Name")).toHaveValue("Imported Arena");
      },
      { timeout: 10_000 }
    );

    const nameInput = screen.getByLabelText("Name");
    fireEvent.change(nameInput, { target: { value: "Arena Alpha" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(
      () => {
        expect(screen.getByRole("option", { name: "Arena Alpha" })).toBeInTheDocument();
      },
      { timeout: 10_000 }
    );

    fireEvent.change(nameInput, { target: { value: "Arena Beta" } });
    expect(screen.getByLabelText("Name")).toHaveValue("Arena Beta");

    fireEvent.click(screen.getByRole("button", { name: "Load" }));
    await waitFor(() => {
      expect(screen.getByLabelText("Name")).toHaveValue("Arena Alpha");
    }, { timeout: 20_000 });

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => {
      expect(screen.queryByRole("option", { name: "Arena Alpha" })).not.toBeInTheDocument();
    }, { timeout: 10_000 });
    },
    APP_FLOW_TIMEOUT
  );

  it(
    "exports maps and handles valid and invalid imports cleanly",
    async () => {
    const createObjectURLSpy = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test-map");
    const revokeObjectURLSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    render(<App initialMode="editor" />);
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    await waitFor(() => {
      expect(createObjectURLSpy).toHaveBeenCalled();
      expect(clickSpy).toHaveBeenCalled();
      expect(revokeObjectURLSpy).toHaveBeenCalledWith("blob:test-map");
    });

    const validDocument = createTinyArenaDocument("Imported Arena");
    const validFile = new File([serializeMapDocument(validDocument)], "imported-arena.json", {
      type: "application/json"
    });

    fireEvent.change(screen.getByLabelText("Import JSON"), {
      target: {
        files: [validFile]
      }
    });
    await waitFor(
      () => {
        expect(screen.getByLabelText("Name")).toHaveValue("Imported Arena");
      },
      { timeout: 10_000 }
    );
    expect(await screen.findByText('Imported "Imported Arena".')).toBeInTheDocument();

    const invalidFile = new File(['{"bad":true}'], "broken-map.json", {
      type: "application/json"
    });
    fireEvent.change(screen.getByLabelText("Import JSON"), {
      target: {
        files: [invalidFile]
      }
    });

    await waitFor(
      () => {
        expect(screen.getByText(/Import failed\. Check that the JSON is a valid HoldMyEgg map\./)).toBeInTheDocument();
      },
      { timeout: 10_000 }
    );
    },
    APP_FLOW_TIMEOUT
  );
});
