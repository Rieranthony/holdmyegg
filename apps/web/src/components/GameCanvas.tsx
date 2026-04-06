import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Sky } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { CSSProperties, MutableRefObject } from "react";
import { type MutableVoxelWorld, type Vec3i } from "@out-of-bounds/map";
import type { GameMode, OutOfBoundsSimulation, SimulationPerformanceDiagnostics } from "@out-of-bounds/sim";
import {
  aimCameraConfig,
  applyFreeLookDelta,
  chaseCameraConfig,
  dampScalar,
  getAimRigState,
  getForwardSpeedRatio,
  getPlanarForwardBetweenPoints,
  getSpeedCameraBlend,
  getRuntimeFocusRayDistance,
  getYawFromPlanarVector
} from "../game/camera";
import { useRendererQualityProfile } from "../game/quality";
import {
  emptyFocusState,
  getFocusVisualState,
  resolveVoxelFocusState,
  type FocusVisualState,
  type VoxelFocusState
} from "../game/focus";
import { raycastVoxelWorld } from "../game/terrainRaycast";
import { buildPlayerCommand, useKeyboardInput, type KeyboardInputState } from "../hooks/useKeyboardInput";
import { FallingClustersLayer } from "./FallingClusters";
import { ImpactBurstsLayer } from "./ImpactBursts";
import { EggScatterDebrisLayer, EggsLayer } from "./Eggs";
import { SkyBirds } from "./SkyBirds";
import { SkyClouds } from "./SkyClouds";
import { SkyDropsLayer } from "./SkyDrops";
import { PlayersLayer } from "./Players";
import { type TerrainRenderStats, type VoxelInteractPayload, VoxelWorldView } from "./VoxelWorld";
import { WorldPropsLayer } from "./WorldProps";

export type ActiveMode = "editor" | GameMode;
export type EditorTool = "add" | "erase" | "spawn" | "prop";

interface RuntimeActionCounts {
  destroy: number;
}

interface RuntimeOrbitInputState {
  pendingDeltaX: number;
  pendingDeltaY: number;
}

interface FrameDiagnostics {
  fps: number;
  p95FrameMs: number;
  renderCalls: number;
  renderTriangles: number;
  geometries: number;
  textures: number;
  runtime: RuntimePhaseDiagnostics;
}

interface RuntimePhaseDiagnostics extends SimulationPerformanceDiagnostics {
  dirtyChunkCallbackMs: number;
}

interface FixedStepCatchUpResult {
  accumulator: number;
  droppedMs: number;
  clamped: boolean;
  stepsToRun: number;
}

const emptyTerrainStats = (): TerrainRenderStats => ({
  chunkCount: 0,
  frustumVisibleChunkCount: 0,
  visibleVoxelCount: 0,
  triangleCount: 0,
  drawCallCount: 0,
  rebuildDurationMs: 0,
  renderer: "groupedMaterials"
});

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

const emptyRuntimePhaseDiagnostics = (): RuntimePhaseDiagnostics => ({
  skyDropUpdateMs: 0,
  skyDropLandingMs: 0,
  detachedComponentMs: 0,
  fallingClusterLandingMs: 0,
  fixedStepMaxStepsPerFrame: 0,
  fixedStepClampedFrames: 0,
  fixedStepDroppedMs: 0,
  dirtyChunkCallbackMs: 0
});

const MAX_FIXED_STEPS_PER_FRAME = 5;
const MAX_FRAME_DELTA_SECONDS = 0.1;

const mergeRuntimePhaseDiagnostics = (
  target: RuntimePhaseDiagnostics,
  source: SimulationPerformanceDiagnostics
) => {
  target.skyDropUpdateMs = Math.max(target.skyDropUpdateMs, source.skyDropUpdateMs);
  target.skyDropLandingMs = Math.max(target.skyDropLandingMs, source.skyDropLandingMs);
  target.detachedComponentMs = Math.max(target.detachedComponentMs, source.detachedComponentMs);
  target.fallingClusterLandingMs = Math.max(target.fallingClusterLandingMs, source.fallingClusterLandingMs);
  target.fixedStepMaxStepsPerFrame = Math.max(target.fixedStepMaxStepsPerFrame, source.fixedStepMaxStepsPerFrame);
  target.fixedStepClampedFrames += source.fixedStepClampedFrames;
  target.fixedStepDroppedMs += source.fixedStepDroppedMs;
};

export const resolveFixedStepCatchUp = (
  accumulator: number,
  delta: number,
  step: number,
  maxStepsPerFrame = MAX_FIXED_STEPS_PER_FRAME,
  maxDeltaSeconds = MAX_FRAME_DELTA_SECONDS
): FixedStepCatchUpResult => {
  const boundedDelta = Math.min(delta, maxDeltaSeconds);
  const nextAccumulator = accumulator + boundedDelta;
  const availableSteps = Math.floor(nextAccumulator / step);

  if (availableSteps <= maxStepsPerFrame) {
    return {
      accumulator: nextAccumulator - availableSteps * step,
      droppedMs: 0,
      clamped: false,
      stepsToRun: availableSteps
    };
  }

  const remainder = nextAccumulator - availableSteps * step;
  return {
    accumulator: remainder,
    droppedMs: (availableSteps - maxStepsPerFrame) * step * 1000,
    clamped: true,
    stepsToRun: maxStepsPerFrame
  };
};

