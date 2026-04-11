/// <reference lib="webworker" />

import * as THREE from "three";
import {
  DEFAULT_CHUNK_SIZE,
  MutableVoxelWorld,
  createDefaultArenaMap,
  getMapPropVoxels,
  normalizeArenaBudgetMapDocument,
  type MapDocumentV1,
  type MapProp
} from "@out-of-bounds/map";
import {
  defaultSimulationConfig,
  getEggChargeAlpha,
  getEggTrajectoryPosition,
  getGroundedEggLaunchVelocity,
  getHudEggStatus,
  OutOfBoundsSimulation,
  type GameMode,
  type GameplayEventBatch,
  type RuntimeEggState,
  type RuntimePlayerState,
  type RuntimeSkyDropState,
  type FallingClusterViewState,
  type SimulationInitialSpawnStyle,
  type SimulationPlayerSpawnOverride,
  type SimulationPerformanceDiagnostics,
  type TerrainDeltaBatch
} from "@out-of-bounds/sim";
import {
  getChickenPalette,
  type ChickenPaletteName
} from "../game/colors";
import {
  aimCameraConfig,
  applyFreeLookDelta,
  chaseCameraConfig,
  dampScalar,
  getAimRigState,
  getForwardSpeedRatio,
  getLookDirection,
  getPlanarForwardBetweenPoints,
  getPlanarVectorFromYaw,
  getSpaceAimRigState,
  getSpeedCameraBlend,
  getYawFromPlanarVector,
  clampLookPitch,
  clampSpaceLookPitch,
  spaceCameraConfig,
  stepAngleToward
} from "../game/camera";
import { createChickenAvatarRig, type ChickenAvatarRig } from "../game/chickenModel";
import { getPlayerBlobShadowState } from "../game/cheapShadows";
import {
  cloudPresets,
  getVoxelCloudPosition,
  type VoxelCloudPreset
} from "../game/clouds";
import {
  buildPlayerCommand,
  initialKeyboardInputState,
  type KeyboardInputState
} from "../game/input";
import { eggVisualDefaults, getEggVisualState } from "../game/eggs";
import { eggBaseGeometry, eggCapGeometry, eggMiddleGeometry } from "../game/eggVisualRecipe";
import { getFallingClusterVisualState } from "../game/fallingClusters";
import {
  buildSkyBirdFlock,
  getSkyBirdPose,
  type SkyBirdPreset
} from "../game/birds";
import {
  configureDynamicInstancedMesh,
  finalizeDynamicInstancedMesh,
  finalizeStaticInstancedMesh
} from "../game/instancedMeshes";
import { getRendererQualityProfileForTier, type QualityTier } from "../game/quality";
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
import { propFxTextures, propMaterials } from "../game/propMaterials";
import {
  chickenModelRig,
  createChickenMaterialBundle,
  disposeChickenMaterialBundle,
  fallingClusterMaterialsByProfile,
  playerRingGeometry,
  playerShadowGeometry,
  skyBirdBodyGeometry,
  skyBirdHeadGeometry,
  skyBirdMaterial as sharedSkyBirdMaterial,
  skyDropWarningBeamGeometry,
  skyDropWarningRingGeometry,
  skyBirdWingGeometry,
  type ChickenMaterialBundle
} from "../game/sceneAssets";
import { getSkyDropVisualState } from "../game/skyDrops";
import {
  SPACE_BLEND_DAMPING,
  buildVoxelPlanetMatrices,
  createSpaceStarGeometry,
  dayFogColor,
  daySkyColor,
  daySkyColorHex,
  spaceFogColor,
  spacePlanetDescriptors,
  spaceSkyColor
} from "../game/spaceBackdrop";
import { raycastVoxelWorld, resolveTerrainRaycastHit } from "../game/terrainRaycast";
import { meshTerrainChunk } from "../game/terrainMesher";
import { SunShadows, syncDirectionalLightSunLayer } from "../game/sunShadows";
import {
  getBlockRenderProfile,
  getTerrainChunkMaterials,
  getVoxelMaterials,
  sharedVoxelGeometry,
  type BlockRenderProfile,
  updateVoxelMaterialAnimation
} from "../game/voxelMaterials";
import {
  createBurningTreeFxState,
  createPropRemainsState,
  getEggScatterDebrisVisualState,
  getBurningTreeActiveVoxelIndices,
  getBurningTreeVoxelVisualState,
  getPropRemainsDuration,
  getPropRemainsFragmentState,
  type BurningTreeFxState,
  type PropRemainsState,
  type PropShatterMaterialKey,
  type VoxelBurstParticleBucket,
  getVoxelBurstMaterialProfile,
  getVoxelBurstParticleCount,
  getVoxelBurstParticleState,
  getVoxelBurstShockwaveState
} from "../game/voxelFx";
import {
  createWaterfallVisual,
  disposeWaterfallVisual,
  syncWaterfallVisual,
  type WaterfallVisual
} from "../game/waterfalls";
import {
  createDefaultRuntimeControlSettings,
  normalizeRuntimeControlSettings,
  type RuntimeControlSettings
} from "../game/runtimeControlSettings";
import {
  createEmptyRuntimeInputCommand,
  packRuntimeInputCommand,
  type RuntimeInputCommand
} from "./runtimeInput";
import type {
  WorkerRequestMessage,
  WorkerResponseMessage,
  SourceWorkerResponseMessage
} from "./protocol";
import type {
  ActiveShellMode,
  EditorPanelState,
  GameDiagnostics,
  GameRenderDiagnostics,
  PortalSceneConfig,
  PortalSceneDescriptor,
  PortalTraversalSnapshot,
  RuntimeRenderFrame as EngineRuntimeRenderFrame,
  RuntimeCaptureMode,
  ShellPresentation,
  TerrainChunkPatchPayload
} from "./types";

const workerScope = self as DedicatedWorkerGlobalScope & {
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame?: (handle: number) => void;
};

const EMPTY_DIAGNOSTICS: SimulationPerformanceDiagnostics = {
  skyDropUpdateMs: 0,
  skyDropLandingMs: 0,
  detachedComponentMs: 0,
  fallingClusterLandingMs: 0,
  fixedStepMaxStepsPerFrame: 0,
  fixedStepClampedFrames: 0,
  fixedStepDroppedMs: 0
};

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
const hashString = (value: string) => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33 + value.charCodeAt(index)) >>> 0;
  }

  return hash;
};
const emitterSeed = (index: number, propId: string) =>
  hashString(`${propId}:burn-particle:${index}`) * 0.000001;
const MAX_FIXED_STEPS_PER_FRAME = 5;
const MAX_FRAME_DELTA_SECONDS = 0.1;
const MULTIPLAYER_INPUT_INTERVAL_SECONDS = 1 / 20;
const EGG_FUSE_DURATION = defaultSimulationConfig.eggFuseDuration;
const EGG_COST = defaultSimulationConfig.eggCost;
const MAX_ACTIVE_EGGS_PER_PLAYER = defaultSimulationConfig.maxActiveEggsPerPlayer;
const MIN_GROUNDED_EGG_CHARGE = 0.18;
const INPUT_HOLD_THRESHOLD = 0.16;
const EGG_TRAJECTORY_MAX_POINTS = 56;
const EGG_TRAJECTORY_TIME_STEP = 0.05;
const EGG_TRAJECTORY_MAX_DURATION = 2.55;
const PRIMARY_POINTER_BUTTON = 0;
const SECONDARY_POINTER_BUTTON = 2;
const DOUBLE_TAP_WINDOW_MS = 220;
const isRuntimeMode = (mode: ActiveShellMode) =>
  mode === "explore" || mode === "playNpc" || mode === "multiplayer";

const requestWorkerAnimationFrame = (callback: FrameRequestCallback) =>
  typeof workerScope.requestAnimationFrame === "function"
    ? workerScope.requestAnimationFrame(callback)
    : workerScope.setTimeout(() => callback(now()), 16);

const cancelWorkerAnimationFrame = (handle: number) => {
  if (typeof workerScope.cancelAnimationFrame === "function") {
    workerScope.cancelAnimationFrame(handle);
    return;
  }

  workerScope.clearTimeout(handle);
};

const createEditorWorld = (document: MapDocumentV1) => {
  const world = new MutableVoxelWorld(normalizeArenaBudgetMapDocument(document));
  world.settleDetachedComponents();
  return world;
};

const createDefaultEditorState = (world: MutableVoxelWorld): EditorPanelState => ({
  mapName: world.meta.name,
  tool: "add",
  blockKind: "ground",
  propKind: "tree-oak",
  featureKind: "waterfall",
  featureDirection: "west"
});

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

const buildChunkPatch = (world: MutableVoxelWorld, key: string): TerrainChunkPatchPayload => {
  const chunk = world.buildVisibleChunkByKey(key, DEFAULT_CHUNK_SIZE);
  if (!chunk) {
    return {
      key,
      position: [0, 0, 0],
      materialGroups: [],
      visibleVoxelCount: 0,
      triangleCount: 0,
      drawCallCount: 0,
      remove: true
    };
  }

  const meshData = meshTerrainChunk(chunk);
  return {
    key,
    position: [meshData.chunkOffset.x, meshData.chunkOffset.y, meshData.chunkOffset.z],
    materialGroups: meshData.materialGroups.map((group) => ({
      materialIndex: group.materialIndex,
      start: group.start,
      count: group.count
    })),
    visibleVoxelCount: meshData.visibleVoxelCount,
    triangleCount: meshData.triangleCount,
    drawCallCount: meshData.drawCallCount,
    positions: new Float32Array(meshData.positions),
    normals: new Float32Array(meshData.normals),
    uvs: new Float32Array(meshData.uvs),
    colors: new Float32Array(meshData.colors),
    indices: new Uint32Array(meshData.indices)
  };
};

const createLocalRuntimeFrame = (runtime: OutOfBoundsSimulation): EngineRuntimeRenderFrame => {
  const matchState = runtime.getMatchState();
  return {
    tick: matchState.tick,
    time: matchState.time,
    mode: matchState.mode,
    localPlayerId: matchState.localPlayerId,
    hudState: runtime.getHudState(),
    focusState: runtime.getRuntimeInteractionFocusState(null, null, matchState.localPlayerId),
    authoritative: {
      state: runtime.getAuthoritativeMatchState(matchState.localPlayerId),
      terrainDeltaBatch: runtime.consumeTerrainDeltaBatch(),
      gameplayEventBatch: runtime.consumeGameplayEventBatch()
    },
    players: runtime
      .getPlayerIds()
      .map((playerId) => runtime.getPlayerRuntimeState(playerId))
      .filter((player): player is RuntimePlayerState => player !== null),
    eggs: runtime
      .getEggIds()
      .map((eggId) => runtime.getEggRuntimeState(eggId))
      .filter((egg): egg is RuntimeEggState => egg !== null),
    eggScatterDebris: runtime.getEggScatterDebris(),
    burningProps: runtime.getBurningProps(),
    voxelBursts: runtime.getVoxelBursts(),
    skyDrops: runtime.getSkyDrops(),
    fallingClusters: runtime.getFallingClusters()
  };
};

const getWorldNormalFromIntersection = (intersection: THREE.Intersection<THREE.Object3D>) => {
  const faceNormal = intersection.face?.normal.clone();
  if (!faceNormal) {
    return null;
  }

  faceNormal.transformDirection(intersection.object.matrixWorld);
  return faceNormal;
};

const resolveFixedStepCatchUp = (
  accumulator: number,
  delta: number,
  step: number
) => {
  const boundedDelta = Math.min(delta, MAX_FRAME_DELTA_SECONDS);
  const nextAccumulator = accumulator + boundedDelta;
  const availableSteps = Math.floor(nextAccumulator / step);

  if (availableSteps <= MAX_FIXED_STEPS_PER_FRAME) {
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
    droppedMs: (availableSteps - MAX_FIXED_STEPS_PER_FRAME) * step * 1000,
    clamped: true,
    stepsToRun: MAX_FIXED_STEPS_PER_FRAME
  };
};

interface EggDisplayVisual {
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
  materials: THREE.MeshStandardMaterial[];
}

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

interface CloudVisual {
  group: THREE.Group;
  preset: VoxelCloudPreset;
}

interface SkyBirdVisual {
  group: THREE.Group;
  leftWing: THREE.Mesh;
  rightWing: THREE.Mesh;
  preset: SkyBirdPreset;
}

interface SpacePlanetVisual {
  group: THREE.Group;
  materials: THREE.MeshBasicMaterial[];
  spinSpeed: number;
  wobblePhase: number;
}

interface DynamicOpacityMeshResource {
  geometry: THREE.BufferGeometry;
  materials: THREE.Material[];
  mesh: THREE.InstancedMesh;
  opacityAttribute: THREE.InstancedBufferAttribute;
}

interface BurningTreeFlameEmitter {
  currentFrame: number;
  group: THREE.Group;
  material: THREE.MeshBasicMaterial;
  quads: THREE.Mesh[];
  seed: number;
}

type PropVoxelMesh = THREE.Mesh & {
  userData: {
    burningMaterial: THREE.MeshStandardMaterial | null;
    localPosition: THREE.Vector3;
    voxelKind: "wood" | "leaves";
  };
};

