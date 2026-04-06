import type { Vec3i } from "@out-of-bounds/map";

export interface VoxelCloudCube {
  x: number;
  y: number;
  z: number;
  tone: "main" | "shade";
}

export interface VoxelCloudPreset {
  id: string;
  y: number;
  z: number;
  baseX: number;
  driftSpeed: number;
  bobPhase: number;
  cubes: readonly VoxelCloudCube[];
}

const CLOUD_UNIT = 1.6;
const CLOUD_TOP_OFFSET = 0.78;
const CLOUD_WRAP_MARGIN = 26;

const centerCloudCubes = (cubes: VoxelCloudCube[]) => {
  if (cubes.length === 0) {
    return cubes;
  }

  const minX = Math.min(...cubes.map((cube) => cube.x));
  const maxX = Math.max(...cubes.map((cube) => cube.x));
  const minZ = Math.min(...cubes.map((cube) => cube.z));
  const maxZ = Math.max(...cubes.map((cube) => cube.z));
  const offsetX = (minX + maxX) / 2;
  const offsetZ = (minZ + maxZ) / 2;

  return cubes.map((cube) => ({
    ...cube,
    x: Number((cube.x - offsetX).toFixed(2)),
    z: Number((cube.z - offsetZ).toFixed(2))
  }));
};

const buildVoxelCloud = (rows: readonly string[]) => {
  const cubes: VoxelCloudCube[] = [];

  rows.forEach((row, rowIndex) => {
    [...row].forEach((token, columnIndex) => {
      if (token === ".") {
        return;
      }

      const x = columnIndex * CLOUD_UNIT;
      const z = rowIndex * CLOUD_UNIT;
      const tone = token === "s" ? "shade" : "main";
      cubes.push({ x, y: 0, z, tone });

      if (token === "w") {
        cubes.push({
          x: Number((x + CLOUD_UNIT * 0.18).toFixed(2)),
          y: CLOUD_TOP_OFFSET,
          z: Number((z - CLOUD_UNIT * 0.14).toFixed(2)),
          tone: "main"
        });
      }
    });
  });

  return centerCloudCubes(cubes);
};

const cloudShapes = {
  broad: buildVoxelCloud([
    "..swws..",
    ".swwwws.",
    "swwwwwws",
    ".swwwws.",
    "..swws.."
  ]),
  wispy: buildVoxelCloud([
    "..sww...",
    ".swwwws.",
    "swwwwww.",
    ".swwwws.",
    "...ww..."
  ]),
  tall: buildVoxelCloud([
    "..sw...",
    ".swwws.",
    "swwwwws",
    ".swwws.",
    "..sws.."
  ])
} as const;

export const cloudPresets: readonly VoxelCloudPreset[] = [
  {
    id: "cloud-1",
    baseX: -18,
    y: 22.8,
    z: 14,
    driftSpeed: 0.72,
    bobPhase: 0.2,
    cubes: cloudShapes.broad
  },
  {
    id: "cloud-2",
    baseX: 10,
    y: 24.2,
    z: 27,
    driftSpeed: 0.61,
    bobPhase: 1.3,
    cubes: cloudShapes.wispy
  },
  {
    id: "cloud-3",
    baseX: 34,
    y: 23.9,
    z: 57,
    driftSpeed: 0.61,
    bobPhase: 2.1,
    cubes: cloudShapes.tall
  },
  {
    id: "cloud-4",
    baseX: 54,
    y: 27.4,
    z: 18,
    driftSpeed: 0.46,
    bobPhase: 0.9,
    cubes: cloudShapes.broad
  },
  {
    id: "cloud-5",
    baseX: 76,
    y: 29.1,
    z: 36,
    driftSpeed: 0.42,
    bobPhase: 1.8,
    cubes: cloudShapes.wispy
  },
  {
    id: "cloud-6",
    baseX: 108,
    y: 30.6,
    z: 68,
    driftSpeed: 0.38,
    bobPhase: 2.5,
    cubes: cloudShapes.tall
  },
  {
    id: "cloud-7",
    baseX: -32,
    y: 33.6,
    z: 22,
    driftSpeed: 0.28,
    bobPhase: 0.55,
    cubes: cloudShapes.wispy
  },
  {
    id: "cloud-8",
    baseX: 24,
    y: 35.4,
    z: 52,
    driftSpeed: 0.24,
    bobPhase: 1.95,
    cubes: cloudShapes.broad
  },
  {
    id: "cloud-9",
    baseX: 88,
    y: 36.8,
    z: 74,
    driftSpeed: 0.22,
    bobPhase: 2.85,
    cubes: cloudShapes.wispy
  }
] as const;

export const wrapSkyCoordinate = (value: number, span: number, margin = CLOUD_WRAP_MARGIN) => {
  const wrapSpan = span + margin * 2;
  return ((((value + margin) % wrapSpan) + wrapSpan) % wrapSpan) - margin;
};

export const getVoxelCloudPosition = (preset: VoxelCloudPreset, elapsedSeconds: number, worldSize: Vec3i) => ({
  x: wrapSkyCoordinate(preset.baseX + elapsedSeconds * preset.driftSpeed, worldSize.x),
  y: Number((preset.y + Math.sin(elapsedSeconds * 0.18 + preset.bobPhase) * 0.45).toFixed(2)),
  z: preset.z
});
