import { Hono } from "hono";
import { cors } from "hono/cors";
import { upgradeWebSocket, websocket } from "hono/bun";
import type { MiddlewareHandler } from "hono";
import {
  decodeClientControlMessage,
  encodeServerControlMessage,
  encodeServerStateMessage,
  type ClientControlMessage,
  type ReconnectTicket,
  type ServerBootstrapFrame
} from "@out-of-bounds/netcode";
import type { ServerEnv } from "./lib/env";
import type { PlayerRepository } from "./lib/playerRepository";
import { RoomManager } from "./rooms/manager";
import type { RoomProfile, RoomSocket } from "./rooms/room";

export interface AppBindings {
  Variables: {
    authUserId: string;
    authUserName: string;
  };
}

interface AuthSession {
  user?: {
    id?: string | null;
    name?: string | null;
  } | null;
}

export interface AuthLike {
  api: {
    getSession(input: { headers: Headers }): Promise<AuthSession | null>;
  };
  handler(request: Request): Promise<Response> | Response;
}

export interface RoomManagerLike {
  listRooms(): ReturnType<RoomManager["listRooms"]>;
  quickJoin(profile: RoomProfile): ReturnType<RoomManager["quickJoin"]>;
  joinRoom(roomId: string, profile: RoomProfile): ReturnType<RoomManager["joinRoom"]>;
  leaveRoom(roomId: string, roomPlayerId: string): ReturnType<RoomManager["leaveRoom"]>;
  connect(ticket: string, userId: string, socket: RoomSocket): ReturnType<RoomManager["connect"]>;
  disconnect(roomPlayerId: string, connectionId: string): ReturnType<RoomManager["disconnect"]>;
  receiveControl(roomPlayerId: string, connectionId: string, message: ClientControlMessage): void;
  receiveRuntimeInput(
    roomPlayerId: string,
    connectionId: string,
    packet: Parameters<RoomManager["receiveRuntimeInput"]>[2]
  ): void;
  createReconnectTicket(roomId: string, roomPlayerId: string): ReconnectTicket | null;
}

export interface AppDependencies {
  env: Pick<ServerEnv, "region" | "webOrigin">;
  auth: AuthLike;
  roomManager: RoomManagerLike;
  playerRepository: PlayerRepository;
}

export interface CreatedApp {
  app: Hono<AppBindings>;
  auth: AuthLike;
  roomManager: RoomManagerLike;
  playerRepository: PlayerRepository;
}