const consumeRuntimePhaseDiagnostics = (ref: MutableRefObject<RuntimePhaseDiagnostics>) => {
  const snapshot = { ...ref.current };
  ref.current = emptyRuntimePhaseDiagnostics();
  return snapshot;
};

interface GameCanvasProps {
  mode: ActiveMode;
  editorWorld: MutableVoxelWorld;
  editorRevision: number;
  editorDirtyChunkKeys: string[];
  matchColorSeed: number;
  runtime: OutOfBoundsSimulation;
  runtimeRevision: number;
  runtimeDirtyChunkKeys: string[];
  playerIds: string[];
  onEditorInteract: (payload: VoxelInteractPayload) => void;
  onRuntimeTerrainChange: (revision: number, dirtyChunkKeys: string[]) => void;
  onReturnToMenu?: () => void;
}

export function GameCanvas({
  mode,
  editorWorld,
  editorRevision,
  editorDirtyChunkKeys,
  matchColorSeed,
  runtime,
  runtimeRevision,
  runtimeDirtyChunkKeys,
  playerIds,
  onEditorInteract,
  onRuntimeTerrainChange,
  onReturnToMenu
}: GameCanvasProps) {
  const keyboardRef = useKeyboardInput();
  const cameraForwardRef = useRef({ x: 1, z: 0 });
  const canvasElementRef = useRef<HTMLCanvasElement | null>(null);
  const runtimeFocusRef = useRef<VoxelFocusState>(emptyFocusState());
  const runtimeActionsRef = useRef<RuntimeActionCounts>({
    destroy: 0
  });
  const runtimeOrbitRef = useRef<RuntimeOrbitInputState>({
    pendingDeltaX: 0,
    pendingDeltaY: 0
  });
  const runtimePhaseDiagnosticsRef = useRef<RuntimePhaseDiagnostics>(emptyRuntimePhaseDiagnostics());
  const [reticleVisual, setReticleVisual] = useState<FocusVisualState>(() =>
    getFocusVisualState(emptyFocusState())
  );
  const [canvasMountVersion, setCanvasMountVersion] = useState(0);
  const [runtimePaused, setRuntimePaused] = useState(mode !== "editor");
  const [pointerLocked, setPointerLocked] = useState(false);
  const [runtimeHasCapturedPointer, setRuntimeHasCapturedPointer] = useState(false);
  const [terrainStats, setTerrainStats] = useState<TerrainRenderStats>(() => emptyTerrainStats());
  const [frameDiagnostics, setFrameDiagnostics] = useState<FrameDiagnostics | null>(null);
  const qualityProfile = useRendererQualityProfile();
  const isEditor = mode === "editor";
  const isRuntime = !isEditor;
  const world = isEditor ? editorWorld : runtime.getWorld();
  const revision = isEditor ? editorRevision : runtimeRevision;
  const dirtyChunkKeys = isEditor ? editorDirtyChunkKeys : runtimeDirtyChunkKeys;
  const arenaSpan = Math.max(world.size.x, world.size.z);
  const fogNear = Math.max(36, arenaSpan * 0.45);
  const fogFar = Math.max(fogNear + 40, arenaSpan + 44);
  const groundPlaneSize: [number, number] = [world.size.x + 32, world.size.z + 32];
  const directionalLightPosition: [number, number, number] = [
    world.size.x * 0.72,
    Math.max(world.size.y + 24, 56),
    world.size.z * 0.5
  ];
  const skyDistance = Math.max(180, arenaSpan * 3);

  useEffect(() => {
    runtimeFocusRef.current = emptyFocusState();
    setReticleVisual(getFocusVisualState(emptyFocusState()));
    runtimeActionsRef.current = {
      destroy: 0
    };
    runtimeOrbitRef.current = {
      pendingDeltaX: 0,
      pendingDeltaY: 0
    };
    runtimePhaseDiagnosticsRef.current = emptyRuntimePhaseDiagnostics();
    setPointerLocked(false);
    setRuntimeHasCapturedPointer(false);
    setRuntimePaused(mode !== "editor");
  }, [mode]);

  useEffect(() => {
    if (!isRuntime) {
      document.exitPointerLock?.();
      return;
    }

    const onPointerLockChange = () => {
      const locked = document.pointerLockElement === canvasElementRef.current;
      setPointerLocked(locked);
      setRuntimeHasCapturedPointer((current) => current || locked);
      setRuntimePaused(!locked);
    };

    document.addEventListener("pointerlockchange", onPointerLockChange);
    return () => {
      document.removeEventListener("pointerlockchange", onPointerLockChange);
      if (document.pointerLockElement === canvasElementRef.current) {
        document.exitPointerLock?.();
      }
    };
  }, [isRuntime]);

  useEffect(() => {
    const canvasElement = canvasElementRef.current;
    if (!canvasElement) {
      return;
    }

    canvasElement.style.cursor = isEditor ? "default" : "none";
    canvasElement.style.touchAction = isEditor ? "auto" : "none";

    if (isEditor) {
      return () => {
        canvasElement.style.cursor = "default";
        canvasElement.style.touchAction = "auto";
      };
    }

    const onPointerDown = (event: PointerEvent) => {
      if (document.pointerLockElement !== canvasElement) {
        canvasElement.requestPointerLock?.();
        return;
      }

      if (event.button === 0) {
        runtimeActionsRef.current.destroy += 1;
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      if (document.pointerLockElement !== canvasElement) {
        return;
      }

      const orbit = runtimeOrbitRef.current;
      orbit.pendingDeltaX += event.movementX;
      orbit.pendingDeltaY += event.movementY;
    };
    const onContextMenu = (event: MouseEvent) => event.preventDefault();

    canvasElement.addEventListener("pointerdown", onPointerDown);
    canvasElement.addEventListener("pointermove", onPointerMove);
    canvasElement.addEventListener("contextmenu", onContextMenu);
    return () => {
      canvasElement.removeEventListener("pointerdown", onPointerDown);
      canvasElement.removeEventListener("pointermove", onPointerMove);
      canvasElement.removeEventListener("contextmenu", onContextMenu);
      canvasElement.style.cursor = "default";
      canvasElement.style.touchAction = "auto";
    };
  }, [canvasMountVersion, isEditor]);

  const requestRuntimeLock = () => {
    if (isEditor) {
      return;
    }

    canvasElementRef.current?.requestPointerLock?.();
  };

  const handleReturnToMenu = () => {
    if (document.pointerLockElement === canvasElementRef.current) {
      document.exitPointerLock?.();
    }

    onReturnToMenu?.();
  };

  return (
    <>
      <Canvas
        camera={{ position: [20, 18, 20], fov: 40 }}
        dpr={qualityProfile.dpr}
        gl={{ antialias: qualityProfile.antialias, powerPreference: "high-performance" }}
        performance={{ min: qualityProfile.tier === "low" ? 0.5 : 0.65 }}
        onCreated={({ gl }) => {
          canvasElementRef.current = gl.domElement;
          setCanvasMountVersion((value) => value + 1);
          gl.setClearColor("#8fc6e0");
        }}
      >
        <color
          attach="background"
          args={["#8fc6e0"]}
        />
        <fog
          attach="fog"
          args={["#8fc6e0", fogNear, fogFar]}
        />
        <ambientLight intensity={0.45} />
        <directionalLight
          intensity={1.36}
          position={directionalLightPosition}
        />
        <hemisphereLight
          intensity={0.22}
          color="#fef7df"
          groundColor="#4c6156"
        />
        {qualityProfile.enableAtmosphereSky && (
          <Sky
            distance={skyDistance}
            sunPosition={[6, 12, 4]}
            inclination={0.48}
            azimuth={0.23}
          />
        )}
        {qualityProfile.enableClouds && (
          <SkyClouds
            maxCloudCount={qualityProfile.tier === "high" ? 5 : 3}
            worldSize={world.size}
          />
        )}
        {qualityProfile.enableBirds && <SkyBirds worldSize={world.size} />}
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[world.size.x / 2, -0.01, world.size.z / 2]}
        >
          <planeGeometry args={groundPlaneSize} />
          <meshStandardMaterial color="#050505" />
        </mesh>
        <VoxelWorldView
          world={world}
          revision={revision}
          dirtyChunkKeys={dirtyChunkKeys}
          editable={isEditor}
          onInteract={onEditorInteract}
          onTerrainStatsChange={import.meta.env.DEV ? setTerrainStats : undefined}
        />
        <WorldPropsLayer
          decorationDensity={qualityProfile.decorationDensity}
          world={world}
          revision={revision}
          updateMode={isEditor ? "editor-live" : "runtime-static"}
          editable={isEditor}
          onInteract={onEditorInteract}
        />
        {!isEditor && (
          <PlayersLayer
            runtime={runtime}
            playerIds={playerIds}
            localPlayerId={runtime.getLocalPlayerId()}
            matchColorSeed={matchColorSeed}
            detailDistance={qualityProfile.avatarDetailDistance}
          />
        )}
        {!isEditor && <FallingClustersLayer runtime={runtime} />}
        {!isEditor && (
          <EggScatterDebrisLayer
            maxInstances={qualityProfile.maxEggDebrisInstances}
            runtime={runtime}
          />
        )}
        {!isEditor && <EggsLayer runtime={runtime} />}
        {!isEditor && <SkyDropsLayer runtime={runtime} />}
        {!isEditor && (
          <ImpactBurstsLayer
            maxBursts={qualityProfile.maxImpactBursts}
            runtime={runtime}
            playerIds={playerIds}
          />
        )}
        {!isEditor && (
          <FocusTargetingLayer
            runtime={runtime}
            focusStateRef={runtimeFocusRef}
            onVisualChange={setReticleVisual}
          />
        )}
        {!isEditor && (
          <GameLoop
            keyboardRef={keyboardRef}
            cameraForwardRef={cameraForwardRef}
            focusStateRef={runtimeFocusRef}
            runtimeActionsRef={runtimeActionsRef}
            runtimePhaseDiagnosticsRef={runtimePhaseDiagnosticsRef}
            paused={runtimePaused}
            runtime={runtime}
            onRuntimeTerrainChange={onRuntimeTerrainChange}
          />
        )}
        {!isEditor && (
          <CameraRig
            runtime={runtime}
            cameraForwardRef={cameraForwardRef}
            orbitInputRef={runtimeOrbitRef}
          />
        )}
        {isEditor && <EditorCamera world={world} />}
        {import.meta.env.DEV && (
          <PerformanceProbe
            onFrameDiagnosticsChange={setFrameDiagnostics}
            runtimePhaseDiagnosticsRef={runtimePhaseDiagnosticsRef}
          />
        )}
      </Canvas>
      <RuntimeReticle
        mode={mode}
        visual={reticleVisual}
      />
      <DevPerformanceOverlay
        frameDiagnostics={frameDiagnostics}
        qualityLabel={qualityProfile.tier}
        stats={terrainStats}
        targetFps={qualityProfile.budgets.targetFps}
      />
      {isRuntime && runtimePaused && (
        <RuntimePauseOverlay
          hasStarted={runtimeHasCapturedPointer}
          onResume={requestRuntimeLock}
          onReturnToMenu={handleReturnToMenu}
        />
      )}
    </>
  );
}

