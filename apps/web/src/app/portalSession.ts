import { MutableVoxelWorld, type MapDocumentV1 } from "@out-of-bounds/map";
import type {
  SimulationPlayerSpawnOverride,
  Vector2,
  Vector3
} from "@out-of-bounds/sim";
import {
  getChickenPalette,
  getChickenPaletteByName,
  type ChickenPaletteName,
  chickenPalettes
} from "../game/colors";
import { getPlanarVectorFromYaw } from "../game/camera";
import type {
  PortalAnchor,
  PortalFacing,
  PortalSceneConfig,
  PortalTraversalSnapshot
} from "../engine/types";

export const VIBE_JAM_PORTAL_URL = "https://vibejam.cc/portal/2026";
export const EXIT_PORTAL_ID = "exit-portal";
export const RETURN_PORTAL_ID = "return-portal";

const EXIT_PORTAL_COLUMN = { x: 40, z: 8 };
const RETURN_PORTAL_COLUMN = { x: 40, z: 70 };
const PORTAL_TRIGGER_RADIUS = 1.55;
const PORTAL_TRIGGER_HALF_HEIGHT = 2.2;
const MAX_PORTAL_SPEED = 18;
const MAX_PORTAL_VERTICAL_SPEED = 14;
const MAX_PORTAL_ROTATION = Math.PI * 4;
const colorWordPaletteMap: Record<string, ChickenPaletteName> = {
  beige: "cream",
  blue: "sky",
  brown: "cocoa",
  chocolate: "cocoa",
  coral: "coral",
  cream: "cream",
  cyan: "sky",
  gold: "gold",
  green: "mint",
  lime: "mint",
  mint: "mint",
  orange: "coral",
  red: "coral",
  sky: "sky",
  white: "cream",
  yellow: "gold"
};
const forwardedPortalParamKeys = [
  "avatar_url",
  "color",
  "hp",
  "ref",
  "rotation_x",
  "rotation_y",
  "rotation_z",
  "speed",
  "speed_x",
  "speed_y",
  "speed_z",
  "team",
  "username"
] as const;

export interface PortalBootstrapState {
  playerName: string;
  paletteName: ChickenPaletteName | null;
  incomingRefUrl: string | null;
  forwardedParams: Partial<Record<(typeof forwardedPortalParamKeys)[number], string>>;
  localPlayerSpawnOverride: SimulationPlayerSpawnOverride | null;
}

export interface ExplorePortalRuntimeConfig {
  arrivalAnchor: PortalAnchor | null;
  scene: PortalSceneConfig;
}

