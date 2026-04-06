export const chickenPreviewEggDelayRangeSeconds = {
  min: 2.5,
  max: 5,
} as const;

const clampUnitInterval = (value: number) => Math.min(1, Math.max(0, value));

export const getNextChickenPreviewEggDelay = (random: () => number = Math.random) => {
  const sample = clampUnitInterval(random());
  return (
    chickenPreviewEggDelayRangeSeconds.min +
    (chickenPreviewEggDelayRangeSeconds.max - chickenPreviewEggDelayRangeSeconds.min) * sample
  );
};
