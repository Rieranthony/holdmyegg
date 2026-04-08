import type { MapDocumentV1 } from "@out-of-bounds/map";
import {
  decodeServerControlMessage,
  decodeServerStateMessage,
  encodeClientControlMessage,
  encodeRuntimeInputPacket,
  type JoinedRoomState,
  type MatchSummary,
  type PlayerProfileResponse,
  type PlayerProfileSummary,
  type ProfileStatsSummary,
  type QuickJoinResponse,
  type RoomChatMessage,
  type RoomSummary,
  type ServerBootstrapFrame,
  type ServerControlMessage,
  type ServerStateDeltaFrame
} from "@out-of-bounds/netcode";
import { MultiplayerWorkerBridge } from "../engine/multiplayerWorker";
import { authClient, getMultiplayerServerUrl } from "./authClient";

export type MultiplayerConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected";

export interface MultiplayerSnapshot {
  booting: boolean;
  available: boolean;
  availabilityReason: string | null;
  authenticated: boolean;
  joining: boolean;
  connectionStatus: MultiplayerConnectionStatus;
  sessionUserId: string | null;
  onlinePlayers: number;
  profile: PlayerProfileSummary | null;
  stats: ProfileStatsSummary | null;
  recentMatches: MatchSummary[];
  rooms: RoomSummary[];
  activeRoom: JoinedRoomState | null;
  chat: RoomChatMessage[];
  error: string | null;
  statusMessage: string;
}

export type MultiplayerRealtimeEvent =
  | {
      type: "bootstrap";
      frame: ServerBootstrapFrame;
    }
  | {
      type: "delta";
      frame: ServerStateDeltaFrame;
    }
  | {
      type: "room_state";
      room: JoinedRoomState;
    }
  | {
      type: "control";
      message: ServerControlMessage;
    }
  | {
      type: "status";
      message: string;
    };

type SnapshotListener = (snapshot: MultiplayerSnapshot) => void;
type RealtimeListener = (event: MultiplayerRealtimeEvent) => void;
type TimerHandle = ReturnType<typeof globalThis.setTimeout>;

interface SessionPayload {
  user: {
    id: string;
    name?: string | null;
  };
}

interface AuthResult<TData> {
  data?: TData | null;
  error?: {
    message?: string | null;
  } | null;
}

interface HealthResponse {
  ok: boolean;
  region: string;
  rooms: number;
  onlinePlayers: number;
}

export interface MultiplayerAuthClientLike {
  getSession(): Promise<AuthResult<SessionPayload>>;
  signIn: {
    anonymous(payload: Record<string, never>): Promise<AuthResult<null>>;
  };
}

export interface MultiplayerSocket {
  binaryType: BinaryType;
  close(code?: number, reason?: string): void;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  onmessage: ((event: { data: Blob | ArrayBuffer | Uint8Array }) => void) | null;
  onopen: (() => void) | null;
  readyState: number;
  send(data: string | ArrayBufferView | ArrayBuffer): void;
}

export interface MultiplayerClientTimers {
  clearInterval(timer: TimerHandle): void;
  clearTimeout(timer: TimerHandle): void;
  setInterval(callback: () => void, delayMs: number): TimerHandle;
  setTimeout(callback: () => void, delayMs: number): TimerHandle;
}

export interface MultiplayerClientDependencies {
  auth?: MultiplayerAuthClientLike;
  createWebSocket?: (url: string) => MultiplayerSocket;
  fetchImpl?: typeof fetch;
  serverBaseUrl?: string;
  socketOpenState?: number;
  timers?: MultiplayerClientTimers;
}

const ROOM_POLL_MS = 10_000;
const HEALTH_POLL_MS = 15_000;
const MAX_CHAT_MESSAGES = 100;
const MAX_RECONNECT_ATTEMPTS = 3;

