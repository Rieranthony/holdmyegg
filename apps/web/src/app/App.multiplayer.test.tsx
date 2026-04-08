import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { forwardRef, useEffect, useImperativeHandle } from "react";
import { describe, expect, it, vi } from "vitest";
import { createDefaultArenaMap } from "@out-of-bounds/map";
import type { MultiplayerSnapshot } from "../multiplayer/client";

const hostState = vi.hoisted(() => ({
  props: [] as Array<Record<string, unknown>>,
  reset() {
    this.props = [];
  }
}));

const createSnapshot = (
  patch: Partial<MultiplayerSnapshot> = {}
): MultiplayerSnapshot => ({
  booting: false,
  available: true,
  availabilityReason: null,
  authenticated: false,
  joining: false,
  connectionStatus: "idle",
  sessionUserId: null,
  onlinePlayers: 0,
  profile: null,
  stats: null,
  recentMatches: [],
  rooms: [],
  activeRoom: null,
  chat: [],
  error: null,
  statusMessage: "Enter your name once and you will be ready next time.",
  ...patch
});

class FakeMultiplayerClient {
  snapshot: MultiplayerSnapshot;
  readonly boot = vi.fn(async () => {});
  readonly createWorkerBridge = vi.fn(() => ({
    onmessage: null,
    postMessage: vi.fn(),
    terminate: vi.fn()
  }));
  readonly dispose = vi.fn();
  readonly ensureReady = vi.fn(async () => "user-1");
  readonly joinRoom = vi.fn(async () => {});
  readonly leaveRoom = vi.fn(() => {
    this.emit({
      activeRoom: null,
      connectionStatus: "idle",
      joining: false
    });
  });
  readonly quickJoin = vi.fn(async () => {
    this.emit({
      joining: false,
      connectionStatus: "connected",
      sessionUserId: "user-1",
      activeRoom: {
        roomId: "warm-1",
        roomName: "Warm Room 1",
        mapId: "map-1",
        mapName: "Arena",
        region: "local-us",
        phase: "waiting",
        capacity: 24,
        joinable: true,
        countdown: {
          active: false,
          startsAt: null,
          secondsRemaining: 0,
          reason: "Waiting for countdown."
        },
        players: [],
        score: {
          updatedAt: new Date(0).toISOString(),
          entries: []
        }
      },
      statusMessage: "Waiting for countdown."
    });
  });
  readonly sendChat = vi.fn();
  private readonly listeners = new Set<(snapshot: MultiplayerSnapshot) => void>();

  constructor(snapshot: MultiplayerSnapshot) {
    this.snapshot = snapshot;
  }

  getSnapshot() {
    return this.snapshot;
  }

