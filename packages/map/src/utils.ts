import type {
  BlockKind,
  ChunkCoords,
  DirtyChunkSet,
  ExposedFaceMask,
  MapDocumentV1,
  VoxelCell,
  Vec3i
} from "./types";

export const DEFAULT_CHUNK_SIZE = 16;

export const EXPOSED_FACE_BITS = {
  posX: 1 << 0,
  negX: 1 << 1,
  posY: 1 << 2,
  negY: 1 << 3,
  posZ: 1 << 4,
  negZ: 1 << 5
} as const;

export type ExposedFaceName = keyof typeof EXPOSED_FACE_BITS;

export const EXPOSED_FACE_ENTRIES = [
  {
    name: "posX",
    bit: EXPOSED_FACE_BITS.posX,
    normal: { x: 1, y: 0, z: 0 }
  },
  {
    name: "negX",
    bit: EXPOSED_FACE_BITS.negX,
    normal: { x: -1, y: 0, z: 0 }
  },
  {
    name: "posY",
    bit: EXPOSED_FACE_BITS.posY,
    normal: { x: 0, y: 1, z: 0 }
  },
  {
    name: "negY",
    bit: EXPOSED_FACE_BITS.negY,
    normal: { x: 0, y: -1, z: 0 }
  },
  {
    name: "posZ",
    bit: EXPOSED_FACE_BITS.posZ,
    normal: { x: 0, y: 0, z: 1 }
  },
  {
    name: "negZ",
    bit: EXPOSED_FACE_BITS.negZ,
    normal: { x: 0, y: 0, z: -1 }
  }
] as const satisfies ReadonlyArray<{
  name: ExposedFaceName;
  bit: number;
  normal: Vec3i;
}>;

export const createVoxelKey = (x: number, y: number, z: number) => `${x},${y},${z}`;

export const parseVoxelKey = (key: string): Vec3i => {
  const [x, y, z] = key.split(",").map(Number);
  return { x, y, z };
};

export const chunkCoordsFromPosition = (
  x: number,
  y: number,
  z: number,
  chunkSize = DEFAULT_CHUNK_SIZE
): ChunkCoords => ({
  x: Math.floor(x / chunkSize),
  y: Math.floor(y / chunkSize),
  z: Math.floor(z / chunkSize)
});

export const chunkKeyFromCoords = (coords: ChunkCoords) => `${coords.x}:${coords.y}:${coords.z}`;

export const chunkKeyFromPosition = (
  x: number,
  y: number,
  z: number,
  chunkSize = DEFAULT_CHUNK_SIZE
) => chunkKeyFromCoords(chunkCoordsFromPosition(x, y, z, chunkSize));

export const isInBounds = (size: Vec3i, x: number, y: number, z: number) =>
  x >= 0 && x < size.x && y >= 0 && y < size.y && z >= 0 && z < size.z;

export const isLiquidBlockKind = (kind: BlockKind | undefined) => kind === "water";

export const isBlockingBlockKind = (kind: BlockKind | undefined) =>
  kind === "ground" || kind === "boundary" || kind === "hazard";

export const isSolidKind = isBlockingBlockKind;

export const hasExposedFace = (faceMask: ExposedFaceMask, faceBit: number) => (faceMask & faceBit) !== 0;

export const collectDirtyChunkKeysAround = (
  size: Vec3i,
  x: number,
  y: number,
  z: number,
  chunkSize = DEFAULT_CHUNK_SIZE
): DirtyChunkSet => {
  const dirty = new Set<string>();
  const offsets = [
    [0, 0, 0],
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1]
  ];

  for (const [ox, oy, oz] of offsets) {
    const px = x + ox;
    const py = y + oy;
    const pz = z + oz;
    if (isInBounds(size, px, py, pz)) {
      dirty.add(chunkKeyFromPosition(px, py, pz, chunkSize));
    }
  }

  dirty.add(chunkKeyFromPosition(x, y, z, chunkSize));
  return dirty;
};

export const cloneMapDocument = (document: MapDocumentV1): MapDocumentV1 => ({
  version: document.version,
  meta: { ...document.meta },
  size: { ...document.size },
  boundary: { ...document.boundary },
  spawns: document.spawns.map((spawn) => ({ ...spawn })),
  props: document.props.map((prop) => ({ ...prop })),
  waterfalls: document.waterfalls.map((waterfall) => ({ ...waterfall })),
  voxels: document.voxels.map((voxel) => ({ ...voxel }))
});

export const sortVoxels = (voxels: Iterable<VoxelCell>) =>
  [...voxels].sort((left, right) => {
    if (left.y !== right.y) {
      return left.y - right.y;
    }

    if (left.z !== right.z) {
      return left.z - right.z;
    }

    return left.x - right.x;
  });
