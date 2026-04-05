import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { EggScatterDebrisViewState, EggViewState, OutOfBoundsSimulation } from "@out-of-bounds/sim";
import {
  eggVisualDefaults,
  getEggScatterDebrisPosition,
  getEggVisualState
} from "../game/eggs";
import {
  getBlockRenderProfile,
  getVoxelMaterials,
  sharedVoxelGeometry
} from "../game/voxelMaterials";

export function EggsLayer({ runtime }: { runtime: OutOfBoundsSimulation }) {
  const [eggs, setEggs] = useState(() => runtime.getEggs());
  const eggIdsRef = useRef(eggs.map((egg) => egg.id));

  useFrame(() => {
    const nextEggs = runtime.getEggs();
    const nextIds = nextEggs.map((egg) => egg.id);
    if (
      nextIds.length === eggIdsRef.current.length &&
      nextIds.every((id, index) => id === eggIdsRef.current[index])
    ) {
      return;
    }

    eggIdsRef.current = nextIds;
    setEggs(nextEggs);
  });

  return (
    <group>
      {eggs.map((egg) => (
        <EggEntity
          key={egg.id}
          runtime={runtime}
          initialEgg={egg}
        />
      ))}
    </group>
  );
}

function EggEntity({
  runtime,
  initialEgg
}: {
  runtime: OutOfBoundsSimulation;
  initialEgg: EggViewState;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);
  const coolColor = useMemo(() => new THREE.Color(eggVisualDefaults.coolColor), []);
  const hotColor = useMemo(() => new THREE.Color(eggVisualDefaults.hotColor), []);
  const mixedColor = useMemo(() => new THREE.Color(eggVisualDefaults.coolColor), []);

  useFrame((state) => {
    const egg = runtime.getEggState(initialEgg.id);
    const mesh = meshRef.current;
    const material = materialRef.current;
    if (!egg || !mesh || !material) {
      if (mesh) {
        mesh.visible = false;
      }
      return;
    }

    mesh.visible = true;
    const visualState = getEggVisualState(egg, state.clock.elapsedTime, runtime.config.eggFuseDuration);
    mesh.position.set(egg.position.x, egg.position.y + visualState.jiggleY, egg.position.z);
    mesh.scale.set(visualState.scaleX, visualState.scaleY, visualState.scaleZ);
    mixedColor.lerpColors(coolColor, hotColor, visualState.heatAlpha);
    material.color.copy(mixedColor);
    material.emissive.copy(hotColor);
    material.emissiveIntensity = visualState.emissiveIntensity;
  });

  return (
    <mesh ref={meshRef}>
      <sphereGeometry
        args={[
          eggVisualDefaults.radius,
          eggVisualDefaults.widthSegments,
          eggVisualDefaults.heightSegments
        ]}
      />
      <meshStandardMaterial
        ref={materialRef}
        color={eggVisualDefaults.coolColor}
        emissive={eggVisualDefaults.hotColor}
        emissiveIntensity={eggVisualDefaults.emissiveMin}
      />
    </mesh>
  );
}

export function EggScatterDebrisLayer({ runtime }: { runtime: OutOfBoundsSimulation }) {
  const [debris, setDebris] = useState(() => runtime.getEggScatterDebris());
  const debrisIdsRef = useRef(debris.map((entry) => entry.id));

  useFrame(() => {
    const nextDebris = runtime.getEggScatterDebris();
    const nextIds = nextDebris.map((entry) => entry.id);
    if (
      nextIds.length === debrisIdsRef.current.length &&
      nextIds.every((id, index) => id === debrisIdsRef.current[index])
    ) {
      return;
    }

    debrisIdsRef.current = nextIds;
    setDebris(nextDebris);
  });

  return (
    <group>
      {debris.map((entry) => (
        <EggScatterDebrisEntity
          key={entry.id}
          runtime={runtime}
          initialDebris={entry}
        />
      ))}
    </group>
  );
}

function EggScatterDebrisEntity({
  runtime,
  initialDebris
}: {
  runtime: OutOfBoundsSimulation;
  initialDebris: EggScatterDebrisViewState;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const materials = useMemo(
    () =>
      getVoxelMaterials(getBlockRenderProfile(initialDebris.kind, Math.floor(initialDebris.origin.y)))
        .map((material) => material.clone()) as THREE.MeshStandardMaterial[],
    [initialDebris.kind, initialDebris.origin.y]
  );

  useEffect(() => {
    return () => {
      for (const material of materials) {
        material.dispose();
      }
    };
  }, [materials]);

  useFrame(() => {
    const debris = runtime.getEggScatterDebrisState(initialDebris.id);
    const mesh = meshRef.current;
    if (!mesh) {
      return;
    }

    if (!debris) {
      mesh.visible = false;
      return;
    }

    mesh.visible = true;
    const position = getEggScatterDebrisPosition(debris, runtime.config.eggScatterArcHeight);
    mesh.position.set(position.x, position.y, position.z);
  });

  return (
    <mesh
      ref={meshRef}
      geometry={sharedVoxelGeometry}
      material={materials}
    />
  );
}
