import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RoomSummary } from "@out-of-bounds/netcode";
import { MultiplayerRoomCards } from "./MultiplayerRoomCards";

const rooms: RoomSummary[] = [
  {
    id: "warm-1",
    name: "Warm Room 1",
    mapId: "map-1",
    mapName: "Arena",
    region: "local-us",
    phase: "waiting",
    joinable: true,
    humans: 3,
    spectators: 1,
    connected: 4,
    capacity: 24,
    warm: true,
    countdown: {
      active: false,
      startsAt: null,
      secondsRemaining: 0,
      reason: "Waiting for countdown."
    },
    statusText: "Waiting for countdown."
  },
  {
    id: "warm-2",
    name: "Warm Room 2",
    mapId: "map-2",
    mapName: "Arena 2",
    region: "local-us",
    phase: "live",
    joinable: false,
    humans: 24,
    spectators: 0,
    connected: 24,
    capacity: 24,
    warm: true,
    countdown: {
      active: false,
      startsAt: null,
      secondsRemaining: 0,
      reason: "Round live, next join enters as spectator."
    },
    statusText: "Full"
  }
];

describe("MultiplayerRoomCards", () => {
  it("renders available rooms and calls the quick-join and room-join actions", () => {
    const onQuickJoin = vi.fn();
    const onJoinRoom = vi.fn();

    render(
      <MultiplayerRoomCards
        busy={false}
        onJoinRoom={onJoinRoom}
        onQuickJoin={onQuickJoin}
        rooms={rooms}
        sessionReady
      />
    );

    expect(screen.getByText("Warm Room 1")).toBeInTheDocument();
    expect(screen.getByText("3/24 active")).toBeInTheDocument();
    expect(screen.getByText("1 spectating")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Full" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Quick Join" }));
    fireEvent.click(screen.getByRole("button", { name: "Join Room" }));

    expect(onQuickJoin).toHaveBeenCalledTimes(1);
    expect(onJoinRoom).toHaveBeenCalledWith("warm-1");
  });

  it("disables actions when the session is not ready or the room is full", () => {
    render(
      <MultiplayerRoomCards
        busy
        onJoinRoom={vi.fn()}
        onQuickJoin={vi.fn()}
        rooms={rooms}
        sessionReady={false}
      />
    );

    expect(screen.getByRole("button", { name: "Joining..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Join Room" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Full" })).toBeDisabled();
  });
});
