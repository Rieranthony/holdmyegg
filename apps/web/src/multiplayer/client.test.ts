import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultArenaMap } from "@out-of-bounds/map";
import {
  decodeClientControlMessage,
  encodeServerControlMessage,
  encodeServerStateMessage,
  type JoinedRoomState,
  type PlayerProfileResponse,
  type RoomSummary,
  type ServerBootstrapFrame,
  type ServerStateDeltaFrame
} from "@out-of-bounds/netcode";
import { MultiplayerClient, type MultiplayerSocket } from "./client";

const profileResponse: PlayerProfileResponse = {
  profile: {
    userId: "user-1",
    displayName: "Anthony",
    avatarSeed: "seed-1",
    avatarUrl: null
  },
  stats: {
    totalMatches: 4,
    totalWins: 2,
    totalKills: 9,
    totalDeaths: 3,
    totalDamageDealt: 20,
    totalDamageTaken: 10,
    totalRingOuts: 1,
    totalSurvivalMs: 123
  },
  recentMatches: []
};

const roomState = (reason = "Waiting for countdown."): JoinedRoomState => ({
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
    reason
  },
  players: [],
  score: {
    updatedAt: new Date(0).toISOString(),
    entries: []
  }
});

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
  countdown: roomState().countdown,
  statusText: roomState().countdown.reason
};

const createSharedFrame = (
  terrainDeltaBatch: ServerStateDeltaFrame["sharedFrame"]["terrainDeltaBatch"] = null
) => ({
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

const bootstrapFrame = (): ServerBootstrapFrame => ({
  kind: "bootstrap",
  room: roomState(),
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

const deltaFrame = (): ServerStateDeltaFrame => ({
  kind: "delta",
  room: roomState("Starting in 9s."),
  sharedFrame: createSharedFrame({
    tick: 2,
    terrainRevision: 2,
    changes: []
  }),
  localOverlay: {
    localPlayerId: null,
    hudState: null,
    focusState: null
  }
});

class FakeSocket implements MultiplayerSocket {
  binaryType: BinaryType = "arraybuffer";
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: Blob | ArrayBuffer | Uint8Array }) => void) | null = null;
  onopen: (() => void) | null = null;
  readyState = 0;
  readonly sent: (string | ArrayBufferView | ArrayBuffer)[] = [];
  closeCalls: { code?: number; reason?: string }[] = [];

  close(code?: number, reason?: string) {
    this.closeCalls.push({ code, reason });
    this.readyState = 3;
    this.onclose?.();
  }

  send(data: string | ArrayBufferView | ArrayBuffer) {
    this.sent.push(data);
  }

  emitOpen() {
    this.readyState = 1;
    this.onopen?.();
  }

  emitMessage(data: Uint8Array) {
    this.onmessage?.({ data });
  }

  emitClose() {
    this.readyState = 3;
    this.onclose?.();
  }

  emitError() {
    this.onerror?.();
  }
}

const createResponse = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json"
    },
    ...init
  });

