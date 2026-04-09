import * as THREE from "three";
import {
  MutableVoxelWorld,
  createDefaultArenaMap,
  getMapPropVoxels,
  normalizeArenaBudgetMapDocument,
  type MapDocumentV1
} from "@out-of-bounds/map";
import {
  defaultSimulationConfig,
  getHudEggStatus,
  getEggChargeAlpha,
  getEggTrajectoryPosition,
  getGroundedEggLaunchVelocity,
  type HudState,
  type RuntimeInteractionFocusState,
  type RuntimeEggScatterDebrisState,
  type RuntimeEggState,
  type RuntimePlayerState,
  type RuntimeSkyDropState,
  type RuntimeVoxelBurstState,
  type FallingClusterViewState,
  type SimulationInitialSpawnStyle
} from "@out-of-bounds/sim";
import { propMaterials } from "../game/propMaterials";
import {
  getDecorationDensityForQualityTier,
  type QualityTier
} from "../game/quality";
import {
  aimCameraConfig,
  applyFreeLookDelta,
  chaseCameraConfig,
  clampLookPitch,
  clampSpaceLookPitch,
  dampScalar,
  getAimRigState,
  getForwardSpeedRatio,
  getLookDirection,
  getPlanarForwardBetweenPoints,
  getPlanarVectorFromYaw,
  getSpaceAimRigState,
  getSpeedCameraBlend,
  getYawFromPlanarVector,
  spaceCameraConfig,
  stepAngleToward
} from "../game/camera";
import {
  createDefaultRuntimeControlSettings,
  normalizeRuntimeControlSettings,
  type RuntimeControlSettings
} from "../game/runtimeControlSettings";
import { cloudPresets, getVoxelCloudPosition, type VoxelCloudPreset } from "../game/clouds";
import { getPlayerBlobShadowState } from "../game/cheapShadows";
import { createChickenAvatarRig, type ChickenAvatarRig } from "../game/chickenModel";
import { getChickenPalette, type ChickenPaletteName } from "../game/colors";
import { eggVisualDefaults, getEggVisualState } from "../game/eggs";
import { isEggLaunchKeyCode } from "../game/eggLaunchControls";
import { eggBaseGeometry, eggCapGeometry, eggMiddleGeometry } from "../game/eggVisualRecipe";
import { getFallingClusterVisualState } from "../game/fallingClusters";
import { buildPlayerCommand, initialKeyboardInputState, type KeyboardInputState } from "../game/input";
import { configureDynamicInstancedMesh, finalizeDynamicInstancedMesh, finalizeStaticInstancedMesh } from "../game/instancedMeshes";
import {
  chickenFeatherGeometry,
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
  getEggScatterDebrisVisualState,
  getVoxelBurstMaterialProfile,
  getVoxelBurstParticleCount,
  getVoxelBurstParticleState,
  getVoxelBurstShockwaveState
} from "../game/voxelFx";
import {
  chickenModelRig,
  createChickenMaterialBundle,
  disposeChickenMaterialBundle,
  playerRingGeometry,
  playerShadowGeometry,
  type ChickenMaterialBundle
} from "../game/sceneAssets";
import { getSkyDropVisualState } from "../game/skyDrops";
import {
  buildSurfaceDecorations,
  filterSurfaceDecorationsByDensity,
  type SurfaceDecoration
} from "../game/surfaceDecorations";
import {
  SunShadows,
  enableSunShadowLayer,
  syncDirectionalLightSunLayer
} from "../game/sunShadows";
import { type TerrainRaycastHit, raycastVoxelWorld, resolveTerrainRaycastHit } from "../game/terrainRaycast";
import {
  type BlockRenderProfile,
  getBlockRenderProfile,
  getTerrainChunkMaterials,
  getVoxelMaterials,
  sharedVoxelGeometry,
  updateVoxelMaterialAnimation,
  voxelTextures
} from "../game/voxelMaterials";
import type {
  WorkerRequestMessage,
  WorkerResponseMessage
} from "./protocol";
import { AuthoritativeReplica } from "./authoritativeReplica";
import {
  MAX_TYPED_TEXT_BYTES,
  packRuntimeInputCommand,
  type RuntimeInputCommand
} from "./runtimeInput";
import {
  createLocalGameWorker,
  type GameWorkerFactory,
  type GameWorkerLike
} from "./workerBridge";
import type {
  ActiveShellMode,
  EditorPanelState,
  GameDiagnostics,
  PointerCaptureFailureReason,
  RuntimeOverlayState,
  RuntimeRenderFrame,
  RuntimePauseState,
  ShellPresentation,
  TerrainChunkPatchPayload
} from "./types";

interface GameClientCallbacks {
  onDiagnostics?: (diagnostics: GameDiagnostics) => void;
  onEditorStateChange?: (editorState: EditorPanelState) => void;
  onHudStateChange?: (hudState: HudState | null) => void;
  onRuntimeOverlayChange?: (state: RuntimeOverlayState | null) => void;
  onPauseStateChange?: (state: RuntimePauseState) => void;
  onReadyToDisplay?: () => void;
  onStatus?: (message: string) => void;
}

interface GameClientMountOptions extends GameClientCallbacks {
  canvas: HTMLCanvasElement;
  initialDocument?: MapDocumentV1;
  initialMode: ActiveShellMode;
  initialSpawnStyle?: SimulationInitialSpawnStyle;
  localPlayerName?: string;
  localPlayerPaletteName?: ChickenPaletteName | null;
  matchColorSeed: number;
  presentation?: ShellPresentation;
  qualityTier?: QualityTier;
  runtimeSettings?: RuntimeControlSettings;
  workerFactory?: GameWorkerFactory;
}

type GameShellIntent =
  | { type: "load_map"; document: MapDocumentV1 }
  | { type: "set_editor_state"; next: Partial<EditorPanelState> };

interface PlayerVisual extends ChickenAvatarRig {
  paletteName: ChickenPaletteName;
  group: THREE.Group;
  bomb: THREE.Group;
  bombMaterial: THREE.MeshStandardMaterial;
  ring: THREE.Mesh;
  ringMaterial: THREE.MeshBasicMaterial;
  shadow: THREE.Mesh;
  shadowMaterial: THREE.MeshBasicMaterial;
  wingletTraceMaterial: THREE.MeshBasicMaterial;
  materialBundle: ChickenMaterialBundle;
  targetPosition: THREE.Vector3;
  motionSeed: number;
  previousGrounded: boolean;
  previousVelocityY: number;
  landingRollRemaining: number;
}

interface EggVisual {
  group: THREE.Group;
  material: THREE.MeshStandardMaterial;
}

interface SkyDropVisual {
  group: THREE.Group;
  ring: THREE.Mesh;
  ringMaterial: THREE.MeshBasicMaterial;
  beam: THREE.Mesh;
  beamMaterial: THREE.MeshBasicMaterial;
  cube: THREE.Mesh;
}

interface ClusterVisual {
  group: THREE.Group;
}

interface RuntimeFocusedTarget {
  voxel: { x: number; y: number; z: number };
  normal: { x: number; y: number; z: number };
}

interface DynamicOpacityMeshResource {
  geometry: THREE.BufferGeometry;
  materials: THREE.Material[];
  mesh: THREE.InstancedMesh;
  opacityAttribute: THREE.InstancedBufferAttribute;
}

interface FeatherBurstState {
  active: boolean;
  createdAt: number;
  serial: number;
  origin: THREE.Vector3;
}

type EggChargeInputSource = "key" | "pointer";

interface EggChargeState {
  active: boolean;
  startedAt: number;
  chargeAlpha: number;
  pendingThrow: boolean;
  pendingThrowCharge: number;
  pendingThrowPitch: number;
  releaseRemaining: number;
  source: EggChargeInputSource | null;
}

interface HoldActionState {
  pressed: boolean;
  startedAt: number;
  holdTriggered: boolean;
}

interface RepeatingActionState {
  pressed: boolean;
  nextPulseAt: number;
}

interface LocalFocusOverride {
  focusState: RuntimeInteractionFocusState;
  expiresAt: number;
}

interface EggTrajectoryPreviewResource {
  geometry: THREE.BufferGeometry;
  material: THREE.LineBasicMaterial;
  line: THREE.Line;
  positionAttribute: THREE.BufferAttribute;
  landingGeometry: THREE.RingGeometry;
  landingMaterial: THREE.MeshBasicMaterial;
  landingRing: THREE.Mesh;
  group: THREE.Group;
}

interface CloudVisual {
  group: THREE.Group;
  preset: VoxelCloudPreset;
}

interface SpacePlanetVisual {
  group: THREE.Group;
  materials: THREE.MeshBasicMaterial[];
  spinSpeed: number;
  wobblePhase: number;
}

interface TerrainOcclusionHit {
  anchor: THREE.Vector3;
  direction: THREE.Vector3;
  distance: number;
  hit: TerrainRaycastHit;
}

interface CoveredPlayerVisibilityResolution {
  cameraPosition: THREE.Vector3;
  occluded: boolean;
  contourVisible: boolean;
}

const backgroundColor = "#8fc6e0";
const menuGroundMaterial = new THREE.MeshBasicMaterial({ color: backgroundColor });
const runtimeOceanTexture = voxelTextures.waterTop.clone();
runtimeOceanTexture.wrapS = THREE.RepeatWrapping;
runtimeOceanTexture.wrapT = THREE.RepeatWrapping;
runtimeOceanTexture.repeat.set(14, 14);
runtimeOceanTexture.offset.set(0, 0);
runtimeOceanTexture.needsUpdate = true;
const runtimeGroundMaterial = new THREE.MeshStandardMaterial({
  color: "#ffffff",
  map: runtimeOceanTexture,
  roughness: 1,
  metalness: 0
});
const cloudGeometry = new THREE.BoxGeometry(1.6, 0.9, 1.6);
const skyDropRingGeometry = new THREE.RingGeometry(0.48, 0.72, 24);
const skyDropBeamGeometry = new THREE.CylinderGeometry(0.16, 0.16, 2, 12, 1, true);
const speedTraceGeometry = new THREE.PlaneGeometry(0.16, 1.5).translate(0, 0.75, 0);
const featherBurstPlumeGeometry = new THREE.BoxGeometry(...chickenFeatherGeometry.plumeSize).translate(
  0,
  chickenFeatherGeometry.plumePositionY,
  0
);
const featherBurstQuillGeometry = new THREE.BoxGeometry(...chickenFeatherGeometry.quillSize).translate(
  0,
  chickenFeatherGeometry.quillPositionY,
  0
);
const clusterTempObject = new THREE.Object3D();
const cloudTempObject = new THREE.Object3D();
const voxelFxTempObject = new THREE.Object3D();
const treeTempMatrix = new THREE.Matrix4();
const decorationParentObject = new THREE.Object3D();
const decorationChildObject = new THREE.Object3D();
const shadowRayDirection = new THREE.Vector3(0, -1, 0);
const grassCardGeometry = new THREE.PlaneGeometry(0.56, 0.82);
const flowerCardGeometry = new THREE.PlaneGeometry(0.72, 0.92);
const daySkyColor = new THREE.Color(backgroundColor);
const spaceSkyColor = new THREE.Color("#04060d");
const dayFogColor = new THREE.Color(backgroundColor);
const spaceFogColor = new THREE.Color("#070a12");
const AVATAR_TURN_SPEED = 4.5;
const AVATAR_BOB_BASE_Y = 0.74;
const EGG_FUSE_DURATION = defaultSimulationConfig.eggFuseDuration;
const EGG_SCATTER_ARC_HEIGHT = 2.4;
const EGG_COST = defaultSimulationConfig.eggCost;
const EGG_CHARGE_DURATION = defaultSimulationConfig.eggChargeDuration;
const MAX_ACTIVE_EGGS_PER_PLAYER = defaultSimulationConfig.maxActiveEggsPerPlayer;
const MIN_GROUNDED_EGG_CHARGE = 0.18;
const MAX_EGG_SCATTER_INSTANCES_PER_PROFILE = 64;
const MAX_HARVEST_BURST_INSTANCES_PER_PROFILE = 128;
const MAX_EGG_EXPLOSION_BURST_INSTANCES = 512;
const MAX_EGG_EXPLOSION_SHOCKWAVE_INSTANCES = 32;
const FEATHER_BURST_PARTICLE_COUNT = 22;
const MAX_FEATHER_BURSTS = 12;
const MAX_FEATHER_BURST_INSTANCES = FEATHER_BURST_PARTICLE_COUNT * MAX_FEATHER_BURSTS;
const FEATHER_BURST_LIFETIME = 0.82;
const EGG_TRAJECTORY_MAX_POINTS = 56;
const EGG_TRAJECTORY_TIME_STEP = 0.05;
const EGG_TRAJECTORY_MAX_DURATION = 2.55;
const PLAYER_DETAIL_DISTANCE = 18;
const SPEED_TRACE_DEPTH = 2.4;
const SPEED_TRACE_PUSH_BURST_DURATION = 0.2;
const SPEED_TRACE_MIN_AIR_SPEED = 3.6;
const RUNTIME_INPUT_SEND_INTERVAL = 1 / 30;
const SPACE_BLEND_DAMPING = 4.4;
const SPACE_STAR_COUNT = 220;
const POINTER_CAPTURE_TIMEOUT_MS = 1_000;
const INPUT_HOLD_THRESHOLD = 0.16;
const DOUBLE_TAP_WINDOW_MS = 220;
const HARVEST_REPEAT_INTERVAL = 0.1;
const HARVEST_FOCUS_OVERRIDE_DURATION = 0.12;
const PRIMARY_POINTER_BUTTON = 0;
const SECONDARY_POINTER_BUTTON = 2;
const HARVEST_SNAP_SAMPLE_OFFSETS = [
  [0, 0],
  [0.018, 0],
  [-0.018, 0],
  [0, 0.018],
  [0, -0.018],
  [0.018, 0.018],
  [0.018, -0.018],
  [-0.018, 0.018],
  [-0.018, -0.018],
  [0.036, 0],
  [-0.036, 0],
  [0, 0.036],
  [0, -0.036]
] as const;
const MATTER_PULSE_DURATION = 0.72;
const MATTER_BUBBLE_DURATION = 1.1;
const MATTER_FEEDBACK_COOLDOWN = 0.5;
const RESOURCE_BUBBLE_HEAD_OFFSET_Y = 0.62;
const RESOURCE_BUBBLE_FALLBACK_Y = 1.95;
const SPACE_TYPING_PRIME_DURATION = 0.22;
const SPACE_TYPING_MISFIRE_DURATION = 0.16;
const SPACE_TYPING_MISTAKE_PULSE_DURATION = 0.18;
const SPACE_TYPING_SUCCESS_PULSE_DURATION = 0.48;
const SPACE_TYPING_FAIL_FLASH_DURATION = 0.52;
const SUPER_BOOM_BOMB_SCALE = 2;
const SUPER_BOOM_IMPACT_JOLT_DURATION = 0.22;
const modifierSensitiveRuntimeKeyCodes = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "KeyR",
  "KeyE",
  "KeyF",
  "Space"
]);
const voxelFxProfiles = ["earthSurface", "earthSubsoil", "darkness"] as const satisfies readonly BlockRenderProfile[];

const createFeatherBurstStates = (count: number): FeatherBurstState[] =>
  Array.from({ length: count }, () => ({
    active: false,
    createdAt: Number.NEGATIVE_INFINITY,
    serial: 0,
    origin: new THREE.Vector3()
  }));

const hashFeatherBurstSeed = (serial: number, index: number) => ((serial * 73856093) ^ (index * 19349663)) >>> 0;
const speedTraceLayouts = [
  { angleDeg: 164, screenRadius: 0.68, scaleY: 1.38, width: 0.96, opacity: 0.42, travel: 0.2, speed: 0.94, phase: 0.06 },
  { angleDeg: 144, screenRadius: 0.7, scaleY: 1.55, width: 1.08, opacity: 0.76, travel: 0.28, speed: 1.1, phase: 0.14 },
  { angleDeg: 122, screenRadius: 0.7, scaleY: 1.3, width: 0.92, opacity: 0.34, travel: 0.18, speed: 0.88, phase: 0.28 },
  { angleDeg: 98, screenRadius: 0.72, scaleY: 1.18, width: 0.84, opacity: 0.64, travel: 0.16, speed: 1.18, phase: 0.42 },
  { angleDeg: 68, screenRadius: 0.7, scaleY: 1.34, width: 0.9, opacity: 0.36, travel: 0.2, speed: 1.02, phase: 0.56 },
  { angleDeg: 42, screenRadius: 0.68, scaleY: 1.6, width: 1.1, opacity: 0.78, travel: 0.3, speed: 1.22, phase: 0.68 },
  { angleDeg: 18, screenRadius: 0.7, scaleY: 1.44, width: 0.98, opacity: 0.48, travel: 0.24, speed: 0.96, phase: 0.8 },
  { angleDeg: -18, screenRadius: 0.7, scaleY: 1.44, width: 0.98, opacity: 0.48, travel: 0.24, speed: 1.04, phase: 0.12 },
  { angleDeg: -42, screenRadius: 0.68, scaleY: 1.6, width: 1.1, opacity: 0.78, travel: 0.3, speed: 1.16, phase: 0.24 },
  { angleDeg: -68, screenRadius: 0.7, scaleY: 1.34, width: 0.9, opacity: 0.36, travel: 0.2, speed: 0.92, phase: 0.36 },
  { angleDeg: -98, screenRadius: 0.72, scaleY: 1.18, width: 0.84, opacity: 0.64, travel: 0.16, speed: 1.12, phase: 0.48 },
  { angleDeg: -122, screenRadius: 0.7, scaleY: 1.3, width: 0.92, opacity: 0.34, travel: 0.18, speed: 0.86, phase: 0.6 },
  { angleDeg: -144, screenRadius: 0.7, scaleY: 1.55, width: 1.08, opacity: 0.76, travel: 0.28, speed: 1.08, phase: 0.72 },
  { angleDeg: -164, screenRadius: 0.68, scaleY: 1.38, width: 0.96, opacity: 0.42, travel: 0.2, speed: 0.98, phase: 0.84 }
] as const;
const eliminatedVisualState = {
  scaleX: 1,
  scaleY: 1,
  scaleZ: 1,
  blinkVisible: true
} as const;

const spacePlanetDescriptors = [
  {
    offset: [-168, 94, -280] as const,
    radius: [5, 5, 5] as const,
    scale: 3.2,
    colors: ["#85b6ff", "#4b6fc0"] as const,
    spinSpeed: 0.11,
    wobblePhase: 0.2
  },
  {
    offset: [212, -38, -316] as const,
    radius: [6, 4, 6] as const,
    scale: 2.7,
    colors: ["#f3c27a", "#c07a3d"] as const,
    spinSpeed: -0.08,
    wobblePhase: 1.1
  },
  {
    offset: [28, 136, -340] as const,
    radius: [4, 6, 4] as const,
    scale: 2.45,
    colors: ["#97ecff", "#4d9bc7"] as const,
    spinSpeed: 0.06,
    wobblePhase: 2.1
  }
] as const;

const isRuntimeMode = (mode: ActiveShellMode) =>
  mode === "explore" || mode === "playNpc" || mode === "multiplayer";
const MULTIPLAYER_SPECTATOR_CAMERA_SPEED = 16;
const TERRAIN_OCCLUSION_HIP_HEIGHT_RATIO = 0.35;
const TERRAIN_OCCLUSION_CHEST_HEIGHT_RATIO = 0.7;
const TERRAIN_OCCLUSION_HEAD_HEIGHT_RATIO = 0.9;
const COVERED_PLAYER_CAMERA_BUFFER = 0.75;
const COVERED_PLAYER_PUSH_IN_DAMPING = 10;
const COVERED_PLAYER_RELEASE_DAMPING = 6;
const COVERED_PLAYER_RELEASE_EPSILON = 0.05;
const COVERED_PLAYER_MAX_CAMERA_PUSH_IN = 0.45;
const TERRAIN_OCCLUSION_RAYCAST_STEP_EPSILON = 0.05;

const getVectorDistance = (
  left: Pick<THREE.Vector3, "x" | "y" | "z">,
  right: { x: number; y: number; z: number }
) => Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);

const configureStaticInstancedMesh = (mesh: THREE.InstancedMesh, matrices: readonly THREE.Matrix4[]) => {
  mesh.count = matrices.length;
  for (let index = 0; index < matrices.length; index += 1) {
    mesh.setMatrixAt(index, matrices[index]!);
  }
  finalizeStaticInstancedMesh(mesh, matrices.length);
};

const configureSunShadowObject = (
  object: THREE.Object3D,
  {
    castShadow,
    receiveShadow
  }: {
    castShadow: boolean;
    receiveShadow: boolean;
  }
) => {
  object.traverse((child) => {
    enableSunShadowLayer(child);
    if (child instanceof THREE.Mesh) {
      child.castShadow = castShadow;
      child.receiveShadow = receiveShadow;
    }
  });
};

const composeDecorationMatrices = (
  parentTransform: {
    position: [number, number, number];
    rotation?: [number, number, number];
    scale?: number | [number, number, number];
  },
  localTransforms: readonly {
    position: [number, number, number];
    rotation?: [number, number, number];
    scale?: number | [number, number, number];
  }[]
) => {
  const parentRotation = parentTransform.rotation ?? [0, 0, 0];
  const parentScale = parentTransform.scale ?? 1;
  decorationParentObject.position.set(
    parentTransform.position[0],
    parentTransform.position[1],
    parentTransform.position[2]
  );
  decorationParentObject.rotation.set(parentRotation[0], parentRotation[1], parentRotation[2]);
  if (typeof parentScale === "number") {
    decorationParentObject.scale.setScalar(parentScale);
  } else {
    decorationParentObject.scale.set(parentScale[0], parentScale[1], parentScale[2]);
  }
  decorationParentObject.updateMatrix();

  return localTransforms.map((transform) => {
    const rotation = transform.rotation ?? [0, 0, 0];
    const scale = transform.scale ?? 1;
    decorationChildObject.position.set(
      transform.position[0],
      transform.position[1],
      transform.position[2]
    );
    decorationChildObject.rotation.set(rotation[0], rotation[1], rotation[2]);
    if (typeof scale === "number") {
      decorationChildObject.scale.setScalar(scale);
    } else {
      decorationChildObject.scale.set(scale[0], scale[1], scale[2]);
    }
    decorationChildObject.updateMatrix();
    return new THREE.Matrix4().multiplyMatrices(
      decorationParentObject.matrix,
      decorationChildObject.matrix
    );
  });
};

const grassCardLocalTransforms = [
  { position: [0, 0.38, 0] },
  { position: [0, 0.38, 0], rotation: [0, Math.PI / 2, 0] }
] as const;

const flowerCardLocalTransforms = [
  { position: [0, 0.44, 0] },
  { position: [0, 0.44, 0], rotation: [0, Math.PI / 2, 0] }
] as const;

