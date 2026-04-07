import { describe, expect, it } from "vitest";
import { buildPlayerCommand, initialKeyboardInputState } from "./input";

describe("initialKeyboardInputState", () => {
  it("starts with every action released", () => {
    expect(initialKeyboardInputState).toEqual({
      forward: false,
      backward: false,
      left: false,
      right: false,
      jump: false,
      jumpPressed: false,
      jumpReleased: false,
      egg: false,
      placePressed: false,
      pushPressed: false
    });
  });
});

describe("buildPlayerCommand", () => {
  it("moves relative to the current camera basis", () => {
    const command = buildPlayerCommand(
      {
        ...initialKeyboardInputState,
        forward: true,
        right: true,
        jump: true,
        jumpPressed: true,
        pushPressed: true
      },
      { x: 1, z: 0 }
    );

    expect(command.moveX).toBeCloseTo(Math.SQRT1_2, 5);
    expect(command.moveZ).toBeCloseTo(Math.SQRT1_2, 5);
    expect(command.lookX).toBeCloseTo(1, 5);
    expect(command.lookZ).toBeCloseTo(0, 5);
    expect(command.jump).toBe(true);
    expect(command.jumpPressed).toBe(true);
    expect(command.push).toBe(true);
  });

  it("normalizes both movement and look vectors and keeps placement actions edge-triggered", () => {
    const command = buildPlayerCommand(
      {
        ...initialKeyboardInputState,
        forward: true,
        placePressed: true,
        egg: true
      },
      { x: 3, z: 4 }
    );

    expect(command.moveX).toBeCloseTo(0.6, 5);
    expect(command.moveZ).toBeCloseTo(0.8, 5);
    expect(command.lookX).toBeCloseTo(0.6, 5);
    expect(command.lookZ).toBeCloseTo(0.8, 5);
    expect(command.place).toBe(true);
    expect(command.layEgg).toBe(false);
    expect(command.targetVoxel).toBeNull();
    expect(command.targetNormal).toBeNull();
  });

  it("falls back to a neutral command when the camera basis has no planar length", () => {
    const command = buildPlayerCommand(
      {
        ...initialKeyboardInputState,
        left: true,
        jumpReleased: true
      },
      { x: 0, z: 0 }
    );

    expect(command.moveX).toBe(0);
    expect(command.moveZ).toBe(0);
    expect(command.lookX).toBe(0);
    expect(command.lookZ).toBe(0);
    expect(command.jumpReleased).toBe(true);
  });
});
