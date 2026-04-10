import { describe, expect, it } from "vitest";
import {
  createEmptyRuntimeInputCommand,
  decodeClientControlMessage,
  decodeRuntimeInputPacket,
  decodeServerControlMessage,
  decodeServerStateMessage,
  encodeClientControlMessage,
  encodeRuntimeInputPacket,
  packRuntimeInputCommand,
  encodeServerControlMessage,
  encodeServerStateMessage
} from "./index";

describe("wire helpers", () => {
  it("round-trips control and state payloads through msgpack envelopes", () => {
    expect(
      decodeClientControlMessage(encodeClientControlMessage({ type: "chat_send", text: "hello" }))
    ).toEqual({ type: "chat_send", text: "hello" });
    expect(
      decodeServerControlMessage(
        encodeServerControlMessage({
          type: "error",
          code: "oops",
          message: "bad"
        })
      )
    ).toEqual({
      type: "error",
      code: "oops",
      message: "bad"
    });
    expect(
      decodeServerStateMessage(
        encodeServerStateMessage({
          kind: "delta",
          room: {
            roomId: "room-1",
            roomName: "Room 1",
            mapId: "map-1",
            mapName: "Arena",
            region: "us-west",
            phase: "waiting",
            capacity: 24,
            joinable: true,
            countdown: {
              active: false,
              startsAt: null,
              secondsRemaining: 0,
              reason: "Waiting"
            },
            players: [],
            score: {
              updatedAt: new Date(0).toISOString(),
              entries: []
            }
          },
          sharedFrame: {
            tick: 1,
            time: 0,
            mode: "multiplayer",
            players: [],
            eggs: [],
            eggScatterDebris: [],
            voxelBursts: [],
            skyDrops: [],
            fallingClusters: [],
            authoritativeState: {
              tick: 1,
              time: 0,
              mode: "multiplayer",
              localPlayerId: null,
              players: [],
              projectiles: [],
              hazards: {
                fallingClusters: [],
                skyDrops: [],
                eggScatterDebris: [],
                waterFlood: {
                  active: false,
                  breachLevelY: 0,
                  currentLevelY: 0,
                  targetLevelY: 0
                }
              },
              stats: {
                terrainRevision: 0
              },
              ranking: []
            },
            terrainDeltaBatch: null,
            gameplayEventBatch: null
          },
          localOverlay: {
            localPlayerId: null,
            hudState: null,
            focusState: null
          }
        })
      )
    ).toMatchObject({
      kind: "delta",
      room: {
        roomId: "room-1"
      }
    });
  });

  it("wraps raw runtime input bytes with a packet header", () => {
    const raw = packRuntimeInputCommand(createEmptyRuntimeInputCommand());
    const unpacked = decodeRuntimeInputPacket(encodeRuntimeInputPacket(raw));
    expect(unpacked.byteLength).toBe(raw.byteLength);
  });

  it("rejects invalid control packet kinds", () => {
    expect(() => decodeClientControlMessage(new Uint8Array([3, 1, 2, 3]))).toThrow(
      "Invalid client control packet kind."
    );
  });

  it("rejects runtime input packets with the wrong payload length", () => {
    expect(() => decodeRuntimeInputPacket(new Uint8Array([1, 0, 0]))).toThrow(
      "Invalid runtime input packet length."
    );
  });
});
