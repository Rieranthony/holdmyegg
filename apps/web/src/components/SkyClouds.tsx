import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { Vec3i } from "@out-of-bounds/map";
import * as THREE from "three";
import { cloudPresets, getVoxelCloudPosition } from "../game/clouds";
import { StaticInstancedMesh, type StaticInstanceTransform } from "./StaticInstancedMesh";

const cloudGeometry = new THREE.BoxGeometry(1.6, 0.9, 1.6);
const mainMaterial = new THREE.MeshStandardMaterial({
  color: "#ffffff",
  roughness: 1,
  metalness: 0
});
const shadeMaterial = new THREE.MeshStandardMaterial({
  color: "#dde7f2",
  roughness: 1,
  metalness: 0
});

const buildCloudTransforms = (preset: (typeof cloudPresets)[number]) => {
  const mainTransforms: StaticInstanceTransform[] = [];
  const shadeTransforms: StaticInstanceTransform[] = [];

  for (const cube of preset.cubes) {
    const transform = {
      position: [cube.x, cube.y, cube.z] as const
    };
    if (cube.tone === "shade") {
      shadeTransforms.push(transform);
    } else {
      mainTransforms.push(transform);
    }
  }

  return {
    mainTransforms,
    shadeTransforms
  };
};

export function SkyClouds({
  worldSize,
  maxCloudCount = cloudPresets.length
}: {
  worldSize: Vec3i;
  maxCloudCount?: number;
}) {
  const cloudRefs = useRef<Array<THREE.Group | null>>([]);
  const visiblePresets = useMemo(() => cloudPresets.slice(0, maxCloudCount), [maxCloudCount]);

  useFrame(({ clock }) => {
    const elapsedSeconds = clock.elapsedTime;
    visiblePresets.forEach((preset, index) => {
      const cloud = cloudRefs.current[index];
      if (!cloud) {
        return;
      }

      const position = getVoxelCloudPosition(preset, elapsedSeconds, worldSize);
      cloud.position.set(position.x, position.y, position.z);
    });
  });

  return (
    <group>
      {visiblePresets.map((preset, presetIndex) => {
        const transforms = buildCloudTransforms(preset);
        const initialPosition = getVoxelCloudPosition(preset, 0, worldSize);
        return (
          <group
            key={preset.id}
            position={[initialPosition.x, initialPosition.y, initialPosition.z]}
            ref={(node) => {
              cloudRefs.current[presetIndex] = node;
            }}
          >
            <StaticInstancedMesh
              geometry={cloudGeometry}
              material={mainMaterial}
              transforms={transforms.mainTransforms}
            />
            <StaticInstancedMesh
              geometry={cloudGeometry}
              material={shadeMaterial}
              transforms={transforms.shadeTransforms}
            />
          </group>
        );
      })}
    </group>
  );
}
