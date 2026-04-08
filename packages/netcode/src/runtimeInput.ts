import type { PlayerCommand } from "@out-of-bounds/sim";

export interface RuntimeInputCommand extends PlayerCommand {
  seq: number;
}

export const MAX_TYPED_TEXT_BYTES = 24;

const PACKED_INPUT_BYTES = 4 + 4 * 6 + 2 + 2 * 6 + 1 + MAX_TYPED_TEXT_BYTES;
const FLAG_JUMP = 1 << 0;
const FLAG_JUMP_PRESSED = 1 << 1;
const FLAG_JUMP_RELEASED = 1 << 2;
const FLAG_DESTROY = 1 << 3;
const FLAG_PLACE = 1 << 4;
const FLAG_PUSH = 1 << 5;
const FLAG_LAY_EGG = 1 << 6;
const FLAG_TARGET_VOXEL = 1 << 7;
const FLAG_TARGET_NORMAL = 1 << 8;

const packVec3i = (
  view: DataView,
  offset: number,
  value: { x: number; y: number; z: number } | null
) => {
  view.setInt16(offset, value?.x ?? 0, true);
  view.setInt16(offset + 2, value?.y ?? 0, true);
  view.setInt16(offset + 4, value?.z ?? 0, true);
};

const unpackVec3i = (view: DataView, offset: number) => ({
  x: view.getInt16(offset, true),
  y: view.getInt16(offset + 2, true),
  z: view.getInt16(offset + 4, true)
});

const normalizeTypedText = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z ]+/g, "")
    .slice(0, MAX_TYPED_TEXT_BYTES);

export const createEmptyRuntimeInputCommand = (seq = 0): RuntimeInputCommand => ({
  seq,
  moveX: 0,
  moveZ: 0,
  lookX: 1,
  lookZ: 0,
  eggCharge: 0,
  eggPitch: 0,
  typedText: "",
  jump: false,
  jumpPressed: false,
  jumpReleased: false,
  destroy: false,
  place: false,
  push: false,
  layEgg: false,
  targetVoxel: null,
  targetNormal: null
});

export const packRuntimeInputCommand = (command: RuntimeInputCommand) => {
  const buffer = new ArrayBuffer(PACKED_INPUT_BYTES);
  const view = new DataView(buffer);
  const typedText = normalizeTypedText(command.typedText);
  view.setUint32(0, command.seq, true);
  view.setFloat32(4, command.moveX, true);
  view.setFloat32(8, command.moveZ, true);
  view.setFloat32(12, command.lookX, true);
  view.setFloat32(16, command.lookZ, true);
  view.setFloat32(20, command.eggCharge, true);
  view.setFloat32(24, command.eggPitch, true);

  let flags = 0;
  if (command.jump) flags |= FLAG_JUMP;
  if (command.jumpPressed) flags |= FLAG_JUMP_PRESSED;
  if (command.jumpReleased) flags |= FLAG_JUMP_RELEASED;
  if (command.destroy) flags |= FLAG_DESTROY;
  if (command.place) flags |= FLAG_PLACE;
  if (command.push) flags |= FLAG_PUSH;
  if (command.layEgg) flags |= FLAG_LAY_EGG;
  if (command.targetVoxel) flags |= FLAG_TARGET_VOXEL;
  if (command.targetNormal) flags |= FLAG_TARGET_NORMAL;
  view.setUint16(28, flags, true);
  packVec3i(view, 30, command.targetVoxel);
  packVec3i(view, 36, command.targetNormal);
  view.setUint8(42, typedText.length);
  for (let index = 0; index < typedText.length; index += 1) {
    view.setUint8(43 + index, typedText.charCodeAt(index));
  }
  return buffer;
};

export const unpackRuntimeInputCommand = (buffer: ArrayBuffer): RuntimeInputCommand => {
  const view = new DataView(buffer);
  const flags = view.getUint16(28, true);
  const typedTextLength = Math.min(view.getUint8(42), MAX_TYPED_TEXT_BYTES);
  let typedText = "";
  for (let index = 0; index < typedTextLength; index += 1) {
    typedText += String.fromCharCode(view.getUint8(43 + index));
  }
  return {
    seq: view.getUint32(0, true),
    moveX: view.getFloat32(4, true),
    moveZ: view.getFloat32(8, true),
    lookX: view.getFloat32(12, true),
    lookZ: view.getFloat32(16, true),
    eggCharge: view.getFloat32(20, true),
    eggPitch: view.getFloat32(24, true),
    typedText,
    jump: (flags & FLAG_JUMP) !== 0,
    jumpPressed: (flags & FLAG_JUMP_PRESSED) !== 0,
    jumpReleased: (flags & FLAG_JUMP_RELEASED) !== 0,
    destroy: (flags & FLAG_DESTROY) !== 0,
    place: (flags & FLAG_PLACE) !== 0,
    push: (flags & FLAG_PUSH) !== 0,
    layEgg: (flags & FLAG_LAY_EGG) !== 0,
    targetVoxel: (flags & FLAG_TARGET_VOXEL) !== 0 ? unpackVec3i(view, 30) : null,
    targetNormal: (flags & FLAG_TARGET_NORMAL) !== 0 ? unpackVec3i(view, 36) : null
  };
};

export const mergeRuntimeInputCommand = (
  current: RuntimeInputCommand,
  incoming: RuntimeInputCommand
): RuntimeInputCommand => {
  if (incoming.seq < current.seq) {
    return { ...current };
  }

  const preserveTarget = (current.destroy || current.place) && !incoming.destroy && !incoming.place;
  const preserveEggThrow = current.layEgg && !incoming.layEgg;

  return {
    ...incoming,
    typedText: normalizeTypedText(`${current.typedText}${incoming.typedText}`),
    jumpPressed: current.jumpPressed || incoming.jumpPressed,
    jumpReleased: current.jumpReleased || incoming.jumpReleased,
    destroy: current.destroy || incoming.destroy,
    place: current.place || incoming.place,
    push: current.push || incoming.push,
    layEgg: current.layEgg || incoming.layEgg,
    eggCharge: preserveEggThrow ? current.eggCharge : incoming.eggCharge,
    eggPitch: preserveEggThrow ? current.eggPitch : incoming.eggPitch,
    targetVoxel: preserveTarget ? current.targetVoxel : incoming.targetVoxel,
    targetNormal: preserveTarget ? current.targetNormal : incoming.targetNormal
  };
};

export const clearTransientRuntimeInputFlags = (
  command: RuntimeInputCommand
): RuntimeInputCommand => ({
  ...command,
  jumpPressed: false,
  jumpReleased: false,
  destroy: false,
  place: false,
  push: false,
  layEgg: false,
  typedText: "",
  eggCharge: 0,
  eggPitch: 0
});
