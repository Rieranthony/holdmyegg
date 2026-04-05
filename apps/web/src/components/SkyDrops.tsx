import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { OutOfBoundsSimulation, SkyDropViewState } from "@out-of-bounds/sim";
import { getSkyDropLandingShadowState } from "../game/cheapShadows";
import { getSkyDropVisualState } from "../game/skyDrops";
import { getBlockRenderProfile, getVoxelMaterials, sharedVoxelGeometry } from "../game/voxelMaterials";

const tempObject = new THREE.Object3D();

export function SkyDropsLayer({ runtime }: { runtime: OutOfBoundsSimulation }) {
  const [skyDrops, setSkyDrops] = useState(() => runtime.getSkyDrops());
  const skyDropIdsRef = useRef(skyDrops.map((skyDrop) => skyDrop.id));

  useFrame(() => {
    const nextSkyDrops = runtime.getSkyDrops();
    const nextIds = nextSkyDrops.map((skyDrop) => skyDrop.id);
    if (
      nextIds.length === skyDropIdsRef.current.length &&
      nextIds.every((id, index) => id === skyDropIdsRef.current[index])
    ) {
      return;
    }

    skyDropIdsRef.current = nextIds;
    setSkyDrops(nextSkyDrops);
  });

  return (
    <group>
      {skyDrops.map((skyDrop) => (
        <SkyDropEntity
          key={skyDrop.id}
          runtime={runtime}
          initialSkyDrop={skyDrop}
        />
      ))}
    </group>
  );
}

function SkyDropEntity({
  runtime,
  initialSkyDrop
}: {
  runtime: OutOfBoundsSimulation;
  initialSkyDrop: SkyDropViewState;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const warningRingRef = useRef<THREE.Mesh>(null);
  const warningBeamRef = useRef<THREE.Mesh>(null);
  const landingShadowRef = useRef<THREE.Mesh>(null);
  const cubeRef = useRef<THREE.InstancedMesh>(null);
  const cubeMaterials = useMemo(
    () =>
      getVoxelMaterials(getBlockRenderProfile("ground", initialSkyDrop.landingVoxel.y)).map((material) =>
        material.clone()
      ) as THREE.MeshStandardMaterial[],
    [initialSkyDrop.landingVoxel.y]
  );

  useEffect(() => {
    return () => {
      for (const material of cubeMaterials) {
        material.dispose();
      }
    };
  }, [cubeMaterials]);

  useLayoutEffect(() => {
    const cube = cubeRef.current;
    if (!cube) {
      return;
    }

    tempObject.position.set(
      initialSkyDrop.landingVoxel.x + 0.5,
      initialSkyDrop.landingVoxel.y + 0.5,
      initialSkyDrop.landingVoxel.z + 0.5
    );
    tempObject.updateMatrix();
    cube.setMatrixAt(0, tempObject.matrix);
    cube.instanceMatrix.needsUpdate = true;
  }, [initialSkyDrop.landingVoxel.x, initialSkyDrop.landingVoxel.y, initialSkyDrop.landingVoxel.z]);

  useFrame((state) => {
    const skyDrop = runtime.getSkyDropState(initialSkyDrop.id);
    const group = groupRef.current;
    const warningRing = warningRingRef.current;
    const warningBeam = warningBeamRef.current;
    const landingShadow = landingShadowRef.current;
    const cube = cubeRef.current;
    if (!group || !warningRing || !warningBeam || !landingShadow || !cube) {
      return;
    }

    group.visible = skyDrop !== null;
    if (!skyDrop) {
      return;
    }

    const visualState = getSkyDropVisualState(skyDrop, state.clock.elapsedTime);
    warningRing.visible = visualState.warningVisible;
    warningBeam.visible = visualState.warningVisible;
    warningRing.position.set(
      skyDrop.landingVoxel.x + 0.5,
      skyDrop.landingVoxel.y + 0.08,
      skyDrop.landingVoxel.z + 0.5
    );
    warningRing.scale.setScalar(visualState.warningScale);
    warningBeam.position.set(
      skyDrop.landingVoxel.x + 0.5,
      skyDrop.landingVoxel.y + 0.8,
      skyDrop.landingVoxel.z + 0.5
    );
    warningBeam.scale.y = 0.9 + visualState.warningScale * 0.45;

    const ringMaterial = warningRing.material as THREE.MeshBasicMaterial;
    ringMaterial.opacity = visualState.warningOpacity;
    const beamMaterial = warningBeam.material as THREE.MeshBasicMaterial;
    beamMaterial.opacity = visualState.warningOpacity * 0.4;
    const landingShadowState = getSkyDropLandingShadowState({
      phase: skyDrop.phase,
      warningOpacity: visualState.warningOpacity,
      warningScale: visualState.warningScale
    });

    landingShadow.position.set(
      skyDrop.landingVoxel.x + 0.5,
      skyDrop.landingVoxel.y + 0.04,
      skyDrop.landingVoxel.z + 0.5
    );
    landingShadow.scale.setScalar(landingShadowState.scale);
    (landingShadow.material as THREE.MeshBasicMaterial).opacity = landingShadowState.opacity;

    cube.visible = skyDrop.phase === "falling";
    cube.position.set(0, skyDrop.offsetY, 0);
  });

  return (
    <group ref={groupRef}>
      <mesh
        ref={warningRingRef}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <torusGeometry args={[0.48, 0.06, 10, 24]} />
        <meshBasicMaterial
          color="#fff4c6"
          transparent
          opacity={0.5}
        />
      </mesh>
      <mesh ref={warningBeamRef}>
        <cylinderGeometry args={[0.12, 0.24, 1.8, 10, 1, true]} />
        <meshBasicMaterial
          color="#fff8df"
          transparent
          opacity={0.2}
        />
      </mesh>
      <mesh
        ref={landingShadowRef}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <circleGeometry args={[0.56, 20]} />
        <meshBasicMaterial
          color="#000000"
          transparent
          opacity={0.14}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <instancedMesh
        ref={cubeRef}
        args={[sharedVoxelGeometry, cubeMaterials, 1]}
      />
    </group>
  );
}
