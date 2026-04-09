import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { Vec3i } from "@out-of-bounds/map";
import * as THREE from "three";
import { birdPresets, getSkyBirdPose } from "../game/birds";
import {
  skyBirdBodyGeometry,
  skyBirdHeadGeometry,
  skyBirdMaterial,
  skyBirdWingGeometry
} from "../game/sceneAssets";

export function SkyBirds({
  worldSize,
  count = birdPresets.length
}: {
  worldSize: Vec3i;
  count?: number;
}) {
  const birdRefs = useRef<Array<THREE.Group | null>>([]);
  const leftWingRefs = useRef<Array<THREE.Mesh | null>>([]);
  const rightWingRefs = useRef<Array<THREE.Mesh | null>>([]);
  const activePresets = birdPresets.slice(0, Math.max(0, Math.min(count, birdPresets.length)));

  useFrame(({ clock }) => {
    const elapsedSeconds = clock.elapsedTime;
    activePresets.forEach((preset, index) => {
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
      {activePresets.map((preset, index) => {
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
              geometry={skyBirdBodyGeometry}
              material={skyBirdMaterial}
            />
            <mesh
              geometry={skyBirdHeadGeometry}
              material={skyBirdMaterial}
              position={[0, 0.02, 0.22]}
            />
            <mesh
              geometry={skyBirdWingGeometry}
              material={skyBirdMaterial}
              position={[-0.38, 0, -0.02]}
              ref={(node) => {
                leftWingRefs.current[index] = node;
              }}
            />
            <mesh
              geometry={skyBirdWingGeometry}
              material={skyBirdMaterial}
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
