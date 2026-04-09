import { Html } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { ChickenPaletteName } from "../game/colors";
import { getChickenPaletteByName } from "../game/colors";
import { ChickenTauntBubble } from "./ChickenTauntBubble";
import {
  chickenPoseVisualDefaults,
  getChickenHeadFeatherRotation,
  getChickenPoseVisualState,
  getChickenTailMotion,
  getChickenWingDepthScale,
  getChickenWingFeatherletRotation,
  getChickenWingHeightScale,
  getChickenWingMeshOffsetX,
  getChickenWingVisualState,
  headFeatherOffsets,
  shouldTriggerChickenLandingTumble,
  wingFeatherletOffsets
} from "../game/playerVisuals";
import { createChickenAvatarRig } from "../game/chickenModel";
import {
  chickenModelRig,
  createChickenMaterialBundle,
  disposeChickenMaterialBundle,
  playerShadowGeometry
} from "../game/sceneAssets";
import { eggBaseGeometry as previewEggBaseGeometry, eggCapGeometry as previewEggCapGeometry, eggMiddleGeometry as previewEggMiddleGeometry } from "../game/eggVisualRecipe";
import { propMaterials } from "../game/propMaterials";
import { getNextChickenPreviewEggDelay, getNextChickenPreviewEggTaunt } from "./chickenPreviewEggs";

type ChickenPreviewVariant = "menu" | "launch";

interface PreviewEggState {
  spawnedAt: number;
  settleRotationY: number;
  startRotationY: number;
  roamCenterX: number;
  settleY: number;
  roamCenterZ: number;
  startX: number;
  startY: number;
  startZ: number;
  roamRadiusX: number;
  roamRadiusZ: number;
  roamSpeed: number;
  roamPhase: number;
  wobblePhase: number;
  rollSpeed: number;
}

const previewEggDropDuration = 0.32;
const previewEggLifetime = 7.5;
const previewEggPoolSize = 5;
const previewEggFloorY = -0.24;

const previewVariantConfig: Record<
  ChickenPreviewVariant,
  {
    cameraPosition: [number, number, number];
    fov: number;
    lookAt: [number, number, number];
    groupPosition: [number, number, number];
    scale: number;
    baseYaw: number;
    yawAmplitude: number;
    rollAmplitude: number;
    bobScale: number;
    hopScale: number;
  }
> = {
  menu: {
    cameraPosition: [0.48, 0.82, 10.7],
    fov: 24,
    lookAt: [0.14, 0.5, 0],
    groupPosition: [0.2, -0.98, 0],
    scale: 1.06,
    baseYaw: 0.96,
    yawAmplitude: 0.12,
    rollAmplitude: 0.02,
    bobScale: 1,
    hopScale: 1
  },
  launch: {
    cameraPosition: [-8.1, 6.7, 0.3],
    fov: 34,
    lookAt: [1.72, 1.5, 0],
    groupPosition: [0, -1.46, 0],
    scale: 1.42,
    baseYaw: Math.PI / 2,
    yawAmplitude: 0.03,
    rollAmplitude: 0.008,
    bobScale: 0.32,
    hopScale: 0.18
  }
};

export function ChickenPreview({
  paletteName,
  variant = "menu"
}: {
  paletteName: ChickenPaletteName;
  variant?: ChickenPreviewVariant;
}) {
  const config = previewVariantConfig[variant];

  return (
    <div className="chicken-preview-canvas">
      <Canvas
        camera={{ position: config.cameraPosition, fov: config.fov }}
        dpr={[1, 1.5]}
        gl={{ alpha: true, antialias: false, powerPreference: "high-performance" }}
      >
        <PreviewCameraTarget target={config.lookAt} />
        <ambientLight intensity={1.4} />
        <hemisphereLight
          args={["#fff6d9", "#233443", 1.05]}
          position={[0, 6, 0]}
        />
        <directionalLight
          intensity={1.55}
          position={[4, 7, 5]}
        />
        <ChickenPreviewModel
          baseYaw={config.baseYaw}
          bobScale={config.bobScale}
          decorativeEggsEnabled={variant === "menu"}
          groupPosition={config.groupPosition}
          hopScale={config.hopScale}
          paletteName={paletteName}
          rollAmplitude={config.rollAmplitude}
          scale={config.scale}
          yawAmplitude={config.yawAmplitude}
        />
      </Canvas>
    </div>
  );
}

function PreviewCameraTarget({ target }: { target: [number, number, number] }) {
  const { camera } = useThree();

  useLayoutEffect(() => {
    camera.lookAt(...target);
  }, [camera, target]);

  return null;
}