const buildDecorationMatrices = (decorations: SurfaceDecoration[]) => {
  const grassMatrices: THREE.Matrix4[] = [];
  const flowerYellowMatrices: THREE.Matrix4[] = [];
  const flowerPinkMatrices: THREE.Matrix4[] = [];
  const flowerWhiteMatrices: THREE.Matrix4[] = [];
  const flowerBlueMatrices: THREE.Matrix4[] = [];

  for (const decoration of decorations) {
    const parentTransform = {
      position: [decoration.x, decoration.y, decoration.z] as [number, number, number],
      rotation: [0, decoration.rotation, 0] as [number, number, number],
      scale: decoration.scale
    };

    if (decoration.kind === "grass") {
      grassMatrices.push(...composeDecorationMatrices(parentTransform, grassCardLocalTransforms));
      continue;
    }

    const flowerMatrices = composeDecorationMatrices(parentTransform, flowerCardLocalTransforms);
    if (decoration.kind === "flower-yellow") {
      flowerYellowMatrices.push(...flowerMatrices);
    } else if (decoration.kind === "flower-pink") {
      flowerPinkMatrices.push(...flowerMatrices);
    } else if (decoration.kind === "flower-blue") {
      flowerBlueMatrices.push(...flowerMatrices);
    } else {
      flowerWhiteMatrices.push(...flowerMatrices);
    }
  }

  return {
    grassMatrices,
    flowerYellowMatrices,
    flowerPinkMatrices,
    flowerWhiteMatrices,
    flowerBlueMatrices
  };
};

const buildCloudMatrices = (preset: VoxelCloudPreset) => {
  const mainMatrices: THREE.Matrix4[] = [];
  const shadeMatrices: THREE.Matrix4[] = [];

  for (const cube of preset.cubes) {
    cloudTempObject.position.set(cube.x, cube.y, cube.z);
    cloudTempObject.rotation.set(0, 0, 0);
    cloudTempObject.scale.set(1, 1, 1);
    cloudTempObject.updateMatrix();
    (cube.tone === "shade" ? shadeMatrices : mainMatrices).push(cloudTempObject.matrix.clone());
  }

  return {
    mainMatrices,
    shadeMatrices
  };
};

const createSpaceStarGeometry = () => {
  const positions = new Float32Array(SPACE_STAR_COUNT * 3);

  for (let index = 0; index < SPACE_STAR_COUNT; index += 1) {
    const ratio = (index + 0.5) / SPACE_STAR_COUNT;
    const polar = Math.acos(1 - 2 * ratio);
    const azimuth = index * 2.399963229728653;
    const radius = 220 + ((index * 73) % 120);
    positions[index * 3] = Math.sin(polar) * Math.cos(azimuth) * radius;
    positions[index * 3 + 1] = Math.cos(polar) * radius * 0.9;
    positions[index * 3 + 2] = Math.sin(polar) * Math.sin(azimuth) * radius;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.computeBoundingSphere();
  return geometry;
};

const buildVoxelPlanetMatrices = (radiusX: number, radiusY: number, radiusZ: number) => {
  const mainMatrices: THREE.Matrix4[] = [];
  const shadeMatrices: THREE.Matrix4[] = [];

  for (let x = -radiusX; x <= radiusX; x += 1) {
    for (let y = -radiusY; y <= radiusY; y += 1) {
      for (let z = -radiusZ; z <= radiusZ; z += 1) {
        const normalized =
          (x * x) / Math.max(1, radiusX * radiusX) +
          (y * y) / Math.max(1, radiusY * radiusY) +
          (z * z) / Math.max(1, radiusZ * radiusZ);
        if (normalized > 1) {
          continue;
        }

        cloudTempObject.position.set(x, y, z);
        cloudTempObject.rotation.set(0, 0, 0);
        cloudTempObject.scale.set(1, 1, 1);
        cloudTempObject.updateMatrix();
        const shadingSignal = x * 0.62 + y * 0.28 - z * 0.44;
        (shadingSignal < 0 ? shadeMatrices : mainMatrices).push(cloudTempObject.matrix.clone());
      }
    }
  }

  return {
    mainMatrices,
    shadeMatrices
  };
};

const patchInstancedOpacityMaterial = (material: THREE.Material) => {
  const patched = material.clone();
  patched.transparent = true;
  patched.depthWrite = false;
  patched.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      "#include <common>",
      "#include <common>\nattribute float instanceOpacity;\nvarying float vInstanceOpacity;"
    );
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      "#include <begin_vertex>\nvInstanceOpacity = instanceOpacity;"
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <common>",
      "#include <common>\nvarying float vInstanceOpacity;"
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "gl_FragColor = vec4( outgoingLight, diffuseColor.a );",
      "gl_FragColor = vec4( outgoingLight, diffuseColor.a * vInstanceOpacity );"
    );
  };
  patched.customProgramCacheKey = () => `${material.type}-instanced-opacity`;
  patched.needsUpdate = true;
  return patched;
};

const createDynamicOpacityMeshResource = (
  capacity: number,
  materials: THREE.Material | THREE.Material[],
  geometry: THREE.BufferGeometry = new THREE.BoxGeometry(1, 1, 1)
): DynamicOpacityMeshResource => {
  const opacityAttribute = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, capacity)), 1);
  opacityAttribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("instanceOpacity", opacityAttribute);
  const materialSet = (Array.isArray(materials) ? materials : [materials]).map((material) => patchInstancedOpacityMaterial(material));
  const mesh = new THREE.InstancedMesh(geometry, Array.isArray(materials) ? materialSet : materialSet[0]!, Math.max(1, capacity));
  mesh.frustumCulled = false;
  configureDynamicInstancedMesh(mesh);
  finalizeDynamicInstancedMesh(mesh, 0);
  return {
    geometry,
    materials: materialSet,
    mesh,
    opacityAttribute
  };
};

const createEggTrajectoryPreview = (maxPoints: number): EggTrajectoryPreviewResource => {
  const geometry = new THREE.BufferGeometry();
  const positionAttribute = new THREE.BufferAttribute(new Float32Array(maxPoints * 3), 3);
  positionAttribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", positionAttribute);
  geometry.setDrawRange(0, 0);
  const material = new THREE.LineBasicMaterial({
    color: "#fff8d6",
    transparent: true,
    opacity: 0.92,
    blending: THREE.AdditiveBlending,
    toneMapped: false
  });
  const line = new THREE.Line(geometry, material);
  line.frustumCulled = false;

  const landingGeometry = new THREE.RingGeometry(0.34, 0.54, 28);
  const landingMaterial = new THREE.MeshBasicMaterial({
    color: "#ffe07f",
    transparent: true,
    opacity: 0.82,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false
  });
  const landingRing = new THREE.Mesh(landingGeometry, landingMaterial);
  landingRing.rotation.x = -Math.PI / 2;
  landingRing.renderOrder = 16;
  landingRing.visible = false;
  landingRing.frustumCulled = false;

  const group = new THREE.Group();
  group.visible = false;
  group.add(line, landingRing);

  return {
    geometry,
    material,
    line,
    positionAttribute,
    landingGeometry,
    landingMaterial,
    landingRing,
    group
  };
};

const finalizeDynamicOpacityMesh = (resource: DynamicOpacityMeshResource | null, count: number) => {
  if (!resource) {
    return;
  }

  resource.opacityAttribute.needsUpdate = true;
  finalizeDynamicInstancedMesh(resource.mesh, count);
};

const createTerrainGeometry = (patch: TerrainChunkPatchPayload) => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(patch.positions!, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(patch.normals!, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(patch.uvs!, 2));
  geometry.setAttribute("color", new THREE.BufferAttribute(patch.colors!, 3));
  geometry.setIndex(new THREE.BufferAttribute(patch.indices!, 1));
  geometry.clearGroups();
  for (const group of patch.materialGroups) {
    geometry.addGroup(group.start, group.count, group.materialIndex);
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
};

const getWorldNormalFromIntersection = (intersection: THREE.Intersection<THREE.Object3D>) => {
  const faceNormal = intersection.face?.normal.clone();
  if (!faceNormal) {
    return null;
  }

  faceNormal.transformDirection(intersection.object.matrixWorld);
  return faceNormal;
};

const isFormElement = (target: EventTarget | null) =>
  target instanceof HTMLInputElement ||
  target instanceof HTMLTextAreaElement ||
  target instanceof HTMLSelectElement;

const getNormalizedTypedCharacter = (event: KeyboardEvent) => {
  if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) {
    return null;
  }

  return /^[a-z]$/i.test(event.key) ? event.key.toLowerCase() : null;
};

const vec3iEqual = (
  left: { x: number; y: number; z: number } | null,
  right: { x: number; y: number; z: number } | null
) =>
  left?.x === right?.x &&
  left?.y === right?.y &&
  left?.z === right?.z;

const runtimeInputCommandsEqual = (
  left: RuntimeInputCommand | null,
  right: RuntimeInputCommand
) =>
  left !== null &&
  left.moveX === right.moveX &&
  left.moveZ === right.moveZ &&
  left.lookX === right.lookX &&
  left.lookZ === right.lookZ &&
  left.eggCharge === right.eggCharge &&
  left.eggPitch === right.eggPitch &&
  left.typedText === right.typedText &&
  left.jump === right.jump &&
  left.jumpPressed === right.jumpPressed &&
  left.jumpReleased === right.jumpReleased &&
  left.destroy === right.destroy &&
  left.place === right.place &&
  left.push === right.push &&
  left.layEgg === right.layEgg &&
  vec3iEqual(left.targetVoxel, right.targetVoxel) &&
  vec3iEqual(left.targetNormal, right.targetNormal);

const addPlayerPart = (
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material | THREE.Material[],
  {
    position,
    rotation
  }: {
    position?: readonly [number, number, number];
    rotation?: readonly [number, number, number];
  } = {}
) => {
  const mesh = new THREE.Mesh(geometry, material);
  if (position) {
    mesh.position.set(...position);
  }
  if (rotation) {
    mesh.rotation.set(...rotation);
  }
  parent.add(mesh);
  return mesh;
};

const createPlayerVisual = (playerId: string, matchColorSeed: number, preferredPaletteName: ChickenPaletteName | null = null) => {
  const palette = getChickenPalette(playerId, matchColorSeed, preferredPaletteName);
  const materialBundle = createChickenMaterialBundle(palette);
  const motionSeed = getChickenMotionSeed(playerId);
  const bomb = createEggVisual();
  const group = new THREE.Group();
  const rig = createChickenAvatarRig(materialBundle);

  const shadow = new THREE.Mesh(playerShadowGeometry, materialBundle.shadow);
  shadow.rotation.x = -Math.PI / 2;
  group.add(shadow);

  const ring = new THREE.Mesh(playerRingGeometry, materialBundle.ring);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  group.add(ring);
  bomb.group.visible = false;
  bomb.group.position.y = 0.74;
  group.add(bomb.group);
  rig.avatar.position.y = AVATAR_BOB_BASE_Y;
  group.add(rig.root);

  return {
    paletteName: palette.name,
    group,
    bomb: bomb.group,
    bombMaterial: bomb.material,
    ...rig,
    ring,
    ringMaterial: materialBundle.ring,
    shadow,
    shadowMaterial: materialBundle.shadow,
    wingletTraceMaterial: materialBundle.wingletTrace,
    materialBundle,
    targetPosition: new THREE.Vector3(),
    motionSeed,
    previousGrounded: false,
    previousVelocityY: 0,
    landingRollRemaining: 0
  } satisfies PlayerVisual;
};

const disposePlayerVisual = (visual: PlayerVisual) => {
  disposeChickenMaterialBundle(visual.materialBundle);
  visual.bombMaterial.dispose();
};

const createEggVisual = () => {
  const material = new THREE.MeshStandardMaterial({
    color: "#fff0d9",
    map: propMaterials.egg.map ?? null,
    emissive: "#ff4f3d",
    emissiveIntensity: 0.08,
    roughness: 1,
    metalness: 0
  });
  const group = new THREE.Group();
  addPlayerPart(group, eggBaseGeometry, material, {
    position: [0, -0.12, 0]
  });
  addPlayerPart(group, eggMiddleGeometry, material, {
    position: [0, 0.04, 0]
  });
  addPlayerPart(group, eggCapGeometry, material, {
    position: [0, 0.22, 0]
  });

  return {
    group,
    material
  } satisfies EggVisual;
};

const createCoveredPlayerSilhouetteMaterial = () =>
  new THREE.MeshBasicMaterial({
    color: "#ffffff",
    transparent: true,
    opacity: 0.45,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false
  });

const clonePlayerSilhouetteRoot = (sourceRoot: THREE.Object3D, material: THREE.MeshBasicMaterial) => {
  const clone = sourceRoot.clone(true);
  clone.traverse((object) => {
    object.renderOrder = 40;
    object.frustumCulled = false;
    if (!(object instanceof THREE.Mesh)) {
      return;
    }

    object.material = material;
  });
  return clone;
};

const syncObjectTransformsRecursive = (source: THREE.Object3D, target: THREE.Object3D): boolean => {
  if (source.children.length !== target.children.length) {
    return false;
  }

  target.position.copy(source.position);
  target.quaternion.copy(source.quaternion);
  target.scale.copy(source.scale);
  target.visible = source.visible;

  for (let index = 0; index < source.children.length; index += 1) {
    const sourceChild = source.children[index];
    const targetChild = target.children[index];
    if (!sourceChild || !targetChild || !syncObjectTransformsRecursive(sourceChild, targetChild)) {
      return false;
    }
  }

  return true;
};

export class GameClient {
  static mount(options: GameClientMountOptions) {
    return new GameClient(options);
  }

  private readonly canvas: HTMLCanvasElement;
  private readonly callbacks: GameClientCallbacks;
  private readonly worker: GameWorkerLike;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(40, 1, 0.1, 1000);
  private readonly sceneBackgroundColor = daySkyColor.clone();
  private readonly ambientLight = new THREE.AmbientLight(0xffffff, 0.45);
  private readonly directionalLight = new THREE.DirectionalLight(0xffffff, 1.36);
  private readonly hemisphereLight = new THREE.HemisphereLight("#fef7df", "#4c6156", 0.22);
  private readonly sunShadows: SunShadows;
  private readonly cloudsGroup = new THREE.Group();
  private readonly spaceBackdropGroup = new THREE.Group();
  private readonly terrainGroup = new THREE.Group();
  private readonly propsGroup = new THREE.Group();
  private readonly decorationsGroup = new THREE.Group();
  private readonly spawnsGroup = new THREE.Group();
  private readonly playersGroup = new THREE.Group();
  private readonly coveredPlayerSilhouetteGroup = new THREE.Group();
  private readonly eggsGroup = new THREE.Group();
  private readonly voxelFxGroup = new THREE.Group();
  private readonly skyDropsGroup = new THREE.Group();
  private readonly clustersGroup = new THREE.Group();
  private readonly speedTraceGroup = new THREE.Group();
  private readonly focusOutline: THREE.LineSegments;
  private readonly focusGhost: THREE.Mesh;
  private readonly focusRaycaster = new THREE.Raycaster();
  private readonly clickRaycaster = new THREE.Raycaster();
  private readonly playerShadowRaycaster = new THREE.Raycaster();
  private readonly eggTrajectoryRaycaster = new THREE.Raycaster();
  private readonly eggTrajectoryPreview = createEggTrajectoryPreview(EGG_TRAJECTORY_MAX_POINTS);
  private readonly clock = new THREE.Clock();
  private readonly chunkMeshes = new Map<string, THREE.Mesh>();
  private readonly playerVisuals = new Map<string, PlayerVisual>();
  private readonly playerObservedLives = new Map<string, number>();
  private readonly eggVisuals = new Map<string, EggVisual>();
  private readonly eggScatterMeshes = new Map<BlockRenderProfile, THREE.InstancedMesh>();
  private readonly harvestBurstMeshes = new Map<BlockRenderProfile, DynamicOpacityMeshResource>();
  private readonly skyDropVisuals = new Map<string, SkyDropVisual>();
  private readonly clusterVisuals = new Map<string, ClusterVisual>();
  private readonly featherBurstStates = createFeatherBurstStates(MAX_FEATHER_BURSTS);
  private readonly pendingDocumentResolvers = new Map<string, (document: MapDocumentV1) => void>();
  private readonly currentLookTarget = new THREE.Vector3();
  private readonly desiredLookTarget = new THREE.Vector3();
  private readonly desiredCameraPosition = new THREE.Vector3();
  private readonly coveredPlayerResolvedCameraPosition = new THREE.Vector3();
  private readonly coveredPlayerSilhouetteMaterial = createCoveredPlayerSilhouetteMaterial();
  private readonly terrainOcclusionHipsAnchor = new THREE.Vector3();
  private readonly terrainOcclusionChestAnchor = new THREE.Vector3();
  private readonly terrainOcclusionHeadAnchor = new THREE.Vector3();
  private readonly terrainOcclusionRayOrigin = new THREE.Vector3();
  private readonly terrainOcclusionRayDirection = new THREE.Vector3();
  private readonly resourceBubbleScreenPosition = new THREE.Vector3();
  private readonly cloudVisuals: CloudVisual[] = [];
  private readonly spacePlanetVisuals: SpacePlanetVisual[] = [];
  private readonly cloudMainMaterial = new THREE.MeshStandardMaterial({
    color: "#ffffff",
    roughness: 1,
    metalness: 0,
    transparent: true,
    opacity: 1
  });
  private readonly cloudShadeMaterial = new THREE.MeshStandardMaterial({
    color: "#dde7f2",
    roughness: 1,
    metalness: 0,
    transparent: true,
    opacity: 1
  });
  private readonly spaceStarGeometry = createSpaceStarGeometry();
  private readonly spaceStarMaterial = new THREE.PointsMaterial({
    color: "#edf2ff",
    size: 3.1,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    toneMapped: false
  });
  private readonly spaceStars = new THREE.Points(this.spaceStarGeometry, this.spaceStarMaterial);
  private readonly speedTraceMaterials: THREE.MeshBasicMaterial[] = [];
  private readonly voxelFxDisposables: THREE.Material[] = [];
  private readonly voxelFxGeometries: THREE.BufferGeometry[] = [];
  private featherBurstPlumeMesh: DynamicOpacityMeshResource | null = null;
  private featherBurstQuillMesh: DynamicOpacityMeshResource | null = null;
  private nextFeatherBurstSerial = 1;
  private readonly currentTerrainStats = {
    chunkCount: 0,
    drawCallCount: 0,
    triangleCount: 0
  };
  private readonly keyboardState: KeyboardInputState = {
    ...initialKeyboardInputState
  };
  private readonly eggChargeState: EggChargeState = {
    active: false,
    startedAt: 0,
    chargeAlpha: 0,
    pendingThrow: false,
    pendingThrowCharge: 0,
    pendingThrowPitch: 0,
    releaseRemaining: 0,
    source: null
  };
  private readonly activeEggKeyCodes = new Set<string>();
  private readonly eggKeyAction: HoldActionState = {
    pressed: false,
    startedAt: 0,
    holdTriggered: false
  };
  private readonly eggPointerAction: HoldActionState = {
    pressed: false,
    startedAt: 0,
    holdTriggered: false
  };
  private readonly harvestPointerAction: RepeatingActionState = {
    pressed: false,
    nextPulseAt: 0
  };
  private readonly buildKeyAction: RepeatingActionState = {
    pressed: false,
    nextPulseAt: 0
  };
  private lastForwardTapAtMs = Number.NEGATIVE_INFINITY;
  private forwardTapReleased = true;

  private animationFrameId: number | null = null;
  private mode: ActiveShellMode;
  private worldDocument = normalizeArenaBudgetMapDocument(createDefaultArenaMap());
  private runtimeWorld = new MutableVoxelWorld(this.worldDocument);
  private latestFrame: RuntimeRenderFrame | null = null;
  private readonly authoritativeReplica = new AuthoritativeReplica();
  private matchColorSeed: number;
  private cameraForward = { x: 1, z: 0 };
  private inputSequence = 0;
  private lastRuntimeInputSentAt = Number.NEGATIVE_INFINITY;
  private lastSentRuntimeInput: RuntimeInputCommand | null = null;
  private destroyQueued = false;
  private queuedDestroyTarget: RuntimeFocusedTarget | null = null;
  private quickEggQueued = false;
  private quickEggPitch = 0;
  private pointerLocked = false;
  private pointerCapturePending = false;
  private pointerCaptureFailureReason: PointerCaptureFailureReason | null = null;
  private pointerCaptureRequestVersion = 0;
  private pointerCaptureTimeoutId: number | null = null;
  private runtimePaused = true;
  private runtimeHasCapturedPointer = false;
  private pendingResumeAfterPointerLock = false;
  private pendingLookDeltaX = 0;
  private pendingLookDeltaY = 0;
  private lookYaw: number | null = null;
  private lookPitch = aimCameraConfig.defaultPitch;
  private speedBlend = 0;
  private hasInitializedRuntimeCamera = false;
  private runtimeCameraUsingSpaceRig = false;
  private hasInitializedSpectatorCamera = false;
  private localPushTraceBurstRemaining = 0;
  private previousLocalPushVisualRemaining = 0;
  private presentation: ShellPresentation;
  private initialSpawnStyle: SimulationInitialSpawnStyle;
  private localPlayerName: string | undefined;
  private localPlayerPaletteName: ChickenPaletteName | null;
  private runtimeControlSettings: RuntimeControlSettings;
  private eggExplosionBurstMesh: DynamicOpacityMeshResource | null = null;
  private eggExplosionShockwaveMesh: DynamicOpacityMeshResource | null = null;
  private focusedTarget: RuntimeFocusedTarget | null = null;
  private harvestFocusOverride: LocalFocusOverride | null = null;
  private pendingReadyToDisplay = false;
  private baseFogNear = 36;
  private baseFogFar = 120;
  private spaceBlend = 0;
  private matterPulseUntil = 0;
  private matterBubbleUntil = 0;
  private matterFeedbackLockedUntil = 0;
  private spaceTypePrimeUntil = 0;
  private spaceTypeMisfireUntil = 0;
  private spaceFailPulseUntil = 0;
  private spaceMistakePulseUntil = 0;
  private spaceSuccessPulseUntil = 0;
  private superBoomImpactJoltUntil = 0;
  private previousLocalSpacePhase: RuntimePlayerState["spacePhase"] | null = null;
  private localSpaceChallengeTargetKey: string | null = null;
  private localSpaceChallengeHitCount = 0;
  private coveredPlayerContourVisible = false;
  private coveredPlayerSilhouetteRoot: THREE.Object3D | null = null;
  private coveredPlayerSilhouetteSource: PlayerVisual | null = null;
  private pendingTypedText = "";
  private lastRuntimeInputMismatchWarningKey: string | null = null;
  private lastRuntimeOverlayState: RuntimeOverlayState | null = null;
  private resourceBubbleElement: HTMLDivElement | null = null;
  private qualityTier: QualityTier;

