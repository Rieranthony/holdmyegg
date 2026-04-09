import { Html } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { OutOfBoundsSimulation } from "@out-of-bounds/sim";
import { getChickenPalette, type ChickenPaletteName } from "../game/colors";
import { stepAngleToward } from "../game/camera";
import { getPlayerBlobShadowState } from "../game/cheapShadows";
import { getEggTauntMessage } from "../game/eggTaunts";
import { createChickenAvatarRig } from "../game/chickenModel";
import {
  chickenPoseVisualDefaults,
  getChickenHeadFeatherRotation,
  getChickenLowDetailTraceOffsetX,
  getChickenLowDetailWingMeshOffsetX,
  getChickenLowDetailWingTraceHeightScale,
  getChickenMotionSeed,
  getChickenPoseVisualState,
  getChickenTailMotion,
  getChickenWingDepthScale,
  getChickenWingFeatherletRotation,
  getChickenWingHeightScale,
  getChickenWingMeshOffsetX,
  getChickenWingTraceHeightScale,
  getChickenWingTraceOffsetX,
  getChickenWingVisualState,
  getPlayerAvatarVisualState,
  getPlayerStatusVisualState,
  headFeatherOffsets,
  shouldTriggerChickenLandingTumble,
  wingFeatherletOffsets
} from "../game/playerVisuals";
import {
  chickenModelRig,
  createChickenMaterialBundle,
  disposeChickenMaterialBundle,
  playerRingGeometry,
  playerShadowGeometry
} from "../game/sceneAssets";
import { ChickenTauntBubble } from "./ChickenTauntBubble";

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
  localPlayerPaletteName,
  detailDistance
}: {
  runtime: OutOfBoundsSimulation;
  playerIds: string[];
  localPlayerId: string | null;
  matchColorSeed: number;
  localPlayerPaletteName?: ChickenPaletteName | null;
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
          localPlayerPaletteName={localPlayerPaletteName}
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
  matchColorSeed,
  localPlayerPaletteName
}: {
  detailDistance: number;
  runtime: OutOfBoundsSimulation;
  playerId: string;
  isLocal: boolean;
  matchColorSeed: number;
  localPlayerPaletteName?: ChickenPaletteName | null;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const shadowRef = useRef<THREE.Mesh>(null);
  const positionTargetRef = useRef(new THREE.Vector3());
  const previousGroundedRef = useRef(false);
  const previousVelocityYRef = useRef(0);
  const landingRollRemainingRef = useRef(0);
  const tauntAnchorRef = useRef<THREE.Group>(null);
  const palette = useMemo(
    () => getChickenPalette(playerId, matchColorSeed, isLocal ? localPlayerPaletteName : null),
    [isLocal, localPlayerPaletteName, matchColorSeed, playerId]
  );
  const motionSeed = useMemo(() => getChickenMotionSeed(playerId), [playerId]);
  const tauntSeed = useMemo(() => `${matchColorSeed}:${playerId}`, [matchColorSeed, playerId]);
  const materialBundle = useMemo(() => createChickenMaterialBundle(palette), [palette]);
  const rig = useMemo(() => createChickenAvatarRig(materialBundle), [materialBundle]);
  const tauntMessageRef = useRef<string | null>(null);
  const [tauntMessage, setTauntMessage] = useState<string | null>(null);

  const setEggTauntMessage = (nextMessage: string | null) => {
    if (tauntMessageRef.current === nextMessage) {
      return;
    }

    tauntMessageRef.current = nextMessage;
    setTauntMessage(nextMessage);
  };

  useEffect(() => {
    return () => {
      disposeChickenMaterialBundle(materialBundle);
    };
  }, [materialBundle]);

  useFrame((state, delta) => {
    const player = runtime.getPlayerRuntimeState(playerId);
    const group = groupRef.current;
    const shadow = shadowRef.current;
    if (!player || !group || !shadow) {
      return;
    }

    const {
      avatar,
      body,
      headFeathers,
      headPivot,
      highDetail,
      leftLeg,
      leftWing,
      leftWingFeatherlets,
      leftWingMesh,
      leftWingTrace,
      lowDetail,
      lowDetailHeadFeathers,
      lowDetailHead,
      lowDetailLeftTrace,
      lowDetailTail,
      lowDetailLeftWing,
      lowDetailLeftWingMesh,
      lowDetailRightTrace,
      lowDetailRightWing,
      lowDetailRightWingMesh,
      rightLeg,
      rightWing,
      rightWingFeatherlets,
      rightWingMesh,
      rightWingTrace,
      shell,
      tail
    } = rig;

    const playerVisible = player.fallingOut || (player.alive && !player.respawning);
    group.visible = playerVisible;
    if (!playerVisible) {
      landingRollRemainingRef.current = 0;
      setEggTauntMessage(null);
      previousGroundedRef.current = player.grounded;
      previousVelocityYRef.current = player.velocity.y;
      return;
    }

    const damping = 1 - Math.exp(-delta * 10);
    positionTargetRef.current.set(player.position.x, player.position.y, player.position.z);
    group.position.lerp(positionTargetRef.current, damping);
    const useLowDetail = false;
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

    const planarSpeed = Math.hypot(player.velocity.x, player.velocity.z);
    const stride = !player.alive || player.stunRemaining > 0 ? 0 : Math.min(1, planarSpeed / 5);
    const struggleSignal =
      stride > 0.08 ? Math.max(0, Math.sin(state.clock.elapsedTime * 0.82 + motionSeed * 0.35 + 0.6)) : 0;
    const struggleHop =
      struggleSignal > 0.95 ? Math.pow((struggleSignal - 0.95) / 0.05, 1.8) * stride : 0;
    const runWingLift = struggleHop * 0.42;

    if (
      shouldTriggerChickenLandingTumble({
        wasGrounded: previousGroundedRef.current,
        grounded: player.grounded,
        previousVelocityY: previousVelocityYRef.current
      })
    ) {
      landingRollRemainingRef.current = chickenPoseVisualDefaults.landingTumbleDuration;
    } else {
      landingRollRemainingRef.current = Math.max(0, landingRollRemainingRef.current - delta);
    }

    const poseState = getChickenPoseVisualState({
      grounded: player.grounded,
      velocityY: player.velocity.y,
      planarSpeed,
      elapsedTime: state.clock.elapsedTime,
      motionSeed,
      pushVisualRemaining: player.pushVisualRemaining,
      landingRollRemaining: landingRollRemainingRef.current,
      spacePhase: player.spacePhase,
      spacePhaseRemaining: player.spacePhaseRemaining,
      stunned: player.stunRemaining > 0
    });

    shell.rotation.x = poseState.bodyPitch;
    shell.rotation.z = poseState.bodyRoll;
    body.rotation.y = poseState.bodyYaw;
    avatar.position.y =
      AVATAR_BOB_BASE_Y + Math.sin(state.clock.elapsedTime * 10 + (isLocal ? 0 : 1.2)) * 0.05 * stride + struggleHop * 0.52;
    avatar.position.z = poseState.bodyForwardOffset;
    avatar.rotation.x = struggleHop * 0.22;
    headPivot.rotation.x = poseState.headPitch;
    headPivot.rotation.y = poseState.headYaw;
    headPivot.position.y = chickenModelRig.headPivotY + poseState.headYOffset;
    const tauntAnchor = tauntAnchorRef.current;
    if (tauntAnchor) {
      tauntAnchor.position.set(
        0,
        avatar.position.y + chickenModelRig.headPivotY + poseState.headYOffset + 0.58,
        0.12
      );
    }
    lowDetailHead.rotation.x = poseState.headPitch * 0.76;
    lowDetailHead.rotation.y = poseState.headYaw * 0.72;
    lowDetailHead.position.y = chickenModelRig.lowHeadPivotY + poseState.headYOffset * 0.5;
    leftLeg.rotation.x = poseState.leftLegPitch;
    rightLeg.rotation.x = poseState.rightLegPitch;

    const wingState = getChickenWingVisualState({
      alive: player.alive,
      grounded: player.grounded,
      velocityY: player.velocity.y,
      planarSpeed,
      jetpackActive: player.jetpackActive,
      motionSeed,
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
    const leftWingAngle = Math.min(1.34, wingState.leftWingAngle + poseState.wingAngleOffset + runWingLift);
    const rightWingAngle = Math.min(1.34, wingState.rightWingAngle + poseState.wingAngleOffset + runWingLift);
    const wingHeightScale = getChickenWingHeightScale(wingState.wingSpanScale);
    const wingDepthScale = getChickenWingDepthScale(wingState.wingSpanScale);
    const wingMeshOffsetX = getChickenWingMeshOffsetX(wingState.wingSpanScale);
    const lowDetailWingOffsetX = getChickenLowDetailWingMeshOffsetX(wingState.wingSpanScale);
    const traceVisible = false;
    const traceOffsetX = getChickenWingTraceOffsetX(wingState.wingSpanScale);
    const traceHeightScale = getChickenWingTraceHeightScale(wingState.traceIntensity);
    const lowDetailTraceOffsetX = getChickenLowDetailTraceOffsetX(wingState.wingSpanScale);
    const lowDetailTraceHeightScale = getChickenLowDetailWingTraceHeightScale(wingState.traceIntensity);
    materialBundle.wingletTrace.opacity = 0;

    leftWing.rotation.z = leftWingAngle;
    rightWing.rotation.z = -rightWingAngle;
    lowDetailLeftWing.rotation.z = leftWingAngle * 0.94;
    lowDetailRightWing.rotation.z = -rightWingAngle * 0.94;
    leftWingMesh.position.x = wingMeshOffsetX;
    rightWingMesh.position.x = -wingMeshOffsetX;
    lowDetailLeftWingMesh.position.x = lowDetailWingOffsetX;
    lowDetailRightWingMesh.position.x = -lowDetailWingOffsetX;
    leftWingMesh.scale.set(wingState.wingSpanScale, wingHeightScale, wingDepthScale);
    rightWingMesh.scale.set(wingState.wingSpanScale, wingHeightScale, wingDepthScale);
    lowDetailLeftWingMesh.scale.set(wingState.wingSpanScale * 0.92, 1 + (wingHeightScale - 1) * 0.65, 1);
    lowDetailRightWingMesh.scale.set(wingState.wingSpanScale * 0.92, 1 + (wingHeightScale - 1) * 0.65, 1);
    leftWingTrace.position.x = traceOffsetX;
    rightWingTrace.position.x = -traceOffsetX;
    leftWingTrace.scale.set(wingState.traceLength, traceHeightScale, 1);
    rightWingTrace.scale.set(wingState.traceLength, traceHeightScale, 1);
    leftWingTrace.visible = !useLowDetail && traceVisible;
    rightWingTrace.visible = !useLowDetail && traceVisible;
    lowDetailLeftTrace.position.x = lowDetailTraceOffsetX;
    lowDetailRightTrace.position.x = -lowDetailTraceOffsetX;
    lowDetailLeftTrace.scale.set(wingState.traceLength * 0.88, lowDetailTraceHeightScale, 1);
    lowDetailRightTrace.scale.set(wingState.traceLength * 0.88, lowDetailTraceHeightScale, 1);
    lowDetailLeftTrace.visible = useLowDetail && traceVisible;
    lowDetailRightTrace.visible = useLowDetail && traceVisible;
    const tailMotion = getChickenTailMotion(poseState.featherSwing);
    tail.rotation.x = tailMotion.x;
    tail.rotation.z = tailMotion.z;
    lowDetailTail.rotation.x = tailMotion.x * 0.82;
    lowDetailTail.rotation.z = tailMotion.z * 0.82;

    headFeathers.forEach((feather, index) => {
      const featherRotation = getChickenHeadFeatherRotation(headFeatherOffsets[index]!, poseState.featherSwing);
      feather.rotation.set(featherRotation.x, featherRotation.y, featherRotation.z);
      feather.visible = index < player.livesRemaining;
    });

    lowDetailHeadFeathers.forEach((feather, index) => {
      const featherRotation = getChickenHeadFeatherRotation(headFeatherOffsets[index]!, poseState.featherSwing, 0.82);
      feather.rotation.set(featherRotation.x * 0.9, featherRotation.y, featherRotation.z * 0.86);
      feather.visible = index < player.livesRemaining;
    });

    leftWingFeatherlets.forEach((feather, index) => {
      const leftRotation = getChickenWingFeatherletRotation(wingFeatherletOffsets[index]!, poseState.featherSwing, 1);
      feather.rotation.set(leftRotation.x, leftRotation.y, leftRotation.z);
      feather.visible = true;
      const rightFeather = rightWingFeatherlets[index];
      if (rightFeather) {
        const rightRotation = getChickenWingFeatherletRotation(
          wingFeatherletOffsets[index]!,
          poseState.featherSwing,
          -1
        );
        rightFeather.rotation.set(rightRotation.x, rightRotation.y, rightRotation.z);
        rightFeather.visible = true;
      }
    });

    const nextTauntMessage =
      player.eggTauntRemaining > 0
        ? getEggTauntMessage(tauntSeed, player.eggTauntSequence)
        : null;
    setEggTauntMessage(nextTauntMessage);

    previousGroundedRef.current = player.grounded;
    previousVelocityYRef.current = player.velocity.y;
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
      <group ref={tauntAnchorRef}>
        {tauntMessage && (
          <Html zIndexRange={[90, 0]}>
            <ChickenTauntBubble message={tauntMessage} />
          </Html>
        )}
      </group>
      <primitive
        dispose={null}
        object={rig.root}
      />
    </group>
  );
}
