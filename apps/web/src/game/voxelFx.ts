import {
  getMapPropVoxels,
  type MapProp,
  type MapPropKind,
  type MapPropVoxel,
  type MapPropVoxelKind
} from "@out-of-bounds/map";
import type {
  RuntimeEggScatterDebrisState,
  RuntimeVoxelBurstState,
  Vector3
} from "@out-of-bounds/sim";
import { getEggScatterDebrisPosition } from "./eggs";
import { getBlockRenderProfile, type BlockRenderProfile } from "./voxelMaterials";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const lerp = (start: number, end: number, alpha: number) => start + (end - start) * alpha;

const hashString = (value: string) => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33 + value.charCodeAt(index)) >>> 0;
  }

  return hash;
};

const getNoise = (seed: number, salt: number) => {
  const value = Math.sin(seed * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
};

const getProgress = (elapsed: number, duration: number) =>
  duration <= 0 ? 1 : clamp(elapsed / duration, 0, 1);

const sortDeterministically = <T>(items: readonly T[], getSeed: (item: T) => string) =>
  [...items].sort((left, right) => hashString(getSeed(left)) - hashString(getSeed(right)));

export interface EggScatterDebrisVisualState {
  position: Vector3;
  rotationX: number;
  rotationY: number;
  rotationZ: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
}

export interface VoxelBurstParticleState {
  position: Vector3;
  rotationX: number;
  rotationY: number;
  rotationZ: number;
  scale: number;
  opacity: number;
  bucket: VoxelBurstParticleBucket;
}

export interface VoxelBurstShockwaveState {
  position: Vector3;
  scale: number;
  opacity: number;
}

export type VoxelBurstParticleBucket = "terrain" | "accent";
export type PropShatterMaterialKey = "bark" | "leavesOak" | "leavesPine" | "leavesAutumn";

export type PropRemainsPhase = "collapse" | "settled" | "fade";
export type BurningTreeVoxelPhase = "untouched" | "igniting" | "burning" | "charred";

export interface PropRemainsFragment {
  materialKey: PropShatterMaterialKey;
  origin: Vector3;
  target: Vector3;
  voxelKind: MapPropVoxelKind;
}

export interface BurningTreeVoxelState {
  voxelKind: MapPropVoxelKind;
  position: Vector3;
  ignitionTime: number;
  burnoutTime: number;
}

export interface BurningTreeFxState {
  id: string;
  propId: string;
  kind: MapPropKind;
  duration: number;
  center: Vector3;
  ignitionOrigin: Vector3;
  voxels: BurningTreeVoxelState[];
}

export interface BurningTreeVoxelVisualState {
  phase: BurningTreeVoxelPhase;
  charAlpha: number;
  flameAlpha: number;
  emberAlpha: number;
  smokeAlpha: number;
  activeScore: number;
}

export interface PropRemainsState {
  id: string;
  propId: string;
  kind: MapPropKind;
  center: Vector3;
  elapsed: number;
  burning: boolean;
  collapseDuration: number;
  settledDuration: number;
  fadeDuration: number;
  fragments: PropRemainsFragment[];
}

export interface PropRemainsFragmentState {
  position: Vector3;
  rotationX: number;
  rotationY: number;
  rotationZ: number;
  scale: number;
  opacity: number;
  phase: PropRemainsPhase;
  burningAlpha: number;
  materialKey: PropShatterMaterialKey;
}

export const DEFAULT_PROP_REMAINS_COLLAPSE_DURATION = 0.45;
export const DEFAULT_PROP_REMAINS_SETTLED_DURATION = 15;
export const DEFAULT_PROP_REMAINS_FADE_DURATION = 2.5;
export const SETTLED_PROP_REMAINS_SCALE = 0.33;
export const DEFAULT_BURNING_TREE_DURATION = 15;

const BURNING_TREE_SPREAD_DURATION_RATIO = 0.52;
const BURNING_TREE_IGNITION_POCKET_COUNT = 4;
const BURNING_TREE_IGNITION_POCKET_MIN_DISTANCE = 1.75;

const areNeighboringTreeVoxels = (left: Vector3, right: Vector3) => {
  const deltaX = Math.abs(left.x - right.x);
  const deltaY = Math.abs(left.y - right.y);
  const deltaZ = Math.abs(left.z - right.z);
  return (deltaX > 0 || deltaY > 0 || deltaZ > 0) && deltaX <= 1 && deltaY <= 1 && deltaZ <= 1;
};

const getVoxelCenter = (voxel: MapPropVoxel): Vector3 => ({
  x: voxel.x + 0.5,
  y: voxel.y + 0.5,
  z: voxel.z + 0.5
});

const getPropVoxelCenter = (voxels: readonly MapPropVoxel[]) =>
  voxels.reduce<Vector3>(
    (accumulator, voxel) => ({
      x: accumulator.x + voxel.x + 0.5,
      y: accumulator.y + voxel.y + 0.5,
      z: accumulator.z + voxel.z + 0.5
    }),
    { x: 0, y: 0, z: 0 }
  );

const getFallbackIgnitionOrigin = (
  prop: Pick<MapProp, "id" | "x" | "y" | "z">,
  center: Vector3
): Vector3 => {
  const seed = hashString(`${prop.id}:${prop.x}:${prop.y}:${prop.z}`) * 0.0001;
  const angle = getNoise(seed, 201) * Math.PI * 2;
  const radius = 5.5;
  return {
    x: center.x + Math.cos(angle) * radius,
    y: center.y + 1.4 + getNoise(seed, 202) * 1.2,
    z: center.z + Math.sin(angle) * radius
  };
};

const selectBurningTreeIgnitionPocketIndices = (
  voxels: readonly MapPropVoxel[],
  centers: readonly Vector3[],
  ignitionOrigin: Vector3
) => {
  const preferredIndices = voxels
    .map((voxel, index) => {
      const center = centers[index]!;
      const distance = Math.hypot(
        center.x - ignitionOrigin.x,
        center.y - ignitionOrigin.y,
        center.z - ignitionOrigin.z
      );
      const woodBias = voxel.kind === "wood" ? -0.65 : 0.18;
      const heightBias = voxel.kind === "wood" ? Math.abs(center.y - ignitionOrigin.y) * 0.04 : 0;
      return {
        distance: distance + woodBias + heightBias,
        index
      };
    })
    .sort((left, right) => left.distance - right.distance);

  const pockets: number[] = [];
  for (const candidate of preferredIndices) {
    const center = centers[candidate.index]!;
    if (
      pockets.some((existingIndex) => {
        const existingCenter = centers[existingIndex]!;
        return (
          Math.hypot(
            center.x - existingCenter.x,
            center.y - existingCenter.y,
            center.z - existingCenter.z
          ) < BURNING_TREE_IGNITION_POCKET_MIN_DISTANCE
        );
      })
    ) {
      continue;
    }

    pockets.push(candidate.index);
    if (pockets.length >= BURNING_TREE_IGNITION_POCKET_COUNT) {
      break;
    }
  }

  if (pockets.length > 0) {
    return pockets;
  }

  return voxels.length > 0 ? [0] : [];
};

const getBurnSpreadStepDuration = (
  fromVoxel: MapPropVoxel,
  toVoxel: MapPropVoxel,
  seed: number
) => {
  const towardLeavesPenalty =
    toVoxel.kind === "leaves"
      ? fromVoxel.kind === "wood"
        ? 0.03
        : 0.1
      : 0;
  const canopyPenalty = toVoxel.kind === "leaves" && fromVoxel.kind === "leaves" ? 0.06 : 0;
  return 0.44 + getNoise(seed, 301) * 0.18 + towardLeavesPenalty + canopyPenalty;
};

export const createBurningTreeFxState = ({
  id,
  prop,
  duration = DEFAULT_BURNING_TREE_DURATION,
  ignitionOrigin
}: {
  id: string;
  prop: Pick<MapProp, "id" | "kind" | "x" | "y" | "z">;
  duration?: number;
  ignitionOrigin?: Vector3 | null;
}): BurningTreeFxState => {
  const voxels = getMapPropVoxels(prop);
  const totalVoxelCount = Math.max(1, voxels.length);
  const center = getPropVoxelCenter(voxels);
  center.x /= totalVoxelCount;
  center.y /= totalVoxelCount;
  center.z /= totalVoxelCount;

  const resolvedIgnitionOrigin = ignitionOrigin ?? getFallbackIgnitionOrigin(prop, center);
  const centers = voxels.map((voxel) => getVoxelCenter(voxel));
  const pocketIndices = selectBurningTreeIgnitionPocketIndices(
    voxels,
    centers,
    resolvedIgnitionOrigin
  );
  const arrivalTimes = new Array(voxels.length).fill(Number.POSITIVE_INFINITY);
  const visited = new Array(voxels.length).fill(false);

  pocketIndices.forEach((index, pocketIndex) => {
    arrivalTimes[index] = pocketIndex * 0.22;
  });

  for (let pass = 0; pass < voxels.length; pass += 1) {
    let currentIndex = -1;
    let currentTime = Number.POSITIVE_INFINITY;
    for (let index = 0; index < arrivalTimes.length; index += 1) {
      if (visited[index] || arrivalTimes[index] >= currentTime) {
        continue;
      }

      currentIndex = index;
      currentTime = arrivalTimes[index]!;
    }

    if (currentIndex === -1) {
      break;
    }

    visited[currentIndex] = true;
    const currentVoxel = voxels[currentIndex]!;
    const currentCenter = centers[currentIndex]!;

    for (let neighborIndex = 0; neighborIndex < voxels.length; neighborIndex += 1) {
      if (visited[neighborIndex]) {
        continue;
      }

      const neighborCenter = centers[neighborIndex]!;
      if (!areNeighboringTreeVoxels(currentCenter, neighborCenter)) {
        continue;
      }

      const neighborVoxel = voxels[neighborIndex]!;
      const seed =
        hashString(
          `${prop.id}:${currentCenter.x}:${currentCenter.y}:${currentCenter.z}:${neighborCenter.x}:${neighborCenter.y}:${neighborCenter.z}`
        ) * 0.0001;
      const nextTime =
        currentTime + getBurnSpreadStepDuration(currentVoxel, neighborVoxel, seed);
      if (nextTime < arrivalTimes[neighborIndex]!) {
        arrivalTimes[neighborIndex] = nextTime;
      }
    }
  }

  const latestArrival = arrivalTimes.reduce(
    (maximum, arrival) => (Number.isFinite(arrival) ? Math.max(maximum, arrival) : maximum),
    0
  );
  const arrivalScale =
    latestArrival > 0 ? (duration * BURNING_TREE_SPREAD_DURATION_RATIO) / latestArrival : 0;

  return {
    id,
    propId: prop.id,
    kind: prop.kind,
    duration,
    center,
    ignitionOrigin: resolvedIgnitionOrigin,
    voxels: voxels.map((voxel, index) => {
      const seed = hashString(
        `${prop.id}:${voxel.x}:${voxel.y}:${voxel.z}:${voxel.kind}`
      ) * 0.0001;
      const ignitionTime = Number.isFinite(arrivalTimes[index]!)
        ? arrivalTimes[index]! * arrivalScale
        : duration * 0.94;
      const burnWindow =
        voxel.kind === "wood"
          ? 5.4 + getNoise(seed, 401) * 1.1
          : 4.8 + getNoise(seed, 402) * 1;
      return {
        voxelKind: voxel.kind,
        position: centers[index]!,
        ignitionTime,
        burnoutTime: Math.min(duration, ignitionTime + burnWindow)
      };
    })
  };
};

export const getBurningTreeVoxelVisualState = (
  state: BurningTreeFxState,
  voxelIndex: number,
  elapsed: number
): BurningTreeVoxelVisualState => {
  const voxel = state.voxels[voxelIndex]!;
  if (!voxel || elapsed < voxel.ignitionTime) {
    return {
      phase: "untouched",
      charAlpha: 0,
      flameAlpha: 0,
      emberAlpha: 0,
      smokeAlpha: 0,
      activeScore: 0
    };
  }

  const seed =
    hashString(
      `${state.id}:${voxel.position.x}:${voxel.position.y}:${voxel.position.z}:${voxel.voxelKind}`
    ) * 0.0001;
  const burnSpan = Math.max(0.8, voxel.burnoutTime - voxel.ignitionTime);
  const burnProgress = clamp((elapsed - voxel.ignitionTime) / burnSpan, 0, 1);
  const postBurnElapsed = Math.max(0, elapsed - voxel.burnoutTime);
  const coolDuration = voxel.voxelKind === "wood" ? 3.4 : 2.6;
  const coolProgress = clamp(postBurnElapsed / coolDuration, 0, 1);
  const maxChar = voxel.voxelKind === "wood" ? 0.9 : 0.96;
  const flamePeak =
    Math.sin(burnProgress * Math.PI) *
    (voxel.voxelKind === "wood" ? 0.82 : 0.96) *
    (0.96 + getNoise(seed, 501) * 0.16);
  const charAlpha = clamp(
    Math.min(
      maxChar,
      (elapsed - voxel.ignitionTime) / Math.max(0.38, burnSpan * 0.52)
    ) * maxChar,
    0,
    maxChar
  );
  const emberBase = 0.26 + flamePeak * 0.84;
  const smokeBase = 0.28 + burnProgress * 0.68;

  if (elapsed >= voxel.burnoutTime) {
    const lingeringFlame = clamp(0.26 - coolProgress * 0.26, 0, 0.26);
    const lingeringEmbers = clamp(emberBase * (1 - coolProgress * 0.52), 0, 0.72);
    const lingeringSmoke = clamp(smokeBase * (1 - coolProgress * 0.12), 0, 0.86);
    return {
      phase: "charred",
      charAlpha: Math.max(voxel.voxelKind === "wood" ? 0.82 : 0.88, clamp(charAlpha, 0, maxChar)),
      flameAlpha: lingeringFlame,
      emberAlpha: lingeringEmbers,
      smokeAlpha: lingeringSmoke,
      activeScore: lingeringFlame * 1.2 + lingeringEmbers * 0.4 + lingeringSmoke * 0.15
    };
  }

  return {
    phase: burnProgress < 0.24 ? "igniting" : "burning",
    charAlpha,
    flameAlpha: clamp(flamePeak, 0, 1),
    emberAlpha: clamp(emberBase, 0, 1),
    smokeAlpha: clamp(smokeBase, 0, 1),
    activeScore: flamePeak * 1.25 + emberBase * 0.42 + smokeBase * 0.14
  };
};

export const getBurningTreeActiveVoxelIndices = (
  state: BurningTreeFxState,
  elapsed: number,
  limit: number
) =>
  state.voxels
    .map((_, index) => {
      const visual = getBurningTreeVoxelVisualState(state, index, elapsed);
      const phasePriority =
        visual.phase === "burning" ? 0 : visual.phase === "igniting" ? 1 : visual.phase === "charred" ? 2 : 3;
      return {
        activeScore: visual.activeScore,
        ignitionTime: state.voxels[index]!.ignitionTime,
        index,
        phasePriority
      };
    })
    .filter((entry) => entry.activeScore > 0.015)
    .sort(
      (left, right) =>
        left.phasePriority - right.phasePriority ||
        right.activeScore - left.activeScore ||
        left.ignitionTime - right.ignitionTime ||
        left.index - right.index
    )
    .slice(0, Math.max(0, limit))
    .map((entry) => entry.index);

export const voxelBurstParticleCountByStyle = {
  eggExplosion: 288,
  harvest: 7,
  superBoomExplosion: 432
} as const;

export const getVoxelBurstParticleCount = (burst: RuntimeVoxelBurstState) =>
  voxelBurstParticleCountByStyle[burst.style];

export const getPropShatterMaterialKey = (
  propKind: MapPropKind,
  voxelKind: MapPropVoxelKind
): PropShatterMaterialKey => {
  if (voxelKind === "wood") {
    return "bark";
  }

  if (propKind === "tree-pine") {
    return "leavesPine";
  }

  if (propKind === "tree-autumn") {
    return "leavesAutumn";
  }

  return "leavesOak";
};

export const getPropRemainsDuration = (state: Pick<
  PropRemainsState,
  "collapseDuration" | "settledDuration" | "fadeDuration"
>) => state.collapseDuration + state.settledDuration + state.fadeDuration;

export const createPropRemainsState = ({
  id,
  prop,
  burning = false,
  collapseDuration = DEFAULT_PROP_REMAINS_COLLAPSE_DURATION,
  settledDuration = DEFAULT_PROP_REMAINS_SETTLED_DURATION,
  fadeDuration = DEFAULT_PROP_REMAINS_FADE_DURATION,
  settleHeightAt
}: {
  id: string;
  prop: Pick<MapProp, "id" | "kind" | "x" | "y" | "z">;
  burning?: boolean;
  collapseDuration?: number;
  settledDuration?: number;
  fadeDuration?: number;
  settleHeightAt: (x: number, z: number) => number;
}): PropRemainsState => {
  const allVoxels = getMapPropVoxels(prop);
  const totalVoxelCount = allVoxels.length;
  const center = getPropVoxelCenter(allVoxels);
  center.x /= Math.max(1, totalVoxelCount);
  center.y /= Math.max(1, totalVoxelCount);
  center.z /= Math.max(1, totalVoxelCount);

  const stackHeights = new Map<string, number>();

  return {
    id,
    propId: prop.id,
    kind: prop.kind,
    center,
    elapsed: 0,
    burning,
    collapseDuration,
    settledDuration,
    fadeDuration,
    fragments: sortDeterministically(allVoxels, (voxel) => `${prop.id}:${voxel.x}:${voxel.y}:${voxel.z}`).map(
      (voxel: MapPropVoxel, index) => {
        const seed = hashString(`${prop.id}:${voxel.x}:${voxel.y}:${voxel.z}:${index}`) * 0.0001;
        const isLeaf = voxel.kind === "leaves";
        const origin = {
          x: voxel.x + 0.5,
          y: voxel.y + 0.5,
          z: voxel.z + 0.5
        };
        const centerDeltaX = origin.x - center.x;
        const centerDeltaZ = origin.z - center.z;
        const centerDistance = Math.hypot(centerDeltaX, centerDeltaZ);
        const normalizedDeltaX = centerDistance > 0.001 ? centerDeltaX / centerDistance : Math.cos(getNoise(seed, 1) * Math.PI * 2);
        const normalizedDeltaZ = centerDistance > 0.001 ? centerDeltaZ / centerDistance : Math.sin(getNoise(seed, 1) * Math.PI * 2);
        const orthogonalX = -normalizedDeltaZ;
        const orthogonalZ = normalizedDeltaX;
        const outwardSpread =
          (isLeaf ? 0.45 : 0.16) + getNoise(seed, 2) * (isLeaf ? 1.85 : 0.72);
        const sideDrift = (getNoise(seed, 3) - 0.5) * (isLeaf ? 1.1 : 0.28);
        const rawTargetX = origin.x + normalizedDeltaX * outwardSpread + orthogonalX * sideDrift;
        const rawTargetZ = origin.z + normalizedDeltaZ * outwardSpread + orthogonalZ * sideDrift;
        const settledCellX = Math.floor(rawTargetX);
        const settledCellZ = Math.floor(rawTargetZ);
        const settledTopY = settleHeightAt(rawTargetX, rawTargetZ);
        const stackKey = `${settledCellX}:${settledCellZ}`;
        const stackIndex = stackHeights.get(stackKey) ?? 0;
        stackHeights.set(stackKey, stackIndex + 1);
        const settleJitter = isLeaf ? 0.1 : 0.05;

        return {
          materialKey: getPropShatterMaterialKey(prop.kind, voxel.kind),
          origin,
          target: {
            x: settledCellX + 0.5 + (getNoise(seed, 4) - 0.5) * settleJitter,
            y:
              settledTopY +
              SETTLED_PROP_REMAINS_SCALE * 0.5 +
              stackIndex * (SETTLED_PROP_REMAINS_SCALE * 0.58),
            z: settledCellZ + 0.5 + (getNoise(seed, 5) - 0.5) * settleJitter
          },
          voxelKind: voxel.kind
        };
      }
    )
  };
};

export const getPropRemainsFragmentState = (
  state: PropRemainsState,
  fragmentIndex: number
): PropRemainsFragmentState => {
  const fragment = state.fragments[fragmentIndex]!;
  const totalDuration = getPropRemainsDuration(state);
  const progress = getProgress(state.elapsed, totalDuration);
  const collapseEnd = state.collapseDuration / Math.max(totalDuration, Number.EPSILON);
  const settledEnd =
    (state.collapseDuration + state.settledDuration) / Math.max(totalDuration, Number.EPSILON);
  const seed = hashString(`${state.id}:${fragmentIndex}:${fragment.materialKey}`) * 0.0001;
  const isLeaf = fragment.voxelKind === "leaves";
  const phase: PropRemainsPhase =
    progress < collapseEnd ? "collapse" : progress < settledEnd ? "settled" : "fade";
  const collapseProgress =
    collapseEnd <= 0 ? 1 : clamp(progress / Math.max(collapseEnd, Number.EPSILON), 0, 1);
  const settledProgress =
    settledEnd <= collapseEnd
      ? 1
      : clamp((progress - collapseEnd) / Math.max(settledEnd - collapseEnd, Number.EPSILON), 0, 1);
  const fadeProgress =
    progress <= settledEnd
      ? 0
      : clamp((progress - settledEnd) / Math.max(1 - settledEnd, Number.EPSILON), 0, 1);
  const spinX =
    collapseProgress * Math.PI * (isLeaf ? 1.8 + getNoise(seed, 6) * 1.4 : 0.9 + getNoise(seed, 6) * 1.1);
  const spinY =
    collapseProgress * Math.PI * (isLeaf ? 1.4 + getNoise(seed, 7) * 1.2 : 0.6 + getNoise(seed, 7) * 0.9);
  const spinZ =
    collapseProgress * Math.PI * (isLeaf ? 1.6 + getNoise(seed, 8) * 1.4 : 0.8 + getNoise(seed, 8) * 1.1);
  const emberPulse =
    state.burning && phase !== "fade"
      ? 0.55 + Math.sin(state.elapsed * (isLeaf ? 9.8 : 7.2) + getNoise(seed, 9) * Math.PI * 2) * 0.2
      : 0;

  if (phase === "collapse") {
    const arcLift =
      Math.sin(collapseProgress * Math.PI) * (isLeaf ? 0.8 : 0.28) -
      collapseProgress * collapseProgress * (isLeaf ? 0.18 : 0.42);
    const settleBias = Math.sin(collapseProgress * Math.PI * (isLeaf ? 2.2 : 1.5) + getNoise(seed, 10) * Math.PI * 2);

    return {
      position: {
        x: lerp(fragment.origin.x, fragment.target.x, collapseProgress),
        y:
          lerp(fragment.origin.y, fragment.target.y, collapseProgress) +
          arcLift +
          settleBias * (isLeaf ? 0.06 : 0.03),
        z: lerp(fragment.origin.z, fragment.target.z, collapseProgress)
      },
      rotationX: spinX,
      rotationY: spinY,
      rotationZ: spinZ,
      scale: lerp(1, SETTLED_PROP_REMAINS_SCALE, collapseProgress),
      opacity: 1,
      phase,
      burningAlpha: state.burning ? 0.95 : 0,
      materialKey: fragment.materialKey
    };
  }

  if (phase === "settled") {
    const smolderLift = state.burning ? 0.01 + getNoise(seed, 11) * 0.04 : 0;
    const breathing =
      Math.sin(state.elapsed * (isLeaf ? 5.6 : 4.2) + getNoise(seed, 12) * Math.PI * 2) *
      (isLeaf ? 0.015 : 0.008);

    return {
      position: {
        x: fragment.target.x,
        y: fragment.target.y + smolderLift + breathing,
        z: fragment.target.z
      },
      rotationX: isLeaf ? 0.12 + getNoise(seed, 13) * 0.18 : 0.04 + getNoise(seed, 13) * 0.08,
      rotationY: getNoise(seed, 14) * Math.PI * 2,
      rotationZ: isLeaf ? -0.1 + getNoise(seed, 15) * 0.22 : -0.04 + getNoise(seed, 15) * 0.08,
      scale: lerp(SETTLED_PROP_REMAINS_SCALE, SETTLED_PROP_REMAINS_SCALE * 0.96, settledProgress),
      opacity: 1,
      phase,
      burningAlpha: state.burning ? clamp(emberPulse, 0, 1) : 0,
      materialKey: fragment.materialKey
    };
  }

  return {
    position: {
      x: fragment.target.x,
      y: fragment.target.y - fadeProgress * (isLeaf ? 0.04 : 0.08),
      z: fragment.target.z
    },
    rotationX: isLeaf ? 0.16 + getNoise(seed, 16) * 0.16 : 0.05 + getNoise(seed, 16) * 0.08,
    rotationY: getNoise(seed, 17) * Math.PI * 2,
    rotationZ: isLeaf ? -0.14 + getNoise(seed, 18) * 0.2 : -0.05 + getNoise(seed, 18) * 0.08,
    scale: lerp(SETTLED_PROP_REMAINS_SCALE * 0.96, SETTLED_PROP_REMAINS_SCALE * 0.58, fadeProgress),
    opacity: clamp(1 - Math.pow(fadeProgress, isLeaf ? 1.36 : 1.12), 0, 1),
    phase,
    burningAlpha: state.burning ? clamp(0.32 - fadeProgress * 0.32, 0, 1) : 0,
    materialKey: fragment.materialKey
  };
};

export const getVoxelBurstMaterialProfile = (burst: RuntimeVoxelBurstState): BlockRenderProfile | null => {
  if (burst.style === "harvest") {
    if (!burst.kind) {
      return null;
    }

    return getBlockRenderProfile(burst.kind, Math.floor(burst.position.y));
  }

  if (burst.style === "eggExplosion" || burst.style === "superBoomExplosion") {
    return getBlockRenderProfile("ground", Math.floor(burst.position.y));
  }

  return null;
};

export const getEggScatterDebrisVisualState = (
  debris: RuntimeEggScatterDebrisState,
  arcHeight: number
): EggScatterDebrisVisualState => {
  const progress = getProgress(debris.elapsed, debris.duration);
  const seed = hashString(debris.id) * 0.0001;
  const launchStretch = Math.sin(clamp(progress / 0.22, 0, 1) * Math.PI);
  const landingStretch = Math.sin(clamp((progress - 0.76) / 0.24, 0, 1) * Math.PI);
  const corkscrewBoost = Math.sin(progress * Math.PI) * 0.12;

  return {
    position: getEggScatterDebrisPosition(debris, arcHeight),
    rotationX: progress * Math.PI * (1.8 + getNoise(seed, 1) * 1.6),
    rotationY: progress * Math.PI * (3.2 + getNoise(seed, 2) * 3),
    rotationZ: progress * Math.PI * (1.45 + getNoise(seed, 3) * 1.85),
    scaleX: 1 + launchStretch * 0.26 - landingStretch * 0.12 + corkscrewBoost,
    scaleY: 1 - launchStretch * 0.18 + landingStretch * 0.24 - corkscrewBoost * 0.6,
    scaleZ: 1 + launchStretch * 0.26 - landingStretch * 0.12 + corkscrewBoost
  };
};

export const getVoxelBurstParticleState = (
  burst: RuntimeVoxelBurstState,
  particleIndex: number
): VoxelBurstParticleState => {
  const progress = getProgress(burst.elapsed, burst.duration);
  const seed = hashString(`${burst.id}:${particleIndex}`) * 0.0001;
  const yaw = getNoise(seed, 1) * Math.PI * 2;
  const radialJitter = 0.72 + getNoise(seed, 2) * 0.65;
  const liftJitter = 0.8 + getNoise(seed, 3) * 0.7;
  const gravityJitter = 0.08 + getNoise(seed, 4) * 0.34;
  const spinX = progress * Math.PI * (1.2 + getNoise(seed, 5) * 2.2);
  const spinY = progress * Math.PI * (1.6 + getNoise(seed, 6) * 3.1);
  const spinZ = progress * Math.PI * (1.1 + getNoise(seed, 7) * 2.4);

  if (burst.style === "eggExplosion") {
    const burstBand = particleIndex % 6;
    const bandDistanceStart = [0.02, 0.08, 0.2, 0.16, 0.12, 0.04][burstBand]!;
    const bandDistanceEnd = [0.86, 1.78, 2.38, 3.24, 2.18, 1.28][burstBand]!;
    const bandLift = [0.42, 2.18, 1.08, 0.18, 0.62, 0.88][burstBand]!;
    const bandGravity = [0.42, 0.62, 0.74, 0.2, 0.92, 0.28][burstBand]!;
    const bandScaleStart = [0.28, 0.22, 0.18, 0.12, 0.1, 0.08][burstBand]!;
    const bandScaleEnd = [0.04, 0.05, 0.045, 0.03, 0.03, 0.02][burstBand]!;
    const bandBucket: VoxelBurstParticleBucket =
      burstBand === 0 || burstBand === 5 ? "accent" : "terrain";
    const distance =
      lerp(bandDistanceStart, bandDistanceEnd, progress) * (0.72 + radialJitter * 0.74);
    const flutter =
      Math.sin(progress * Math.PI * (2.2 + burstBand * 0.2) + getNoise(seed, 8) * Math.PI) *
      (burstBand === 3 ? 0.035 : 0.08);
    const lift =
      Math.sin(progress * Math.PI) * bandLift * (0.62 + liftJitter * 0.44) -
      progress * progress * gravityJitter * bandGravity +
      flutter;
    const corePulse = 1 + Math.sin(progress * Math.PI) * (bandBucket === "accent" ? 0.36 : 0.22);
    return {
      position: {
        x: burst.position.x + Math.cos(yaw) * distance,
        y: burst.position.y + lift,
        z: burst.position.z + Math.sin(yaw) * distance
      },
      rotationX: spinX * 1.34,
      rotationY: spinY * 1.48,
      rotationZ: spinZ * 1.32,
      scale: lerp(bandScaleStart, bandScaleEnd, progress) * corePulse,
      opacity: clamp(
        (bandBucket === "accent" ? 1.18 : 1.08) - Math.pow(progress, bandBucket === "accent" ? 1.36 : 1.54),
        0,
        1
      ),
      bucket: bandBucket
    };
  }

  if (burst.style === "superBoomExplosion") {
    const burstBand = particleIndex % 8;
    const bandDistanceStart = [0.08, 0.18, 0.42, 0.78, 1.14, 0.34, 0.12, 0.56][burstBand]!;
    const bandDistanceEnd = [1.68, 2.74, 4.12, 5.64, 7.34, 4.82, 2.9, 6.4][burstBand]!;
    const bandLift = [0.66, 2.96, 1.82, 1.22, 0.22, 0.84, 1.1, 1.54][burstBand]!;
    const bandGravity = [0.48, 0.7, 0.96, 1.08, 0.24, 1.16, 0.32, 0.88][burstBand]!;
    const bandScaleStart = [0.34, 0.28, 0.24, 0.2, 0.14, 0.12, 0.1, 0.16][burstBand]!;
    const bandScaleEnd = [0.08, 0.07, 0.06, 0.05, 0.035, 0.03, 0.03, 0.04][burstBand]!;
    const bandBucket: VoxelBurstParticleBucket =
      burstBand === 0 || burstBand === 6 || burstBand === 7 ? "accent" : "terrain";
    const distance = lerp(bandDistanceStart, bandDistanceEnd, progress) * (0.88 + radialJitter * 0.86);
    const flutter =
      Math.sin(progress * Math.PI * (2.5 + burstBand * 0.16) + getNoise(seed, 8) * Math.PI * 2) *
      (burstBand === 4 ? 0.06 : 0.12);
    const lift =
      Math.sin(progress * Math.PI) * bandLift * (0.68 + liftJitter * 0.48) -
      progress * progress * gravityJitter * bandGravity +
      flutter;
    const corePulse = 1 + Math.sin(progress * Math.PI) * (bandBucket === "accent" ? 0.46 : 0.28);
    return {
      position: {
        x: burst.position.x + Math.cos(yaw) * distance,
        y: burst.position.y + lift,
        z: burst.position.z + Math.sin(yaw) * distance
      },
      rotationX: spinX * 1.46,
      rotationY: spinY * 1.6,
      rotationZ: spinZ * 1.42,
      scale: lerp(bandScaleStart, bandScaleEnd, progress) * corePulse,
      opacity: clamp(
        (bandBucket === "accent" ? 1.22 : 1.14) - Math.pow(progress, bandBucket === "accent" ? 1.28 : 1.42),
        0,
        1
      ),
      bucket: bandBucket
    };
  }

  const distance = lerp(0.04, 0.42, progress) * radialJitter;
  const lift = Math.sin(progress * Math.PI) * 0.38 * liftJitter - progress * progress * gravityJitter * 0.55;
  return {
    position: {
      x: burst.position.x + Math.cos(yaw) * distance,
      y: burst.position.y + lift,
      z: burst.position.z + Math.sin(yaw) * distance
    },
    rotationX: spinX * 0.9,
    rotationY: spinY * 0.82,
    rotationZ: spinZ * 0.9,
    scale: lerp(0.16, 0.035, progress),
    opacity: 1 - Math.pow(progress, 1.7),
    bucket: "terrain"
  };
};

export const getVoxelBurstShockwaveState = (
  burst: RuntimeVoxelBurstState
): VoxelBurstShockwaveState | null => {
  if (burst.style !== "eggExplosion" && burst.style !== "superBoomExplosion") {
    return null;
  }

  const progress = getProgress(burst.elapsed, burst.duration);
  if (burst.style === "superBoomExplosion") {
    return {
      position: {
        x: burst.position.x,
        y: burst.position.y + 0.14 + progress * 0.08,
        z: burst.position.z
      },
      scale: lerp(1.18, 8.2, progress),
      opacity: clamp(0.92 - Math.pow(progress, 0.94), 0, 1)
    };
  }

  return {
    position: {
      x: burst.position.x,
      y: burst.position.y + 0.1 + progress * 0.04,
      z: burst.position.z
    },
    scale: lerp(0.78, 5.4, progress),
    opacity: clamp(0.84 - Math.pow(progress, 1.04), 0, 1)
  };
};
