import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultArenaMap, serializeMapDocument } from "@out-of-bounds/map";
import type { HudState } from "@out-of-bounds/sim";

const createHudState = (mode: "explore" | "skirmish", playerName = "You"): HudState => ({
  mode,
  localPlayerId: "human-1",
  localPlayer: {
    id: "human-1",
    name: playerName,
    alive: true,
    grounded: true,
    mass: 24,
    maxMass: 300,
    livesRemaining: 3,
    maxLives: 3,
    respawning: false,
    invulnerableRemaining: 0,
    stunRemaining: 0
  },
  ranking:
    mode === "skirmish"
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

  return {
    reset() {
      menuReadyCallback = null;
    },
    setMenuReadyCallback(callback: (() => void) | null) {
      menuReadyCallback = callback;
    },
    signalMenuReady() {
      menuReadyCallback?.();
    }
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
        onHudStateChange,
        onPauseStateChange,
        onReadyToDisplay
      }: {
        initialDocument: ReturnType<typeof createDefaultArenaMap>;
        mode: string;
        presentation?: string;
        playerProfile?: { name: string };
        onEditorStateChange?: (state: {
          blockKind: "ground";
          mapName: string;
          propKind: "tree-oak";
          tool: "add";
        }) => void;
        onHudStateChange?: (state: HudState | null) => void;
        onPauseStateChange?: (state: { hasStarted: boolean; paused: boolean; pointerLocked: boolean }) => void;
        onReadyToDisplay?: () => void;
      },
      ref
    ) => {
      const [document, setDocument] = useState(initialDocument);
      const [mapName, setMapName] = useState(initialDocument.meta.name);
      const pointerLockedRef = useRef(false);

      useEffect(() => {
        setDocument(initialDocument);
        setMapName(initialDocument.meta.name);
      }, [initialDocument]);

      useEffect(() => {
        onEditorStateChange?.({
          mapName,
          tool: "add",
          blockKind: "ground",
          propKind: "tree-oak"
        });
      }, [mapName, onEditorStateChange]);

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
          onHudStateChange?.(null);
          onPauseStateChange?.({ hasStarted: false, paused: false, pointerLocked: false });
          return;
        }

        onHudStateChange?.(createHudState(mode as "explore" | "skirmish", playerProfile?.name || "You"));
        onPauseStateChange?.({ hasStarted: false, paused: true, pointerLocked: false });
      }, [mode, onHudStateChange, onPauseStateChange, playerProfile?.name]);

      useImperativeHandle(
        ref,
        () => ({
          async getEditorDocument() {
            return document;
          },
          loadMap(nextDocument: ReturnType<typeof createDefaultArenaMap>) {
            setDocument(nextDocument);
            setMapName(nextDocument.meta.name);
          },
          requestPointerLock() {
            pointerLockedRef.current = true;
            onPauseStateChange?.({ hasStarted: true, paused: true, pointerLocked: true });
            return true;
          },
          resumeRuntime() {
            pointerLockedRef.current = true;
            onPauseStateChange?.({ hasStarted: true, paused: false, pointerLocked: true });
          },
          setRuntimePaused(paused: boolean) {
            onPauseStateChange?.({
              hasStarted: pointerLockedRef.current || !paused,
              paused,
              pointerLocked: pointerLockedRef.current
            });
          },
          setEditorState(next: { mapName?: string }) {
            if (typeof next.mapName === "string") {
              const nextMapName = next.mapName;
              setMapName(next.mapName);
              setDocument((current) => ({
                ...current,
                meta: {
                  ...current.meta,
                  name: nextMapName
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
                onPauseStateChange?.({ hasStarted: true, paused: true, pointerLocked: false });
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

const unlockMenuPlayer = () => {
  fireEvent.change(screen.getByLabelText("Player Name"), {
    target: { value: "Anthony" }
  });
  fireEvent.click(screen.getByRole("radio", { name: "cream chicken" }));
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
  voxels: [{ x: 2, y: 0, z: 2, kind: "ground" as const }]
});

describe("App", () => {
  beforeEach(() => {
    gameHostState.reset();
    storageState.reset();
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
    expect(screen.getByRole("button", { name: /Brawl/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Rules and Controls" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Feedback / bug" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Build/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Map Workshop" })).not.toBeInTheDocument();
    expect(screen.getByText("Made by Anthony Riera and")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "cossistant.com" })
    ).toHaveAttribute("href", "https://cossistant.com");
    expect(screen.getByTestId("game-host")).toHaveTextContent("editor");
    expect(screen.getByTestId("chicken-preview")).toHaveTextContent("cream");
    expect(screen.getByLabelText("Player Name")).toHaveValue("");
  });

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

    expect(screen.getByText("Matter")).toBeInTheDocument();
    expect(screen.getByText("MATTER FLOW")).toBeInTheDocument();
    expect(screen.getByText("Feathers")).toBeInTheDocument();
    expect(screen.getByText("24 / 300")).toBeInTheDocument();
    expect(screen.getByText("Jump / Fly")).toBeInTheDocument();
    expect(screen.getByText("Drop Eggs")).toBeInTheDocument();
    expect(screen.getByText("WASD")).toBeInTheDocument();
    expect(screen.getByText("Anthony")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Pause runtime" }));
    expect(screen.getByRole("button", { name: "Menu" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId("boot-splash")).toBeInTheDocument();
    await signalMenuReady();
    expect(screen.getByRole("button", { name: /Brawl/i })).toBeInTheDocument();
    expect(screen.getByTestId("chicken-preview")).toHaveTextContent("cream");

    fireEvent.click(screen.getByRole("button", { name: /Brawl/i }));
    expect(screen.getByTestId("launch-overlay")).toBeInTheDocument();
    await advanceLaunchIntro();
    expect(screen.getByText("NPC 1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Pause runtime" }));
    fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId("boot-splash")).toBeInTheDocument();
    await signalMenuReady();
    expect(screen.getByRole("button", { name: "Feedback / bug" })).toBeInTheDocument();
    },
    APP_FLOW_TIMEOUT
  );

  it(
    "opens the shared rules screen from the menu and from paused runtime",
    async () => {
    vi.useFakeTimers();
    render(<App />);

    await signalMenuReady();

    fireEvent.click(screen.getByRole("button", { name: "Rules and Controls" }));
    expect(screen.getByTestId("rules-screen")).toBeInTheDocument();
    expect(screen.getByText("Rules and Controls")).toBeInTheDocument();
    expect(screen.getByText(/survive the mess you make/i)).toBeInTheDocument();
    expect(screen.getByText(/Every chicken gets 3 feathers/i)).toBeInTheDocument();
    expect(screen.getByText(/Only harvested cubes refill matter/i)).toBeInTheDocument();
    expect(screen.getByText(/Solo practice for movement/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByTestId("boot-splash")).toBeInTheDocument();
    await signalMenuReady();
    expect(screen.getByRole("button", { name: "Feedback / bug" })).toBeInTheDocument();

    unlockMenuPlayer();
    fireEvent.click(screen.getByRole("button", { name: /Explore/i }));
    await advanceLaunchIntro();

    fireEvent.click(screen.getByRole("button", { name: "Pause runtime" }));
    fireEvent.click(screen.getByRole("button", { name: "Rules and Controls" }));
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
