import type { PlayerCommand } from "@out-of-bounds/sim";

const createCommand = (partial: Partial<PlayerCommand> = {}): PlayerCommand => ({
  moveX: 0,
  moveZ: 0,
  lookX: 0,
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
  targetNormal: null,
  ...partial
});

export const idle = (overrides: Partial<PlayerCommand> = {}) => createCommand(overrides);

export const move = (moveX: number, moveZ: number, overrides: Partial<PlayerCommand> = {}) =>
  createCommand({
    moveX,
    moveZ,
    ...overrides
  });

export const jump = (overrides: Partial<PlayerCommand> = {}) =>
  createCommand({
    jump: true,
    jumpPressed: true,
    ...overrides
  });

export const destroy = (overrides: Partial<PlayerCommand> = {}) =>
  createCommand({
    destroy: true,
    ...overrides
  });

export const place = (
  targetVoxel: NonNullable<PlayerCommand["targetVoxel"]>,
  targetNormal: NonNullable<PlayerCommand["targetNormal"]>,
  overrides: Partial<PlayerCommand> = {}
) =>
  createCommand({
    place: true,
    targetVoxel,
    targetNormal,
    ...overrides
  });

export const push = (overrides: Partial<PlayerCommand> = {}) =>
  createCommand({
    push: true,
    ...overrides
  });

export const layEgg = (overrides: Partial<PlayerCommand> = {}) =>
  createCommand({
    layEgg: true,
    ...overrides
  });