  subscribe(listener: (snapshot: MultiplayerSnapshot) => void) {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(patch: Partial<MultiplayerSnapshot>) {
    this.snapshot = {
      ...this.snapshot,
      ...patch
    };
    for (const listener of this.listeners) {
      listener(this.snapshot);
    }
  }
}

vi.mock("../engine/GameHost", () => ({
  GameHost: forwardRef((props: Record<string, unknown>, ref) => {
    hostState.props.push(props);
    useImperativeHandle(ref, () => ({
      async getEditorDocument() {
        return createDefaultArenaMap();
      },
      loadMap() {},
      requestPointerLock() {
        return true;
      },
      resumeRuntime() {},
      setRuntimePaused() {},
      setEditorState() {},
      setShellMode() {}
    }));

    useEffect(() => {
      if (props.presentation === "menu" && typeof props.onReadyToDisplay === "function") {
        (props.onReadyToDisplay as () => void)();
      }
    }, [props]);

    return <div data-testid="game-host">{String(props.mode)}</div>;
  })
}));

vi.mock("../components/ChickenPreview", () => ({
  ChickenPreview: () => <div data-testid="chicken-preview" />
}));

vi.mock("../components/PlayerAvatar", () => ({
  PlayerAvatar: ({ label }: { label: string }) => <div>{label}</div>
}));

vi.mock("./useMapPersistence", () => ({
  useMapPersistence: () => ({
    deleteCurrentMap: vi.fn(async () => {}),
    exportCurrentMap: vi.fn(),
    importMapFile: vi.fn(async () => null),
    loadCurrentMap: vi.fn(async () => null),
    saveCurrentMap: vi.fn(async () => "map-1"),
    savedMaps: [],
    selectedMapId: null,
    setSelectedMapId: vi.fn()
  })
}));

import { App } from "./App";

describe("App multiplayer shell", () => {
  it("hides multiplayer on the home menu when the server is unavailable", async () => {
    hostState.reset();
    const client = new FakeMultiplayerClient(
      createSnapshot({
        available: false,
        availabilityReason: "Multiplayer server is not reachable right now.",
        statusMessage: "Multiplayer server is not reachable right now."
      })
    );

    render(<App multiplayerClient={client as never} />);

    expect(
      screen.queryByRole("button", { name: /Multiplayer ·/i })
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Explore" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "PLAY NPC" })).toBeInTheDocument();
  });

  it("hydrates the main menu from a restored session and opens the dedicated multiplayer submenu", async () => {
    hostState.reset();
    const client = new FakeMultiplayerClient(
      createSnapshot({
        authenticated: true,
        sessionUserId: "user-1",
        profile: {
          userId: "user-1",
          displayName: "Anthony",
          avatarSeed: "seed-1",
          avatarUrl: null
        },
        stats: {
          totalMatches: 3,
          totalWins: 1,
          totalKills: 7,
          totalDeaths: 2,
          totalDamageDealt: 15,
          totalDamageTaken: 10,
          totalRingOuts: 1,
          totalSurvivalMs: 200
        },
        rooms: [
          {
            id: "warm-1",
            name: "Warm Room 1",
            mapId: "map-1",
            mapName: "Arena",
            region: "local-us",
            phase: "waiting",
            joinable: true,
            humans: 2,
            spectators: 0,
            connected: 2,
            capacity: 24,
            warm: true,
            countdown: {
              active: false,
              startsAt: null,
              secondsRemaining: 0,
              reason: "Waiting for countdown."
            },
            statusText: "Waiting for countdown."
          }
        ],
        onlinePlayers: 2,
        statusMessage: "Multiplayer session restored. You are ready to play."
      })
    );

    render(<App multiplayerClient={client as never} />);

    expect(await screen.findByText("Anthony")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Multiplayer · 2 online" })
    ).toBeInTheDocument();
    expect(screen.queryByText("Warm Room 1")).not.toBeInTheDocument();
    expect(screen.queryByText("3 matches")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Multiplayer · 2 online" }));

    expect(screen.getByText("Warm Room 1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(
      screen.getByRole("button", { name: "Multiplayer · 2 online" })
    ).toBeInTheDocument();
  });

  it("lets a first-time player enter a name, open multiplayer, quick join, and mount the multiplayer worker", async () => {
    hostState.reset();
    const client = new FakeMultiplayerClient(createSnapshot());

    render(<App multiplayerClient={client as never} />);

    fireEvent.change(screen.getByLabelText("Player Name"), {
      target: {
        value: "Anthony"
      }
    });
    fireEvent.click(screen.getByRole("button", { name: "Multiplayer · 0 online" }));

    await waitFor(() => {
      expect(client.ensureReady).toHaveBeenCalledWith("Anthony");
    });

    fireEvent.click(screen.getByRole("button", { name: "Quick Join" }));

    await waitFor(() => {
      expect(client.quickJoin).toHaveBeenCalledWith("Anthony");
    });
    expect(await screen.findByTestId("game-host")).toHaveTextContent("multiplayer");
    expect(
      hostState.props.some(
        (props) => props.mode === "multiplayer" && typeof props.workerFactory === "function"
      )
    ).toBe(true);
  });

  it("returns to the menu cleanly and leaves the room when the player exits multiplayer", async () => {
    hostState.reset();
    const client = new FakeMultiplayerClient(
      createSnapshot({
        authenticated: true,
        sessionUserId: "user-1",
        activeRoom: {
          roomId: "warm-1",
          roomName: "Warm Room 1",
          mapId: "map-1",
          mapName: "Arena",
          region: "local-us",
          phase: "waiting",
          capacity: 24,
          joinable: true,
          countdown: {
            active: false,
            startsAt: null,
            secondsRemaining: 0,
            reason: "Waiting for countdown."
          },
          players: [],
          score: {
            updatedAt: new Date(0).toISOString(),
            entries: []
          }
        },
        connectionStatus: "connected"
      })
    );

    render(<App multiplayerClient={client as never} initialMode="multiplayer" />);

    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole("button", { name: "Menu" }));

    await waitFor(() => {
      expect(client.leaveRoom).toHaveBeenCalledTimes(1);
    });
    expect(
      await screen.findByRole("button", { name: "Multiplayer · 0 online" })
    ).toBeInTheDocument();
  });
});
