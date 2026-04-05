import { useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { RuntimeFallingClusterState, OutOfBoundsSimulation } from "@out-of-bounds/sim";
import { getFallingClusterVisualState } from "../game/fallingClusters";
import {
  fallingClusterMaterialsByProfile,
  fallingClusterSharedMaterials
} from "../game/sceneAssets";
import { finalizeStaticInstancedMesh } from "../game/instancedMeshes";
import {
  getBlockRenderProfile,
  sharedVoxelGeometry,
  type BlockRenderProfile
} from "../game/voxelMaterials";
import { useVersionedRuntimeCollectionIds } from "../hooks/useVersionedRuntimeCollection";

const tempObject = new THREE.Object3D();

export function FallingClustersLayer({ runtime }: { runtime: OutOfBoundsSimulation }) {
  const clusterIds = useVersionedRuntimeCollectionIds({
    getIds: () => runtime.getFallingClusterIds(),
    getVersion: () => runtime.getFallingClusterCollectionVersion()
  });

  useFrame((state) => {
    let emissiveIntensity = 0;

    for (const clusterId of clusterIds) {
      const cluster = runtime.getFallingClusterRuntimeState(clusterId);
      if (!cluster || cluster.phase !== "warning") {
        continue;
      }

      emissiveIntensity = Math.max(
        emissiveIntensity,
        getFallingClusterVisualState(cluster, state.clock.elapsedTime).emissiveIntensity
      );
    }

    for (const material of fallingClusterSharedMaterials) {
      material.emissiveIntensity = emissiveIntensity;
    }
  });

  return (
    <group>
      {clusterIds.map((clusterId) => (
        <FallingClusterMesh
          clusterId={clusterId}
          key={clusterId}
          runtime={runtime}
        />
      ))}
    </group>
  );
}

function FallingClusterMesh({
  runtime,
  clusterId
}: {
  runtime: OutOfBoundsSimulation;
  clusterId: string;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const profileGroups = useMemo(() => {
    const cluster = runtime.getFallingClusterRuntimeState(clusterId);
    const groups = new Map<BlockRenderProfile, RuntimeFallingClusterState["voxels"]>();
    if (!cluster) {
      return [];
    }

    for (const voxel of cluster.voxels) {
      const profile = getBlockRenderProfile(voxel.kind, voxel.y);
      const group = groups.get(profile) ?? [];
      group.push(voxel);
      groups.set(profile, group);
    }

    return [...groups.entries()].map(([profile, voxels]) => ({
      profile,
      voxels
    }));
  }, [clusterId, runtime]);

  useFrame((state) => {
    const cluster = runtime.getFallingClusterRuntimeState(clusterId);
    const group = groupRef.current;
    if (!group) {
      return;
    }

    group.visible = cluster !== null;
    if (!cluster) {
      return;
    }

    const visualState = getFallingClusterVisualState(cluster, state.clock.elapsedTime);
    group.position.set(visualState.shakeX, cluster.offsetY, visualState.shakeZ);
  });

  return (
    <group ref={groupRef}>
      {profileGroups.map((group) => (
        <FallingClusterProfileMesh
          key={`${clusterId}-${group.profile}`}
          materials={fallingClusterMaterialsByProfile[group.profile]}
          voxels={group.voxels}
        />
      ))}
    </group>
  );
}

function FallingClusterProfileMesh({
  voxels,
  materials
}: {
  voxels: RuntimeFallingClusterState["voxels"];
  materials: THREE.MeshStandardMaterial[];
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) {
      return;
    }

    mesh.count = voxels.length;
    for (let index = 0; index < voxels.length; index += 1) {
      const voxel = voxels[index]!;
      tempObject.position.set(voxel.x + 0.5, voxel.y + 0.5, voxel.z + 0.5);
      tempObject.updateMatrix();
      mesh.setMatrixAt(index, tempObject.matrix);
    }

    finalizeStaticInstancedMesh(mesh, voxels.length);
  }, [voxels]);

  return (
    <instancedMesh
      ref={meshRef}
      args={[sharedVoxelGeometry, materials, Math.max(1, voxels.length)]}
      matrixAutoUpdate={false}
    />
  );
}
