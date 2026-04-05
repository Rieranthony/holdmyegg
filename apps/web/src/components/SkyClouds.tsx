import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { Vec3i } from "@out-of-bounds/map";
import * as THREE from "three";
import { cloudPresets, getVoxelCloudPosition } from "../game/clouds";

export function SkyClouds({ worldSize }: { worldSize: Vec3i }) {
  const cloudRefs = useRef<Array<THREE.Group | null>>([]);
  const cloudGeometry = useMemo(() => new THREE.BoxGeometry(1.6, 0.9, 1.6), []);
  const mainMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#ffffff",
        roughness: 1,
        metalness: 0
      }),
    []
  );
  const shadeMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#dde7f2",
        roughness: 1,
        metalness: 0
      }),
    []
  );

  useFrame(({ clock }) => {
    const elapsedSeconds = clock.elapsedTime;
    cloudPresets.forEach((preset, index) => {
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
      {cloudPresets.map((preset, presetIndex) => {
        const initialPosition = getVoxelCloudPosition(preset, 0, worldSize);
        return (
          <group
            key={preset.id}
            position={[initialPosition.x, initialPosition.y, initialPosition.z]}
            ref={(node) => {
              cloudRefs.current[presetIndex] = node;
            }}
          >
            {preset.cubes.map((cube, cubeIndex) => (
              <mesh
                geometry={cloudGeometry}
                key={`${preset.id}-${cubeIndex}`}
                material={cube.tone === "shade" ? shadeMaterial : mainMaterial}
                position={[cube.x, cube.y, cube.z]}
              />
            ))}
          </group>
        );
      })}
    </group>
  );
}
