import { useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { OutOfBoundsSimulation } from "@out-of-bounds/sim";
import {
  eggVisualDefaults,
  getEggScatterDebrisPosition,
  getEggVisualState
} from "../game/eggs";
import { configureDynamicInstancedMesh, finalizeDynamicInstancedMesh } from "../game/instancedMeshes";
import {
  getBlockRenderProfile,
  getVoxelMaterials,
  sharedVoxelGeometry,
  type BlockRenderProfile
} from "../game/voxelMaterials";

const eggGeometry = new THREE.SphereGeometry(
  eggVisualDefaults.radius,
  eggVisualDefaults.widthSegments,
  eggVisualDefaults.heightSegments
);
const tempObject = new THREE.Object3D();

export function EggsLayer({ runtime }: { runtime: OutOfBoundsSimulation }) {
  const eggSlotCount = Math.max(1, runtime.getPlayerIds().length * runtime.config.maxActiveEggsPerPlayer);
  const meshRefs = useRef<Array<THREE.Mesh | null>>([]);
  const materialRefs = useRef<Array<THREE.MeshStandardMaterial | null>>([]);
  const coolColor = useMemo(() => new THREE.Color(eggVisualDefaults.coolColor), []);
  const hotColor = useMemo(() => new THREE.Color(eggVisualDefaults.hotColor), []);
  const mixedColor = useMemo(() => new THREE.Color(eggVisualDefaults.coolColor), []);

  useFrame((state) => {
    const eggIds = runtime.getEggIds();

    for (let slotIndex = 0; slotIndex < eggSlotCount; slotIndex += 1) {
      const mesh = meshRefs.current[slotIndex];
      const material = materialRefs.current[slotIndex];
      if (!mesh || !material) {
        continue;
      }

      const eggId = eggIds[slotIndex];
      if (!eggId) {
        mesh.visible = false;
        continue;
      }

      const egg = runtime.getEggRuntimeState(eggId);
      if (!egg) {
        mesh.visible = false;
        continue;
      }

      mesh.visible = true;
      const visualState = getEggVisualState(egg, state.clock.elapsedTime, runtime.config.eggFuseDuration);
      mesh.position.set(egg.position.x, egg.position.y + visualState.jiggleY, egg.position.z);
      mesh.scale.set(visualState.scaleX, visualState.scaleY, visualState.scaleZ);
      mixedColor.lerpColors(coolColor, hotColor, visualState.heatAlpha);
      material.color.copy(mixedColor);
      material.emissive.copy(hotColor);
      material.emissiveIntensity = visualState.emissiveIntensity;
    }
  });

  return (
    <group>
      {Array.from({ length: eggSlotCount }, (_, slotIndex) => (
        <mesh
          key={`egg-slot-${slotIndex}`}
          ref={(node) => {
            meshRefs.current[slotIndex] = node;
          }}
          visible={false}
        >
          <primitive object={eggGeometry} attach="geometry" />
          <meshStandardMaterial
            ref={(node) => {
              materialRefs.current[slotIndex] = node;
            }}
            color={eggVisualDefaults.coolColor}
            emissive={eggVisualDefaults.hotColor}
            emissiveIntensity={eggVisualDefaults.emissiveMin}
          />
        </mesh>
      ))}
    </group>
  );
}

const createProfileMaterialBuckets = () =>
  ({
    earthSurface: getVoxelMaterials("earthSurface"),
    earthSubsoil: getVoxelMaterials("earthSubsoil"),
    darkness: getVoxelMaterials("darkness")
  }) satisfies Record<BlockRenderProfile, THREE.Material[]>;

export function EggScatterDebrisLayer({
  runtime,
  maxInstances = 96
}: {
  runtime: OutOfBoundsSimulation;
  maxInstances?: number;
}) {
  const surfaceMeshRef = useRef<THREE.InstancedMesh>(null);
  const subsoilMeshRef = useRef<THREE.InstancedMesh>(null);
  const darknessMeshRef = useRef<THREE.InstancedMesh>(null);
  const materialBuckets = useMemo(() => createProfileMaterialBuckets(), []);

  useLayoutEffect(() => {
    configureDynamicInstancedMesh(surfaceMeshRef.current);
    configureDynamicInstancedMesh(subsoilMeshRef.current);
    configureDynamicInstancedMesh(darknessMeshRef.current);
  }, []);

  useFrame(() => {
    const debrisIds = runtime.getEggScatterDebrisIds();
    let earthSurfaceCount = 0;
    let earthSubsoilCount = 0;
    let darknessCount = 0;

    for (let slotIndex = 0; slotIndex < debrisIds.length && slotIndex < maxInstances; slotIndex += 1) {
      const debrisId = debrisIds[slotIndex];
      if (!debrisId) {
        continue;
      }

      const debris = runtime.getEggScatterDebrisRuntimeState(debrisId);
      if (!debris) {
        continue;
      }

      const position = getEggScatterDebrisPosition(debris, runtime.config.eggScatterArcHeight);
      tempObject.position.set(position.x, position.y, position.z);
      tempObject.scale.setScalar(1);
      tempObject.rotation.set(0, 0, 0);
      tempObject.updateMatrix();

      const profile = getBlockRenderProfile(debris.kind, Math.floor(debris.origin.y));
      if (profile === "earthSurface" && surfaceMeshRef.current) {
        surfaceMeshRef.current.setMatrixAt(earthSurfaceCount, tempObject.matrix);
        earthSurfaceCount += 1;
      } else if (profile === "earthSubsoil" && subsoilMeshRef.current) {
        subsoilMeshRef.current.setMatrixAt(earthSubsoilCount, tempObject.matrix);
        earthSubsoilCount += 1;
      } else if (darknessMeshRef.current) {
        darknessMeshRef.current.setMatrixAt(darknessCount, tempObject.matrix);
        darknessCount += 1;
      }
    }

    finalizeDynamicInstancedMesh(surfaceMeshRef.current, earthSurfaceCount);
    finalizeDynamicInstancedMesh(subsoilMeshRef.current, earthSubsoilCount);
    finalizeDynamicInstancedMesh(darknessMeshRef.current, darknessCount);
  });

  return (
    <group>
      <instancedMesh
        ref={surfaceMeshRef}
        args={[sharedVoxelGeometry, materialBuckets.earthSurface, Math.max(1, maxInstances)]}
        matrixAutoUpdate={false}
      />
      <instancedMesh
        ref={subsoilMeshRef}
        args={[sharedVoxelGeometry, materialBuckets.earthSubsoil, Math.max(1, maxInstances)]}
        matrixAutoUpdate={false}
      />
      <instancedMesh
        ref={darknessMeshRef}
        args={[sharedVoxelGeometry, materialBuckets.darkness, Math.max(1, maxInstances)]}
        matrixAutoUpdate={false}
      />
    </group>
  );
}