function GameLoop({
  keyboardRef,
  cameraForwardRef,
  focusStateRef,
  runtimeActionsRef,
  runtimePhaseDiagnosticsRef,
  paused,
  runtime,
  onRuntimeTerrainChange
}: {
  keyboardRef: MutableRefObject<KeyboardInputState>;
  cameraForwardRef: MutableRefObject<{ x: number; z: number }>;
  focusStateRef: MutableRefObject<VoxelFocusState>;
  runtimeActionsRef: MutableRefObject<RuntimeActionCounts>;
  runtimePhaseDiagnosticsRef: MutableRefObject<RuntimePhaseDiagnostics>;
  paused: boolean;
  runtime: OutOfBoundsSimulation;
  onRuntimeTerrainChange: (revision: number, dirtyChunkKeys: string[]) => void;
}) {
  const accumulatorRef = useRef(0);
  const lastTerrainRevisionRef = useRef(runtime.getWorld().getTerrainRevision());
  const consumedActionsRef = useRef<RuntimeActionCounts>({
    destroy: 0
  });
  const previousBuildPressedRef = useRef(false);
  const previousEggPressedRef = useRef(false);

  useFrame((_, delta) => {
    if (paused) {
      accumulatorRef.current = 0;
      previousBuildPressedRef.current = keyboardRef.current.build;
      previousEggPressedRef.current = keyboardRef.current.egg;
      keyboardRef.current.jumpPressed = false;
      keyboardRef.current.jumpReleased = false;
      return;
    }

    const step = 1 / runtime.config.tickRate;
    const catchUp = resolveFixedStepCatchUp(accumulatorRef.current, delta, step);
    accumulatorRef.current = catchUp.accumulator;

    if (catchUp.stepsToRun > 0) {
      runtimePhaseDiagnosticsRef.current.fixedStepMaxStepsPerFrame = Math.max(
        runtimePhaseDiagnosticsRef.current.fixedStepMaxStepsPerFrame,
        catchUp.stepsToRun
      );
    }
    if (catchUp.clamped) {
      runtimePhaseDiagnosticsRef.current.fixedStepClampedFrames += 1;
      runtimePhaseDiagnosticsRef.current.fixedStepDroppedMs += catchUp.droppedMs;
    }

    for (let stepIndex = 0; stepIndex < catchUp.stepsToRun; stepIndex += 1) {
      const localPlayerId = runtime.getLocalPlayerId();
      const command = buildPlayerCommand(keyboardRef.current, cameraForwardRef.current);
      const focusState = focusStateRef.current;

      if (focusState.focusedVoxel) {
        command.targetVoxel = { ...focusState.focusedVoxel };
      }

      if (focusState.targetNormal) {
        command.targetNormal = { ...focusState.targetNormal };
      }

      command.destroy = runtimeActionsRef.current.destroy > consumedActionsRef.current.destroy;
      command.place = keyboardRef.current.build && !previousBuildPressedRef.current;
      command.layEgg = keyboardRef.current.egg && !previousEggPressedRef.current;
      consumedActionsRef.current.destroy = runtimeActionsRef.current.destroy;
      previousBuildPressedRef.current = keyboardRef.current.build;
      previousEggPressedRef.current = keyboardRef.current.egg;

      runtime.step(localPlayerId ? { [localPlayerId]: command } : {}, step);
      mergeRuntimePhaseDiagnostics(runtimePhaseDiagnosticsRef.current, runtime.consumePerformanceDiagnostics());
      keyboardRef.current.jumpPressed = false;
      keyboardRef.current.jumpReleased = false;
    }

    const terrainRevision = runtime.getWorld().getTerrainRevision();
    if (terrainRevision !== lastTerrainRevisionRef.current) {
      lastTerrainRevisionRef.current = terrainRevision;
      const callbackStart = now();
      onRuntimeTerrainChange(terrainRevision, runtime.consumeDirtyChunkKeys());
      runtimePhaseDiagnosticsRef.current.dirtyChunkCallbackMs = Math.max(
        runtimePhaseDiagnosticsRef.current.dirtyChunkCallbackMs,
        now() - callbackStart
      );
    }
  });

  return null;
}

