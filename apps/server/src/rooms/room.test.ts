import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SURFACE_Y } from "@out-of-bounds/map";
import {
  createEmptyRuntimeInputCommand,
  decodeServerControlMessage,
  decodeServerStateMessage,
  encodeRuntimeInputPacket,
  packRuntimeInputCommand
} from "@out-of-bounds/netcode";
import { createWarmPlaylistMaps } from "../lib/maps";
import { MemoryPlayerRepository, type CompletedMatchRecord } from "../lib/playerRepository";
import { Room } from "./room";

class FakeSocket {
  readonly sent: (string | ArrayBufferView | ArrayBuffer)[] = [];
  closeCalls: { code?: number; reason?: string }[] = [];

  send(data: string | ArrayBufferView | ArrayBuffer) {
    this.sent.push(data);
  }

  close(code?: number, reason?: string) {
    this.closeCalls.push({ code, reason });
  }
}

const findLastControlPacket = (
  messages: (string | ArrayBufferView | ArrayBuffer)[]
) => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!(message instanceof Uint8Array || message instanceof ArrayBuffer)) {
      continue;
    }

    const bytes = message instanceof Uint8Array ? message : new Uint8Array(message);
    if (bytes[0] === 3) {
      return message;
    }
  }

  return null;
};

const findLastStatePacket = (
  messages: (string | ArrayBufferView | ArrayBuffer)[]
) => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!(message instanceof Uint8Array || message instanceof ArrayBuffer)) {
      continue;
    }

    const bytes = message instanceof Uint8Array ? message : new Uint8Array(message);
    if (bytes[0] === 4) {
      return message;
    }
  }

  return null;
};

const createRoom = (playerRepository = new MemoryPlayerRepository()) =>
  new Room(
    {
      id: "warm-1",
      name: "Warm Room 1",
      region: "local-us",
      capacity: 24,
      warm: true,
      playlist: [createWarmPlaylistMaps()[0]!],
      publicServerUrl: "http://localhost:3000"
    },
    playerRepository
  );

const createRoomWithCapacity = (
  capacity: number,
  playerRepository = new MemoryPlayerRepository()
) =>
  new Room(
    {
      id: "warm-1",
      name: "Warm Room 1",
      region: "local-us",
      capacity,
      warm: true,
      playlist: [createWarmPlaylistMaps()[0]!],
      publicServerUrl: "http://localhost:3000"
    },
    playerRepository
  );

const connectMember = (room: Room, index: number) => {
  const userId = `user-${index}`;
  const join = room.issueJoinTicket({
    userId,
    displayName: `Player ${index}`,
    avatarUrl: null
  });
  const socket = new FakeSocket();
  const session = room.connect(join.ticket, userId, socket);
  expect(session).not.toBeNull();
  return {
    bootstrap: session!.bootstrap,
    connectionId: session!.connectionId,
    socket,
    userId
  };
};

const advanceTime = (ms: number) => {
  vi.setSystemTime(Date.now() + ms);
};

const flushPromises = async () => {
  await Promise.resolve();
};

const createDeferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return {
    promise,
    resolve,
    reject
  };
};

const PLAYER_GROUND_Y = DEFAULT_SURFACE_Y + 0.05;

const startLiveRoom = () => {
  const room = createRoom();
  const first = connectMember(room, 1);
  const second = connectMember(room, 2);

  room.tick(1 / 60);
  advanceTime(21_000);
  room.tick(1 / 60);

  expect(room.getSummary().phase).toBe("live");
  return { room, first, second };
};