function ChickenPreviewModel({
  baseYaw,
  bobScale,
  decorativeEggsEnabled,
  groupPosition,
  hopScale,
  paletteName,
  rollAmplitude,
  scale,
  yawAmplitude
}: {
  baseYaw: number;
  bobScale: number;
  decorativeEggsEnabled: boolean;
  groupPosition: [number, number, number];
  hopScale: number;
  paletteName: ChickenPaletteName;
  rollAmplitude: number;
  scale: number;
  yawAmplitude: number;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const shadowRef = useRef<THREE.Mesh>(null);
  const tauntAnchorRef = useRef<THREE.Group>(null);
  const eggRefs = useRef<THREE.Group[]>([]);
  const previousGroundedRef = useRef(false);
  const previousVelocityYRef = useRef(0);
  const landingRollRemainingRef = useRef(0);
  const phaseOffsetRef = useRef(Math.random() * Math.PI * 2);
  const eggStatesRef = useRef<PreviewEggState[]>([]);
  const nextEggSpawnAtRef = useRef(getNextChickenPreviewEggDelay());
  const previewTauntSequenceRef = useRef(0);
  const previewTauntExpiresAtRef = useRef(0);
  const previewTauntMessageRef = useRef<string | null>(null);
  const [previewTauntMessage, setPreviewTauntMessage] = useState<string | null>(null);
  const palette = useMemo(() => getChickenPaletteByName(paletteName), [paletteName]);
  const materialBundle = useMemo(() => createChickenMaterialBundle(palette), [palette]);
  const rig = useMemo(() => createChickenAvatarRig(materialBundle), [materialBundle]);

  const setPreviewTaunt = (nextMessage: string | null) => {
    if (previewTauntMessageRef.current === nextMessage) {
      return;
    }

    previewTauntMessageRef.current = nextMessage;
    setPreviewTauntMessage(nextMessage);
  };

  useEffect(() => {
    return () => {
      disposeChickenMaterialBundle(materialBundle);
    };
  }, [materialBundle]);

  useFrame((state, delta) => {
    const group = groupRef.current;
    const shadow = shadowRef.current;
    const eggRefsCurrent = eggRefs.current;
    if (!group || !shadow) {
      return;
    }

    const {
      avatar,
      body,
      headFeathers,
      headPivot,
      leftLeg,
      leftWing,
      leftWingFeatherlets,
      leftWingMesh,
      rightLeg,
      rightWing,
      rightWingFeatherlets,
      rightWingMesh,
      shell,
      tail
    } = rig;

    const elapsed = state.clock.elapsedTime + phaseOffsetRef.current;
    const bob = Math.sin(elapsed * 1.7) * 0.06 * bobScale;
    const hopPhase = elapsed * 0.82 + 0.6;
    const hopSignal = Math.max(0, Math.sin(hopPhase));
    const hop = (hopSignal > 0.95 ? Math.pow((hopSignal - 0.95) / 0.05, 1.8) : 0) * hopScale;
    const grounded = hop < 0.015;
    const velocityY = grounded ? 0 : Math.cos(hopPhase) * 4.2;
    const planarSpeed = grounded ? 3.9 : 2.8;

    if (
      shouldTriggerChickenLandingTumble({
        wasGrounded: previousGroundedRef.current,
        grounded,
        previousVelocityY: previousVelocityYRef.current
      })
    ) {
      landingRollRemainingRef.current = chickenPoseVisualDefaults.landingTumbleDuration;
    } else {
      landingRollRemainingRef.current = Math.max(0, landingRollRemainingRef.current - delta);
    }

    const poseState = getChickenPoseVisualState({
      grounded,
      velocityY,
      planarSpeed,
      elapsedTime: elapsed,
      motionSeed: phaseOffsetRef.current,
      pushVisualRemaining: 0,
      landingRollRemaining: landingRollRemainingRef.current,
      stunned: false
    });
    const wingState = getChickenWingVisualState({
      alive: true,
      grounded,
      velocityY,
      planarSpeed,
      jetpackActive: false,
      motionSeed: phaseOffsetRef.current,
      stunned: false,
      elapsedTime: elapsed
    });

    const wingHeightScale = getChickenWingHeightScale(wingState.wingSpanScale);
    const wingDepthScale = getChickenWingDepthScale(wingState.wingSpanScale);
    const wingMeshOffsetX = getChickenWingMeshOffsetX(wingState.wingSpanScale);

    group.rotation.y = baseYaw + Math.sin(elapsed * 0.42) * yawAmplitude;
    group.rotation.z = Math.sin(elapsed * 0.8) * rollAmplitude;
    shell.rotation.x = poseState.bodyPitch;
    shell.rotation.z = poseState.bodyRoll * 0.9;
    body.rotation.y = poseState.bodyYaw;
    avatar.position.y = 0.86 + bob + hop * 0.64;
    avatar.position.z = poseState.bodyForwardOffset;
    headPivot.rotation.x = poseState.headPitch;
    headPivot.rotation.y = poseState.headYaw;
    headPivot.position.y = chickenModelRig.headPivotY + poseState.headYOffset;
    const tauntAnchor = tauntAnchorRef.current;
    if (tauntAnchor) {
      tauntAnchor.position.set(
        0,
        avatar.position.y + chickenModelRig.headPivotY + poseState.headYOffset + 0.56,
        0.12
      );
    }
    leftLeg.rotation.x = poseState.leftLegPitch;
    rightLeg.rotation.x = poseState.rightLegPitch;
    leftWing.rotation.z = wingState.leftWingAngle + poseState.wingAngleOffset;
    rightWing.rotation.z = -wingState.rightWingAngle - poseState.wingAngleOffset;
    leftWingMesh.position.x = wingMeshOffsetX;
    rightWingMesh.position.x = -wingMeshOffsetX;
    leftWingMesh.scale.set(wingState.wingSpanScale, wingHeightScale, wingDepthScale);
    rightWingMesh.scale.set(wingState.wingSpanScale, wingHeightScale, wingDepthScale);
    const tailMotion = getChickenTailMotion(poseState.featherSwing);
    tail.rotation.x = tailMotion.x;
    tail.rotation.z = tailMotion.z;
    materialBundle.shadow.opacity = 0.18 + (1 - hop * 0.55) * 0.18;
    shadow.scale.setScalar(1.48 - hop * 0.22 + Math.sin(elapsed * 1.7) * 0.02);

    headFeathers.forEach((feather, index) => {
      const featherRotation = getChickenHeadFeatherRotation(headFeatherOffsets[index]!, poseState.featherSwing);
      feather.rotation.set(featherRotation.x, featherRotation.y, featherRotation.z);
    });

    leftWingFeatherlets.forEach((feather, index) => {
      if (!feather) {
        return;
      }

      const leftRotation = getChickenWingFeatherletRotation(wingFeatherletOffsets[index]!, poseState.featherSwing, 1);
      feather.rotation.set(leftRotation.x, leftRotation.y, leftRotation.z);
      const rightFeather = rightWingFeatherlets[index];
      if (rightFeather) {
        const rightRotation = getChickenWingFeatherletRotation(
          wingFeatherletOffsets[index]!,
          poseState.featherSwing,
          -1
        );
        rightFeather.rotation.set(rightRotation.x, rightRotation.y, rightRotation.z);
      }
    });

    if (!decorativeEggsEnabled) {
      eggStatesRef.current = [];
      nextEggSpawnAtRef.current = elapsed + getNextChickenPreviewEggDelay();
      previewTauntSequenceRef.current = 0;
      previewTauntExpiresAtRef.current = 0;
      setPreviewTaunt(null);
    } else {
      const eggs = eggStatesRef.current.filter(
        (egg) => elapsed - egg.spawnedAt <= previewEggLifetime
      );
      eggStatesRef.current = eggs;

      if (
        eggs.length < previewEggPoolSize &&
        elapsed >= nextEggSpawnAtRef.current
      ) {
        eggs.push({
          spawnedAt: elapsed,
          settleRotationY: THREE.MathUtils.lerp(-0.35, 0.35, Math.random()),
          startRotationY: THREE.MathUtils.lerp(-0.75, 0.75, Math.random()),
          roamCenterX: THREE.MathUtils.lerp(-0.28, 0.3, Math.random()),
          settleY: previewEggFloorY,
          roamCenterZ: THREE.MathUtils.lerp(-0.04, 0.24, Math.random()),
          startX: THREE.MathUtils.lerp(-0.04, 0.06, Math.random()),
          startY: THREE.MathUtils.lerp(0.08, 0.16, Math.random()),
          startZ: THREE.MathUtils.lerp(-0.02, 0.04, Math.random()),
          roamRadiusX: THREE.MathUtils.lerp(0.08, 0.18, Math.random()),
          roamRadiusZ: THREE.MathUtils.lerp(0.04, 0.14, Math.random()),
          roamSpeed:
            THREE.MathUtils.lerp(0.72, 1.22, Math.random()) *
            (Math.random() > 0.5 ? 1 : -1),
          roamPhase: Math.random() * Math.PI * 2,
          wobblePhase: Math.random() * Math.PI * 2,
          rollSpeed: THREE.MathUtils.lerp(4.8, 7.4, Math.random())
        });
        const nextTaunt = getNextChickenPreviewEggTaunt(previewTauntSequenceRef.current, decorativeEggsEnabled);
        if (nextTaunt) {
          previewTauntSequenceRef.current = nextTaunt.sequence;
          previewTauntExpiresAtRef.current = elapsed + nextTaunt.remaining;
          setPreviewTaunt(nextTaunt.message);
        }
        nextEggSpawnAtRef.current = elapsed + getNextChickenPreviewEggDelay();
      }

      if (previewTauntMessageRef.current !== null && elapsed >= previewTauntExpiresAtRef.current) {
        previewTauntExpiresAtRef.current = 0;
        setPreviewTaunt(null);
      }
    }

    for (let eggIndex = 0; eggIndex < previewEggPoolSize; eggIndex += 1) {
      const egg = eggStatesRef.current[eggIndex];
      const eggGroup = eggRefsCurrent[eggIndex];
      if (!eggGroup) {
        continue;
      }

      if (!egg) {
        eggGroup.visible = false;
        continue;
      }

      const dropProgress = Math.min(1, (elapsed - egg.spawnedAt) / previewEggDropDuration);
      const easedDrop = 1 - Math.pow(1 - dropProgress, 3);
      const settleBounce = Math.sin(dropProgress * Math.PI) * 0.05 * (1 - dropProgress);
      const travelElapsed = Math.max(0, elapsed - egg.spawnedAt - previewEggDropDuration);
      const roamAngle = egg.roamPhase + travelElapsed * egg.roamSpeed;
      const roamX =
        Math.cos(roamAngle) * egg.roamRadiusX +
        Math.sin(travelElapsed * 1.9 + egg.wobblePhase) * 0.02;
      const roamZ =
        Math.sin(roamAngle * 0.82 + egg.wobblePhase * 0.35) * egg.roamRadiusZ +
        Math.cos(travelElapsed * 1.45 + egg.wobblePhase) * 0.014;
      const currentX = THREE.MathUtils.lerp(
        egg.startX,
        egg.roamCenterX + roamX,
        easedDrop
      );
      const currentZ = THREE.MathUtils.lerp(
        egg.startZ,
        egg.roamCenterZ + roamZ,
        easedDrop
      );
      const rollingVelocityX = -Math.sin(roamAngle) * egg.roamRadiusX * egg.roamSpeed;
      const rollingVelocityZ =
        Math.cos(roamAngle * 0.82 + egg.wobblePhase * 0.35) *
        egg.roamRadiusZ *
        egg.roamSpeed *
        0.82;

      eggGroup.visible = true;
      eggGroup.position.set(
        currentX,
        THREE.MathUtils.lerp(egg.startY, egg.settleY, easedDrop) + settleBounce,
        currentZ
      );
      eggGroup.rotation.set(
        rollingVelocityZ * egg.rollSpeed,
        THREE.MathUtils.lerp(egg.startRotationY, egg.settleRotationY, easedDrop),
        -rollingVelocityX * egg.rollSpeed
      );
    }

    previousGroundedRef.current = grounded;
    previousVelocityYRef.current = velocityY;
  });

  return (
    <group
      position={groupPosition}
      ref={groupRef}
      scale={scale}
    >
      <mesh
        geometry={playerShadowGeometry}
        material={materialBundle.shadow}
        position={[0, -0.56, 0]}
        ref={shadowRef}
        rotation={[-Math.PI / 2, 0, 0]}
      />
      <group ref={tauntAnchorRef}>
        {previewTauntMessage && (
          <Html zIndexRange={[80, 0]}>
            <ChickenTauntBubble message={previewTauntMessage} />
          </Html>
        )}
      </group>
      {Array.from({ length: previewEggPoolSize }, (_, index) => (
        <group
          key={`preview-egg-${index}`}
          ref={(eggGroup) => {
            if (eggGroup) {
              eggRefs.current[index] = eggGroup;
            }
          }}
          visible={false}
        >
          <mesh
            geometry={previewEggBaseGeometry}
            material={propMaterials.egg}
            position={[0, -0.12, 0]}
          />
          <mesh
            geometry={previewEggMiddleGeometry}
            material={propMaterials.egg}
            position={[0, 0.04, 0]}
          />
          <mesh
            geometry={previewEggCapGeometry}
            material={propMaterials.egg}
            position={[0, 0.22, 0]}
          />
        </group>
      ))}
      <primitive
        dispose={null}
        object={rig.root}
      />
    </group>
  );
}