function CameraRig({
  runtime,
  cameraForwardRef,
  orbitInputRef
}: {
  runtime: OutOfBoundsSimulation;
  cameraForwardRef: MutableRefObject<{ x: number; z: number }>;
  orbitInputRef: MutableRefObject<RuntimeOrbitInputState>;
}) {
  const desiredLookTarget = useRef(new THREE.Vector3());
  const currentLookTarget = useRef(new THREE.Vector3());
  const desiredCameraPosition = useRef(new THREE.Vector3());
  const lookYawRef = useRef<number | null>(null);
  const lookPitchRef = useRef(aimCameraConfig.defaultPitch);
  const speedBlendRef = useRef(0);
  const hasInitializedRef = useRef(false);
  const trackedPlayerIdRef = useRef<string | null>(null);
  const { camera } = useThree();

  useFrame((_, delta) => {
    const localPlayerId = runtime.getLocalPlayerId();
    if (!localPlayerId) {
      return;
    }

    const player = runtime.getPlayerRuntimeState(localPlayerId);
    if (!player || (!player.fallingOut && (!player.alive || player.respawning))) {
      return;
    }

    if (trackedPlayerIdRef.current !== localPlayerId) {
      trackedPlayerIdRef.current = localPlayerId;
      hasInitializedRef.current = false;
      lookYawRef.current = null;
      lookPitchRef.current = aimCameraConfig.defaultPitch;
      speedBlendRef.current = 0;
      orbitInputRef.current.pendingDeltaX = 0;
      orbitInputRef.current.pendingDeltaY = 0;
    }

    if (lookYawRef.current === null) {
      lookYawRef.current = getYawFromPlanarVector(player.facing);
    }

    if (orbitInputRef.current.pendingDeltaX !== 0 || orbitInputRef.current.pendingDeltaY !== 0) {
      const nextLook = applyFreeLookDelta(
        {
          yaw: lookYawRef.current ?? 0,
          pitch: lookPitchRef.current
        },
        {
          deltaX: orbitInputRef.current.pendingDeltaX,
          deltaY: orbitInputRef.current.pendingDeltaY
        }
      );

      lookYawRef.current = nextLook.yaw;
      lookPitchRef.current = nextLook.pitch;
      orbitInputRef.current.pendingDeltaX = 0;
      orbitInputRef.current.pendingDeltaY = 0;
    }

    const aimState = getAimRigState(
      player.position,
      lookYawRef.current ?? getYawFromPlanarVector(player.facing),
      lookPitchRef.current,
      speedBlendRef.current
    );
    const forwardSpeedRatio = getForwardSpeedRatio(player.velocity, aimState.planarForward, runtime.config.moveSpeed);
    const targetSpeedBlend = getSpeedCameraBlend(forwardSpeedRatio);
    speedBlendRef.current = dampScalar(speedBlendRef.current, targetSpeedBlend, 7, delta);

    const resolvedAimState = getAimRigState(
      player.position,
      lookYawRef.current ?? getYawFromPlanarVector(player.facing),
      lookPitchRef.current,
      speedBlendRef.current
    );
    desiredLookTarget.current.set(
      resolvedAimState.aimTarget.x,
      resolvedAimState.aimTarget.y,
      resolvedAimState.aimTarget.z
    );
    desiredCameraPosition.current.set(
      resolvedAimState.cameraPosition.x,
      resolvedAimState.cameraPosition.y,
      resolvedAimState.cameraPosition.z
    );

    if (!hasInitializedRef.current) {
      hasInitializedRef.current = true;
      currentLookTarget.current.copy(desiredLookTarget.current);
      camera.position.copy(desiredCameraPosition.current);
      camera.lookAt(currentLookTarget.current);
      cameraForwardRef.current = getPlanarForwardBetweenPoints(camera.position, currentLookTarget.current);
      return;
    }

    const positionDamping = 1 - Math.exp(-delta * chaseCameraConfig.positionDamping);
    const lookTargetDamping = 1 - Math.exp(-delta * chaseCameraConfig.lookTargetDamping);
    camera.position.lerp(desiredCameraPosition.current, positionDamping);
    currentLookTarget.current.lerp(desiredLookTarget.current, lookTargetDamping);
    camera.lookAt(currentLookTarget.current);
    cameraForwardRef.current = getPlanarForwardBetweenPoints(camera.position, currentLookTarget.current);
  });

  return null;
}

