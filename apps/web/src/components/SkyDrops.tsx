import { useLayoutEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { OutOfBoundsSimulation } from "@out-of-bounds/sim";
import { getSkyDropLandingShadowState } from "../game/cheapShadows";
import { configureDynamicInstancedMesh, finalizeDynamicInstancedMesh } from "../game/instancedMeshes";
import {
  skyDropShadowGeometry,
  skyDropWarningBeamGeometry,
  skyDropWarningRingGeometry
} from "../game/sceneAssets";
import { getSkyDropVisualState } from "../game/skyDrops";
import { getBlockRenderProfile, getVoxelMaterials, sharedVoxelGeometry } from "../game/voxelMaterials";

const tempObject = new THREE.Object3D();

const hideSkyDropSlot = (
  ring: THREE.Mesh | null | undefined,
  beam: THREE.Mesh | null | undefined,
  shadow: THREE.Mesh | null | undefined
) => {
  if (ring) {
    ring.visible = false;
  }
  if (beam) {
    beam.visible = false;
  }
  if (shadow) {
    shadow.visible = false;
  }
};

export function SkyDropsLayer({ runtime }: { runtime: OutOfBoundsSimulation }) {
  const slotCount = Math.max(1, runtime.config.maxActiveSkyDrops);
  const warningRingRefs = useRef<Array<THREE.Mesh | null>>([]);
  const warningBeamRefs = useRef<Array<THREE.Mesh | null>>([]);
  const landingShadowRefs = useRef<Array<THREE.Mesh | null>>([]);
  const warningRingMaterialRefs = useRef<Array<THREE.MeshBasicMaterial | null>>([]);
  const warningBeamMaterialRefs = useRef<Array<THREE.MeshBasicMaterial | null>>([]);
  const landingShadowMaterialRefs = useRef<Array<THREE.MeshBasicMaterial | null>>([]);
  const earthSurfaceCubeRef = useRef<THREE.InstancedMesh>(null);
  const earthSubsoilCubeRef = useRef<THREE.InstancedMesh>(null);
  const darknessCubeRef = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    configureDynamicInstancedMesh(earthSurfaceCubeRef.current);
    configureDynamicInstancedMesh(earthSubsoilCubeRef.current);
    configureDynamicInstancedMesh(darknessCubeRef.current);
  }, []);

  useFrame((state) => {
    const skyDropIds = runtime.getSkyDropIds();
    let earthSurfaceCount = 0;
    let earthSubsoilCount = 0;
    let darknessCount = 0;

    for (let slotIndex = 0; slotIndex < slotCount; slotIndex += 1) {
      const ring = warningRingRefs.current[slotIndex];
      const beam = warningBeamRefs.current[slotIndex];
      const shadow = landingShadowRefs.current[slotIndex];
      const ringMaterial = warningRingMaterialRefs.current[slotIndex];
      const beamMaterial = warningBeamMaterialRefs.current[slotIndex];
      const shadowMaterial = landingShadowMaterialRefs.current[slotIndex];
      const skyDropId = skyDropIds[slotIndex];

      if (!ring || !beam || !shadow || !ringMaterial || !beamMaterial || !shadowMaterial || !skyDropId) {
        hideSkyDropSlot(ring, beam, shadow);
        continue;
      }

      const skyDrop = runtime.getSkyDropRuntimeState(skyDropId);
      if (!skyDrop) {
        hideSkyDropSlot(ring, beam, shadow);
        continue;
      }

      const visualState = getSkyDropVisualState(skyDrop, state.clock.elapsedTime);
      ring.visible = visualState.warningVisible;
      beam.visible = visualState.warningVisible;
      ring.position.set(
        skyDrop.landingVoxel.x + 0.5,
        skyDrop.landingVoxel.y + 0.08,
        skyDrop.landingVoxel.z + 0.5
      );
      ring.scale.setScalar(visualState.warningScale);
      beam.position.set(
        skyDrop.landingVoxel.x + 0.5,
        skyDrop.landingVoxel.y + 0.8,
        skyDrop.landingVoxel.z + 0.5
      );
      beam.scale.y = 0.9 + visualState.warningScale * 0.45;
      ringMaterial.opacity = visualState.warningOpacity;
      beamMaterial.opacity = visualState.warningOpacity * 0.4;

      const landingShadowState = getSkyDropLandingShadowState({
        phase: skyDrop.phase,
        warningOpacity: visualState.warningOpacity,
        warningScale: visualState.warningScale
      });
      shadow.visible = landingShadowState.opacity > 0;
      shadow.position.set(
        skyDrop.landingVoxel.x + 0.5,
        skyDrop.landingVoxel.y + 0.04,
        skyDrop.landingVoxel.z + 0.5
      );
      shadow.scale.setScalar(landingShadowState.scale);
      shadowMaterial.opacity = landingShadowState.opacity;

      if (skyDrop.phase !== "falling") {
        continue;
      }

      tempObject.position.set(
        skyDrop.landingVoxel.x + 0.5,
        skyDrop.landingVoxel.y + 0.5 + skyDrop.offsetY,
        skyDrop.landingVoxel.z + 0.5
      );
      tempObject.rotation.set(0, 0, 0);
      tempObject.scale.setScalar(1);
      tempObject.updateMatrix();

      const profile = getBlockRenderProfile("ground", skyDrop.landingVoxel.y);
      if (profile === "earthSurface" && earthSurfaceCubeRef.current) {
        earthSurfaceCubeRef.current.setMatrixAt(earthSurfaceCount, tempObject.matrix);
        earthSurfaceCount += 1;
      } else if (profile === "earthSubsoil" && earthSubsoilCubeRef.current) {
        earthSubsoilCubeRef.current.setMatrixAt(earthSubsoilCount, tempObject.matrix);
        earthSubsoilCount += 1;
      } else if (darknessCubeRef.current) {
        darknessCubeRef.current.setMatrixAt(darknessCount, tempObject.matrix);
        darknessCount += 1;
      }
    }

    finalizeDynamicInstancedMesh(earthSurfaceCubeRef.current, earthSurfaceCount);
    finalizeDynamicInstancedMesh(earthSubsoilCubeRef.current, earthSubsoilCount);
    finalizeDynamicInstancedMesh(darknessCubeRef.current, darknessCount);
  });

  return (
    <group>
      {Array.from({ length: slotCount }, (_, slotIndex) => (
        <group key={`sky-drop-slot-${slotIndex}`}>
          <mesh
            geometry={skyDropWarningRingGeometry}
            ref={(node) => {
              warningRingRefs.current[slotIndex] = node;
            }}
            rotation={[-Math.PI / 2, 0, 0]}
            visible={false}
          >
            <meshBasicMaterial
              ref={(node) => {
                warningRingMaterialRefs.current[slotIndex] = node;
              }}
              color="#fff4c6"
              opacity={0.5}
              transparent
            />
          </mesh>
          <mesh
            geometry={skyDropWarningBeamGeometry}
            ref={(node) => {
              warningBeamRefs.current[slotIndex] = node;
            }}
            visible={false}
          >
            <meshBasicMaterial
              ref={(node) => {
                warningBeamMaterialRefs.current[slotIndex] = node;
              }}
              color="#fff8df"
              opacity={0.2}
              transparent
            />
          </mesh>
          <mesh
            geometry={skyDropShadowGeometry}
            ref={(node) => {
              landingShadowRefs.current[slotIndex] = node;
            }}
            rotation={[-Math.PI / 2, 0, 0]}
            visible={false}
          >
            <meshBasicMaterial
              ref={(node) => {
                landingShadowMaterialRefs.current[slotIndex] = node;
              }}
              color="#000000"
              depthWrite={false}
              opacity={0.14}
              toneMapped={false}
              transparent
            />
          </mesh>
        </group>
      ))}
      <instancedMesh
        ref={earthSurfaceCubeRef}
        args={[sharedVoxelGeometry, getVoxelMaterials("earthSurface"), slotCount]}
        matrixAutoUpdate={false}
      />
      <instancedMesh
        ref={earthSubsoilCubeRef}
        args={[sharedVoxelGeometry, getVoxelMaterials("earthSubsoil"), slotCount]}
        matrixAutoUpdate={false}
      />
      <instancedMesh
        ref={darknessCubeRef}
        args={[sharedVoxelGeometry, getVoxelMaterials("darkness"), slotCount]}
        matrixAutoUpdate={false}
      />
    </group>
  );
}
