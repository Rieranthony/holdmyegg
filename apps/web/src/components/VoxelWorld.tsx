import { forwardRef, useEffect, useRef, useState } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { DEFAULT_CHUNK_SIZE, type MutableVoxelWorld, type VisibleVoxelChunk } from "@out-of-bounds/map";
import {
  buildTerrainChunkGeometry,
  getTerrainChunkMaterials,
  meshTerrainChunk,
  type TerrainChunkMeshData
} from "../game/terrainMesher";
import { resolveTerrainRaycastHit } from "../game/terrainRaycast";
import { countFrustumVisibleTerrainChunks, createTerrainChunkBounds } from "../game/terrainVisibility";

export interface VoxelInteractPayload {
  voxel: {
    x: number;
    y: number;
    z: number;
  };
  normal: {
    x: number;
    y: number;
    z: number;
  };
}

export interface TerrainRenderStats {
  chunkCount: number;
  frustumVisibleChunkCount: number;
  visibleVoxelCount: number;
  triangleCount: number;
  drawCallCount: number;
  rebuildDurationMs: number;
  renderer: "groupedMaterials";
}

interface VoxelWorldViewProps {
  world: MutableVoxelWorld;
  revision: number;
  dirtyChunkKeys: string[];
  editable?: boolean;
  onInteract?: (payload: VoxelInteractPayload) => void;
  onTerrainStatsChange?: (stats: TerrainRenderStats) => void;
}

interface TerrainChunkRenderData {
  key: string;
  position: [number, number, number];
  geometry: THREE.BufferGeometry;
  materials: THREE.Material[];
  meshData: TerrainChunkMeshData;
  bounds: THREE.Box3;
}

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

const sortRenderChunks = (left: TerrainChunkRenderData, right: TerrainChunkRenderData) => left.key.localeCompare(right.key);

const createRenderedChunk = (chunk: VisibleVoxelChunk): TerrainChunkRenderData => {
  const meshData = meshTerrainChunk(chunk);
  const position: [number, number, number] = [meshData.chunkOffset.x, meshData.chunkOffset.y, meshData.chunkOffset.z];
  const geometry = buildTerrainChunkGeometry(meshData);
  return {
    key: chunk.key,
    position,
    geometry,
    materials: getTerrainChunkMaterials(),
    meshData,
    bounds: createTerrainChunkBounds(geometry, position)
  };
};

const createRenderedChunks = (chunks: VisibleVoxelChunk[]) => chunks.map(createRenderedChunk).sort(sortRenderChunks);

const disposeRenderedChunk = (chunk: TerrainChunkRenderData) => {
  chunk.geometry.dispose();
};

const summarizeTerrainStats = (
  chunks: TerrainChunkRenderData[],
  rebuildDurationMs: number,
  frustumVisibleChunkCount: number
): TerrainRenderStats => ({
  chunkCount: chunks.length,
  frustumVisibleChunkCount,
  visibleVoxelCount: chunks.reduce((sum, chunk) => sum + chunk.meshData.visibleVoxelCount, 0),
  triangleCount: chunks.reduce((sum, chunk) => sum + chunk.meshData.triangleCount, 0),
  drawCallCount: chunks.reduce((sum, chunk) => sum + chunk.meshData.drawCallCount, 0),
  rebuildDurationMs: Number(rebuildDurationMs.toFixed(2)),
  renderer: "groupedMaterials"
});