function FocusTargetingLayer({
  runtime,
  focusStateRef,
  onVisualChange
}: {
  runtime: OutOfBoundsSimulation;
  focusStateRef: MutableRefObject<VoxelFocusState>;
  onVisualChange: (visual: FocusVisualState) => void;
}) {
  const { camera } = useThree();
  const outlineRef = useRef<THREE.LineSegments>(null);
  const ghostRef = useRef<THREE.Mesh>(null);
  const lastVisualRef = useRef<FocusVisualState>(getFocusVisualState(emptyFocusState()));
  const outlineColor = useRef(new THREE.Color(lastVisualRef.current.outlineColor));
  const ghostColor = useRef(new THREE.Color(lastVisualRef.current.ghostColor));
  const rayOriginRef = useRef(new THREE.Vector3());
  const rayDirectionRef = useRef(new THREE.Vector3());
  const outlineGeometry = useMemo(
    () => new THREE.EdgesGeometry(new THREE.BoxGeometry(1.04, 1.04, 1.04)),
    []
  );
  const ghostGeometry = useMemo(() => new THREE.BoxGeometry(1.002, 1.002, 1.002), []);

  useEffect(
    () => () => {
      outlineGeometry.dispose();
      ghostGeometry.dispose();
    },
    [ghostGeometry, outlineGeometry]
  );

  useFrame(() => {
    const emptyState = emptyFocusState();
    const localPlayerId = runtime.getLocalPlayerId();
    const localPlayer = localPlayerId ? runtime.getPlayerRuntimeState(localPlayerId) : null;

    if (!localPlayer || !localPlayer.alive) {
      focusStateRef.current = emptyState;
      applyFocusVisuals(emptyState, outlineRef.current, ghostRef.current, outlineColor.current, ghostColor.current);
      updateFocusVisual(lastVisualRef, emptyState, onVisualChange);
      return;
    }

    camera.getWorldPosition(rayOriginRef.current);
    camera.getWorldDirection(rayDirectionRef.current);
    const terrainHit = raycastVoxelWorld(
      runtime.getWorld(),
      rayOriginRef.current,
      rayDirectionRef.current,
      getRuntimeFocusRayDistance(runtime.config.interactRange)
    );

    if (!terrainHit) {
      focusStateRef.current = emptyState;
      applyFocusVisuals(emptyState, outlineRef.current, ghostRef.current, outlineColor.current, ghostColor.current);
      updateFocusVisual(lastVisualRef, emptyState, onVisualChange);
      return;
    }

    const focusedVoxel = terrainHit.voxel;
    const hitKind = runtime.getWorld().getSolidKind(focusedVoxel.x, focusedVoxel.y, focusedVoxel.z) ?? null;
    const hitNormal = terrainHit.normal;

    const placeVoxel =
      focusedVoxel && hitNormal
        ? {
            x: focusedVoxel.x + hitNormal.x,
            y: focusedVoxel.y + hitNormal.y,
            z: focusedVoxel.z + hitNormal.z
          }
        : null;
    const focusState = resolveVoxelFocusState({
      hitVoxel: focusedVoxel,
      hitNormal,
      hitKind,
      worldSize: runtime.getWorld().size,
      playerChest: {
        x: localPlayer.position.x,
        y: localPlayer.position.y + runtime.config.playerHeight * 0.7,
        z: localPlayer.position.z
      },
      interactRange: runtime.config.interactRange,
      placementOccupied: placeVoxel
        ? runtime.getWorld().hasSolid(placeVoxel.x, placeVoxel.y, placeVoxel.z)
        : false,
      blockedByPlayer: placeVoxel ? isPlacementBlockedByPlayer(runtime, placeVoxel) : false,
      blockedByDebris: placeVoxel ? isPlacementBlockedByRuntimeDebris(runtime, placeVoxel) : false
    });

    focusStateRef.current = focusState;
    applyFocusVisuals(focusState, outlineRef.current, ghostRef.current, outlineColor.current, ghostColor.current);
    updateFocusVisual(lastVisualRef, focusState, onVisualChange);
  });

  return (
    <group>
      <lineSegments
        ref={outlineRef}
        visible={false}
      >
        <primitive object={outlineGeometry} attach="geometry" />
        <lineBasicMaterial color={lastVisualRef.current.outlineColor} />
      </lineSegments>
      <mesh
        ref={ghostRef}
        visible={false}
      >
        <primitive object={ghostGeometry} attach="geometry" />
        <meshStandardMaterial
          color={lastVisualRef.current.ghostColor}
          transparent
          opacity={lastVisualRef.current.ghostOpacity}
        />
      </mesh>
    </group>
  );
}

