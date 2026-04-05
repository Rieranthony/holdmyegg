import { useEffect, useRef } from "react";
import type { PlayerCommand, Vector2 } from "@out-of-bounds/sim";

export interface KeyboardInputState {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  jump: boolean;
  jumpPressed: boolean;
  jumpReleased: boolean;
  build: boolean;
  push: boolean;
  egg: boolean;
}

const initialState: KeyboardInputState = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  jump: false,
  jumpPressed: false,
  jumpReleased: false,
  build: false,
  push: false,
  egg: false
};

const isFormElement = (target: EventTarget | null) =>
  target instanceof HTMLInputElement ||
  target instanceof HTMLTextAreaElement ||
  target instanceof HTMLSelectElement;

export const useKeyboardInput = () => {
  const inputRef = useRef<KeyboardInputState>({ ...initialState });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isFormElement(event.target)) {
        return;
      }

      switch (event.code) {
        case "KeyW":
        case "ArrowUp":
          inputRef.current.forward = true;
          break;
        case "KeyS":
        case "ArrowDown":
          inputRef.current.backward = true;
          break;
        case "KeyA":
        case "ArrowLeft":
          inputRef.current.left = true;
          break;
        case "KeyD":
        case "ArrowRight":
          inputRef.current.right = true;
          break;
        case "Space":
          event.preventDefault();
          if (!inputRef.current.jump) {
            inputRef.current.jumpPressed = true;
          }
          inputRef.current.jump = true;
          break;
        case "KeyE":
          inputRef.current.build = true;
          break;
        case "KeyF":
          inputRef.current.push = true;
          break;
        case "KeyQ":
          inputRef.current.egg = true;
          break;
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      switch (event.code) {
        case "KeyW":
        case "ArrowUp":
          inputRef.current.forward = false;
          break;
        case "KeyS":
        case "ArrowDown":
          inputRef.current.backward = false;
          break;
        case "KeyA":
        case "ArrowLeft":
          inputRef.current.left = false;
          break;
        case "KeyD":
        case "ArrowRight":
          inputRef.current.right = false;
          break;
        case "Space":
          if (inputRef.current.jump) {
            inputRef.current.jumpReleased = true;
          }
          inputRef.current.jump = false;
          break;
        case "KeyE":
          inputRef.current.build = false;
          break;
        case "KeyF":
          inputRef.current.push = false;
          break;
        case "KeyQ":
          inputRef.current.egg = false;
          break;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  return inputRef;
};

const normalize = (x: number, z: number): Vector2 => {
  const length = Math.hypot(x, z);
  if (length === 0) {
    return { x: 0, z: 0 };
  }

  return {
    x: x / length,
    z: z / length
  };
};

export const buildPlayerCommand = (
  input: KeyboardInputState,
  basisForward: Vector2
): PlayerCommand => {
  const vertical = (input.forward ? 1 : 0) - (input.backward ? 1 : 0);
  const horizontal = (input.right ? 1 : 0) - (input.left ? 1 : 0);

  const forward = normalize(basisForward.x, basisForward.z);
  const right = normalize(-forward.z, forward.x);

  const move = normalize(
    forward.x * vertical + right.x * horizontal,
    forward.z * vertical + right.z * horizontal
  );

  return {
    moveX: move.x,
    moveZ: move.z,
    lookX: forward.x,
    lookZ: forward.z,
    jump: input.jump,
    jumpPressed: input.jumpPressed,
    jumpReleased: input.jumpReleased,
    destroy: false,
    place: input.build,
    push: input.push,
    layEgg: false,
    targetVoxel: null,
    targetNormal: null
  };
};
