import type { SkyDropViewState } from "@out-of-bounds/sim";

export interface SkyDropVisualState {
  warningVisible: boolean;
  warningScale: number;
  warningOpacity: number;
  warningEmissive: number;
}

const hashString = (value: string) => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33 + value.charCodeAt(index)) >>> 0;
  }

  return hash;
};

export const getSkyDropVisualState = (skyDrop: SkyDropViewState, elapsedTime: number): SkyDropVisualState => {
  if (skyDrop.phase !== "warning") {
    return {
      warningVisible: false,
      warningScale: 1,
      warningOpacity: 0,
      warningEmissive: 0
    };
  }

  const seed = hashString(skyDrop.id) * 0.0001;
  const pulse = 0.5 + 0.5 * Math.sin(elapsedTime * 10 + seed);

  return {
    warningVisible: true,
    warningScale: 0.92 + 0.18 * pulse,
    warningOpacity: 0.3 + 0.4 * pulse,
    warningEmissive: 0.15 + 0.45 * pulse
  };
};