function RuntimePauseOverlay({
  hasStarted,
  onResume,
  onReturnToMenu
}: {
  hasStarted: boolean;
  onResume: () => void;
  onReturnToMenu: () => void;
}) {
  return (
    <div className="runtime-pause-overlay">
      <button
        aria-label="Resume play"
        className="runtime-pause-backdrop"
        onClick={onResume}
        type="button"
      />
      <div
        className="runtime-pause-card"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="panel-kicker">{hasStarted ? "Paused" : "Click To Start"}</p>
        <h2>{hasStarted ? "Mouse unlocked" : "Capture the mouse to play"}</h2>
        <p>
          {hasStarted
            ? "The match is paused. Resume to lock the cursor again, or head back to the main menu."
            : "Runtime play uses pointer lock so the aim camera can turn forever without hitting the screen edge."}
        </p>
        <div className="button-row">
          <button
            onClick={onResume}
            type="button"
          >
            Resume
          </button>
          <button
            onClick={onReturnToMenu}
            type="button"
          >
            Menu
          </button>
        </div>
      </div>
    </div>
  );
}

function RuntimeReticle({
  mode,
  visual
}: {
  mode: ActiveMode;
  visual: FocusVisualState;
}) {
  if (mode === "editor") {
    return null;
  }

  return (
    <div
      aria-hidden="true"
      className="game-reticle"
      data-testid="runtime-reticle"
      style={{ "--reticle-color": visual.reticleColor } as CSSProperties}
    >
      <span className="game-reticle__ring" />
      <span className="game-reticle__dot" />
    </div>
  );
}

