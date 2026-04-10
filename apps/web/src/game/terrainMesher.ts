import * as THREE from "three";
import {
  DEFAULT_CHUNK_SIZE,
  EXPOSED_FACE_BITS,
  hasExposedFace,
  type ExposedFaceName,
  type Vec3i,
  type VisibleVoxelChunk
} from "@out-of-bounds/map";
import {
  getTerrainChunkMaterials as getSharedTerrainChunkMaterials,
  getTerrainMaterialIndex,
  getTerrainMaterialKey,
  terrainMaterialOrder,
  type TerrainMaterialKey
} from "./voxelMaterials";

interface GreedyFaceDefinition {
  name: ExposedFaceName;
  bit: number;
  normal: readonly [number, number, number];
  getSlice: (position: Vec3i) => number;
  getU: (position: Vec3i) => number;
  getV: (position: Vec3i) => number;
  getOrigin: (slice: number, u: number, v: number) => readonly [number, number, number];
  uDirection: readonly [number, number, number];
  vDirection: readonly [number, number, number];
}

interface TerrainFaceCell {
  materialKey: TerrainMaterialKey;
}

interface TerrainChunkMeshBuildState {
  positions: number[];
  normals: number[];
  uvs: number[];
  colors: number[];
  indices: number[];
  quads: TerrainChunkQuad[];
}

export interface TerrainChunkMaterialGroup {
  materialKey: TerrainMaterialKey;
  materialIndex: number;
  start: number;
  count: number;
}

export interface TerrainChunkQuad {
  face: ExposedFaceName;
  materialKey: TerrainMaterialKey;
  width: number;
  height: number;
}

export interface TerrainChunkMeshData {
  positions: number[];
  normals: number[];
  uvs: number[];
  colors: number[];
  indices: number[];
  materialKeys: TerrainMaterialKey[];
  materialGroups: TerrainChunkMaterialGroup[];
  quads: TerrainChunkQuad[];
  chunkOffset: Vec3i;
  visibleVoxelCount: number;
  quadCount: number;
  triangleCount: number;
  drawCallCount: number;
}

const FACE_SHADE_BY_NAME: Record<ExposedFaceName, number> = {
  posX: 0.9,
  negX: 0.9,
  posY: 1,
  negY: 0.78,
  posZ: 0.9,
  negZ: 0.9
};

const FACE_DEFINITIONS: GreedyFaceDefinition[] = [
  {
    name: "posX",
    bit: EXPOSED_FACE_BITS.posX,
    normal: [1, 0, 0],
    getSlice: (position) => position.x,
    getU: (position) => position.y,
    getV: (position) => position.z,
    getOrigin: (slice, u, v) => [slice + 1, u, v],
    uDirection: [0, 1, 0],
    vDirection: [0, 0, 1]
  },
  {
    name: "negX",
    bit: EXPOSED_FACE_BITS.negX,
    normal: [-1, 0, 0],
    getSlice: (position) => position.x,
    getU: (position) => position.z,
    getV: (position) => position.y,
    getOrigin: (slice, u, v) => [slice, v, u],
    uDirection: [0, 0, 1],
    vDirection: [0, 1, 0]
  },
  {
    name: "posY",
    bit: EXPOSED_FACE_BITS.posY,
    normal: [0, 1, 0],
    getSlice: (position) => position.y,
    getU: (position) => position.z,
    getV: (position) => position.x,
    getOrigin: (slice, u, v) => [v, slice + 1, u],
    uDirection: [0, 0, 1],
    vDirection: [1, 0, 0]
  },
  {
    name: "negY",
    bit: EXPOSED_FACE_BITS.negY,
    normal: [0, -1, 0],
    getSlice: (position) => position.y,
    getU: (position) => position.x,
    getV: (position) => position.z,
    getOrigin: (slice, u, v) => [u, slice, v],
    uDirection: [1, 0, 0],
    vDirection: [0, 0, 1]
  },
  {
    name: "posZ",
    bit: EXPOSED_FACE_BITS.posZ,
    normal: [0, 0, 1],
    getSlice: (position) => position.z,
    getU: (position) => position.x,
    getV: (position) => position.y,
    getOrigin: (slice, u, v) => [u, v, slice + 1],
    uDirection: [1, 0, 0],
    vDirection: [0, 1, 0]
  },
  {
    name: "negZ",
    bit: EXPOSED_FACE_BITS.negZ,
    normal: [0, 0, -1],
    getSlice: (position) => position.z,
    getU: (position) => position.y,
    getV: (position) => position.x,
    getOrigin: (slice, u, v) => [v, u, slice],
    uDirection: [0, 1, 0],
    vDirection: [1, 0, 0]
  }
];

const createEmptySliceGrid = () =>
  Array.from({ length: DEFAULT_CHUNK_SIZE }, () => Array<TerrainFaceCell | null>(DEFAULT_CHUNK_SIZE).fill(null));