export const VoxelWorldView = forwardRef<THREE.Group, VoxelWorldViewProps>(function VoxelWorldView(
  {
    world,
    revision,
    dirtyChunkKeys,
    editable = false,
    onInteract,
    onTerrainStatsChange
  },
  ref
) {
  const camera = useThree((state) => state.camera);
  const renderedChunksRef = useRef<TerrainChunkRenderData[]>([]);
  const initialTerrainStateRef = useRef<{
    chunks: TerrainChunkRenderData[];
    stats: TerrainRenderStats;
  } | null>(null);
  const lastFrustumVisibleChunkCountRef = useRef(0);

  const getFrustumVisibleChunkCount = (chunks: TerrainChunkRenderData[]) =>
    countFrustumVisibleTerrainChunks(
      chunks.map((chunk) => chunk.bounds),
      camera
    );

  if (initialTerrainStateRef.current === null) {
    const start = now();
    const next = createRenderedChunks(world.buildVisibleChunks(DEFAULT_CHUNK_SIZE));
    const frustumVisibleChunkCount = getFrustumVisibleChunkCount(next);
    renderedChunksRef.current = next;
    lastFrustumVisibleChunkCountRef.current = frustumVisibleChunkCount;
    initialTerrainStateRef.current = {
      chunks: next,
      stats: summarizeTerrainStats(next, now() - start, frustumVisibleChunkCount)
    };
  }

  const [renderedChunks, setRenderedChunks] = useState<TerrainChunkRenderData[]>(initialTerrainStateRef.current.chunks);
  const [terrainStats, setTerrainStats] = useState<TerrainRenderStats>(initialTerrainStateRef.current.stats);
  const mountedWorldRef = useRef(world);

  useEffect(() => {
    if (mountedWorldRef.current === world) {
      return;
    }

    mountedWorldRef.current = world;
    const start = now();
    const next = createRenderedChunks(world.buildVisibleChunks(DEFAULT_CHUNK_SIZE));
    const frustumVisibleChunkCount = getFrustumVisibleChunkCount(next);
    const current = renderedChunksRef.current;
    current.forEach(disposeRenderedChunk);
    renderedChunksRef.current = next;
    lastFrustumVisibleChunkCountRef.current = frustumVisibleChunkCount;
    setRenderedChunks(next);
    setTerrainStats(summarizeTerrainStats(next, now() - start, frustumVisibleChunkCount));
  }, [world]);

  useEffect(() => {
    if (dirtyChunkKeys.length === 0) {
      return;
    }

    const currentByKey = new Map(renderedChunksRef.current.map((chunk) => [chunk.key, chunk]));
    const start = now();
    const rebuiltChunks = createRenderedChunks(world.buildVisibleChunksForKeys(dirtyChunkKeys, DEFAULT_CHUNK_SIZE));
    const rebuiltByKey = new Map(rebuiltChunks.map((chunk) => [chunk.key, chunk]));

    for (const key of dirtyChunkKeys) {
      const existing = currentByKey.get(key);
      if (existing) {
        disposeRenderedChunk(existing);
      }

      const rebuilt = rebuiltByKey.get(key);
      if (rebuilt) {
        currentByKey.set(key, rebuilt);
      } else {
        currentByKey.delete(key);
      }
    }

    const next = [...currentByKey.values()].sort(sortRenderChunks);
    const frustumVisibleChunkCount = getFrustumVisibleChunkCount(next);
    renderedChunksRef.current = next;
    lastFrustumVisibleChunkCountRef.current = frustumVisibleChunkCount;
    setRenderedChunks(next);
    setTerrainStats(summarizeTerrainStats(next, now() - start, frustumVisibleChunkCount));
  }, [dirtyChunkKeys, revision, world]);

  useFrame(() => {
    const nextVisibleChunkCount = getFrustumVisibleChunkCount(renderedChunksRef.current);
    if (nextVisibleChunkCount === lastFrustumVisibleChunkCountRef.current) {
      return;
    }

    lastFrustumVisibleChunkCountRef.current = nextVisibleChunkCount;
    setTerrainStats((current) => {
      if (current.frustumVisibleChunkCount === nextVisibleChunkCount) {
        return current;
      }

      return {
        ...current,
        frustumVisibleChunkCount: nextVisibleChunkCount
      };
    });
  });

  useEffect(() => {
    onTerrainStatsChange?.(terrainStats);
  }, [onTerrainStatsChange, terrainStats]);

  useEffect(
    () => () => {
      renderedChunksRef.current.forEach(disposeRenderedChunk);
    },
    []
  );

  return (
    <group ref={ref}>
      {renderedChunks.map((chunk) => (
        <TerrainChunkMesh
          key={chunk.key}
          chunk={chunk}
          editable={editable}
          onInteract={onInteract}
        />
      ))}
    </group>
  );
});

function TerrainChunkMesh({
  chunk,
  editable,
  onInteract
}: {
  chunk: TerrainChunkRenderData;
  editable: boolean;
  onInteract?: (payload: VoxelInteractPayload) => void;
}) {
  const handlePointerDown = (event: ThreeEvent<PointerEvent>) => {
    if (!editable || !onInteract) {
      return;
    }

    const terrainHit = resolveTerrainRaycastHit(event.point, event.face?.normal);
    if (!terrainHit) {
      return;
    }

    event.stopPropagation();
    onInteract({
      voxel: terrainHit.voxel,
      normal: terrainHit.normal
    });
  };

  return (
    <mesh
      frustumCulled
      geometry={chunk.geometry}
      material={chunk.materials}
      onPointerDown={handlePointerDown}
      position={chunk.position}
      userData={{ isTerrainChunk: true }}
    />
  );
}

export function SpawnMarkers({ world }: { world: MutableVoxelWorld }) {
  return (
    <group>
      {world.listSpawns().map((spawn) => (
        <group
          key={spawn.id}
          position={[spawn.x, spawn.y, spawn.z]}
        >
          <mesh
            castShadow
            position={[0, 0.35, 0]}
          >
            <cylinderGeometry args={[0.18, 0.18, 0.7, 8]} />
            <meshStandardMaterial color="#f2eed1" />
          </mesh>
          <mesh position={[0, 0.8, 0]}>
            <boxGeometry args={[0.5, 0.16, 0.5]} />
            <meshStandardMaterial color="#2d3f4f" />
          </mesh>
        </group>
      ))}
    </group>
  );
}