const createInitialSnapshot = (): MultiplayerSnapshot => ({
  booting: true,
  available: false,
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
  statusMessage: "Restoring multiplayer session..."
});

const toErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong.";

const trimDisplayName = (value: string) => value.trim().slice(0, 24);

const toUint8Array = async (payload: Blob | ArrayBuffer | Uint8Array) => {
  if (payload instanceof Uint8Array) {
    return payload;
  }

  if (payload instanceof ArrayBuffer) {
    return new Uint8Array(payload);
  }

  return new Uint8Array(await payload.arrayBuffer());
};

const defaultTimers: MultiplayerClientTimers = {
  setInterval(callback, delayMs) {
    return globalThis.setInterval(callback, delayMs);
  },
  clearInterval(timer) {
    globalThis.clearInterval(timer);
  },
  setTimeout(callback, delayMs) {
    return globalThis.setTimeout(callback, delayMs);
  },
  clearTimeout(timer) {
    globalThis.clearTimeout(timer);
  }
};

const defaultCreateWebSocket = (url: string): MultiplayerSocket =>
  new WebSocket(url) as unknown as MultiplayerSocket;

export class MultiplayerClient {
  private snapshot = createInitialSnapshot();
  private readonly snapshotListeners = new Set<SnapshotListener>();
  private readonly realtimeListeners = new Set<RealtimeListener>();
  private availabilityPollTimer: TimerHandle | null = null;
  private roomPollTimer: TimerHandle | null = null;
  private reconnectTimer: TimerHandle | null = null;
  private websocket: MultiplayerSocket | null = null;
  private bootPromise: Promise<void> | null = null;
  private leaveRequested = false;
  private reconnectAttempts = 0;
  private lastBootstrap: ServerBootstrapFrame | null = null;
  private lastWorldDocument: MapDocumentV1 | null = null;
  private readonly auth: MultiplayerAuthClientLike;
  private readonly fetchImpl: typeof fetch;
  private readonly serverBaseUrl: string;
  private readonly socketOpenState: number;
  private readonly timers: MultiplayerClientTimers;
  private readonly createWebSocket: (url: string) => MultiplayerSocket;

  constructor(dependencies: MultiplayerClientDependencies = {}) {
    this.auth = dependencies.auth ?? authClient;
    this.fetchImpl = dependencies.fetchImpl ?? fetch;
    this.serverBaseUrl = dependencies.serverBaseUrl ?? getMultiplayerServerUrl();
    this.socketOpenState = dependencies.socketOpenState ?? WebSocket.OPEN;
    this.timers = dependencies.timers ?? defaultTimers;
    this.createWebSocket = dependencies.createWebSocket ?? defaultCreateWebSocket;
  }

  getSnapshot() {
    return this.snapshot;
  }

  getLastBootstrap() {
    return this.lastBootstrap;
  }

  getLastWorldDocument() {
    return this.lastWorldDocument;
  }

  subscribe(listener: SnapshotListener) {
    this.snapshotListeners.add(listener);
    listener(this.snapshot);
    return () => {
      this.snapshotListeners.delete(listener);
    };
  }

  subscribeRealtime(listener: RealtimeListener) {
    this.realtimeListeners.add(listener);
    return () => {
      this.realtimeListeners.delete(listener);
    };
  }

  async boot() {
    if (this.bootPromise) {
      return this.bootPromise;
    }

    this.bootPromise = this.bootInternal();
    try {
      await this.bootPromise;
    } finally {
      this.bootPromise = null;
    }
  }

  async ensureReady(displayName: string) {
    const trimmed = trimDisplayName(displayName);
    if (!trimmed) {
      throw new Error("Enter your name before joining multiplayer.");
    }

    const available = await this.ensureAvailability();
    if (!available) {
      throw new Error("Multiplayer server is not reachable right now.");
    }

    const session = await this.ensureSession();
    await this.persistDisplayName(trimmed);
    await Promise.all([this.refreshProfile(), this.refreshRooms()]);
    return session.user.id;
  }

