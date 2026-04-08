import { decode, encode } from "@msgpack/msgpack";
import type {
  ClientControlMessage,
  ServerBootstrapFrame,
  ServerControlMessage,
  ServerStateDeltaFrame
} from "./types";

export const WS_PACKET_KIND_RUNTIME_INPUT = 1;
export const WS_PACKET_KIND_CLIENT_CONTROL = 2;
export const WS_PACKET_KIND_SERVER_CONTROL = 3;
export const WS_PACKET_KIND_SERVER_STATE = 4;

export type ServerStateMessage = ServerBootstrapFrame | ServerStateDeltaFrame;

const withHeader = (kind: number, payload: Uint8Array) => {
  const buffer = new Uint8Array(payload.byteLength + 1);
  buffer[0] = kind;
  buffer.set(payload, 1);
  return buffer;
};

const toUint8Array = (buffer: ArrayBuffer | Uint8Array) =>
  buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);

export const encodeClientControlMessage = (message: ClientControlMessage) =>
  withHeader(WS_PACKET_KIND_CLIENT_CONTROL, encode(message));

export const decodeClientControlMessage = (
  packet: ArrayBuffer | Uint8Array
): ClientControlMessage => {
  const bytes = toUint8Array(packet);
  if (bytes[0] !== WS_PACKET_KIND_CLIENT_CONTROL) {
    throw new Error("Invalid client control packet kind.");
  }

  return decode(bytes.slice(1)) as ClientControlMessage;
};

export const encodeServerControlMessage = (message: ServerControlMessage) =>
  withHeader(WS_PACKET_KIND_SERVER_CONTROL, encode(message));

export const decodeServerControlMessage = (
  packet: ArrayBuffer | Uint8Array
): ServerControlMessage => {
  const bytes = toUint8Array(packet);
  if (bytes[0] !== WS_PACKET_KIND_SERVER_CONTROL) {
    throw new Error("Invalid server control packet kind.");
  }

  return decode(bytes.slice(1)) as ServerControlMessage;
};

export const encodeServerStateMessage = (message: ServerStateMessage) =>
  withHeader(WS_PACKET_KIND_SERVER_STATE, encode(message));

export const decodeServerStateMessage = (
  packet: ArrayBuffer | Uint8Array
): ServerStateMessage => {
  const bytes = toUint8Array(packet);
  if (bytes[0] !== WS_PACKET_KIND_SERVER_STATE) {
    throw new Error("Invalid server state packet kind.");
  }

  return decode(bytes.slice(1)) as ServerStateMessage;
};

export const encodeRuntimeInputPacket = (buffer: ArrayBuffer) => {
  const payload = new Uint8Array(buffer);
  return withHeader(WS_PACKET_KIND_RUNTIME_INPUT, payload);
};

export const decodeRuntimeInputPacket = (packet: ArrayBuffer | Uint8Array) => {
  const bytes = toUint8Array(packet);
  if (bytes[0] !== WS_PACKET_KIND_RUNTIME_INPUT) {
    throw new Error("Invalid runtime input packet kind.");
  }

  return bytes.slice(1).buffer;
};
