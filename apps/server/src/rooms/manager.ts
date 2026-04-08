import type {
  JoinTicket,
  PlayerProfileSummary,
  ReconnectTicket,
  RoomSummary
} from "@out-of-bounds/netcode";
import type { PlayerRepository } from "../lib/playerRepository";
import type { PlaylistMap } from "../lib/maps";
import { Room, type RoomConfig, type RoomProfile, type RoomSocket } from "./room";

const ROOM_CAPACITY = 24;

export interface RoomManagerConfig {
  region: string;
  publicServerUrl: string;
  playerRepository: PlayerRepository;
  warmRooms: {
    id: string;
    name: string;
    playlist: PlaylistMap[];
  }[];
}

export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly playerRoomIndex = new Map<string, string>();
  private tickInterval: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly config: RoomManagerConfig) {
    for (const warmRoom of config.warmRooms) {
      this.rooms.set(
        warmRoom.id,
        new Room(
          {
            id: warmRoom.id,
            name: warmRoom.name,
            region: config.region,
            capacity: ROOM_CAPACITY,
            warm: true,
            playlist: warmRoom.playlist,
            publicServerUrl: config.publicServerUrl
          },
          config.playerRepository
        )
      );
    }
  }

  start() {
    if (this.tickInterval) {
      return;
    }

    this.tickInterval = setInterval(() => {
      for (const room of this.rooms.values()) {
        room.tick(1 / 60);
      }
    }, 1000 / 60);
  }

  stop() {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }

  listRooms(): RoomSummary[] {
    return [...this.rooms.values()].map((room) => room.getSummary());
  }

  quickJoin(profile: RoomProfile): JoinTicket {
    const room = this.pickQuickJoinRoom();
    const join = room.issueJoinTicket(profile);
    this.playerRoomIndex.set(profile.userId, room.id);
    return join;
  }

  joinRoom(roomId: string, profile: RoomProfile): JoinTicket {
    const room = this.rooms.get(roomId);
    if (!room) {
      throw new Error("Room not found.");
    }

    const join = room.issueJoinTicket(profile);
    this.playerRoomIndex.set(profile.userId, room.id);
    return join;
  }

  connect(ticket: string, userId: string, socket: RoomSocket) {
    const indexedRoomId = this.playerRoomIndex.get(userId);
    if (indexedRoomId) {
      const indexedRoom = this.rooms.get(indexedRoomId);
      const bootstrap = indexedRoom?.connect(ticket, userId, socket) ?? null;
      if (bootstrap) {
        return bootstrap;
      }
    }

    for (const [roomId, room] of this.rooms) {
      const bootstrap = room.connect(ticket, userId, socket);
      if (bootstrap) {
        this.playerRoomIndex.set(userId, roomId);
        return bootstrap;
      }
    }

    return null;
  }

  disconnect(roomPlayerId: string) {
    const roomId = this.playerRoomIndex.get(roomPlayerId);
    if (!roomId) {
      return null;
    }

    return this.rooms.get(roomId)?.disconnect(roomPlayerId) ?? null;
  }

  receiveControl(roomPlayerId: string, message: Parameters<Room["receiveControl"]>[1]) {
    const roomId = this.playerRoomIndex.get(roomPlayerId);
    if (roomId) {
      this.rooms.get(roomId)?.receiveControl(roomPlayerId, message);
    }
  }

  receiveRuntimeInput(roomPlayerId: string, packet: Parameters<Room["receiveRuntimeInput"]>[1]) {
    const roomId = this.playerRoomIndex.get(roomPlayerId);
    if (roomId) {
      this.rooms.get(roomId)?.receiveRuntimeInput(roomPlayerId, packet);
    }
  }

  createReconnectTicket(roomId: string, roomPlayerId: string): ReconnectTicket | null {
    const room = this.rooms.get(roomId);
    return room ? room.issueReconnectTicket(roomPlayerId) : null;
  }

  private pickQuickJoinRoom() {
    const rooms = [...this.rooms.values()].map((room) => ({
      room,
      summary: room.getSummary()
    }));
    const waitingRooms = rooms
      .filter(({ summary }) => summary.joinable && summary.phase !== "live")
      .sort((left, right) => right.summary.humans - left.summary.humans);
    if (waitingRooms.length > 0) {
      return waitingRooms[0]!.room;
    }

    const spectateRooms = rooms
      .filter(({ summary }) => summary.joinable)
      .sort((left, right) => right.summary.connected - left.summary.connected);
    if (spectateRooms.length > 0) {
      return spectateRooms[0]!.room;
    }

    const overflowIndex = rooms.filter(({ summary }) => !summary.warm).length + 1;
    const overflowRoom = new Room(
      {
        id: `overflow-${overflowIndex}`,
        name: `Overflow ${overflowIndex}`,
        region: this.config.region,
        capacity: ROOM_CAPACITY,
        warm: false,
        playlist: this.config.warmRooms[0]!.playlist,
        publicServerUrl: this.config.publicServerUrl
      },
      this.config.playerRepository
    );
    this.rooms.set(overflowRoom.id, overflowRoom);
    return overflowRoom;
  }
}
