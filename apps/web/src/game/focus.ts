import { isInBounds, type BlockKind, type MapPropKind, type Vec3i } from "@out-of-bounds/map";

interface Vector3Like {
  x: number;
  y: number;
  z: number;
}

export type FocusInvalidReason =
  | "outOfRange"
  | "hazard"
  | "outOfBounds"
  | "occupied"
  | "blockedByPlayer"
  | "blockedByDebris";

export interface VoxelFocusState {
  focusedVoxel: Vec3i | null;
  targetNormal: Vec3i | null;
  placeVoxel: Vec3i | null;
  destroyValid: boolean;
  placeValid: boolean;
  invalidReason: FocusInvalidReason | null;
}

export interface FocusVisualState {
  reticleColor: string;
  outlineColor: string;
  ghostColor: string;
  ghostOpacity: number;
}

interface ResolveVoxelFocusInput {
  hitVoxel: Vec3i | null;
  hitNormal: Vec3i | null;
  hitKind: BlockKind | MapPropKind | null;
  worldSize: Vec3i;
  playerChest: Vector3Like;
  interactRange: number;
  placementOccupied: boolean;
  blockedByPlayer: boolean;
  blockedByDebris: boolean;
}

const VALID_RETICLE_COLOR = "#fff3c1";
const INVALID_RETICLE_COLOR = "#ef6f64";
const VALID_OUTLINE_COLOR = "#fff9d8";
const INVALID_OUTLINE_COLOR = "#ef6f64";
const VALID_GHOST_COLOR = "#b3f2c5";
const INVALID_GHOST_COLOR = "#ef6f64";
const NEUTRAL_GHOST_OPACITY = 0.32;
const INVALID_GHOST_OPACITY = 0.24;
const isDestroyableFocusKind = (kind: BlockKind | MapPropKind) =>
  kind === "ground" || kind === "boundary" || kind.startsWith("tree-");

export const emptyFocusState = (): VoxelFocusState => ({
  focusedVoxel: null,
  targetNormal: null,
  placeVoxel: null,
  destroyValid: false,
  placeValid: false,
  invalidReason: null
});

export const resolveVoxelFocusState = ({
  hitVoxel,
  hitNormal,
  hitKind,
  worldSize,
  playerChest,
  interactRange,
  placementOccupied,
  blockedByPlayer,
  blockedByDebris
}: ResolveVoxelFocusInput): VoxelFocusState => {
  if (!hitVoxel || !hitNormal || !hitKind) {
    return emptyFocusState();
  }

  const placeVoxel = {
    x: hitVoxel.x + hitNormal.x,
    y: hitVoxel.y + hitNormal.y,
    z: hitVoxel.z + hitNormal.z
  };
  const targetCenter = {
    x: hitVoxel.x + 0.5,
    y: hitVoxel.y + 0.5,
    z: hitVoxel.z + 0.5
  };
  const inRange =
    Math.hypot(targetCenter.x - playerChest.x, targetCenter.y - playerChest.y, targetCenter.z - playerChest.z) <=
    interactRange;
  const destroyValid = inRange && isDestroyableFocusKind(hitKind);

  let placeValid = false;
  let invalidReason: FocusInvalidReason | null = null;

  if (!inRange) {
    invalidReason = "outOfRange";
  } else if (!isInBounds(worldSize, placeVoxel.x, placeVoxel.y, placeVoxel.z)) {
    invalidReason = "outOfBounds";
  } else if (placementOccupied) {
    invalidReason = "occupied";
  } else if (blockedByPlayer) {
    invalidReason = "blockedByPlayer";
  } else if (blockedByDebris) {
    invalidReason = "blockedByDebris";
  } else {
    placeValid = true;
  }

  if (!destroyValid && hitKind === "hazard" && !placeValid) {
    invalidReason = "hazard";
  }

  return {
    focusedVoxel: hitVoxel,
    targetNormal: hitNormal,
    placeVoxel,
    destroyValid,
    placeValid,
    invalidReason: destroyValid || placeValid ? invalidReason : invalidReason ?? "hazard"
  };
};

export const getFocusVisualState = (focusState: VoxelFocusState): FocusVisualState => {
  const actionable = focusState.destroyValid || focusState.placeValid;
  const invalid = focusState.focusedVoxel !== null && !actionable;

  return {
    reticleColor: actionable ? VALID_RETICLE_COLOR : invalid ? INVALID_RETICLE_COLOR : VALID_RETICLE_COLOR,
    outlineColor: actionable ? VALID_OUTLINE_COLOR : INVALID_OUTLINE_COLOR,
    ghostColor: focusState.placeValid ? VALID_GHOST_COLOR : INVALID_GHOST_COLOR,
    ghostOpacity: focusState.placeValid ? NEUTRAL_GHOST_OPACITY : INVALID_GHOST_OPACITY
  };
};

export const focusStateEquals = (left: VoxelFocusState, right: VoxelFocusState) =>
  left.destroyValid === right.destroyValid &&
  left.placeValid === right.placeValid &&
  left.invalidReason === right.invalidReason &&
  left.focusedVoxel?.x === right.focusedVoxel?.x &&
  left.focusedVoxel?.y === right.focusedVoxel?.y &&
  left.focusedVoxel?.z === right.focusedVoxel?.z &&
  left.targetNormal?.x === right.targetNormal?.x &&
  left.targetNormal?.y === right.targetNormal?.y &&
  left.targetNormal?.z === right.targetNormal?.z &&
  left.placeVoxel?.x === right.placeVoxel?.x &&
  left.placeVoxel?.y === right.placeVoxel?.y &&
  left.placeVoxel?.z === right.placeVoxel?.z;
