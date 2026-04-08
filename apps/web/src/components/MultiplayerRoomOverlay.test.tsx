import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { JoinedRoomState, RoomChatMessage } from "@out-of-bounds/netcode";

vi.mock("./PlayerAvatar", () => ({
  PlayerAvatar: ({
    label,
    seed
  }: {
    label: string;
    seed: string;
  }) => <div data-testid="player-avatar">{label}:{seed}</div>
}));

import { MultiplayerRoomOverlay } from "./MultiplayerRoomOverlay";

const room: JoinedRoomState = {
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
    reason: "Round live, next join enters as spectator."
  },
  players: [
    {
      roomPlayerId: "user-1",
      userId: "user-1",
      displayName: "Anthony",
      avatarSeed: "seed-1",
      avatarUrl: null,
      connected: true,
      presence: "alive",
      joinedAt: "2026-04-08T00:00:00.000Z"
    },
    {
      roomPlayerId: "user-2",
      userId: "user-2",
      displayName: "Spectator",
      avatarSeed: "seed-2",
      avatarUrl: null,
      connected: true,
      presence: "dead_spectating",
      joinedAt: "2026-04-08T00:00:10.000Z"
    }
  ],
  score: {
    updatedAt: "2026-04-08T00:00:00.000Z",
    entries: [
      {
        userId: "user-1",
        roomPlayerId: "user-1",
        displayName: "Anthony",
        avatarSeed: "seed-1",
        presence: "alive",
        connected: true,
        wins: 0,
        placement: null,
        livesRemaining: 2,
        knockouts: 3,
        deaths: 0,
        damageDealt: 12,
        damageTaken: 2,
        ringOuts: 1,
        survivedMs: 1_000
      }
    ]
  }
};

const chat: RoomChatMessage[] = [
  {
    id: "sys-1",
    roomId: "warm-1",
    userId: null,
    displayName: "System",
    avatarSeed: "system",
    avatarUrl: null,
    presence: "system",
    system: true,
    text: "Countdown started.",
    createdAt: "2026-04-08T00:00:00.000Z"
  },
  {
    id: "msg-1",
    roomId: "warm-1",
    userId: "user-2",
    displayName: "Spectator",
    avatarSeed: "seed-2",
    avatarUrl: null,
    presence: "dead_spectating",
    system: false,
    text: "good luck",
    createdAt: "2026-04-08T00:00:01.000Z"
  }
];

describe("MultiplayerRoomOverlay", () => {
  it("renders roster, local player state, scoreboard, and chat", () => {
    render(
      <MultiplayerRoomOverlay
        chat={chat}
        connectionStatus="connected"
        localUserId="user-1"
        onChatSend={vi.fn()}
        onReturnToMenu={vi.fn()}
        room={room}
      />
    );

    expect(screen.getByText("Warm Room 1")).toBeInTheDocument();
    expect(screen.getAllByText("Anthony").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Alive").length).toBeGreaterThan(0);
    expect(screen.getByText("Dead spectator")).toBeInTheDocument();
    expect(screen.getByText("KOs 3")).toBeInTheDocument();
    expect(screen.getByText("Countdown started.")).toBeInTheDocument();
    expect(screen.getByText("good luck")).toBeInTheDocument();
  });

  it("submits chat and lets the player return to the menu", () => {
    const onChatSend = vi.fn();
    const onReturnToMenu = vi.fn();

    render(
      <MultiplayerRoomOverlay
        chat={chat}
        connectionStatus="reconnecting"
        localUserId="user-1"
        onChatSend={onChatSend}
        onReturnToMenu={onReturnToMenu}
        room={room}
      />
    );

    fireEvent.change(screen.getByPlaceholderText("Say something while the room fills..."), {
      target: {
        value: "  hello there  "
      }
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    fireEvent.click(screen.getByRole("button", { name: "Menu" }));

    expect(onChatSend).toHaveBeenCalledWith("hello there");
    expect(onReturnToMenu).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Reconnecting...")).toBeInTheDocument();
  });
});