  async quickJoin(displayName: string) {
    await this.ensureReady(displayName);
    this.updateSnapshot({
      joining: true,
      error: null,
      statusMessage: "Joining the best available room..."
    });

    try {
      const response = await this.fetchJson<QuickJoinResponse>("/matchmaking/quick-join", {
        method: "POST",
        body: JSON.stringify({})
      });
      this.openRoomSocket(response.join.wsUrl, response.join.room, []);
    } catch (error) {
      this.updateSnapshot({
        joining: false,
        error: toErrorMessage(error),
        statusMessage: toErrorMessage(error)
      });
      throw error;
    }
  }

  async joinRoom(roomId: string, displayName: string) {
    await this.ensureReady(displayName);
    this.updateSnapshot({
      joining: true,
      error: null,
      statusMessage: `Joining ${roomId}...`
    });

    try {
      const response = await this.fetchJson<QuickJoinResponse>(`/rooms/${encodeURIComponent(roomId)}/join`, {
        method: "POST",
        body: JSON.stringify({})
      });
      this.openRoomSocket(response.join.wsUrl, response.join.room, []);
    } catch (error) {
      this.updateSnapshot({
        joining: false,
        error: toErrorMessage(error),
        statusMessage: toErrorMessage(error)
      });
      throw error;
    }
  }

  async leaveRoom() {
    const activeRoomId = this.snapshot.activeRoom?.roomId;
    this.leaveRequested = true;
    this.clearReconnectTimer();
    if (activeRoomId && this.snapshot.sessionUserId) {
      try {
        await this.fetchJson<{ ok: boolean }>(
          `/rooms/${encodeURIComponent(activeRoomId)}/leave`,
          {
            method: "POST",
            body: JSON.stringify({})
          }
        );
      } catch {
        // If the explicit leave fails, still close locally and let reconnect grace clean up.
      }
    }

    if (this.websocket) {
      this.websocket.close(1000, "leave_room");
      this.websocket = null;
    }

    this.lastBootstrap = null;
    this.lastWorldDocument = null;
    this.updateSnapshot({
      joining: false,
      connectionStatus: "idle",
      activeRoom: null,
      chat: [],
      error: null,
      statusMessage: this.snapshot.authenticated
        ? "Back in the multiplayer lobby."
        : "Multiplayer session closed."
    });
  }

  sendChat(text: string) {
    const trimmed = text.trim().slice(0, 200);
    if (!trimmed || !this.websocket || this.websocket.readyState !== this.socketOpenState) {
      return;
    }

    this.websocket.send(
      encodeClientControlMessage({
        type: "chat_send",
        text: trimmed
      })
    );
  }

  sendRuntimeInput(buffer: ArrayBuffer) {
    if (!this.websocket || this.websocket.readyState !== this.socketOpenState) {
      return;
    }

    this.websocket.send(encodeRuntimeInputPacket(buffer));
  }

  createWorkerBridge() {
    return new MultiplayerWorkerBridge(this);
  }

  dispose() {
    void this.leaveRoom();
    this.clearAvailabilityPollTimer();
    this.clearRoomPollTimer();
    this.clearReconnectTimer();
  }

  private async bootInternal() {
    this.startAvailabilityPolling();
    this.updateSnapshot({
      booting: true,
      error: null,
      statusMessage: "Checking multiplayer server..."
    });

    try {
      const available = await this.refreshAvailability({
        attemptSessionRestore: false
      });
      if (!available) {
        this.updateSnapshot({
          booting: false,
          authenticated: false,
          sessionUserId: null,
          statusMessage: "Multiplayer server is not reachable right now."
        });
        return;
      }

      await this.restoreSessionAndLobby();
      this.updateSnapshot({
        booting: false,
        statusMessage: this.snapshot.authenticated
          ? "Multiplayer session restored. You are ready to play."
          : "Enter your name once and you will be ready next time."
      });
    } catch (error) {
      this.updateSnapshot({
        booting: false,
        available: false,
        availabilityReason: "Multiplayer server is not reachable right now.",
        onlinePlayers: 0,
        authenticated: false,
        sessionUserId: null,
        error: toErrorMessage(error),
        statusMessage: "Multiplayer server is not reachable right now."
      });
    }
  }

