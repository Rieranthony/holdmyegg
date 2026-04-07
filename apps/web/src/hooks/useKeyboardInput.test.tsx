import { fireEvent, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { buildPlayerCommand, useKeyboardInput } from "./useKeyboardInput";

describe("buildPlayerCommand", () => {
  it("maps movement forward relative to the camera basis", () => {
    const command = buildPlayerCommand(
      {
        forward: true,
        backward: false,
        left: false,
        right: false,
        jump: true,
        jumpPressed: true,
        jumpReleased: false,
        egg: false,
        placePressed: false,
        pushPressed: false
      },
      { x: 1, z: 0 }
    );

    expect(command.moveX).toBeCloseTo(1, 4);
    expect(command.moveZ).toBeCloseTo(0, 4);
    expect(command.lookX).toBeCloseTo(1, 4);
    expect(command.lookZ).toBeCloseTo(0, 4);
    expect(command.jump).toBe(true);
    expect(command.jumpPressed).toBe(true);
    expect(command.jumpReleased).toBe(false);
  });

  it("maps sideways movement using the perpendicular of the camera basis", () => {
    const command = buildPlayerCommand(
      {
        forward: true,
        backward: false,
        left: false,
        right: true,
        jump: false,
        jumpPressed: false,
        jumpReleased: false,
        egg: false,
        placePressed: true,
        pushPressed: true
      },
      { x: 1, z: 0 }
    );

    expect(command.moveX).toBeCloseTo(Math.SQRT1_2, 4);
    expect(command.moveZ).toBeCloseTo(Math.SQRT1_2, 4);
    expect(command.lookX).toBeCloseTo(1, 4);
    expect(command.lookZ).toBeCloseTo(0, 4);
    expect(command.push).toBe(true);
    expect(command.destroy).toBe(false);
    expect(command.place).toBe(true);
    expect(command.layEgg).toBe(false);
  });

  it("keeps repeated forward commands stable when the camera basis stays stable", () => {
    const commands = Array.from({ length: 8 }, () =>
      buildPlayerCommand(
        {
          forward: true,
          backward: false,
          left: false,
          right: false,
          jump: false,
          jumpPressed: false,
          jumpReleased: false,
          egg: false,
          placePressed: false,
          pushPressed: false
        },
        { x: Math.SQRT1_2, z: Math.SQRT1_2 }
      )
    );

    for (const command of commands) {
      expect(command.moveX).toBeCloseTo(Math.SQRT1_2, 4);
      expect(command.moveZ).toBeCloseTo(Math.SQRT1_2, 4);
    }
  });
});

describe("useKeyboardInput", () => {
  it("tracks keyboard state on window and ignores focused form fields", () => {
    const { result } = renderHook(() => useKeyboardInput());
    const input = document.createElement("input");
    document.body.appendChild(input);

    fireEvent.keyDown(input, {
      code: "KeyW"
    });
    expect(result.current.current.forward).toBe(false);

    fireEvent.keyDown(window, {
      code: "KeyW"
    });
    fireEvent.keyDown(window, {
      code: "KeyF"
    });
    fireEvent.keyUp(window, {
      code: "KeyW"
    });
    fireEvent.keyDown(window, {
      code: "KeyW"
    });
    fireEvent.keyDown(window, {
      code: "KeyW",
      repeat: true
    });
    fireEvent.keyDown(window, {
      code: "KeyE"
    });
    fireEvent.keyDown(window, {
      code: "Space"
    });
    expect(result.current.current.forward).toBe(true);
    expect(result.current.current.placePressed).toBe(true);
    expect(result.current.current.pushPressed).toBe(true);
    expect(result.current.current.egg).toBe(true);
    expect(result.current.current.jump).toBe(true);
    expect(result.current.current.jumpPressed).toBe(true);
    expect(result.current.current.jumpReleased).toBe(false);

    result.current.current.placePressed = false;
    result.current.current.pushPressed = false;

    fireEvent.keyUp(window, {
      code: "KeyW"
    });
    fireEvent.keyUp(window, {
      code: "KeyE"
    });
    fireEvent.keyUp(window, {
      code: "Space"
    });
    expect(result.current.current.forward).toBe(false);
    expect(result.current.current.placePressed).toBe(false);
    expect(result.current.current.pushPressed).toBe(false);
    expect(result.current.current.egg).toBe(false);
    expect(result.current.current.jump).toBe(false);
    expect(result.current.current.jumpReleased).toBe(true);

    input.remove();
  });
});