function DevPerformanceOverlay({
  stats,
  frameDiagnostics,
  qualityLabel,
  targetFps
}: {
  stats: TerrainRenderStats;
  frameDiagnostics: FrameDiagnostics | null;
  qualityLabel: string;
  targetFps: number;
}) {
  if (!import.meta.env.DEV || stats.chunkCount === 0 || !frameDiagnostics) {
    return null;
  }

  return (
    <div className="terrain-stats-overlay">
      <p>Tier {qualityLabel.toUpperCase()}</p>
      <p>Budget {targetFps} FPS</p>
      <p>FPS {frameDiagnostics.fps.toFixed(1)}</p>
      <p>P95 Frame {frameDiagnostics.p95FrameMs.toFixed(2)}ms</p>
      <p>GL Calls {frameDiagnostics.renderCalls.toLocaleString()}</p>
      <p>GL Triangles {frameDiagnostics.renderTriangles.toLocaleString()}</p>
      <p>Chunks {stats.chunkCount.toLocaleString()}</p>
      <p>Visible Now {stats.frustumVisibleChunkCount.toLocaleString()}</p>
      <p>Draws {stats.drawCallCount.toLocaleString()}</p>
      <p>Triangles {stats.triangleCount.toLocaleString()}</p>
      <p>Surface Voxels {stats.visibleVoxelCount.toLocaleString()}</p>
      <p>Last Rebuild {stats.rebuildDurationMs.toFixed(2)}ms</p>
      <p>Geometries {frameDiagnostics.geometries.toLocaleString()}</p>
      <p>Textures {frameDiagnostics.textures.toLocaleString()}</p>
      <p>Sky Update {frameDiagnostics.runtime.skyDropUpdateMs.toFixed(2)}ms</p>
      <p>Sky Landing {frameDiagnostics.runtime.skyDropLandingMs.toFixed(2)}ms</p>
      <p>Collapse Scan {frameDiagnostics.runtime.detachedComponentMs.toFixed(2)}ms</p>
      <p>Cluster Landing {frameDiagnostics.runtime.fallingClusterLandingMs.toFixed(2)}ms</p>
      <p>Terrain Sync {frameDiagnostics.runtime.dirtyChunkCallbackMs.toFixed(2)}ms</p>
      <p>Catch-up Max {frameDiagnostics.runtime.fixedStepMaxStepsPerFrame.toLocaleString()}</p>
      <p>Catch-up Clamps {frameDiagnostics.runtime.fixedStepClampedFrames.toLocaleString()}</p>
      <p>Catch-up Dropped {frameDiagnostics.runtime.fixedStepDroppedMs.toFixed(2)}ms</p>
    </div>
  );
}

function applyFocusVisuals(
  focusState: VoxelFocusState,
  outline: THREE.LineSegments | null,
  ghost: THREE.Mesh | null,
  outlineColor: THREE.Color,
  ghostColor: THREE.Color
) {
  const visual = getFocusVisualState(focusState);

  if (outline) {
    outline.visible = focusState.focusedVoxel !== null;
    if (focusState.focusedVoxel) {
      outline.position.set(
        focusState.focusedVoxel.x + 0.5,
        focusState.focusedVoxel.y + 0.5,
        focusState.focusedVoxel.z + 0.5
      );
      outlineColor.set(visual.outlineColor);
      const material = outline.material as THREE.LineBasicMaterial;
      material.color.copy(outlineColor);
    }
  }

  if (ghost) {
    ghost.visible = focusState.placeVoxel !== null;
    if (focusState.placeVoxel) {
      ghost.position.set(focusState.placeVoxel.x + 0.5, focusState.placeVoxel.y + 0.5, focusState.placeVoxel.z + 0.5);
      ghostColor.set(visual.ghostColor);
      const material = ghost.material as THREE.MeshStandardMaterial;
      material.color.copy(ghostColor);
      material.opacity = visual.ghostOpacity;
    }
  }
}

function updateFocusVisual(
  visualRef: MutableRefObject<FocusVisualState>,
  focusState: VoxelFocusState,
  onVisualChange: (visual: FocusVisualState) => void
) {
  const nextVisual = getFocusVisualState(focusState);
  if (
    visualRef.current.reticleColor === nextVisual.reticleColor &&
    visualRef.current.outlineColor === nextVisual.outlineColor &&
    visualRef.current.ghostColor === nextVisual.ghostColor &&
    visualRef.current.ghostOpacity === nextVisual.ghostOpacity
  ) {
    return;
  }

  visualRef.current = nextVisual;
  onVisualChange(nextVisual);
}