  private async ensureSession() {
    const available = await this.ensureAvailability();
    if (!available) {
      throw new Error("Multiplayer server is not reachable right now.");
    }

    const current = await this.readSession();
    if (current?.user?.id) {
      this.updateSnapshot({
        authenticated: true,
        sessionUserId: current.user.id
      });
      this.startRoomPolling();
      return current;
    }

    const result = await this.auth.signIn.anonymous({});
    if (result.error) {
      throw new Error(result.error.message ?? "Could not create an anonymous account.");
    }

    const next = await this.readSession();
    if (!next?.user?.id) {
      throw new Error("Anonymous session was created, but the session could not be restored.");
    }

    this.updateSnapshot({
      authenticated: true,
      sessionUserId: next.user.id,
      error: null
    });
    this.startRoomPolling();
    return next;
  }

  private async readSession() {
    const result = await this.auth.getSession();
    if (result.error) {
      return null;
    }

    return (result.data ?? null) as SessionPayload | null;
  }

  private async persistDisplayName(displayName: string) {
    const currentName = this.snapshot.profile?.displayName;
    if (currentName === displayName) {
      return;
    }

    await this.fetchJson<{ profile: PlayerProfileSummary }>("/profile", {
      method: "PUT",
      body: JSON.stringify({
        displayName
      })
    });
  }

  private async refreshProfile() {
    const response = await this.fetchJson<PlayerProfileResponse>("/profile");
    this.updateSnapshot({
      profile: response.profile,
      stats: response.stats,
      recentMatches: response.recentMatches,
      authenticated: true,
      error: null
    });
  }

  private async refreshRooms() {
    if (!this.snapshot.sessionUserId) {
      return;
    }

    const response = await this.fetchJson<{ rooms: RoomSummary[] }>("/rooms");
    this.updateSnapshot({
      rooms: response.rooms,
      error: null
    });
  }

  private startRoomPolling() {
    if (this.roomPollTimer !== null) {
      return;
    }

    this.roomPollTimer = this.timers.setInterval(() => {
      void this.refreshRooms().catch(() => {
        // Keep the last known room state if the poll fails.
      });
    }, ROOM_POLL_MS);
  }

  private clearRoomPollTimer() {
    if (this.roomPollTimer !== null) {
      this.timers.clearInterval(this.roomPollTimer);
      this.roomPollTimer = null;
    }
  }

  private startAvailabilityPolling() {
    if (this.availabilityPollTimer !== null) {
      return;
    }

    this.availabilityPollTimer = this.timers.setInterval(() => {
      void this.refreshAvailability().catch(() => {
        // Keep the last known availability state if the poll fails unexpectedly.
      });
    }, HEALTH_POLL_MS);
  }

