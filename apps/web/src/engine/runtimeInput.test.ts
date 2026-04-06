import { describe, expect, it } from "vitest";
import {
  clearTransientRuntimeInputFlags,
  packRuntimeInputCommand,
  unpackRuntimeInputCommand,
  type RuntimeInputCommand
} from "./runtimeInput";

describe("packRuntimeInputCommand", () => {
  it("round-trips every packed runtime field including voxel targets", () => {
    const command: RuntimeInputCommand = {
      seq: 42,
      moveX: 0.5,
      moveZ: -0.25,
      lookX: 0.75,
      lookZ: -1,
      jump: true,
      jumpPressed: true,
      jumpReleased: true,
      destroy: true,
      place: true,
      push: true,
      layEgg: true,
      targetVoxel: { x: 12, y: -4, z: 28 },
      targetNormal: { x: 0, y: 1, z: -1 }
    };

    const buffer = packRuntimeInputCommand(command);
    const unpacked = unpackRuntimeInputCommand(buffer);

    expect(buffer.byteLength).toBe(34);
    expect(unpacked).toEqual(command);
  });

  it("keeps optional target vectors null when their flags are not set", () => {
    const command: RuntimeInputCommand = {
      seq: 3,
      moveX: 0,
      moveZ: 0,
      lookX: 1,
      lookZ: 0,
      jump: false,
      jumpPressed: false,
      jumpReleased: false,
      destroy: false,
      place: false,
      push: false,
      layEgg: false,
      targetVoxel: null,
      targetNormal: null
    };

    const unpacked = unpackRuntimeInputCommand(packRuntimeInputCommand(command));

    expect(unpacked.targetVoxel).toBeNull();
    expect(unpacked.targetNormal).toBeNull();
    expect(unpacked.destroy).toBe(false);
    expect(unpacked.place).toBe(false);
    expect(unpacked.layEgg).toBe(false);
  });
});

describe("clearTransientRuntimeInputFlags", () => {
  it("resets one-shot flags without mutating the original command", () => {
    const command: RuntimeInputCommand = {
      seq: 9,
      moveX: 1,
      moveZ: 0,
      lookX: 0,
      lookZ: 1,
      jump: true,
      jumpPressed: true,
      jumpReleased: true,
      destroy: true,
      place: true,
      push: true,
      layEgg: true,
      targetVoxel: { x: 1, y: 2, z: 3 },
      targetNormal: { x: -1, y: 0, z: 0 }
    };

    const cleared = clearTransientRuntimeInputFlags(command);

    expect(cleared).toEqual({
      ...command,
      jumpPressed: false,
      jumpReleased: false,
      destroy: false,
      place: false,
      layEgg: false
    });
    expect(cleared).not.toBe(command);
    expect(command.jumpPressed).toBe(true);
    expect(command.place).toBe(true);
    expect(command.layEgg).toBe(true);
    expect(cleared.jump).toBe(true);
    expect(cleared.push).toBe(true);
  });
});
