import * as THREE from "three";
import {
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
  aimCameraConfig,
  applyFreeLookDelta,
  chaseCameraConfig,
  dampScalar,
  getAimRigState,
  getForwardSpeedRatio,
  getPlanarForwardBetweenPoints,
  getSpeedCameraBlend,
  getYawFromPlanarVector,
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
import { resolveTerrainRaycastHit } from "../game/terrainRaycast";
import {
  type BlockRenderProfile,
  getBlockRenderProfile,
  getTerrainChunkMaterials,
  getVoxelMaterials,
  sharedVoxelGeometry
} from "../game/voxelMaterials";
import type {
  WorkerRequestMessage,
  WorkerResponseMessage
} from "./protocol";
import { AuthoritativeReplica } from "./authoritativeReplica";
import { MAX_TYPED_TEXT_BYTES, packRuntimeInputCommand } from "./runtimeInput";
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
  runtimeSettings?: RuntimeControlSettings;
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

type EggChargeInputSource = "key";

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

const backgroundColor = "#8fc6e0";
const runtimeGroundMaterial = new THREE.MeshStandardMaterial({ color: "#050505" });
const menuGroundMaterial = new THREE.MeshBasicMaterial({ color: backgroundColor });
const cloudGeometry = new THREE.BoxGeometry(1.6, 0.9, 1.6);
const skyDropRingGeometry = new THREE.RingGeometry(0.48, 0.72, 24);
const skyDropBeamGeometry = new THREE.CylinderGeometry(0.16, 0.16, 2, 12, 1, true);
const speedTraceGeometry = new THREE.PlaneGeometry(0.16, 1.5).translate(0, 0.75, 0);
const clusterTempObject = new THREE.Object3D();
const cloudTempObject = new THREE.Object3D();
const voxelFxTempObject = new THREE.Object3D();
const treeTempMatrix = new THREE.Matrix4();
const shadowRayDirection = new THREE.Vector3(0, -1, 0);
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
const EGG_TRAJECTORY_MAX_POINTS = 56;
const EGG_TRAJECTORY_TIME_STEP = 0.05;
const EGG_TRAJECTORY_MAX_DURATION = 2.55;
const PLAYER_DETAIL_DISTANCE = 18;
const SPEED_TRACE_DEPTH = 2.4;
const SPEED_TRACE_PUSH_BURST_DURATION = 0.2;
const SPEED_TRACE_MIN_AIR_SPEED = 3.6;
const SPACE_BLEND_DAMPING = 4.4;
const SPACE_STAR_COUNT = 220;
const POINTER_CAPTURE_TIMEOUT_MS = 1_000;
const INPUT_HOLD_THRESHOLD = 0.16;
const DOUBLE_TAP_WINDOW_MS = 220;
const MATTER_PULSE_DURATION = 0.72;
const MATTER_BUBBLE_DURATION = 1.1;
const MATTER_FEEDBACK_COOLDOWN = 0.5;
const SPACE_TYPING_PRIME_DURATION = 0.22;
const SPACE_TYPING_MISFIRE_DURATION = 0.16;
const SPACE_TYPING_MISTAKE_PULSE_DURATION = 0.18;
const SPACE_TYPING_SUCCESS_PULSE_DURATION = 0.48;
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

const isRuntimeMode = (mode: ActiveShellMode) => mode === "explore" || mode === "playNpc";

const configureStaticInstancedMesh = (mesh: THREE.InstancedMesh, matrices: readonly THREE.Matrix4[]) => {
  mesh.count = matrices.length;
  for (let index = 0; index < matrices.length; index += 1) {
    mesh.setMatrixAt(index, matrices[index]!);
  }
  finalizeStaticInstancedMesh(mesh, matrices.length);
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

const isRuntimeDestroyPointerButton = (button: number) => button === 0 || button === 2;

const isFormElement = (target: EventTarget | null) =>
  target instanceof HTMLInputElement ||
  target instanceof HTMLTextAreaElement ||
  target instanceof HTMLSelectElement;

const getNormalizedTypedCharacter = (event: KeyboardEvent) => {
  if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) {
    return null;
  }

  if (event.key === " ") {
    return " ";
  }

  return /^[a-z]$/i.test(event.key) ? event.key.toLowerCase() : null;
};

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

export class GameClient {
  static mount(options: GameClientMountOptions) {
    return new GameClient(options);
  }

  private readonly canvas: HTMLCanvasElement;
  private readonly callbacks: GameClientCallbacks;
  private readonly worker: Worker;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(40, 1, 0.1, 1000);
  private readonly sceneBackgroundColor = daySkyColor.clone();
  private readonly ambientLight = new THREE.AmbientLight(0xffffff, 0.45);
  private readonly directionalLight = new THREE.DirectionalLight(0xffffff, 1.36);
  private readonly hemisphereLight = new THREE.HemisphereLight("#fef7df", "#4c6156", 0.22);
  private readonly cloudsGroup = new THREE.Group();
  private readonly spaceBackdropGroup = new THREE.Group();
  private readonly terrainGroup = new THREE.Group();
  private readonly propsGroup = new THREE.Group();
  private readonly spawnsGroup = new THREE.Group();
  private readonly playersGroup = new THREE.Group();
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
  private readonly centerRay = new THREE.Vector2(0, 0);
  private readonly clock = new THREE.Clock();
  private readonly chunkMeshes = new Map<string, THREE.Mesh>();
  private readonly playerVisuals = new Map<string, PlayerVisual>();
  private readonly eggVisuals = new Map<string, EggVisual>();
  private readonly eggScatterMeshes = new Map<BlockRenderProfile, THREE.InstancedMesh>();
  private readonly harvestBurstMeshes = new Map<BlockRenderProfile, DynamicOpacityMeshResource>();
  private readonly skyDropVisuals = new Map<string, SkyDropVisual>();
  private readonly clusterVisuals = new Map<string, ClusterVisual>();
  private readonly pendingDocumentResolvers = new Map<string, (document: MapDocumentV1) => void>();
  private readonly currentLookTarget = new THREE.Vector3();
  private readonly desiredLookTarget = new THREE.Vector3();
  private readonly desiredCameraPosition = new THREE.Vector3();
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
  private lastForwardTapAtMs = Number.NEGATIVE_INFINITY;
  private forwardTapReleased = true;

  private animationFrameId: number | null = null;
  private mode: ActiveShellMode;
  private worldDocument = normalizeArenaBudgetMapDocument(createDefaultArenaMap());
  private latestFrame: RuntimeRenderFrame | null = null;
  private readonly authoritativeReplica = new AuthoritativeReplica();
  private matchColorSeed: number;
  private cameraForward = { x: 1, z: 0 };
  private inputSequence = 0;
  private destroyQueued = false;
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
  private pendingReadyToDisplay = false;
  private baseFogNear = 36;
  private baseFogFar = 120;
  private spaceBlend = 0;
  private matterPulseUntil = 0;
  private matterBubbleUntil = 0;
  private matterFeedbackLockedUntil = 0;
  private spaceTypePrimeUntil = 0;
  private spaceTypeMisfireUntil = 0;
  private spaceMistakePulseUntil = 0;
  private spaceSuccessPulseUntil = 0;
  private superBoomImpactJoltUntil = 0;
  private previousLocalSpacePhase: RuntimePlayerState["spacePhase"] | null = null;
  private localSpaceChallengePhrase: string | null = null;
  private localSpaceChallengeTypedLength = 0;
  private pendingTypedText = "";
  private lastRuntimeOverlayState: RuntimeOverlayState | null = null;
  private resourceBubbleElement: HTMLDivElement | null = null;

  private constructor({
    canvas,
    initialDocument,
    initialMode,
    initialSpawnStyle = "ground",
    localPlayerName,
    localPlayerPaletteName = null,
    matchColorSeed,
    presentation = "default",
    runtimeSettings,
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
    this.runtimeControlSettings = runtimeSettings
      ? normalizeRuntimeControlSettings(runtimeSettings)
      : createDefaultRuntimeControlSettings();
    this.worldDocument = normalizeArenaBudgetMapDocument(initialDocument ?? createDefaultArenaMap());
    this.worker = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module"
    });
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance"
    });
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
    const spaceMistakePulseActive = elapsedTime < this.spaceMistakePulseUntil;
    const spaceSuccessPulseActive = elapsedTime < this.spaceSuccessPulseUntil;
    const nextState: RuntimeOverlayState = {
      matterPulseActive,
      spaceMistakePulseActive,
      spaceSuccessPulseActive,
      spaceLocalPhrase: this.localSpaceChallengePhrase,
      spaceLocalTypedLength: this.localSpaceChallengeTypedLength
    };
    const unchanged =
      !force &&
      this.lastRuntimeOverlayState !== null &&
      this.lastRuntimeOverlayState.matterPulseActive === nextState.matterPulseActive &&
      this.lastRuntimeOverlayState.spaceMistakePulseActive === nextState.spaceMistakePulseActive &&
      this.lastRuntimeOverlayState.spaceSuccessPulseActive === nextState.spaceSuccessPulseActive &&
      this.lastRuntimeOverlayState.spaceLocalPhrase === nextState.spaceLocalPhrase &&
      this.lastRuntimeOverlayState.spaceLocalTypedLength === nextState.spaceLocalTypedLength;

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
      this.localSpaceChallengePhrase = null;
      this.localSpaceChallengeTypedLength = 0;
      return;
    }

    if (this.localSpaceChallengePhrase !== challenge.phrase) {
      this.localSpaceChallengePhrase = challenge.phrase;
      this.localSpaceChallengeTypedLength = challenge.typedLength;
      return;
    }

    this.localSpaceChallengeTypedLength = Math.max(this.localSpaceChallengeTypedLength, challenge.typedLength);
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

  private triggerSuperBoomImpactJolt(elapsedTime = this.clock.elapsedTime) {
    this.superBoomImpactJoltUntil = elapsedTime + SUPER_BOOM_IMPACT_JOLT_DURATION;
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

  private clearEggInputState() {
    this.activeEggKeyCodes.clear();
    this.keyboardState.egg = false;
    this.quickEggQueued = false;
    this.quickEggPitch = 0;
    this.resetHoldAction(this.eggKeyAction);
  }

  private clearPointerActionState() {
    this.destroyQueued = false;
    this.keyboardState.placePressed = false;
    this.keyboardState.pushPressed = false;
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
    this.spaceMistakePulseUntil = 0;
    this.spaceSuccessPulseUntil = 0;
    this.superBoomImpactJoltUntil = 0;
    this.previousLocalSpacePhase = null;
    this.localSpaceChallengePhrase = null;
    this.localSpaceChallengeTypedLength = 0;
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

    this.camera.updateMatrixWorld();
    this.resourceBubbleScreenPosition.set(
      localPlayer.position.x + localPlayer.facing.x * 0.7,
      localPlayer.position.y + 1.95,
      localPlayer.position.z + localPlayer.facing.z * 0.7
    );
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
    runtimeSettings?: RuntimeControlSettings;
  }) {
    const nextPresentation = nextState.presentation ?? this.presentation;
    const nextInitialSpawnStyle = nextState.initialSpawnStyle ?? this.initialSpawnStyle;
    const nextLocalPlayerName = "localPlayerName" in nextState ? nextState.localPlayerName : this.localPlayerName;
    const nextLocalPlayerPaletteName =
      "localPlayerPaletteName" in nextState ? nextState.localPlayerPaletteName ?? null : this.localPlayerPaletteName;
    const nextRuntimeControlSettings =
      "runtimeSettings" in nextState && nextState.runtimeSettings
        ? normalizeRuntimeControlSettings(nextState.runtimeSettings)
        : this.runtimeControlSettings;
    const modeChanged = this.mode !== nextState.mode;
    const presentationChanged = this.presentation !== nextPresentation;
    const localPaletteChanged = this.localPlayerPaletteName !== nextLocalPlayerPaletteName;

    this.localPlayerName = nextLocalPlayerName;
    this.localPlayerPaletteName = nextLocalPlayerPaletteName;
    this.presentation = nextPresentation;
    this.initialSpawnStyle = nextInitialSpawnStyle;
    this.runtimeControlSettings = nextRuntimeControlSettings;

    if (!modeChanged) {
      if ((presentationChanged || localPaletteChanged) && this.mode === "editor") {
        if (presentationChanged) {
          this.updateGroundPlaneAppearance();
        }
        this.applyEditorCameraPosition();
      }
      return;
    }

    this.mode = nextState.mode;
    this.latestFrame = null;
    this.authoritativeReplica.reset();
    this.lookYaw = null;
    this.hasInitializedRuntimeCamera = false;
    this.resetPointerCaptureState();
    this.pendingResumeAfterPointerLock = false;
    this.clearPointerActionState();
    this.cancelEggCharge();
    this.setRuntimePaused(true);
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
    this.resourceBubbleElement?.remove();
    this.resourceBubbleElement = null;
    this.renderer.dispose();
  }

  private initScene() {
    this.scene.background = this.sceneBackgroundColor;
    this.scene.fog = new THREE.Fog(backgroundColor, this.baseFogNear, this.baseFogFar);
    this.directionalLight.position.set(36, 56, 24);
    this.spaceBackdropGroup.visible = false;
    this.spaceStars.frustumCulled = false;
    this.spaceBackdropGroup.add(this.spaceStars);
    this.buildSpaceBackdrop();

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), runtimeGroundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.01;
    ground.name = "ground-plane";

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
      this.spawnsGroup,
      this.playersGroup,
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
          this.callbacks.onDiagnostics?.(message.diagnostics);
          return;
      }
    };
  }

  private applyWorldSync(document: MapDocumentV1, chunkPatches: TerrainChunkPatchPayload[]) {
    this.worldDocument = normalizeArenaBudgetMapDocument(document);
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

    this.directionalLight.position.set(
      document.size.x * 0.72,
      Math.max(document.size.y + 24, 56),
      document.size.z * 0.5
    );
    this.rebuildClouds(document);
    this.rebuildProps(document);
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
      mesh.position.set(...patch.position);
      if (!existing) {
        this.terrainGroup.add(mesh);
        this.chunkMeshes.set(patch.key, mesh);
      }
    }

    this.currentTerrainStats.chunkCount = this.chunkMeshes.size;
    this.currentTerrainStats.drawCallCount = patches.reduce((sum, patch) => sum + patch.drawCallCount, 0);
    this.currentTerrainStats.triangleCount = patches.reduce((sum, patch) => sum + patch.triangleCount, 0);
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
      this.propsGroup.add(barkMesh);
    }
    if (leafMatrices.length > 0) {
      const leafMesh = new THREE.InstancedMesh(sharedVoxelGeometry, propMaterials.leaves, leafMatrices.length);
      configureStaticInstancedMesh(leafMesh, leafMatrices);
      this.propsGroup.add(leafMesh);
    }
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
  }

  private clearTerrain() {
    for (const mesh of this.chunkMeshes.values()) {
      mesh.geometry.dispose();
      this.terrainGroup.remove(mesh);
    }
    this.chunkMeshes.clear();
  }

  private clearRuntimeEntities() {
    for (const player of this.playerVisuals.values()) {
      this.playersGroup.remove(player.group);
      disposePlayerVisual(player);
    }
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
    return this.eggChargeState.source === "key" && this.eggKeyAction.pressed;
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
          [this.terrainGroup, this.propsGroup, this.clustersGroup],
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
    const typedCharacter = typingChallenge?.phase === "typing" ? getNormalizedTypedCharacter(event) : null;
    if (typingChallenge?.phase === "typing" && typedCharacter !== null) {
      event.preventDefault();
      this.syncLocalSpaceChallengeState();
      if (this.localSpaceChallengeTypedLength >= typingChallenge.phrase.length) {
        return;
      }

      if (typedCharacter === typingChallenge.phrase[this.localSpaceChallengeTypedLength]) {
        this.localSpaceChallengePhrase = typingChallenge.phrase;
        this.localSpaceChallengeTypedLength = Math.min(
          typingChallenge.phrase.length,
          this.localSpaceChallengeTypedLength + 1
        );
        this.triggerSpacePrimeFeedback();
        this.queueTypedCharacter(typedCharacter);
        if (this.localSpaceChallengeTypedLength >= typingChallenge.phrase.length) {
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
        break;
    }
  };

  private readonly handleKeyUp = (event: KeyboardEvent) => {
    const typingChallenge =
      isRuntimeMode(this.mode) && this.pointerLocked && !this.runtimePaused
        ? this.getLocalSpaceChallengeState()
        : null;
    if (typingChallenge?.phase === "typing" && event.code === "Space") {
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
        const localPlayer = this.getLocalRuntimePlayer();
        const eggStatus = this.getLocalEggStatus();
        const tappedQuickEgg = !this.eggKeyAction.holdTriggered && isRuntimeMode(this.mode) && this.pointerLocked && !this.runtimePaused;

        if (this.eggChargeState.active && this.eggChargeState.source === "key") {
          this.queueGroundEggThrow();
        } else if (tappedQuickEgg) {
          if (eggStatus?.reason === "notEnoughMatter") {
            this.triggerNotEnoughMatterFeedback();
          } else if (eggStatus?.canQuickEgg) {
            this.queueQuickEgg(localPlayer?.grounded ? this.lookPitch : 0);
          }
        }

        this.resetHoldAction(this.eggKeyAction);
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
    if (!isRuntimeMode(this.mode) || !this.pointerCapturePending || !document.hidden) {
      return;
    }

    this.resolvePointerCaptureFailure("focus-lost");
  };

  private readonly handleWindowBlur = () => {
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

      if (isRuntimeDestroyPointerButton(event.button)) {
        event.preventDefault();
        this.updateFocusedTarget();
        this.destroyQueued = this.focusedTarget !== null;
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

  private readonly handleContextMenu = (event: MouseEvent) => {
    event.preventDefault();
  };

  private performEditorActionFromPointer(event: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    this.clickRaycaster.setFromCamera(pointer, this.camera);
    const intersections = this.clickRaycaster.intersectObjects([this.terrainGroup, this.propsGroup], true);
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

    if (isRuntimeMode(this.mode)) {
      this.updateRuntimeCamera(delta);
      this.updateFocusedTarget();
      const localPlayer = this.getLocalRuntimePlayer();
      this.updateHoldToThrowState(localPlayer, elapsedTime);
      this.updateEggChargeState(localPlayer, delta, elapsedTime);
      this.sendRuntimeInput(localPlayer);
      this.applyRuntimeFrame(delta, elapsedTime);
    } else {
      this.updateSpeedTraces(null, delta, elapsedTime);
      this.updateSkyEnvironment(null, delta, elapsedTime);
      this.hideEggTrajectoryPreview();
      this.updateLocalResourceBubble(null, elapsedTime);
      this.emitRuntimeOverlayState(false, elapsedTime);
      this.focusOutline.visible = false;
      this.focusGhost.visible = false;
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
    if (!frame || !frame.localPlayerId) {
      return;
    }

    const player = frame.players.find((entry) => entry.id === frame.localPlayerId);
    if (!player || (!player.fallingOut && (!player.alive || player.respawning))) {
      return;
    }

    if (this.lookYaw === null) {
      this.lookYaw = getYawFromPlanarVector(player.facing);
      this.lookPitch = aimCameraConfig.defaultPitch;
      this.speedBlend = 0;
      this.hasInitializedRuntimeCamera = false;
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

    const initialAimState = getAimRigState(
      player.position,
      this.lookYaw ?? getYawFromPlanarVector(player.facing),
      this.lookPitch,
      this.speedBlend
    );
    const forwardSpeedRatio = getForwardSpeedRatio(player.velocity, initialAimState.planarForward, 6);
    const targetSpeedBlend = getSpeedCameraBlend(forwardSpeedRatio);
    this.speedBlend = dampScalar(this.speedBlend, targetSpeedBlend, 7, delta);

    const aimState = getAimRigState(
      player.position,
      this.lookYaw ?? getYawFromPlanarVector(player.facing),
      this.lookPitch,
      this.speedBlend
    );
    this.desiredLookTarget.set(aimState.aimTarget.x, aimState.aimTarget.y, aimState.aimTarget.z);
    this.desiredCameraPosition.set(aimState.cameraPosition.x, aimState.cameraPosition.y, aimState.cameraPosition.z);

    if (!this.hasInitializedRuntimeCamera) {
      this.hasInitializedRuntimeCamera = true;
      this.currentLookTarget.copy(this.desiredLookTarget);
      this.camera.position.copy(this.desiredCameraPosition);
      this.camera.lookAt(this.currentLookTarget);
      this.cameraForward = getPlanarForwardBetweenPoints(this.camera.position, this.currentLookTarget);
      return;
    }

    const positionDamping = 1 - Math.exp(-delta * (chaseCameraConfig.positionDamping + 3));
    const lookTargetDamping = 1 - Math.exp(-delta * (chaseCameraConfig.lookTargetDamping + 3));
    const rising = player.velocity.y > 0 && this.desiredCameraPosition.y > this.camera.position.y;
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

  private updateFocusedTarget() {
    this.focusRaycaster.setFromCamera(this.centerRay, this.camera);
    const intersections = this.focusRaycaster.intersectObjects([this.terrainGroup], true);
    const firstHit = intersections[0];
    if (!firstHit) {
      this.focusedTarget = null;
      this.updateFocusedTargetVisuals();
      return;
    }

    const worldNormal = getWorldNormalFromIntersection(firstHit);
    const terrainHit = resolveTerrainRaycastHit(firstHit.point, worldNormal);
    if (!terrainHit) {
      this.focusedTarget = null;
      this.updateFocusedTargetVisuals();
      return;
    }

    this.focusedTarget = {
      voxel: terrainHit.voxel,
      normal: terrainHit.normal
    };
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
    const focusState = this.getAuthoritativeFocusedTargetState();
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
      [this.terrainGroup, this.propsGroup, this.clustersGroup],
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

  private sendRuntimeInput(localPlayer: RuntimePlayerState | null = this.getLocalRuntimePlayer()) {
    if (!isRuntimeMode(this.mode) || !this.pointerLocked) {
      return;
    }

    const spaceChallenge = this.getLocalSpaceChallengeState();
    const nextCommand = buildPlayerCommand(this.keyboardState, this.cameraForward);
    nextCommand.destroy = this.destroyQueued && this.focusedTarget !== null;
    nextCommand.place = nextCommand.place && this.focusedTarget !== null;
    nextCommand.layEgg = this.eggChargeState.pendingThrow || this.quickEggQueued;
    nextCommand.eggCharge = this.eggChargeState.pendingThrow ? this.eggChargeState.pendingThrowCharge : 0;
    nextCommand.eggPitch = this.eggChargeState.pendingThrow
      ? this.eggChargeState.pendingThrowPitch
      : this.quickEggQueued
        ? this.quickEggPitch
        : 0;
    nextCommand.targetVoxel = this.focusedTarget?.voxel ?? null;
    nextCommand.targetNormal = this.focusedTarget?.normal ?? null;
    nextCommand.typedText = this.pendingTypedText;

    if (spaceChallenge?.phase === "typing") {
      nextCommand.jump = false;
      nextCommand.jumpPressed = false;
      nextCommand.jumpReleased = false;
    }

    this.destroyQueued = false;
    this.quickEggQueued = false;
    this.quickEggPitch = 0;
    this.pendingTypedText = "";
    this.eggChargeState.pendingThrow = false;
    this.eggChargeState.pendingThrowCharge = 0;
    this.eggChargeState.pendingThrowPitch = 0;

    const buffer = packRuntimeInputCommand({
      seq: this.inputSequence,
      ...nextCommand
    });
    this.inputSequence += 1;
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
      return;
    }

    const localPlayer = frame.localPlayerId
      ? frame.players.find((player) => player.id === frame.localPlayerId) ?? null
      : null;
    this.syncLocalSpaceChallengeState();
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
  }

  private syncPlayers(players: RuntimePlayerState[], localPlayerId: string | null, delta: number, elapsedTime: number) {
    const seen = new Set<string>();
    const horizontalDamping = 1 - Math.exp(-delta * 10);

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

      seen.add(player.id);
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
        this.localSpaceChallengePhrase &&
        this.localSpaceChallengePhrase.length > 0
      ) {
        const typingProgress = THREE.MathUtils.clamp(
          this.localSpaceChallengeTypedLength / this.localSpaceChallengePhrase.length,
          0,
          1
        );
        const primeAlpha = THREE.MathUtils.clamp(
          (this.spaceTypePrimeUntil - elapsedTime) / SPACE_TYPING_PRIME_DURATION,
          0,
          1
        );
        const misfireAlpha = THREE.MathUtils.clamp(
          (this.spaceTypeMisfireUntil - elapsedTime) / SPACE_TYPING_MISFIRE_DURATION,
          0,
          1
        );
        const misfireWobble = Math.sin(elapsedTime * 30 + visual.motionSeed * 8) * 0.08 * misfireAlpha;
        visual.shell.rotation.x += typingProgress * 0.4 + primeAlpha * 0.18 - misfireAlpha * 0.04;
        visual.shell.rotation.z += typingProgress * 0.05 + primeAlpha * 0.08 + misfireWobble;
        visual.body.rotation.y += typingProgress * 0.08 + primeAlpha * 0.16 - misfireAlpha * 0.2;
        visual.avatar.position.z -= typingProgress * 0.16 + primeAlpha * 0.08;
        visual.avatar.position.y += primeAlpha * 0.08;
        visual.avatar.rotation.x += typingProgress * 0.12 + primeAlpha * 0.1;
        visual.shell.scale.set(
          visual.shell.scale.x * (1 + typingProgress * 0.02 + primeAlpha * 0.08),
          visual.shell.scale.y * (1 - typingProgress * 0.1 - primeAlpha * 0.12 + misfireAlpha * 0.04),
          visual.shell.scale.z * (1 + typingProgress * 0.03 + primeAlpha * 0.08)
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