  private clearAvailabilityPollTimer() {
    if (this.availabilityPollTimer !== null) {
      this.timers.clearInterval(this.availabilityPollTimer);
      this.availabilityPollTimer = null;
    }
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer !== null) {
      this.timers.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private openRoomSocket(
    wsUrl: string,
    joinedRoom: JoinedRoomState,
    recentChat: RoomChatMessage[]
  ) {
    this.leaveRequested = false;
    this.clearReconnectTimer();

    if (this.websocket) {
      this.websocket.close(1000, "replace_room_socket");
    }

    this.updateSnapshot({
      joining: true,
      connectionStatus: "connecting",
      activeRoom: joinedRoom,
      chat: recentChat,
      error: null,
      statusMessage: joinedRoom.countdown.reason
    });

    const socket = this.createWebSocket(wsUrl);
    socket.binaryType = "arraybuffer";
    this.websocket = socket;

    socket.onmessage = (event) => {
      void this.handleSocketMessage(event.data);
    };

    socket.onopen = () => {
      if (this.websocket !== socket) {
        return;
      }

      this.reconnectAttempts = 0;
      this.updateSnapshot({
        joining: false,
        connectionStatus: "connected"
      });
    };

    socket.onerror = () => {
      if (this.websocket !== socket) {
        return;
      }

      this.updateSnapshot({
        error: "The multiplayer connection hit a network error."
      });
    };

    socket.onclose = () => {
      if (this.websocket !== socket) {
        return;
      }

      this.websocket = null;
      if (this.leaveRequested) {
        this.leaveRequested = false;
        return;
      }

      this.updateSnapshot({
        connectionStatus: "disconnected",
        joining: false,
        statusMessage: "Connection lost. Trying to reconnect..."
      });
      void this.tryReconnect();
    };
  }

  private async handleSocketMessage(rawPayload: Blob | ArrayBuffer | Uint8Array) {
    const bytes = await toUint8Array(rawPayload);
    if (bytes.byteLength === 0) {
      return;
    }

    if (bytes[0] === 3) {
      const control = decodeServerControlMessage(bytes);
      this.handleControlMessage(control);
      return;
    }

    if (bytes[0] !== 4) {
      return;
    }

    const state = decodeServerStateMessage(bytes);
    if (state.kind === "bootstrap") {
      this.lastBootstrap = state;
      this.lastWorldDocument = state.world.document;
      this.updateSnapshot({
        activeRoom: state.room,
        chat: state.recentChat,
        joining: false,
        connectionStatus: "connected",
        statusMessage: state.room.countdown.reason
      });
      this.emitRealtime({
        type: "bootstrap",
        frame: state
      });
      return;
    }

    this.updateSnapshot({
      activeRoom: state.room,
      joining: false,
      connectionStatus: "connected",
      statusMessage: state.room.countdown.reason
    });
    this.emitRealtime({
      type: "delta",
      frame: state
    });
  }

  private handleControlMessage(message: ServerControlMessage) {
    this.emitRealtime({
      type: "control",
      message
    });

    if (message.type === "chat_message") {
      const nextChat = [...this.snapshot.chat, message.message].slice(-MAX_CHAT_MESSAGES);
      this.updateSnapshot({
        chat: nextChat
      });
      return;
    }

    if (message.type === "room_state" || message.type === "presence_update") {
      this.updateSnapshot({
        activeRoom: message.room,
        statusMessage: message.room.countdown.reason
      });
      this.emitRealtime({
        type: "room_state",
        room: message.room
      });
      return;
    }

    if (message.type === "ping") {
      if (this.websocket && this.websocket.readyState === this.socketOpenState) {
        this.websocket.send(
          encodeClientControlMessage({
            type: "pong",
            at: message.at
          })
        );
      }
      return;
    }

    if (message.type === "error") {
      this.updateSnapshot({
        error: message.message,
        statusMessage: message.message
      });
      this.emitRealtime({
        type: "status",
        message: message.message
      });
      return;
    }

    if (message.type === "reconnect_ticket") {
      this.emitRealtime({
        type: "status",
        message: "Reconnect token refreshed."
      });
    }
  }

  private async tryReconnect() {
    const activeRoom = this.snapshot.activeRoom;
    const sessionUserId = this.snapshot.sessionUserId;
    if (!activeRoom || !sessionUserId) {
      return;
    }

    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.updateSnapshot({
        connectionStatus: "disconnected",
        error: "Reconnect failed. Return to the menu and join again.",
        statusMessage: "Reconnect failed. Return to the menu and join again."
      });
      return;
    }

    this.reconnectAttempts += 1;
    this.updateSnapshot({
      connectionStatus: "reconnecting",
      statusMessage: `Reconnecting to ${activeRoom.roomName}...`
    });

    try {
      const response = await this.fetchJson<{ reconnect: { wsUrl: string } }>("/reconnect", {
        method: "POST",
        body: JSON.stringify({
          roomId: activeRoom.roomId,
          roomPlayerId: sessionUserId
        })
      });
      this.openRoomSocket(response.reconnect.wsUrl, activeRoom, this.snapshot.chat);
    } catch (error) {
      this.updateSnapshot({
        error: toErrorMessage(error),
        statusMessage: "Reconnect failed. Retrying..."
      });
      this.clearReconnectTimer();
      this.reconnectTimer = this.timers.setTimeout(() => {
        void this.tryReconnect();
      }, 1_500 * this.reconnectAttempts);
    }
  }

