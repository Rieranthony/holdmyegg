import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEmptyRuntimeInputCommand,
  decodeServerControlMessage,
  encodeRuntimeInputPacket,
  packRuntimeInputCommand
} from "@out-of-bounds/netcode";
import { createWarmPlaylistMaps } from "../lib/maps";
import { MemoryPlayerRepository } from "../lib/playerRepository";
import { RoomManager } from "./manager";

class FakeSocket {
  readonly sent: (string | ArrayBufferView | ArrayBuffer)[] = [];

  send(data: string | ArrayBufferView | ArrayBuffer) {
    this.sent.push(data);
  }
}

const createManager = () =>
  new RoomManager({
    region: "local-us",
    publicServerUrl: "http://localhost:3000",
    playerRepository: new MemoryPlayerRepository(),
    warmRooms: createWarmPlaylistMaps().slice(0, 2).map((map, index) => ({
      id: `warm-${index + 1}`,
      name: `Warm Room ${index + 1}`,
      playlist: [map]
    }))
  });

const createProfile = (index: number) => ({
  userId: `user-${index}`,
  displayName: `Player ${index}`,
  avatarUrl: null
});

describe("RoomManager", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("prefers the busiest waiting room for quick join", () => {
    const manager = createManager();
    manager.joinRoom("warm-1", createProfile(1));
    manager.joinRoom("warm-1", createProfile(2));
    manager.joinRoom("warm-2", createProfile(3));

    const join = manager.quickJoin(createProfile(4));

    expect(join.room.roomId).toBe("warm-1");
  });

  it("creates overflow rooms when all public rooms are full", () => {
    const manager = createManager();
    for (let index = 1; index <= 24; index += 1) {
      manager.joinRoom("warm-1", createProfile(index));
      manager.joinRoom("warm-2", createProfile(index + 100));
    }

    const join = manager.quickJoin(createProfile(999));

    expect(join.room.roomId).toBe("overflow-1");
    expect(manager.listRooms().some((room) => room.id === "overflow-1")).toBe(true);
  });

  it("routes control messages and reconnects back to the indexed room", () => {
    const manager = createManager();
    const join = manager.joinRoom("warm-1", createProfile(1));
    const socket = new FakeSocket();
    const reconnectSocket = new FakeSocket();

    expect(manager.connect(join.ticket, "user-1", socket)).not.toBeNull();

    manager.receiveControl("user-1", {
      type: "chat_send",
      text: "hello room"
    });
    const chatMessage = decodeServerControlMessage(
      socket.sent.at(-1) as ArrayBuffer | Uint8Array
    );
    expect(chatMessage).toMatchObject({
      type: "chat_message"
    });

    const reconnect = manager.disconnect("user-1");
    expect(reconnect?.roomId).toBe("warm-1");
    expect(manager.connect(reconnect!.ticket, "user-1", reconnectSocket)).not.toBeNull();
  });

  it("starts and stops the room tick loop without duplicating timers and accepts runtime input", () => {
    const manager = createManager();
    const join = manager.joinRoom("warm-1", createProfile(1));
    const socket = new FakeSocket();

    manager.start();
    manager.start();
    expect(manager.connect(join.ticket, "user-1", socket)).not.toBeNull();
    manager.receiveRuntimeInput(
      "user-1",
      encodeRuntimeInputPacket(packRuntimeInputCommand(createEmptyRuntimeInputCommand()))
    );

    vi.advanceTimersByTime(1000 / 60);
    manager.stop();
    manager.stop();

    expect(socket.sent.length).toBeGreaterThan(0);
  });
});
