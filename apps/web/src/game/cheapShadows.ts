import type { SkyDropPhase } from "@out-of-bounds/sim";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export interface BlobShadowState {
  yOffset: number;
  scale: number;
  opacity: number;
}

export const getPlayerBlobShadowState = ({
  playerY,
  surfaceY,
  isLocal,
  stunned
}: {
  playerY: number;
  surfaceY: number;
  isLocal: boolean;
  stunned: boolean;
}): BlobShadowState => {
  const heightAboveSurface = Math.max(0, playerY - surfaceY);
  const maxOpacity = isLocal ? 0.34 : 0.28;
  const opacity = clamp(maxOpacity - heightAboveSurface * 0.12, 0.08, maxOpacity) * (stunned ? 0.78 : 1);
  const scale = clamp(0.54 + heightAboveSurface * 0.08, 0.54, 0.82);

  return {
    yOffset: surfaceY - playerY + 0.03,
    scale,
    opacity
  };
};

export interface LandingShadowState {
  scale: number;
  opacity: number;
}

export const getSkyDropLandingShadowState = ({
  phase,
  warningOpacity,
  warningScale
}: {
  phase: SkyDropPhase;
  warningOpacity: number;
  warningScale: number;
}): LandingShadowState => {
  if (phase === "falling") {
    return {
      scale: 1.08,
      opacity: 0.28
    };
  }

  return {
    scale: Math.max(0.82, warningScale * 0.86),
    opacity: clamp(warningOpacity * 0.32, 0.06, 0.18)
  };
};