export const createApp = ({
  env,
  auth,
  roomManager,
  playerRepository
}: AppDependencies): CreatedApp => {
  const socketMeta = new WeakMap<object, { roomPlayerId: string; roomId: string; connectionId: string }>();
  const app = new Hono<AppBindings>();

  app.use(
    "/api/auth/*",
    cors({
      origin: env.webOrigin,
      credentials: true
    })
  );
  app.use(
    "/rooms",
    cors({
      origin: env.webOrigin,
      credentials: true
    })
  );
  app.use(
    "/matchmaking/*",
    cors({
      origin: env.webOrigin,
      credentials: true
    })
  );
  app.use(
    "/profile",
    cors({
      origin: env.webOrigin,
      credentials: true
    })
  );
  app.use(
    "/reconnect",
    cors({
      origin: env.webOrigin,
      credentials: true
    })
  );

  const requireSession: MiddlewareHandler<AppBindings> = async (c, next) => {
    const session = await auth.api.getSession({
      headers: c.req.raw.headers
    });
    if (!session?.user?.id) {
      return c.json(
        {
          error: "Unauthorized"
        },
        401
      );
    }

    c.set("authUserId", session.user.id);
    c.set("authUserName", session.user.name || "Player");
    await next();
  };

  app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

  app.get("/health", (c) => {
    const rooms = roomManager.listRooms();
    return c.json({
      ok: true,
      region: env.region,
      rooms: rooms.length,
      onlinePlayers: rooms.reduce((total, room) => total + room.connected, 0)
    });
  });

  app.get("/rooms", requireSession, (c) =>
    c.json({
      rooms: roomManager.listRooms()
    })
  );

  app.get("/profile", requireSession, async (c) => {
    const userId = c.get("authUserId");
    const fallbackName = c.get("authUserName");
    await playerRepository.ensureProfile(userId, fallbackName);
    const profile = await playerRepository.getProfile(userId);
    return c.json(
      profile ?? {
        profile: await playerRepository.ensureProfile(userId, fallbackName),
        stats: {
          totalMatches: 0,
          totalWins: 0,
          totalKills: 0,
          totalDeaths: 0,
          totalDamageDealt: 0,
          totalDamageTaken: 0,
          totalRingOuts: 0,
          totalSurvivalMs: 0
        },
        recentMatches: []
      }
    );
  });

  app.put("/profile", requireSession, async (c) => {
    const body = await c.req.json<{ displayName?: string }>();
    const displayName = (body.displayName ?? "").trim().slice(0, 24);
    if (!displayName) {
      return c.json(
        {
          error: "Display name is required."
        },
        400
      );
    }

    const profile = await playerRepository.updateDisplayName(c.get("authUserId"), displayName);
    return c.json({
      profile
    });
  });

  app.post("/matchmaking/quick-join", requireSession, async (c) => {
    const profile = await playerRepository.ensureProfile(c.get("authUserId"), c.get("authUserName"));
    return c.json({
      join: roomManager.quickJoin({
        userId: profile.userId,
        displayName: profile.displayName,
        avatarUrl: profile.avatarUrl
      })
    });
  });

  app.post("/rooms/:roomId/join", requireSession, async (c) => {
    const profile = await playerRepository.ensureProfile(c.get("authUserId"), c.get("authUserName"));
    return c.json({
      join: roomManager.joinRoom(c.req.param("roomId"), {
        userId: profile.userId,
        displayName: profile.displayName,
        avatarUrl: profile.avatarUrl
      })
    });
  });

  app.post("/rooms/:roomId/leave", requireSession, (c) =>
    c.json({
      ok: roomManager.leaveRoom(c.req.param("roomId"), c.get("authUserId"))
    })
  );

  app.post("/reconnect", requireSession, async (c) => {
    const body = await c.req.json<{ roomId?: string; roomPlayerId?: string }>();
    if (!body.roomId || !body.roomPlayerId || body.roomPlayerId !== c.get("authUserId")) {
      return c.json(
        {
          error: "Invalid reconnect payload."
        },
        400
      );
    }

    const reconnect = roomManager.createReconnectTicket(body.roomId, body.roomPlayerId);
    if (!reconnect) {
      return c.json(
        {
          error: "Reconnect ticket unavailable."
        },
        404
      );
    }

    return c.json({ reconnect });
  });

  app.get(
    "/ws",
    requireSession,
    upgradeWebSocket((c) => {
      const ticket = c.req.query("ticket") ?? "";
      const userId = c.get("authUserId");

      return {
        onOpen(_event, ws) {
          const session = roomManager.connect(ticket, userId, ws);
          if (!session) {
            ws.send(
              encodeServerControlMessage({
                type: "error",
                code: "invalid_ticket",
                message: "Join ticket is missing or expired."
              })
            );
            ws.close();
            return;
          }

          socketMeta.set(ws, {
            roomPlayerId: userId,
            roomId: session.bootstrap.room.roomId,
            connectionId: session.connectionId
          });
          ws.send(encodeServerStateMessage(session.bootstrap));
        },
        onMessage(event, ws) {
          if (!(event.data instanceof Uint8Array || event.data instanceof ArrayBuffer)) {
            return;
          }

          const bytes = event.data instanceof Uint8Array ? event.data : new Uint8Array(event.data);
          if (bytes[0] === 1) {
            const meta = socketMeta.get(ws);
            if (!meta) {
              return;
            }

            roomManager.receiveRuntimeInput(meta.roomPlayerId, meta.connectionId, bytes);
            return;
          }

          if (bytes[0] === 2) {
            const meta = socketMeta.get(ws);
            if (!meta) {
              return;
            }

            try {
              const control = decodeClientControlMessage(bytes);
              roomManager.receiveControl(meta.roomPlayerId, meta.connectionId, control);
            } catch {
              ws.send(
                encodeServerControlMessage({
                  type: "error",
                  code: "invalid_control",
                  message: "Client control packet was malformed."
                })
              );
            }
          }
        },
        onClose(_event, ws) {
          const meta = socketMeta.get(ws);
          if (!meta) {
            return;
          }

          roomManager.disconnect(meta.roomPlayerId, meta.connectionId);
          socketMeta.delete(ws);
        }
      };
    })
  );

  return {
    app,
    auth,
    roomManager,
    playerRepository
  };
};

export { websocket };
