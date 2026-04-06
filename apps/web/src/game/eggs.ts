import type { EggScatterDebrisViewState, EggViewState, Vector3 } from "@out-of-bounds/sim";

export const eggVisualDefaults = {
  radius: 0.28,
  widthSegments: 14,
  heightSegments: 12,
  baseScaleX: 0.82,
  baseScaleY: 1.08,
  baseScaleZ: 0.82,
  jiggleAmplitudeMin: 0.012,
  jiggleAmplitudeMax: 0.085,
  jiggleSpeedMin: 10,
  jiggleSpeedMax: 28,
  emissiveMin: 0.08,
  emissiveMax: 0.95,
  coolColor: "#fff0d9",
  hotColor: "#ff4f3d"
} as const;

const hashString = (value: string) => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33 + value.charCodeAt(index)) >>> 0;
  }

  return hash;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const lerp = (start: number, end: number, alpha: number) => start + (end - start) * alpha;

export interface EggVisualState {
  jiggleY: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  rotationX: number;
  rotationY: number;
  rotationZ: number;
  heatAlpha: number;
  emissiveIntensity: number;
}

export const getEggVisualState = (
  egg: EggViewState,
  elapsedTime: number,
  fuseDuration: number
): EggVisualState => {
  const safeFuseDuration = Math.max(0.001, fuseDuration);
  const fuseProgress = clamp(1 - egg.fuseRemaining / safeFuseDuration, 0, 1);
  const seed = hashString(egg.id) * 0.0001;
  const planarSpeed = Math.hypot(egg.velocity.x, egg.velocity.z);
  const totalSpeed = Math.hypot(planarSpeed, egg.velocity.y);
  const jiggleSpeed = lerp(eggVisualDefaults.jiggleSpeedMin, eggVisualDefaults.jiggleSpeedMax, fuseProgress);
  const jiggleAmplitude = lerp(eggVisualDefaults.jiggleAmplitudeMin, eggVisualDefaults.jiggleAmplitudeMax, fuseProgress);
  const jigglePhase = elapsedTime * jiggleSpeed + seed;
  const jiggleY = Math.sin(jigglePhase) * jiggleAmplitude;
  const travelYaw = planarSpeed > 0.001 ? Math.atan2(egg.velocity.x, egg.velocity.z) : seed * Math.PI * 2;
  const rollAngle = elapsedTime * (2.2 + planarSpeed * 5.4) + seed * Math.PI * 4;
  const groundRollAlpha = clamp(planarSpeed / 6.4, 0, 1) * clamp(1 - Math.abs(egg.velocity.y) / 2.2, 0, 1);
  const airTiltAlpha = clamp(Math.abs(egg.velocity.y) / 8.5, 0, 1);
  const wobble = Math.sin(elapsedTime * 7.8 + seed * 12) * Math.min(0.16, totalSpeed * 0.02);
  const stretchAlpha = clamp(totalSpeed / 13, 0, 1);

  return {
    jiggleY,
    scaleX: eggVisualDefaults.baseScaleX + fuseProgress * 0.08 + stretchAlpha * 0.04 + groundRollAlpha * 0.08,
    scaleY:
      eggVisualDefaults.baseScaleY -
      Math.abs(Math.sin(jigglePhase)) * 0.12 -
      groundRollAlpha * 0.08 -
      stretchAlpha * 0.03,
    scaleZ: eggVisualDefaults.baseScaleZ + fuseProgress * 0.08 + stretchAlpha * 0.04 + groundRollAlpha * 0.08,
    rotationX: Math.cos(travelYaw) * rollAngle + airTiltAlpha * 0.16,
    rotationY: travelYaw + wobble,
    rotationZ: -Math.sin(travelYaw) * rollAngle + wobble * 0.4,
    heatAlpha: fuseProgress,
    emissiveIntensity: lerp(eggVisualDefaults.emissiveMin, eggVisualDefaults.emissiveMax, fuseProgress)
  };
};

export const getEggScatterDebrisPosition = (
  debris: EggScatterDebrisViewState,
  arcHeight: number
): Vector3 => {
  const progress = debris.duration <= 0 ? 1 : clamp(debris.elapsed / debris.duration, 0, 1);
  return {
    x: lerp(debris.origin.x, debris.destination.x, progress),
    y: lerp(debris.origin.y, debris.destination.y, progress) + Math.sin(progress * Math.PI) * arcHeight,
    z: lerp(debris.origin.z, debris.destination.z, progress)
  };
};