interface PropVisual {
  prop: MapProp;
  center: THREE.Vector3;
  burningFxState: BurningTreeFxState | null;
  flameEmitters: BurningTreeFlameEmitter[];
  group: THREE.Group;
  voxelMeshes: PropVoxelMesh[];
  emberMeshes: THREE.Mesh[];
  emberMaterial: THREE.MeshBasicMaterial | null;
  smokeMeshes: THREE.Mesh[];
  smokeMaterial: THREE.MeshBasicMaterial | null;
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

interface PortalVisual {
  descriptor: PortalSceneDescriptor;
  fillMaterial: THREE.MeshBasicMaterial;
  group: THREE.Group;
  materials: THREE.Material[];
  signMaterial: THREE.MeshBasicMaterial;
  signTexture: THREE.Texture | null;
}

interface PortalTriggerState {
  armed: boolean;
  descriptor: PortalSceneDescriptor;
  playerInside: boolean;
}

const AVATAR_TURN_SPEED = 4.5;
const AVATAR_BOB_BASE_Y = 0.74;
const PLAYER_DETAIL_DISTANCE = 18;
const MULTIPLAYER_SPECTATOR_CAMERA_SPEED = 16;
const SUPER_BOOM_BOMB_SCALE = 2;
const EGG_SCATTER_ARC_HEIGHT = 2.4;
const MAX_EGG_SCATTER_INSTANCES_PER_PROFILE = 64;
const MAX_HARVEST_BURST_INSTANCES_PER_PROFILE = 128;
const MAX_EGG_EXPLOSION_BURST_INSTANCES = 1024;
const MAX_EGG_EXPLOSION_ACCENT_INSTANCES = 512;
const MAX_EGG_EXPLOSION_SHOCKWAVE_INSTANCES = 32;
const BURNING_TREE_STANDING_DURATION = 15;
const MAX_BURNING_PROP_FLAME_EMITTERS = 18;
const MAX_BURNING_PROP_EMBER_PARTICLES = 30;
const MAX_BURNING_PROP_SMOKE_PARTICLES = 36;
const MAX_PROP_REMAINS_INSTANCES_PER_MATERIAL = 4096;
const MAX_PROP_REMAINS_EMBER_INSTANCES = 768;
const MAX_PROP_REMAINS_SMOKE_INSTANCES = 1024;
const MAX_PROP_REMAINS_FLAME_INSTANCES = 896;
const MAX_TRACKED_PROP_DELTA_KEYS = 1024;
const RECENT_EXPLOSION_IMPACT_WINDOW_SECONDS = 2.8;
const voxelFxProfiles = ["earthSurface", "earthSubsoil", "darkness"] as const satisfies readonly BlockRenderProfile[];
const propRemainsMaterialEntries = [
  ["bark", propMaterials.bark],
  ["leavesOak", propMaterials.leavesOak],
  ["leavesPine", propMaterials.leavesPine],
  ["leavesAutumn", propMaterials.leavesAutumn]
] as const satisfies readonly [PropShatterMaterialKey, THREE.Material][];
const cloudGeometry = new THREE.BoxGeometry(1.6, 0.9, 1.6);
const flameCardGeometry = new THREE.PlaneGeometry(0.92, 1.24);
const portalFrameSideGeometry = new THREE.BoxGeometry(0.28, 4.2, 0.4);
const portalFrameLintelGeometry = new THREE.BoxGeometry(2.7, 0.28, 0.4);
const portalThresholdGeometry = new THREE.BoxGeometry(2.7, 0.18, 0.55);
const portalFillGeometry = new THREE.PlaneGeometry(2.1, 3.6);
const portalHaloGeometry = new THREE.PlaneGeometry(2.45, 3.95);
const portalSignGeometry = new THREE.PlaneGeometry(3.25, 0.84);
const cloudTempObject = new THREE.Object3D();
const voxelFxTempObject = new THREE.Object3D();
const clusterTempObject = new THREE.Object3D();
const portalTempColor = new THREE.Color();

interface RecentExplosionImpact {
  position: { x: number; y: number; z: number };
  time: number;
}

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
    (cube.tone === "shade" ? shadeMatrices : mainMatrices).push(
      cloudTempObject.matrix.clone()
    );
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
  const materialSet = (Array.isArray(materials) ? materials : [materials]).map((material) =>
    patchInstancedOpacityMaterial(material)
  );
  const mesh = new THREE.InstancedMesh(
    geometry,
    Array.isArray(materials) ? materialSet : materialSet[0]!,
    Math.max(1, capacity)
  );
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

const getPortalYaw = (facing: PortalSceneDescriptor["facing"]) => {
  switch (facing) {
    case "north":
      return Math.PI;
    case "south":
      return 0;
    case "east":
      return -Math.PI / 2;
    case "west":
      return Math.PI / 2;
  }
};

const portalDescriptorsMatch = (
  left: PortalSceneDescriptor,
  right: PortalSceneDescriptor
) =>
  left.id === right.id &&
  left.label === right.label &&
  left.variant === right.variant &&
  left.facing === right.facing &&
  left.armed === right.armed &&
  left.triggerRadius === right.triggerRadius &&
  left.triggerHalfHeight === right.triggerHalfHeight &&
  left.anchor.x === right.anchor.x &&
  left.anchor.y === right.anchor.y &&
  left.anchor.z === right.anchor.z;

const createPortalLabelTexture = (label: string) => {
  if (typeof OffscreenCanvas === "undefined") {
    return null;
  }

  const canvas = new OffscreenCanvas(512, 144);
  const context = canvas.getContext("2d");
  if (!context) {
    return null;
  }

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#120d07";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = "#f4c769";
  context.lineWidth = 12;
  context.strokeRect(8, 8, canvas.width - 16, canvas.height - 16);
  context.fillStyle = "#fff7df";
  context.font = "700 54px sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(label, canvas.width / 2, canvas.height / 2 + 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
};

const createPortalVisual = (descriptor: PortalSceneDescriptor) => {
  const frameMaterial = new THREE.MeshStandardMaterial({
    color: descriptor.variant === "exit" ? "#7f5a28" : "#533b22",
    emissive: descriptor.variant === "exit" ? "#f29b38" : "#6dc4ff",
    emissiveIntensity: 0.2,
    roughness: 0.62,
    metalness: 0.16
  });
  const fillMaterial = new THREE.MeshBasicMaterial({
    color: descriptor.variant === "exit" ? "#ffbf64" : "#83e0ff",
    transparent: true,
    opacity: descriptor.armed ? 0.86 : 0.28,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false
  });
  const haloMaterial = new THREE.MeshBasicMaterial({
    color: descriptor.variant === "exit" ? "#fff1c7" : "#c6f5ff",
    transparent: true,
    opacity: descriptor.armed ? 0.26 : 0.08,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false
  });
  const signTexture = createPortalLabelTexture(descriptor.label);
  const signMaterial = new THREE.MeshBasicMaterial({
    color: "#fff7df",
    map: signTexture,
    transparent: signTexture !== null,
    toneMapped: false
  });

  const group = new THREE.Group();
  group.position.set(descriptor.anchor.x, descriptor.anchor.y, descriptor.anchor.z);
  group.rotation.y = getPortalYaw(descriptor.facing);

  const leftFrame = new THREE.Mesh(portalFrameSideGeometry, frameMaterial);
  leftFrame.position.set(-1.34, 1.92, 0);
  const rightFrame = new THREE.Mesh(portalFrameSideGeometry, frameMaterial);
  rightFrame.position.set(1.34, 1.92, 0);
  const lintel = new THREE.Mesh(portalFrameLintelGeometry, frameMaterial);
  lintel.position.set(0, 3.94, 0);
  const threshold = new THREE.Mesh(portalThresholdGeometry, frameMaterial);
  threshold.position.set(0, 0.09, 0.06);
  const fill = new THREE.Mesh(portalFillGeometry, fillMaterial);
  fill.position.set(0, 1.92, 0.02);
  const halo = new THREE.Mesh(portalHaloGeometry, haloMaterial);
  halo.position.set(0, 1.92, -0.04);
  const sign = new THREE.Mesh(portalSignGeometry, signMaterial);
  sign.position.set(0, 5.15, 0.04);

  leftFrame.castShadow = true;
  rightFrame.castShadow = true;
  lintel.castShadow = true;
  threshold.castShadow = true;
  sign.renderOrder = 18;
  fill.renderOrder = 14;
  halo.renderOrder = 13;

  group.add(leftFrame, rightFrame, lintel, threshold, halo, fill, sign);

  return {
    descriptor,
    fillMaterial,
    group,
    materials: [frameMaterial, fillMaterial, haloMaterial, signMaterial],
    signMaterial,
    signTexture
  } satisfies PortalVisual;
};

const finalizeDynamicOpacityMesh = (resource: DynamicOpacityMeshResource | null, count: number) => {
  if (!resource) {
    return;
  }

  resource.opacityAttribute.needsUpdate = true;
  finalizeDynamicInstancedMesh(resource.mesh, count);
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

const createEggDisplayVisual = () => {
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
  } satisfies EggDisplayVisual;
};

const createSkyBirdVisual = (
  preset: SkyBirdPreset,
  worldSize: { x: number; y: number; z: number },
  material: THREE.MeshBasicMaterial
) => {
  const initialPose = getSkyBirdPose(preset, 0, worldSize);
  const group = new THREE.Group();
  const body = new THREE.Mesh(skyBirdBodyGeometry, material);
  const head = new THREE.Mesh(skyBirdHeadGeometry, material);
  const leftWing = new THREE.Mesh(skyBirdWingGeometry, material);
  const rightWing = new THREE.Mesh(skyBirdWingGeometry, material);

  head.position.set(0, 0.02, 0.22);
  leftWing.position.set(-0.38, 0, -0.02);
  rightWing.position.set(0.38, 0, -0.02);

  group.position.set(
    initialPose.position.x,
    initialPose.position.y,
    initialPose.position.z
  );
  group.rotation.y = initialPose.yaw;
  group.add(body, head, leftWing, rightWing);

  return {
    group,
    leftWing,
    rightWing,
    preset
  } satisfies SkyBirdVisual;
};

const createPlayerVisual = (
  playerId: string,
  matchColorSeed: number,
  preferredPaletteName: ChickenPaletteName | null = null
) => {
  const palette = getChickenPalette(playerId, matchColorSeed, preferredPaletteName);
  const materialBundle = createChickenMaterialBundle(palette);
  const motionSeed = getChickenMotionSeed(playerId);
  const bomb = createEggDisplayVisual();
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

const disposePortalVisual = (visual: PortalVisual) => {
  for (const material of visual.materials) {
    material.dispose();
  }
  visual.signTexture?.dispose();
};

const cloneFallingClusterMaterialSet = (profile: BlockRenderProfile) =>
  fallingClusterMaterialsByProfile[profile].map((material) => material.clone());

export const summarizeFrameSamples = (
  frameSamples: Float32Array,
  sampleCount: number
) => {
  if (sampleCount <= 0) {
    return {
      fps: 0,
      p95FrameMs: 0
    };
  }

  const samples = Array.from(frameSamples.slice(0, sampleCount));
  const averageFrameMs =
    samples.reduce((sum, sample) => sum + sample, 0) / samples.length;
  const sortedSamples = [...samples].sort((left, right) => left - right);
  const p95FrameMs =
    sortedSamples[Math.max(0, Math.floor(sortedSamples.length * 0.95) - 1)] ?? 0;

  return {
    fps: averageFrameMs > 0 ? 1000 / averageFrameMs : 0,
    p95FrameMs
  };
};

export class WorkerGameRuntime {
  private mode: ActiveShellMode = "editor";
  private presentation: ShellPresentation = "default";
  private qualityTier: QualityTier = "medium";
  private runtimeSettings: RuntimeControlSettings = createDefaultRuntimeControlSettings();
  private localPlayerName = "You";
  private localPlayerPaletteName: ChickenPaletteName | null = null;
  private initialSpawnStyle: SimulationInitialSpawnStyle = "ground";
  private localPlayerSpawnOverride: SimulationPlayerSpawnOverride | null = null;
  private captureMode: RuntimeCaptureMode = "locked";
  private portalScene: PortalSceneConfig | null = null;
  private portalTraversalPending = false;
  private matchColorSeed = 0;

  private offscreenCanvas: OffscreenCanvas | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(40, 1, 0.1, 800);
  private readonly sceneFog = new THREE.Fog(daySkyColorHex, 36, 80);
  private readonly sceneBackgroundColor = daySkyColor.clone();
  private clock = new THREE.Clock();
  private animationFrameId: number | null = null;
  private readyToDisplayPending = false;
  private hasRenderedFrame = false;

  private viewportWidth = 1;
  private viewportHeight = 1;
  private devicePixelRatio = 1;

  private editorWorld = createEditorWorld(createDefaultArenaMap());
  private editorState = createDefaultEditorState(this.editorWorld);
  private runtime = new OutOfBoundsSimulation();
  private runtimePaused = true;
  private runtimeAccumulator = 0;
  private lastRuntimeTerrainRevision = 0;
  private latestRuntimeDiagnostics: SimulationPerformanceDiagnostics = { ...EMPTY_DIAGNOSTICS };
  private latestRuntimeFrame: EngineRuntimeRenderFrame | null = null;
  private latestDirtyChunkCount = 0;

  private currentDocument = normalizeArenaBudgetMapDocument(createDefaultArenaMap());
  private runtimeWorld = new MutableVoxelWorld(this.currentDocument);
  private latestExternalFrame: EngineRuntimeRenderFrame | null = null;

  private pointerLocked = false;
  private pendingLookDeltaX = 0;
  private pendingLookDeltaY = 0;
  private lookYaw: number | null = null;
  private lookPitch = aimCameraConfig.defaultPitch;
  private readonly currentLookTarget = new THREE.Vector3();
  private readonly desiredLookTarget = new THREE.Vector3();
  private readonly desiredCameraPosition = new THREE.Vector3();
  private speedBlend = 0;
  private hasInitializedRuntimeCamera = false;
  private runtimeCameraUsingSpaceRig = false;
  private hasInitializedSpectatorCamera = false;
  private forwardTapReleased = true;
  private lastForwardTapAtMs = Number.NEGATIVE_INFINITY;
  private destroyHeld = false;
  private pushQueued = false;
  private pendingTypedText = "";
  private quickEggQueued = false;
  private quickEggPitch = 0;
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
  private keyboardState: KeyboardInputState = { ...initialKeyboardInputState };
  private inputSequence = 0;
  private lastMultiplayerInputSentAt = Number.NEGATIVE_INFINITY;
  private focusedTarget: {
    voxel: { x: number; y: number; z: number };
    normal: { x: number; y: number; z: number };
  } | null = null;
  private spaceBlend = 0;
  private baseFogNear = 36;
  private baseFogFar = 80;
  private lastWorldSceneSizeKey = "";
  private lastGroundPlaneSizeKey = "";

  private readonly cloudsGroup = new THREE.Group();
  private readonly skyBirdsGroup = new THREE.Group();
  private readonly spaceBackdropGroup = new THREE.Group();
  private readonly terrainGroup = new THREE.Group();
  private readonly waterfallsGroup = new THREE.Group();
  private readonly portalsGroup = new THREE.Group();
  private readonly propsGroup = new THREE.Group();
  private readonly playersGroup = new THREE.Group();
  private readonly eggsGroup = new THREE.Group();
  private readonly voxelFxGroup = new THREE.Group();
  private readonly skyDropsGroup = new THREE.Group();
  private readonly clustersGroup = new THREE.Group();
  private readonly terrainMeshes = new Map<string, THREE.Mesh>();
  private readonly terrainChunkStats = new Map<string, { drawCallCount: number; triangleCount: number }>();
  private readonly waterfallVisuals = new Map<string, WaterfallVisual>();
  private readonly cloudVisuals: CloudVisual[] = [];
  private readonly skyBirdVisuals: SkyBirdVisual[] = [];
  private readonly propVisuals = new Map<string, PropVisual>();
  private readonly playerVisuals = new Map<string, PlayerVisual>();
  private readonly eggVisuals = new Map<string, EggDisplayVisual>();
  private readonly eggScatterMeshes = new Map<BlockRenderProfile, THREE.InstancedMesh>();
  private readonly harvestBurstMeshes = new Map<BlockRenderProfile, DynamicOpacityMeshResource>();
  private readonly eggExplosionBurstMeshes = new Map<BlockRenderProfile, DynamicOpacityMeshResource>();
  private readonly propRemainsMeshes = new Map<PropShatterMaterialKey, DynamicOpacityMeshResource>();
  private readonly skyDropVisuals = new Map<string, SkyDropVisual>();
  private readonly clusterVisuals = new Map<string, ClusterVisual>();
  private readonly spacePlanetVisuals: SpacePlanetVisual[] = [];
  private readonly portalVisuals = new Map<string, PortalVisual>();
  private readonly portalTriggerStates = new Map<string, PortalTriggerState>();
  private readonly propRemainsStates = new Map<string, PropRemainsState>();
  private readonly processedPropDeltaKeys = new Set<string>();
  private readonly processedPropDeltaKeyOrder: string[] = [];
  private readonly recentExplosionImpacts: RecentExplosionImpact[] = [];
  private propRemainsEmberMesh: DynamicOpacityMeshResource | null = null;
  private readonly propRemainsFlameMeshes: DynamicOpacityMeshResource[] = [];
  private propRemainsSmokeMesh: DynamicOpacityMeshResource | null = null;
  private eggExplosionAccentBurstMesh: DynamicOpacityMeshResource | null = null;
  private eggExplosionShockwaveMesh: DynamicOpacityMeshResource | null = null;
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
  private readonly skyBirdMaterial = (() => {
    const material = sharedSkyBirdMaterial.clone();
    material.transparent = true;
    material.opacity = 1;
    return material;
  })();
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
  private readonly propGeometry = new THREE.BoxGeometry(1, 1, 1);
  private readonly groundPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 10),
    new THREE.MeshStandardMaterial({ color: "#102834" })
  );
  private readonly ambientLight = new THREE.AmbientLight("#ffffff", 0.45);
  private readonly directionalLight = new THREE.DirectionalLight("#fff7df", 1.36);
  private readonly hemisphereLight = new THREE.HemisphereLight("#fef7df", "#4c6156", 0.22);
  private readonly focusOutline = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1.04, 1.04, 1.04)),
    new THREE.LineBasicMaterial({ color: "#fff3c1" })
  );
  private readonly focusGhost = new THREE.Mesh(
    new THREE.BoxGeometry(1.002, 1.002, 1.002),
    new THREE.MeshStandardMaterial({
      color: "#89d6b2",
      transparent: true,
      opacity: 0.28
    })
  );
  private readonly eggTrajectoryPreview = createEggTrajectoryPreview(EGG_TRAJECTORY_MAX_POINTS);
  private readonly raycaster = new THREE.Raycaster();
  private readonly eggTrajectoryRaycaster = new THREE.Raycaster();
  private readonly pointerVector = new THREE.Vector2();
  private readonly runtimeRayOrigin = new THREE.Vector3();
  private readonly runtimeRayDirection = new THREE.Vector3();
  private cameraForward = { x: 1, z: 0 };
  private readonly sunShadows = new SunShadows(this.scene, this.camera, {} as THREE.WebGLRenderer);

  private readonly frameSamples = new Float32Array(180);
  private frameSampleCount = 0;
  private frameSampleIndex = 0;
  private diagnosticsCooldown = 0;
  private lastFrameTime = now();

  constructor(private readonly scope: DedicatedWorkerGlobalScope) {
    this.scene.background = this.sceneBackgroundColor;
    this.spaceStars.frustumCulled = false;
    this.spaceBackdropGroup.visible = false;
    this.spaceBackdropGroup.add(this.spaceStars);
    this.scene.add(this.spaceBackdropGroup);
    this.scene.add(this.cloudsGroup);
    this.scene.add(this.skyBirdsGroup);
    this.scene.add(this.terrainGroup);
    this.scene.add(this.waterfallsGroup);
    this.scene.add(this.portalsGroup);
    this.scene.add(this.propsGroup);
    this.scene.add(this.playersGroup);
    this.scene.add(this.eggsGroup);
    this.scene.add(this.voxelFxGroup);
    this.scene.add(this.skyDropsGroup);
    this.scene.add(this.clustersGroup);
    this.scene.add(this.ambientLight);
    this.scene.add(this.directionalLight);
    this.scene.add(this.hemisphereLight);
    this.scene.fog = this.sceneFog;
    this.scene.add(this.focusOutline);
    this.scene.add(this.focusGhost);
    this.scene.add(this.eggTrajectoryPreview.group);
    this.groundPlane.rotation.x = -Math.PI / 2;
    this.scene.add(this.groundPlane);
    this.focusOutline.visible = false;
    this.focusGhost.visible = false;
    this.ambientLight.intensity = 0.45;
    this.directionalLight.intensity = 1.36;
    this.hemisphereLight.intensity = 0.22;
    this.directionalLight.position.set(64, 92, 40);
    this.initVoxelFx();
    this.rebuildSkyLayers(this.currentDocument);
  }

  handleMessage(message: WorkerRequestMessage) {
    switch (message.type) {
      case "init":
        this.handleInit(message);
        return;
      case "set_mode":
        this.handleSetMode(message);
        return;
      case "resize":
        this.resize(message.viewportWidth, message.viewportHeight, message.devicePixelRatio);
        return;
      case "set_runtime_paused":
        this.runtimePaused = message.paused;
        if (message.paused) {
          this.clearRuntimeInputState();
        }
        this.postDiagnostics();
        return;
      case "set_editor_state":
        this.handleSetEditorState(message);
        return;
      case "load_map":
        this.editorWorld = createEditorWorld(message.document);
        this.editorState = {
          ...this.editorState,
          mapName: this.editorWorld.meta.name
        };
        if (this.mode === "editor") {
          this.applyFullWorld(this.editorWorld.toDocument(), this.buildFullTerrainPatches(this.editorWorld));
          this.postEditorState();
        }
        return;
      case "request_editor_document":
        this.post({
          type: "editor_document",
          requestId: message.requestId,
          document: this.getActiveWorldDocument()
        });
        return;
      case "perform_editor_action":
        this.applyEditorAction(message.voxel, message.normal);
        return;
      case "pointer_move":
        if (this.canAcceptRuntimeInput()) {
          this.pendingLookDeltaX += message.movementX;
          this.pendingLookDeltaY += message.movementY;
        }
        return;
      case "pointer_button":
        this.handlePointerButton(message);
        return;
      case "pointer_lock_change":
        this.pointerLocked = message.locked;
        if (!message.locked) {
          this.clearRuntimeInputState();
        }
        return;
      case "key_event":
        this.handleKeyEvent(message);
        return;
      case "external_message":
        this.handleExternalMessage(message.message);
        return;
    }
  }

  private handleInit(message: Extract<WorkerRequestMessage, { type: "init" }>) {
    this.mode = message.mode;
    this.presentation = message.presentation ?? this.presentation;
    this.qualityTier = message.qualityTier ?? this.qualityTier;
    this.runtimeSettings = normalizeRuntimeControlSettings(message.runtimeSettings);
    this.localPlayerName = message.localPlayerName?.trim() || "You";
    this.localPlayerPaletteName = message.localPlayerPaletteName ?? null;
    this.initialSpawnStyle = message.initialSpawnStyle ?? "ground";
    this.localPlayerSpawnOverride = message.localPlayerSpawnOverride ?? null;
    this.captureMode = message.captureMode ?? "locked";
    this.portalScene = message.portalScene ?? null;
    this.matchColorSeed = message.matchColorSeed ?? 0;
    this.editorWorld = createEditorWorld(message.document);
    this.editorState = createDefaultEditorState(this.editorWorld);
    this.currentDocument = normalizeArenaBudgetMapDocument(message.document);
    this.runtimeWorld = new MutableVoxelWorld(this.currentDocument);
    if (message.offscreenCanvas) {
      this.offscreenCanvas = message.offscreenCanvas;
      this.createRenderer();
    }
    this.resize(message.viewportWidth ?? this.viewportWidth, message.viewportHeight ?? this.viewportHeight, message.devicePixelRatio ?? this.devicePixelRatio);
    this.post({
      type: "ready",
      editorState: this.editorState
    });
    this.handleSetMode({
      type: "set_mode",
      mode: message.mode,
      presentation: message.presentation,
      qualityTier: message.qualityTier,
      runtimeSettings: message.runtimeSettings,
      localPlayerName: message.localPlayerName,
      localPlayerPaletteName: message.localPlayerPaletteName,
      initialSpawnStyle: message.initialSpawnStyle,
      localPlayerSpawnOverride: message.localPlayerSpawnOverride,
      captureMode: message.captureMode,
      portalScene: message.portalScene
    });
    this.ensureLoop();
  }

  private handleSetMode(message: Extract<WorkerRequestMessage, { type: "set_mode" }>) {
    this.mode = message.mode;
    this.presentation = message.presentation ?? this.presentation;
    this.qualityTier = message.qualityTier ?? this.qualityTier;
    this.runtimeSettings =
      message.runtimeSettings !== undefined
        ? normalizeRuntimeControlSettings(message.runtimeSettings)
        : this.runtimeSettings;
    this.localPlayerName = message.localPlayerName?.trim() || this.localPlayerName;
    this.localPlayerPaletteName =
      message.localPlayerPaletteName !== undefined
        ? message.localPlayerPaletteName
        : this.localPlayerPaletteName;
    this.initialSpawnStyle = message.initialSpawnStyle ?? this.initialSpawnStyle;
    this.localPlayerSpawnOverride =
      message.localPlayerSpawnOverride !== undefined
        ? message.localPlayerSpawnOverride ?? null
        : this.localPlayerSpawnOverride;
    this.captureMode = message.captureMode ?? this.captureMode;
    this.portalScene =
      message.portalScene !== undefined ? message.portalScene ?? null : this.portalScene;
    this.runtimePaused =
      this.mode === "editor"
        ? false
        : isRuntimeMode(this.mode)
          ? this.captureMode !== "free"
          : false;
    this.portalTraversalPending = false;
    this.pushQueued = false;
    this.pendingTypedText = "";
    this.quickEggQueued = false;
    this.quickEggPitch = 0;
    this.cancelEggCharge();
    this.activeEggKeyCodes.clear();
    this.resetHoldAction(this.eggKeyAction);
    this.resetHoldAction(this.eggPointerAction);
    this.pointerLocked = false;
    this.pendingLookDeltaX = 0;
    this.pendingLookDeltaY = 0;
    this.lookYaw = null;
    this.lookPitch = aimCameraConfig.defaultPitch;
    this.speedBlend = 0;
    this.hasInitializedRuntimeCamera = false;
    this.runtimeCameraUsingSpaceRig = false;
    this.hasInitializedSpectatorCamera = false;
    this.keyboardState = { ...initialKeyboardInputState };
    this.syncSunShadowMode();
    this.syncPortalScene();

    if (this.mode === "editor") {
      this.latestRuntimeFrame = null;
      this.latestExternalFrame = null;
      this.latestDirtyChunkCount = 0;
      this.applyFullWorld(this.editorWorld.toDocument(), this.buildFullTerrainPatches(this.editorWorld));
      this.postHudState(null);
      this.postEditorState();
      this.readyToDisplayPending = true;
      return;
    }

    if (this.mode === "multiplayer") {
      this.latestRuntimeFrame = null;
      this.latestDirtyChunkCount = 0;
      this.rebuildSkyLayers(this.currentDocument);
      this.readyToDisplayPending = true;
      return;
    }

    this.runtime.reset(this.mode as GameMode, this.editorWorld.toDocument(), {
      npcCount: this.mode === "playNpc" ? 9 : 0,
      localPlayerName: this.localPlayerName,
      initialSpawnStyle: this.initialSpawnStyle,
      localPlayerSpawnOverride: this.localPlayerSpawnOverride ?? undefined
    });
    this.runtimePaused = this.captureMode !== "free";
    this.runtimeAccumulator = 0;
    this.lastRuntimeTerrainRevision = this.runtime.getWorld().getTerrainRevision();
    this.latestRuntimeFrame = createLocalRuntimeFrame(this.runtime);
    this.applyFullWorld(this.runtime.getWorld().toDocument(), this.buildFullTerrainPatches(this.runtime.getWorld()));
    this.postHudState(this.latestRuntimeFrame.hudState);
    this.readyToDisplayPending = true;
  }

  private clearRuntimeInputState() {
    this.destroyHeld = false;
    this.pushQueued = false;
    this.pendingTypedText = "";
    this.quickEggQueued = false;
    this.quickEggPitch = 0;
    this.cancelEggCharge();
    this.activeEggKeyCodes.clear();
    this.resetHoldAction(this.eggKeyAction);
    this.resetHoldAction(this.eggPointerAction);
    this.keyboardState = { ...initialKeyboardInputState };
  }

  private hasActiveRuntimeCapture() {
    return this.captureMode === "free" || this.pointerLocked;
  }

  private canAcceptRuntimeInput() {
    return (
      isRuntimeMode(this.mode) &&
      this.presentation !== "menu" &&
      !this.runtimePaused &&
      this.hasActiveRuntimeCapture()
    );
  }

  private getCurrentFrame() {
    return this.mode === "multiplayer" ? this.latestExternalFrame : this.latestRuntimeFrame;
  }

  private getLocalRuntimePlayer() {
    const frame = this.getCurrentFrame();
    if (!frame?.localPlayerId) {
      return null;
    }

    return frame.players.find((player) => player.id === frame.localPlayerId) ?? null;
  }

  private getLocalEggStatus(localPlayer = this.getLocalRuntimePlayer()) {
    const frame = this.getCurrentFrame();
    return getHudEggStatus({
      localPlayerId: frame?.localPlayerId ?? null,
      localPlayerMass: localPlayer?.mass ?? 0,
      localPlayer,
      eggs: frame?.eggs ?? [],
      eggCost: EGG_COST,
      maxActiveEggsPerPlayer: MAX_ACTIVE_EGGS_PER_PLAYER,
      eggFuseDuration: EGG_FUSE_DURATION
    });
  }

  private canStartGroundEggCharge(
    localPlayer: RuntimePlayerState | null,
    eggStatus = this.getLocalEggStatus(localPlayer)
  ) {
    return localPlayer !== null && eggStatus.canChargedThrow;
  }

  private resetHoldAction(action: HoldActionState) {
    action.pressed = false;
    action.startedAt = 0;
    action.holdTriggered = false;
  }

  private queueQuickEgg(pitch = 0) {
    this.quickEggQueued = true;
    this.quickEggPitch = pitch;
  }

  private isEggChargeInputHeld() {
    return (
      (this.eggChargeState.source === "key" && this.eggKeyAction.pressed) ||
      (this.eggChargeState.source === "pointer" && this.eggPointerAction.pressed)
    );
  }

  private beginEggCharge(source: EggChargeInputSource) {
    this.eggChargeState.active = true;
    this.eggChargeState.startedAt = this.clock.getElapsedTime();
    this.eggChargeState.chargeAlpha = 0;
    this.eggChargeState.pendingThrow = false;
    this.eggChargeState.pendingThrowCharge = 0;
    this.eggChargeState.pendingThrowPitch = 0;
    this.eggChargeState.source = source;
  }

  private queueGroundEggThrow() {
    this.eggChargeState.active = false;
    this.eggChargeState.pendingThrow = true;
    this.eggChargeState.pendingThrowCharge = Math.max(
      MIN_GROUNDED_EGG_CHARGE,
      this.eggChargeState.chargeAlpha
    );
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

  private startEggPointerAction() {
    this.eggPointerAction.pressed = true;
    this.eggPointerAction.startedAt = this.clock.getElapsedTime();
    this.eggPointerAction.holdTriggered = false;
  }

  private releaseEggAction(action: HoldActionState, source: EggChargeInputSource) {
    if (!action.pressed) {
      return;
    }

    const localPlayer = this.getLocalRuntimePlayer();
    const eggStatus = this.getLocalEggStatus(localPlayer);
    const tappedQuickEgg = !action.holdTriggered && this.canAcceptRuntimeInput();

    if (this.eggChargeState.active && this.eggChargeState.source === source) {
      this.queueGroundEggThrow();
    } else if (tappedQuickEgg && eggStatus.canQuickEgg) {
      this.queueQuickEgg(localPlayer?.grounded ? this.lookPitch : 0);
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
    if (!this.canAcceptRuntimeInput()) {
      return;
    }

    if (!this.eggChargeState.active && this.canStartGroundEggCharge(localPlayer)) {
      this.beginEggCharge(source);
    }
  }

  private updateHoldToThrowState(localPlayer: RuntimePlayerState | null, elapsedTime: number) {
    this.updateHoldToThrowAction(this.eggKeyAction, "key", localPlayer, elapsedTime);
    this.updateHoldToThrowAction(this.eggPointerAction, "pointer", localPlayer, elapsedTime);
  }

  private updateEggChargeState(localPlayer: RuntimePlayerState | null, delta: number, elapsedTime: number) {
    this.eggChargeState.releaseRemaining = Math.max(0, this.eggChargeState.releaseRemaining - delta);

    if (!this.eggChargeState.active) {
      return;
    }

    if (
      !this.isEggChargeInputHeld() ||
      this.runtimePaused ||
      !this.hasActiveRuntimeCapture() ||
      !this.canStartGroundEggCharge(localPlayer)
    ) {
      this.cancelEggCharge(false);
      return;
    }

    this.eggChargeState.chargeAlpha = getEggChargeAlpha(
      elapsedTime - this.eggChargeState.startedAt,
      defaultSimulationConfig.eggChargeDuration
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

  private getVisibleTerrainRaycastRoots() {
    return this.terrainGroup.visible ? [this.terrainGroup] : [];
  }

  private updateEggLaunchPreview(localPlayer: RuntimePlayerState | null, elapsedTime: number) {
    if (
      localPlayer === null ||
      !this.eggChargeState.active ||
      this.runtimePaused ||
      !this.hasActiveRuntimeCapture() ||
      !this.canStartGroundEggCharge(localPlayer)
    ) {
      this.hideEggTrajectoryPreview();
      return;
    }

    const worldDocument = this.getActiveWorldDocument();
    const eggRadius = defaultSimulationConfig.eggRadius;
    const origin = {
      x: THREE.MathUtils.clamp(
        localPlayer.position.x + localPlayer.facing.x * defaultSimulationConfig.eggDropOffsetForward,
        eggRadius + 0.001,
        worldDocument.size.x - eggRadius - 0.001
      ),
      y: THREE.MathUtils.clamp(
        localPlayer.position.y + defaultSimulationConfig.eggDropOffsetUp,
        eggRadius + 0.001,
        worldDocument.size.y - eggRadius - 0.001
      ),
      z: THREE.MathUtils.clamp(
        localPlayer.position.z + localPlayer.facing.z * defaultSimulationConfig.eggDropOffsetForward,
        eggRadius + 0.001,
        worldDocument.size.z - eggRadius - 0.001
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

      if (nextVector.y <= worldDocument.boundary.fallY) {
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
    this.eggTrajectoryPreview.landingMaterial.opacity =
      0.58 + this.eggChargeState.chargeAlpha * 0.24;
    this.eggTrajectoryPreview.landingRing.scale.setScalar(
      (1.08 + this.eggChargeState.chargeAlpha * 0.9) *
        (1 + Math.sin(elapsedTime * 10.4) * 0.1)
    );
  }

  private createRenderer() {
    if (!this.offscreenCanvas) {
      return;
    }

    const renderer = new THREE.WebGLRenderer({
      canvas: this.offscreenCanvas,
      antialias: this.qualityTier === "high",
      powerPreference: "high-performance"
    });
    renderer.setClearColor(this.sceneBackgroundColor);
    renderer.shadowMap.enabled = false;
    renderer.shadowMap.autoUpdate = false;
    this.renderer = renderer;
    (this.sunShadows as unknown as { renderer: THREE.WebGLRenderer }).renderer = renderer;
    this.sunShadows.trackMaterial(getTerrainChunkMaterials());
    this.sunShadows.trackMaterial([
      propMaterials.bark,
      propMaterials.leavesOak,
      propMaterials.leavesPine,
      propMaterials.leavesAutumn
    ]);
  }

  private initVoxelFx() {
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

      const harvestMesh = createDynamicOpacityMeshResource(
        MAX_HARVEST_BURST_INSTANCES_PER_PROFILE,
        getVoxelMaterials(profile)
      );
      this.harvestBurstMeshes.set(profile, harvestMesh);
      this.voxelFxGroup.add(harvestMesh.mesh);

      const explosionMesh = createDynamicOpacityMeshResource(
        MAX_EGG_EXPLOSION_BURST_INSTANCES,
        getVoxelMaterials(profile),
        sharedVoxelGeometry.clone()
      );
      this.eggExplosionBurstMeshes.set(profile, explosionMesh);
      this.voxelFxGroup.add(explosionMesh.mesh);
    }

    for (const [materialKey, material] of propRemainsMaterialEntries) {
      const remainsMesh = createDynamicOpacityMeshResource(
        MAX_PROP_REMAINS_INSTANCES_PER_MATERIAL,
        material,
        this.propGeometry.clone()
      );
      this.propRemainsMeshes.set(materialKey, remainsMesh);
      this.voxelFxGroup.add(remainsMesh.mesh);
    }

    for (const texture of propFxTextures.flameFrames) {
      const flameMesh = createDynamicOpacityMeshResource(
        MAX_PROP_REMAINS_FLAME_INSTANCES,
        new THREE.MeshBasicMaterial({
          alphaTest: 0.24,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          map: texture,
          opacity: 1,
          side: THREE.DoubleSide,
          toneMapped: false,
          transparent: true
        }),
        flameCardGeometry.clone()
      );
      this.propRemainsFlameMeshes.push(flameMesh);
      this.voxelFxGroup.add(flameMesh.mesh);
    }

    this.propRemainsEmberMesh = createDynamicOpacityMeshResource(
      MAX_PROP_REMAINS_EMBER_INSTANCES,
      new THREE.MeshBasicMaterial({
        color: "#ff9d42",
        opacity: 1,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false
      }),
      sharedVoxelGeometry.clone()
    );
    this.voxelFxGroup.add(this.propRemainsEmberMesh.mesh);

    this.propRemainsSmokeMesh = createDynamicOpacityMeshResource(
      MAX_PROP_REMAINS_SMOKE_INSTANCES,
      new THREE.MeshBasicMaterial({
        color: "#3c312d",
        opacity: 1,
        transparent: true,
        blending: THREE.NormalBlending,
        depthWrite: false,
        toneMapped: false
      }),
      sharedVoxelGeometry.clone()
    );
    this.voxelFxGroup.add(this.propRemainsSmokeMesh.mesh);

    this.eggExplosionAccentBurstMesh = createDynamicOpacityMeshResource(
      MAX_EGG_EXPLOSION_ACCENT_INSTANCES,
      new THREE.MeshBasicMaterial({
        color: "#ffd278",
        opacity: 1,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false
      }),
      sharedVoxelGeometry.clone()
    );
    this.voxelFxGroup.add(this.eggExplosionAccentBurstMesh.mesh);

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
    this.voxelFxGroup.add(this.eggExplosionShockwaveMesh.mesh);
  }

  private resetPropRemainsState() {
    this.propRemainsStates.clear();
    this.processedPropDeltaKeys.clear();
    this.processedPropDeltaKeyOrder.length = 0;
    this.recentExplosionImpacts.length = 0;
  }

  private rememberProcessedPropDeltaKey(key: string) {
    if (this.processedPropDeltaKeys.has(key)) {
      return false;
    }

    this.processedPropDeltaKeys.add(key);
    this.processedPropDeltaKeyOrder.push(key);
    while (this.processedPropDeltaKeyOrder.length > MAX_TRACKED_PROP_DELTA_KEYS) {
      const oldest = this.processedPropDeltaKeyOrder.shift();
      if (!oldest) {
        break;
      }

      this.processedPropDeltaKeys.delete(oldest);
    }

    return true;
  }

  private buildProcessedPropDeltaKey(
    source: "local" | "multiplayer",
    batchTick: number,
    operation: TerrainDeltaBatch["propChanges"][number]["operation"],
    id: string
  ) {
    return `${source}:${batchTick}:${operation}:${id}`;
  }

  private getFrameBurningPropIds(frame: EngineRuntimeRenderFrame | null) {
    return new Set((frame?.burningProps ?? []).map((prop) => prop.id));
  }

  private pruneRecentExplosionImpacts(frameTime: number) {
    while (
      this.recentExplosionImpacts.length > 0 &&
      frameTime - this.recentExplosionImpacts[0]!.time > RECENT_EXPLOSION_IMPACT_WINDOW_SECONDS
    ) {
      this.recentExplosionImpacts.shift();
    }
  }

  private recordRecentExplosionImpacts(batch: GameplayEventBatch | null, frameTime: number) {
    if (!batch) {
      this.pruneRecentExplosionImpacts(frameTime);
      return;
    }

    for (const event of batch.events) {
      if (event.type !== "explosion_resolved") {
        continue;
      }

      this.recentExplosionImpacts.push({
        position: {
          x: event.position.x,
          y: event.position.y,
          z: event.position.z
        },
        time: frameTime
      });
    }

    this.pruneRecentExplosionImpacts(frameTime);
  }

  private resolveBurningIgnitionOrigin(visual: PropVisual, frameTime: number) {
    this.pruneRecentExplosionImpacts(frameTime);
    const nearestImpact = this.recentExplosionImpacts.reduce<RecentExplosionImpact | null>(
      (best, impact) => {
        if (!best) {
          return impact;
        }

        const bestDistance = visual.center.distanceToSquared(
          new THREE.Vector3(best.position.x, best.position.y, best.position.z)
        );
        const impactDistance = visual.center.distanceToSquared(
          new THREE.Vector3(impact.position.x, impact.position.y, impact.position.z)
        );
        return impactDistance < bestDistance ? impact : best;
      },
      null
    );

    if (nearestImpact) {
      return nearestImpact.position;
    }

    const fallbackSeed =
      hashString(`${visual.prop.id}:${visual.prop.kind}:${visual.prop.x}:${visual.prop.z}`) * 0.0001;
    const fallbackAngle = fallbackSeed * Math.PI * 2;
    return {
      x: visual.center.x + Math.cos(fallbackAngle) * 5.5,
      y: visual.center.y + 1.8,
      z: visual.center.z + Math.sin(fallbackAngle) * 5.5
    };
  }

  private getWorldSettleHeight(world: MutableVoxelWorld, x: number, z: number) {
    const cellX = THREE.MathUtils.clamp(Math.floor(x), 0, world.size.x - 1);
    const cellZ = THREE.MathUtils.clamp(Math.floor(z), 0, world.size.z - 1);
    const topSolidY = world.getTopSolidY(cellX, cellZ);
    const topGroundY = world.getTopGroundY(cellX, cellZ);
    return Math.max(topSolidY, topGroundY, 0);
  }

  private countPropRemainsFragmentsByMaterial(
    state: Pick<PropRemainsState, "fragments">
  ): Record<PropShatterMaterialKey, number> {
    const counts: Record<PropShatterMaterialKey, number> = {
      bark: 0,
      leavesOak: 0,
      leavesPine: 0,
      leavesAutumn: 0
    };

    for (const fragment of state.fragments) {
      counts[fragment.materialKey] += 1;
    }

    return counts;
  }

  private evictPropRemainsUntilWithinBudget(nextState: PropRemainsState) {
    const incomingCounts = this.countPropRemainsFragmentsByMaterial(nextState);
    const capacityByMaterial: Record<PropShatterMaterialKey, number> = {
      bark: MAX_PROP_REMAINS_INSTANCES_PER_MATERIAL,
      leavesOak: MAX_PROP_REMAINS_INSTANCES_PER_MATERIAL,
      leavesPine: MAX_PROP_REMAINS_INSTANCES_PER_MATERIAL,
      leavesAutumn: MAX_PROP_REMAINS_INSTANCES_PER_MATERIAL
    };
    const aggregateCounts: Record<PropShatterMaterialKey, number> = {
      bark: incomingCounts.bark,
      leavesOak: incomingCounts.leavesOak,
      leavesPine: incomingCounts.leavesPine,
      leavesAutumn: incomingCounts.leavesAutumn
    };

    for (const state of this.propRemainsStates.values()) {
      const counts = this.countPropRemainsFragmentsByMaterial(state);
      aggregateCounts.bark += counts.bark;
      aggregateCounts.leavesOak += counts.leavesOak;
      aggregateCounts.leavesPine += counts.leavesPine;
      aggregateCounts.leavesAutumn += counts.leavesAutumn;
    }

    while (
      [...propRemainsMaterialEntries].some(
        ([materialKey]) => aggregateCounts[materialKey] > capacityByMaterial[materialKey]
      ) &&
      this.propRemainsStates.size > 0
    ) {
      const oldestEntry = this.propRemainsStates.entries().next().value as
        | [string, PropRemainsState]
        | undefined;
      if (!oldestEntry) {
        break;
      }

      const [oldestId, oldestState] = oldestEntry;
      const counts = this.countPropRemainsFragmentsByMaterial(oldestState);
      aggregateCounts.bark -= counts.bark;
      aggregateCounts.leavesOak -= counts.leavesOak;
      aggregateCounts.leavesPine -= counts.leavesPine;
      aggregateCounts.leavesAutumn -= counts.leavesAutumn;
      this.propRemainsStates.delete(oldestId);
    }
  }

  private spawnPropRemains(
    change: TerrainDeltaBatch["propChanges"][number],
    batchTick: number,
    world: MutableVoxelWorld,
    burning: boolean
  ) {
    const remainsId = `prop-remains-${batchTick}-${change.id}`;
    const nextState = createPropRemainsState({
      id: remainsId,
      burning,
      prop: {
        id: change.id,
        kind: change.kind,
        x: change.x,
        y: change.y,
        z: change.z
      },
      settleHeightAt: (x, z) => this.getWorldSettleHeight(world, x, z)
    });
    this.evictPropRemainsUntilWithinBudget(nextState);
    this.propRemainsStates.set(remainsId, nextState);
  }

  private processLocalPropChangeBatch(
    batch: TerrainDeltaBatch | null,
    burningPropIds: ReadonlySet<string>
  ) {
    if (!batch || batch.propChanges.length === 0) {
      return false;
    }

    let hasFreshChange = false;
    const world = this.runtime.getWorld();
    for (const change of batch.propChanges) {
      const dedupeKey = this.buildProcessedPropDeltaKey("local", batch.tick, change.operation, change.id);
      if (!this.rememberProcessedPropDeltaKey(dedupeKey)) {
        continue;
      }

      hasFreshChange = true;
      if (change.operation === "remove") {
        this.spawnPropRemains(change, batch.tick, world, burningPropIds.has(change.id));
      }
    }

    return hasFreshChange;
  }

  private applyMultiplayerTerrainDeltaBatchToRuntimeWorld(
    batch: TerrainDeltaBatch | null,
    burningPropIds: ReadonlySet<string>
  ) {
    if (!batch || !this.runtimeWorld) {
      return false;
    }

    let worldChanged = false;
    let propsChanged = false;

    for (const change of batch.changes) {
      if (change.operation === "remove" || change.kind === null) {
        worldChanged = this.runtimeWorld.removeVoxel(
          change.voxel.x,
          change.voxel.y,
          change.voxel.z
        ).size > 0 || worldChanged;
        continue;
      }

      worldChanged = this.runtimeWorld.setVoxel(
        change.voxel.x,
        change.voxel.y,
        change.voxel.z,
        change.kind
      ).size > 0 || worldChanged;
    }

    for (const change of batch.propChanges) {
      const dedupeKey = this.buildProcessedPropDeltaKey(
        "multiplayer",
        batch.tick,
        change.operation,
        change.id
      );
      const isFreshChange = this.rememberProcessedPropDeltaKey(dedupeKey);

      if (change.operation === "remove") {
        propsChanged = this.runtimeWorld.removeProp(change.id) || propsChanged;
        if (isFreshChange) {
          this.spawnPropRemains(
            change,
            batch.tick,
            this.runtimeWorld,
            burningPropIds.has(change.id)
          );
        }
        continue;
      }

      propsChanged =
        (isFreshChange &&
          this.runtimeWorld.setProp(change.kind, change.x, change.y, change.z, change.id) !== null) ||
        propsChanged;
    }

    if (worldChanged || propsChanged) {
      this.currentDocument = this.runtimeWorld.toDocument();
    }

    return propsChanged;
  }

  private advancePropRemains(delta: number) {
    for (const [stateId, state] of this.propRemainsStates) {
      state.elapsed += delta;
      if (state.elapsed < getPropRemainsDuration(state)) {
        continue;
      }

      this.propRemainsStates.delete(stateId);
    }
  }

  private syncPropRemains() {
    const counts: Record<PropShatterMaterialKey, number> = {
      bark: 0,
      leavesOak: 0,
      leavesPine: 0,
      leavesAutumn: 0
    };
    const flameCounts = new Array(this.propRemainsFlameMeshes.length).fill(0);
    let emberCount = 0;
    let smokeCount = 0;

    for (const state of this.propRemainsStates.values()) {
      for (let fragmentIndex = 0; fragmentIndex < state.fragments.length; fragmentIndex += 1) {
        const fragment = getPropRemainsFragmentState(state, fragmentIndex);
        const resource = this.propRemainsMeshes.get(fragment.materialKey);
        const instanceIndex = counts[fragment.materialKey];
        if (resource && instanceIndex < MAX_PROP_REMAINS_INSTANCES_PER_MATERIAL) {
          voxelFxTempObject.position.set(
            fragment.position.x,
            fragment.position.y,
            fragment.position.z
          );
          voxelFxTempObject.rotation.set(
            fragment.rotationX,
            fragment.rotationY,
            fragment.rotationZ
          );
          voxelFxTempObject.scale.setScalar(fragment.scale);
          voxelFxTempObject.updateMatrix();
          resource.mesh.setMatrixAt(instanceIndex, voxelFxTempObject.matrix);
          resource.opacityAttribute.setX(instanceIndex, fragment.opacity);
          counts[fragment.materialKey] += 1;
        }

        if (fragment.burningAlpha <= 0.05) {
          continue;
        }

        const flameStride =
          fragment.phase === "collapse"
            ? 4
            : fragment.phase === "settled"
              ? 2
              : 6;
        const flameCardCopies =
          fragment.phase === "settled"
            ? 2
            : fragment.phase === "collapse"
              ? 2
              : 1;
        if (fragmentIndex % flameStride === 0 && this.propRemainsFlameMeshes.length > 0) {
          for (let cardIndex = 0; cardIndex < flameCardCopies; cardIndex += 1) {
            const frameIndex = Math.floor(
              (state.elapsed * 10.8 + fragmentIndex * 0.9 + cardIndex * 0.7) %
                this.propRemainsFlameMeshes.length
            );
            const flameResource = this.propRemainsFlameMeshes[frameIndex]!;
            const flameCount = flameCounts[frameIndex] ?? 0;
            if (flameCount >= MAX_PROP_REMAINS_FLAME_INSTANCES) {
              continue;
            }

            const lateralOffset = cardIndex === 0 ? -0.05 : 0.05;
            const flameHeightBoost =
              fragment.phase === "settled"
                ? 0.24
                : fragment.phase === "collapse"
                  ? 0.2
                  : 0.16;
            voxelFxTempObject.position.set(
              fragment.position.x + lateralOffset,
              fragment.position.y + flameHeightBoost + fragment.burningAlpha * 0.22,
              fragment.position.z + (cardIndex === 0 ? 0.03 : -0.03)
            );
            voxelFxTempObject.rotation.set(
              0,
              (fragmentIndex % 8) * (Math.PI / 4) + cardIndex * (Math.PI / 2),
              0
            );
            voxelFxTempObject.scale.set(
              0.2 + fragment.burningAlpha * 0.28,
              0.38 + fragment.burningAlpha * 0.46,
              0.2 + fragment.burningAlpha * 0.28
            );
            voxelFxTempObject.updateMatrix();
            flameResource.mesh.setMatrixAt(flameCount, voxelFxTempObject.matrix);
            flameResource.opacityAttribute.setX(
              flameCount,
              Math.min(
                1,
                fragment.burningAlpha *
                  (fragment.phase === "settled" ? 1 : fragment.phase === "collapse" ? 0.95 : 0.7)
              )
            );
            flameCounts[frameIndex] = flameCount + 1;
          }
        }

        if (this.propRemainsEmberMesh && emberCount < MAX_PROP_REMAINS_EMBER_INSTANCES && fragmentIndex % 6 === 0) {
          voxelFxTempObject.position.set(
            fragment.position.x,
            fragment.position.y + 0.08 + fragment.burningAlpha * 0.18,
            fragment.position.z
          );
          voxelFxTempObject.rotation.set(0, 0, 0);
          voxelFxTempObject.scale.setScalar(0.12 + fragment.burningAlpha * 0.14);
          voxelFxTempObject.updateMatrix();
          this.propRemainsEmberMesh.mesh.setMatrixAt(emberCount, voxelFxTempObject.matrix);
          this.propRemainsEmberMesh.opacityAttribute.setX(
            emberCount,
            Math.min(1, fragment.burningAlpha * 0.95)
          );
          emberCount += 1;
        }

        if (
          this.propRemainsSmokeMesh &&
          smokeCount < MAX_PROP_REMAINS_SMOKE_INSTANCES &&
          fragmentIndex % 5 === 0
        ) {
          voxelFxTempObject.position.set(
            fragment.position.x + Math.sin(fragmentIndex * 1.37 + state.elapsed * 1.8) * 0.08,
            fragment.position.y + 0.3 + fragment.burningAlpha * 0.44,
            fragment.position.z + Math.cos(fragmentIndex * 1.11 + state.elapsed * 1.5) * 0.08
          );
          voxelFxTempObject.rotation.set(0, fragmentIndex * 0.23, 0);
          voxelFxTempObject.scale.setScalar(0.24 + fragment.burningAlpha * 0.42);
          voxelFxTempObject.updateMatrix();
          this.propRemainsSmokeMesh.mesh.setMatrixAt(smokeCount, voxelFxTempObject.matrix);
          this.propRemainsSmokeMesh.opacityAttribute.setX(
            smokeCount,
            0.18 + fragment.burningAlpha * 0.34
          );
          smokeCount += 1;
        }
      }
    }

    for (const [materialKey] of propRemainsMaterialEntries) {
      finalizeDynamicOpacityMesh(
        this.propRemainsMeshes.get(materialKey) ?? null,
        counts[materialKey]
      );
    }

    this.propRemainsFlameMeshes.forEach((resource, frameIndex) => {
      finalizeDynamicOpacityMesh(resource, flameCounts[frameIndex] ?? 0);
    });
    finalizeDynamicOpacityMesh(this.propRemainsEmberMesh, emberCount);
    finalizeDynamicOpacityMesh(this.propRemainsSmokeMesh, smokeCount);
  }

  private ensureLoop() {
    if (this.animationFrameId !== null) {
      return;
    }

    this.lastFrameTime = now();
    this.clock.start();
    this.animationFrameId = requestWorkerAnimationFrame(this.animate);
  }

  private readonly animate = () => {
    this.animationFrameId = null;
    const frameNow = now();
    const delta = Math.min((frameNow - this.lastFrameTime) / 1000, MAX_FRAME_DELTA_SECONDS);
    this.lastFrameTime = frameNow;
    const elapsed = this.clock.getElapsedTime();
    const preStepLocalPlayer = this.getLocalRuntimePlayer();
    this.updateHoldToThrowState(preStepLocalPlayer, elapsed);
    this.updateEggChargeState(preStepLocalPlayer, delta, elapsed);
    updateVoxelMaterialAnimation(elapsed);

    if (!this.runtimePaused && (this.mode === "explore" || this.mode === "playNpc")) {
      this.stepLocalRuntime(delta, elapsed);
    } else if (!this.runtimePaused && this.mode === "multiplayer") {
      this.sampleRuntimeInput(elapsed);
      this.latestDirtyChunkCount = 0;
    } else if (isRuntimeMode(this.mode)) {
      this.latestDirtyChunkCount = 0;
    }

    if (isRuntimeMode(this.mode)) {
      this.updateRuntimeCamera(delta);
    } else {
      this.updateShellCamera(elapsed);
    }
    this.updateFocusTarget();
    this.advancePropRemains(delta);
    this.syncActiveVisuals(delta, elapsed);
    this.syncWaterfalls(elapsed);
    this.updateEggLaunchPreview(this.getLocalRuntimePlayer(), elapsed);
    this.renderFrame(delta);
    this.animationFrameId = requestWorkerAnimationFrame(this.animate);
  };

  private stepLocalRuntime(delta: number, elapsed: number) {
    const step = 1 / this.runtime.config.tickRate;
    const catchUp = resolveFixedStepCatchUp(this.runtimeAccumulator, delta, step);
    this.runtimeAccumulator = catchUp.accumulator;

    const currentDiagnostics = { ...EMPTY_DIAGNOSTICS };
    currentDiagnostics.fixedStepMaxStepsPerFrame = catchUp.stepsToRun;
    if (catchUp.clamped) {
      currentDiagnostics.fixedStepClampedFrames = 1;
      currentDiagnostics.fixedStepDroppedMs = catchUp.droppedMs;
    }

    for (let stepIndex = 0; stepIndex < catchUp.stepsToRun; stepIndex += 1) {
      const localPlayerId = this.runtime.getLocalPlayerId();
      const command = this.sampleRuntimeInput(elapsed);
      this.runtime.step(localPlayerId ? { [localPlayerId]: command } : {}, step);
      const diagnostics = this.runtime.consumePerformanceDiagnostics();
      currentDiagnostics.skyDropUpdateMs = Math.max(currentDiagnostics.skyDropUpdateMs, diagnostics.skyDropUpdateMs);
      currentDiagnostics.skyDropLandingMs = Math.max(currentDiagnostics.skyDropLandingMs, diagnostics.skyDropLandingMs);
      currentDiagnostics.detachedComponentMs = Math.max(currentDiagnostics.detachedComponentMs, diagnostics.detachedComponentMs);
      currentDiagnostics.fallingClusterLandingMs = Math.max(currentDiagnostics.fallingClusterLandingMs, diagnostics.fallingClusterLandingMs);
      currentDiagnostics.fixedStepMaxStepsPerFrame = Math.max(
        currentDiagnostics.fixedStepMaxStepsPerFrame,
        diagnostics.fixedStepMaxStepsPerFrame
      );
      currentDiagnostics.fixedStepClampedFrames += diagnostics.fixedStepClampedFrames;
      currentDiagnostics.fixedStepDroppedMs += diagnostics.fixedStepDroppedMs;
    }

    this.latestRuntimeDiagnostics = currentDiagnostics;
    const previousBurningPropIds = this.getFrameBurningPropIds(this.latestRuntimeFrame);
    this.latestRuntimeFrame = createLocalRuntimeFrame(this.runtime);
    this.maybeTriggerPortal(this.latestRuntimeFrame);
    this.recordRecentExplosionImpacts(
      this.latestRuntimeFrame.authoritative?.gameplayEventBatch ?? null,
      this.latestRuntimeFrame.time
    );
    this.postHudState(this.latestRuntimeFrame.hudState);
    const hadPropChanges = this.processLocalPropChangeBatch(
      this.latestRuntimeFrame.authoritative?.terrainDeltaBatch ?? null,
      previousBurningPropIds
    );

    const terrainRevision = this.runtime.getWorld().getTerrainRevision();
    if (terrainRevision !== this.lastRuntimeTerrainRevision) {
      this.lastRuntimeTerrainRevision = terrainRevision;
      const dirtyChunkKeys = this.runtime.consumeDirtyChunkKeys();
      this.latestDirtyChunkCount = dirtyChunkKeys.length;
      const patches = dirtyChunkKeys.map((key) => buildChunkPatch(this.runtime.getWorld(), key));
      this.applyTerrainPatches(patches);
      this.rebuildProps(this.runtime.getWorld().toDocument());
    } else if (hadPropChanges) {
      this.latestDirtyChunkCount = 0;
      this.rebuildProps(this.runtime.getWorld().toDocument());
    } else {
      this.latestDirtyChunkCount = 0;
    }
  }

  private sampleRuntimeInput(elapsed: number): RuntimeInputCommand {
    const baseCommand = buildPlayerCommand(this.keyboardState, this.cameraForward);
    const destroy = this.destroyHeld && this.focusedTarget !== null;
    const place = this.keyboardState.placePressed && this.focusedTarget !== null;
    const command: RuntimeInputCommand = {
      ...createEmptyRuntimeInputCommand(this.inputSequence),
      ...baseCommand,
      destroy,
      place,
      push: this.pushQueued,
      layEgg: this.eggChargeState.pendingThrow || this.quickEggQueued,
      eggCharge: this.eggChargeState.pendingThrow
        ? this.eggChargeState.pendingThrowCharge
        : 0,
      eggPitch: this.eggChargeState.pendingThrow
        ? this.eggChargeState.pendingThrowPitch
        : this.quickEggQueued
          ? this.quickEggPitch
          : 0,
      targetVoxel: this.focusedTarget?.voxel ?? null,
      targetNormal: this.focusedTarget?.normal ?? null,
      typedText: this.pendingTypedText,
      seq: this.inputSequence
    };

    this.pushQueued = false;
    this.pendingTypedText = "";
    this.quickEggQueued = false;
    this.quickEggPitch = 0;
    this.eggChargeState.pendingThrow = false;
    this.eggChargeState.pendingThrowCharge = 0;
    this.eggChargeState.pendingThrowPitch = 0;
    this.keyboardState.jumpPressed = false;
    this.keyboardState.jumpReleased = false;
    this.keyboardState.pushPressed = false;
    this.inputSequence += 1;

    if (this.mode === "multiplayer") {
      const shouldEmitInput =
        elapsed - this.lastMultiplayerInputSentAt >=
          MULTIPLAYER_INPUT_INTERVAL_SECONDS ||
        destroy ||
        place ||
        command.push ||
        command.layEgg ||
        command.jumpPressed ||
        command.jumpReleased ||
        command.typedText.length > 0;

      if (shouldEmitInput) {
        const buffer = packRuntimeInputCommand(command);
        this.lastMultiplayerInputSentAt = elapsed;
        this.post({
          type: "runtime_input_packet",
          buffer
        }, [buffer]);
      }
    }

    return command;
  }

  private updateShellCamera(elapsed: number) {
    const { arenaSpan, centerX, centerZ, topY, worldSize } = this.syncWorldSceneState();
    const orbitAlpha = this.presentation === "menu" ? elapsed * 0.08 : 0.22;
    const orbitRadius = Math.max(48, arenaSpan * 0.72);
    const cameraX = centerX + Math.cos(orbitAlpha) * orbitRadius;
    const cameraZ = centerZ + Math.sin(orbitAlpha) * orbitRadius;
    this.camera.position.set(cameraX, topY, cameraZ);
    this.camera.lookAt(centerX, worldSize.y * 0.25, centerZ);
    const forward = getPlanarForwardBetweenPoints(this.camera.position, new THREE.Vector3(centerX, 0, centerZ));
    this.cameraForward.x = forward.x;
    this.cameraForward.z = forward.z;
  }

  private updateRuntimeCamera(delta: number) {
    const frame = this.mode === "multiplayer" ? this.latestExternalFrame : this.latestRuntimeFrame;
    const { arenaSpan, centerX, centerZ, topY, worldSize } = this.syncWorldSceneState();
    if (!frame) {
      this.camera.position.set(centerX + arenaSpan * 0.32, topY, centerZ + arenaSpan * 0.32);
      this.camera.lookAt(centerX, worldSize.y * 0.35, centerZ);
      const forward = getPlanarForwardBetweenPoints(this.camera.position, new THREE.Vector3(centerX, 0, centerZ));
      this.cameraForward.x = forward.x;
      this.cameraForward.z = forward.z;
      return;
    }

    const localPlayer = frame.localPlayerId
      ? frame.players.find((player: RuntimePlayerState) => player.id === frame.localPlayerId) ?? null
      : null;
    if (!localPlayer || (!localPlayer.fallingOut && (!localPlayer.alive || localPlayer.respawning))) {
      if (this.mode === "multiplayer") {
        this.updateSpectatorCamera(delta, frame.players);
        return;
      }

      this.camera.position.set(centerX + arenaSpan * 0.32, topY, centerZ + arenaSpan * 0.32);
      this.camera.lookAt(centerX, worldSize.y * 0.35, centerZ);
      const forward = getPlanarForwardBetweenPoints(this.camera.position, new THREE.Vector3(centerX, 0, centerZ));
      this.cameraForward.x = forward.x;
      this.cameraForward.z = forward.z;
      return;
    }

    this.hasInitializedSpectatorCamera = false;
    if (this.lookYaw === null) {
      this.lookYaw = getYawFromPlanarVector(localPlayer.facing);
      this.lookPitch = aimCameraConfig.defaultPitch;
      this.speedBlend = 0;
      this.hasInitializedRuntimeCamera = false;
    }

    const spaceCameraActive = localPlayer.spacePhase !== "none";
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
        this.runtimeSettings,
        spaceCameraActive ? spaceCameraConfig : aimCameraConfig
      );
      this.lookYaw = nextLook.yaw;
      this.lookPitch = nextLook.pitch;
      this.pendingLookDeltaX = 0;
      this.pendingLookDeltaY = 0;
    }

    const lookYaw = this.lookYaw ?? getYawFromPlanarVector(localPlayer.facing);
    if (spaceCameraActive) {
      this.speedBlend = 0;
    } else {
      const initialAimState = getAimRigState(localPlayer.position, lookYaw, this.lookPitch, this.speedBlend);
      const forwardSpeedRatio = getForwardSpeedRatio(localPlayer.velocity, initialAimState.planarForward, 6);
      const targetSpeedBlend = getSpeedCameraBlend(forwardSpeedRatio);
      this.speedBlend = dampScalar(this.speedBlend, targetSpeedBlend, 7, delta);
    }

    const aimState = spaceCameraActive
      ? getSpaceAimRigState(localPlayer.position, lookYaw, this.lookPitch)
      : getAimRigState(localPlayer.position, lookYaw, this.lookPitch, this.speedBlend);
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
    const rising =
      localPlayer.velocity.y > 0 &&
      this.desiredCameraPosition.y > this.camera.position.y;
    const verticalPositionDamping = rising ? 1 - Math.exp(-delta * 24) : positionDamping;
    const verticalLookTargetDamping = rising ? 1 - Math.exp(-delta * 26) : lookTargetDamping;
    this.camera.position.x = THREE.MathUtils.lerp(this.camera.position.x, this.desiredCameraPosition.x, positionDamping);
    this.camera.position.y = THREE.MathUtils.lerp(this.camera.position.y, this.desiredCameraPosition.y, verticalPositionDamping);
    this.camera.position.z = THREE.MathUtils.lerp(this.camera.position.z, this.desiredCameraPosition.z, positionDamping);
    this.currentLookTarget.x = THREE.MathUtils.lerp(this.currentLookTarget.x, this.desiredLookTarget.x, lookTargetDamping);
    this.currentLookTarget.y = THREE.MathUtils.lerp(this.currentLookTarget.y, this.desiredLookTarget.y, verticalLookTargetDamping);
    this.currentLookTarget.z = THREE.MathUtils.lerp(this.currentLookTarget.z, this.desiredLookTarget.z, lookTargetDamping);
    this.camera.lookAt(this.currentLookTarget);
    this.cameraForward = getPlanarForwardBetweenPoints(this.camera.position, this.currentLookTarget);
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
        this.runtimeSettings
      );
      this.lookYaw = nextLook.yaw;
      this.lookPitch = nextLook.pitch;
      this.pendingLookDeltaX = 0;
      this.pendingLookDeltaY = 0;
    }

    if (!this.hasInitializedSpectatorCamera) {
      const anchor = referencePlayer?.position ?? {
        x: this.currentDocument.size.x / 2,
        y: this.currentDocument.size.y * 0.65,
        z: this.currentDocument.size.z / 2
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
        this.currentDocument.size.x + 24
      );
      this.camera.position.y = THREE.MathUtils.clamp(
        this.camera.position.y,
        4,
        this.currentDocument.size.y + 48
      );
      this.camera.position.z = THREE.MathUtils.clamp(
        this.camera.position.z,
        -24,
        this.currentDocument.size.z + 24
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

  private rebuildSkyLayers(document: MapDocumentV1) {
    this.rebuildClouds(document);
    this.rebuildSkyBirds(document.size);
    this.buildSpaceBackdrop();
  }

  private rebuildClouds(document: MapDocumentV1) {
    this.cloudVisuals.length = 0;
    this.cloudsGroup.clear();

    const profile = getRendererQualityProfileForTier(this.qualityTier);
    const visiblePresets = cloudPresets.slice(0, profile.cloudCount);
    for (const preset of visiblePresets) {
      const { mainMatrices, shadeMatrices } = buildCloudMatrices(preset);
      const group = new THREE.Group();
      const mainMesh = new THREE.InstancedMesh(
        cloudGeometry,
        this.cloudMainMaterial,
        Math.max(1, mainMatrices.length)
      );
      const shadeMesh = new THREE.InstancedMesh(
        cloudGeometry,
        this.cloudShadeMaterial,
        Math.max(1, shadeMatrices.length)
      );

      mainMesh.frustumCulled = false;
      shadeMesh.frustumCulled = false;
      configureStaticInstancedMesh(mainMesh, mainMatrices);
      configureStaticInstancedMesh(shadeMesh, shadeMatrices);

      const position = getVoxelCloudPosition(preset, 0, document.size);
      group.position.set(position.x, position.y, position.z);
      group.scale.setScalar(preset.scale);
      group.add(mainMesh, shadeMesh);
      this.cloudsGroup.add(group);
      this.cloudVisuals.push({
        group,
        preset
      });
    }
  }

  private rebuildSkyBirds(worldSize: { x: number; y: number; z: number }) {
    this.skyBirdVisuals.length = 0;
    this.skyBirdsGroup.clear();

    const profile = getRendererQualityProfileForTier(this.qualityTier);
    const flock = buildSkyBirdFlock({
      seed: `${worldSize.x}:${worldSize.y}:${worldSize.z}:${this.qualityTier}:${this.matchColorSeed}`,
      count: profile.skyBirdCount
    });

    for (const preset of flock) {
      const visual = createSkyBirdVisual(preset, worldSize, this.skyBirdMaterial);
      this.skyBirdsGroup.add(visual.group);
      this.skyBirdVisuals.push(visual);
    }
  }

  private buildSpaceBackdrop() {
    for (const visual of this.spacePlanetVisuals) {
      for (const material of visual.materials) {
        material.dispose();
      }
    }
    this.spacePlanetVisuals.length = 0;
    this.spaceBackdropGroup.clear();
    this.spaceBackdropGroup.add(this.spaceStars);

    for (const descriptor of spacePlanetDescriptors) {
      const { mainMatrices, shadeMatrices, accentMatrices } = buildVoxelPlanetMatrices(descriptor);
      const group = new THREE.Group();
      const materials: THREE.MeshBasicMaterial[] = [];
      const meshBuckets: Array<{ matrices: THREE.Matrix4[]; color: string }> = [
        {
          matrices: mainMatrices,
          color: descriptor.colors[0]
        },
        {
          matrices: shadeMatrices,
          color: descriptor.colors[1]
        }
      ];

      if (descriptor.colors[2] && accentMatrices.length > 0) {
        meshBuckets.push({
          matrices: accentMatrices,
          color: descriptor.colors[2]
        });
      }

      for (const bucket of meshBuckets) {
        const material = new THREE.MeshBasicMaterial({
          color: bucket.color,
          transparent: true,
          opacity: 0,
          toneMapped: false
        });
        const mesh = new THREE.InstancedMesh(
          sharedVoxelGeometry,
          material,
          Math.max(1, bucket.matrices.length)
        );
        mesh.frustumCulled = false;
        configureStaticInstancedMesh(mesh, bucket.matrices);
        group.add(mesh);
        materials.push(material);
      }

      group.position.set(...descriptor.offset);
      group.scale.setScalar(descriptor.scale);
      group.visible = true;
      this.spaceBackdropGroup.add(group);
      this.spacePlanetVisuals.push({
        group,
        materials,
        spinSpeed: descriptor.spinSpeed,
        wobblePhase: descriptor.wobblePhase
      });
    }
  }

  private updateSkyEnvironment(localPlayer: RuntimePlayerState | null, delta: number, elapsed: number) {
    const worldSize = this.getActiveWorldDocument().size;

    for (const visual of this.cloudVisuals) {
      const position = getVoxelCloudPosition(visual.preset, elapsed, worldSize);
      visual.group.position.set(position.x, position.y, position.z);
    }

    for (const visual of this.skyBirdVisuals) {
      const pose = getSkyBirdPose(visual.preset, elapsed, worldSize);
      const wingAngle = THREE.MathUtils.lerp(0.08, 0.7, pose.flapAmount);
      const wingYOffset = THREE.MathUtils.lerp(-0.01, 0.05, pose.flapAmount);
      visual.group.position.set(pose.position.x, pose.position.y, pose.position.z);
      visual.group.rotation.y = pose.yaw;
      visual.leftWing.rotation.z = wingAngle;
      visual.leftWing.position.y = wingYOffset;
      visual.rightWing.rotation.z = -wingAngle;
      visual.rightWing.position.y = wingYOffset;
    }

    const targetSpaceBlend = localPlayer && localPlayer.spacePhase !== "none" ? 1 : 0;
    this.spaceBlend = dampScalar(this.spaceBlend, targetSpaceBlend, SPACE_BLEND_DAMPING, delta);

    const cloudOpacity = Math.max(0, 1 - this.spaceBlend);
    this.cloudMainMaterial.opacity = cloudOpacity;
    this.cloudShadeMaterial.opacity = cloudOpacity * 0.96;
    this.skyBirdMaterial.opacity = cloudOpacity * 0.98;

    this.sceneBackgroundColor.copy(daySkyColor).lerp(spaceSkyColor, this.spaceBlend);
    this.sceneFog.color.copy(dayFogColor).lerp(spaceFogColor, this.spaceBlend);
    this.sceneFog.near = THREE.MathUtils.lerp(
      this.baseFogNear,
      this.baseFogNear + 92,
      this.spaceBlend
    );
    this.sceneFog.far = THREE.MathUtils.lerp(
      this.baseFogFar,
      this.baseFogFar + 260,
      this.spaceBlend
    );
    this.ambientLight.intensity = THREE.MathUtils.lerp(0.45, 0.28, this.spaceBlend);
    this.directionalLight.intensity = THREE.MathUtils.lerp(1.36, 0.56, this.spaceBlend);
    this.hemisphereLight.intensity = THREE.MathUtils.lerp(0.22, 0.04, this.spaceBlend);

    this.spaceBackdropGroup.visible = this.spaceBlend > 0.01;
    this.spaceBackdropGroup.position.copy(this.camera.position);
    this.spaceStarMaterial.opacity = this.spaceBlend * 0.92;

    for (const visual of this.spacePlanetVisuals) {
      visual.group.rotation.y += delta * visual.spinSpeed;
      visual.group.rotation.x = Math.sin(elapsed * 0.18 + visual.wobblePhase) * 0.12;
      for (const material of visual.materials) {
        material.opacity = this.spaceBlend * 0.96;
      }
    }
  }

  private syncWorldSceneState() {
    const activeWorld = this.getActiveWorld();
    const worldSize = activeWorld?.size ?? this.currentDocument.size;
    const arenaSpan = Math.max(worldSize.x, worldSize.z);
    const centerX = worldSize.x * 0.5;
    const centerZ = worldSize.z * 0.5;
    const topY = Math.max(worldSize.y + 24, 44);
    const worldSizeKey = `${worldSize.x}:${worldSize.y}:${worldSize.z}:${this.presentation}`;

    if (this.lastWorldSceneSizeKey !== worldSizeKey) {
      this.lastWorldSceneSizeKey = worldSizeKey;
      if (this.presentation === "menu") {
        this.baseFogNear = Math.max(120, arenaSpan * 1.1);
        this.baseFogFar = Math.max(this.baseFogNear + 240, arenaSpan * 3.4);
      } else {
        this.baseFogNear = Math.max(36, arenaSpan * 0.45);
        this.baseFogFar = Math.max(this.baseFogNear + 40, arenaSpan + 44);
      }
      this.sceneFog.near = this.baseFogNear;
      this.sceneFog.far = this.baseFogFar;
      this.groundPlane.position.set(centerX, -0.35, centerZ);
      this.sunShadows.syncWorld({
        maxFar: Math.max(96, arenaSpan + 28),
        lightFar: Math.max(144, arenaSpan + 72),
        lightMargin: Math.max(24, arenaSpan * 0.2)
      });

      const groundPlaneSizeKey = `${worldSize.x + 32}:${worldSize.z + 32}`;
      if (this.lastGroundPlaneSizeKey !== groundPlaneSizeKey) {
        (this.groundPlane.geometry as THREE.BufferGeometry).dispose();
        this.groundPlane.geometry = new THREE.PlaneGeometry(
          worldSize.x + 32,
          worldSize.z + 32
        );
        this.lastGroundPlaneSizeKey = groundPlaneSizeKey;
      }

      this.directionalLight.position.set(
        worldSize.x * 0.72,
        topY,
        worldSize.z * 0.5
      );
    }

    return {
      arenaSpan,
      centerX,
      centerZ,
      topY,
      worldSize
    };
  }

  private updateFocusTarget() {
    if (!isRuntimeMode(this.mode) || this.mode === "multiplayer" && !this.latestExternalFrame || this.presentation === "menu") {
      this.focusedTarget = null;
      this.focusOutline.visible = false;
      this.focusGhost.visible = false;
      return;
    }

    const world = this.getActiveWorld();
    if (!world) {
      this.focusedTarget = null;
      this.focusOutline.visible = false;
      this.focusGhost.visible = false;
      return;
    }

    this.camera.getWorldPosition(this.runtimeRayOrigin);
    this.camera.getWorldDirection(this.runtimeRayDirection);
    const terrainHit = raycastVoxelWorld(world, this.runtimeRayOrigin, this.runtimeRayDirection, 14);
    if (!terrainHit) {
      this.focusedTarget = null;
      this.focusOutline.visible = false;
      this.focusGhost.visible = false;
      return;
    }

    this.focusedTarget = {
      voxel: terrainHit.voxel,
      normal: terrainHit.normal
    };
    this.focusOutline.visible = true;
    this.focusOutline.position.set(
      terrainHit.voxel.x + 0.5,
      terrainHit.voxel.y + 0.5,
      terrainHit.voxel.z + 0.5
    );

    const placeVoxel = {
      x: terrainHit.voxel.x + terrainHit.normal.x,
      y: terrainHit.voxel.y + terrainHit.normal.y,
      z: terrainHit.voxel.z + terrainHit.normal.z
    };
    const placementOpen = !world.hasOccupiedVoxel(placeVoxel.x, placeVoxel.y, placeVoxel.z);
    this.focusGhost.visible = placementOpen;
    if (placementOpen) {
      this.focusGhost.position.set(placeVoxel.x + 0.5, placeVoxel.y + 0.5, placeVoxel.z + 0.5);
    }
  }

  private syncActiveVisuals(delta: number, elapsed: number) {
    const frame = this.mode === "multiplayer" ? this.latestExternalFrame : this.latestRuntimeFrame;
    const localPlayer = frame?.localPlayerId
      ? frame.players.find((player) => player.id === frame.localPlayerId) ?? null
      : null;
    this.updateSkyEnvironment(localPlayer, delta, elapsed);
    this.syncPortalVisuals(elapsed);
    this.syncPlayers(frame?.players ?? [], frame?.localPlayerId ?? null, delta, elapsed);
    this.syncEggs(frame?.eggs ?? [], elapsed);
    this.syncEggScatterDebris(frame?.eggScatterDebris ?? []);
    this.syncVoxelBursts(frame?.voxelBursts ?? []);
    this.syncBurningProps(frame?.burningProps ?? [], elapsed);
    this.syncPropRemains();
    this.syncSkyDrops(frame?.skyDrops ?? [], elapsed);
    this.syncClusters(frame?.fallingClusters ?? [], elapsed);
  }

  private syncPlayers(
    players: readonly RuntimePlayerState[],
    localPlayerId: string | null,
    delta: number,
    elapsed: number
  ) {
    const remaining = new Set(this.playerVisuals.keys());
    for (const player of players) {
      const isLocal = player.id === localPlayerId;
      const preferredPaletteName = isLocal ? this.localPlayerPaletteName : null;
      const resolvedPaletteName = getChickenPalette(
        player.id,
        this.matchColorSeed,
        preferredPaletteName
      ).name;
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
      remaining.delete(player.id);
      const playerVisible = player.fallingOut || (player.alive && !player.respawning);
      visual.group.visible = playerVisible;
      const superBoomBombPhase =
        player.spacePhase === "superBoomDive" || player.spacePhase === "superBoomImpact";
      const eggLaunchChargeAlpha = isLocal ? this.eggChargeState.chargeAlpha : 0;
      const eggLaunchReleaseRemaining = isLocal ? this.eggChargeState.releaseRemaining : 0;
      const eggReleaseAlpha = THREE.MathUtils.clamp(
        eggLaunchReleaseRemaining / chickenPoseVisualDefaults.eggLaunchReleaseDuration,
        0,
        1
      );
      const heldEggVisible =
        isLocal &&
        !superBoomBombPhase &&
        (eggLaunchChargeAlpha > 0.01 || eggLaunchReleaseRemaining > 0.01);
      visual.root.visible = playerVisible && !superBoomBombPhase;
      visual.bomb.visible = playerVisible && (superBoomBombPhase || heldEggVisible);
      if (!playerVisible) {
        visual.previousGrounded = player.grounded;
        visual.previousVelocityY = player.velocity.y;
        visual.landingRollRemaining = 0;
        continue;
      }

      visual.targetPosition.set(player.position.x, player.position.y, player.position.z);
      const rising = player.velocity.y > 0 && visual.targetPosition.y > visual.group.position.y;
      const horizontalDamping = 1 - Math.exp(-delta * 10);
      const verticalDamping = rising ? 1 - Math.exp(-delta * 26) : horizontalDamping;
      visual.group.position.x = THREE.MathUtils.lerp(visual.group.position.x, visual.targetPosition.x, horizontalDamping);
      visual.group.position.y = THREE.MathUtils.lerp(visual.group.position.y, visual.targetPosition.y, verticalDamping);
      visual.group.position.z = THREE.MathUtils.lerp(visual.group.position.z, visual.targetPosition.z, horizontalDamping);
      const useLowDetail =
        !isLocal &&
        this.camera.position.distanceToSquared(visual.group.position) >
          PLAYER_DETAIL_DISTANCE * PLAYER_DETAIL_DISTANCE;
      visual.highDetail.visible = !useLowDetail;
      visual.lowDetail.visible = useLowDetail;

      const targetYaw = Math.atan2(player.facing.x, player.facing.z);
      visual.group.rotation.y = stepAngleToward(visual.group.rotation.y, targetYaw, delta * AVATAR_TURN_SPEED);

      const avatarVisualState = player.alive
        ? getPlayerAvatarVisualState(player.stunRemaining, elapsed)
        : {
            scaleX: 1,
            scaleY: 1,
            scaleZ: 1,
            blinkVisible: true
          };
      visual.avatar.scale.setScalar(1);
      visual.shell.scale.set(
        avatarVisualState.scaleX,
        avatarVisualState.scaleY,
        avatarVisualState.scaleZ
      );
      visual.shell.visible = avatarVisualState.blinkVisible;

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
      const poseState = getChickenPoseVisualState({
        grounded: player.grounded,
        velocityY: player.velocity.y,
        planarSpeed,
        elapsedTime: elapsed,
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
        const bombPulse =
          player.spacePhase === "superBoomImpact"
            ? 1.16 + Math.sin(elapsed * 34 + visual.motionSeed * 7) * 0.08
            : 1 + Math.sin(elapsed * 18 + visual.motionSeed * 6) * 0.06;
        if (player.spacePhase === "superBoomImpact") {
          visual.bomb.scale.set(
            SUPER_BOOM_BOMB_SCALE * bombPulse,
            SUPER_BOOM_BOMB_SCALE * 0.88,
            SUPER_BOOM_BOMB_SCALE * (1.02 + bombPulse * 0.02)
          );
          visual.bomb.rotation.set(0.08, elapsed * 4 + visual.motionSeed, Math.sin(elapsed * 22) * 0.06);
          visual.bomb.position.y = 0.68;
        } else {
          visual.bomb.scale.setScalar(SUPER_BOOM_BOMB_SCALE * bombPulse);
          visual.bomb.rotation.set(0, elapsed * 11 + visual.motionSeed * 2, 0);
          visual.bomb.position.y = 0.82;
        }
        visual.bombMaterial.emissiveIntensity =
          1.12 + Math.sin(elapsed * 20 + visual.motionSeed * 4) * 0.24;
        visual.bombMaterial.color.set("#fff0d9");
      } else {
        const holdAlpha = Math.max(eggLaunchChargeAlpha, eggReleaseAlpha);
        if (heldEggVisible) {
          visual.bomb.scale.setScalar(0.8 + holdAlpha * 0.16);
          visual.bomb.position.set(
            0.38 + eggLaunchChargeAlpha * 0.04,
            0.96 + holdAlpha * 0.03,
            0.16 - eggLaunchChargeAlpha * 0.12 + eggReleaseAlpha * 0.24
          );
          visual.bomb.rotation.set(
            0.18 + eggLaunchChargeAlpha * 0.4 - eggReleaseAlpha * 0.22,
            0.3 + holdAlpha * 0.45,
            -0.46 - eggLaunchChargeAlpha * 0.28 + eggReleaseAlpha * 0.22
          );
          visual.bombMaterial.color.set("#fff0d9");
          visual.bombMaterial.emissive.set("#ff4f3d");
          visual.bombMaterial.emissiveIntensity =
            eggVisualDefaults.emissiveMin + eggLaunchChargeAlpha * 0.18;
        } else {
          visual.bomb.scale.setScalar(1);
          visual.bomb.rotation.set(0, 0, 0);
          visual.bomb.position.set(0, 0.74, 0);
          visual.bombMaterial.color.set("#fff0d9");
          visual.bombMaterial.emissive.set("#ff4f3d");
          visual.bombMaterial.emissiveIntensity = eggVisualDefaults.emissiveMin;
        }
      }

      const shadowState = getPlayerBlobShadowState({
        playerY: player.position.y,
        surfaceY: Math.floor(player.position.y),
        isLocal,
        stunned: player.stunRemaining > 0
      });
      visual.shadow.position.set(0, shadowState.yOffset, 0);
      visual.shadow.scale.setScalar(shadowState.scale);
      visual.shadowMaterial.opacity = shadowState.opacity;

      const stride =
        !player.alive || player.stunRemaining > 0
          ? 0
          : Math.min(1, Math.hypot(player.velocity.x, player.velocity.z) / 5);
      const struggleSignal =
        stride > 0.08 ? Math.max(0, Math.sin(elapsed * 0.82 + visual.motionSeed * 0.35 + 0.6)) : 0;
      const struggleHop =
        struggleSignal > 0.95 ? Math.pow((struggleSignal - 0.95) / 0.05, 1.8) * stride : 0;
      const runWingLift = struggleHop * 0.42;
      visual.avatar.position.y =
        AVATAR_BOB_BASE_Y + Math.sin(elapsed * 10 + (isLocal ? 0 : 1.2)) * 0.05 * stride + struggleHop * 0.52;
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
        elapsedTime: elapsed,
        eggLaunchChargeAlpha,
        eggLaunchReleaseRemaining
      });
      const statusVisualState = getPlayerStatusVisualState(player.invulnerableRemaining, elapsed);
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
        const rightFeather = visual.rightWingFeatherlets[index];
        if (rightFeather) {
          const rightRotation = getChickenWingFeatherletRotation(
            wingFeatherletOffsets[index]!,
            poseState.featherSwing,
            -1
          );
          rightFeather.rotation.set(rightRotation.x, rightRotation.y, rightRotation.z);
        }
      });

      visual.previousGrounded = player.grounded;
      visual.previousVelocityY = player.velocity.y;
    }

    for (const id of remaining) {
      const visual = this.playerVisuals.get(id);
      if (visual) {
        this.playersGroup.remove(visual.group);
        disposePlayerVisual(visual);
        this.playerVisuals.delete(id);
      }
    }
  }

  private syncEggs(eggs: readonly RuntimeEggState[], elapsed: number) {
    const remaining = new Set(this.eggVisuals.keys());
    for (const egg of eggs) {
      let visual = this.eggVisuals.get(egg.id);
      if (!visual) {
        visual = createEggDisplayVisual();
        this.eggVisuals.set(egg.id, visual);
        this.eggsGroup.add(visual.group);
      }
      remaining.delete(egg.id);
      const eggVisualState = getEggVisualState(egg, elapsed, this.runtime.config.eggFuseDuration);
      visual.group.visible = true;
      visual.group.position.set(
        egg.position.x,
        egg.position.y + eggVisualState.jiggleY,
        egg.position.z
      );
      visual.group.rotation.set(
        eggVisualState.rotationX,
        eggVisualState.rotationY,
        eggVisualState.rotationZ
      );
      visual.group.scale.set(
        eggVisualState.scaleX,
        eggVisualState.scaleY,
        eggVisualState.scaleZ
      );
      visual.material.color.set("#fff0d9").lerp(new THREE.Color("#ff4f3d"), eggVisualState.heatAlpha);
      visual.material.emissive.set("#ff4f3d");
      visual.material.emissiveIntensity = eggVisualState.emissiveIntensity;
    }

    for (const id of remaining) {
      const visual = this.eggVisuals.get(id);
      if (visual) {
        this.eggsGroup.remove(visual.group);
        visual.material.dispose();
        this.eggVisuals.delete(id);
      }
    }
  }

  private syncEggScatterDebris(eggScatterDebris: EngineRuntimeRenderFrame["eggScatterDebris"]) {
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

  private syncVoxelBursts(voxelBursts: EngineRuntimeRenderFrame["voxelBursts"]) {
    const harvestCounts: Record<BlockRenderProfile, number> = {
      earthSurface: 0,
      earthSubsoil: 0,
      darkness: 0
    };
    const explosionTerrainCounts: Record<BlockRenderProfile, number> = {
      earthSurface: 0,
      earthSubsoil: 0,
      darkness: 0
    };
    let eggExplosionAccentCount = 0;
    let eggShockwaveCount = 0;

    for (const burst of voxelBursts) {
      const particleCount = getVoxelBurstParticleCount(burst);
      const profile = getVoxelBurstMaterialProfile(burst);

      if (burst.style === "harvest") {
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

      if (!profile) {
        continue;
      }

      const terrainResource = this.eggExplosionBurstMeshes.get(profile);
      for (let particleIndex = 0; particleIndex < particleCount; particleIndex += 1) {
        const particle = getVoxelBurstParticleState(burst, particleIndex);
        const isAccent = particle.bucket === "accent";
        const terrainInstanceIndex = explosionTerrainCounts[profile];
        if (
          (!isAccent && (!terrainResource || terrainInstanceIndex >= MAX_EGG_EXPLOSION_BURST_INSTANCES)) ||
          (isAccent && eggExplosionAccentCount >= MAX_EGG_EXPLOSION_ACCENT_INSTANCES)
        ) {
          continue;
        }

        voxelFxTempObject.position.set(particle.position.x, particle.position.y, particle.position.z);
        voxelFxTempObject.rotation.set(particle.rotationX, particle.rotationY, particle.rotationZ);
        voxelFxTempObject.scale.setScalar(particle.scale);
        voxelFxTempObject.updateMatrix();
        if (isAccent) {
          if (!this.eggExplosionAccentBurstMesh) {
            continue;
          }
          this.eggExplosionAccentBurstMesh.mesh.setMatrixAt(
            eggExplosionAccentCount,
            voxelFxTempObject.matrix
          );
          this.eggExplosionAccentBurstMesh.opacityAttribute.setX(
            eggExplosionAccentCount,
            particle.opacity
          );
          eggExplosionAccentCount += 1;
          continue;
        }

        if (!terrainResource) {
          continue;
        }
        terrainResource.mesh.setMatrixAt(terrainInstanceIndex, voxelFxTempObject.matrix);
        terrainResource.opacityAttribute.setX(terrainInstanceIndex, particle.opacity);
        explosionTerrainCounts[profile] += 1;
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
      finalizeDynamicOpacityMesh(
        this.eggExplosionBurstMeshes.get(profile) ?? null,
        explosionTerrainCounts[profile]
      );
    }
    finalizeDynamicOpacityMesh(this.eggExplosionAccentBurstMesh, eggExplosionAccentCount);
    finalizeDynamicOpacityMesh(this.eggExplosionShockwaveMesh, eggShockwaveCount);
  }

  private syncSkyDrops(skyDrops: readonly RuntimeSkyDropState[], elapsed: number) {
    const remaining = new Set(this.skyDropVisuals.keys());
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
        const ring = new THREE.Mesh(skyDropWarningRingGeometry, ringMaterial);
        ring.rotation.x = -Math.PI / 2;
        const beamMaterial = new THREE.MeshBasicMaterial({
          color: "#fff8df",
          opacity: 0.2,
          transparent: true
        });
        const beam = new THREE.Mesh(skyDropWarningBeamGeometry, beamMaterial);
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
      remaining.delete(skyDrop.id);
      const visualState = getSkyDropVisualState(skyDrop, elapsed);
      visual.ring.visible = visualState.warningVisible;
      visual.beam.visible = visualState.warningVisible;
      visual.ring.position.set(
        skyDrop.landingVoxel.x + 0.5,
        skyDrop.landingVoxel.y + 0.08,
        skyDrop.landingVoxel.z + 0.5
      );
      visual.ring.scale.setScalar(visualState.warningScale);
      visual.beam.position.set(
        skyDrop.landingVoxel.x + 0.5,
        skyDrop.landingVoxel.y + 0.8,
        skyDrop.landingVoxel.z + 0.5
      );
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

    for (const id of remaining) {
      const visual = this.skyDropVisuals.get(id);
      if (visual) {
        this.skyDropsGroup.remove(visual.group);
        visual.ringMaterial.dispose();
        visual.beamMaterial.dispose();
        this.skyDropVisuals.delete(id);
      }
    }
  }

  private syncClusters(clusters: readonly FallingClusterViewState[], elapsed: number) {
    const remaining = new Set(this.clusterVisuals.keys());
    for (const cluster of clusters) {
      let visual = this.clusterVisuals.get(cluster.id);
      if (!visual) {
        const group = new THREE.Group();
        const voxelsByProfile = new Map<BlockRenderProfile, FallingClusterViewState["voxels"]>();

        for (const voxel of cluster.voxels) {
          const profile = getBlockRenderProfile(voxel.kind, voxel.y);
          const bucket = voxelsByProfile.get(profile) ?? [];
          bucket.push(voxel);
          voxelsByProfile.set(profile, bucket);
        }

        const materials: THREE.MeshStandardMaterial[] = [];
        for (const [profile, voxels] of voxelsByProfile) {
          const materialSet = cloneFallingClusterMaterialSet(profile);
          const mesh = new THREE.InstancedMesh(sharedVoxelGeometry, materialSet, voxels.length);
          mesh.frustumCulled = false;
          for (let index = 0; index < voxels.length; index += 1) {
            const voxel = voxels[index]!;
            clusterTempObject.position.set(voxel.x + 0.5, voxel.y + 0.5, voxel.z + 0.5);
            clusterTempObject.rotation.set(0, 0, 0);
            clusterTempObject.scale.set(1, 1, 1);
            clusterTempObject.updateMatrix();
            mesh.setMatrixAt(index, clusterTempObject.matrix);
          }
          finalizeStaticInstancedMesh(mesh, voxels.length);
          group.add(mesh);
          materials.push(...materialSet);
        }

        this.clustersGroup.add(group);
        visual = {
          group,
          materials
        };
        this.clusterVisuals.set(cluster.id, visual);
      }
      remaining.delete(cluster.id);
      const visualState = getFallingClusterVisualState(cluster, elapsed);
      visual.group.position.set(visualState.shakeX, cluster.offsetY, visualState.shakeZ);
      for (const material of visual.materials) {
        material.emissiveIntensity = visualState.emissiveIntensity;
      }
    }

    for (const id of remaining) {
      const visual = this.clusterVisuals.get(id);
      if (visual) {
        this.clustersGroup.remove(visual.group);
        for (const material of visual.materials) {
          material.dispose();
        }
        this.clusterVisuals.delete(id);
      }
    }
  }

  private clearPortalScene() {
    for (const visual of this.portalVisuals.values()) {
      this.portalsGroup.remove(visual.group);
      disposePortalVisual(visual);
    }
    this.portalVisuals.clear();
    this.portalTriggerStates.clear();
    this.portalsGroup.visible = false;
  }

  private syncPortalScene() {
    if (this.mode !== "explore" || !this.portalScene || this.portalScene.portals.length === 0) {
      this.clearPortalScene();
      return;
    }

    this.portalsGroup.visible = true;
    const remaining = new Set(this.portalVisuals.keys());

    for (const descriptor of this.portalScene.portals) {
      const currentVisual = this.portalVisuals.get(descriptor.id);
      if (
        currentVisual &&
        !portalDescriptorsMatch(currentVisual.descriptor, descriptor)
      ) {
        this.portalsGroup.remove(currentVisual.group);
        disposePortalVisual(currentVisual);
        this.portalVisuals.delete(descriptor.id);
        this.portalTriggerStates.delete(descriptor.id);
      }

      if (!this.portalVisuals.has(descriptor.id)) {
        const visual = createPortalVisual(descriptor);
        this.portalVisuals.set(descriptor.id, visual);
        this.portalsGroup.add(visual.group);
      }

      if (!this.portalTriggerStates.has(descriptor.id)) {
        this.portalTriggerStates.set(descriptor.id, {
          armed: descriptor.armed,
          descriptor,
          playerInside: false
        });
      }

      remaining.delete(descriptor.id);
    }

    for (const portalId of remaining) {
      const visual = this.portalVisuals.get(portalId);
      if (visual) {
        this.portalsGroup.remove(visual.group);
        disposePortalVisual(visual);
      }
      this.portalVisuals.delete(portalId);
      this.portalTriggerStates.delete(portalId);
    }
  }

  private syncPortalVisuals(elapsed: number) {
    if (this.portalVisuals.size === 0) {
      return;
    }

    for (const [portalId, visual] of this.portalVisuals) {
      const triggerState = this.portalTriggerStates.get(portalId);
      const armed = triggerState?.armed ?? visual.descriptor.armed;
      const pulse = 0.74 + Math.sin(elapsed * 4.8 + hashString(portalId) * 0.0005) * 0.14;
      visual.fillMaterial.opacity = (armed ? 0.82 : 0.28) * pulse;
      portalTempColor
        .set(visual.descriptor.variant === "exit" ? "#ffbf64" : "#83e0ff")
        .multiplyScalar(armed ? 1 : 0.62);
      visual.fillMaterial.color.copy(portalTempColor);
      visual.group.position.y =
        visual.descriptor.anchor.y + Math.sin(elapsed * 2.4 + hashString(portalId) * 0.0002) * 0.04;
      visual.group.scale.setScalar(armed ? 1 : 0.96);
    }
  }

  private isPlayerInsidePortal(
    player: Pick<RuntimePlayerState, "position">,
    descriptor: PortalSceneDescriptor
  ) {
    const deltaX = player.position.x - descriptor.anchor.x;
    const deltaY = player.position.y - descriptor.anchor.y;
    const deltaZ = player.position.z - descriptor.anchor.z;
    return (
      Math.hypot(deltaX, deltaZ) <= descriptor.triggerRadius &&
      Math.abs(deltaY) <= descriptor.triggerHalfHeight
    );
  }

  private buildPortalTraversalSnapshot(player: RuntimePlayerState): PortalTraversalSnapshot {
    const speed = Math.hypot(player.velocity.x, player.velocity.y, player.velocity.z);
    const rotationY = this.lookYaw ?? getYawFromPlanarVector(player.facing);
    return {
      speed,
      speedX: player.velocity.x,
      speedY: player.velocity.y,
      speedZ: player.velocity.z,
      rotationX: this.lookPitch,
      rotationY,
      rotationZ: 0
    };
  }

  private maybeTriggerPortal(frame: EngineRuntimeRenderFrame | null) {
    if (
      this.mode !== "explore" ||
      this.portalTraversalPending ||
      !frame?.localPlayerId ||
      this.portalTriggerStates.size === 0
    ) {
      return;
    }

    const localPlayer =
      frame.players.find((player) => player.id === frame.localPlayerId) ?? null;
    if (
      !localPlayer ||
      !localPlayer.alive ||
      localPlayer.respawning ||
      localPlayer.fallingOut
    ) {
      return;
    }

    for (const triggerState of this.portalTriggerStates.values()) {
      const inside = this.isPlayerInsidePortal(localPlayer, triggerState.descriptor);

      if (!triggerState.armed) {
        if (inside) {
          triggerState.playerInside = true;
          continue;
        }

        if (triggerState.playerInside) {
          triggerState.armed = true;
          triggerState.playerInside = false;
        }
        continue;
      }

      if (inside && !triggerState.playerInside) {
        this.portalTraversalPending = true;
        triggerState.playerInside = true;
        this.post({
          type: "portal_triggered",
          portalId: triggerState.descriptor.id,
          snapshot: this.buildPortalTraversalSnapshot(localPlayer)
        });
        return;
      }

      triggerState.playerInside = inside;
    }
  }

  private renderFrame(delta: number) {
    if (!this.renderer) {
      return;
    }

    this.syncSunShadowMode();
    this.sunShadows.setLightIntensity(this.directionalLight.intensity);
    this.sunShadows.update();
    const shouldSignalReady = !this.hasRenderedFrame || this.readyToDisplayPending;
    this.renderer.render(this.scene, this.camera);
    this.hasRenderedFrame = true;

    this.frameSamples[this.frameSampleIndex] = delta * 1000;
    this.frameSampleIndex = (this.frameSampleIndex + 1) % this.frameSamples.length;
    this.frameSampleCount = Math.min(this.frameSampleCount + 1, this.frameSamples.length);
    this.diagnosticsCooldown += delta;
    if (this.diagnosticsCooldown >= 1) {
      this.diagnosticsCooldown = 0;
      this.postDiagnostics();
      if (shouldSignalReady) {
        this.readyToDisplayPending = false;
        this.post({
          type: "ready_to_display"
        });
      }
    }
  }

  private buildRenderDiagnostics(): GameRenderDiagnostics | undefined {
    if (!this.renderer) {
      return undefined;
    }

    const { fps, p95FrameMs } = summarizeFrameSamples(
      this.frameSamples,
      this.frameSampleCount
    );
    const terrainDrawCalls = [...this.terrainChunkStats.values()].reduce((sum, stats) => sum + stats.drawCallCount, 0);
    const terrainTriangles = [...this.terrainChunkStats.values()].reduce((sum, stats) => sum + stats.triangleCount, 0);
    const profile = getRendererQualityProfileForTier(this.qualityTier);
    return {
      fps,
      p95FrameMs,
      renderCalls: this.renderer.info.render.calls,
      renderTriangles: this.renderer.info.render.triangles,
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
      terrainChunkCount: this.terrainMeshes.size,
      terrainDrawCalls,
      terrainTriangles,
      qualityTier: this.qualityTier,
      targetFps: profile.budgets.targetFps,
      ...this.sunShadows.getDiagnostics()
    };
  }

  private postDiagnostics() {
    const diagnostics: GameDiagnostics = {
      mode: this.mode,
      tick:
        this.mode === "editor"
          ? 0
          : this.mode === "multiplayer"
            ? this.latestExternalFrame?.tick ?? 0
            : this.runtime.getMatchState().tick,
      terrainRevision: this.getActiveWorld()?.getTerrainRevision() ?? 0,
      dirtyChunkCount: this.latestDirtyChunkCount,
      runtime: this.mode === "editor" || this.mode === "multiplayer" ? EMPTY_DIAGNOSTICS : this.latestRuntimeDiagnostics,
      render: this.buildRenderDiagnostics()
    };
    this.post({
      type: "diagnostics",
      diagnostics
    });
  }

  private postHudState(hudState: EngineRuntimeRenderFrame["hudState"] | null) {
    this.post({
      type: "hud_state",
      hudState
    });
  }

  private postEditorState() {
    this.post({
      type: "editor_state",
      editorState: this.editorState
    });
  }

  private post(message: WorkerResponseMessage, transferables: Transferable[] = []) {
    this.scope.postMessage(message, transferables);
  }

  private handleSetEditorState(message: Extract<WorkerRequestMessage, { type: "set_editor_state" }>) {
    if (message.tool) {
      this.editorState = { ...this.editorState, tool: message.tool };
    }
    if (message.blockKind) {
      this.editorState = { ...this.editorState, blockKind: message.blockKind };
    }
    if (message.propKind) {
      this.editorState = { ...this.editorState, propKind: message.propKind };
    }
    if (message.featureKind) {
      this.editorState = { ...this.editorState, featureKind: message.featureKind };
    }
    if (message.featureDirection) {
      this.editorState = {
        ...this.editorState,
        featureDirection: message.featureDirection
      };
    }
    if (typeof message.mapName === "string") {
      const trimmed = message.mapName.trimStart();
      this.editorWorld.meta.name = trimmed || "Untitled Arena";
      this.editorWorld.touchMeta();
      this.editorState = {
        ...this.editorState,
        mapName: message.mapName
      };
    }
    this.postEditorState();
  }

  private handlePointerButton(message: Extract<WorkerRequestMessage, { type: "pointer_button" }>) {
    if (this.mode === "editor" && message.eventType === "down" && message.button === PRIMARY_POINTER_BUTTON) {
      this.performEditorActionFromScreenPoint(message.clientX, message.clientY);
      return;
    }

    if (!isRuntimeMode(this.mode) || this.presentation === "menu") {
      return;
    }

    if (message.button === PRIMARY_POINTER_BUTTON) {
      this.destroyHeld = message.eventType === "down";
      return;
    }

    if (message.button === SECONDARY_POINTER_BUTTON) {
      if (message.eventType === "down") {
        this.startEggPointerAction();
        return;
      }

      if (message.eventType === "up") {
        this.releaseEggAction(this.eggPointerAction, "pointer");
        return;
      }
    }

    if (message.eventType === "cancel") {
      this.destroyHeld = false;
      if (this.eggChargeState.source === "pointer") {
        this.cancelEggCharge(false);
      }
      this.resetHoldAction(this.eggPointerAction);
    }
  }

  private handleKeyEvent(message: Extract<WorkerRequestMessage, { type: "key_event" }>) {
    if (
      message.eventType === "down" &&
      message.key.length === 1 &&
      isRuntimeMode(this.mode) &&
      this.hasActiveRuntimeCapture() &&
      !this.runtimePaused &&
      !message.metaKey &&
      !message.ctrlKey
    ) {
      this.pendingTypedText += message.key;
    }

    if (message.code === "KeyW") {
      if (message.eventType === "down" && !message.repeat) {
        if (this.forwardTapReleased && message.timeMs - this.lastForwardTapAtMs <= DOUBLE_TAP_WINDOW_MS) {
          this.pushQueued = true;
          this.keyboardState.pushPressed = true;
        }
        this.lastForwardTapAtMs = message.timeMs;
        this.forwardTapReleased = false;
      }
      if (message.eventType === "up") {
        this.forwardTapReleased = true;
      }
    }

    switch (message.code) {
      case "KeyW":
      case "ArrowUp":
        this.keyboardState.forward = message.eventType === "down";
        return;
      case "KeyS":
      case "ArrowDown":
        this.keyboardState.backward = message.eventType === "down";
        return;
      case "KeyA":
      case "ArrowLeft":
        this.keyboardState.left = message.eventType === "down";
        return;
      case "KeyD":
      case "ArrowRight":
        this.keyboardState.right = message.eventType === "down";
        return;
      case "Space":
        if (message.eventType === "down") {
          if (!this.keyboardState.jump) {
            this.keyboardState.jumpPressed = true;
          }
          this.keyboardState.jump = true;
        } else {
          if (this.keyboardState.jump) {
            this.keyboardState.jumpReleased = true;
          }
          this.keyboardState.jump = false;
        }
        return;
      case "KeyF":
        if (!message.metaKey && !message.ctrlKey) {
          this.keyboardState.placePressed = message.eventType === "down";
        }
        return;
      case "KeyQ":
      case "KeyE":
        if (message.metaKey || message.ctrlKey) {
          return;
        }
        if (message.eventType === "down" && !message.repeat) {
          this.activeEggKeyCodes.add(message.code);
          this.keyboardState.egg = true;
          if (this.activeEggKeyCodes.size === 1) {
            this.eggKeyAction.pressed = true;
            this.eggKeyAction.startedAt = this.clock.getElapsedTime();
            this.eggKeyAction.holdTriggered = false;
          }
          return;
        }
        if (message.eventType === "up") {
          this.activeEggKeyCodes.delete(message.code);
          this.keyboardState.egg = this.activeEggKeyCodes.size > 0;
          if (this.activeEggKeyCodes.size === 0) {
            this.releaseEggAction(this.eggKeyAction, "key");
          }
        }
        return;
      default:
        return;
    }
  }

  private handleExternalMessage(message: SourceWorkerResponseMessage) {
    switch (message.type) {
      case "world_sync":
        this.mode = message.mode;
        this.syncPortalScene();
        this.latestDirtyChunkCount = message.world.chunkPatches.length;
        this.applyFullWorld(message.world.document, message.world.chunkPatches);
        this.readyToDisplayPending = true;
        return;
      case "terrain_patches":
        this.latestDirtyChunkCount = message.patches.length;
        this.applyTerrainPatches(message.patches);
        return;
      case "frame": {
        const previousBurningPropIds = this.getFrameBurningPropIds(this.latestExternalFrame);
        this.latestExternalFrame = message.frame;
        this.recordRecentExplosionImpacts(
          message.frame.authoritative?.gameplayEventBatch ?? null,
          message.frame.time
        );
        if (
          this.applyMultiplayerTerrainDeltaBatchToRuntimeWorld(
            message.frame.authoritative?.terrainDeltaBatch ?? null,
            previousBurningPropIds
          )
        ) {
          this.rebuildProps(this.currentDocument);
        }
        this.postHudState(message.frame.hudState);
        return;
      }
      case "hud_state":
        this.postHudState(message.hudState);
        return;
      case "status":
        this.post({
          type: "status",
          message: message.message
        });
        return;
      case "editor_state":
        this.editorState = message.editorState;
        this.postEditorState();
        return;
      case "editor_document":
      case "diagnostics":
      case "ready":
        return;
    }
  }

  private resize(viewportWidth: number, viewportHeight: number, devicePixelRatio: number) {
    this.viewportWidth = Math.max(1, viewportWidth);
    this.viewportHeight = Math.max(1, viewportHeight);
    this.devicePixelRatio = Math.max(1, devicePixelRatio);
    this.camera.aspect = this.viewportWidth / this.viewportHeight;
    this.camera.updateProjectionMatrix();
    this.sunShadows.handleCameraProjectionChange();
    if (this.renderer) {
      this.renderer.setPixelRatio(this.devicePixelRatio);
      this.renderer.setSize(this.viewportWidth, this.viewportHeight, false);
    }
  }

  private applyFullWorld(document: MapDocumentV1, patches: TerrainChunkPatchPayload[]) {
    this.currentDocument = normalizeArenaBudgetMapDocument(document);
    this.runtimeWorld = new MutableVoxelWorld(this.currentDocument);
    this.resetPropRemainsState();
    this.clearTerrain();
    this.applyTerrainPatches(patches);
    this.rebuildWaterfalls(this.currentDocument);
    this.rebuildProps(this.currentDocument);
    this.rebuildSkyLayers(this.currentDocument);
  }

  private buildFullTerrainPatches(world: MutableVoxelWorld) {
    return world.buildVisibleChunks(DEFAULT_CHUNK_SIZE).map((chunk) => buildChunkPatch(world, chunk.key));
  }

  private clearTerrain() {
    for (const mesh of this.terrainMeshes.values()) {
      mesh.geometry.dispose();
      this.terrainGroup.remove(mesh);
    }
    this.terrainMeshes.clear();
    this.terrainChunkStats.clear();
  }

  private clearWaterfalls() {
    for (const visual of this.waterfallVisuals.values()) {
      this.waterfallsGroup.remove(visual.group);
      disposeWaterfallVisual(visual);
    }

    this.waterfallVisuals.clear();
  }

  private rebuildWaterfalls(document: MapDocumentV1) {
    this.clearWaterfalls();

    for (const feature of document.waterfalls) {
      const visual = createWaterfallVisual(feature);
      this.waterfallsGroup.add(visual.group);
      this.waterfallVisuals.set(feature.id, visual);
    }
  }

  private syncWaterfalls(elapsed: number) {
    for (const visual of this.waterfallVisuals.values()) {
      syncWaterfallVisual(visual, elapsed, this.camera.position, this.qualityTier);
    }
  }

  private applyTerrainPatches(patches: TerrainChunkPatchPayload[]) {
    for (const patch of patches) {
      const existing = this.terrainMeshes.get(patch.key);
      if (patch.remove) {
        if (existing) {
          existing.geometry.dispose();
          this.terrainGroup.remove(existing);
          this.terrainMeshes.delete(patch.key);
          this.terrainChunkStats.delete(patch.key);
        }
        continue;
      }

      const geometry = createTerrainGeometry(patch);
      const mesh =
        existing ??
        new THREE.Mesh(geometry, getTerrainChunkMaterials());
      if (existing) {
        existing.geometry.dispose();
      }
      mesh.geometry = geometry;
      mesh.material = getTerrainChunkMaterials();
      mesh.position.set(...patch.position);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      if (!existing) {
        this.terrainGroup.add(mesh);
        this.terrainMeshes.set(patch.key, mesh);
      }
      this.terrainChunkStats.set(patch.key, {
        drawCallCount: patch.drawCallCount,
        triangleCount: patch.triangleCount
      });
    }
  }

  private getDefaultLeafPropMaterial(propKind: MapProp["kind"]) {
    if (propKind === "tree-pine") {
      return propMaterials.leavesPine;
    }

    if (propKind === "tree-autumn") {
      return propMaterials.leavesAutumn;
    }

    return propMaterials.leavesOak;
  }

  private getDefaultVoxelPropMaterial(
    propKind: MapProp["kind"],
    voxelKind: "wood" | "leaves"
  ) {
    return voxelKind === "wood"
      ? propMaterials.bark
      : this.getDefaultLeafPropMaterial(propKind);
  }

  private restorePropVisualDefaults(visual: PropVisual) {
    for (const mesh of visual.voxelMeshes) {
      mesh.material = this.getDefaultVoxelPropMaterial(
        visual.prop.kind,
        mesh.userData.voxelKind
      );
      if (mesh.userData.burningMaterial) {
        mesh.userData.burningMaterial.dispose();
        mesh.userData.burningMaterial = null;
      }
    }

    for (const emitter of visual.flameEmitters) {
      visual.group.remove(emitter.group);
      emitter.material.dispose();
    }
    visual.flameEmitters = [];

    if (visual.emberMaterial) {
      visual.emberMaterial.dispose();
      visual.emberMaterial = null;
    }
    for (const emberMesh of visual.emberMeshes) {
      visual.group.remove(emberMesh);
    }
    visual.emberMeshes = [];

    if (visual.smokeMaterial) {
      visual.smokeMaterial.dispose();
      visual.smokeMaterial = null;
    }
    for (const smokeMesh of visual.smokeMeshes) {
      visual.group.remove(smokeMesh);
    }
    visual.smokeMeshes = [];

    visual.burningFxState = null;
    visual.group.position.copy(visual.center);
    visual.group.rotation.set(0, 0, 0);
  }

  private ensurePropVisualBurningAssets(visual: PropVisual, frameTime: number) {
    if (!visual.burningFxState) {
      visual.burningFxState = createBurningTreeFxState({
        id: `burning-prop-${visual.prop.id}`,
        duration: BURNING_TREE_STANDING_DURATION,
        ignitionOrigin: this.resolveBurningIgnitionOrigin(visual, frameTime),
        prop: visual.prop
      });
    }

    for (const mesh of visual.voxelMeshes) {
      if (!mesh.userData.burningMaterial) {
        const burningMaterial = this.getDefaultVoxelPropMaterial(
          visual.prop.kind,
          mesh.userData.voxelKind
        ).clone() as THREE.MeshStandardMaterial;
        burningMaterial.emissive = new THREE.Color(
          mesh.userData.voxelKind === "wood" ? "#ff6c23" : "#ff962f"
        );
        burningMaterial.emissiveIntensity = 0;
        burningMaterial.color.setRGB(1, 1, 1);
        burningMaterial.needsUpdate = true;
        mesh.userData.burningMaterial = burningMaterial;
        this.sunShadows.trackMaterial(burningMaterial);
      }
      mesh.material = mesh.userData.burningMaterial;
    }

    if (visual.flameEmitters.length === 0) {
      visual.flameEmitters = Array.from(
        { length: MAX_BURNING_PROP_FLAME_EMITTERS },
        (_, index) => {
          const material = new THREE.MeshBasicMaterial({
            alphaTest: 0.24,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            map: propFxTextures.flameFrames[0] ?? null,
            opacity: 0,
            side: THREE.DoubleSide,
            toneMapped: false,
            transparent: true
          });
          const group = new THREE.Group();
          const quads = [0, 1].map((quadIndex) => {
            const mesh = new THREE.Mesh(flameCardGeometry, material);
            mesh.castShadow = false;
            mesh.receiveShadow = false;
            mesh.frustumCulled = false;
            mesh.rotation.y = quadIndex * (Math.PI / 2);
            group.add(mesh);
            return mesh;
          });
          group.visible = false;
          visual.group.add(group);
          return {
            currentFrame: 0,
            group,
            material,
            quads,
            seed: (index + 1) * 0.173 + hashString(`${visual.prop.id}:flame:${index}`) * 0.0000001
          };
        }
      );
    }

    if (!visual.emberMaterial) {
      visual.emberMaterial = new THREE.MeshBasicMaterial({
        color: "#ffb15a",
        transparent: true,
        opacity: 0.86,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false
      });
      visual.emberMeshes = Array.from(
        { length: MAX_BURNING_PROP_EMBER_PARTICLES },
        () => {
        const mesh = new THREE.Mesh(sharedVoxelGeometry, visual.emberMaterial!);
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        mesh.frustumCulled = false;
        mesh.visible = false;
        visual.group.add(mesh);
        return mesh;
        }
      );
    }

    if (!visual.smokeMaterial) {
      visual.smokeMaterial = new THREE.MeshBasicMaterial({
        color: "#48362d",
        transparent: true,
        opacity: 0.34,
        blending: THREE.NormalBlending,
        depthWrite: false,
        toneMapped: false
      });
      visual.smokeMeshes = Array.from(
        { length: MAX_BURNING_PROP_SMOKE_PARTICLES },
        () => {
        const mesh = new THREE.Mesh(sharedVoxelGeometry, visual.smokeMaterial!);
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        mesh.frustumCulled = false;
        mesh.visible = false;
        visual.group.add(mesh);
        return mesh;
        }
      );
    }
  }

  private disposePropVisual(visual: PropVisual) {
    this.restorePropVisualDefaults(visual);
  }

  private syncBurningProps(
    burningProps: EngineRuntimeRenderFrame["burningProps"],
    elapsed: number
  ) {
    const burningById = new Map(burningProps.map((prop) => [prop.id, prop]));
    const frameTime =
      (this.mode === "multiplayer" ? this.latestExternalFrame?.time : this.latestRuntimeFrame?.time) ??
      elapsed;

    for (const [propId, visual] of this.propVisuals) {
      const burningProp = burningById.get(propId);
      if (!burningProp) {
        this.restorePropVisualDefaults(visual);
        continue;
      }

      this.ensurePropVisualBurningAssets(visual, frameTime);
      const burnElapsed = THREE.MathUtils.clamp(
        BURNING_TREE_STANDING_DURATION - burningProp.remaining,
        0,
        BURNING_TREE_STANDING_DURATION
      );
      const activeVoxelIndices = getBurningTreeActiveVoxelIndices(
        visual.burningFxState!,
        burnElapsed,
        MAX_BURNING_PROP_FLAME_EMITTERS
      );
      const smokeVoxelIndices = getBurningTreeActiveVoxelIndices(
        visual.burningFxState!,
        burnElapsed,
        MAX_BURNING_PROP_SMOKE_PARTICLES
      );
      visual.group.position.copy(visual.center);
      visual.group.rotation.set(0, 0, 0);

      visual.voxelMeshes.forEach((mesh, voxelIndex) => {
        const voxelMaterial = mesh.userData.burningMaterial;
        if (!voxelMaterial) {
          return;
        }

        const voxelState = getBurningTreeVoxelVisualState(
          visual.burningFxState!,
          voxelIndex,
          burnElapsed
        );
        const isCharred = voxelState.phase === "charred";
        if (mesh.userData.voxelKind === "wood") {
          const charBlend = isCharred
            ? Math.max(0.9, voxelState.charAlpha)
            : Math.min(0.84, voxelState.charAlpha * 0.96);
          voxelMaterial.color.setRGB(
            THREE.MathUtils.lerp(1, 0.22, charBlend),
            THREE.MathUtils.lerp(1, 0.16, charBlend),
            THREE.MathUtils.lerp(1, 0.1, charBlend)
          );
        } else {
          const charBlend = isCharred
            ? Math.max(0.94, voxelState.charAlpha)
            : Math.min(0.9, voxelState.charAlpha * 0.98);
          voxelMaterial.color.setRGB(
            THREE.MathUtils.lerp(1, 0.18, charBlend),
            THREE.MathUtils.lerp(1, 0.13, charBlend),
            THREE.MathUtils.lerp(1, 0.09, charBlend)
          );
        }
        voxelMaterial.emissiveIntensity =
          voxelState.flameAlpha * (mesh.userData.voxelKind === "wood" ? 0.56 : 0.78) +
          voxelState.emberAlpha * (isCharred ? 0.18 : 0.15);
      });

      visual.flameEmitters.forEach((emitter, emitterIndex) => {
        const voxelIndex = activeVoxelIndices[emitterIndex];
        if (voxelIndex === undefined) {
          emitter.group.visible = false;
          return;
        }

        const voxelState = getBurningTreeVoxelVisualState(
          visual.burningFxState!,
          voxelIndex,
          burnElapsed
        );
        if (voxelState.flameAlpha <= 0.04) {
          emitter.group.visible = false;
          return;
        }

        const voxelMesh = visual.voxelMeshes[voxelIndex];
        if (!voxelMesh) {
          emitter.group.visible = false;
          return;
        }

        const frameIndex = Math.floor(
          (elapsed * 11.5 + emitter.seed * 19) % propFxTextures.flameFrames.length
        );
        if (frameIndex !== emitter.currentFrame) {
          emitter.currentFrame = frameIndex;
          emitter.material.map = propFxTextures.flameFrames[frameIndex] ?? null;
          emitter.material.needsUpdate = true;
        }

        const wobble = Math.sin(elapsed * 8.8 + emitter.seed * 6.7) * 0.04;
        const jitterX = Math.sin(elapsed * 6.1 + emitter.seed * 11.3) * 0.06;
        const jitterZ = Math.cos(elapsed * 7.4 + emitter.seed * 9.1) * 0.06;
        const baseScale = voxelMesh.userData.voxelKind === "wood" ? 0.44 : 0.58;
        emitter.material.opacity = Math.min(
          1,
          voxelState.flameAlpha * (0.9 + Math.sin(elapsed * 14.2 + emitter.seed * 17) * 0.18)
        );
        emitter.group.visible = emitter.material.opacity > 0.05;
        emitter.group.position.set(
          voxelMesh.userData.localPosition.x + jitterX,
          voxelMesh.userData.localPosition.y +
            (voxelMesh.userData.voxelKind === "wood" ? 0.12 : 0.2) +
            voxelState.flameAlpha * 0.18,
          voxelMesh.userData.localPosition.z + jitterZ
        );
        emitter.group.rotation.set(0, emitter.seed * Math.PI * 2 + wobble, 0);
        emitter.group.scale.setScalar(baseScale + voxelState.flameAlpha * 0.42);
      });

      if (visual.emberMaterial) {
        visual.emberMaterial.opacity = 0.72;
      }
      visual.emberMeshes.forEach((mesh, index) => {
        const voxelIndex =
          activeVoxelIndices.length > 0
            ? activeVoxelIndices[index % activeVoxelIndices.length]!
            : null;
        if (voxelIndex === null || voxelIndex === undefined) {
          mesh.visible = false;
          return;
        }

        const voxelMesh = visual.voxelMeshes[voxelIndex];
        const voxelState = getBurningTreeVoxelVisualState(
          visual.burningFxState!,
          voxelIndex,
          burnElapsed
        );
        if (!voxelMesh || voxelState.emberAlpha <= 0.04) {
          mesh.visible = false;
          return;
        }

        const loop = (elapsed * (1.4 + (index % 3) * 0.38) + index * 0.17) % 1;
        const yaw = emitterSeed(index, visual.prop.id);
        const driftRadius = 0.08 + (index % 4) * 0.03 + voxelState.flameAlpha * 0.14;
        mesh.visible = true;
        mesh.position.set(
          voxelMesh.userData.localPosition.x + Math.cos(yaw + loop * Math.PI * 2) * driftRadius,
          voxelMesh.userData.localPosition.y + 0.08 + loop * (0.24 + voxelState.emberAlpha * 0.54),
          voxelMesh.userData.localPosition.z + Math.sin(yaw + loop * Math.PI * 2) * driftRadius
        );
        mesh.scale.setScalar(0.05 + voxelState.emberAlpha * 0.1 + (index % 3) * 0.014);
        mesh.rotation.set(loop * Math.PI * 4, yaw, loop * Math.PI * 2.6);
      });

      if (visual.smokeMaterial) {
        visual.smokeMaterial.opacity = 0.44;
      }
      visual.smokeMeshes.forEach((mesh, index) => {
        const voxelIndex =
          smokeVoxelIndices.length > 0
            ? smokeVoxelIndices[index % smokeVoxelIndices.length]!
            : null;
        if (voxelIndex === null || voxelIndex === undefined) {
          mesh.visible = false;
          return;
        }

        const voxelMesh = visual.voxelMeshes[voxelIndex];
        const voxelState = getBurningTreeVoxelVisualState(
          visual.burningFxState!,
          voxelIndex,
          burnElapsed
        );
        if (!voxelMesh || voxelState.smokeAlpha <= 0.04) {
          mesh.visible = false;
          return;
        }

        const loop = (elapsed * (0.42 + index * 0.08) + index * 0.21) % 1;
        const driftAngle = emitterSeed(index + 19, visual.prop.id);
        const lateralRadius = 0.12 + voxelState.smokeAlpha * 0.2 + (index % 4) * 0.02;
        mesh.visible = true;
        mesh.position.set(
          voxelMesh.userData.localPosition.x + Math.cos(driftAngle + loop * 1.7) * lateralRadius,
          voxelMesh.userData.localPosition.y + 0.2 + loop * (0.64 + voxelState.smokeAlpha * 0.82),
          voxelMesh.userData.localPosition.z + Math.sin(driftAngle + loop * 1.7) * lateralRadius
        );
        mesh.scale.setScalar(0.12 + voxelState.smokeAlpha * 0.34 + loop * 0.18);
        mesh.rotation.set(loop * 0.32, driftAngle, loop * 0.08);
      });
    }
  }

  private rebuildProps(document: MapDocumentV1) {
    for (const visual of this.propVisuals.values()) {
      this.disposePropVisual(visual);
    }

    this.propVisuals.clear();
    this.propsGroup.clear();
    for (const prop of document.props) {
      const voxels = getMapPropVoxels(prop);
      const center = voxels.reduce(
        (accumulator, voxel) =>
          accumulator.add(new THREE.Vector3(voxel.x + 0.5, voxel.y + 0.5, voxel.z + 0.5)),
        new THREE.Vector3()
      ).multiplyScalar(1 / Math.max(1, voxels.length));
      const group = new THREE.Group();
      group.position.copy(center);
      const voxelMeshes = voxels.map((voxel) => {
        const mesh = new THREE.Mesh(
          this.propGeometry,
          voxel.kind === "wood"
            ? propMaterials.bark
            : this.getDefaultLeafPropMaterial(prop.kind)
        ) as unknown as PropVoxelMesh;
        mesh.userData = {
          burningMaterial: null,
          localPosition: new THREE.Vector3(
            voxel.x + 0.5 - center.x,
            voxel.y + 0.5 - center.y,
            voxel.z + 0.5 - center.z
          ),
          voxelKind: voxel.kind
        };
        mesh.position.copy(mesh.userData.localPosition);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
        return mesh;
      });

      const visual: PropVisual = {
        prop,
        center,
        burningFxState: null,
        flameEmitters: [],
        group,
        voxelMeshes,
        emberMeshes: [],
        emberMaterial: null,
        smokeMeshes: [],
        smokeMaterial: null
      };
      this.propVisuals.set(prop.id, visual);
      this.propsGroup.add(group);
    }
  }

  private performEditorActionFromScreenPoint(clientX: number, clientY: number) {
    if (this.editorState.tool === "erase") {
      const waterfallHit = this.raycastWaterfallsFromScreenPoint(clientX, clientY)[0];
      const terrainHit = this.raycastTerrainFromScreenPoint(clientX, clientY)[0];

      if (waterfallHit && (!terrainHit || waterfallHit.distance <= terrainHit.distance)) {
        const waterfallFeatureId = waterfallHit.object.userData.waterfallFeatureId;
        if (typeof waterfallFeatureId === "string" && this.editorWorld.removeWaterfall(waterfallFeatureId)) {
          this.applyFullWorld(this.editorWorld.toDocument(), this.buildFullTerrainPatches(this.editorWorld));
          this.readyToDisplayPending = true;
          this.post({
            type: "status",
            message: "Removed a waterfall."
          });
          return;
        }
      }
    }

    const intersections = this.raycastTerrainFromScreenPoint(clientX, clientY);
    const firstHit = intersections[0];
    if (!firstHit) {
      return;
    }

    const worldNormal = getWorldNormalFromIntersection(firstHit);
    const terrainHit = resolveTerrainRaycastHit(firstHit.point, worldNormal);
    if (!terrainHit) {
      return;
    }

    this.applyEditorAction(terrainHit.voxel, terrainHit.normal);
  }

  private raycastTerrainFromScreenPoint(clientX: number, clientY: number) {
    const x = (clientX / this.viewportWidth) * 2 - 1;
    const y = -(clientY / this.viewportHeight) * 2 + 1;
    this.pointerVector.set(x, y);
    this.raycaster.setFromCamera(this.pointerVector, this.camera);
    return this.raycaster.intersectObjects([...this.terrainMeshes.values()], true);
  }

  private raycastWaterfallsFromScreenPoint(clientX: number, clientY: number) {
    const x = (clientX / this.viewportWidth) * 2 - 1;
    const y = -(clientY / this.viewportHeight) * 2 + 1;
    this.pointerVector.set(x, y);
    this.raycaster.setFromCamera(this.pointerVector, this.camera);
    return this.raycaster.intersectObjects(
      [...this.waterfallVisuals.values()].map((visual) => visual.sheetMesh),
      true
    );
  }

  private applyEditorAction(voxel: { x: number; y: number; z: number }, normal: { x: number; y: number; z: number }) {
    if (this.mode !== "editor") {
      return;
    }

    let dirtyChunkKeys: string[] = [];
    let touchedTerrain = false;
    let requiresFullWorldSync = false;

    if (this.editorState.tool === "erase") {
      const waterfall = this.editorWorld.findWaterfallAtOrigin(voxel.x, voxel.y, voxel.z);
      if (waterfall) {
        this.editorWorld.removeWaterfall(waterfall.id);
        requiresFullWorldSync = true;
        this.post({
          type: "status",
          message: "Removed a waterfall."
        });
      } else {
        const prop = this.editorWorld.getPropAtVoxel(voxel.x, voxel.y, voxel.z);
        if (prop) {
          this.editorWorld.removeProp(prop.id);
          requiresFullWorldSync = true;
          this.post({
            type: "status",
            message: "Removed a tree."
          });
        } else {
          dirtyChunkKeys = [...this.editorWorld.removeVoxel(voxel.x, voxel.y, voxel.z)];
          touchedTerrain = dirtyChunkKeys.length > 0;
        }
      }
    } else if (this.editorState.tool === "add") {
      const placement = {
        x: voxel.x + normal.x,
        y: voxel.y + normal.y,
        z: voxel.z + normal.z
      };
      if (this.editorWorld.hasOccupiedVoxel(placement.x, placement.y, placement.z)) {
        this.post({
          type: "status",
          message: "That space is already occupied."
        });
      } else {
        dirtyChunkKeys = [...this.editorWorld.setVoxel(placement.x, placement.y, placement.z, this.editorState.blockKind)];
        touchedTerrain = dirtyChunkKeys.length > 0;
      }
    } else if (this.editorState.tool === "prop") {
      const placement = this.editorWorld.getEditablePropPlacement(this.editorState.propKind, voxel.x, voxel.z);
      if (!placement) {
        this.post({
          type: "status",
          message: "Tree placement is blocked on that column."
        });
      } else {
        this.editorWorld.setProp(this.editorState.propKind, placement.x, placement.y, placement.z);
        requiresFullWorldSync = true;
        this.post({
          type: "status",
          message: "Placed a tree."
        });
      }
    } else if (this.editorState.tool === "feature") {
      const placement = {
        x: voxel.x,
        y: Math.max(0, voxel.y),
        z: voxel.z
      };
      const existing = this.editorWorld.findWaterfallAtOrigin(placement.x, placement.y, placement.z);
      if (existing) {
        this.post({
          type: "status",
          message: "A waterfall already starts from that anchor."
        });
      } else {
        this.editorWorld.setWaterfall({
          x: placement.x,
          y: placement.y,
          z: placement.z,
          direction: this.editorState.featureDirection,
          width: 4,
          drop: 4,
          activationRadius: 20
        });
        requiresFullWorldSync = true;
        this.post({
          type: "status",
          message: "Placed a waterfall."
        });
      }
    } else {
      const spawn = this.editorWorld.getEditableSpawnPosition(voxel.x, voxel.z);
      this.editorWorld.setSpawn(spawn.x, spawn.y, spawn.z);
      requiresFullWorldSync = true;
      this.post({
        type: "status",
        message: "Placed a nest spawn."
      });
    }

    if (touchedTerrain) {
      const settleResult = this.editorWorld.settleDetachedComponents();
      dirtyChunkKeys = [...new Set([...dirtyChunkKeys, ...settleResult.dirtyChunkKeys])];
      const removedProps = this.editorWorld.pruneUnsupportedPropsAtColumns();
      if (removedProps.length > 0) {
        requiresFullWorldSync = true;
      }
    }

    this.latestDirtyChunkCount = dirtyChunkKeys.length;
    if (requiresFullWorldSync) {
      this.applyFullWorld(this.editorWorld.toDocument(), this.buildFullTerrainPatches(this.editorWorld));
    } else if (dirtyChunkKeys.length > 0) {
      const patches = dirtyChunkKeys.map((key) => buildChunkPatch(this.editorWorld, key));
      this.applyTerrainPatches(patches);
    }
    if (requiresFullWorldSync || dirtyChunkKeys.length > 0) {
      this.rebuildProps(this.editorWorld.toDocument());
      this.readyToDisplayPending = true;
    }
  }

  private getActiveWorld() {
    if (this.mode === "editor") {
      return this.editorWorld;
    }
    if (this.mode === "multiplayer") {
      return this.runtimeWorld;
    }
    return this.runtime.getWorld();
  }

  private getActiveWorldDocument() {
    if (this.mode === "editor") {
      return this.editorWorld.toDocument();
    }
    if (this.mode === "multiplayer") {
      return this.currentDocument;
    }
    return this.runtime.getWorld().toDocument();
  }

  private syncSunShadowMode() {
    if (!this.renderer) {
      return;
    }

    const enabled = isRuntimeMode(this.mode) && this.presentation !== "menu" && this.qualityTier === "high";
    syncDirectionalLightSunLayer(this.directionalLight, enabled);
    this.sunShadows.setEnabled(enabled);
  }
}

const runtime = new WorkerGameRuntime(workerScope);

workerScope.onmessage = (event: MessageEvent<WorkerRequestMessage>) => {
  runtime.handleMessage(event.data);
};

export {};