function PerformanceProbe({
  onFrameDiagnosticsChange,
  runtimePhaseDiagnosticsRef
}: {
  onFrameDiagnosticsChange: (next: FrameDiagnostics) => void;
  runtimePhaseDiagnosticsRef: MutableRefObject<RuntimePhaseDiagnostics>;
}) {
  const { gl } = useThree();
  const sampleWindowRef = useRef<Float32Array>(new Float32Array(180));
  const sampleCountRef = useRef(0);
  const sampleIndexRef = useRef(0);
  const cooldownRef = useRef(0);

  useFrame((_, delta) => {
    sampleWindowRef.current[sampleIndexRef.current] = delta * 1000;
    sampleIndexRef.current = (sampleIndexRef.current + 1) % sampleWindowRef.current.length;
    sampleCountRef.current = Math.min(sampleCountRef.current + 1, sampleWindowRef.current.length);

    cooldownRef.current += delta;
    if (cooldownRef.current < 1) {
      return;
    }

    cooldownRef.current = 0;
    const samples = Array.from(sampleWindowRef.current.slice(0, sampleCountRef.current)).sort((left, right) => left - right);
    const p95FrameMs = samples[Math.max(0, Math.floor(samples.length * 0.95) - 1)] ?? 0;
    onFrameDiagnosticsChange({
      fps: delta > 0 ? 1 / delta : 0,
      p95FrameMs,
      renderCalls: gl.info.render.calls,
      renderTriangles: gl.info.render.triangles,
      geometries: gl.info.memory.geometries,
      textures: gl.info.memory.textures,
      runtime: consumeRuntimePhaseDiagnostics(runtimePhaseDiagnosticsRef)
    });
  });

  return null;
}

function isPlacementBlockedByPlayer(runtime: OutOfBoundsSimulation, targetVoxel: Vec3i) {
  const playerRadius = runtime.config.playerRadius;
  const playerHeight = runtime.config.playerHeight;

  return runtime.getPlayerIds().some((playerId) => {
    const player = runtime.getPlayerRuntimeState(playerId);
    if (!player || !player.alive) {
      return false;
    }

    const voxelMinY = targetVoxel.y;
    const voxelMaxY = targetVoxel.y + 1;
    const playerMinY = player.position.y;
    const playerMaxY = player.position.y + playerHeight;
    if (playerMaxY <= voxelMinY || playerMinY >= voxelMaxY) {
      return false;
    }

    const closestX = THREE.MathUtils.clamp(player.position.x, targetVoxel.x, targetVoxel.x + 1);
    const closestZ = THREE.MathUtils.clamp(player.position.z, targetVoxel.z, targetVoxel.z + 1);
    const deltaX = player.position.x - closestX;
    const deltaZ = player.position.z - closestZ;
    return deltaX * deltaX + deltaZ * deltaZ < playerRadius * playerRadius - 0.0001;
  });
}

function isPlacementBlockedByFallingClusters(runtime: OutOfBoundsSimulation, targetVoxel: Vec3i) {
  return runtime.getFallingClusterIds().some((clusterId) => {
    const cluster = runtime.getFallingClusterRuntimeState(clusterId);
    if (!cluster) {
      return false;
    }

    return cluster.voxels.some((voxel) => {
      if (voxel.x !== targetVoxel.x || voxel.z !== targetVoxel.z) {
        return false;
      }

      const voxelMinY = voxel.y + cluster.offsetY;
      const voxelMaxY = voxelMinY + 1;
      return !(targetVoxel.y + 1 <= voxelMinY || targetVoxel.y >= voxelMaxY);
    });
  });
}

function isPlacementBlockedBySkyDrops(runtime: OutOfBoundsSimulation, targetVoxel: Vec3i) {
  return runtime.getSkyDropIds().some((skyDropId) => {
    const skyDrop = runtime.getSkyDropRuntimeState(skyDropId);
    if (!skyDrop) {
      return false;
    }

    if (skyDrop.landingVoxel.x !== targetVoxel.x || skyDrop.landingVoxel.z !== targetVoxel.z) {
      return false;
    }

    const voxelMinY = skyDrop.landingVoxel.y + skyDrop.offsetY;
    const voxelMaxY = voxelMinY + 1;
    return !(targetVoxel.y + 1 <= voxelMinY || targetVoxel.y >= voxelMaxY);
  });
}

function isPlacementBlockedByRuntimeDebris(runtime: OutOfBoundsSimulation, targetVoxel: Vec3i) {
  return isPlacementBlockedByFallingClusters(runtime, targetVoxel) || isPlacementBlockedBySkyDrops(runtime, targetVoxel);
}

function EditorCamera({ world }: { world: MutableVoxelWorld }) {
  const { camera } = useThree();

  useEffect(() => {
    const span = Math.max(world.size.x, world.size.z);
    camera.position.set(world.size.x / 2 + span * 0.46, span * 0.34, world.size.z / 2 + span * 0.4);
    camera.lookAt(world.size.x / 2, 10, world.size.z / 2);
  }, [camera, world]);

  return null;
}
