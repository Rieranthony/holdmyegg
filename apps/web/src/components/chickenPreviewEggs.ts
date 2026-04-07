import { eggTauntDurationSeconds, getEggTauntMessage } from "../game/eggTaunts";

export const chickenPreviewEggDelayRangeSeconds = {
  min: 2.5,
  max: 5,
} as const;

export const chickenPreviewEggTauntSeed = "menu-preview";

const clampUnitInterval = (value: number) => Math.min(1, Math.max(0, value));

export const getNextChickenPreviewEggDelay = (random: () => number = Math.random) => {
  const sample = clampUnitInterval(random());
  return (
    chickenPreviewEggDelayRangeSeconds.min +
    (chickenPreviewEggDelayRangeSeconds.max - chickenPreviewEggDelayRangeSeconds.min) * sample
  );
};

export const getNextChickenPreviewEggTaunt = (
  currentSequence: number,
  decorativeEggsEnabled: boolean
) => {
  if (!decorativeEggsEnabled) {
    return null;
  }

  const sequence = Math.max(0, Math.floor(currentSequence)) + 1;
  const message = getEggTauntMessage(chickenPreviewEggTauntSeed, sequence);
  if (!message) {
    return null;
  }

  return {
    sequence,
    remaining: eggTauntDurationSeconds,
    message
  };
};
