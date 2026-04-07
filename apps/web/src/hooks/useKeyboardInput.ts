import { useEffect, useRef } from "react";
import type { PlayerCommand, Vector2 } from "@out-of-bounds/sim";
import { isEggLaunchKeyCode } from "../game/eggLaunchControls";

export interface KeyboardInputState {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  jump: boolean;
  jumpPressed: boolean;
  jumpReleased: boolean;
  egg: boolean;
  placePressed: boolean;
  pushPressed: boolean;
}

const initialState: KeyboardInputState = {
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
};

const DOUBLE_TAP_WINDOW_MS = 220;

const isFormElement = (target: EventTarget | null) =>
  target instanceof HTMLInputElement ||
  target instanceof HTMLTextAreaElement ||
  target instanceof HTMLSelectElement;

export const useKeyboardInput = () => {
  const inputRef = useRef<KeyboardInputState>({ ...initialState });
  const lastForwardTapAtRef = useRef<number>(Number.NEGATIVE_INFINITY);
  const forwardTapReleasedRef = useRef(true);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isFormElement(event.target)) {
        return;
      }

      if (isEggLaunchKeyCode(event.code)) {
        event.preventDefault();
        inputRef.current.egg = true;
        return;
      }

      switch (event.code) {
        case "KeyW": {
          if (event.repeat) {
            inputRef.current.forward = true;
            break;
          }
          const currentTimeMs = performance.now();
          if (
            forwardTapReleasedRef.current &&
            currentTimeMs - lastForwardTapAtRef.current <= DOUBLE_TAP_WINDOW_MS
          ) {
            inputRef.current.pushPressed = true;
          }
          lastForwardTapAtRef.current = currentTimeMs;
          forwardTapReleasedRef.current = false;
          inputRef.current.forward = true;
          break;
        }
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
        case "KeyF":
          if (!event.repeat) {
            inputRef.current.placePressed = true;
          }
          break;
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (isEggLaunchKeyCode(event.code)) {
        event.preventDefault();
        inputRef.current.egg = false;
        return;
      }

      switch (event.code) {
        case "KeyW":
          inputRef.current.forward = false;
          forwardTapReleasedRef.current = true;
          break;
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
    eggCharge: 0,
    eggPitch: 0,
    jump: input.jump,
    jumpPressed: input.jumpPressed,
    jumpReleased: input.jumpReleased,
    destroy: false,
    place: input.placePressed,
    push: input.pushPressed,
    layEgg: false,
    targetVoxel: null,
    targetNormal: null
  };
};
