import type { FallingClusterViewState } from "@out-of-bounds/sim";

const hashString = (value: string) => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash;
};

export const getFallingClusterVisualState = (cluster: FallingClusterViewState, elapsedTime: number) => {
  if (cluster.phase !== "warning") {
    return {
      emissiveIntensity: 0,
      shakeX: 0,
      shakeZ: 0
    };
  }

  const seed = hashString(cluster.id) * 0.0001;
  const pulse = 0.5 + 0.5 * Math.sin(elapsedTime * 18 + seed);
  const amplitude = 0.03 + 0.025 * pulse;

  return {
    emissiveIntensity: 0.2 + 0.45 * pulse,
    shakeX: Math.sin(elapsedTime * 27 + seed * 2) * amplitude,
    shakeZ: Math.cos(elapsedTime * 23 + seed * 3) * amplitude
  };
};