  private async ensureAvailability() {
    if (this.snapshot.available) {
      return true;
    }

    this.startAvailabilityPolling();
    return this.refreshAvailability({
      attemptSessionRestore: false
    });
  }

  private async restoreSessionAndLobby() {
    const session = await this.readSession();
    if (!session?.user?.id) {
      this.clearRoomPollTimer();
      this.updateSnapshot({
        authenticated: false,
        sessionUserId: null,
        profile: null,
        stats: null,
        recentMatches: [],
        rooms: [],
        error: null
      });
      return;
    }

    this.updateSnapshot({
      authenticated: true,
      sessionUserId: session.user.id,
      error: null
    });
    await Promise.all([this.refreshProfile(), this.refreshRooms()]);
    this.startRoomPolling();
  }

  private async refreshAvailability(options: { attemptSessionRestore?: boolean } = {}) {
    const attemptSessionRestore = options.attemptSessionRestore ?? true;
    const wasAvailable = this.snapshot.available;

    try {
      const response = await this.fetchJson<HealthResponse>("/health");
      const isAvailable = Boolean(response.ok);
      this.updateSnapshot({
        available: isAvailable,
        availabilityReason: isAvailable ? null : "Multiplayer server is not reachable right now.",
        onlinePlayers: response.onlinePlayers,
        error:
          !this.snapshot.activeRoom && this.snapshot.error === "Multiplayer server is not reachable right now."
            ? null
            : this.snapshot.error
      });

      if (attemptSessionRestore && isAvailable && !wasAvailable && !this.snapshot.activeRoom) {
        await this.restoreSessionAndLobby();
      }

      return isAvailable;
    } catch {
      if (!this.snapshot.activeRoom) {
        this.clearRoomPollTimer();
      }

      this.updateSnapshot({
        available: false,
        availabilityReason: "Multiplayer server is not reachable right now.",
        onlinePlayers: 0,
        rooms: this.snapshot.activeRoom ? this.snapshot.rooms : []
      });
      return false;
    }
  }

  private emitRealtime(event: MultiplayerRealtimeEvent) {
    for (const listener of this.realtimeListeners) {
      listener(event);
    }
  }

  private async fetchJson<T>(path: string, init?: RequestInit) {
    const response = await this.fetchImpl(`${this.serverBaseUrl}${path}`, {
      credentials: "include",
      ...init,
      headers: {
        "content-type": "application/json",
        ...(init?.headers ?? {})
      }
    });

    if (!response.ok) {
      let message = response.statusText || "Request failed.";
      try {
        const payload = (await response.json()) as { error?: string; message?: string };
        message = payload.error ?? payload.message ?? message;
      } catch {
        // Ignore malformed error bodies.
      }
      throw new Error(message);
    }

    return (await response.json()) as T;
  }

  private updateSnapshot(patch: Partial<MultiplayerSnapshot>) {
    this.snapshot = {
      ...this.snapshot,
      ...patch
    };

    for (const listener of this.snapshotListeners) {
      listener(this.snapshot);
    }
  }
}
