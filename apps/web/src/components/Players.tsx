import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { OutOfBoundsSimulation } from "@out-of-bounds/sim";
import { getChickenPalette } from "../game/colors";
import { stepAngleToward } from "../game/camera";
import { getPlayerBlobShadowState } from "../game/cheapShadows";
import {
  chickenFeatherGeometry,
  chickenFeatherOffsets,
  getChickenWingVisualState,
  getPlayerAvatarVisualState,
  getPlayerStatusVisualState
} from "../game/playerVisuals";
import {
  chickenDetailMaterials,
  chickenPartGeometries,
  createChickenMaterialBundle,
  disposeChickenMaterialBundle,
  playerRingGeometry,
  playerShadowGeometry
} from "../game/sceneAssets";

const AVATAR_TURN_SPEED = 4.5;
const AVATAR_BOB_BASE_Y = 0.74;
const eliminatedVisualState = {
  scaleX: 1,
  scaleY: 1,
  scaleZ: 1,
  blinkVisible: true
} as const;

export function PlayersLayer({
  runtime,
  playerIds,
  localPlayerId,
  matchColorSeed,
  detailDistance
}: {
  runtime: OutOfBoundsSimulation;
  playerIds: string[];
  localPlayerId: string | null;
  matchColorSeed: number;
  detailDistance: number;
}) {
  return (
    <group>
      {playerIds.map((playerId) => (
        <PlayerAvatar
          detailDistance={detailDistance}
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
  detailDistance,
  runtime,
  playerId,
  isLocal,
  matchColorSeed
}: {
  detailDistance: number;
  runtime: OutOfBoundsSimulation;
  playerId: string;
  isLocal: boolean;
  matchColorSeed: number;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const shellRef = useRef<THREE.Group>(null);
  const avatarRef = useRef<THREE.Group>(null);
  const highDetailRef = useRef<THREE.Group>(null);
  const lowDetailRef = useRef<THREE.Group>(null);
  const featherRefs = useRef<THREE.Group[]>([]);
  const leftWingRef = useRef<THREE.Group>(null);
  const rightWingRef = useRef<THREE.Group>(null);
  const shadowRef = useRef<THREE.Mesh>(null);
  const positionTargetRef = useRef(new THREE.Vector3());
  const palette = useMemo(() => getChickenPalette(playerId, matchColorSeed), [matchColorSeed, playerId]);
  const materialBundle = useMemo(() => createChickenMaterialBundle(palette), [palette]);

  useEffect(() => {
    return () => {
      disposeChickenMaterialBundle(materialBundle);
    };
  }, [materialBundle]);

  useFrame((state, delta) => {
    const player = runtime.getPlayerRuntimeState(playerId);
    const group = groupRef.current;
    const shell = shellRef.current;
    const avatar = avatarRef.current;
    const highDetail = highDetailRef.current;
    const lowDetail = lowDetailRef.current;
    const leftWing = leftWingRef.current;
    const rightWing = rightWingRef.current;
    const shadow = shadowRef.current;
    const feathers = featherRefs.current;
    if (!player || !group || !shell || !avatar || !highDetail || !lowDetail || !leftWing || !rightWing || !shadow) {
      return;
    }

    const playerVisible = player.fallingOut || (player.alive && !player.respawning);
    group.visible = playerVisible;
    if (!playerVisible) {
      return;
    }

    const damping = 1 - Math.exp(-delta * 10);
    positionTargetRef.current.set(player.position.x, player.position.y, player.position.z);
    group.position.lerp(positionTargetRef.current, damping);
    const useLowDetail =
      !isLocal && state.camera.position.distanceToSquared(group.position) > detailDistance * detailDistance;
    highDetail.visible = !useLowDetail;
    lowDetail.visible = useLowDetail;

    const targetYaw = Math.atan2(player.facing.x, player.facing.z);
    group.rotation.y = stepAngleToward(group.rotation.y, targetYaw, delta * AVATAR_TURN_SPEED);

    const visualState = player.alive
      ? getPlayerAvatarVisualState(player.stunRemaining, state.clock.elapsedTime)
      : eliminatedVisualState;
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
    materialBundle.shadow.opacity = shadowState.opacity;

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
    const statusVisualState = getPlayerStatusVisualState(player.invulnerableRemaining, state.clock.elapsedTime);
    const ringOpacity = !player.alive
      ? 0.35
      : player.stunRemaining > 0
        ? 0.5
        : isLocal
          ? 0.95
          : 0.7;
    materialBundle.ring.opacity = Math.min(1, ringOpacity * statusVisualState.ringOpacityMultiplier);

    if (!useLowDetail) {
      leftWing.rotation.z = wingState.wingAngle;
      rightWing.rotation.z = -wingState.wingAngle;
      feathers.forEach((feather, index) => {
        if (!feather) {
          return;
        }

        feather.visible = index < player.livesRemaining;
      });
    }
  });

  return (
    <group ref={groupRef}>
      <mesh
        ref={shadowRef}
        geometry={playerShadowGeometry}
        material={materialBundle.shadow}
        rotation={[-Math.PI / 2, 0, 0]}
      />
      <mesh
        geometry={playerRingGeometry}
        material={materialBundle.ring}
        position={[0, 0.03, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
      />
      <group ref={shellRef}>
        <group ref={avatarRef}>
          <group ref={highDetailRef}>
            <group ref={leftWingRef} position={[0.39, 0.02, 0]}>
              <mesh
                geometry={chickenPartGeometries.wing}
                material={materialBundle.shade}
                position={[0.07, 0, 0]}
              />
            </group>
            <group ref={rightWingRef} position={[-0.39, 0.02, 0]}>
              <mesh
                geometry={chickenPartGeometries.wing}
                material={materialBundle.shade}
                position={[-0.07, 0, 0]}
              />
            </group>
            <mesh
              geometry={chickenPartGeometries.body}
              material={materialBundle.body}
            />
            <mesh
              geometry={chickenPartGeometries.crestFront}
              material={materialBundle.body}
              position={[0.06, 0.54, -0.04]}
              rotation={[0.3, 0, 0]}
            />
            <mesh
              geometry={chickenPartGeometries.crestBack}
              material={materialBundle.body}
              position={[-0.05, 0.58, -0.12]}
              rotation={[0.52, 0, 0]}
            />
            <mesh
              geometry={chickenPartGeometries.beakBase}
              material={materialBundle.shade}
              position={[0, 0.08, -0.47]}
            />
            <mesh
              geometry={chickenPartGeometries.beakTip}
              material={materialBundle.shade}
              position={[0, 0.08, -0.64]}
              rotation={[0.08, 0, 0]}
            />
            <mesh
              geometry={chickenPartGeometries.beakSide}
              material={materialBundle.shade}
              position={[0.11, 0.03, -0.6]}
              rotation={[0.08, -0.35, 0]}
            />
            <mesh
              geometry={chickenPartGeometries.beakSide}
              material={materialBundle.shade}
              position={[-0.11, 0.03, -0.6]}
              rotation={[0.08, 0.35, 0]}
            />
            <mesh
              geometry={chickenPartGeometries.eye}
              material={chickenDetailMaterials.eye}
              position={[0.19, 0.16, 0.42]}
            />
            <mesh
              geometry={chickenPartGeometries.eye}
              material={chickenDetailMaterials.eye}
              position={[-0.19, 0.16, 0.42]}
            />
            <mesh
              geometry={chickenPartGeometries.pupil}
              material={chickenDetailMaterials.pupil}
              position={[0.19, 0.14, 0.48]}
            />
            <mesh
              geometry={chickenPartGeometries.pupil}
              material={chickenDetailMaterials.pupil}
              position={[-0.19, 0.14, 0.48]}
            />
            <mesh
              geometry={chickenPartGeometries.wattle}
              material={chickenDetailMaterials.beak}
              position={[0, -0.05, 0.48]}
            />
            <mesh
              geometry={chickenPartGeometries.leg}
              material={chickenDetailMaterials.legs}
              position={[0.18, -0.46, 0.06]}
            />
            <mesh
              geometry={chickenPartGeometries.leg}
              material={chickenDetailMaterials.legs}
              position={[-0.18, -0.46, 0.06]}
            />
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
                <mesh
                  geometry={chickenPartGeometries.featherPlume}
                  material={materialBundle.body}
                  position={[0, chickenFeatherGeometry.plumePositionY, 0]}
                />
                <mesh
                  geometry={chickenPartGeometries.featherQuill}
                  material={chickenDetailMaterials.beak}
                  position={[0, chickenFeatherGeometry.quillPositionY, 0]}
                />
              </group>
            ))}
          </group>
          <group ref={lowDetailRef}>
            <mesh
              geometry={chickenPartGeometries.lowBody}
              material={materialBundle.body}
            />
            <mesh
              geometry={chickenPartGeometries.lowBeakBase}
              material={materialBundle.shade}
              position={[0, 0.02, -0.46]}
            />
            <mesh
              geometry={chickenPartGeometries.lowBeakFront}
              material={chickenDetailMaterials.beak}
              position={[0, -0.06, 0.44]}
            />
            <mesh
              geometry={chickenPartGeometries.lowCrest}
              material={materialBundle.body}
              position={[0, 0.42, -0.06]}
            />
          </group>
        </group>
      </group>
    </group>
  );
}
