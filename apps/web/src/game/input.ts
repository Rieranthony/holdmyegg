import type { PlayerCommand, Vector2 } from "@out-of-bounds/sim";

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

export const initialKeyboardInputState: KeyboardInputState = {
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