describe("Room", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-08T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts in a waiting state with a map assigned", () => {
    const room = createRoom();
    expect(room.getSummary()).toMatchObject({
      phase: "waiting",
      mapName: expect.any(String)
    });
  });

  it("issues join tickets and exposes joined room state", () => {
    const room = createRoom();
    const join = room.issueJoinTicket({
      userId: "user-1",
      displayName: "Anthony",
      avatarUrl: null
    });

    expect(join.room.roomId).toBe("warm-1");
    expect(join.ticket).toBeTruthy();
    expect(join.wsUrl).toContain("/ws?ticket=");
  });

  it("rejects invalid tickets and ignores runtime input for unknown players", () => {
    const room = createRoom();
    expect(room.connect("missing-ticket", "user-1", new FakeSocket())).toBeNull();
    room.receiveRuntimeInput(
      "missing-user",
      "missing-connection",
      encodeRuntimeInputPacket(packRuntimeInputCommand(createEmptyRuntimeInputCommand()))
    );
  });

  it("starts countdowns once two humans connect and cancels if one leaves", () => {
    const room = createRoom();
    connectMember(room, 1);
    const second = connectMember(room, 2);

    room.tick(1 / 60);
    expect(room.getSummary()).toMatchObject({
      phase: "countdown"
    });
    expect(room.getSummary().countdown.reason).toContain("Starting in");

    room.disconnect("user-2", second.connectionId);
    room.tick(1 / 60);

    expect(room.getSummary()).toMatchObject({
      phase: "waiting"
    });
    expect(room.getSummary().countdown.reason).toContain("Waiting for 1 more player");
  });

  it("removes members immediately when they explicitly leave and frees room capacity", () => {
    const room = createRoomWithCapacity(2);
    connectMember(room, 1);
    const second = connectMember(room, 2);

    expect(room.getJoinedRoomState().joinable).toBe(false);
    expect(room.leave("user-2")).toBe(true);

    expect(second.socket.closeCalls.at(-1)).toMatchObject({
      code: 1000,
      reason: "leave_room"
    });
    expect(room.getJoinedRoomState()).toMatchObject({
      joinable: true,
      players: [expect.objectContaining({ userId: "user-1" })]
    });

    const third = connectMember(room, 3);
    expect(third.bootstrap.room.players.some((player) => player.userId === "user-3")).toBe(true);
    expect(room.getSummary()).toMatchObject({
      humans: 2,
      connected: 2
    });
  });

  it("prunes disconnected members after reconnect grace expires", () => {
    const room = createRoomWithCapacity(2);
    connectMember(room, 1);
    const second = connectMember(room, 2);

    const reconnect = room.disconnect("user-2", second.connectionId);
    expect(reconnect?.roomId).toBe("warm-1");
    expect(room.getJoinedRoomState()).toMatchObject({
      joinable: false
    });
    expect(
      room.getJoinedRoomState().players.find((player) => player.userId === "user-2")
    ).toMatchObject({
      connected: false,
      presence: "waiting"
    });

    advanceTime(20_001);
    room.tick(1 / 60);

    expect(room.getJoinedRoomState()).toMatchObject({
      joinable: true,
      players: [expect.objectContaining({ userId: "user-1" })]
    });
    expect(room.issueReconnectTicket("user-2")).toBeNull();
    expect(room.getSummary()).toMatchObject({
      humans: 1,
      connected: 1
    });
  });

  it("admits late joiners as mid-round spectators", () => {
    const room = createRoom();
    const first = connectMember(room, 1);
    connectMember(room, 2);

    room.tick(1 / 60);
    advanceTime(21_000);
    room.receiveRuntimeInput(
      "user-1",
      first.connectionId,
      encodeRuntimeInputPacket(packRuntimeInputCommand(createEmptyRuntimeInputCommand()))
    );
    room.tick(1 / 60);

    expect(room.getSummary().phase).toBe("live");

    const lateJoin = connectMember(room, 3);

    expect(lateJoin.bootstrap.room.phase).toBe("live");
    expect(
      lateJoin.bootstrap.room.players.find((player) => player.userId === "user-3")?.presence
    ).toBe("mid_round_spectating");
    expect(lateJoin.bootstrap.localOverlay.localPlayerId).toBeNull();
  });

  it("ignores stale disconnects after a replacement connection takes over", () => {
    const room = createRoom();
    const join = room.issueJoinTicket({
      userId: "user-1",
      displayName: "Player 1",
      avatarUrl: null
    });
    const firstSocket = new FakeSocket();
    const firstSession = room.connect(join.ticket, "user-1", firstSocket);
    expect(firstSession).not.toBeNull();

    const replacementJoin = room.issueJoinTicket({
      userId: "user-1",
      displayName: "Player 1",
      avatarUrl: null
    });
    const replacementSocket = new FakeSocket();
    const replacementSession = room.connect(
      replacementJoin.ticket,
      "user-1",
      replacementSocket
    );
    expect(replacementSession).not.toBeNull();
    expect(firstSocket.closeCalls.at(-1)).toMatchObject({
      code: 4001,
      reason: "replaced_connection"
    });

    expect(room.disconnect("user-1", firstSession!.connectionId)).toBeNull();
    expect(
      room.getJoinedRoomState().players.find((player) => player.userId === "user-1")
    ).toMatchObject({
      connected: true,
      presence: "waiting"
    });

    const reconnect = room.disconnect("user-1", replacementSession!.connectionId);
    expect(reconnect?.roomId).toBe("warm-1");
    expect(
      room.getJoinedRoomState().players.find((player) => player.userId === "user-1")
    ).toMatchObject({
      connected: false,
      presence: "waiting"
    });
  });

  it("rate limits waiting-room chat and reports the error back to the sender", () => {
    const room = createRoom();
    const { connectionId, socket } = connectMember(room, 1);

    for (let index = 0; index < 5; index += 1) {
      room.receiveControl("user-1", connectionId, {
        type: "chat_send",
        text: `message ${index}`
      });
    }
    room.receiveControl("user-1", connectionId, {
      type: "chat_send",
      text: "one too many"
    });

    const lastControl = decodeServerControlMessage(
      findLastControlPacket(socket.sent) as ArrayBuffer | Uint8Array
    );
    expect(lastControl).toMatchObject({
      type: "error",
      code: "chat_rate_limited"
    });
  });

  it("times out live rounds, records stats, and resets with a fresh bootstrap", async () => {
    const playerRepository = new MemoryPlayerRepository();
    await playerRepository.ensureProfile("user-1", "Player 1");
    await playerRepository.ensureProfile("user-2", "Player 2");
    const room = createRoom(playerRepository);
    const first = connectMember(room, 1);
    const second = connectMember(room, 2);

    room.tick(1 / 60);
    advanceTime(21_000);
    room.tick(1 / 60);
    expect(room.getSummary().phase).toBe("live");

    advanceTime(5 * 60_000 + 1);
    room.tick(1 / 60);
    await flushPromises();

    expect(room.getSummary().phase).toBe("post_round");
    expect(playerRepository.matches).toHaveLength(1);
    expect((await playerRepository.getProfile("user-1"))?.stats.totalMatches).toBe(1);
    expect((await playerRepository.getProfile("user-2"))?.stats.totalMatches).toBe(1);

    advanceTime(5_000);
    room.tick(1 / 60);

    expect(room.getSummary().phase).toBe("waiting");
    const hasBootstrap = first.socket.sent.some((message) => {
      if (!(message instanceof Uint8Array || message instanceof ArrayBuffer)) {
        return false;
      }

      const bytes = message instanceof Uint8Array ? message : new Uint8Array(message);
      return bytes[0] === 4 && decodeServerStateMessage(message).kind === "bootstrap";
    });
    expect(hasBootstrap).toBe(true);
    expect(second.socket.sent.length).toBeGreaterThan(0);
  });

  it("finalizes a live round once even if match persistence is still pending or fails", async () => {
    const deferred = createDeferred<void>();
    const playerRepository = new MemoryPlayerRepository();
    const recordCompletedMatch = vi.fn(
      (_record: CompletedMatchRecord) => deferred.promise
    );
    playerRepository.recordCompletedMatch = recordCompletedMatch;
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const room = createRoom(playerRepository);
    connectMember(room, 1);
    connectMember(room, 2);

    room.tick(1 / 60);
    advanceTime(21_000);
    room.tick(1 / 60);
    expect(room.getSummary().phase).toBe("live");

    advanceTime(5 * 60_000 + 1);
    room.tick(1 / 60);

    expect(room.getSummary().phase).toBe("post_round");
    expect(recordCompletedMatch).toHaveBeenCalledTimes(1);

    advanceTime(60);
    room.tick(1 / 60);
    expect(recordCompletedMatch).toHaveBeenCalledTimes(1);

    deferred.reject(new Error("database offline"));
    await flushPromises();
    await flushPromises();

    expect(room.getSummary().phase).toBe("post_round");
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    consoleErrorSpy.mockRestore();
  });

  it("clears transient runtime input flags after each live tick", () => {
    const { room, first } = startLiveRoom();
    const encodedInput = encodeRuntimeInputPacket(
      packRuntimeInputCommand({
        ...createEmptyRuntimeInputCommand(4),
        typedText: "go",
        jumpPressed: true,
        jumpReleased: true,
        place: true,
        push: true,
        layEgg: true,
        eggCharge: 0.75,
        eggPitch: 0.35
      })
    );

    room.receiveRuntimeInput("user-1", first.connectionId, encodedInput);
    advanceTime(60);
    room.tick(1 / 60);

    const member = ((room as unknown as { members: Map<string, { lastInput: ReturnType<typeof createEmptyRuntimeInputCommand> }> }).members).get("user-1");
    expect(member?.lastInput).toMatchObject({
      typedText: "",
      jumpPressed: false,
      jumpReleased: false,
      place: false,
      push: false,
      layEgg: false,
      eggCharge: 0,
      eggPitch: 0
    });
  });

  it("merges queued runtime edges into the newest packet before the next live tick", () => {
    const { room, first } = startLiveRoom();
    const firstPacket = encodeRuntimeInputPacket(
      packRuntimeInputCommand({
        ...createEmptyRuntimeInputCommand(4),
        typedText: "g",
        jumpPressed: true,
        destroy: true,
        targetVoxel: { x: 4, y: 2, z: 5 },
        targetNormal: { x: 0, y: 1, z: 0 }
      })
    );
    const secondPacket = encodeRuntimeInputPacket(
      packRuntimeInputCommand({
        ...createEmptyRuntimeInputCommand(5),
        typedText: "o",
        jumpReleased: true
      })
    );

    room.receiveRuntimeInput("user-1", first.connectionId, firstPacket);
    room.receiveRuntimeInput("user-1", first.connectionId, secondPacket);

    const member = ((room as unknown as { members: Map<string, { lastInput: ReturnType<typeof createEmptyRuntimeInputCommand> }> }).members).get("user-1");
    expect(member?.lastInput).toMatchObject({
      seq: 5,
      typedText: "go",
      jumpPressed: true,
      jumpReleased: true,
      destroy: true,
      targetVoxel: { x: 4, y: 2, z: 5 },
      targetNormal: { x: 0, y: 1, z: 0 }
    });

    advanceTime(60);
    room.tick(1 / 60);

    expect(member?.lastInput).toMatchObject({
      seq: 5,
      typedText: "",
      jumpPressed: false,
      jumpReleased: false,
      destroy: false,
      targetVoxel: { x: 4, y: 2, z: 5 },
      targetNormal: { x: 0, y: 1, z: 0 }
    });
  });

  it("rejects malformed runtime input packets without dropping the current connection", () => {
    const room = createRoom();
    const { connectionId, socket } = connectMember(room, 1);

    room.receiveRuntimeInput("user-1", connectionId, new Uint8Array([1, 2]));

    const lastControl = decodeServerControlMessage(
      findLastControlPacket(socket.sent) as ArrayBuffer | Uint8Array
    );
    expect(lastControl).toMatchObject({
      type: "error",
      code: "invalid_runtime_input"
    });
    expect(socket.closeCalls).toHaveLength(0);
    expect(
      room.getJoinedRoomState().players.find((player) => player.userId === "user-1")
    ).toMatchObject({
      connected: true
    });
  });

  it("triggers super boom through live room runtime input and broadcasts the impact", () => {
    const { room, first } = startLiveRoom();
    const simulation = (room as unknown as { simulation: { getPlayerRuntimeState: (playerId: string) => any; getWorld: () => { getTerrainRevision: () => number } } }).simulation;
    const localPlayer = simulation.getPlayerRuntimeState("user-1");
    const victim = simulation.getPlayerRuntimeState("user-2");

    expect(localPlayer).toBeTruthy();
    expect(victim).toBeTruthy();

    localPlayer.position = { x: 18.5, y: DEFAULT_SURFACE_Y + 3, z: 18.5 };
    localPlayer.velocity = { x: 0, y: 0, z: 0 };
    localPlayer.facing = { x: 0, z: 1 };
    localPlayer.grounded = false;
    localPlayer.mass = 120;
    localPlayer.spacePhase = "float";
    localPlayer.spacePhaseRemaining = 5;
    localPlayer.spaceTriggerArmed = false;
    localPlayer.spaceChallengeTargetKey = "g";
    localPlayer.spaceChallengeHits = 3;
    localPlayer.spaceChallengeRequiredHits = 5;

    victim.position = { x: 20.4, y: PLAYER_GROUND_Y, z: 18.5 };
    victim.velocity = { x: 0, y: 0, z: 0 };
    victim.grounded = true;

    const terrainRevisionBeforeImpact = simulation.getWorld().getTerrainRevision();
    room.receiveRuntimeInput(
      "user-1",
      first.connectionId,
      encodeRuntimeInputPacket(
        packRuntimeInputCommand({
          ...createEmptyRuntimeInputCommand(7),
          typedText: "xgg"
        })
      )
    );

    advanceTime(60);
    room.tick(1 / 60);

    expect(localPlayer.spacePhase).toBe("superBoomDive");

    let impactStatePacket: ArrayBuffer | Uint8Array | null = null;
    for (let step = 0; step < 8; step += 1) {
      advanceTime(60);
      room.tick(1 / 60);
      if (localPlayer.spacePhase === "superBoomImpact") {
        impactStatePacket = findLastStatePacket(first.socket.sent);
        break;
      }
    }

    expect(localPlayer.spacePhase).toBe("superBoomImpact");
    expect(simulation.getWorld().getTerrainRevision()).toBeGreaterThan(terrainRevisionBeforeImpact);

    const victimAfterImpact = simulation.getPlayerRuntimeState("user-2");
    expect(victimAfterImpact.livesRemaining).toBe(victimAfterImpact.maxLives - 1);

    const lastState = decodeServerStateMessage(impactStatePacket as ArrayBuffer | Uint8Array);
    expect(lastState.kind).toBe("delta");
    if (lastState.kind !== "delta") {
      throw new Error("Expected a live delta frame.");
    }

    expect(lastState.localOverlay.hudState?.spaceChallenge).toMatchObject({
      targetKey: "g",
      phase: "dive"
    });
    expect(lastState.sharedFrame.terrainDeltaBatch?.changes.some((change) => change.source === "super_boom_explosion")).toBe(true);
    expect(lastState.sharedFrame.voxelBursts.some((burst) => burst.style === "superBoomExplosion")).toBe(true);
  });

  it("keeps pending terrain deltas available for existing players when a spectator bootstraps mid-round", () => {
    const { room, first } = startLiveRoom();
    const roomState = room as unknown as {
      lastBroadcastAt: number;
      simulation: {
        getPlayerRuntimeState: (playerId: string) => any;
        getWorld: () => { getTerrainRevision: () => number };
      };
    };
    const localPlayer = roomState.simulation.getPlayerRuntimeState("user-1");
    const victim = roomState.simulation.getPlayerRuntimeState("user-2");

    localPlayer.position = { x: 18.5, y: DEFAULT_SURFACE_Y + 3, z: 18.5 };
    localPlayer.velocity = { x: 0, y: 0, z: 0 };
    localPlayer.facing = { x: 0, z: 1 };
    localPlayer.grounded = false;
    localPlayer.mass = 120;
    localPlayer.spacePhase = "float";
    localPlayer.spacePhaseRemaining = 5;
    localPlayer.spaceTriggerArmed = false;
    localPlayer.spaceChallengeTargetKey = "g";
    localPlayer.spaceChallengeHits = 3;
    localPlayer.spaceChallengeRequiredHits = 5;

    victim.position = { x: 20.4, y: PLAYER_GROUND_Y, z: 18.5 };
    victim.velocity = { x: 0, y: 0, z: 0 };
    victim.grounded = true;

    const terrainRevisionBeforeImpact = roomState.simulation.getWorld().getTerrainRevision();
    room.receiveRuntimeInput(
      "user-1",
      first.connectionId,
      encodeRuntimeInputPacket(
        packRuntimeInputCommand({
          ...createEmptyRuntimeInputCommand(9),
          typedText: "xgg"
        })
      )
    );

    for (let step = 0; step < 12; step += 1) {
      advanceTime(60);
      roomState.lastBroadcastAt = Date.now();
      room.tick(1 / 60);
      if (roomState.simulation.getWorld().getTerrainRevision() > terrainRevisionBeforeImpact) {
        break;
      }
    }

    expect(roomState.simulation.getWorld().getTerrainRevision()).toBeGreaterThan(
      terrainRevisionBeforeImpact
    );

    const lateJoin = connectMember(room, 3);
    expect(lateJoin.bootstrap.sharedFrame.terrainDeltaBatch).toBeNull();

    advanceTime(60);
    room.tick(1 / 60);

    const lastState = decodeServerStateMessage(
      findLastStatePacket(first.socket.sent) as ArrayBuffer | Uint8Array
    );
    expect(lastState.kind).toBe("delta");
    if (lastState.kind !== "delta") {
      throw new Error("Expected a live delta frame.");
    }

    expect(
      lastState.sharedFrame.terrainDeltaBatch?.changes.some(
        (change) => change.source === "super_boom_explosion"
      )
    ).toBe(true);
  });
});
