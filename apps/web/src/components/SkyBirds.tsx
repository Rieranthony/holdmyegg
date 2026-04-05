import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { Vec3i } from "@out-of-bounds/map";
import * as THREE from "three";
import { birdPresets, getSkyBirdPose } from "../game/birds";

export function SkyBirds({ worldSize }: { worldSize: Vec3i }) {
  const birdRefs = useRef<Array<THREE.Group | null>>([]);
  const leftWingRefs = useRef<Array<THREE.Mesh | null>>([]);
  const rightWingRefs = useRef<Array<THREE.Mesh | null>>([]);
  const bodyGeometry = useMemo(() => new THREE.BoxGeometry(0.6, 0.18, 0.38), []);
  const headGeometry = useMemo(() => new THREE.BoxGeometry(0.16, 0.16, 0.16), []);
  const wingGeometry = useMemo(() => new THREE.BoxGeometry(0.56, 0.08, 0.24), []);
  const birdMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: "#1f2429",
        toneMapped: false
      }),
    []
  );

  useFrame(({ clock }) => {
    const elapsedSeconds = clock.elapsedTime;
    birdPresets.forEach((preset, index) => {
      const bird = birdRefs.current[index];
      const leftWing = leftWingRefs.current[index];
      const rightWing = rightWingRefs.current[index];
      if (!bird || !leftWing || !rightWing) {
        return;
      }

      const pose = getSkyBirdPose(preset, elapsedSeconds, worldSize);
      const wingAngle = THREE.MathUtils.lerp(0.08, 0.7, pose.flapAmount);
      const wingYOffset = THREE.MathUtils.lerp(-0.01, 0.05, pose.flapAmount);

      bird.position.set(pose.position.x, pose.position.y, pose.position.z);
      bird.rotation.y = pose.yaw;
      leftWing.rotation.z = wingAngle;
      rightWing.rotation.z = -wingAngle;
      leftWing.position.y = wingYOffset;
      rightWing.position.y = wingYOffset;
    });
  });

  return (
    <group>
      {birdPresets.map((preset, index) => {
        const initialPose = getSkyBirdPose(preset, 0, worldSize);
        return (
          <group
            key={preset.id}
            position={[initialPose.position.x, initialPose.position.y, initialPose.position.z]}
            ref={(node) => {
              birdRefs.current[index] = node;
            }}
            rotation={[0, initialPose.yaw, 0]}
          >
            <mesh
              geometry={bodyGeometry}
              material={birdMaterial}
            />
            <mesh
              geometry={headGeometry}
              material={birdMaterial}
              position={[0, 0.02, 0.22]}
            />
            <mesh
              geometry={wingGeometry}
              material={birdMaterial}
              position={[-0.38, 0, -0.02]}
              ref={(node) => {
                leftWingRefs.current[index] = node;
              }}
            />
            <mesh
              geometry={wingGeometry}
              material={birdMaterial}
              position={[0.38, 0, -0.02]}
              ref={(node) => {
                rightWingRefs.current[index] = node;
              }}
            />
          </group>
        );
      })}
    </group>
  );
}