  private constructor({
    canvas,
    initialDocument,
    initialMode,
    initialSpawnStyle = "ground",
    localPlayerName,
    localPlayerPaletteName = null,
    matchColorSeed,
    presentation = "default",
    qualityTier = "medium",
    runtimeSettings,
    workerFactory,
    ...callbacks
  }: GameClientMountOptions) {
    this.canvas = canvas;
    this.callbacks = callbacks;
    this.mode = initialMode;
    this.initialSpawnStyle = initialSpawnStyle;
    this.localPlayerName = localPlayerName;
    this.localPlayerPaletteName = localPlayerPaletteName;
    this.matchColorSeed = matchColorSeed;
    this.presentation = presentation;
    this.qualityTier = qualityTier;
    this.runtimeControlSettings = runtimeSettings
      ? normalizeRuntimeControlSettings(runtimeSettings)
      : createDefaultRuntimeControlSettings();
    this.worldDocument = normalizeArenaBudgetMapDocument(initialDocument ?? createDefaultArenaMap());
    this.runtimeWorld = new MutableVoxelWorld(this.worldDocument);
    this.worker = workerFactory ? workerFactory() : createLocalGameWorker();
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance"
    });
    this.sunShadows = new SunShadows(this.scene, this.camera, this.renderer);
    this.resourceBubbleElement = this.createResourceBubbleElement();

    this.focusOutline = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.04, 1.04, 1.04)),
      new THREE.LineBasicMaterial({ color: "#fff4c6" })
    );
    this.focusGhost = new THREE.Mesh(
      new THREE.BoxGeometry(1.002, 1.002, 1.002),
      new THREE.MeshStandardMaterial({
        color: "#fff4c6",
        opacity: 0.22,
        transparent: true
      })
    );

    this.initScene();
    this.attachEvents();
    this.attachWorker();
    this.resize();
    this.worker.postMessage({
      type: "init",
      document: this.worldDocument,
      mode: this.mode,
      ...(this.localPlayerName ? { localPlayerName: this.localPlayerName } : {}),
      ...(isRuntimeMode(this.mode) ? { initialSpawnStyle: this.initialSpawnStyle } : {})
    } satisfies WorkerRequestMessage);
    this.animationFrameId = requestAnimationFrame(this.animate);
  }

  private createResourceBubbleElement() {
    const host = this.canvas.parentElement;
    if (!(host instanceof HTMLElement)) {
      return null;
    }

    const bubble = document.createElement("div");
    bubble.setAttribute("aria-hidden", "true");
    bubble.className = "chicken-taunt game-host__resource-bubble";
    bubble.innerHTML = [
      '<span class="chicken-taunt__text"></span>',
      '<span class="chicken-taunt__tail"></span>',
      '<span class="chicken-taunt__tail-inner"></span>'
    ].join("");
    bubble.style.display = "none";
    host.appendChild(bubble);
    return bubble;
  }

  private trackSunShadowMaterials() {
    this.sunShadows.trackMaterial(runtimeGroundMaterial);
    this.sunShadows.trackMaterial(getTerrainChunkMaterials());
    this.sunShadows.trackMaterial([
      propMaterials.bark,
      propMaterials.leaves,
      propMaterials.grass,
      propMaterials.flowerYellow,
      propMaterials.flowerPink,
      propMaterials.flowerWhite,
      propMaterials.flowerBlue
    ]);
  }

  private syncSunShadowWorld(document = this.worldDocument) {
    const arenaSpan = Math.max(document.size.x, document.size.z);
    this.sunShadows.syncWorld({
      maxFar: Math.min(this.baseFogFar, arenaSpan + 44),
      lightFar: Math.max(160, this.baseFogFar + document.size.y + 32),
      lightMargin: Math.max(18, document.size.y * 0.75)
    });
  }

  private shouldUseSunShadows() {
    return isRuntimeMode(this.mode) && this.presentation !== "menu" && this.qualityTier === "high";
  }

  private syncSunShadowMode() {
    const enabled = this.shouldUseSunShadows();
    syncDirectionalLightSunLayer(this.directionalLight, enabled);
    this.sunShadows.setEnabled(enabled);
    this.sunShadows.setLightIntensity(this.directionalLight.intensity);
  }

  private updateResourceBubbleMessage(message: string | null) {
    if (!this.resourceBubbleElement) {
      return;
    }

    const textElement = this.resourceBubbleElement.querySelector(".chicken-taunt__text");
    if (textElement) {
      textElement.textContent = message ?? "";
    }
  }

  private hideResourceBubble() {
    if (!this.resourceBubbleElement) {
      return;
    }

    this.resourceBubbleElement.style.display = "none";
  }

  private emitRuntimeOverlayState(force = false, elapsedTime = this.clock.elapsedTime) {
    const matterPulseActive = elapsedTime < this.matterPulseUntil;
    const spaceFailPulseActive = elapsedTime < this.spaceFailPulseUntil;
    const spaceMistakePulseActive = elapsedTime < this.spaceMistakePulseUntil;
    const spaceSuccessPulseActive = elapsedTime < this.spaceSuccessPulseUntil;
    const nextState: RuntimeOverlayState = {
      matterPulseActive,
      spaceFailPulseActive,
      spaceMistakePulseActive,
      spaceSuccessPulseActive,
      spaceLocalTargetKey: this.localSpaceChallengeTargetKey,
      spaceLocalHitCount: this.localSpaceChallengeHitCount
    };
    const unchanged =
      !force &&
      this.lastRuntimeOverlayState !== null &&
      this.lastRuntimeOverlayState.matterPulseActive === nextState.matterPulseActive &&
      this.lastRuntimeOverlayState.spaceFailPulseActive === nextState.spaceFailPulseActive &&
      this.lastRuntimeOverlayState.spaceMistakePulseActive === nextState.spaceMistakePulseActive &&
      this.lastRuntimeOverlayState.spaceSuccessPulseActive === nextState.spaceSuccessPulseActive &&
      this.lastRuntimeOverlayState.spaceLocalTargetKey === nextState.spaceLocalTargetKey &&
      this.lastRuntimeOverlayState.spaceLocalHitCount === nextState.spaceLocalHitCount;

    if (unchanged) {
      return;
    }

    this.lastRuntimeOverlayState = nextState;
    this.callbacks.onRuntimeOverlayChange?.(nextState);
  }

  private getLocalSpaceChallengeState() {
    return this.latestFrame?.hudState?.spaceChallenge ?? null;
  }

  private syncLocalSpaceChallengeState() {
    const challenge = this.getLocalSpaceChallengeState();
    if (!challenge) {
      this.localSpaceChallengeTargetKey = null;
      this.localSpaceChallengeHitCount = 0;
      return;
    }

    if (this.localSpaceChallengeTargetKey !== challenge.targetKey) {
      this.localSpaceChallengeTargetKey = challenge.targetKey;
      this.localSpaceChallengeHitCount = challenge.hits;
      return;
    }

    this.localSpaceChallengeHitCount = Math.max(this.localSpaceChallengeHitCount, challenge.hits);
  }

  private triggerSpaceMistakeFeedback(elapsedTime = this.clock.elapsedTime) {
    this.spaceTypeMisfireUntil = elapsedTime + SPACE_TYPING_MISFIRE_DURATION;
    this.spaceMistakePulseUntil = elapsedTime + SPACE_TYPING_MISTAKE_PULSE_DURATION;
    this.emitRuntimeOverlayState(true, elapsedTime);
  }

  private triggerSpacePrimeFeedback(elapsedTime = this.clock.elapsedTime) {
    this.spaceTypePrimeUntil = elapsedTime + SPACE_TYPING_PRIME_DURATION;
  }

  private triggerSpaceSuccessFeedback(elapsedTime = this.clock.elapsedTime) {
    this.triggerSpacePrimeFeedback(elapsedTime);
    this.spaceSuccessPulseUntil = elapsedTime + SPACE_TYPING_SUCCESS_PULSE_DURATION;
    this.emitRuntimeOverlayState(true, elapsedTime);
  }

  private triggerSpaceFailFeedback(elapsedTime = this.clock.elapsedTime) {
    this.spaceFailPulseUntil = elapsedTime + SPACE_TYPING_FAIL_FLASH_DURATION;
    this.emitRuntimeOverlayState(true, elapsedTime);
  }

  private triggerSuperBoomImpactJolt(elapsedTime = this.clock.elapsedTime) {
    this.superBoomImpactJoltUntil = elapsedTime + SUPER_BOOM_IMPACT_JOLT_DURATION;
  }

  private warnIfMissingLocalRuntimePlayer(
    localPlayer: RuntimePlayerState | null,
    frame: RuntimeRenderFrame | null = this.latestFrame
  ) {
    if (!import.meta.env.DEV) {
      return;
    }

    if (!frame || localPlayer) {
      this.lastRuntimeInputMismatchWarningKey = null;
      return;
    }

    if (!frame.localPlayerId && !frame.hudState?.spaceChallenge) {
      this.lastRuntimeInputMismatchWarningKey = null;
      return;
    }

    const warningKey = `${frame.tick}:${frame.localPlayerId ?? "none"}:${frame.hudState?.spaceChallenge?.targetKey ?? "none"}`;
    if (this.lastRuntimeInputMismatchWarningKey === warningKey) {
      return;
    }

    this.lastRuntimeInputMismatchWarningKey = warningKey;
    console.warn("[GameClient] Missing local runtime player while local overlay state is present.", {
      mode: this.mode,
      tick: frame.tick,
      localPlayerId: frame.localPlayerId,
      playerIds: frame.players.map((player) => player.id),
      spaceChallenge: frame.hudState?.spaceChallenge ?? null
    });
  }

  private queueTypedCharacter(character: string) {
    if (this.pendingTypedText.length >= MAX_TYPED_TEXT_BYTES) {
      return;
    }

    this.pendingTypedText = `${this.pendingTypedText}${character}`.slice(0, MAX_TYPED_TEXT_BYTES);
  }

  private resetHoldAction(action: HoldActionState) {
    action.pressed = false;
    action.startedAt = 0;
    action.holdTriggered = false;
  }

  private resetForwardDoubleTapState() {
    this.lastForwardTapAtMs = Number.NEGATIVE_INFINITY;
    this.forwardTapReleased = true;
  }

  private resetHarvestPointerAction() {
    this.harvestPointerAction.pressed = false;
    this.harvestPointerAction.nextPulseAt = 0;
  }

  private resetBuildKeyAction() {
    this.buildKeyAction.pressed = false;
    this.buildKeyAction.nextPulseAt = 0;
  }

  private clearEggInputState() {
    this.activeEggKeyCodes.clear();
    this.keyboardState.egg = false;
    this.quickEggQueued = false;
    this.quickEggPitch = 0;
    this.resetHoldAction(this.eggKeyAction);
    this.resetHoldAction(this.eggPointerAction);
  }

  private clearPointerActionState() {
    this.destroyQueued = false;
    this.queuedDestroyTarget = null;
    this.keyboardState.placePressed = false;
    this.keyboardState.pushPressed = false;
    this.resetHarvestPointerAction();
    this.resetBuildKeyAction();
    this.harvestFocusOverride = null;
    this.resetForwardDoubleTapState();
  }

  private queueQuickEgg(pitch = 0) {
    this.quickEggQueued = true;
    this.quickEggPitch = pitch;
  }

  private maybeQueueForwardPush(event: KeyboardEvent) {
    if (
      event.code !== "KeyW" ||
      event.repeat ||
      !isRuntimeMode(this.mode) ||
      !this.pointerLocked ||
      this.runtimePaused ||
      event.metaKey ||
      event.ctrlKey
    ) {
      return;
    }

    const currentTimeMs = performance.now();
    if (
      this.forwardTapReleased &&
      currentTimeMs - this.lastForwardTapAtMs <= DOUBLE_TAP_WINDOW_MS
    ) {
      this.keyboardState.pushPressed = true;
    }

    this.lastForwardTapAtMs = currentTimeMs;
    this.forwardTapReleased = false;
  }

  private resetRuntimeFeedback() {
    this.matterPulseUntil = 0;
    this.matterBubbleUntil = 0;
    this.matterFeedbackLockedUntil = 0;
    this.spaceTypePrimeUntil = 0;
    this.spaceTypeMisfireUntil = 0;
    this.spaceFailPulseUntil = 0;
    this.spaceMistakePulseUntil = 0;
    this.spaceSuccessPulseUntil = 0;
    this.superBoomImpactJoltUntil = 0;
    this.previousLocalSpacePhase = null;
    this.localSpaceChallengeTargetKey = null;
    this.localSpaceChallengeHitCount = 0;
    this.pendingTypedText = "";
    this.hideResourceBubble();
    this.emitRuntimeOverlayState(true);
  }

  private triggerNotEnoughMatterFeedback() {
    const elapsedTime = this.clock.elapsedTime;
    if (elapsedTime < this.matterFeedbackLockedUntil) {
      return;
    }

    this.matterPulseUntil = elapsedTime + MATTER_PULSE_DURATION;
    this.matterBubbleUntil = elapsedTime + MATTER_BUBBLE_DURATION;
    this.matterFeedbackLockedUntil = elapsedTime + MATTER_FEEDBACK_COOLDOWN;
    this.updateResourceBubbleMessage("I need more matter");
    this.emitRuntimeOverlayState(true, elapsedTime);
  }

  private updateLocalResourceBubble(localPlayer: RuntimePlayerState | null, elapsedTime: number) {
    if (
      !this.resourceBubbleElement ||
      !localPlayer ||
      !isRuntimeMode(this.mode) ||
      this.runtimePaused ||
      !this.pointerLocked ||
      elapsedTime >= this.matterBubbleUntil
    ) {
      this.hideResourceBubble();
      return;
    }

    const localPlayerVisual = this.playerVisuals.get(localPlayer.id);
    this.camera.updateMatrixWorld();
    if (localPlayerVisual?.group.visible) {
      localPlayerVisual.headPivot.getWorldPosition(this.resourceBubbleScreenPosition);
      this.resourceBubbleScreenPosition.y += RESOURCE_BUBBLE_HEAD_OFFSET_Y;
    } else {
      this.resourceBubbleScreenPosition.set(
        localPlayer.position.x,
        localPlayer.position.y + RESOURCE_BUBBLE_FALLBACK_Y,
        localPlayer.position.z
      );
    }
    this.resourceBubbleScreenPosition.project(this.camera);

    if (
      this.resourceBubbleScreenPosition.z < -1 ||
      this.resourceBubbleScreenPosition.z > 1
    ) {
      this.hideResourceBubble();
      return;
    }

    const x = (this.resourceBubbleScreenPosition.x * 0.5 + 0.5) * this.canvas.clientWidth;
    const y = (-this.resourceBubbleScreenPosition.y * 0.5 + 0.5) * this.canvas.clientHeight;
    this.resourceBubbleElement.style.display = "inline-flex";
    this.resourceBubbleElement.style.left = `${x}px`;
    this.resourceBubbleElement.style.top = `${y}px`;
  }

  setShellState(nextState: {
    mode: ActiveShellMode;
    initialSpawnStyle?: SimulationInitialSpawnStyle;
    localPlayerName?: string;
    localPlayerPaletteName?: ChickenPaletteName | null;
    presentation?: ShellPresentation;
    qualityTier?: QualityTier;
    runtimeSettings?: RuntimeControlSettings;
  }) {
    const nextPresentation = nextState.presentation ?? this.presentation;
    const nextInitialSpawnStyle = nextState.initialSpawnStyle ?? this.initialSpawnStyle;
    const nextLocalPlayerName = "localPlayerName" in nextState ? nextState.localPlayerName : this.localPlayerName;
    const nextLocalPlayerPaletteName =
      "localPlayerPaletteName" in nextState ? nextState.localPlayerPaletteName ?? null : this.localPlayerPaletteName;
    const nextQualityTier = nextState.qualityTier ?? this.qualityTier;
    const nextRuntimeControlSettings =
      "runtimeSettings" in nextState && nextState.runtimeSettings
        ? normalizeRuntimeControlSettings(nextState.runtimeSettings)
        : this.runtimeControlSettings;
    const modeChanged = this.mode !== nextState.mode;
    const presentationChanged = this.presentation !== nextPresentation;
    const localPaletteChanged = this.localPlayerPaletteName !== nextLocalPlayerPaletteName;
    const qualityTierChanged = this.qualityTier !== nextQualityTier;

    this.localPlayerName = nextLocalPlayerName;
    this.localPlayerPaletteName = nextLocalPlayerPaletteName;
    this.presentation = nextPresentation;
    this.qualityTier = nextQualityTier;
    this.initialSpawnStyle = nextInitialSpawnStyle;
    this.runtimeControlSettings = nextRuntimeControlSettings;

    if (!modeChanged) {
      if (presentationChanged) {
        this.updateGroundPlaneAppearance();
        this.syncSunShadowWorld();
      }
      if (presentationChanged || qualityTierChanged) {
        this.syncSunShadowMode();
      }
      if (qualityTierChanged) {
        this.rebuildSurfaceDecorations(this.worldDocument);
      }
      if ((presentationChanged || localPaletteChanged) && this.mode === "editor") {
        this.applyEditorCameraPosition();
      }
      return;
    }

    this.mode = nextState.mode;
    this.latestFrame = null;
    this.authoritativeReplica.reset();
    this.lastRuntimeInputSentAt = Number.NEGATIVE_INFINITY;
    this.lastSentRuntimeInput = null;
    this.lookYaw = null;
    this.lookPitch = aimCameraConfig.defaultPitch;
    this.hasInitializedRuntimeCamera = false;
    this.runtimeCameraUsingSpaceRig = false;
    this.hasInitializedSpectatorCamera = false;
    this.resetPointerCaptureState();
    this.pendingResumeAfterPointerLock = false;
    this.clearPointerActionState();
    this.cancelEggCharge();
    this.setRuntimePaused(true);
    this.syncSunShadowMode();
    this.worker.postMessage({
      type: "set_mode",
      mode: nextState.mode,
      ...(this.localPlayerName ? { localPlayerName: this.localPlayerName } : {}),
      ...(isRuntimeMode(nextState.mode) ? { initialSpawnStyle: this.initialSpawnStyle } : {})
    } satisfies WorkerRequestMessage);
  }

  dispatchShellIntent(intent: GameShellIntent) {
    if (intent.type === "load_map") {
      this.worldDocument = normalizeArenaBudgetMapDocument(intent.document);
      this.runtimeWorld = new MutableVoxelWorld(this.worldDocument);
      this.worker.postMessage({
        type: "load_map",
        document: this.worldDocument
      } satisfies WorkerRequestMessage);
      return;
    }

    this.worker.postMessage({
      type: "set_editor_state",
      ...intent.next
    } satisfies WorkerRequestMessage);
  }

  requestEditorDocument() {
    const requestId = `editor-doc-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return new Promise<MapDocumentV1>((resolve) => {
      this.pendingDocumentResolvers.set(requestId, resolve);
      this.worker.postMessage({
        type: "request_editor_document",
        requestId
      } satisfies WorkerRequestMessage);
    });
  }

  requestPointerLock() {
    if (!isRuntimeMode(this.mode) || this.presentation === "menu") {
      return false;
    }

    if (this.pointerLocked) {
      this.resetPointerCaptureState();
      this.emitPauseState();
      return true;
    }

    if (typeof this.canvas.requestPointerLock !== "function") {
      this.resolvePointerCaptureFailure("unsupported");
      return false;
    }

    const requestVersion = this.beginPointerCaptureRequest();

    try {
      const requestResult = this.canvas.requestPointerLock();
      if (requestResult && typeof (requestResult as PromiseLike<unknown>).then === "function") {
        void (requestResult as PromiseLike<unknown>).then(undefined, () => {
          if (this.pointerCapturePending && this.pointerCaptureRequestVersion === requestVersion) {
            this.resolvePointerCaptureFailure("error");
          }
        });
      }
    } catch {
      if (this.pointerCaptureRequestVersion === requestVersion) {
        this.resolvePointerCaptureFailure("error");
      }
      return false;
    }

    return true;
  }

  resumeRuntime() {
    if (!isRuntimeMode(this.mode)) {
      return;
    }

    if (this.pointerLocked) {
      this.pendingResumeAfterPointerLock = false;
      this.setRuntimePaused(false);
      return;
    }

    this.pendingResumeAfterPointerLock = true;
    if (!this.requestPointerLock()) {
      this.pendingResumeAfterPointerLock = false;
    }
  }

  dispose() {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    window.removeEventListener("resize", this.handleResize);
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    window.removeEventListener("blur", this.handleWindowBlur);
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    document.removeEventListener("pointerlockchange", this.handlePointerLockChange);
    document.removeEventListener("pointerlockerror", this.handlePointerLockError);
    this.canvas.removeEventListener("pointerdown", this.handlePointerDown);
    window.removeEventListener("pointerup", this.handlePointerUp);
    window.removeEventListener("pointercancel", this.handlePointerCancel);
    this.canvas.removeEventListener("pointermove", this.handlePointerMove);
    this.canvas.removeEventListener("contextmenu", this.handleContextMenu);
    this.clearPointerCaptureTimeout();
    this.worker.terminate();
    this.authoritativeReplica.reset();

    for (const mesh of this.chunkMeshes.values()) {
      mesh.geometry.dispose();
    }
    for (const player of this.playerVisuals.values()) {
      disposePlayerVisual(player);
    }
    for (const egg of this.eggVisuals.values()) {
      egg.material.dispose();
    }
    this.cloudMainMaterial.dispose();
    this.cloudShadeMaterial.dispose();
    this.spaceStarMaterial.dispose();
    this.spaceStarGeometry.dispose();
    for (const planetVisual of this.spacePlanetVisuals) {
      for (const material of planetVisual.materials) {
        material.dispose();
      }
    }
    for (const material of this.speedTraceMaterials) {
      material.dispose();
    }
    for (const material of this.voxelFxDisposables) {
      material.dispose();
    }
    for (const geometry of this.voxelFxGeometries) {
      geometry.dispose();
    }
    this.eggTrajectoryPreview.geometry.dispose();
    this.eggTrajectoryPreview.material.dispose();
    this.eggTrajectoryPreview.landingGeometry.dispose();
    this.eggTrajectoryPreview.landingMaterial.dispose();
    this.focusOutline.geometry.dispose();
    (this.focusOutline.material as THREE.Material).dispose();
    this.focusGhost.geometry.dispose();
    (this.focusGhost.material as THREE.Material).dispose();
    this.sunShadows.dispose();
    this.coveredPlayerSilhouetteMaterial.dispose();
    this.resourceBubbleElement?.remove();
    this.resourceBubbleElement = null;
    this.renderer.dispose();
  }

  private initScene() {
    this.scene.background = this.sceneBackgroundColor;
    this.scene.fog = new THREE.Fog(backgroundColor, this.baseFogNear, this.baseFogFar);
    this.directionalLight.position.set(36, 56, 24);
    enableSunShadowLayer(this.camera);
    enableSunShadowLayer(this.ambientLight);
    enableSunShadowLayer(this.hemisphereLight);
    enableSunShadowLayer(this.focusRaycaster);
    enableSunShadowLayer(this.clickRaycaster);
    enableSunShadowLayer(this.playerShadowRaycaster);
    enableSunShadowLayer(this.eggTrajectoryRaycaster);
    this.spaceBackdropGroup.visible = false;
    this.spaceStars.frustumCulled = false;
    this.spaceBackdropGroup.add(this.spaceStars);
    this.coveredPlayerSilhouetteGroup.visible = false;
    this.buildSpaceBackdrop();
    this.trackSunShadowMaterials();

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), runtimeGroundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.name = "ground-plane";
    ground.receiveShadow = true;
    configureSunShadowObject(ground, {
      castShadow: false,
      receiveShadow: true
    });

    this.scene.add(
      this.camera,
      this.ambientLight,
      this.directionalLight,
      this.hemisphereLight,
      this.cloudsGroup,
      this.spaceBackdropGroup,
      ground
    );
    this.scene.add(
      this.terrainGroup,
      this.propsGroup,
      this.decorationsGroup,
      this.spawnsGroup,
      this.playersGroup,
      this.coveredPlayerSilhouetteGroup,
      this.eggsGroup,
      this.eggTrajectoryPreview.group,
      this.voxelFxGroup,
      this.skyDropsGroup,
      this.clustersGroup,
      this.focusOutline,
      this.focusGhost
    );

    for (const profile of voxelFxProfiles) {
      const scatterMesh = new THREE.InstancedMesh(
        sharedVoxelGeometry,
        getVoxelMaterials(profile),
        MAX_EGG_SCATTER_INSTANCES_PER_PROFILE
      );
      scatterMesh.frustumCulled = false;
      configureDynamicInstancedMesh(scatterMesh);
      finalizeDynamicInstancedMesh(scatterMesh, 0);
      this.eggScatterMeshes.set(profile, scatterMesh);
      this.voxelFxGroup.add(scatterMesh);

      const harvestMesh = createDynamicOpacityMeshResource(MAX_HARVEST_BURST_INSTANCES_PER_PROFILE, getVoxelMaterials(profile));
      this.harvestBurstMeshes.set(profile, harvestMesh);
      this.voxelFxDisposables.push(...harvestMesh.materials);
      this.voxelFxGeometries.push(harvestMesh.geometry);
      this.voxelFxGroup.add(harvestMesh.mesh);
    }

    this.eggExplosionBurstMesh = createDynamicOpacityMeshResource(
      MAX_EGG_EXPLOSION_BURST_INSTANCES,
      new THREE.MeshBasicMaterial({
        color: "#fff1bf",
        opacity: 1,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false
      })
    );
    this.voxelFxDisposables.push(...this.eggExplosionBurstMesh.materials);
    this.voxelFxGeometries.push(this.eggExplosionBurstMesh.geometry);
    this.voxelFxGroup.add(this.eggExplosionBurstMesh.mesh);

    this.eggExplosionShockwaveMesh = createDynamicOpacityMeshResource(
      MAX_EGG_EXPLOSION_SHOCKWAVE_INSTANCES,
      new THREE.MeshBasicMaterial({
        color: "#fff0be",
        opacity: 1,
        transparent: true,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false
      }),
      new THREE.RingGeometry(0.72, 1.16, 32)
    );
    this.voxelFxDisposables.push(...this.eggExplosionShockwaveMesh.materials);
    this.voxelFxGeometries.push(this.eggExplosionShockwaveMesh.geometry);
    this.voxelFxGroup.add(this.eggExplosionShockwaveMesh.mesh);

    this.featherBurstPlumeMesh = createDynamicOpacityMeshResource(
      MAX_FEATHER_BURST_INSTANCES,
      new THREE.MeshBasicMaterial({
        color: "#fff9ef",
        opacity: 1,
        transparent: true,
        depthWrite: false,
        toneMapped: false
      }),
      featherBurstPlumeGeometry.clone()
    );
    this.voxelFxDisposables.push(...this.featherBurstPlumeMesh.materials);
    this.voxelFxGeometries.push(this.featherBurstPlumeMesh.geometry);
    this.voxelFxGroup.add(this.featherBurstPlumeMesh.mesh);

    this.featherBurstQuillMesh = createDynamicOpacityMeshResource(
      MAX_FEATHER_BURST_INSTANCES,
      new THREE.MeshBasicMaterial({
        color: "#d3b169",
        opacity: 1,
        transparent: true,
        depthWrite: false,
        toneMapped: false
      }),
      featherBurstQuillGeometry.clone()
    );
    this.voxelFxDisposables.push(...this.featherBurstQuillMesh.materials);
    this.voxelFxGeometries.push(this.featherBurstQuillMesh.geometry);
    this.voxelFxGroup.add(this.featherBurstQuillMesh.mesh);

    this.speedTraceGroup.visible = false;
    this.speedTraceGroup.position.set(0, 0, -SPEED_TRACE_DEPTH);
    for (const layout of speedTraceLayouts) {
      const material = new THREE.MeshBasicMaterial({
        color: "#fff8d8",
        blending: THREE.AdditiveBlending,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        depthTest: false,
        toneMapped: false,
        side: THREE.DoubleSide
      });
      const streak = new THREE.Mesh(speedTraceGeometry, material);
      streak.scale.set(0.18 * layout.width, layout.scaleY, 1);
      streak.frustumCulled = false;
      streak.renderOrder = 1000;
      this.speedTraceMaterials.push(material);
      this.speedTraceGroup.add(streak);
    }
    this.camera.add(this.speedTraceGroup);

    this.focusOutline.visible = false;
    this.focusGhost.visible = false;
    this.applyWorldDocument(this.worldDocument);
    this.syncSunShadowMode();
    if (this.mode === "editor") {
      this.applyEditorCameraPosition();
    }
  }

  private attachEvents() {
    window.addEventListener("resize", this.handleResize);
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
    window.addEventListener("blur", this.handleWindowBlur);
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
    document.addEventListener("pointerlockchange", this.handlePointerLockChange);
    document.addEventListener("pointerlockerror", this.handlePointerLockError);
    this.canvas.addEventListener("pointerdown", this.handlePointerDown);
    window.addEventListener("pointerup", this.handlePointerUp);
    window.addEventListener("pointercancel", this.handlePointerCancel);
    this.canvas.addEventListener("pointermove", this.handlePointerMove);
    this.canvas.addEventListener("contextmenu", this.handleContextMenu);
  }

  private clearPointerCaptureTimeout() {
    if (this.pointerCaptureTimeoutId !== null) {
      window.clearTimeout(this.pointerCaptureTimeoutId);
      this.pointerCaptureTimeoutId = null;
    }
  }

  private beginPointerCaptureRequest() {
    this.clearPointerCaptureTimeout();
    this.pointerCaptureRequestVersion += 1;
    this.pointerCapturePending = true;
    this.pointerCaptureFailureReason = null;
    const requestVersion = this.pointerCaptureRequestVersion;
    this.pointerCaptureTimeoutId = window.setTimeout(() => {
      if (this.pointerCapturePending && this.pointerCaptureRequestVersion === requestVersion) {
        this.resolvePointerCaptureFailure("timeout");
      }
    }, POINTER_CAPTURE_TIMEOUT_MS);
    this.emitPauseState();
    return requestVersion;
  }

  private resetPointerCaptureState() {
    this.pointerCapturePending = false;
    this.pointerCaptureFailureReason = null;
    this.clearPointerCaptureTimeout();
  }

  private resolvePointerCaptureFailure(reason: PointerCaptureFailureReason) {
    this.pointerCapturePending = false;
    this.pointerCaptureFailureReason = reason;
    this.pendingResumeAfterPointerLock = false;
    this.clearPointerCaptureTimeout();

    if (this.runtimePaused) {
      this.emitPauseState();
      return;
    }

    this.setRuntimePaused(true);
  }

  private attachWorker() {
    this.worker.onmessage = (event: MessageEvent<WorkerResponseMessage>) => {
      const message = event.data;
      switch (message.type) {
        case "ready":
          this.callbacks.onEditorStateChange?.(message.editorState);
          return;
        case "world_sync":
          this.mode = message.mode;
          this.applyWorldSync(message.world.document, message.world.chunkPatches);
          this.pendingReadyToDisplay = true;
          return;
        case "terrain_patches":
          this.applyTerrainPatches(message.patches);
          return;
        case "frame":
          this.latestFrame = message.frame;
          if (message.frame.authoritative) {
            this.authoritativeReplica.applyFrame(message.frame.authoritative);
            this.syncRuntimeWorldFromTerrainDeltaBatch(message.frame.authoritative.terrainDeltaBatch);
          }
          this.updateFocusedTargetVisuals();
          this.callbacks.onHudStateChange?.(message.frame.hudState);
          return;
        case "hud_state":
          this.callbacks.onHudStateChange?.(message.hudState);
          return;
        case "editor_state":
          this.callbacks.onEditorStateChange?.(message.editorState);
          return;
        case "status":
          this.callbacks.onStatus?.(message.message);
          return;
        case "editor_document": {
          const resolver = this.pendingDocumentResolvers.get(message.requestId);
          if (resolver) {
            this.pendingDocumentResolvers.delete(message.requestId);
            resolver(message.document);
          }
          return;
        }
        case "diagnostics":
          this.callbacks.onDiagnostics?.({
            ...message.diagnostics,
            render: this.sunShadows.getDiagnostics()
          });
          return;
      }
    };
  }

  private applyWorldSync(document: MapDocumentV1, chunkPatches: TerrainChunkPatchPayload[]) {
    this.worldDocument = normalizeArenaBudgetMapDocument(document);
    this.runtimeWorld = new MutableVoxelWorld(this.worldDocument);
    this.lastRuntimeInputSentAt = Number.NEGATIVE_INFINITY;
    this.lastSentRuntimeInput = null;
    this.spaceBlend = 0;
    this.clearTerrain();
    this.clearRuntimeEntities();
    this.applyWorldDocument(this.worldDocument);
    this.applyTerrainPatches(chunkPatches);
    if (this.mode === "editor") {
      this.applyEditorCameraPosition();
    }
  }

  private applyWorldDocument(document: MapDocumentV1) {
    const arenaSpan = Math.max(document.size.x, document.size.z);
    this.baseFogNear =
      this.presentation === "menu"
        ? Math.max(120, arenaSpan * 1.1)
        : Math.max(36, arenaSpan * 0.45);
    this.baseFogFar =
      this.presentation === "menu"
        ? Math.max(this.baseFogNear + 240, arenaSpan * 3.4)
        : Math.max(this.baseFogNear + 40, arenaSpan + 44);
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.near = this.baseFogNear;
      this.scene.fog.far = this.baseFogFar;
    }

    const ground = this.scene.getObjectByName("ground-plane") as THREE.Mesh | null;
    if (ground) {
      ground.position.set(document.size.x / 2, -0.01, document.size.z / 2);
      ground.scale.set(document.size.x + 32, document.size.z + 32, 1);
    }

    this.updateGroundPlaneAppearance();
    this.syncSunShadowWorld(document);
    this.syncSunShadowMode();

    this.directionalLight.position.set(
      document.size.x * 0.72,
      Math.max(document.size.y + 24, 56),
      document.size.z * 0.5
    );
    this.rebuildClouds(document);
    this.rebuildProps(document);
    this.rebuildSurfaceDecorations(document);
    this.rebuildSpawns(document);
  }

  private updateGroundPlaneAppearance() {
    const ground = this.scene.getObjectByName("ground-plane") as THREE.Mesh | null;
    if (!ground) {
      return;
    }

    ground.material = this.presentation === "menu" ? menuGroundMaterial : runtimeGroundMaterial;
  }

  private rebuildClouds(document: MapDocumentV1) {
    this.cloudVisuals.length = 0;
    this.cloudsGroup.clear();

    for (const preset of cloudPresets) {
      const group = new THREE.Group();
      const { mainMatrices, shadeMatrices } = buildCloudMatrices(preset);
      const initialPosition = getVoxelCloudPosition(preset, 0, document.size);

      if (mainMatrices.length > 0) {
        const mainMesh = new THREE.InstancedMesh(cloudGeometry, this.cloudMainMaterial, mainMatrices.length);
        mainMesh.frustumCulled = false;
        configureStaticInstancedMesh(mainMesh, mainMatrices);
        group.add(mainMesh);
      }

      if (shadeMatrices.length > 0) {
        const shadeMesh = new THREE.InstancedMesh(cloudGeometry, this.cloudShadeMaterial, shadeMatrices.length);
        shadeMesh.frustumCulled = false;
        configureStaticInstancedMesh(shadeMesh, shadeMatrices);
        group.add(shadeMesh);
      }

      group.position.set(initialPosition.x, initialPosition.y, initialPosition.z);
      this.cloudsGroup.add(group);
      this.cloudVisuals.push({
        group,
        preset
      });
    }
  }

  private buildSpaceBackdrop() {
    this.spacePlanetVisuals.length = 0;
    this.spaceBackdropGroup.clear();
    this.spaceBackdropGroup.add(this.spaceStars);

    for (const descriptor of spacePlanetDescriptors) {
      const group = new THREE.Group();
      const [offsetX, offsetY, offsetZ] = descriptor.offset;
      const [radiusX, radiusY, radiusZ] = descriptor.radius;
      const { mainMatrices, shadeMatrices } = buildVoxelPlanetMatrices(radiusX, radiusY, radiusZ);
      const mainMaterial = new THREE.MeshBasicMaterial({
        color: descriptor.colors[0],
        transparent: true,
        opacity: 0,
        toneMapped: false
      });
      const shadeMaterial = new THREE.MeshBasicMaterial({
        color: descriptor.colors[1],
        transparent: true,
        opacity: 0,
        toneMapped: false
      });
      if (mainMatrices.length > 0) {
        const mainMesh = new THREE.InstancedMesh(sharedVoxelGeometry, mainMaterial, mainMatrices.length);
        mainMesh.frustumCulled = false;
        configureStaticInstancedMesh(mainMesh, mainMatrices);
        group.add(mainMesh);
      }
      if (shadeMatrices.length > 0) {
        const shadeMesh = new THREE.InstancedMesh(sharedVoxelGeometry, shadeMaterial, shadeMatrices.length);
        shadeMesh.frustumCulled = false;
        configureStaticInstancedMesh(shadeMesh, shadeMatrices);
        group.add(shadeMesh);
      }
      group.position.set(offsetX, offsetY, offsetZ);
      group.scale.setScalar(descriptor.scale);
      this.spaceBackdropGroup.add(group);
      this.spacePlanetVisuals.push({
        group,
        materials: [mainMaterial, shadeMaterial],
        spinSpeed: descriptor.spinSpeed,
        wobblePhase: descriptor.wobblePhase
      });
    }
  }

  private updateSkyEnvironment(localPlayer: RuntimePlayerState | null, delta: number, elapsedTime: number) {
    for (const cloudVisual of this.cloudVisuals) {
      const position = getVoxelCloudPosition(cloudVisual.preset, elapsedTime, this.worldDocument.size);
      cloudVisual.group.position.set(position.x, position.y, position.z);
    }

    const targetSpaceBlend = localPlayer && localPlayer.spacePhase !== "none" ? 1 : 0;
    this.spaceBlend = dampScalar(this.spaceBlend, targetSpaceBlend, SPACE_BLEND_DAMPING, delta);

    const cloudOpacity = Math.max(0, 1 - this.spaceBlend);
    this.cloudMainMaterial.opacity = cloudOpacity;
    this.cloudShadeMaterial.opacity = cloudOpacity * 0.96;
    this.cloudsGroup.visible = cloudOpacity > 0.02;

    this.sceneBackgroundColor.copy(daySkyColor).lerp(spaceSkyColor, this.spaceBlend);
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.color.copy(dayFogColor).lerp(spaceFogColor, this.spaceBlend);
      this.scene.fog.near = THREE.MathUtils.lerp(this.baseFogNear, this.baseFogNear + 92, this.spaceBlend);
      this.scene.fog.far = THREE.MathUtils.lerp(this.baseFogFar, this.baseFogFar + 260, this.spaceBlend);
    }

    this.ambientLight.intensity = THREE.MathUtils.lerp(0.45, 0.28, this.spaceBlend);
    this.directionalLight.intensity = THREE.MathUtils.lerp(1.36, 0.56, this.spaceBlend);
    this.hemisphereLight.intensity = THREE.MathUtils.lerp(0.22, 0.04, this.spaceBlend);
    this.sunShadows.setLightIntensity(this.directionalLight.intensity);

    this.spaceBackdropGroup.visible = this.spaceBlend > 0.01;
    this.spaceBackdropGroup.position.copy(this.camera.position);
    this.spaceStarMaterial.opacity = this.spaceBlend * 0.92;

    for (const planetVisual of this.spacePlanetVisuals) {
      planetVisual.group.rotation.y += delta * planetVisual.spinSpeed;
      planetVisual.group.rotation.x = Math.sin(elapsedTime * 0.18 + planetVisual.wobblePhase) * 0.12;
      for (const material of planetVisual.materials) {
        material.opacity = this.spaceBlend * 0.96;
      }
    }
  }

  private applyTerrainPatches(patches: TerrainChunkPatchPayload[]) {
    for (const patch of patches) {
      const existing = this.chunkMeshes.get(patch.key);
      if (patch.remove) {
        if (existing) {
          existing.geometry.dispose();
          this.terrainGroup.remove(existing);
          this.chunkMeshes.delete(patch.key);
        }
        continue;
      }

      const geometry = createTerrainGeometry(patch);
      if (existing) {
        existing.geometry.dispose();
      }
      const mesh =
        existing ??
        new THREE.Mesh(geometry, getTerrainChunkMaterials());
      mesh.frustumCulled = true;
      mesh.geometry = geometry;
      mesh.material = getTerrainChunkMaterials();
      mesh.position.set(...patch.position);
      configureSunShadowObject(mesh, {
        castShadow: true,
        receiveShadow: true
      });
      if (!existing) {
        this.terrainGroup.add(mesh);
        this.chunkMeshes.set(patch.key, mesh);
      }
    }

    this.currentTerrainStats.chunkCount = this.chunkMeshes.size;
    this.currentTerrainStats.drawCallCount = patches.reduce((sum, patch) => sum + patch.drawCallCount, 0);
    this.currentTerrainStats.triangleCount = patches.reduce((sum, patch) => sum + patch.triangleCount, 0);
    if (patches.length > 0) {
      this.sunShadows.markDirty();
    }
  }

  private rebuildProps(document: MapDocumentV1) {
    this.propsGroup.clear();
    const barkMatrices: THREE.Matrix4[] = [];
    const leafMatrices: THREE.Matrix4[] = [];

    for (const prop of document.props) {
      for (const voxel of getMapPropVoxels(prop)) {
        treeTempMatrix.compose(
          new THREE.Vector3(voxel.x + 0.5, voxel.y + 0.5, voxel.z + 0.5),
          new THREE.Quaternion(),
          new THREE.Vector3(1, 1, 1)
        );
        if (voxel.kind === "wood") {
          barkMatrices.push(treeTempMatrix.clone());
        } else {
          leafMatrices.push(treeTempMatrix.clone());
        }
      }
    }

    if (barkMatrices.length > 0) {
      const barkMesh = new THREE.InstancedMesh(sharedVoxelGeometry, propMaterials.bark, barkMatrices.length);
      configureStaticInstancedMesh(barkMesh, barkMatrices);
      configureSunShadowObject(barkMesh, {
        castShadow: true,
        receiveShadow: true
      });
      this.propsGroup.add(barkMesh);
    }
    if (leafMatrices.length > 0) {
      const leafMesh = new THREE.InstancedMesh(sharedVoxelGeometry, propMaterials.leaves, leafMatrices.length);
      configureStaticInstancedMesh(leafMesh, leafMatrices);
      configureSunShadowObject(leafMesh, {
        castShadow: true,
        receiveShadow: true
      });
      this.propsGroup.add(leafMesh);
    }

    this.sunShadows.markDirty();
  }

  private rebuildSurfaceDecorations(document: MapDocumentV1) {
    this.decorationsGroup.clear();
    const world = new MutableVoxelWorld(document);
    const decorations = filterSurfaceDecorationsByDensity(
      buildSurfaceDecorations(world),
      getDecorationDensityForQualityTier(this.qualityTier)
    );
    const {
      grassMatrices,
      flowerYellowMatrices,
      flowerPinkMatrices,
      flowerWhiteMatrices,
      flowerBlueMatrices
    } = buildDecorationMatrices(decorations);

    const addDecorationMesh = (
      geometry: THREE.BufferGeometry,
      material: THREE.Material,
      matrices: THREE.Matrix4[]
    ) => {
      if (matrices.length === 0) {
        return;
      }

      const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
      configureStaticInstancedMesh(mesh, matrices);
      configureSunShadowObject(mesh, {
        castShadow: false,
        receiveShadow: true
      });
      this.decorationsGroup.add(mesh);
    };

    addDecorationMesh(grassCardGeometry, propMaterials.grass, grassMatrices);
    addDecorationMesh(flowerCardGeometry, propMaterials.flowerYellow, flowerYellowMatrices);
    addDecorationMesh(flowerCardGeometry, propMaterials.flowerPink, flowerPinkMatrices);
    addDecorationMesh(flowerCardGeometry, propMaterials.flowerWhite, flowerWhiteMatrices);
    addDecorationMesh(flowerCardGeometry, propMaterials.flowerBlue, flowerBlueMatrices);

    this.sunShadows.markDirty();
  }

  private rebuildSpawns(document: MapDocumentV1) {
    this.spawnsGroup.clear();
    const markerGeometry = new THREE.CylinderGeometry(0.18, 0.18, 0.7, 8);
    const markerMaterial = new THREE.MeshStandardMaterial({ color: "#f2eed1" });
    const capGeometry = new THREE.BoxGeometry(0.5, 0.16, 0.5);
    const capMaterial = new THREE.MeshStandardMaterial({ color: "#2d3f4f" });

    for (const spawn of document.spawns) {
      const group = new THREE.Group();
      group.position.set(spawn.x, spawn.y, spawn.z);
      const marker = new THREE.Mesh(markerGeometry, markerMaterial);
      marker.position.set(0, 0.35, 0);
      const cap = new THREE.Mesh(capGeometry, capMaterial);
      cap.position.set(0, 0.8, 0);
      group.add(marker, cap);
      this.spawnsGroup.add(group);
    }
  }

  private applyEditorCameraPosition() {
    if (this.presentation === "menu") {
      this.positionMenuCamera();
      return;
    }

    this.positionEditorCamera();
  }

  private positionEditorCamera() {
    const span = Math.max(this.worldDocument.size.x, this.worldDocument.size.z);
    this.setCameraFov(40);
    this.camera.up.set(0, 1, 0);
    this.camera.position.set(
      this.worldDocument.size.x / 2 + span * 0.46,
      span * 0.34,
      this.worldDocument.size.z / 2 + span * 0.4
    );
    this.camera.lookAt(this.worldDocument.size.x / 2, 10, this.worldDocument.size.z / 2);
  }

  private positionMenuCamera() {
    const span = Math.max(this.worldDocument.size.x, this.worldDocument.size.z);
    const centerX = this.worldDocument.size.x / 2;
    const centerZ = this.worldDocument.size.z / 2;
    this.setCameraFov(44);
    this.camera.up.set(0, 1, 0);
    this.camera.position.set(
      centerX + span * 0.18,
      Math.max(span * 0.62, this.worldDocument.size.y * 2.2),
      centerZ + span * 0.24
    );
    this.camera.lookAt(centerX, Math.max(4, this.worldDocument.size.y * 0.14), centerZ);
  }

  private setCameraFov(nextFov: number) {
    if (Math.abs(this.camera.fov - nextFov) <= 0.01) {
      return;
    }

    this.camera.fov = nextFov;
    this.camera.updateProjectionMatrix();
    this.sunShadows.handleCameraProjectionChange();
  }

  private clearTerrain() {
    for (const mesh of this.chunkMeshes.values()) {
      mesh.geometry.dispose();
      this.terrainGroup.remove(mesh);
    }
    this.chunkMeshes.clear();
    this.sunShadows.markDirty();
  }

  private clearRuntimeEntities() {
    for (const player of this.playerVisuals.values()) {
      this.playersGroup.remove(player.group);
      disposePlayerVisual(player);
    }
    if (this.coveredPlayerSilhouetteRoot) {
      this.coveredPlayerSilhouetteGroup.remove(this.coveredPlayerSilhouetteRoot);
      this.coveredPlayerSilhouetteRoot = null;
    }
    this.coveredPlayerSilhouetteSource = null;
    this.coveredPlayerSilhouetteGroup.visible = false;
    for (const egg of this.eggVisuals.values()) {
      this.eggsGroup.remove(egg.group);
      egg.material.dispose();
    }
    for (const skyDrop of this.skyDropVisuals.values()) {
      this.skyDropsGroup.remove(skyDrop.group);
    }
    for (const cluster of this.clusterVisuals.values()) {
      this.clustersGroup.remove(cluster.group);
    }
    this.playerVisuals.clear();
    this.playerObservedLives.clear();
    this.eggVisuals.clear();
    this.skyDropVisuals.clear();
    this.clusterVisuals.clear();
    this.cancelEggCharge();
    this.resetRuntimeFeedback();
    for (const mesh of this.eggScatterMeshes.values()) {
      finalizeDynamicInstancedMesh(mesh, 0);
    }
    for (const resource of this.harvestBurstMeshes.values()) {
      finalizeDynamicOpacityMesh(resource, 0);
    }
    finalizeDynamicOpacityMesh(this.eggExplosionBurstMesh, 0);
    finalizeDynamicOpacityMesh(this.eggExplosionShockwaveMesh, 0);
    this.clearFeatherBursts();
  }

  private clearFeatherBursts() {
    for (const burst of this.featherBurstStates) {
      burst.active = false;
      burst.createdAt = Number.NEGATIVE_INFINITY;
      burst.serial = 0;
    }

    this.nextFeatherBurstSerial = 1;
    finalizeDynamicOpacityMesh(this.featherBurstPlumeMesh, 0);
    finalizeDynamicOpacityMesh(this.featherBurstQuillMesh, 0);
  }

  private triggerFeatherBurst(
    origin: {
      x: number;
      y: number;
      z: number;
    },
    lostLives = 1,
    elapsedTime = this.clock.elapsedTime
  ) {
    for (let burstIndex = 0; burstIndex < Math.max(1, lostLives); burstIndex += 1) {
      const reusableBurst =
        this.featherBurstStates.find(
          (burst) => !burst.active || elapsedTime - burst.createdAt >= FEATHER_BURST_LIFETIME
        ) ??
        this.featherBurstStates.reduce((oldestBurst, burst) =>
          burst.createdAt < oldestBurst.createdAt ? burst : oldestBurst
        );

      reusableBurst.active = true;
      reusableBurst.createdAt = elapsedTime;
      reusableBurst.serial = this.nextFeatherBurstSerial;
      reusableBurst.origin.set(origin.x, origin.y + 0.58 + burstIndex * 0.03, origin.z);
      this.nextFeatherBurstSerial += 1;
    }
  }

  private syncFeatherBursts(elapsedTime: number) {
    if (!this.featherBurstPlumeMesh || !this.featherBurstQuillMesh) {
      return;
    }

    let instanceCount = 0;
    outer: for (const burst of this.featherBurstStates) {
      if (!burst.active) {
        continue;
      }

      const age = (elapsedTime - burst.createdAt) / FEATHER_BURST_LIFETIME;
      if (age >= 1) {
        burst.active = false;
        continue;
      }

      const opacity = Math.max(0, 1 - age);
      const spreadAlpha = 0.16 + age * 1.12;
      for (let particleIndex = 0; particleIndex < FEATHER_BURST_PARTICLE_COUNT; particleIndex += 1) {
        if (instanceCount >= MAX_FEATHER_BURST_INSTANCES) {
          break outer;
        }

        const seed = hashFeatherBurstSeed(burst.serial, particleIndex);
        const yaw = ((seed % 360) * Math.PI) / 180;
        const radialDistance = 0.22 + ((seed >>> 3) % 7) * 0.05;
        const lift = 0.72 + ((seed >>> 6) % 7) * 0.1;
        const tumbleSpeed = 1.8 + ((seed >>> 9) % 5) * 0.28;
        const rollDirection = particleIndex % 2 === 0 ? 1 : -1;
        const scale = Math.max(0.24, 0.82 - age * 0.46) * (0.82 + ((seed >>> 12) % 5) * 0.08);
        const sway = (((seed >>> 15) % 9) - 4) * 0.012;

        voxelFxTempObject.position.set(
          burst.origin.x + Math.sin(yaw) * radialDistance * spreadAlpha,
          burst.origin.y + lift * age - age * age * 0.9 + sway,
          burst.origin.z + Math.cos(yaw) * radialDistance * spreadAlpha
        );
        voxelFxTempObject.rotation.set(
          0.2 + age * tumbleSpeed * 0.65,
          yaw + (((seed >>> 20) % 360) * Math.PI) / 180,
          (((seed >>> 24) % 360) * Math.PI) / 180 + age * tumbleSpeed * rollDirection
        );
        voxelFxTempObject.scale.set(scale * 0.82, scale * 1.08, scale * 0.82);
        voxelFxTempObject.updateMatrix();

        this.featherBurstPlumeMesh.mesh.setMatrixAt(instanceCount, voxelFxTempObject.matrix);
        this.featherBurstPlumeMesh.opacityAttribute.setX(instanceCount, opacity * (0.9 - age * 0.12));
        this.featherBurstQuillMesh.mesh.setMatrixAt(instanceCount, voxelFxTempObject.matrix);
        this.featherBurstQuillMesh.opacityAttribute.setX(instanceCount, opacity * 0.96);
        instanceCount += 1;
      }
    }

    finalizeDynamicOpacityMesh(this.featherBurstPlumeMesh, instanceCount);
    finalizeDynamicOpacityMesh(this.featherBurstQuillMesh, instanceCount);
  }

  private getLocalRuntimePlayer(frame: RuntimeRenderFrame | null = this.latestFrame) {
    if (!frame?.localPlayerId) {
      return null;
    }

    return frame.players.find((player) => player.id === frame.localPlayerId) ?? null;
  }

  private getLocalEggStatus(frame: RuntimeRenderFrame | null = this.latestFrame) {
    const localPlayer = this.getLocalRuntimePlayer(frame);
    const localPlayerId = frame?.localPlayerId ?? localPlayer?.id ?? null;
    if (!localPlayerId || !localPlayer) {
      return null;
    }

    if (frame?.hudState?.eggStatus) {
      return frame.hudState.eggStatus;
    }

    return getHudEggStatus({
      localPlayerId,
      localPlayerMass: localPlayer.mass,
      localPlayer,
      eggs: frame?.eggs ?? [],
      eggCost: EGG_COST,
      maxActiveEggsPerPlayer: MAX_ACTIVE_EGGS_PER_PLAYER,
      eggFuseDuration: EGG_FUSE_DURATION
    });
  }

  private canStartGroundEggCharge(
    localPlayer: RuntimePlayerState | null,
    eggStatus = this.getLocalEggStatus() ??
      (localPlayer
        ? getHudEggStatus({
            localPlayerId: localPlayer.id,
            localPlayerMass: localPlayer.mass,
            localPlayer,
            eggs: this.latestFrame?.eggs ?? [],
            eggCost: EGG_COST,
            maxActiveEggsPerPlayer: MAX_ACTIVE_EGGS_PER_PLAYER,
            eggFuseDuration: EGG_FUSE_DURATION
          })
        : null)
  ) {
    return localPlayer !== null && eggStatus?.canChargedThrow === true;
  }

  private isEggChargeInputHeld() {
    return (
      (this.eggChargeState.source === "key" && this.eggKeyAction.pressed) ||
      (this.eggChargeState.source === "pointer" && this.eggPointerAction.pressed)
    );
  }

  private startEggPointerAction() {
    this.eggPointerAction.pressed = true;
    this.eggPointerAction.startedAt = this.clock.elapsedTime;
    this.eggPointerAction.holdTriggered = false;

    if (this.pointerLocked && !this.runtimePaused && this.getLocalEggStatus()?.reason === "notEnoughMatter") {
      this.triggerNotEnoughMatterFeedback();
    }
  }

  private releaseEggAction(action: HoldActionState, source: EggChargeInputSource) {
    if (!action.pressed) {
      return;
    }

    const localPlayer = this.getLocalRuntimePlayer();
    const eggStatus = this.getLocalEggStatus();
    const tappedQuickEgg = !action.holdTriggered && this.pointerLocked && !this.runtimePaused;

    if (this.eggChargeState.active && this.eggChargeState.source === source) {
      this.queueGroundEggThrow();
    } else if (tappedQuickEgg) {
      if (eggStatus?.reason === "notEnoughMatter") {
        this.triggerNotEnoughMatterFeedback();
      } else if (eggStatus?.canQuickEgg) {
        this.queueQuickEgg(localPlayer?.grounded ? this.lookPitch : 0);
      }
    }

    this.resetHoldAction(action);
  }

  private updateHoldToThrowAction(
    action: HoldActionState,
    source: EggChargeInputSource,
    localPlayer: RuntimePlayerState | null,
    elapsedTime: number
  ) {
    if (
      !action.pressed ||
      action.holdTriggered ||
      elapsedTime - action.startedAt < INPUT_HOLD_THRESHOLD
    ) {
      return;
    }

    action.holdTriggered = true;
    if (!this.pointerLocked || this.runtimePaused) {
      return;
    }

    const eggStatus = this.getLocalEggStatus();
    if (eggStatus?.reason === "notEnoughMatter") {
      this.triggerNotEnoughMatterFeedback();
    }

    if (!this.eggChargeState.active && this.canStartGroundEggCharge(localPlayer, eggStatus)) {
      this.beginEggCharge(source);
    }
  }

  private updateHoldToThrowState(localPlayer: RuntimePlayerState | null, elapsedTime: number) {
    this.updateHoldToThrowAction(this.eggKeyAction, "key", localPlayer, elapsedTime);
    this.updateHoldToThrowAction(this.eggPointerAction, "pointer", localPlayer, elapsedTime);
  }

  private beginEggCharge(source: EggChargeInputSource) {
    this.eggChargeState.active = true;
    this.eggChargeState.startedAt = this.clock.elapsedTime;
    this.eggChargeState.chargeAlpha = 0;
    this.eggChargeState.pendingThrow = false;
    this.eggChargeState.pendingThrowCharge = 0;
    this.eggChargeState.pendingThrowPitch = 0;
    this.eggChargeState.source = source;
  }

  private queueGroundEggThrow() {
    this.eggChargeState.active = false;
    this.eggChargeState.pendingThrow = true;
    this.eggChargeState.pendingThrowCharge = Math.max(MIN_GROUNDED_EGG_CHARGE, this.eggChargeState.chargeAlpha);
    this.eggChargeState.pendingThrowPitch = this.lookPitch;
    this.eggChargeState.chargeAlpha = 0;
    this.eggChargeState.releaseRemaining = chickenPoseVisualDefaults.eggLaunchReleaseDuration;
    this.eggChargeState.source = null;
    this.hideEggTrajectoryPreview();
  }

  private cancelEggCharge(clearRelease = true) {
    this.eggChargeState.active = false;
    this.eggChargeState.chargeAlpha = 0;
    this.eggChargeState.pendingThrow = false;
    this.eggChargeState.pendingThrowCharge = 0;
    this.eggChargeState.pendingThrowPitch = 0;
    this.eggChargeState.source = null;
    if (clearRelease) {
      this.eggChargeState.releaseRemaining = 0;
    }
    this.hideEggTrajectoryPreview();
  }

  private updateEggChargeState(localPlayer: RuntimePlayerState | null, delta: number, elapsedTime: number) {
    this.eggChargeState.releaseRemaining = Math.max(0, this.eggChargeState.releaseRemaining - delta);

    if (!this.eggChargeState.active) {
      return;
    }

    if (
      !this.isEggChargeInputHeld() ||
      this.runtimePaused ||
      !this.pointerLocked ||
      !this.canStartGroundEggCharge(localPlayer)
    ) {
      this.cancelEggCharge(false);
      return;
    }

    this.eggChargeState.chargeAlpha = getEggChargeAlpha(
      elapsedTime - this.eggChargeState.startedAt,
      EGG_CHARGE_DURATION
    );
  }

  private hideEggTrajectoryPreview() {
    this.eggTrajectoryPreview.group.visible = false;
    this.eggTrajectoryPreview.geometry.setDrawRange(0, 0);
    this.eggTrajectoryPreview.landingRing.visible = false;
  }

  private setEggTrajectoryPreviewPoint(index: number, point: THREE.Vector3) {
    this.eggTrajectoryPreview.positionAttribute.setXYZ(index, point.x, point.y, point.z);
  }

  private updateEggLaunchPreview(localPlayer: RuntimePlayerState | null, elapsedTime: number) {
    if (
      localPlayer === null ||
      !this.eggChargeState.active ||
      this.runtimePaused ||
      !this.pointerLocked ||
      !this.canStartGroundEggCharge(localPlayer)
    ) {
      this.hideEggTrajectoryPreview();
      return;
    }

    const eggRadius = defaultSimulationConfig.eggRadius;
    const origin = {
      x: THREE.MathUtils.clamp(
        localPlayer.position.x + localPlayer.facing.x * defaultSimulationConfig.eggDropOffsetForward,
        eggRadius + 0.001,
        this.worldDocument.size.x - eggRadius - 0.001
      ),
      y: THREE.MathUtils.clamp(
        localPlayer.position.y + defaultSimulationConfig.eggDropOffsetUp,
        eggRadius + 0.001,
        this.worldDocument.size.y - eggRadius - 0.001
      ),
      z: THREE.MathUtils.clamp(
        localPlayer.position.z + localPlayer.facing.z * defaultSimulationConfig.eggDropOffsetForward,
        eggRadius + 0.001,
        this.worldDocument.size.z - eggRadius - 0.001
      )
    };
    const velocity = getGroundedEggLaunchVelocity({
      playerVelocity: localPlayer.velocity,
      facing: localPlayer.facing,
      eggCharge: Math.max(MIN_GROUNDED_EGG_CHARGE, this.eggChargeState.chargeAlpha),
      cameraPitch: this.lookPitch,
      config: defaultSimulationConfig
    });

    const previousPoint = new THREE.Vector3(origin.x, origin.y, origin.z);
    let pointCount = 1;
    let landingPoint: THREE.Vector3 | null = null;
    this.setEggTrajectoryPreviewPoint(0, previousPoint);

    for (
      let elapsed = EGG_TRAJECTORY_TIME_STEP;
      elapsed <= EGG_TRAJECTORY_MAX_DURATION && pointCount < EGG_TRAJECTORY_MAX_POINTS;
      elapsed += EGG_TRAJECTORY_TIME_STEP
    ) {
      const nextPoint = getEggTrajectoryPosition({
        origin,
        velocity,
        gravity: defaultSimulationConfig.eggGravity,
        elapsed
      });
      const nextVector = new THREE.Vector3(nextPoint.x, nextPoint.y, nextPoint.z);
      const segment = nextVector.clone().sub(previousPoint);
      const segmentLength = segment.length();

      if (segmentLength > 0) {
        this.eggTrajectoryRaycaster.ray.origin.copy(previousPoint);
        this.eggTrajectoryRaycaster.ray.direction.copy(segment.multiplyScalar(1 / segmentLength));
        this.eggTrajectoryRaycaster.far = segmentLength;
        const hit = this.eggTrajectoryRaycaster.intersectObjects(
          [...this.getVisibleTerrainRaycastRoots(), this.propsGroup, this.clustersGroup],
          true
        )[0];
        if (hit) {
          landingPoint = hit.point.clone();
          this.setEggTrajectoryPreviewPoint(pointCount, landingPoint);
          pointCount += 1;
          break;
        }
      }

      this.setEggTrajectoryPreviewPoint(pointCount, nextVector);
      pointCount += 1;
      previousPoint.copy(nextVector);

      if (nextVector.y <= this.worldDocument.boundary.fallY) {
        landingPoint = nextVector;
        break;
      }
    }

    this.eggTrajectoryPreview.positionAttribute.needsUpdate = true;
    this.eggTrajectoryPreview.geometry.setDrawRange(0, pointCount);
    this.eggTrajectoryPreview.material.opacity = 0.72 + this.eggChargeState.chargeAlpha * 0.24;
    this.eggTrajectoryPreview.group.visible = pointCount > 1;

    if (!landingPoint) {
      this.eggTrajectoryPreview.landingRing.visible = false;
      return;
    }

    this.eggTrajectoryPreview.landingRing.visible = true;
    this.eggTrajectoryPreview.landingRing.position.copy(landingPoint);
    this.eggTrajectoryPreview.landingRing.position.y += 0.04;
    this.eggTrajectoryPreview.landingMaterial.opacity = 0.58 + this.eggChargeState.chargeAlpha * 0.24;
    this.eggTrajectoryPreview.landingRing.scale.setScalar(
      (1.08 + this.eggChargeState.chargeAlpha * 0.9) * (1 + Math.sin(elapsedTime * 10.4) * 0.1)
    );
  }

  private readonly handleResize = () => {
    this.resize();
  };

  private resize() {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width || this.canvas.clientWidth || window.innerWidth));
    const height = Math.max(1, Math.round(rect.height || this.canvas.clientHeight || window.innerHeight));
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.sunShadows.handleCameraProjectionChange();
  }

  private readonly handleKeyDown = (event: KeyboardEvent) => {
    if (isFormElement(event.target)) {
      return;
    }

    if (
      isRuntimeMode(this.mode) &&
      this.pointerLocked &&
      (event.metaKey || event.ctrlKey) &&
      modifierSensitiveRuntimeKeyCodes.has(event.code)
    ) {
      event.preventDefault();
    }

    const typingChallenge =
      isRuntimeMode(this.mode) && this.pointerLocked && !this.runtimePaused
        ? this.getLocalSpaceChallengeState()
        : null;
    const mashChallenge = typingChallenge?.phase === "mash" ? typingChallenge : null;
    const challengeLetterKey = /^[a-z]$/i.test(event.key) ? event.key.toLowerCase() : null;
    const typedCharacter = mashChallenge ? getNormalizedTypedCharacter(event) : null;
    if (mashChallenge && (challengeLetterKey !== null || event.code === "Space")) {
      event.preventDefault();
      if (challengeLetterKey === null || typedCharacter === null) {
        return;
      }

      this.syncLocalSpaceChallengeState();
      if (this.localSpaceChallengeHitCount >= mashChallenge.requiredHits) {
        return;
      }

      if (typedCharacter === mashChallenge.targetKey) {
        this.localSpaceChallengeTargetKey = mashChallenge.targetKey;
        this.localSpaceChallengeHitCount = Math.min(
          mashChallenge.requiredHits,
          this.localSpaceChallengeHitCount + 1
        );
        this.triggerSpacePrimeFeedback();
        this.queueTypedCharacter(typedCharacter);
        if (this.localSpaceChallengeHitCount >= mashChallenge.requiredHits) {
          this.triggerSpaceSuccessFeedback();
        } else {
          this.emitRuntimeOverlayState(true);
        }
      } else {
        this.triggerSpaceMistakeFeedback();
      }
      return;
    }

    if (isEggLaunchKeyCode(event.code)) {
      event.preventDefault();
      if (!isRuntimeMode(this.mode)) {
        return;
      }
      if (event.metaKey || event.ctrlKey) {
        return;
      }
      if (this.activeEggKeyCodes.has(event.code)) {
        return;
      }

      this.activeEggKeyCodes.add(event.code);
      this.keyboardState.egg = true;
      this.eggKeyAction.pressed = true;
      this.eggKeyAction.startedAt = this.clock.elapsedTime;
      this.eggKeyAction.holdTriggered = false;

      if (isRuntimeMode(this.mode) && this.pointerLocked && !this.runtimePaused) {
        const eggStatus = this.getLocalEggStatus();
        if (eggStatus?.reason === "notEnoughMatter") {
          this.triggerNotEnoughMatterFeedback();
        }
      }
      return;
    }

    switch (event.code) {
      case "KeyW":
        this.maybeQueueForwardPush(event);
        this.keyboardState.forward = true;
        break;
      case "ArrowUp":
        this.keyboardState.forward = true;
        break;
      case "KeyS":
      case "ArrowDown":
        this.keyboardState.backward = true;
        break;
      case "KeyA":
      case "ArrowLeft":
        this.keyboardState.left = true;
        break;
      case "KeyD":
      case "ArrowRight":
        this.keyboardState.right = true;
        break;
      case "Space":
        event.preventDefault();
        if (!this.keyboardState.jump) {
          this.keyboardState.jumpPressed = true;
        }
        this.keyboardState.jump = true;
        break;
      case "KeyF":
        event.preventDefault();
        if (!isRuntimeMode(this.mode)) {
          return;
        }
        if (event.metaKey || event.ctrlKey) {
          return;
        }
        if (event.repeat || !this.pointerLocked || this.runtimePaused) {
          return;
        }
        this.keyboardState.placePressed = true;
        this.buildKeyAction.pressed = true;
        this.buildKeyAction.nextPulseAt = this.clock.elapsedTime + HARVEST_REPEAT_INTERVAL;
        break;
    }
  };

  private readonly handleKeyUp = (event: KeyboardEvent) => {
    const typingChallenge =
      isRuntimeMode(this.mode) && this.pointerLocked && !this.runtimePaused
        ? this.getLocalSpaceChallengeState()
        : null;
    if (typingChallenge?.phase === "mash" && event.code === "Space") {
      event.preventDefault();
      return;
    }

    if (isEggLaunchKeyCode(event.code)) {
      event.preventDefault();
      if (!isRuntimeMode(this.mode)) {
        return;
      }
      this.activeEggKeyCodes.delete(event.code);
      this.keyboardState.egg = this.activeEggKeyCodes.size > 0;
      if (this.activeEggKeyCodes.size === 0) {
        this.releaseEggAction(this.eggKeyAction, "key");
      }
      return;
    }

    switch (event.code) {
      case "KeyW":
        this.keyboardState.forward = false;
        this.forwardTapReleased = true;
        break;
      case "ArrowUp":
        this.keyboardState.forward = false;
        break;
      case "KeyS":
      case "ArrowDown":
        this.keyboardState.backward = false;
        break;
      case "KeyA":
      case "ArrowLeft":
        this.keyboardState.left = false;
        break;
      case "KeyF":
        this.resetBuildKeyAction();
        break;
      case "KeyD":
      case "ArrowRight":
        this.keyboardState.right = false;
        break;
      case "Space":
        if (this.keyboardState.jump) {
          this.keyboardState.jumpReleased = true;
        }
        this.keyboardState.jump = false;
        break;
    }
  };

  private readonly handlePointerLockChange = () => {
    const locked = document.pointerLockElement === this.canvas;
    this.pointerLocked = locked;
    this.runtimeHasCapturedPointer = this.runtimeHasCapturedPointer || locked;
    if (isRuntimeMode(this.mode)) {
      if (!locked) {
        this.resetPointerCaptureState();
        this.pendingResumeAfterPointerLock = false;
        this.clearEggInputState();
        this.clearPointerActionState();
        this.cancelEggCharge();
        this.setRuntimePaused(true);
        return;
      }

      this.resetPointerCaptureState();
      if (this.pendingResumeAfterPointerLock) {
        this.pendingResumeAfterPointerLock = false;
        this.setRuntimePaused(false);
        return;
      }

      this.emitPauseState();
    }
  };

  private readonly handlePointerLockError = () => {
    if (!isRuntimeMode(this.mode) || !this.pointerCapturePending) {
      return;
    }

    this.resolvePointerCaptureFailure("error");
  };

  private readonly handleVisibilityChange = () => {
    if (isRuntimeMode(this.mode) && document.hidden) {
      this.clearEggInputState();
      this.clearPointerActionState();
      this.cancelEggCharge();
    }

    if (!isRuntimeMode(this.mode) || !this.pointerCapturePending || !document.hidden) {
      return;
    }

    this.resolvePointerCaptureFailure("focus-lost");
  };

  private readonly handleWindowBlur = () => {
    if (isRuntimeMode(this.mode)) {
      this.clearEggInputState();
      this.clearPointerActionState();
      this.cancelEggCharge();
    }

    if (!isRuntimeMode(this.mode) || !this.pointerCapturePending) {
      return;
    }

    this.resolvePointerCaptureFailure("focus-lost");
  };

  setRuntimePaused(paused: boolean) {
    this.runtimePaused = paused;
    if (paused) {
      this.clearEggInputState();
      this.clearPointerActionState();
      this.cancelEggCharge();
      this.resetRuntimeFeedback();
    }
    this.worker.postMessage({
      type: "set_runtime_paused",
      paused
    } satisfies WorkerRequestMessage);
    if (!paused) {
      this.pendingResumeAfterPointerLock = false;
    }
    this.emitPauseState();
  }

  private emitPauseState() {
    this.callbacks.onPauseStateChange?.({
      paused: this.runtimePaused,
      hasStarted: this.runtimeHasCapturedPointer,
      pointerLocked: this.pointerLocked,
      pointerCapturePending: this.pointerCapturePending,
      pointerCaptureFailureReason: this.pointerCaptureFailureReason
    });
  }

  private readonly handlePointerDown = (event: PointerEvent) => {
    if (this.presentation === "menu") {
      return;
    }

    if (isRuntimeMode(this.mode)) {
      if (!this.pointerLocked) {
        this.requestPointerLock();
        return;
      }

      if (this.runtimePaused) {
        return;
      }

      if (event.button === PRIMARY_POINTER_BUTTON) {
        event.preventDefault();
        this.harvestPointerAction.pressed = true;
        this.harvestPointerAction.nextPulseAt = this.clock.elapsedTime + HARVEST_REPEAT_INTERVAL;
        this.queueHarvestPulse();
      } else if (event.button === SECONDARY_POINTER_BUTTON) {
        event.preventDefault();
        this.startEggPointerAction();
      }
      return;
    }

    if (this.mode === "editor" && event.button === 0) {
      this.performEditorActionFromPointer(event);
    }
  };

  private readonly handlePointerMove = (event: PointerEvent) => {
    if (!this.pointerLocked || !isRuntimeMode(this.mode)) {
      return;
    }

    this.pendingLookDeltaX += event.movementX;
    this.pendingLookDeltaY += event.movementY;
  };

  private readonly handlePointerUp = (event: PointerEvent) => {
    if (!isRuntimeMode(this.mode) || this.presentation === "menu") {
      return;
    }

    if (event.button === PRIMARY_POINTER_BUTTON) {
      this.resetHarvestPointerAction();
      return;
    }

    if (event.button === SECONDARY_POINTER_BUTTON) {
      event.preventDefault();
      this.releaseEggAction(this.eggPointerAction, "pointer");
    }
  };

  private readonly handlePointerCancel = () => {
    if (!isRuntimeMode(this.mode)) {
      return;
    }

    this.resetHarvestPointerAction();
    this.resetHoldAction(this.eggPointerAction);
  };

  private readonly handleContextMenu = (event: MouseEvent) => {
    event.preventDefault();
  };

  private syncRuntimeWorldFromTerrainDeltaBatch(batch = this.latestFrame?.authoritative?.terrainDeltaBatch ?? null) {
    if (!batch) {
      return;
    }

    for (const change of batch.changes) {
      if (change.operation === "remove" || change.kind === null) {
        this.runtimeWorld.removeVoxel(change.voxel.x, change.voxel.y, change.voxel.z);
      } else {
        this.runtimeWorld.setVoxel(change.voxel.x, change.voxel.y, change.voxel.z, change.kind);
      }
    }
  }

  private getVisibleTerrainRaycastRoots() {
    return this.terrainGroup.visible ? [this.terrainGroup] : [];
  }

  private getTerrainTargetAtPointer(offsetX = 0, offsetY = 0) {
    this.focusRaycaster.setFromCamera(new THREE.Vector2(offsetX, offsetY), this.camera);
    const intersections = this.focusRaycaster.intersectObjects(this.getVisibleTerrainRaycastRoots(), true);
    const firstHit = intersections[0];
    if (!firstHit) {
      return null;
    }

    const worldNormal = getWorldNormalFromIntersection(firstHit);
    const terrainHit = resolveTerrainRaycastHit(firstHit.point, worldNormal);
    if (!terrainHit) {
      return null;
    }

    return {
      voxel: terrainHit.voxel,
      normal: terrainHit.normal
    } satisfies RuntimeFocusedTarget;
  }

  private isHarvestableTarget(target: RuntimeFocusedTarget) {
    const kind = this.runtimeWorld.getVoxelKind(target.voxel.x, target.voxel.y, target.voxel.z);
    return kind === "ground" || kind === "boundary";
  }

  private isHarvestTargetInRange(player: RuntimePlayerState, target: RuntimeFocusedTarget) {
    const chest = {
      x: player.position.x,
      y: player.position.y + defaultSimulationConfig.playerHeight * 0.7,
      z: player.position.z
    };
    const targetCenter = {
      x: target.voxel.x + 0.5,
      y: target.voxel.y + 0.5,
      z: target.voxel.z + 0.5
    };

    return (
      Math.hypot(
        targetCenter.x - chest.x,
        targetCenter.y - chest.y,
        targetCenter.z - chest.z
      ) <= defaultSimulationConfig.interactRange
    );
  }

  private isValidHarvestTarget(player: RuntimePlayerState, target: RuntimeFocusedTarget) {
    return this.isHarvestableTarget(target) && this.isHarvestTargetInRange(player, target);
  }

  private resolveHarvestTarget(localPlayer = this.getLocalRuntimePlayer()) {
    const centerTarget = this.getTerrainTargetAtPointer();
    if (!localPlayer) {
      return centerTarget;
    }

    let bestTarget: RuntimeFocusedTarget | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    const seenTargets = new Set<string>();

    for (const [offsetX, offsetY] of HARVEST_SNAP_SAMPLE_OFFSETS) {
      const target = this.getTerrainTargetAtPointer(offsetX, offsetY);
      if (!target) {
        continue;
      }

      const targetKey = [
        target.voxel.x,
        target.voxel.y,
        target.voxel.z,
        target.normal.x,
        target.normal.y,
        target.normal.z
      ].join(":");
      if (seenTargets.has(targetKey)) {
        continue;
      }
      seenTargets.add(targetKey);

      if (!this.isValidHarvestTarget(localPlayer, target)) {
        continue;
      }

      const targetCenter = {
        x: target.voxel.x + 0.5,
        y: target.voxel.y + 0.5,
        z: target.voxel.z + 0.5
      };
      const score =
        Math.hypot(offsetX, offsetY) * 100 +
        Math.hypot(
          targetCenter.x - localPlayer.position.x,
          targetCenter.y - localPlayer.position.y,
          targetCenter.z - localPlayer.position.z
        ) * 0.1;
      if (score >= bestScore) {
        continue;
      }

      bestScore = score;
      bestTarget = target;
    }

    return bestTarget ?? centerTarget;
  }

  private setHarvestFocusOverride(target: RuntimeFocusedTarget) {
    const localPlayer = this.getLocalRuntimePlayer();
    if (!localPlayer) {
      return;
    }

    const destroyValid = this.isValidHarvestTarget(localPlayer, target);
    this.harvestFocusOverride = {
      focusState: {
        focusedVoxel: target.voxel,
        targetNormal: target.normal,
        placeVoxel: {
          x: target.voxel.x + target.normal.x,
          y: target.voxel.y + target.normal.y,
          z: target.voxel.z + target.normal.z
        },
        destroyValid,
        placeValid: false,
        invalidReason: destroyValid
          ? null
          : this.isHarvestableTarget(target)
            ? "outOfRange"
            : "hazard"
      },
      expiresAt: this.clock.elapsedTime + HARVEST_FOCUS_OVERRIDE_DURATION
    };
    this.updateFocusedTargetVisuals();
  }

  private getHarvestFocusOverride() {
    if (!this.harvestFocusOverride) {
      return null;
    }

    if (this.clock.elapsedTime > this.harvestFocusOverride.expiresAt) {
      this.harvestFocusOverride = null;
      return null;
    }

    return this.harvestFocusOverride.focusState;
  }

  private queueHarvestPulse(localPlayer = this.getLocalRuntimePlayer()) {
    if (!this.pointerLocked || this.runtimePaused) {
      return;
    }

    const target = this.resolveHarvestTarget(localPlayer);
    this.queuedDestroyTarget = target;
    this.destroyQueued = target !== null;
    if (target) {
      this.setHarvestFocusOverride(target);
    }
  }

  private queueBuildPulse() {
    if (!this.pointerLocked || this.runtimePaused) {
      return;
    }

    this.keyboardState.placePressed = true;
  }

  private updateHeldHarvest(localPlayer: RuntimePlayerState | null, elapsedTime: number) {
    if (
      !localPlayer ||
      !this.harvestPointerAction.pressed ||
      !this.pointerLocked ||
      this.runtimePaused ||
      elapsedTime < this.harvestPointerAction.nextPulseAt
    ) {
      return;
    }

    this.queueHarvestPulse(localPlayer);
    this.harvestPointerAction.nextPulseAt = elapsedTime + HARVEST_REPEAT_INTERVAL;
  }

  private updateHeldBuild(localPlayer: RuntimePlayerState | null, elapsedTime: number) {
    if (
      !localPlayer ||
      !this.buildKeyAction.pressed ||
      !this.pointerLocked ||
      this.runtimePaused ||
      elapsedTime < this.buildKeyAction.nextPulseAt
    ) {
      return;
    }

    this.queueBuildPulse();
    this.buildKeyAction.nextPulseAt = elapsedTime + HARVEST_REPEAT_INTERVAL;
  }

  private performEditorActionFromPointer(event: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    this.clickRaycaster.setFromCamera(pointer, this.camera);
    const intersections = this.clickRaycaster.intersectObjects(
      [...this.getVisibleTerrainRaycastRoots(), this.propsGroup],
      true
    );
    const firstHit = intersections[0];
    if (!firstHit) {
      return;
    }

    const worldNormal = getWorldNormalFromIntersection(firstHit);
    const terrainHit = resolveTerrainRaycastHit(firstHit.point, worldNormal);
    if (!terrainHit) {
      return;
    }

    this.worker.postMessage({
      type: "perform_editor_action",
      voxel: terrainHit.voxel,
      normal: terrainHit.normal
    } satisfies WorkerRequestMessage);
  }

  private readonly animate = () => {
    const delta = Math.min(this.clock.getDelta(), 0.1);
    const elapsedTime = this.clock.elapsedTime;
    updateVoxelMaterialAnimation(elapsedTime);
    runtimeOceanTexture.offset.x = (elapsedTime * 0.045) % 1;
    runtimeOceanTexture.offset.y = (elapsedTime * 0.02) % 1;

    if (isRuntimeMode(this.mode)) {
      this.updateRuntimeCamera(delta);
      this.updateFocusedTarget();
      const localPlayer = this.getLocalRuntimePlayer();
      this.updateHoldToThrowState(localPlayer, elapsedTime);
      this.updateEggChargeState(localPlayer, delta, elapsedTime);
      this.updateHeldHarvest(localPlayer, elapsedTime);
      this.updateHeldBuild(localPlayer, elapsedTime);
      this.sendRuntimeInput(localPlayer, elapsedTime);
      this.applyRuntimeFrame(delta, elapsedTime);
    } else {
      this.updateSpeedTraces(null, delta, elapsedTime);
      this.updateSkyEnvironment(null, delta, elapsedTime);
      this.hideEggTrajectoryPreview();
      this.updateLocalResourceBubble(null, elapsedTime);
      this.emitRuntimeOverlayState(false, elapsedTime);
      this.clearCoveredPlayerVisibility();
      this.focusOutline.visible = false;
      this.focusGhost.visible = false;
      this.clearFeatherBursts();
    }

    if (this.shouldUseSunShadows()) {
      this.sunShadows.update();
    }
    this.renderer.render(this.scene, this.camera);
    if (this.pendingReadyToDisplay) {
      this.pendingReadyToDisplay = false;
      this.callbacks.onReadyToDisplay?.();
    }
    this.animationFrameId = requestAnimationFrame(this.animate);
  };

  private updateRuntimeCamera(delta: number) {
    const frame = this.latestFrame;
    if (!frame) {
      this.clearCoveredPlayerVisibility();
      return;
    }

    const player = frame.localPlayerId
      ? frame.players.find((entry) => entry.id === frame.localPlayerId) ?? null
      : null;
    if (!player || (!player.fallingOut && (!player.alive || player.respawning))) {
      this.clearCoveredPlayerVisibility();
      if (this.mode === "multiplayer") {
        this.updateSpectatorCamera(delta, frame.players);
      }
      return;
    }

    this.hasInitializedSpectatorCamera = false;
    if (this.lookYaw === null) {
      this.lookYaw = getYawFromPlanarVector(player.facing);
      this.lookPitch = aimCameraConfig.defaultPitch;
      this.speedBlend = 0;
      this.hasInitializedRuntimeCamera = false;
    }

    const spaceCameraActive = player.spacePhase !== "none";
    if (spaceCameraActive !== this.runtimeCameraUsingSpaceRig) {
      this.hasInitializedRuntimeCamera = false;
      this.speedBlend = 0;
      this.lookPitch = spaceCameraActive
        ? spaceCameraConfig.defaultPitch
        : clampLookPitch(this.lookPitch);
      this.runtimeCameraUsingSpaceRig = spaceCameraActive;
    } else if (spaceCameraActive) {
      this.lookPitch = clampSpaceLookPitch(this.lookPitch);
    } else {
      this.lookPitch = clampLookPitch(this.lookPitch);
    }

    if (this.pendingLookDeltaX !== 0 || this.pendingLookDeltaY !== 0) {
      const nextLook = applyFreeLookDelta(
        {
          yaw: this.lookYaw ?? 0,
          pitch: this.lookPitch
        },
        {
          deltaX: this.pendingLookDeltaX,
          deltaY: this.pendingLookDeltaY
        },
        this.runtimeControlSettings,
        spaceCameraActive ? spaceCameraConfig : aimCameraConfig
      );
      this.lookYaw = nextLook.yaw;
      this.lookPitch = nextLook.pitch;
      this.pendingLookDeltaX = 0;
      this.pendingLookDeltaY = 0;
    }

    const lookYaw = this.lookYaw ?? getYawFromPlanarVector(player.facing);
    if (spaceCameraActive) {
      this.speedBlend = 0;
    } else {
      const initialAimState = getAimRigState(player.position, lookYaw, this.lookPitch, this.speedBlend);
      const forwardSpeedRatio = getForwardSpeedRatio(player.velocity, initialAimState.planarForward, 6);
      const targetSpeedBlend = getSpeedCameraBlend(forwardSpeedRatio);
      this.speedBlend = dampScalar(this.speedBlend, targetSpeedBlend, 7, delta);
    }

    const aimState = spaceCameraActive
      ? getSpaceAimRigState(player.position, lookYaw, this.lookPitch)
      : getAimRigState(player.position, lookYaw, this.lookPitch, this.speedBlend);
    this.desiredLookTarget.set(aimState.aimTarget.x, aimState.aimTarget.y, aimState.aimTarget.z);
    this.desiredCameraPosition.set(aimState.cameraPosition.x, aimState.cameraPosition.y, aimState.cameraPosition.z);
    const coveredPlayerVisibility = spaceCameraActive
      ? {
          cameraPosition: this.desiredCameraPosition.clone(),
          occluded: false,
          contourVisible: false
        }
      : this.resolveCoveredPlayerVisibility(player, this.desiredCameraPosition);
    if (spaceCameraActive) {
      this.clearCoveredPlayerVisibility();
    } else {
      this.desiredCameraPosition.copy(coveredPlayerVisibility.cameraPosition);
      this.coveredPlayerContourVisible = coveredPlayerVisibility.contourVisible;
      this.coveredPlayerSilhouetteGroup.visible = coveredPlayerVisibility.contourVisible;
    }

    if (!this.hasInitializedRuntimeCamera) {
      this.hasInitializedRuntimeCamera = true;
      this.currentLookTarget.copy(this.desiredLookTarget);
      this.camera.position.copy(this.desiredCameraPosition);
      this.camera.lookAt(this.currentLookTarget);
      this.cameraForward = getPlanarForwardBetweenPoints(this.camera.position, this.currentLookTarget);
      return;
    }

    const currentDistanceToAimPivot = getVectorDistance(this.camera.position, aimState.aimPivot);
    const desiredDistanceToAimPivot = getVectorDistance(this.desiredCameraPosition, aimState.aimPivot);
    const releasingOcclusion =
      !coveredPlayerVisibility.occluded &&
      currentDistanceToAimPivot + COVERED_PLAYER_RELEASE_EPSILON < desiredDistanceToAimPivot;
    const positionDampingRate = coveredPlayerVisibility.occluded
      ? COVERED_PLAYER_PUSH_IN_DAMPING
      : releasingOcclusion
        ? COVERED_PLAYER_RELEASE_DAMPING
        : chaseCameraConfig.positionDamping + 3;
    const positionDamping = 1 - Math.exp(-delta * positionDampingRate);
    const lookTargetDamping = 1 - Math.exp(-delta * (chaseCameraConfig.lookTargetDamping + 3));
    const rising =
      !coveredPlayerVisibility.occluded &&
      !releasingOcclusion &&
      player.velocity.y > 0 &&
      this.desiredCameraPosition.y > this.camera.position.y;
    const verticalPositionDamping = rising ? 1 - Math.exp(-delta * 24) : positionDamping;
    const verticalLookTargetDamping = rising ? 1 - Math.exp(-delta * 26) : lookTargetDamping;
    this.camera.position.x = THREE.MathUtils.lerp(this.camera.position.x, this.desiredCameraPosition.x, positionDamping);
    this.camera.position.y = THREE.MathUtils.lerp(this.camera.position.y, this.desiredCameraPosition.y, verticalPositionDamping);
    this.camera.position.z = THREE.MathUtils.lerp(this.camera.position.z, this.desiredCameraPosition.z, positionDamping);
    this.currentLookTarget.x = THREE.MathUtils.lerp(this.currentLookTarget.x, this.desiredLookTarget.x, lookTargetDamping);
    this.currentLookTarget.y = THREE.MathUtils.lerp(this.currentLookTarget.y, this.desiredLookTarget.y, verticalLookTargetDamping);
    this.currentLookTarget.z = THREE.MathUtils.lerp(this.currentLookTarget.z, this.desiredLookTarget.z, lookTargetDamping);
    const impactJoltAlpha = THREE.MathUtils.clamp(
      (this.superBoomImpactJoltUntil - this.clock.elapsedTime) / SUPER_BOOM_IMPACT_JOLT_DURATION,
      0,
      1
    );
    if (impactJoltAlpha > 0) {
      const slam = Math.sin(impactJoltAlpha * Math.PI) * 0.28;
      this.camera.position.x -= aimState.planarForward.x * slam + Math.sin(this.clock.elapsedTime * 84 + 0.3) * 0.05 * impactJoltAlpha;
      this.camera.position.y -= slam * 0.12 - Math.sin(this.clock.elapsedTime * 90 + 0.9) * 0.04 * impactJoltAlpha;
      this.camera.position.z -= aimState.planarForward.z * slam + Math.cos(this.clock.elapsedTime * 78 + 0.5) * 0.05 * impactJoltAlpha;
      this.currentLookTarget.y -= 0.12 * impactJoltAlpha;
    }
    this.camera.lookAt(this.currentLookTarget);
    this.cameraForward = getPlanarForwardBetweenPoints(this.camera.position, this.currentLookTarget);
  }

  private clearCoveredPlayerVisibility() {
    this.coveredPlayerContourVisible = false;
    this.terrainGroup.visible = true;
    this.coveredPlayerSilhouetteGroup.visible = false;
  }

  private raycastTerrainOccluder(origin: THREE.Vector3, target: THREE.Vector3) {
    this.terrainOcclusionRayDirection.copy(target).sub(origin);
    const maxDistance = this.terrainOcclusionRayDirection.length();
    if (maxDistance <= Number.EPSILON) {
      return null;
    }

    this.terrainOcclusionRayDirection.divideScalar(maxDistance);
    let travelled = 0;
    this.terrainOcclusionRayOrigin.copy(origin);

    while (travelled <= maxDistance) {
      const remainingDistance = maxDistance - travelled;
      if (remainingDistance <= Number.EPSILON) {
        return null;
      }

      const hit = raycastVoxelWorld(
        this.runtimeWorld,
        this.terrainOcclusionRayOrigin,
        this.terrainOcclusionRayDirection,
        remainingDistance
      );
      if (!hit) {
        return null;
      }

      const hitDistance = hit.distance ?? 0;
      const totalDistance = travelled + hitDistance;
      if (this.runtimeWorld.getVoxelKind(hit.voxel.x, hit.voxel.y, hit.voxel.z)) {
        return {
          anchor: origin,
          direction: this.terrainOcclusionRayDirection.clone(),
          distance: totalDistance,
          hit
        } satisfies TerrainOcclusionHit;
      }

      travelled += Math.max(hitDistance + TERRAIN_OCCLUSION_RAYCAST_STEP_EPSILON, TERRAIN_OCCLUSION_RAYCAST_STEP_EPSILON);
      this.terrainOcclusionRayOrigin.copy(origin).addScaledVector(this.terrainOcclusionRayDirection, travelled);
    }

    return null;
  }

  private populateCoveredPlayerAnchors(player: RuntimePlayerState) {
    this.terrainOcclusionHipsAnchor.set(
      player.position.x,
      player.position.y + defaultSimulationConfig.playerHeight * TERRAIN_OCCLUSION_HIP_HEIGHT_RATIO,
      player.position.z
    );
    this.terrainOcclusionChestAnchor.set(
      player.position.x,
      player.position.y + defaultSimulationConfig.playerHeight * TERRAIN_OCCLUSION_CHEST_HEIGHT_RATIO,
      player.position.z
    );
    this.terrainOcclusionHeadAnchor.set(
      player.position.x,
      player.position.y + defaultSimulationConfig.playerHeight * TERRAIN_OCCLUSION_HEAD_HEIGHT_RATIO,
      player.position.z
    );
  }

  private collectCoveredPlayerHits(
    player: RuntimePlayerState,
    targetCameraPosition: THREE.Vector3,
    {
      includeHips = true
    }: {
      includeHips?: boolean;
    } = {}
  ) {
    this.populateCoveredPlayerAnchors(player);
    const anchors = includeHips
      ? [this.terrainOcclusionHipsAnchor, this.terrainOcclusionChestAnchor, this.terrainOcclusionHeadAnchor]
      : [this.terrainOcclusionChestAnchor, this.terrainOcclusionHeadAnchor];

    return anchors
      .map((anchor) => this.raycastTerrainOccluder(anchor, targetCameraPosition))
      .filter((hit): hit is TerrainOcclusionHit => hit !== null);
  }

  private clampCoveredPlayerCamera(
    desiredCameraPosition: THREE.Vector3,
    hits: readonly TerrainOcclusionHit[],
    maxPushIn: number
  ) {
    if (hits.length === 0) {
      this.coveredPlayerResolvedCameraPosition.copy(desiredCameraPosition);
      return {
        cameraPosition: this.coveredPlayerResolvedCameraPosition,
        occluded: false
      };
    }

    const nearestHit = hits.reduce((nearest, candidate) =>
      candidate.distance < nearest.distance ? candidate : nearest
    );
    const desiredDistance = desiredCameraPosition.distanceTo(nearestHit.anchor);
    const stopDistance = Math.max(0, nearestHit.distance - COVERED_PLAYER_CAMERA_BUFFER);
    const minimumDistance = Math.max(0, desiredDistance - maxPushIn);
    const resolvedDistance = Math.max(minimumDistance, Math.min(desiredDistance, stopDistance));

    this.coveredPlayerResolvedCameraPosition
      .copy(nearestHit.anchor)
      .addScaledVector(nearestHit.direction, resolvedDistance);

    return {
      cameraPosition: this.coveredPlayerResolvedCameraPosition,
      occluded: resolvedDistance + 1e-4 < desiredDistance
    };
  }

  private resolveCoveredPlayerVisibility(
    player: RuntimePlayerState,
    desiredCameraPosition: THREE.Vector3
  ): CoveredPlayerVisibilityResolution {
    if (this.presentation === "menu" || !isRuntimeMode(this.mode)) {
      this.clearCoveredPlayerVisibility();
      this.coveredPlayerResolvedCameraPosition.copy(desiredCameraPosition);
      return {
        cameraPosition: this.coveredPlayerResolvedCameraPosition,
        occluded: false,
        contourVisible: false
      };
    }

    const terrainBlockerHits = this.collectCoveredPlayerHits(player, desiredCameraPosition);
    if (terrainBlockerHits.length > 0) {
      const cameraResolution = this.clampCoveredPlayerCamera(
        desiredCameraPosition,
        terrainBlockerHits,
        COVERED_PLAYER_MAX_CAMERA_PUSH_IN
      );
      const contourVisible =
        this.collectCoveredPlayerHits(player, cameraResolution.cameraPosition, { includeHips: false }).length > 0;

      return {
        cameraPosition: cameraResolution.cameraPosition,
        occluded: cameraResolution.occluded,
        contourVisible
      };
    }

    this.coveredPlayerResolvedCameraPosition.copy(desiredCameraPosition);
    return {
      cameraPosition: this.coveredPlayerResolvedCameraPosition,
      occluded: false,
      contourVisible: false
    };
  }

  private updateSpectatorCamera(delta: number, players: RuntimePlayerState[]) {
    const referencePlayer =
      players.find((player) => player.alive && !player.respawning) ?? players[0] ?? null;

    if (this.lookYaw === null) {
      this.lookYaw = referencePlayer
        ? getYawFromPlanarVector(referencePlayer.facing)
        : 0;
      this.lookPitch = aimCameraConfig.defaultPitch;
    }

    if (this.pendingLookDeltaX !== 0 || this.pendingLookDeltaY !== 0) {
      const nextLook = applyFreeLookDelta(
        {
          yaw: this.lookYaw ?? 0,
          pitch: this.lookPitch
        },
        {
          deltaX: this.pendingLookDeltaX,
          deltaY: this.pendingLookDeltaY
        },
        this.runtimeControlSettings
      );
      this.lookYaw = nextLook.yaw;
      this.lookPitch = nextLook.pitch;
      this.pendingLookDeltaX = 0;
      this.pendingLookDeltaY = 0;
    }

    if (!this.hasInitializedSpectatorCamera) {
      const anchor = referencePlayer?.position ?? {
        x: this.worldDocument.size.x / 2,
        y: this.worldDocument.size.y * 0.65,
        z: this.worldDocument.size.z / 2
      };
      const backward = getPlanarVectorFromYaw((this.lookYaw ?? 0) + Math.PI);
      this.camera.position.set(
        anchor.x + backward.x * 12,
        Math.max(anchor.y + 8, 10),
        anchor.z + backward.z * 12
      );
      this.hasInitializedSpectatorCamera = true;
    }

    const lookDirection = getLookDirection(this.lookYaw ?? 0, this.lookPitch);
    const planarForward = getPlanarVectorFromYaw(this.lookYaw ?? 0);
    const right = new THREE.Vector3(planarForward.z, 0, -planarForward.x).normalize();
    const move = new THREE.Vector3();
    const forwardInput = (this.keyboardState.forward ? 1 : 0) - (this.keyboardState.backward ? 1 : 0);
    const horizontalInput = (this.keyboardState.right ? 1 : 0) - (this.keyboardState.left ? 1 : 0);

    if (forwardInput !== 0) {
      move.x += lookDirection.x * forwardInput;
      move.y += lookDirection.y * forwardInput;
      move.z += lookDirection.z * forwardInput;
    }

    if (horizontalInput !== 0) {
      move.addScaledVector(right, horizontalInput);
    }

    if (this.keyboardState.jump) {
      move.y += 1;
    }

    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(MULTIPLAYER_SPECTATOR_CAMERA_SPEED * delta);
      this.camera.position.add(move);
      this.camera.position.x = THREE.MathUtils.clamp(
        this.camera.position.x,
        -24,
        this.worldDocument.size.x + 24
      );
      this.camera.position.y = THREE.MathUtils.clamp(
        this.camera.position.y,
        4,
        this.worldDocument.size.y + 48
      );
      this.camera.position.z = THREE.MathUtils.clamp(
        this.camera.position.z,
        -24,
        this.worldDocument.size.z + 24
      );
    }

    this.currentLookTarget.set(
      this.camera.position.x + lookDirection.x * 24,
      this.camera.position.y + lookDirection.y * 24,
      this.camera.position.z + lookDirection.z * 24
    );
    this.camera.lookAt(this.currentLookTarget);
    this.cameraForward = {
      x: lookDirection.x,
      z: lookDirection.z
    };
  }

  private updateFocusedTarget() {
    this.focusedTarget = this.getTerrainTargetAtPointer();
    this.updateFocusedTargetVisuals();
  }

  private getAuthoritativeFocusedTargetState(frame: RuntimeRenderFrame | null = this.latestFrame) {
    if (!this.focusedTarget || !frame?.focusState) {
      return null;
    }

    const { focusState } = frame;
    return this.focusedTarget.voxel.x === focusState.focusedVoxel.x &&
      this.focusedTarget.voxel.y === focusState.focusedVoxel.y &&
      this.focusedTarget.voxel.z === focusState.focusedVoxel.z &&
      this.focusedTarget.normal.x === focusState.targetNormal.x &&
      this.focusedTarget.normal.y === focusState.targetNormal.y &&
      this.focusedTarget.normal.z === focusState.targetNormal.z
      ? focusState
      : null;
  }

  private updateFocusedTargetVisuals() {
    const showRuntimeFocus = this.pointerLocked && isRuntimeMode(this.mode);
    const focusState = this.getHarvestFocusOverride() ?? this.getAuthoritativeFocusedTargetState();
    const actionable = focusState !== null && (focusState.destroyValid || focusState.placeValid);

    this.focusOutline.visible = showRuntimeFocus && actionable;
    this.focusGhost.visible = showRuntimeFocus && focusState?.placeValid === true;

    if (!showRuntimeFocus || !focusState || !actionable) {
      return;
    }

    this.focusOutline.position.set(
      focusState.focusedVoxel.x + 0.5,
      focusState.focusedVoxel.y + 0.5,
      focusState.focusedVoxel.z + 0.5
    );
    this.focusGhost.position.set(
      focusState.placeVoxel.x + 0.5,
      focusState.placeVoxel.y + 0.5,
      focusState.placeVoxel.z + 0.5
    );
  }

  private resolvePlayerShadowSurfaceY(position: { x: number; y: number; z: number }) {
    this.playerShadowRaycaster.ray.origin.set(position.x, position.y + 0.5, position.z);
    this.playerShadowRaycaster.ray.direction.copy(shadowRayDirection);
    this.playerShadowRaycaster.far = Math.max(this.worldDocument.size.y + 32, position.y + 32);

    const intersections = this.playerShadowRaycaster.intersectObjects(
      [...this.getVisibleTerrainRaycastRoots(), this.propsGroup, this.clustersGroup],
      true
    );
    const firstHit = intersections.find((intersection) => intersection.point.y <= position.y + 0.5);
    if (firstHit) {
      return firstHit.point.y + 0.02;
    }

    return Math.floor(position.y);
  }

  private updateSpeedTraces(localPlayer: RuntimePlayerState | null, delta: number, elapsedTime: number) {
    if (!localPlayer) {
      this.speedTraceGroup.visible = false;
      this.localPushTraceBurstRemaining = Math.max(0, this.localPushTraceBurstRemaining - delta);
      this.previousLocalPushVisualRemaining = 0;
      return;
    }

    if (localPlayer.pushVisualRemaining > 0 && this.previousLocalPushVisualRemaining <= 0) {
      this.localPushTraceBurstRemaining = SPEED_TRACE_PUSH_BURST_DURATION;
    } else {
      this.localPushTraceBurstRemaining = Math.max(0, this.localPushTraceBurstRemaining - delta);
    }
    this.previousLocalPushVisualRemaining = localPlayer.pushVisualRemaining;

    const airSpeed = Math.hypot(localPlayer.velocity.x, localPlayer.velocity.z);
    const flightIntensity =
      !localPlayer.grounded && (localPlayer.jetpackActive || airSpeed > SPEED_TRACE_MIN_AIR_SPEED)
        ? Math.min(
            1,
            Math.max(
              localPlayer.jetpackActive ? 0.42 : 0,
              (airSpeed - SPEED_TRACE_MIN_AIR_SPEED) / 4.2
            )
          )
        : 0;
    const pushBurstIntensity = Math.min(1, this.localPushTraceBurstRemaining / SPEED_TRACE_PUSH_BURST_DURATION);
    const intensity = Math.max(flightIntensity, pushBurstIntensity);
    this.speedTraceGroup.visible = intensity > 0.03;
    const depth = Math.abs(this.speedTraceGroup.position.z) || SPEED_TRACE_DEPTH;
    const halfHeight = Math.tan(THREE.MathUtils.degToRad(this.camera.fov * 0.5)) * depth;
    const halfWidth = halfHeight * this.camera.aspect;

    this.speedTraceGroup.children.forEach((child, index) => {
      const streak = child as THREE.Mesh;
      const material = this.speedTraceMaterials[index];
      const layout = speedTraceLayouts[index];
      if (!material) {
        return;
      }
      if (!layout) {
        return;
      }

      const angle = THREE.MathUtils.degToRad(layout.angleDeg);
      const baseX = Math.cos(angle) * halfWidth * layout.screenRadius;
      const baseY = Math.sin(angle) * halfHeight * layout.screenRadius;
      const directionLength = Math.hypot(baseX, baseY) || 1;
      const directionX = baseX / directionLength;
      const directionY = baseY / directionLength;
      const slide = (elapsedTime * (0.9 + intensity * 2.4) * layout.speed + layout.phase) % 1;
      const travelDistance = halfHeight * layout.travel * (0.32 + intensity * 0.9);
      const flicker = 0.72 + Math.sin(elapsedTime * 18 + index * 0.7) * 0.18;
      const burstStretch = 1 + pushBurstIntensity * 0.55;
      streak.position.set(baseX + directionX * slide * travelDistance, baseY + directionY * slide * travelDistance, 0);
      streak.rotation.z = Math.atan2(-directionX, directionY);
      streak.scale.x = (0.11 + intensity * 0.08) * layout.width;
      streak.scale.y = layout.scaleY * (0.72 + intensity * 0.95) * burstStretch;
      material.opacity = this.speedTraceGroup.visible ? Math.min(0.72, intensity * flicker * layout.opacity) : 0;
    });
  }

  private sendRuntimeInput(
    localPlayer: RuntimePlayerState | null = this.getLocalRuntimePlayer(),
    elapsedTime = this.clock.elapsedTime
  ) {
    if (!isRuntimeMode(this.mode) || !this.pointerLocked) {
      return;
    }

    this.warnIfMissingLocalRuntimePlayer(localPlayer);
    const spaceChallenge = this.getLocalSpaceChallengeState();
    const nextCommand = buildPlayerCommand(this.keyboardState, this.cameraForward);
    const commandTarget =
      this.destroyQueued && this.queuedDestroyTarget
        ? this.queuedDestroyTarget
        : this.focusedTarget;

    nextCommand.destroy = this.destroyQueued && this.queuedDestroyTarget !== null;
    nextCommand.place = nextCommand.place && this.focusedTarget !== null;
    nextCommand.layEgg = this.eggChargeState.pendingThrow || this.quickEggQueued;
    nextCommand.eggCharge = this.eggChargeState.pendingThrow ? this.eggChargeState.pendingThrowCharge : 0;
    nextCommand.eggPitch = this.eggChargeState.pendingThrow
      ? this.eggChargeState.pendingThrowPitch
      : this.quickEggQueued
        ? this.quickEggPitch
        : 0;
    nextCommand.targetVoxel = commandTarget?.voxel ?? null;
    nextCommand.targetNormal = commandTarget?.normal ?? null;
    nextCommand.typedText = this.pendingTypedText;

    if (spaceChallenge?.phase === "mash") {
      nextCommand.jump = false;
      nextCommand.jumpPressed = false;
      nextCommand.jumpReleased = false;
    }

    const command = {
      seq: this.inputSequence,
      ...nextCommand
    } satisfies RuntimeInputCommand;
    const hasImmediateAction =
      command.jumpPressed ||
      command.jumpReleased ||
      command.destroy ||
      command.place ||
      command.push ||
      command.layEgg ||
      command.typedText.length > 0;
    const sendDue =
      elapsedTime - this.lastRuntimeInputSentAt >= RUNTIME_INPUT_SEND_INTERVAL;
    const inputChanged = !runtimeInputCommandsEqual(this.lastSentRuntimeInput, command);

    if (!inputChanged && !hasImmediateAction) {
      return;
    }

    if (!hasImmediateAction && !sendDue) {
      return;
    }

    this.destroyQueued = false;
    this.queuedDestroyTarget = null;
    this.quickEggQueued = false;
    this.quickEggPitch = 0;
    this.pendingTypedText = "";
    this.eggChargeState.pendingThrow = false;
    this.eggChargeState.pendingThrowCharge = 0;
    this.eggChargeState.pendingThrowPitch = 0;

    const buffer = packRuntimeInputCommand(command);
    this.inputSequence += 1;
    this.lastRuntimeInputSentAt = elapsedTime;
    this.lastSentRuntimeInput = command;
    this.worker.postMessage(
      {
        type: "set_runtime_input",
        buffer
      } satisfies WorkerRequestMessage,
      [buffer]
    );

    this.keyboardState.jumpPressed = false;
    this.keyboardState.jumpReleased = false;
    this.keyboardState.placePressed = false;
    this.keyboardState.pushPressed = false;
  }

  private applyRuntimeFrame(delta: number, elapsedTime: number) {
    const frame = this.latestFrame;
    if (!frame) {
      this.syncLocalSpaceChallengeState();
      this.previousLocalSpacePhase = null;
      this.updateSpeedTraces(null, delta, elapsedTime);
      this.updateSkyEnvironment(null, delta, elapsedTime);
      this.updateEggLaunchPreview(null, elapsedTime);
      this.updateLocalResourceBubble(null, elapsedTime);
      this.emitRuntimeOverlayState(false, elapsedTime);
      this.syncFeatherBursts(elapsedTime);
      return;
    }

    const localPlayer = frame.localPlayerId
      ? frame.players.find((player) => player.id === frame.localPlayerId) ?? null
      : null;
    const hadLocalSpaceChallenge = this.localSpaceChallengeTargetKey !== null;
    this.syncLocalSpaceChallengeState();
    if (
      localPlayer?.spacePhase === "reentry" &&
      this.previousLocalSpacePhase === "float" &&
      hadLocalSpaceChallenge
    ) {
      this.triggerSpaceFailFeedback(elapsedTime);
    }
    if (localPlayer?.spacePhase === "superBoomImpact" && this.previousLocalSpacePhase !== "superBoomImpact") {
      this.triggerSuperBoomImpactJolt(elapsedTime);
    }
    this.previousLocalSpacePhase = localPlayer?.spacePhase ?? null;
    this.syncPlayers(frame.players, frame.localPlayerId, delta, elapsedTime);
    this.updateSpeedTraces(localPlayer, delta, elapsedTime);
    this.updateSkyEnvironment(localPlayer, delta, elapsedTime);
    this.updateEggLaunchPreview(localPlayer, elapsedTime);
    this.updateLocalResourceBubble(localPlayer, elapsedTime);
    this.emitRuntimeOverlayState(false, elapsedTime);
    this.syncEggs(frame.eggs, elapsedTime);
    this.syncEggScatterDebris(frame.eggScatterDebris ?? []);
    this.syncVoxelBursts(frame.voxelBursts ?? []);
    this.syncSkyDrops(frame.skyDrops, elapsedTime);
    this.syncClusters(frame.fallingClusters, elapsedTime);
    this.syncFeatherBursts(elapsedTime);
  }

  private syncPlayers(players: RuntimePlayerState[], localPlayerId: string | null, delta: number, elapsedTime: number) {
    const seen = new Set<string>();
    const horizontalDamping = 1 - Math.exp(-delta * 10);
    let localPlayerVisual: PlayerVisual | null = null;

    for (const player of players) {
      const isLocal = player.id === localPlayerId;
      const preferredPaletteName = isLocal ? this.localPlayerPaletteName : null;
      const resolvedPaletteName = getChickenPalette(player.id, this.matchColorSeed, preferredPaletteName).name;
      let visual = this.playerVisuals.get(player.id);
      if (!visual || visual.paletteName !== resolvedPaletteName) {
        if (visual) {
          this.playersGroup.remove(visual.group);
          disposePlayerVisual(visual);
        }

        visual = createPlayerVisual(player.id, this.matchColorSeed, preferredPaletteName);
        visual.group.position.set(player.position.x, player.position.y, player.position.z);
        this.playersGroup.add(visual.group);
        this.playerVisuals.set(player.id, visual);
      }
      if (isLocal) {
        localPlayerVisual = visual;
      }

      seen.add(player.id);
      const previousLivesRemaining = this.playerObservedLives.get(player.id);
      if (previousLivesRemaining !== undefined && player.livesRemaining < previousLivesRemaining) {
        this.triggerFeatherBurst(player.position, previousLivesRemaining - player.livesRemaining, elapsedTime);
      }
      this.playerObservedLives.set(player.id, player.livesRemaining);
      const playerVisible = player.fallingOut || (player.alive && !player.respawning);
      visual.group.visible = playerVisible;
      const superBoomDive = player.spacePhase === "superBoomDive";
      const superBoomImpact = player.spacePhase === "superBoomImpact";
      const superBoomBombPhase = superBoomDive || superBoomImpact;
      visual.root.visible = playerVisible && !superBoomBombPhase;
      visual.bomb.visible = playerVisible && superBoomBombPhase;
      if (!playerVisible) {
        visual.previousGrounded = player.grounded;
        visual.previousVelocityY = player.velocity.y;
        visual.landingRollRemaining = 0;
        visual.bomb.visible = false;
        continue;
      }

      visual.targetPosition.set(player.position.x, player.position.y, player.position.z);
      const rising = player.velocity.y > 0 && visual.targetPosition.y > visual.group.position.y;
      const verticalDamping = rising ? 1 - Math.exp(-delta * 26) : horizontalDamping;
      visual.group.position.x = THREE.MathUtils.lerp(visual.group.position.x, visual.targetPosition.x, horizontalDamping);
      visual.group.position.y = THREE.MathUtils.lerp(visual.group.position.y, visual.targetPosition.y, verticalDamping);
      visual.group.position.z = THREE.MathUtils.lerp(visual.group.position.z, visual.targetPosition.z, horizontalDamping);
      const useLowDetail =
        !isLocal && this.camera.position.distanceToSquared(visual.group.position) > PLAYER_DETAIL_DISTANCE * PLAYER_DETAIL_DISTANCE;
      visual.highDetail.visible = !useLowDetail;
      visual.lowDetail.visible = useLowDetail;

      const targetYaw = Math.atan2(player.facing.x, player.facing.z);
      visual.group.rotation.y = stepAngleToward(visual.group.rotation.y, targetYaw, delta * AVATAR_TURN_SPEED);

      const visualState = player.alive
        ? getPlayerAvatarVisualState(player.stunRemaining, elapsedTime)
        : eliminatedVisualState;
      visual.avatar.scale.setScalar(1);
      visual.shell.scale.set(visualState.scaleX, visualState.scaleY, visualState.scaleZ);
      visual.shell.visible = visualState.blinkVisible;

      if (shouldTriggerChickenLandingTumble({
        wasGrounded: visual.previousGrounded,
        grounded: player.grounded,
        previousVelocityY: visual.previousVelocityY
      })) {
        visual.landingRollRemaining = chickenPoseVisualDefaults.landingTumbleDuration;
      } else {
        visual.landingRollRemaining = Math.max(0, visual.landingRollRemaining - delta);
      }

      const planarSpeed = Math.hypot(player.velocity.x, player.velocity.z);
      const eggLaunchChargeAlpha = isLocal ? this.eggChargeState.chargeAlpha : 0;
      const eggLaunchReleaseRemaining = isLocal ? this.eggChargeState.releaseRemaining : 0;
      const poseState = getChickenPoseVisualState({
        grounded: player.grounded,
        velocityY: player.velocity.y,
        planarSpeed,
        elapsedTime,
        motionSeed: visual.motionSeed,
        pushVisualRemaining: player.pushVisualRemaining,
        landingRollRemaining: visual.landingRollRemaining,
        spacePhase: player.spacePhase,
        spacePhaseRemaining: player.spacePhaseRemaining,
        stunned: player.stunRemaining > 0,
        eggLaunchChargeAlpha,
        eggLaunchReleaseRemaining
      });
      visual.shell.rotation.x = poseState.bodyPitch;
      visual.shell.rotation.z = poseState.bodyRoll;
      if (superBoomBombPhase) {
        const bombPulse = superBoomImpact
          ? 1.16 + Math.sin(elapsedTime * 34 + visual.motionSeed * 7) * 0.08
          : 1 + Math.sin(elapsedTime * 18 + visual.motionSeed * 6) * 0.06;
        if (superBoomImpact) {
          visual.bomb.scale.set(
            SUPER_BOOM_BOMB_SCALE * bombPulse,
            SUPER_BOOM_BOMB_SCALE * 0.88,
            SUPER_BOOM_BOMB_SCALE * (1.02 + bombPulse * 0.02)
          );
          visual.bomb.rotation.set(0.08, elapsedTime * 4 + visual.motionSeed, Math.sin(elapsedTime * 22) * 0.06);
          visual.bomb.position.y = 0.68;
        } else {
          visual.bomb.scale.setScalar(SUPER_BOOM_BOMB_SCALE * bombPulse);
          visual.bomb.rotation.set(0, elapsedTime * 11 + visual.motionSeed * 2, 0);
          visual.bomb.position.y = 0.82;
        }
        visual.bombMaterial.emissiveIntensity =
          1.12 + Math.sin(elapsedTime * (superBoomImpact ? 28 : 20) + visual.motionSeed * 4) * 0.24;
        visual.bombMaterial.color.set("#fff0d9");
      } else {
        visual.bomb.scale.setScalar(1);
        visual.bomb.rotation.set(0, 0, 0);
        visual.bomb.position.y = 0.74;
        visual.bombMaterial.emissiveIntensity = eggVisualDefaults.emissiveMin;
      }

      const shadowSurfaceY = this.resolvePlayerShadowSurfaceY(player.position);
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

      visual.shadow.position.set(0, shadowState.yOffset, 0);
      visual.shadow.scale.setScalar(shadowState.scale);
      visual.shadowMaterial.opacity = shadowState.opacity;

      const stride =
        !player.alive || player.stunRemaining > 0 ? 0 : Math.min(1, Math.hypot(player.velocity.x, player.velocity.z) / 5);
      const struggleSignal =
        stride > 0.08 ? Math.max(0, Math.sin(elapsedTime * 0.82 + visual.motionSeed * 0.35 + 0.6)) : 0;
      const struggleHop =
        struggleSignal > 0.95 ? Math.pow((struggleSignal - 0.95) / 0.05, 1.8) * stride : 0;
      const runWingLift = struggleHop * 0.42;
      visual.avatar.position.y =
        AVATAR_BOB_BASE_Y + Math.sin(elapsedTime * 10 + (isLocal ? 0 : 1.2)) * 0.05 * stride + struggleHop * 0.52;
      visual.avatar.position.z = poseState.bodyForwardOffset;
      visual.avatar.rotation.x = struggleHop * 0.22;
      visual.avatar.rotation.z = 0;

      visual.body.rotation.x = 0;
      visual.body.rotation.y = poseState.bodyYaw;
      visual.headPivot.rotation.x = poseState.headPitch;
      visual.headPivot.rotation.y = poseState.headYaw;
      visual.headPivot.position.y = chickenModelRig.headPivotY + poseState.headYOffset;
      visual.lowDetailHead.rotation.x = poseState.headPitch * 0.76;
      visual.lowDetailHead.rotation.y = poseState.headYaw * 0.72;
      visual.lowDetailHead.position.y = chickenModelRig.lowHeadPivotY + poseState.headYOffset * 0.5;
      visual.leftLeg.rotation.x = poseState.leftLegPitch;
      visual.rightLeg.rotation.x = poseState.rightLegPitch;

      const wingState = getChickenWingVisualState({
        alive: player.alive,
        grounded: player.grounded,
        velocityY: player.velocity.y,
        planarSpeed,
        jetpackActive: player.jetpackActive,
        motionSeed: visual.motionSeed,
        stunned: player.stunRemaining > 0,
        elapsedTime,
        eggLaunchChargeAlpha,
        eggLaunchReleaseRemaining
      });
      const statusVisualState = getPlayerStatusVisualState(player.invulnerableRemaining, elapsedTime);
      const ringOpacity = !player.alive
        ? 0.35
        : player.stunRemaining > 0
          ? 0.5
          : isLocal
            ? 0.95
            : 0.7;
      visual.ringMaterial.opacity = Math.min(1, ringOpacity * statusVisualState.ringOpacityMultiplier);
      const leftWingAngle = Math.min(1.34, wingState.leftWingAngle + poseState.wingAngleOffset + runWingLift);
      const rightWingAngle = Math.min(1.34, wingState.rightWingAngle + poseState.wingAngleOffset + runWingLift);
      const wingHeightScale = getChickenWingHeightScale(wingState.wingSpanScale);
      const wingDepthScale = getChickenWingDepthScale(wingState.wingSpanScale);
      const wingMeshOffsetX = getChickenWingMeshOffsetX(wingState.wingSpanScale);
      const lowDetailWingOffsetX = getChickenLowDetailWingMeshOffsetX(wingState.wingSpanScale);
      const traceVisible = wingState.traceIntensity > 0.03;
      const traceOffsetX = getChickenWingTraceOffsetX(wingState.wingSpanScale);
      const traceHeightScale = getChickenWingTraceHeightScale(wingState.traceIntensity);
      const lowDetailTraceOffsetX = getChickenLowDetailTraceOffsetX(wingState.wingSpanScale);
      const lowDetailTraceHeightScale = getChickenLowDetailWingTraceHeightScale(wingState.traceIntensity);

      if (
        isLocal &&
        player.spacePhase === "float" &&
        this.localSpaceChallengeTargetKey
      ) {
        const localSpaceChallenge = this.getLocalSpaceChallengeState();
        const mashProgress = THREE.MathUtils.clamp(
          this.localSpaceChallengeHitCount / Math.max(1, localSpaceChallenge?.requiredHits ?? 1),
          0,
          1
        );
        const primeAlpha = THREE.MathUtils.clamp(
          (this.spaceTypePrimeUntil - elapsedTime) / SPACE_TYPING_PRIME_DURATION,
          0,
          1
        );
        const successAlpha = THREE.MathUtils.clamp(
          (this.spaceSuccessPulseUntil - elapsedTime) / SPACE_TYPING_SUCCESS_PULSE_DURATION,
          0,
          1
        );
        const misfireAlpha = THREE.MathUtils.clamp(
          (this.spaceTypeMisfireUntil - elapsedTime) / SPACE_TYPING_MISFIRE_DURATION,
          0,
          1
        );
        const misfireWobble = Math.sin(elapsedTime * 30 + visual.motionSeed * 8) * 0.16 * misfireAlpha;
        const avatarScale = 1 + mashProgress * 0.34 + primeAlpha * 0.08 + successAlpha * 0.12;
        visual.avatar.scale.setScalar(avatarScale);
        visual.shell.rotation.x +=
          mashProgress * 0.82 +
          primeAlpha * 0.32 +
          successAlpha * 0.28 -
          misfireAlpha * 0.08;
        visual.shell.rotation.z +=
          mashProgress * 0.14 +
          primeAlpha * 0.16 +
          successAlpha * 0.06 +
          misfireWobble;
        visual.body.rotation.x +=
          mashProgress * 0.24 +
          primeAlpha * 0.14 +
          successAlpha * 0.08 -
          misfireAlpha * 0.04;
        visual.body.rotation.y +=
          mashProgress * 0.18 +
          primeAlpha * 0.28 +
          successAlpha * 0.14 -
          misfireAlpha * 0.32;
        visual.avatar.position.z -=
          mashProgress * 0.32 +
          primeAlpha * 0.12 +
          successAlpha * 0.16;
        visual.avatar.position.y += mashProgress * 0.08 + primeAlpha * 0.12 + successAlpha * 0.1;
        visual.avatar.rotation.x +=
          mashProgress * 0.28 +
          primeAlpha * 0.18 +
          successAlpha * 0.12;
        visual.avatar.rotation.z += mashProgress * 0.03 + misfireWobble * 0.5 + successAlpha * 0.04;
        visual.shell.scale.set(
          visual.shell.scale.x * (1 + mashProgress * 0.3 + primeAlpha * 0.12 + successAlpha * 0.1),
          visual.shell.scale.y *
            (1 - mashProgress * 0.22 - primeAlpha * 0.16 - successAlpha * 0.08 + misfireAlpha * 0.07),
          visual.shell.scale.z * (1 + mashProgress * 0.3 + primeAlpha * 0.12 + successAlpha * 0.1)
        );
      }

      visual.leftWing.rotation.z = leftWingAngle;
      visual.rightWing.rotation.z = -rightWingAngle;
      visual.lowDetailLeftWing.rotation.z = leftWingAngle * 0.94;
      visual.lowDetailRightWing.rotation.z = -rightWingAngle * 0.94;
      visual.leftWingMesh.position.x = wingMeshOffsetX;
      visual.rightWingMesh.position.x = -wingMeshOffsetX;
      visual.lowDetailLeftWingMesh.position.x = lowDetailWingOffsetX;
      visual.lowDetailRightWingMesh.position.x = -lowDetailWingOffsetX;
      visual.leftWingMesh.scale.set(wingState.wingSpanScale, wingHeightScale, wingDepthScale);
      visual.rightWingMesh.scale.set(wingState.wingSpanScale, wingHeightScale, wingDepthScale);
      visual.lowDetailLeftWingMesh.scale.set(wingState.wingSpanScale * 0.92, 1 + (wingHeightScale - 1) * 0.65, 1);
      visual.lowDetailRightWingMesh.scale.set(wingState.wingSpanScale * 0.92, 1 + (wingHeightScale - 1) * 0.65, 1);
      visual.wingletTraceMaterial.opacity = traceVisible ? Math.min(0.72, wingState.traceIntensity * 0.52) : 0;

      visual.leftWingTrace.position.x = traceOffsetX;
      visual.rightWingTrace.position.x = -traceOffsetX;
      visual.leftWingTrace.scale.set(wingState.traceLength, traceHeightScale, 1);
      visual.rightWingTrace.scale.set(wingState.traceLength, traceHeightScale, 1);
      visual.leftWingTrace.visible = !useLowDetail && traceVisible;
      visual.rightWingTrace.visible = !useLowDetail && traceVisible;

      visual.lowDetailLeftTrace.position.x = lowDetailTraceOffsetX;
      visual.lowDetailRightTrace.position.x = -lowDetailTraceOffsetX;
      visual.lowDetailLeftTrace.scale.set(wingState.traceLength * 0.88, lowDetailTraceHeightScale, 1);
      visual.lowDetailRightTrace.scale.set(wingState.traceLength * 0.88, lowDetailTraceHeightScale, 1);
      visual.lowDetailLeftTrace.visible = useLowDetail && traceVisible;
      visual.lowDetailRightTrace.visible = useLowDetail && traceVisible;

      const tailMotion = getChickenTailMotion(poseState.featherSwing);
      visual.tail.rotation.x = tailMotion.x;
      visual.tail.rotation.z = tailMotion.z;
      visual.lowDetailTail.rotation.x = tailMotion.x * 0.82;
      visual.lowDetailTail.rotation.z = tailMotion.z * 0.82;

      visual.headFeathers.forEach((feather, index) => {
        const featherRotation = getChickenHeadFeatherRotation(headFeatherOffsets[index]!, poseState.featherSwing);
        feather.rotation.set(featherRotation.x, featherRotation.y, featherRotation.z);
        feather.visible = index < player.livesRemaining;
      });

      visual.lowDetailHeadFeathers.forEach((feather, index) => {
        const featherRotation = getChickenHeadFeatherRotation(headFeatherOffsets[index]!, poseState.featherSwing, 0.82);
        feather.rotation.set(featherRotation.x * 0.9, featherRotation.y, featherRotation.z * 0.86);
        feather.visible = index < player.livesRemaining;
      });

      visual.leftWingFeatherlets.forEach((feather, index) => {
        const leftRotation = getChickenWingFeatherletRotation(
          wingFeatherletOffsets[index]!,
          poseState.featherSwing,
          1
        );
        feather.rotation.set(leftRotation.x, leftRotation.y, leftRotation.z);
        feather.visible = true;
        const rightFeather = visual.rightWingFeatherlets[index];
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

      visual.previousGrounded = player.grounded;
      visual.previousVelocityY = player.velocity.y;
    }

    for (const [playerId, visual] of this.playerVisuals) {
      if (seen.has(playerId)) {
        continue;
      }
      this.playersGroup.remove(visual.group);
      disposePlayerVisual(visual);
      this.playerVisuals.delete(playerId);
    }

    this.updateCoveredPlayerSilhouette(localPlayerVisual);
  }

  private ensureCoveredPlayerSilhouette(sourceVisual: PlayerVisual) {
    if (this.coveredPlayerSilhouetteSource === sourceVisual && this.coveredPlayerSilhouetteRoot) {
      return this.coveredPlayerSilhouetteRoot;
    }

    if (this.coveredPlayerSilhouetteRoot) {
      this.coveredPlayerSilhouetteGroup.remove(this.coveredPlayerSilhouetteRoot);
    }

    const clone = clonePlayerSilhouetteRoot(sourceVisual.root, this.coveredPlayerSilhouetteMaterial);
    this.coveredPlayerSilhouetteGroup.add(clone);
    this.coveredPlayerSilhouetteSource = sourceVisual;
    this.coveredPlayerSilhouetteRoot = clone;
    return clone;
  }

  private updateCoveredPlayerSilhouette(localVisual: PlayerVisual | null) {
    if (
      !localVisual ||
      !this.coveredPlayerContourVisible ||
      !localVisual.group.visible
    ) {
      this.coveredPlayerSilhouetteGroup.visible = false;
      return;
    }

    this.coveredPlayerSilhouetteMaterial.color.copy(localVisual.ringMaterial.color);
    this.coveredPlayerSilhouetteGroup.position.copy(localVisual.group.position);
    this.coveredPlayerSilhouetteGroup.quaternion.copy(localVisual.group.quaternion);
    this.coveredPlayerSilhouetteGroup.scale.copy(localVisual.group.scale);

    let silhouetteRoot = this.ensureCoveredPlayerSilhouette(localVisual);
    if (!syncObjectTransformsRecursive(localVisual.root, silhouetteRoot)) {
      this.coveredPlayerSilhouetteGroup.remove(silhouetteRoot);
      this.coveredPlayerSilhouetteSource = null;
      this.coveredPlayerSilhouetteRoot = null;
      silhouetteRoot = this.ensureCoveredPlayerSilhouette(localVisual);
      syncObjectTransformsRecursive(localVisual.root, silhouetteRoot);
    }

    this.coveredPlayerSilhouetteGroup.visible = true;
  }

  private syncEggs(eggs: RuntimeEggState[], elapsedTime: number) {
    const seen = new Set<string>();

    for (const egg of eggs) {
      let visual = this.eggVisuals.get(egg.id);
      if (!visual) {
        visual = createEggVisual();
        this.eggsGroup.add(visual.group);
        this.eggVisuals.set(egg.id, visual);
      }

      seen.add(egg.id);
      const eggVisualState = getEggVisualState(egg, elapsedTime, EGG_FUSE_DURATION);
      visual.group.visible = true;
      visual.group.position.set(egg.position.x, egg.position.y + eggVisualState.jiggleY, egg.position.z);
      visual.group.rotation.set(eggVisualState.rotationX, eggVisualState.rotationY, eggVisualState.rotationZ);
      visual.group.scale.set(eggVisualState.scaleX, eggVisualState.scaleY, eggVisualState.scaleZ);
      visual.material.color.set("#fff0d9").lerp(new THREE.Color("#ff4f3d"), eggVisualState.heatAlpha);
      visual.material.emissive.set("#ff4f3d");
      visual.material.emissiveIntensity = eggVisualState.emissiveIntensity;
    }

    for (const [eggId, visual] of this.eggVisuals) {
      if (seen.has(eggId)) {
        continue;
      }
      this.eggsGroup.remove(visual.group);
      visual.material.dispose();
      this.eggVisuals.delete(eggId);
    }
  }

  private syncEggScatterDebris(eggScatterDebris: RuntimeEggScatterDebrisState[]) {
    const counts: Record<BlockRenderProfile, number> = {
      earthSurface: 0,
      earthSubsoil: 0,
      darkness: 0
    };

    for (const debris of eggScatterDebris) {
      const profile = getBlockRenderProfile(debris.kind, Math.floor(debris.origin.y));
      const mesh = this.eggScatterMeshes.get(profile);
      const instanceIndex = counts[profile];
      if (!mesh || instanceIndex >= MAX_EGG_SCATTER_INSTANCES_PER_PROFILE) {
        continue;
      }

      const visualState = getEggScatterDebrisVisualState(debris, EGG_SCATTER_ARC_HEIGHT);
      voxelFxTempObject.position.set(visualState.position.x, visualState.position.y, visualState.position.z);
      voxelFxTempObject.rotation.set(visualState.rotationX, visualState.rotationY, visualState.rotationZ);
      voxelFxTempObject.scale.set(visualState.scaleX, visualState.scaleY, visualState.scaleZ);
      voxelFxTempObject.updateMatrix();
      mesh.setMatrixAt(instanceIndex, voxelFxTempObject.matrix);
      counts[profile] += 1;
    }

    for (const profile of voxelFxProfiles) {
      finalizeDynamicInstancedMesh(this.eggScatterMeshes.get(profile) ?? null, counts[profile]);
    }
  }

  private syncVoxelBursts(voxelBursts: RuntimeVoxelBurstState[]) {
    const harvestCounts: Record<BlockRenderProfile, number> = {
      earthSurface: 0,
      earthSubsoil: 0,
      darkness: 0
    };
    let eggExplosionCount = 0;
    let eggShockwaveCount = 0;

    for (const burst of voxelBursts) {
      const particleCount = getVoxelBurstParticleCount(burst);

      if (burst.style === "harvest") {
        const profile = getVoxelBurstMaterialProfile(burst);
        if (!profile) {
          continue;
        }

        const resource = this.harvestBurstMeshes.get(profile);
        if (!resource) {
          continue;
        }

        for (let particleIndex = 0; particleIndex < particleCount; particleIndex += 1) {
          const instanceIndex = harvestCounts[profile];
          if (instanceIndex >= MAX_HARVEST_BURST_INSTANCES_PER_PROFILE) {
            break;
          }

          const particle = getVoxelBurstParticleState(burst, particleIndex);
          voxelFxTempObject.position.set(particle.position.x, particle.position.y, particle.position.z);
          voxelFxTempObject.rotation.set(particle.rotationX, particle.rotationY, particle.rotationZ);
          voxelFxTempObject.scale.setScalar(particle.scale);
          voxelFxTempObject.updateMatrix();
          resource.mesh.setMatrixAt(instanceIndex, voxelFxTempObject.matrix);
          resource.opacityAttribute.setX(instanceIndex, particle.opacity);
          harvestCounts[profile] += 1;
        }
        continue;
      }

      if (!this.eggExplosionBurstMesh) {
        continue;
      }

      for (let particleIndex = 0; particleIndex < particleCount; particleIndex += 1) {
        if (eggExplosionCount >= MAX_EGG_EXPLOSION_BURST_INSTANCES) {
          break;
        }

        const particle = getVoxelBurstParticleState(burst, particleIndex);
        voxelFxTempObject.position.set(particle.position.x, particle.position.y, particle.position.z);
        voxelFxTempObject.rotation.set(particle.rotationX, particle.rotationY, particle.rotationZ);
        voxelFxTempObject.scale.setScalar(particle.scale);
        voxelFxTempObject.updateMatrix();
        this.eggExplosionBurstMesh.mesh.setMatrixAt(eggExplosionCount, voxelFxTempObject.matrix);
        this.eggExplosionBurstMesh.opacityAttribute.setX(eggExplosionCount, particle.opacity);
        eggExplosionCount += 1;
      }

      if (this.eggExplosionShockwaveMesh && eggShockwaveCount < MAX_EGG_EXPLOSION_SHOCKWAVE_INSTANCES) {
        const shockwave = getVoxelBurstShockwaveState(burst);
        if (shockwave) {
          voxelFxTempObject.position.set(shockwave.position.x, shockwave.position.y, shockwave.position.z);
          voxelFxTempObject.rotation.set(-Math.PI / 2, 0, 0);
          voxelFxTempObject.scale.setScalar(shockwave.scale);
          voxelFxTempObject.updateMatrix();
          this.eggExplosionShockwaveMesh.mesh.setMatrixAt(eggShockwaveCount, voxelFxTempObject.matrix);
          this.eggExplosionShockwaveMesh.opacityAttribute.setX(eggShockwaveCount, shockwave.opacity);
          eggShockwaveCount += 1;
        }
      }
    }

    for (const profile of voxelFxProfiles) {
      finalizeDynamicOpacityMesh(this.harvestBurstMeshes.get(profile) ?? null, harvestCounts[profile]);
    }
    finalizeDynamicOpacityMesh(this.eggExplosionBurstMesh, eggExplosionCount);
    finalizeDynamicOpacityMesh(this.eggExplosionShockwaveMesh, eggShockwaveCount);
  }

  private syncSkyDrops(skyDrops: RuntimeSkyDropState[], elapsedTime: number) {
    const seen = new Set<string>();

    for (const skyDrop of skyDrops) {
      let visual = this.skyDropVisuals.get(skyDrop.id);
      if (!visual) {
        const group = new THREE.Group();
        const ringMaterial = new THREE.MeshBasicMaterial({
          color: "#fff4c6",
          opacity: 0.5,
          transparent: true,
          side: THREE.DoubleSide
        });
        const ring = new THREE.Mesh(skyDropRingGeometry, ringMaterial);
        ring.rotation.x = -Math.PI / 2;
        const beamMaterial = new THREE.MeshBasicMaterial({
          color: "#fff8df",
          opacity: 0.2,
          transparent: true
        });
        const beam = new THREE.Mesh(skyDropBeamGeometry, beamMaterial);
        const cube = new THREE.Mesh(
          sharedVoxelGeometry,
          getVoxelMaterials(getBlockRenderProfile("ground", skyDrop.landingVoxel.y))
        );
        group.add(ring, beam, cube);
        this.skyDropsGroup.add(group);
        visual = {
          group,
          ring,
          ringMaterial,
          beam,
          beamMaterial,
          cube
        };
        this.skyDropVisuals.set(skyDrop.id, visual);
      }

      seen.add(skyDrop.id);
      const visualState = getSkyDropVisualState(skyDrop, elapsedTime);
      visual.ring.visible = visualState.warningVisible;
      visual.beam.visible = visualState.warningVisible;
      visual.ring.position.set(skyDrop.landingVoxel.x + 0.5, skyDrop.landingVoxel.y + 0.08, skyDrop.landingVoxel.z + 0.5);
      visual.ring.scale.setScalar(visualState.warningScale);
      visual.beam.position.set(skyDrop.landingVoxel.x + 0.5, skyDrop.landingVoxel.y + 0.8, skyDrop.landingVoxel.z + 0.5);
      visual.beam.scale.set(1, 0.9 + visualState.warningScale * 0.45, 1);
      visual.ringMaterial.opacity = visualState.warningOpacity;
      visual.beamMaterial.opacity = visualState.warningOpacity * 0.4;
      visual.cube.visible = skyDrop.phase === "falling";
      visual.cube.position.set(
        skyDrop.landingVoxel.x + 0.5,
        skyDrop.landingVoxel.y + 0.5 + skyDrop.offsetY,
        skyDrop.landingVoxel.z + 0.5
      );
    }

    for (const [skyDropId, visual] of this.skyDropVisuals) {
      if (seen.has(skyDropId)) {
        continue;
      }
      this.skyDropsGroup.remove(visual.group);
      this.skyDropVisuals.delete(skyDropId);
    }
  }

  private syncClusters(clusters: FallingClusterViewState[], elapsedTime: number) {
    const seen = new Set<string>();

    for (const cluster of clusters) {
      let visual = this.clusterVisuals.get(cluster.id);
      if (!visual) {
        const group = new THREE.Group();
        const voxelsByProfile = new Map<string, FallingClusterViewState["voxels"]>();

        for (const voxel of cluster.voxels) {
          const profile = getBlockRenderProfile(voxel.kind, voxel.y);
          const bucket = voxelsByProfile.get(profile) ?? [];
          bucket.push(voxel);
          voxelsByProfile.set(profile, bucket);
        }

        for (const [profile, voxels] of voxelsByProfile) {
          const mesh = new THREE.InstancedMesh(
            sharedVoxelGeometry,
            getVoxelMaterials(profile as ReturnType<typeof getBlockRenderProfile>),
            voxels.length
          );
          for (let index = 0; index < voxels.length; index += 1) {
            const voxel = voxels[index]!;
            clusterTempObject.position.set(voxel.x + 0.5, voxel.y + 0.5, voxel.z + 0.5);
            clusterTempObject.updateMatrix();
            mesh.setMatrixAt(index, clusterTempObject.matrix);
          }
          finalizeStaticInstancedMesh(mesh, voxels.length);
          group.add(mesh);
        }

        this.clustersGroup.add(group);
        visual = { group };
        this.clusterVisuals.set(cluster.id, visual);
      }

      seen.add(cluster.id);
      const visualState = getFallingClusterVisualState(cluster, elapsedTime);
      visual.group.position.set(visualState.shakeX, cluster.offsetY, visualState.shakeZ);
    }

    for (const [clusterId, visual] of this.clusterVisuals) {
      if (seen.has(clusterId)) {
        continue;
      }
      this.clustersGroup.remove(visual.group);
      this.clusterVisuals.delete(clusterId);
    }
  }
}
