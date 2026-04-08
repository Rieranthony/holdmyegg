import { describe, expect, it } from "vitest";
import {
  PACKED_RUNTIME_INPUT_BYTES,
  MAX_TYPED_TEXT_BYTES,
  clearTransientRuntimeInputFlags,
  mergeRuntimeInputCommand,
  packRuntimeInputCommand,
  unpackRuntimeInputCommand,
  type RuntimeInputCommand
} from "./runtimeInput";

describe("packRuntimeInputCommand", () => {
  it("round-trips every packed runtime field including voxel targets and typing", () => {
    const command: RuntimeInputCommand = {
      seq: 42,
      moveX: 0.5,
      moveZ: -0.25,
      lookX: 0.75,
      lookZ: -1,
      eggCharge: 0.65,
      eggPitch: -0.22,
      typedText: "Kiss My Toes!!!",
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

    expect(unpacked).toMatchObject({
      ...command,
      typedText: "kiss my toes",
      eggCharge: expect.any(Number),
      eggPitch: expect.any(Number)
    });
    expect(unpacked.eggCharge).toBeCloseTo(command.eggCharge, 5);
    expect(unpacked.eggPitch).toBeCloseTo(command.eggPitch, 5);
  });

  it("truncates typed text to the supported payload limit", () => {
    const unpacked = unpackRuntimeInputCommand(
      packRuntimeInputCommand({
        seq: 1,
        moveX: 0,
        moveZ: 0,
        lookX: 1,
        lookZ: 0,
        eggCharge: 0,
        eggPitch: 0,
        typedText: "ABCDEFGHIJKLMNOPQRSTUVWXYZ!!!",
        jump: false,
        jumpPressed: false,
        jumpReleased: false,
        destroy: false,
        place: false,
        push: false,
        layEgg: false,
        targetVoxel: null,
        targetNormal: null
      })
    );

    expect(unpacked.typedText).toBe("abcdefghijklmnopqrstuvwx".slice(0, MAX_TYPED_TEXT_BYTES));
    expect(unpacked.typedText).toHaveLength(MAX_TYPED_TEXT_BYTES);
  });

  it("rejects buffers shorter than the packed runtime payload size", () => {
    expect(() =>
      unpackRuntimeInputCommand(new ArrayBuffer(PACKED_RUNTIME_INPUT_BYTES - 1))
    ).toThrow("Runtime input payload is shorter than expected.");
  });
});

describe("mergeRuntimeInputCommand", () => {
  it("preserves queued one-shot actions when a newer packet arrives before the tick consumes them", () => {
    const merged = mergeRuntimeInputCommand(
      {
        seq: 7,
        moveX: 0.5,
        moveZ: 0,
        lookX: 1,
        lookZ: 0,
        eggCharge: 0.65,
        eggPitch: -0.3,
        typedText: "go",
        jump: true,
        jumpPressed: true,
        jumpReleased: false,
        destroy: true,
        place: false,
        push: true,
        layEgg: true,
        targetVoxel: { x: 8, y: 3, z: 6 },
        targetNormal: { x: 0, y: 1, z: 0 }
      },
      {
        seq: 8,
        moveX: -0.25,
        moveZ: 1,
        lookX: 0,
        lookZ: 1,
        eggCharge: 0,
        eggPitch: 0,
        typedText: " x",
        jump: false,
        jumpPressed: false,
        jumpReleased: true,
        destroy: false,
        place: false,
        push: false,
        layEgg: false,
        targetVoxel: { x: 12, y: 4, z: 9 },
        targetNormal: { x: 1, y: 0, z: 0 }
      }
    );

    expect(merged).toMatchObject({
      seq: 8,
      moveX: -0.25,
      moveZ: 1,
      lookX: 0,
      lookZ: 1,
      typedText: "go x",
      jump: false,
      jumpPressed: true,
      jumpReleased: true,
      destroy: true,
      push: true,
      layEgg: true,
      eggCharge: 0.65,
      eggPitch: -0.3,
      targetVoxel: { x: 8, y: 3, z: 6 },
      targetNormal: { x: 0, y: 1, z: 0 }
    });
  });

  it("ignores stale packets that arrive out of order", () => {
    const current: RuntimeInputCommand = {
      seq: 12,
      moveX: 1,
      moveZ: 0,
      lookX: 0,
      lookZ: 1,
      eggCharge: 0,
      eggPitch: 0,
      typedText: "",
      jump: true,
      jumpPressed: false,
      jumpReleased: false,
      destroy: false,
      place: false,
      push: false,
      layEgg: false,
      targetVoxel: null,
      targetNormal: null
    };

    expect(
      mergeRuntimeInputCommand(current, {
        ...current,
        seq: 11,
        moveX: -1,
        typedText: "go",
        jumpPressed: true
      })
    ).toEqual(current);
  });
});

describe("clearTransientRuntimeInputFlags", () => {
  it("resets one-shot fields without mutating the original command", () => {
    const command: RuntimeInputCommand = {
      seq: 9,
      moveX: 1,
      moveZ: 0,
      lookX: 0,
      lookZ: 1,
      eggCharge: 0.9,
      eggPitch: 0.14,
      typedText: "go go go",
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
      push: false,
      layEgg: false,
      typedText: "",
      eggCharge: 0,
      eggPitch: 0
    });
    expect(cleared).not.toBe(command);
    expect(command.jumpPressed).toBe(true);
  });
});