interface LocationLike {
  origin: string;
  pathname: string;
  search: string;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const normalizeAngle = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

const roundPortalNumber = (value: number) =>
  Number.isFinite(value) ? Number(value.toFixed(3)).toString() : null;

const parseFiniteNumber = (value: string | null) => {
  if (!value) {
    return null;
  }

  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
};

const parseHexColor = (value: string) => {
  const normalized = value.trim().replace(/^#/, "");
  const expanded =
    normalized.length === 3
      ? normalized
          .split("")
          .map((channel) => `${channel}${channel}`)
          .join("")
      : normalized;
  if (!/^[0-9a-f]{6}$/i.test(expanded)) {
    return null;
  }

  return {
    red: Number.parseInt(expanded.slice(0, 2), 16),
    green: Number.parseInt(expanded.slice(2, 4), 16),
    blue: Number.parseInt(expanded.slice(4, 6), 16)
  };
};

const findNearestPaletteName = (hexColor: string) => {
  const color = parseHexColor(hexColor);
  if (!color) {
    return null;
  }

  let closestPalette = chickenPalettes[0]?.name ?? null;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (const palette of chickenPalettes) {
    const paletteColor = parseHexColor(palette.body);
    if (!paletteColor) {
      continue;
    }

    const distance =
      (paletteColor.red - color.red) ** 2 +
      (paletteColor.green - color.green) ** 2 +
      (paletteColor.blue - color.blue) ** 2;
    if (distance < closestDistance) {
      closestDistance = distance;
      closestPalette = palette.name;
    }
  }

  return closestPalette;
};

export const resolveIncomingPortalPaletteName = (value: string | null) => {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (chickenPalettes.some((palette) => palette.name === normalized)) {
    return normalized as ChickenPaletteName;
  }

  if (normalized in colorWordPaletteMap) {
    return colorWordPaletteMap[normalized];
  }

  return findNearestPaletteName(normalized);
};

export const normalizePortalRef = (rawRef: string | null, currentOrigin: string) => {
  if (!rawRef) {
    return null;
  }

  try {
    const normalized = new URL(rawRef, currentOrigin);
    if (normalized.protocol !== "http:" && normalized.protocol !== "https:") {
      return null;
    }

    return normalized.toString();
  } catch {
    return null;
  }
};

const getClampedPortalVelocity = (params: URLSearchParams) => {
  const speedX = parseFiniteNumber(params.get("speed_x"));
  const speedY = parseFiniteNumber(params.get("speed_y"));
  const speedZ = parseFiniteNumber(params.get("speed_z"));

  if (speedX !== null || speedY !== null || speedZ !== null) {
    return {
      x: clamp(speedX ?? 0, -MAX_PORTAL_SPEED, MAX_PORTAL_SPEED),
      y: clamp(speedY ?? 0, -MAX_PORTAL_VERTICAL_SPEED, MAX_PORTAL_VERTICAL_SPEED),
      z: clamp(speedZ ?? 0, -MAX_PORTAL_SPEED, MAX_PORTAL_SPEED)
    } satisfies Vector3;
  }

  const speed = parseFiniteNumber(params.get("speed"));
  const rotationY = parseFiniteNumber(params.get("rotation_y"));
  if (speed === null || rotationY === null) {
    return null;
  }

  const planarVelocity = getPlanarVectorFromYaw(
    normalizeAngle(clamp(rotationY, -MAX_PORTAL_ROTATION, MAX_PORTAL_ROTATION))
  );
  const clampedSpeed = clamp(Math.abs(speed), 0, MAX_PORTAL_SPEED);
  return {
    x: planarVelocity.x * clampedSpeed,
    y: 0,
    z: planarVelocity.z * clampedSpeed
  } satisfies Vector3;
};

const getClampedPortalFacing = (params: URLSearchParams, velocity: Vector3 | null) => {
  const rotationY = parseFiniteNumber(params.get("rotation_y"));
  if (rotationY !== null) {
    const facing = getPlanarVectorFromYaw(
      normalizeAngle(clamp(rotationY, -MAX_PORTAL_ROTATION, MAX_PORTAL_ROTATION))
    );
    return {
      x: facing.x,
      z: facing.z
    } satisfies Vector2;
  }

  if (!velocity || Math.hypot(velocity.x, velocity.z) < 0.001) {
    return null;
  }

  const magnitude = Math.hypot(velocity.x, velocity.z);
  return {
    x: velocity.x / magnitude,
    z: velocity.z / magnitude
  } satisfies Vector2;
};

export const readPortalBootstrapState = (
  locationLike: LocationLike | null | undefined
): PortalBootstrapState | null => {
  if (!locationLike) {
    return null;
  }

  const params = new URLSearchParams(locationLike.search);
  if (params.get("portal") !== "true") {
    return null;
  }

  const forwardedParams = forwardedPortalParamKeys.reduce(
    (accumulator, key) => {
      const value = params.get(key);
      if (value) {
        accumulator[key] = value;
      }
      return accumulator;
    },
    {} as Partial<Record<(typeof forwardedPortalParamKeys)[number], string>>
  );
  const velocity = getClampedPortalVelocity(params);
  const facing = getClampedPortalFacing(params, velocity);

  return {
    playerName: params.get("username")?.trim() ?? "",
    paletteName: resolveIncomingPortalPaletteName(params.get("color")),
    incomingRefUrl: normalizePortalRef(params.get("ref"), locationLike.origin),
    forwardedParams,
    localPlayerSpawnOverride: {
      anchor: { x: 0, y: 0, z: 0 },
      ...(velocity ? { velocity } : {}),
      ...(facing ? { facing } : {})
    }
  };
};

const isPortalColumnSafe = (
  world: MutableVoxelWorld,
  columnX: number,
  columnZ: number
) => {
  if (
    columnX < 0 ||
    columnX >= world.size.x ||
    columnZ < 0 ||
    columnZ >= world.size.z
  ) {
    return false;
  }

  const topTerrainY = world.getTopTerrainY(columnX, columnZ);
  if (topTerrainY < 0) {
    return false;
  }

  return topTerrainY + 6 < world.size.y;
};

const buildPortalAnchor = (
  world: MutableVoxelWorld,
  columnX: number,
  columnZ: number
): PortalAnchor | null => {
  if (!isPortalColumnSafe(world, columnX, columnZ)) {
    return null;
  }

  return world.getEditableSpawnPosition(columnX, columnZ);
};

const resolveScannedPortalAnchor = (
  world: MutableVoxelWorld,
  side: "north" | "south"
) => {
  const centerX = clamp(Math.floor(world.size.x / 2), 0, Math.max(0, world.size.x - 1));
  const zStart = side === "north" ? 0 : world.size.z - 1;
  const zEnd = side === "north" ? world.size.z : -1;
  const zStep = side === "north" ? 1 : -1;

  for (let z = zStart; z !== zEnd; z += zStep) {
    const anchor = buildPortalAnchor(world, centerX, z);
    if (anchor) {
      return anchor;
    }
  }

  return null;
};

const resolvePortalAnchor = (
  world: MutableVoxelWorld,
  side: "north" | "south"
) => {
  const preferredColumn =
    side === "north" ? EXIT_PORTAL_COLUMN : RETURN_PORTAL_COLUMN;
  return (
    buildPortalAnchor(world, preferredColumn.x, preferredColumn.z) ??
    resolveScannedPortalAnchor(world, side)
  );
};

const createPortalDescriptor = (
  id: string,
  anchor: PortalAnchor,
  facing: PortalFacing,
  variant: "exit" | "return",
  armed: boolean
) => ({
  id,
  anchor,
  facing,
  label: "MAGIC PORTAL",
  armed,
  triggerRadius: PORTAL_TRIGGER_RADIUS,
  triggerHalfHeight: PORTAL_TRIGGER_HALF_HEIGHT,
  variant
});

export const buildExplorePortalRuntimeConfig = (
  document: MapDocumentV1,
  options: {
    includeReturnPortal: boolean;
  }
): ExplorePortalRuntimeConfig => {
  const world = new MutableVoxelWorld(document);
  const exitAnchor = resolvePortalAnchor(world, "north");
  const arrivalAnchor = resolvePortalAnchor(world, "south");
  const portals: PortalSceneConfig["portals"] = [];

  if (exitAnchor) {
    portals.push(
      createPortalDescriptor(
        EXIT_PORTAL_ID,
        exitAnchor,
        "south",
        "exit",
        true
      )
    );
  }

  if (options.includeReturnPortal && arrivalAnchor) {
    portals.push(
      createPortalDescriptor(
        RETURN_PORTAL_ID,
        arrivalAnchor,
        "north",
        "return",
        false
      )
    );
  }

  return {
    arrivalAnchor,
    scene: { portals }
  };
};

export const getCurrentGameUrl = (locationLike: Pick<LocationLike, "origin" | "pathname">) =>
  new URL(locationLike.pathname, locationLike.origin).toString();

const setOptionalParam = (
  params: URLSearchParams,
  key: string,
  value: string | null
) => {
  if (value === null || value.length === 0) {
    params.delete(key);
    return;
  }

  params.set(key, value);
};

const setDynamicPortalParams = (
  params: URLSearchParams,
  options: {
    playerName: string;
    paletteName: ChickenPaletteName | null;
    matchColorSeed: number;
    snapshot: PortalTraversalSnapshot;
    refUrl: string;
  }
) => {
  const palette = getChickenPalette("human-1", options.matchColorSeed, options.paletteName);
  setOptionalParam(params, "username", options.playerName.trim() || null);
  params.set("color", getChickenPaletteByName(palette.name).body);
  setOptionalParam(params, "speed", roundPortalNumber(options.snapshot.speed));
  setOptionalParam(params, "speed_x", roundPortalNumber(options.snapshot.speedX));
  setOptionalParam(params, "speed_y", roundPortalNumber(options.snapshot.speedY));
  setOptionalParam(params, "speed_z", roundPortalNumber(options.snapshot.speedZ));
  setOptionalParam(params, "rotation_x", roundPortalNumber(options.snapshot.rotationX));
  setOptionalParam(params, "rotation_y", roundPortalNumber(options.snapshot.rotationY));
  setOptionalParam(params, "rotation_z", roundPortalNumber(options.snapshot.rotationZ));
  params.set("ref", options.refUrl);
};

export const buildPortalRedirectUrl = (options: {
  currentGameUrl: string;
  incomingRefUrl: string | null;
  forwardedParams: Partial<Record<(typeof forwardedPortalParamKeys)[number], string>>;
  matchColorSeed: number;
  paletteName: ChickenPaletteName | null;
  playerName: string;
  portalId: string;
  snapshot: PortalTraversalSnapshot;
}) => {
  const targetUrl =
    options.portalId === RETURN_PORTAL_ID
      ? options.incomingRefUrl
      : VIBE_JAM_PORTAL_URL;
  if (!targetUrl) {
    return null;
  }

  const url = new URL(targetUrl);
  if (options.portalId === RETURN_PORTAL_ID) {
    for (const [key, value] of Object.entries(options.forwardedParams)) {
      if (value) {
        url.searchParams.set(key, value);
      }
    }
    url.searchParams.set("portal", "true");
  }

  setDynamicPortalParams(url.searchParams, {
    playerName: options.playerName,
    paletteName: options.paletteName,
    matchColorSeed: options.matchColorSeed,
    snapshot: options.snapshot,
    refUrl: options.currentGameUrl
  });
  return url.toString();
};
