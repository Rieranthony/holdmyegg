import { type MutableVoxelWorld, type Vec3i } from "@out-of-bounds/map";

interface Vector3Like {
  x: number;
  y: number;
  z: number;
}

export interface TerrainRaycastHit {
  voxel: Vec3i;
  normal: Vec3i;
  distance?: number;
}

const RAYCAST_EPSILON = 0.0001;

const normalizeVector = (vector: Vector3Like) => {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  if (length <= Number.EPSILON) {
    return null;
  }

  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length
  };
};

const getEntryNormal = (step: Vec3i): Vec3i => ({
  x: step.x === 0 ? 0 : -step.x,
  y: step.y === 0 ? 0 : -step.y,
  z: step.z === 0 ? 0 : -step.z
});

const getFallbackNormal = (direction: Vector3Like): Vec3i => {
  const axes = [
    { axis: "x" as const, magnitude: Math.abs(direction.x), step: Math.sign(direction.x) },
    { axis: "y" as const, magnitude: Math.abs(direction.y), step: Math.sign(direction.y) },
    { axis: "z" as const, magnitude: Math.abs(direction.z), step: Math.sign(direction.z) }
  ].sort((left, right) => right.magnitude - left.magnitude);

  const dominant = axes[0];
  if (!dominant || dominant.magnitude <= Number.EPSILON) {
    return { x: 0, y: 1, z: 0 };
  }

  return dominant.axis === "x"
    ? { x: dominant.step === 0 ? 0 : -dominant.step, y: 0, z: 0 }
    : dominant.axis === "y"
      ? { x: 0, y: dominant.step === 0 ? 1 : -dominant.step, z: 0 }
      : { x: 0, y: 0, z: dominant.step === 0 ? 0 : -dominant.step };
};

const distanceToBoundary = (origin: number, direction: number, step: number) => {
  if (step === 0 || Math.abs(direction) <= Number.EPSILON) {
    return Number.POSITIVE_INFINITY;
  }

  const boundary = step > 0 ? Math.floor(origin) + 1 : Math.floor(origin);
  return (boundary - origin) / direction;
};

export const raycastVoxelWorld = (
  world: MutableVoxelWorld,
  origin: Vector3Like,
  direction: Vector3Like,
  maxDistance: number
): TerrainRaycastHit | null => {
  const rayDirection = normalizeVector(direction);
  if (!rayDirection || maxDistance <= 0) {
    return null;
  }

  let voxel = {
    x: Math.floor(origin.x),
    y: Math.floor(origin.y),
    z: Math.floor(origin.z)
  };

  const step = {
    x: Math.sign(rayDirection.x),
    y: Math.sign(rayDirection.y),
    z: Math.sign(rayDirection.z)
  };
  const tDelta = {
    x: step.x === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / rayDirection.x),
    y: step.y === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / rayDirection.y),
    z: step.z === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / rayDirection.z)
  };
  const tMax = {
    x: distanceToBoundary(origin.x, rayDirection.x, step.x),
    y: distanceToBoundary(origin.y, rayDirection.y, step.y),
    z: distanceToBoundary(origin.z, rayDirection.z, step.z)
  };

  if (world.hasSolid(voxel.x, voxel.y, voxel.z)) {
    return {
      voxel,
      normal: getFallbackNormal(rayDirection),
      distance: 0
    };
  }

  let distance = 0;
  let hitNormal = getFallbackNormal(rayDirection);

  while (distance <= maxDistance) {
    if (tMax.x <= tMax.y && tMax.x <= tMax.z) {
      voxel = {
        x: voxel.x + step.x,
        y: voxel.y,
        z: voxel.z
      };
      distance = tMax.x;
      tMax.x += tDelta.x;
      hitNormal = getEntryNormal({ x: step.x, y: 0, z: 0 });
    } else if (tMax.y <= tMax.x && tMax.y <= tMax.z) {
      voxel = {
        x: voxel.x,
        y: voxel.y + step.y,
        z: voxel.z
      };
      distance = tMax.y;
      tMax.y += tDelta.y;
      hitNormal = getEntryNormal({ x: 0, y: step.y, z: 0 });
    } else {
      voxel = {
        x: voxel.x,
        y: voxel.y,
        z: voxel.z + step.z
      };
      distance = tMax.z;
      tMax.z += tDelta.z;
      hitNormal = getEntryNormal({ x: 0, y: 0, z: step.z });
    }

    if (distance > maxDistance) {
      break;
    }

    if (world.hasSolid(voxel.x, voxel.y, voxel.z)) {
      return {
        voxel,
        normal: hitNormal,
        distance
      };
    }
  }

  return null;
};

export const resolveTerrainRaycastHit = (
  point: Vector3Like,
  faceNormal: Vector3Like | null | undefined
): TerrainRaycastHit | null => {
  if (!faceNormal) {
    return null;
  }

  const normal = {
    x: Math.round(faceNormal.x),
    y: Math.round(faceNormal.y),
    z: Math.round(faceNormal.z)
  };

  return {
    voxel: {
      x: Math.floor(point.x - normal.x * RAYCAST_EPSILON),
      y: Math.floor(point.y - normal.y * RAYCAST_EPSILON),
      z: Math.floor(point.z - normal.z * RAYCAST_EPSILON)
    },
    normal
  };
};
