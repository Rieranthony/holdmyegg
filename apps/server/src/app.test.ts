import { describe, expect, it, vi } from "vitest";
import type { JoinTicket, JoinedRoomState, RoomSummary } from "@out-of-bounds/netcode";

vi.mock("hono/bun", () => ({
  upgradeWebSocket: () => (() => new Response("websocket unavailable", { status: 501 })),
  websocket: {}
}));

import { createApp, type AuthLike, type RoomManagerLike } from "./app";
import { MemoryPlayerRepository } from "./lib/playerRepository";

const roomState: JoinedRoomState = {
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
};

const roomSummary: RoomSummary = {
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
  countdown: roomState.countdown,
  statusText: roomState.countdown.reason
};

const joinTicket: JoinTicket = {
  ticket: "ticket-1",
  roomId: "warm-1",
  wsUrl: "ws://localhost:3000/ws?ticket=ticket-1",
  room: roomState
};

const createAuth = (userId: string | null): AuthLike => ({
  api: {
    getSession: vi.fn(async () =>
      userId
        ? {
            user: {
              id: userId,
              name: "Guest"
            }
          }
        : null
    )
  },
  handler: vi.fn(async () => new Response("auth"))
});

const createRoomManager = (): RoomManagerLike => ({
  listRooms: vi.fn(() => [roomSummary]),
  quickJoin: vi.fn(() => joinTicket),
  joinRoom: vi.fn(() => joinTicket),
  connect: vi.fn(() => null),
  disconnect: vi.fn(() => null),
  receiveControl: vi.fn(),
  receiveRuntimeInput: vi.fn(),
  createReconnectTicket: vi.fn((_roomId: string, roomPlayerId: string) => ({
    ticket: `reconnect-${roomPlayerId}`,
    roomId: "warm-1",
    expiresAt: new Date(60_000).toISOString(),
    wsUrl: "ws://localhost:3000/ws?ticket=reconnect"
  }))
});

const createTestApp = ({
  userId
}: {
  userId: string | null;
}) => {
  const playerRepository = new MemoryPlayerRepository();
  const roomManager = createRoomManager();
  const created = createApp({
    env: {
      region: "local-us",
      webOrigin: "http://localhost:5173"
    },
    auth: createAuth(userId),
    roomManager,
    playerRepository
  });

  return {
    ...created,
    roomManager,
    playerRepository
  };
};

describe("createApp", () => {
  it("reports region, room count, and aggregated online players on the public health route", async () => {
    const { app } = createTestApp({
      userId: null
    });

    const response = await app.fetch(new Request("http://localhost/health"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      region: "local-us",
      rooms: 1,
      onlinePlayers: 2
    });
  });

  it("protects session routes when the user is not authenticated", async () => {
    const { app } = createTestApp({
      userId: null
    });

    const response = await app.fetch(new Request("http://localhost/rooms"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: "Unauthorized"
    });
  });

  it("restores profile data and lists rooms for authenticated users", async () => {
    const { app, playerRepository } = createTestApp({
      userId: "user-1"
    });

    const profileResponse = await app.fetch(new Request("http://localhost/profile"));
    const roomsResponse = await app.fetch(new Request("http://localhost/rooms"));

    expect(profileResponse.status).toBe(200);
    await expect(profileResponse.json()).resolves.toMatchObject({
      profile: {
        userId: "user-1",
        displayName: "Guest"
      }
    });
    expect(roomsResponse.status).toBe(200);
    await expect(roomsResponse.json()).resolves.toMatchObject({
      rooms: [roomSummary]
    });
    expect(await playerRepository.getProfile("user-1")).not.toBeNull();
  });

  it("updates profiles and forwards quick-join and room-join requests", async () => {
    const { app, roomManager, playerRepository } = createTestApp({
      userId: "user-1"
    });

    await app.fetch(
      new Request("http://localhost/profile", {
        method: "PUT",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          displayName: "Anthony"
        })
      })
    );

    const quickJoinResponse = await app.fetch(
      new Request("http://localhost/matchmaking/quick-join", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: "{}"
      })
    );
    const roomJoinResponse = await app.fetch(
      new Request("http://localhost/rooms/warm-1/join", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: "{}"
      })
    );

    expect((await playerRepository.getProfile("user-1"))?.profile.displayName).toBe("Anthony");
    expect(roomManager.quickJoin).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        displayName: "Anthony"
      })
    );
    expect(roomManager.joinRoom).toHaveBeenCalledWith(
      "warm-1",
      expect.objectContaining({
        userId: "user-1",
        displayName: "Anthony"
      })
    );
    await expect(quickJoinResponse.json()).resolves.toMatchObject({
      join: {
        roomId: "warm-1"
      }
    });
    await expect(roomJoinResponse.json()).resolves.toMatchObject({
      join: {
        roomId: "warm-1"
      }
    });
  });

  it("validates reconnect payloads and returns reconnect tickets", async () => {
    const { app, roomManager } = createTestApp({
      userId: "user-1"
    });

    const invalidResponse = await app.fetch(
      new Request("http://localhost/reconnect", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          roomId: "warm-1",
          roomPlayerId: "someone-else"
        })
      })
    );
    const validResponse = await app.fetch(
      new Request("http://localhost/reconnect", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          roomId: "warm-1",
          roomPlayerId: "user-1"
        })
      })
    );

    expect(invalidResponse.status).toBe(400);
    expect(roomManager.createReconnectTicket).toHaveBeenCalledWith("warm-1", "user-1");
    await expect(validResponse.json()).resolves.toMatchObject({
      reconnect: {
        roomId: "warm-1"
      }
    });
  });
});
