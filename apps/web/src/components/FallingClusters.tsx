import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { FallingClusterViewState, OutOfBoundsSimulation } from "@out-of-bounds/sim";
import { getFallingClusterVisualState } from "../game/fallingClusters";
import {
  getBlockRenderProfile,
  getVoxelMaterials,
  sharedVoxelGeometry,
  type BlockRenderProfile
} from "../game/voxelMaterials";

const tempObject = new THREE.Object3D();

const cloneProfileMaterials = (profile: BlockRenderProfile) =>
  getVoxelMaterials(profile).map((material) => {
    const clone = material.clone();
    if (clone instanceof THREE.MeshStandardMaterial) {
      clone.emissive = new THREE.Color("#f0db8a");
      clone.emissiveIntensity = 0;
    }
    return clone;
  }) as THREE.MeshStandardMaterial[];

export function FallingClustersLayer({ runtime }: { runtime: OutOfBoundsSimulation }) {
  const [clusters, setClusters] = useState(() => runtime.getFallingClusters());
  const clusterIdsRef = useRef(clusters.map((cluster) => cluster.id));

  useFrame(() => {
    const nextClusters = runtime.getFallingClusters();
    const nextIds = nextClusters.map((cluster) => cluster.id);
    if (
      nextIds.length === clusterIdsRef.current.length &&
      nextIds.every((id, index) => id === clusterIdsRef.current[index])
    ) {
      return;
    }

    clusterIdsRef.current = nextIds;
    setClusters(nextClusters);
  });

  return (
    <group>
      {clusters.map((cluster) => (
        <FallingClusterMesh
          key={cluster.id}
          runtime={runtime}
          initialCluster={cluster}
        />
      ))}
    </group>
  );
}

function FallingClusterMesh({
  runtime,
  initialCluster
}: {
  runtime: OutOfBoundsSimulation;
  initialCluster: FallingClusterViewState;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const materialSets = useMemo(
    () => ({
      earthSurface: cloneProfileMaterials("earthSurface"),
      earthSubsoil: cloneProfileMaterials("earthSubsoil"),
      darkness: cloneProfileMaterials("darkness")
    }),
    []
  );

  const profileGroups = useMemo(() => {
    const groups = new Map<BlockRenderProfile, typeof initialCluster.voxels>();

    for (const voxel of initialCluster.voxels) {
      const profile = getBlockRenderProfile(voxel.kind, voxel.y);
      const group = groups.get(profile) ?? [];
      group.push(voxel);
      groups.set(profile, group);
    }

    return [...groups.entries()].map(([profile, voxels]) => ({
      profile,
      voxels
    }));
  }, [initialCluster.voxels]);

  useEffect(() => {
    return () => {
      for (const material of [...materialSets.earthSurface, ...materialSets.earthSubsoil, ...materialSets.darkness]) {
        material.dispose();
      }
    };
  }, [materialSets]);

  useFrame((state) => {
    const cluster = runtime.getFallingClusterState(initialCluster.id);
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

    for (const material of [...materialSets.earthSurface, ...materialSets.earthSubsoil, ...materialSets.darkness]) {
      material.emissiveIntensity = visualState.emissiveIntensity;
    }
  });

  return (
    <group ref={groupRef}>
      {profileGroups.map((group) => (
        <FallingClusterProfileMesh
          key={`${initialCluster.id}-${group.profile}`}
          profile={group.profile}
          voxels={group.voxels}
          materials={materialSets[group.profile]}
        />
      ))}
    </group>
  );
}

function FallingClusterProfileMesh({
  profile,
  voxels,
  materials
}: {
  profile: BlockRenderProfile;
  voxels: FallingClusterViewState["voxels"];
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

    mesh.instanceMatrix.needsUpdate = true;
  }, [voxels]);

  return (
    <instancedMesh
      ref={meshRef}
      args={[sharedVoxelGeometry, materials, voxels.length]}
      userData={{ profile }}
    />
  );
}