const pushQuadGeometry = (
  meshData: TerrainChunkMeshBuildState,
  materialKey: TerrainMaterialKey,
  definition: GreedyFaceDefinition,
  slice: number,
  u: number,
  v: number,
  width: number,
  height: number
) => {
  const [ox, oy, oz] = definition.getOrigin(slice, u, v);
  const [ux, uy, uz] = definition.uDirection;
  const [vx, vy, vz] = definition.vDirection;
  const [nx, ny, nz] = definition.normal;
  const shade = FACE_SHADE_BY_NAME[definition.name];
  const baseIndex = meshData.positions.length / 3;

  const vertices = [
    [ox, oy, oz],
    [ox + ux * width, oy + uy * width, oz + uz * width],
    [ox + ux * width + vx * height, oy + uy * width + vy * height, oz + uz * width + vz * height],
    [ox + vx * height, oy + vy * height, oz + vz * height]
  ] as const;

  for (const [px, py, pz] of vertices) {
    meshData.positions.push(px, py, pz);
    meshData.normals.push(nx, ny, nz);
    meshData.colors.push(shade, shade, shade);
  }

  meshData.uvs.push(0, 0, width, 0, width, height, 0, height);
  meshData.quads.push({
    face: definition.name,
    materialKey,
    width,
    height
  });
  meshData.indices.push(
    baseIndex,
    baseIndex + 1,
    baseIndex + 2,
    baseIndex,
    baseIndex + 2,
    baseIndex + 3
  );
};

export const meshTerrainChunk = (chunk: VisibleVoxelChunk): TerrainChunkMeshData => {
  const chunkOffset = {
    x: chunk.coords.x * DEFAULT_CHUNK_SIZE,
    y: chunk.coords.y * DEFAULT_CHUNK_SIZE,
    z: chunk.coords.z * DEFAULT_CHUNK_SIZE
  };
  const materialKeys = new Set<TerrainMaterialKey>();
  const meshDataByMaterial = new Map<TerrainMaterialKey, TerrainChunkMeshBuildState>();

  for (const definition of FACE_DEFINITIONS) {
    const sliceGrids = new Map<number, ReturnType<typeof createEmptySliceGrid>>();

    for (const voxel of chunk.voxels) {
      if (!hasExposedFace(voxel.faceMask, definition.bit)) {
        continue;
      }

      const localPosition = {
        x: voxel.position.x - chunkOffset.x,
        y: voxel.position.y - chunkOffset.y,
        z: voxel.position.z - chunkOffset.z
      };
      const slice = definition.getSlice(localPosition);
      const u = definition.getU(localPosition);
      const v = definition.getV(localPosition);
      const grid = sliceGrids.get(slice) ?? createEmptySliceGrid();
      const materialKey = getTerrainMaterialKey(
        voxel.kind,
        voxel.position.y,
        definition.name,
        voxel.surfaceDepth
      );
      materialKeys.add(materialKey);
      grid[v]![u] = {
        materialKey
      };
      sliceGrids.set(slice, grid);
    }

    for (const [slice, grid] of sliceGrids) {
      for (let v = 0; v < DEFAULT_CHUNK_SIZE; v += 1) {
        for (let u = 0; u < DEFAULT_CHUNK_SIZE; u += 1) {
          const cell = grid[v]![u];
          if (!cell) {
            continue;
          }

          let width = 1;
          while (u + width < DEFAULT_CHUNK_SIZE && grid[v]![u + width]?.materialKey === cell.materialKey) {
            width += 1;
          }

          let height = 1;
          while (v + height < DEFAULT_CHUNK_SIZE) {
            let canExtend = true;
            for (let offset = 0; offset < width; offset += 1) {
              if (grid[v + height]![u + offset]?.materialKey !== cell.materialKey) {
                canExtend = false;
                break;
              }
            }

            if (!canExtend) {
              break;
            }

            height += 1;
          }

          for (let dv = 0; dv < height; dv += 1) {
            for (let du = 0; du < width; du += 1) {
              grid[v + dv]![u + du] = null;
            }
          }

          const bucket =
            meshDataByMaterial.get(cell.materialKey) ??
            {
              positions: [],
              normals: [],
              uvs: [],
              colors: [],
              indices: [],
              quads: []
            };
          pushQuadGeometry(bucket, cell.materialKey, definition, slice, u, v, width, height);
          meshDataByMaterial.set(cell.materialKey, bucket);
        }
      }
    }
  }

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const quads: TerrainChunkQuad[] = [];
  const materialGroups: TerrainChunkMaterialGroup[] = [];

  for (const materialKey of terrainMaterialOrder) {
    const bucket = meshDataByMaterial.get(materialKey);
    if (!bucket || bucket.indices.length === 0) {
      continue;
    }

    const vertexOffset = positions.length / 3;
    const groupStart = indices.length;
    positions.push(...bucket.positions);
    normals.push(...bucket.normals);
    uvs.push(...bucket.uvs);
    colors.push(...bucket.colors);
    quads.push(...bucket.quads);
    for (const index of bucket.indices) {
      indices.push(index + vertexOffset);
    }

    materialGroups.push({
      materialKey,
      materialIndex: getTerrainMaterialIndex(materialKey),
      start: groupStart,
      count: bucket.indices.length
    });
  }

  const activeMaterialKeys = terrainMaterialOrder.filter((key) => meshDataByMaterial.has(key));

  return {
    positions,
    normals,
    uvs,
    colors,
    indices,
    materialKeys: activeMaterialKeys.length > 0 ? activeMaterialKeys : [...materialKeys],
    materialGroups,
    quads,
    chunkOffset,
    visibleVoxelCount: chunk.voxels.length,
    quadCount: quads.length,
    triangleCount: indices.length / 3,
    drawCallCount: materialGroups.length
  };
};

export const buildTerrainChunkGeometry = (meshData: TerrainChunkMeshData) => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(meshData.positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(meshData.normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(meshData.uvs, 2));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(meshData.colors, 3));
  geometry.setIndex(meshData.indices);
  geometry.clearGroups();
  for (const group of meshData.materialGroups) {
    geometry.addGroup(group.start, group.count, group.materialIndex);
  }

  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
};

const sharedTerrainChunkMaterials = getSharedTerrainChunkMaterials();

export const getTerrainChunkMaterials = () => sharedTerrainChunkMaterials;
