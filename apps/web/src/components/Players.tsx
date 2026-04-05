import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { OutOfBoundsSimulation } from "@out-of-bounds/sim";
import { chickenDetailPalette, getChickenPalette } from "../game/colors";
import { stepAngleToward } from "../game/camera";
import { getPlayerBlobShadowState } from "../game/cheapShadows";
import {
  chickenFeatherGeometry,
  chickenFeatherOffsets,
  getChickenWingVisualState,
  getPlayerAvatarVisualState,
  getPlayerStatusVisualState
} from "../game/playerVisuals";

const AVATAR_TURN_SPEED = 4.5;
const AVATAR_BOB_BASE_Y = 0.74;

export function PlayersLayer({
  runtime,
  playerIds,
  localPlayerId,
  matchColorSeed
}: {
  runtime: OutOfBoundsSimulation;
  playerIds: string[];
  localPlayerId: string | null;
  matchColorSeed: number;
}) {
  return (
    <group>
      {playerIds.map((playerId) => (
        <PlayerAvatar
          key={playerId}
          runtime={runtime}
          playerId={playerId}
          isLocal={playerId === localPlayerId}
          matchColorSeed={matchColorSeed}
        />
      ))}
    </group>
  );
}

function PlayerAvatar({
  runtime,
  playerId,
  isLocal,
  matchColorSeed
}: {
  runtime: OutOfBoundsSimulation;
  playerId: string;
  isLocal: boolean;
  matchColorSeed: number;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const shellRef = useRef<THREE.Group>(null);
  const avatarRef = useRef<THREE.Group>(null);
  const featherRefs = useRef<THREE.Group[]>([]);
  const leftWingRef = useRef<THREE.Group>(null);
  const rightWingRef = useRef<THREE.Group>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const shadowRef = useRef<THREE.Mesh>(null);
  const positionTargetRef = useRef(new THREE.Vector3());
  const palette = getChickenPalette(playerId, matchColorSeed);

  useFrame((state, delta) => {
    const player = runtime.getPlayerState(playerId);
    const group = groupRef.current;
    const shell = shellRef.current;
    const avatar = avatarRef.current;
    const leftWing = leftWingRef.current;
    const rightWing = rightWingRef.current;
    const ring = ringRef.current;
    const shadow = shadowRef.current;
    const feathers = featherRefs.current;
    if (!player || !group || !shell || !avatar || !leftWing || !rightWing || !ring || !shadow) {
      return;
    }

    group.visible = player.visible;
    if (!player.visible) {
      return;
    }

    const damping = 1 - Math.exp(-delta * 10);
    positionTargetRef.current.set(player.position.x, player.position.y, player.position.z);
    group.position.lerp(positionTargetRef.current, damping);

    const targetYaw = Math.atan2(player.facing.x, player.facing.z);
    group.rotation.y = stepAngleToward(group.rotation.y, targetYaw, delta * AVATAR_TURN_SPEED);

    const visualState = player.alive
      ? getPlayerAvatarVisualState(player.stunRemaining, state.clock.elapsedTime)
      : {
          scaleX: 1,
          scaleY: 1,
          scaleZ: 1,
          blinkVisible: true
        };
    shell.scale.set(visualState.scaleX, visualState.scaleY, visualState.scaleZ);
    shell.visible = visualState.blinkVisible;

    const shadowColumnX = Math.max(0, Math.min(runtime.getWorld().size.x - 1, Math.floor(player.position.x)));
    const shadowColumnZ = Math.max(0, Math.min(runtime.getWorld().size.z - 1, Math.floor(player.position.z)));
    const shadowSurfaceY = runtime.getWorld().getTopSolidY(shadowColumnX, shadowColumnZ) + 0.05;
    const shadowState = player.alive
      ? getPlayerBlobShadowState({
          playerY: player.position.y,
          surfaceY: shadowSurfaceY,
          isLocal,
          stunned: player.stunRemaining > 0
        })
      : {
          yOffset: -10,
          scale: 1,
          opacity: 0
        };

    shadow.position.set(0, shadowState.yOffset, 0);
    shadow.scale.setScalar(shadowState.scale);
    (shadow.material as THREE.MeshBasicMaterial).opacity = shadowState.opacity;

    const stride =
      !player.alive || player.stunRemaining > 0 ? 0 : Math.min(1, Math.hypot(player.velocity.x, player.velocity.z) / 5);
    avatar.position.y = AVATAR_BOB_BASE_Y + Math.sin(state.clock.elapsedTime * 10 + (isLocal ? 0 : 1.2)) * 0.05 * stride;
    const wingState = getChickenWingVisualState({
      alive: player.alive,
      grounded: player.grounded,
      velocityY: player.velocity.y,
      jetpackActive: player.jetpackActive,
      stunned: player.stunRemaining > 0,
      elapsedTime: state.clock.elapsedTime
    });
    leftWing.rotation.z = wingState.wingAngle;
    rightWing.rotation.z = -wingState.wingAngle;
    const statusVisualState = getPlayerStatusVisualState(player.invulnerableRemaining, state.clock.elapsedTime);
    const ringOpacity = !player.alive
      ? 0.35
      : player.stunRemaining > 0
        ? 0.5
        : isLocal
          ? 0.95
          : 0.7;
    (ring.material as THREE.MeshBasicMaterial).opacity = Math.min(1, ringOpacity * statusVisualState.ringOpacityMultiplier);

    feathers.forEach((feather, index) => {
      if (!feather) {
        return;
      }

      feather.visible = index < player.livesRemaining;
    });
  });

  return (
    <group ref={groupRef}>
      <mesh
        ref={shadowRef}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <circleGeometry args={[0.62, 18]} />
        <meshBasicMaterial
          color="#000000"
          transparent
          opacity={0.2}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <mesh
        ref={ringRef}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.03, 0]}
      >
        <ringGeometry args={[0.5, 0.66, 24]} />
        <meshBasicMaterial
          color={palette.ringAccent}
          transparent
          opacity={0.8}
        />
      </mesh>
      <group ref={shellRef}>
        <group ref={avatarRef}>
          <group ref={leftWingRef} position={[0.39, 0.02, 0]}>
            <mesh position={[0.07, 0, 0]}>
              <boxGeometry args={[0.1, 0.28, 0.5]} />
              <meshStandardMaterial color={palette.shade} />
            </mesh>
          </group>
          <group ref={rightWingRef} position={[-0.39, 0.02, 0]}>
            <mesh position={[-0.07, 0, 0]}>
              <boxGeometry args={[0.1, 0.28, 0.5]} />
              <meshStandardMaterial color={palette.shade} />
            </mesh>
          </group>
          <mesh>
            <boxGeometry args={[0.78, 0.78, 0.78]} />
            <meshStandardMaterial color={palette.body} />
          </mesh>
          <mesh
            position={[0.06, 0.54, -0.04]}
            rotation={[0.3, 0, 0]}
          >
            <boxGeometry args={[0.11, 0.2, 0.06]} />
            <meshStandardMaterial color={palette.body} />
          </mesh>
          <mesh
            position={[-0.05, 0.58, -0.12]}
            rotation={[0.52, 0, 0]}
          >
            <boxGeometry args={[0.11, 0.22, 0.06]} />
            <meshStandardMaterial color={palette.body} />
          </mesh>
          <mesh position={[0, 0.08, -0.47]}>
            <boxGeometry args={[0.2, 0.16, 0.18]} />
            <meshStandardMaterial color={palette.shade} />
          </mesh>
          <mesh
            position={[0, 0.08, -0.64]}
            rotation={[0.08, 0, 0]}
          >
            <boxGeometry args={[0.08, 0.18, 0.18]} />
            <meshStandardMaterial color={palette.shade} />
          </mesh>
          <mesh
            position={[0.11, 0.03, -0.6]}
            rotation={[0.08, -0.35, 0]}
          >
            <boxGeometry args={[0.08, 0.16, 0.18]} />
            <meshStandardMaterial color={palette.shade} />
          </mesh>
          <mesh
            position={[-0.11, 0.03, -0.6]}
            rotation={[0.08, 0.35, 0]}
          >
            <boxGeometry args={[0.08, 0.16, 0.18]} />
            <meshStandardMaterial color={palette.shade} />
          </mesh>
          <mesh position={[0.19, 0.16, 0.42]}>
            <boxGeometry args={[0.18, 0.18, 0.06]} />
            <meshStandardMaterial color={chickenDetailPalette.eye} />
          </mesh>
          <mesh position={[-0.19, 0.16, 0.42]}>
            <boxGeometry args={[0.18, 0.18, 0.06]} />
            <meshStandardMaterial color={chickenDetailPalette.eye} />
          </mesh>
          <mesh position={[0.19, 0.14, 0.48]}>
            <boxGeometry args={[0.07, 0.07, 0.04]} />
            <meshStandardMaterial color={chickenDetailPalette.pupil} />
          </mesh>
          <mesh position={[-0.19, 0.14, 0.48]}>
            <boxGeometry args={[0.07, 0.07, 0.04]} />
            <meshStandardMaterial color={chickenDetailPalette.pupil} />
          </mesh>
          <mesh position={[0, -0.05, 0.48]}>
            <boxGeometry args={[0.22, 0.16, 0.16]} />
            <meshStandardMaterial color={chickenDetailPalette.beak} />
          </mesh>
          <mesh position={[0.18, -0.46, 0.06]}>
            <boxGeometry args={[0.16, 0.16, 0.16]} />
            <meshStandardMaterial color={chickenDetailPalette.legs} />
          </mesh>
          <mesh position={[-0.18, -0.46, 0.06]}>
            <boxGeometry args={[0.16, 0.16, 0.16]} />
            <meshStandardMaterial color={chickenDetailPalette.legs} />
          </mesh>
          {chickenFeatherOffsets.map((feather, index) => (
            <group
              key={`feather-${index}`}
              ref={(group) => {
                if (group) {
                  featherRefs.current[index] = group;
                }
              }}
              position={[feather.x, feather.y, feather.z]}
              rotation={[0, 0, feather.rotationZ]}
            >
              <mesh position={[0, chickenFeatherGeometry.plumePositionY, 0]}>
                <boxGeometry args={chickenFeatherGeometry.plumeSize} />
                <meshStandardMaterial color={palette.body} />
              </mesh>
              <mesh position={[0, chickenFeatherGeometry.quillPositionY, 0]}>
                <boxGeometry args={chickenFeatherGeometry.quillSize} />
                <meshStandardMaterial color={chickenDetailPalette.beak} />
              </mesh>
            </group>
          ))}
        </group>
      </group>
    </group>
  );
}