describe("MultiplayerClient", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("boots with an existing session and polls rooms on an interval", async () => {
    vi.useFakeTimers();
    const fetchCalls: string[] = [];
    const client = new MultiplayerClient({
      auth: {
        getSession: vi.fn(async () => ({
          data: {
            user: {
              id: "user-1"
            }
          }
        })),
        signIn: {
          anonymous: vi.fn(async () => ({
            data: null
          }))
        }
      },
      fetchImpl: vi.fn(async (input) => {
        const path = new URL(input.toString()).pathname;
        fetchCalls.push(path);
        if (path === "/health") {
          return createResponse({
            ok: true,
            region: "local-us",
            rooms: 1,
            onlinePlayers: 2
          });
        }
        if (path === "/profile") {
          return createResponse(profileResponse);
        }
        if (path === "/rooms") {
          return createResponse({
            rooms: [roomSummary]
          });
        }
        throw new Error(`Unhandled fetch path ${path}`);
      }) as typeof fetch,
      serverBaseUrl: "http://server.test"
    });

    await client.boot();
    expect(client.getSnapshot()).toMatchObject({
      available: true,
      authenticated: true,
      sessionUserId: "user-1",
      onlinePlayers: 2,
      profile: {
        displayName: "Anthony"
      },
      rooms: [roomSummary]
    });

    vi.advanceTimersByTime(10_000);
    await Promise.resolve();

    expect(fetchCalls.filter((path) => path === "/rooms")).toHaveLength(2);
    client.dispose();
  });

  it("keeps retrying health and restores multiplayer data when the server comes back", async () => {
    vi.useFakeTimers();
    let healthChecks = 0;
    const fetchImpl = vi.fn(async (input) => {
      const path = new URL(input.toString()).pathname;
      if (path === "/health") {
        healthChecks += 1;
        if (healthChecks === 1) {
          throw new Error("offline");
        }

        return createResponse({
          ok: true,
          region: "local-us",
          rooms: 1,
          onlinePlayers: 4
        });
      }
      if (path === "/profile") {
        return createResponse(profileResponse);
      }
      if (path === "/rooms") {
        return createResponse({
          rooms: [roomSummary]
        });
      }
      throw new Error(`Unhandled fetch path ${path}`);
    });
    const client = new MultiplayerClient({
      auth: {
        getSession: vi.fn(async () => ({
          data: {
            user: {
              id: "user-1"
            }
          }
        })),
        signIn: {
          anonymous: vi.fn(async () => ({
            data: null
          }))
        }
      },
      fetchImpl: fetchImpl as typeof fetch,
      serverBaseUrl: "http://server.test"
    });

    await client.boot();
    expect(client.getSnapshot()).toMatchObject({
      available: false,
      statusMessage: "Multiplayer server is not reachable right now."
    });

    await vi.advanceTimersByTimeAsync(15_000);

    expect(client.getSnapshot()).toMatchObject({
      available: true,
      authenticated: true,
      onlinePlayers: 4,
      rooms: [roomSummary]
    });
    client.dispose();
  });

  it("creates an anonymous session, persists the name, joins a room, and handles websocket control/state traffic", async () => {
    const socket = new FakeSocket();
    let sessionUserId: string | null = null;
    const realtime = vi.fn();
    const fetchImpl = vi.fn(async (input, init) => {
      const path = new URL(input.toString()).pathname;
      if (path === "/health") {
        return createResponse({
          ok: true,
          region: "local-us",
          rooms: 1,
          onlinePlayers: 0
        });
      }
      if (path === "/profile" && init?.method === "PUT") {
        return createResponse({
          profile: profileResponse.profile
        });
      }
      if (path === "/profile") {
        return createResponse(profileResponse);
      }
      if (path === "/rooms") {
        return createResponse({
          rooms: [roomSummary]
        });
      }
      if (path === "/matchmaking/quick-join") {
        return createResponse({
          join: {
            ticket: "ticket-1",
            roomId: "warm-1",
            wsUrl: "ws://server.test/ws?ticket=ticket-1",
            room: roomState()
          }
        });
      }
      throw new Error(`Unhandled fetch path ${path}`);
    });
    const client = new MultiplayerClient({
      auth: {
        getSession: vi.fn(async () =>
          sessionUserId
            ? {
                data: {
                  user: {
                    id: sessionUserId
                  }
                }
              }
            : {
                data: null
              }
        ),
        signIn: {
          anonymous: vi.fn(async () => {
            sessionUserId = "user-1";
            return {
              data: null
            };
          })
        }
      },
      createWebSocket: () => socket,
      fetchImpl: fetchImpl as typeof fetch,
      serverBaseUrl: "http://server.test",
      socketOpenState: 1
    });

    client.subscribeRealtime(realtime);
    await client.quickJoin(" Anthony ");

    expect(client.getSnapshot()).toMatchObject({
      joining: true,
      activeRoom: {
        roomId: "warm-1"
      }
    });

    socket.emitOpen();
    socket.emitMessage(encodeServerStateMessage(bootstrapFrame()));
    socket.emitMessage(encodeServerStateMessage(deltaFrame()));
    socket.emitMessage(
      encodeServerControlMessage({
        type: "chat_message",
        message: {
          id: "chat-1",
          roomId: "warm-1",
          userId: "user-2",
          displayName: "Guest 2",
          avatarSeed: "seed-2",
          avatarUrl: null,
          presence: "waiting",
          system: false,
          text: "hello there",
          createdAt: "2026-04-08T00:00:00.000Z"
        }
      })
    );
    socket.emitMessage(
      encodeServerControlMessage({
        type: "ping",
        at: 42
      })
    );
    socket.emitMessage(
      encodeServerControlMessage({
        type: "error",
        code: "loud",
        message: "Room is loud."
      })
    );
    await Promise.resolve();

    client.sendChat(" hi ");
    client.sendRuntimeInput(new Uint8Array([7, 8, 9]).buffer);

    expect(client.getSnapshot()).toMatchObject({
      authenticated: true,
      connectionStatus: "connected",
      statusMessage: "Room is loud.",
      error: "Room is loud."
    });
    expect(client.getSnapshot().chat.at(-1)?.text).toBe("hello there");
    expect(realtime).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "bootstrap"
      })
    );
    expect(realtime).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "delta"
      })
    );

    const pongMessage = decodeClientControlMessage(socket.sent[0] as ArrayBuffer | Uint8Array);
    const chatMessage = decodeClientControlMessage(socket.sent[1] as ArrayBuffer | Uint8Array);
    expect(pongMessage).toEqual({
      type: "pong",
      at: 42
    });
    expect(chatMessage).toEqual({
      type: "chat_send",
      text: "hi"
    });
    expect(new Uint8Array(socket.sent[2] as ArrayBuffer | Uint8Array)[0]).toBe(1);

    client.leaveRoom();
    expect(client.getSnapshot()).toMatchObject({
      activeRoom: null,
      connectionStatus: "idle"
    });
    expect(socket.closeCalls.at(-1)).toMatchObject({
      reason: "leave_room"
    });
  });

  it("reconnects after an unexpected socket close and resumes the room", async () => {
    const firstSocket = new FakeSocket();
    const secondSocket = new FakeSocket();
    const sockets = [firstSocket, secondSocket];
    const fetchImpl = vi.fn(async (input) => {
      const path = new URL(input.toString()).pathname;
      if (path === "/health") {
        return createResponse({
          ok: true,
          region: "local-us",
          rooms: 1,
          onlinePlayers: 1
        });
      }
      if (path === "/profile") {
        return createResponse(profileResponse);
      }
      if (path === "/rooms") {
        return createResponse({
          rooms: [roomSummary]
        });
      }
      if (path === "/rooms/warm-1/join") {
        return createResponse({
          join: {
            ticket: "ticket-1",
            roomId: "warm-1",
            wsUrl: "ws://server.test/ws?ticket=ticket-1",
            room: roomState()
          }
        });
      }
      if (path === "/reconnect") {
        return createResponse({
          reconnect: {
            wsUrl: "ws://server.test/ws?ticket=reconnect-1"
          }
        });
      }
      throw new Error(`Unhandled fetch path ${path}`);
    });
    const client = new MultiplayerClient({
      auth: {
        getSession: vi.fn(async () => ({
          data: {
            user: {
              id: "user-1"
            }
          }
        })),
        signIn: {
          anonymous: vi.fn(async () => ({
            data: null
          }))
        }
      },
      createWebSocket: () => sockets.shift()!,
      fetchImpl: fetchImpl as typeof fetch,
      serverBaseUrl: "http://server.test",
      socketOpenState: 1
    });

    await client.joinRoom("warm-1", "Anthony");
    firstSocket.emitOpen();
    firstSocket.emitMessage(encodeServerStateMessage(bootstrapFrame()));

    firstSocket.emitClose();
    await Promise.resolve();

    expect(
      fetchImpl.mock.calls.some(([input]) => String(input).includes("/reconnect"))
    ).toBe(true);

    secondSocket.emitOpen();
    secondSocket.emitMessage(encodeServerStateMessage(bootstrapFrame()));

    expect(client.getSnapshot()).toMatchObject({
      connectionStatus: "connected",
      activeRoom: {
        roomId: "warm-1"
      }
    });
  });
});
