import { forwardRef, startTransition, useEffect, useRef, useState } from "react";
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

interface DirtyChunkDrainResult<T> {
  elapsedMs: number;
  nextByKey: Map<string, T>;
  processedKeys: string[];
  remainingKeys: Set<string>;
}

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
export const MAX_DIRTY_CHUNKS_PER_FRAME = 4;
export const DIRTY_CHUNK_REBUILD_BUDGET_MS = 3;

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

export const enqueueDirtyChunkKeys = (queue: Set<string>, keys: Iterable<string>) => {
  for (const key of keys) {
    if (key) {
      queue.add(key);
    }
  }

  return queue;
};

export const drainDirtyChunkBuildQueue = <T,>({
  currentByKey,
  pendingKeys,
  rebuildChunk,
  disposeChunk,
  maxChunkCount,
  maxRebuildMs,
  getNow = now
}: {
  currentByKey: ReadonlyMap<string, T>;
  pendingKeys: Iterable<string>;
  rebuildChunk: (key: string) => T | null;
  disposeChunk: (chunk: T) => void;
  maxChunkCount: number;
  maxRebuildMs: number;
  getNow?: () => number;
}): DirtyChunkDrainResult<T> => {
  const frameStart = getNow();
  const nextByKey = new Map(currentByKey);
  const remainingKeys = new Set(pendingKeys);
  const processedKeys: string[] = [];

  while (remainingKeys.size > 0 && processedKeys.length < maxChunkCount) {
    const nextKey = remainingKeys.values().next().value as string | undefined;
    if (!nextKey) {
      break;
    }

    remainingKeys.delete(nextKey);
    const existing = nextByKey.get(nextKey);
    if (existing) {
      disposeChunk(existing);
    }

    const rebuiltChunk = rebuildChunk(nextKey);
    if (rebuiltChunk) {
      nextByKey.set(nextKey, rebuiltChunk);
    } else {
      nextByKey.delete(nextKey);
    }

    processedKeys.push(nextKey);
    if (processedKeys.length >= maxChunkCount || getNow() - frameStart >= maxRebuildMs) {
      break;
    }
  }

  return {
    elapsedMs: getNow() - frameStart,
    nextByKey,
    processedKeys,
    remainingKeys
  };
};

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
  const renderedChunkMapRef = useRef<Map<string, TerrainChunkRenderData>>(new Map());
  const initialTerrainStateRef = useRef<{
    chunks: TerrainChunkRenderData[];
    stats: TerrainRenderStats;
  } | null>(null);
  const pendingDirtyChunkKeysRef = useRef<Set<string>>(new Set());
  const lastFrustumVisibleChunkCountRef = useRef(0);
  const terrainStatsRef = useRef<TerrainRenderStats | null>(null);
  const statsUpdateCooldownRef = useRef(0);

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
    renderedChunkMapRef.current = new Map(next.map((chunk) => [chunk.key, chunk]));
    lastFrustumVisibleChunkCountRef.current = frustumVisibleChunkCount;
    initialTerrainStateRef.current = {
      chunks: next,
      stats: summarizeTerrainStats(next, now() - start, frustumVisibleChunkCount)
    };
  }

  const [renderedChunks, setRenderedChunks] = useState<TerrainChunkRenderData[]>(initialTerrainStateRef.current.chunks);
  const mountedWorldRef = useRef(world);
  terrainStatsRef.current ??= initialTerrainStateRef.current.stats;

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
    renderedChunkMapRef.current = new Map(next.map((chunk) => [chunk.key, chunk]));
    pendingDirtyChunkKeysRef.current.clear();
    lastFrustumVisibleChunkCountRef.current = frustumVisibleChunkCount;
    terrainStatsRef.current = summarizeTerrainStats(next, now() - start, frustumVisibleChunkCount);
    setRenderedChunks(next);
    if (import.meta.env.DEV) {
      onTerrainStatsChange?.(terrainStatsRef.current);
    }
  }, [world]);

  useEffect(() => {
    if (dirtyChunkKeys.length === 0) {
      return;
    }

    enqueueDirtyChunkKeys(pendingDirtyChunkKeysRef.current, dirtyChunkKeys);
  }, [dirtyChunkKeys]);

  useFrame(() => {
    if (pendingDirtyChunkKeysRef.current.size === 0) {
      return;
    }

    const drainResult = drainDirtyChunkBuildQueue({
      currentByKey: renderedChunkMapRef.current,
      pendingKeys: pendingDirtyChunkKeysRef.current,
      rebuildChunk: (key) => {
        const rebuiltChunk = world.buildVisibleChunkByKey(key, DEFAULT_CHUNK_SIZE);
        return rebuiltChunk ? createRenderedChunk(rebuiltChunk) : null;
      },
      disposeChunk: disposeRenderedChunk,
      maxChunkCount: MAX_DIRTY_CHUNKS_PER_FRAME,
      maxRebuildMs: DIRTY_CHUNK_REBUILD_BUDGET_MS
    });

    if (drainResult.processedKeys.length === 0) {
      return;
    }

    pendingDirtyChunkKeysRef.current = drainResult.remainingKeys;
    const next = [...drainResult.nextByKey.values()].sort(sortRenderChunks);
    const frustumVisibleChunkCount = getFrustumVisibleChunkCount(next);
    renderedChunksRef.current = next;
    renderedChunkMapRef.current = drainResult.nextByKey;
    lastFrustumVisibleChunkCountRef.current = frustumVisibleChunkCount;
    terrainStatsRef.current = summarizeTerrainStats(next, drainResult.elapsedMs, frustumVisibleChunkCount);
    startTransition(() => {
      setRenderedChunks(next);
    });
    if (import.meta.env.DEV && terrainStatsRef.current) {
      onTerrainStatsChange?.(terrainStatsRef.current);
    }
  });

  useFrame((_, delta) => {
    if (!import.meta.env.DEV || !onTerrainStatsChange) {
      return;
    }

    statsUpdateCooldownRef.current += delta;
    if (statsUpdateCooldownRef.current < 1) {
      return;
    }

    statsUpdateCooldownRef.current = 0;
    const nextVisibleChunkCount = getFrustumVisibleChunkCount(renderedChunksRef.current);
    if (nextVisibleChunkCount === lastFrustumVisibleChunkCountRef.current) {
      return;
    }

    lastFrustumVisibleChunkCountRef.current = nextVisibleChunkCount;
    const currentStats = terrainStatsRef.current;
    if (!currentStats) {
      return;
    }

    terrainStatsRef.current = {
      ...currentStats,
      frustumVisibleChunkCount: nextVisibleChunkCount
    };
    onTerrainStatsChange(terrainStatsRef.current);
  });

  useEffect(() => {
    if (!import.meta.env.DEV) {
      return;
    }

    if (terrainStatsRef.current) {
      onTerrainStatsChange?.(terrainStatsRef.current);
    }
  }, [onTerrainStatsChange]);

  useEffect(
    () => () => {
      pendingDirtyChunkKeysRef.current.clear();
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
