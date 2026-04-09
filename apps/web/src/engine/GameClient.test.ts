import { beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { MutableVoxelWorld, createDefaultArenaMap } from "@out-of-bounds/map";
import {
  getChickenHeadFeatherRotation,
  getChickenPoseVisualState,
  getChickenTailMotion,
  getChickenWingFeatherletRotation,
  headFeatherOffsets,
  wingFeatherletOffsets
} from "../game/playerVisuals";
import { chickenModelRig } from "../game/sceneAssets";
import { propMaterials } from "../game/propMaterials";
import { unpackRuntimeInputCommand } from "./runtimeInput";

const animationFrameState = vi.hoisted(() => {
  const callbacks: FrameRequestCallback[] = [];

  return {
    callbacks,
    reset() {
      callbacks.length = 0;
    },
    runNext(frameTime = 16.67) {
      const callback = callbacks.shift();
      callback?.(frameTime);
    }
  };
});

const threeTestState = vi.hoisted(() => {
  class MockWebGLRenderer {
    static constructorCalls: Array<unknown> = [];
    shadowMap = {
      enabled: false,
      type: null as unknown,
      autoUpdate: true,
      needsUpdate: false
    };

    constructor(options: unknown) {
      MockWebGLRenderer.constructorCalls.push(options);
    }

    dispose = vi.fn();
    render = vi.fn();
    setPixelRatio = vi.fn();
    setSize = vi.fn();
  }

  const rendererInstances: MockWebGLRenderer[] = [];
  class WebGLRenderer extends MockWebGLRenderer {
    constructor(options: unknown) {
      super(options);
      rendererInstances.push(this);
    }
  }

  return {
    MockWebGLRenderer,
    rendererInstances,
    WebGLRenderer
  };
});

const csmTestState = vi.hoisted(() => {
  const instances: Array<{
    data: Record<string, unknown>;
    lights: Array<{
      intensity: number;
      layers: { set: ReturnType<typeof vi.fn> };
      position: { x: number; y: number; z: number };
      shadow: { normalBias: number };
      target: {
        position: { x: number; y: number; z: number };
      };
    }>;
    dispose: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
    setupMaterial: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateFrustums: ReturnType<typeof vi.fn>;
  }> = [];

  class CSM {
    readonly lights = [
      {
        intensity: 0,
        layers: { set: vi.fn() },
        position: { x: 0, y: 0, z: 0 },
        shadow: { normalBias: 0 },
        target: {
          position: { x: 0, y: 0, z: 0 }
        }
      },
      {
        intensity: 0,
        layers: { set: vi.fn() },
        position: { x: 0, y: 0, z: 0 },
        shadow: { normalBias: 0 },
        target: {
          position: { x: 0, y: 0, z: 0 }
        }
      }
    ];
    readonly setupMaterial = vi.fn();
    readonly update = vi.fn();
    readonly updateFrustums = vi.fn();
    readonly remove = vi.fn();
    readonly dispose = vi.fn();
    fade = false;
    maxFar: number;
    lightFar: number;
    lightMargin: number;

    constructor(readonly data: Record<string, unknown>) {
      this.maxFar = data.maxFar as number;
      this.lightFar = data.lightFar as number;
      this.lightMargin = data.lightMargin as number;
      instances.push(this);
    }
  }

  return {
    CSM,
    instances,
    reset() {
      instances.length = 0;
    }
  };
});

vi.mock("three", async () => {
  const actual = await vi.importActual<typeof import("three")>("three");
  return {
    ...actual,
    WebGLRenderer: threeTestState.WebGLRenderer
  };
});

vi.mock("three/examples/jsm/csm/CSM.js", () => ({
  CSM: csmTestState.CSM
}));

import { GameClient } from "./GameClient";

class MockWorker {
  static instances: MockWorker[] = [];

  readonly postMessage = vi.fn();
  readonly terminate = vi.fn();
  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(
    readonly url: URL,
    readonly options: WorkerOptions
  ) {
    MockWorker.instances.push(this);
  }

  emit(data: unknown) {
    this.onmessage?.({ data } as MessageEvent);
  }
}

const createCanvas = () => {
  const canvas = document.createElement("canvas");
  canvas.getBoundingClientRect = () =>
    ({
      width: 640,
      height: 360,
      top: 0,
      left: 0,
      bottom: 360,
      right: 640,
      x: 0,
      y: 0,
      toJSON: () => ({})
    }) as DOMRect;
  Object.defineProperty(canvas, "clientWidth", {
    configurable: true,
    value: 640
  });
  Object.defineProperty(canvas, "clientHeight", {
    configurable: true,
    value: 360
  });
  Object.defineProperty(canvas, "requestPointerLock", {
    configurable: true,
    writable: true,
    value: vi.fn()
  });
  return canvas;
};

const setPointerLockElement = (element: Element | null) => {
  Object.defineProperty(document, "pointerLockElement", {
    configurable: true,
    writable: true,
    value: element
  });
};

const setNavigatorPlatform = (platform: string) => {
  Object.defineProperty(window.navigator, "platform", {
    configurable: true,
    value: platform
  });
};

const createReadyRuntimeFrame = (overrides: Record<string, unknown> = {}) => ({
  tick: 1,
  time: 0,
  mode: "explore" as const,
  localPlayerId: "human-1",
  hudState: {
    mode: "explore" as const,
    localPlayerId: "human-1",
    localPlayer: {
      id: "human-1",
      name: "You",
      alive: true,
      grounded: true,
      mass: 84,
      maxMass: 300,
      livesRemaining: 3,
      maxLives: 3,
      respawning: false,
      invulnerableRemaining: 0,
      stunRemaining: 0
    },
    eggStatus: {
      reason: "ready" as const,
      hasMatter: true,
      ready: true,
      activeCount: 0,
      maxActiveCount: 2,
      cost: 42,
      cooldownRemaining: 0,
      cooldownDuration: 1.6,
      canQuickEgg: true,
      canChargedThrow: true
    },
    spaceChallenge: null,
    ranking: [{ id: "human-1", name: "You", alive: true }]
  },
  focusState: {
    focusedVoxel: { x: 4, y: 2, z: 5 },
    targetNormal: { x: 0, y: 1, z: 0 },
    placeVoxel: { x: 4, y: 3, z: 5 },
    destroyValid: true,
    placeValid: true,
    invalidReason: null
  },
  players: [
    {
      id: "human-1",
      name: "You",
      kind: "human" as const,
      alive: true,
      fallingOut: false,
      grounded: true,
      mass: 84,
      livesRemaining: 3,
      maxLives: 3,
      respawning: false,
      invulnerableRemaining: 0,
      stunRemaining: 0,
      pushVisualRemaining: 0,
      spacePhase: "none" as const,
      spacePhaseRemaining: 0,
      eggTauntSequence: 0,
      eggTauntRemaining: 0,
      position: { x: 4, y: 2, z: 5 },
      velocity: { x: 0, y: 0, z: 0 },
      facing: { x: 1, z: 0 },
      jetpackActive: false,
      eliminatedAt: null
    }
  ],
  eggs: [],
  eggScatterDebris: [],
  voxelBursts: [],
  skyDrops: [],
  fallingClusters: [],
  ...overrides
});

describe("GameClient", () => {
  beforeEach(() => {
    MockWorker.instances.length = 0;
    animationFrameState.reset();
    threeTestState.rendererInstances.length = 0;
    threeTestState.MockWebGLRenderer.constructorCalls.length = 0;
    csmTestState.reset();
    vi.stubGlobal("Worker", MockWorker);
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        animationFrameState.callbacks.push(callback);
        return 100 + animationFrameState.callbacks.length;
      })
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    setPointerLockElement(null);
    setNavigatorPlatform("MacIntel");
  });

  it("boots the worker, sizes the renderer, and forwards worker callback messages", () => {
    const documentMap = createDefaultArenaMap();
    const onDiagnostics = vi.fn();
    const onEditorStateChange = vi.fn();
    const onHudStateChange = vi.fn();
    const onStatus = vi.fn();
    const canvas = createCanvas();

    const client = GameClient.mount({
      canvas,
      initialDocument: documentMap,
      initialMode: "editor",
      matchColorSeed: 23,
      onDiagnostics,
      onEditorStateChange,
      onHudStateChange,
      onStatus
    });

    const worker = MockWorker.instances[0]!;
    const renderer = threeTestState.rendererInstances[0]!;

    expect(worker.options).toEqual({ type: "module" });
    expect(worker.postMessage).toHaveBeenNthCalledWith(1, {
      type: "init",
      document: documentMap,
      mode: "editor"
    });
    expect(renderer.setPixelRatio).toHaveBeenCalledWith(1);
    expect(renderer.setSize).toHaveBeenCalledWith(640, 360, false);

    worker.emit({
      type: "ready",
      editorState: {
        mapName: "Default Arena",
        tool: "add",
        blockKind: "ground",
        propKind: "tree-oak"
      }
    });
    worker.emit({
      type: "hud_state",
      hudState: null
    });
    worker.emit({
      type: "status",
      message: "Map loaded"
    });
    worker.emit({
      type: "diagnostics",
      diagnostics: {
        mode: "editor",
        tick: 0,
        terrainRevision: 1,
        dirtyChunkCount: 0,
        runtime: {
          skyDropUpdateMs: 0,
          skyDropLandingMs: 0,
          detachedComponentMs: 0,
          fallingClusterLandingMs: 0,
          fixedStepMaxStepsPerFrame: 0,
          fixedStepClampedFrames: 0,
          fixedStepDroppedMs: 0
        }
      }
    });

    expect(onEditorStateChange).toHaveBeenCalledWith({
      mapName: "Default Arena",
      tool: "add",
      blockKind: "ground",
      propKind: "tree-oak"
    });
    expect(onHudStateChange).toHaveBeenCalledWith(null);
    expect(onStatus).toHaveBeenCalledWith("Map loaded");
    expect(onDiagnostics).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "editor",
        terrainRevision: 1
      })
    );

    client.dispose();
  });

  it("enables manual CSM shadows for high-tier runtime mode", () => {
    const onDiagnostics = vi.fn();
    const canvas = createCanvas();
    const client = GameClient.mount({
      canvas,
      initialDocument: createDefaultArenaMap(),
      initialMode: "explore",
      matchColorSeed: 31,
      onDiagnostics,
      qualityTier: "high"
    });

    const worker = MockWorker.instances[0]!;
    const renderer = threeTestState.rendererInstances[0]!;

    expect(csmTestState.instances).toHaveLength(1);
    expect(renderer.shadowMap.enabled).toBe(true);
    expect(renderer.shadowMap.autoUpdate).toBe(false);
    expect(renderer.shadowMap.type).toBe(THREE.BasicShadowMap);

    animationFrameState.runNext();
    worker.emit({
      type: "diagnostics",
      diagnostics: {
        mode: "explore",
        tick: 2,
        terrainRevision: 1,
        dirtyChunkCount: 0,
        runtime: {
          skyDropUpdateMs: 0,
          skyDropLandingMs: 0,
          detachedComponentMs: 0,
          fallingClusterLandingMs: 0,
          fixedStepMaxStepsPerFrame: 0,
          fixedStepClampedFrames: 0,
          fixedStepDroppedMs: 0
        }
      }
    });

    expect(onDiagnostics).toHaveBeenLastCalledWith(
      expect.objectContaining({
        render: {
          sunShadowsEnabled: true,
          shadowMapRefreshCount: 1
        }
      })
    );

    client.dispose();
    expect(csmTestState.instances[0]?.remove).toHaveBeenCalledTimes(1);
    expect(csmTestState.instances[0]?.dispose).toHaveBeenCalledTimes(1);
  });

  it("keeps CSM shadows disabled on non-high quality tiers", () => {
    const canvas = createCanvas();
    const client = GameClient.mount({
      canvas,
      initialDocument: createDefaultArenaMap(),
      initialMode: "explore",
      matchColorSeed: 12,
      qualityTier: "medium"
    });

    const renderer = threeTestState.rendererInstances[0]!;

    expect(csmTestState.instances).toHaveLength(0);
    expect(renderer.shadowMap.enabled).toBe(false);
    expect(renderer.shadowMap.autoUpdate).toBe(true);

    client.dispose();
  });

  it("turns CSM shadows back off when leaving runtime mode", () => {
    const canvas = createCanvas();
    const client = GameClient.mount({
      canvas,
      initialDocument: createDefaultArenaMap(),
      initialMode: "explore",
      matchColorSeed: 19,
      qualityTier: "high"
    });

    const renderer = threeTestState.rendererInstances[0]!;
    const csm = csmTestState.instances[0]!;

    client.setShellState({
      mode: "editor"
    });

    expect(csm.remove).toHaveBeenCalledTimes(1);
    expect(csm.dispose).toHaveBeenCalledTimes(1);
    expect(renderer.shadowMap.enabled).toBe(false);

    client.dispose();
  });

  it("applies authoritative frame payloads to the local replica without changing render ownership", () => {
    const canvas = createCanvas();
    const client = GameClient.mount({
      canvas,
      initialDocument: createDefaultArenaMap(),
      initialMode: "explore",
      matchColorSeed: 9
    });
    const worker = MockWorker.instances[0]!;
    const frame = createReadyRuntimeFrame({
      authoritative: {
        state: {
          tick: 1,
          time: 0,
          mode: "multiplayer" as const,
          localPlayerId: "human-1",
          players: [
            {
              entityId: "human-1",
              spawnTick: 0,
              visualSeed: 111,
              ...(createReadyRuntimeFrame().players[0] as object)
            }
          ],
          projectiles: [],
          hazards: {
            fallingClusters: [],
            skyDrops: [],
            eggScatterDebris: []
          },
          stats: {
            terrainRevision: 4
          },
          ranking: ["human-1"]
        },
        terrainDeltaBatch: {
          tick: 1,
          terrainRevision: 4,
          changes: [
            {
              voxel: { x: 2, y: 3, z: 4 },
              kind: null,
              operation: "remove" as const,
              source: "projectile_explosion" as const
            }
          ]
        },
        gameplayEventBatch: {
          tick: 1,
          events: [
            {
              type: "terrain_changed" as const,
              entityId: "terrain-1",
              terrainRevision: 4,
              source: "projectile_explosion" as const,
              changeCount: 1
            }
          ]
        }
      }
    });

    worker.emit({
      type: "frame",
      frame
    });

    expect((client as any).authoritativeReplica.getState()).toMatchObject({
      mode: "multiplayer",
      stats: {
        terrainRevision: 4
      }
    });
    expect((client as any).authoritativeReplica.peekTerrainDeltaBatch()).toMatchObject({
      terrainRevision: 4
    });
    expect(
      (client as any).authoritativeReplica.peekGameplayEventBatch()?.events[0]
    ).toMatchObject({
      type: "terrain_changed"
    });

    client.dispose();
  });

  it("forwards the requested sky-drop spawn style when runtime play boots", () => {
    const documentMap = createDefaultArenaMap();
    const canvas = createCanvas();

    const client = GameClient.mount({
      canvas,
      initialDocument: documentMap,
      initialMode: "explore",
      initialSpawnStyle: "sky",
      matchColorSeed: 23
    });

    const worker = MockWorker.instances[0]!;

    expect(worker.postMessage).toHaveBeenNthCalledWith(1, {
      type: "init",
      document: documentMap,
      mode: "explore",
      initialSpawnStyle: "sky"
    });

    client.dispose();
  });

  it("notifies ready-to-display only after a synced world has rendered", () => {
    const onReadyToDisplay = vi.fn();
    const canvas = createCanvas();
    const client = GameClient.mount({
      canvas,
      initialDocument: createDefaultArenaMap(),
      initialMode: "editor",
      matchColorSeed: 23,
      onReadyToDisplay
    });

    const worker = MockWorker.instances[0]!;
    worker.emit({
      type: "world_sync",
      mode: "editor",
      world: {
        document: createDefaultArenaMap(),
        terrainRevision: 1,
        chunkPatches: []
      }
    });

    expect(onReadyToDisplay).not.toHaveBeenCalled();

    animationFrameState.runNext();

    expect(onReadyToDisplay).toHaveBeenCalledTimes(1);

    client.dispose();
  });

  it("renders runtime players with head-feather lives, decorative wing featherlets, and a tail", () => {
    const canvas = createCanvas();
    const client = GameClient.mount({
      canvas,
      initialDocument: createDefaultArenaMap(),
      initialMode: "explore",
      matchColorSeed: 23
    });

    (client as any).syncPlayers(
      [
        {
          id: "human-1",
          name: "You",
          kind: "human",
          alive: true,
          fallingOut: false,
          grounded: false,
          mass: 24,
          livesRemaining: 2,
          maxLives: 3,
          respawning: false,
          invulnerableRemaining: 0,
          stunRemaining: 0,
          pushVisualRemaining: 0.12,
          position: { x: 4, y: 2, z: 5 },
          velocity: { x: 1, y: 1.2, z: 0 },
          facing: { x: 1, z: 0 },
          jetpackActive: false,
          eliminatedAt: null
        }
      ],
      "human-1",
      1 / 60,
      1.25
    );

    const visual = (client as any).playerVisuals.get("human-1");

    expect(visual).toBeDefined();
    expect(visual.group.children).toHaveLength(4);
    expect(visual.highDetail.visible).toBe(true);
    expect(visual.lowDetail.visible).toBe(false);
    expect(visual.headFeathers).toHaveLength(3);
    expect(visual.leftWingFeatherlets).toHaveLength(3);
    expect(visual.rightWingFeatherlets).toHaveLength(3);
    expect(visual.tailFeathers).toHaveLength(3);
    expect(visual.leftWingMesh.children.length).toBeGreaterThanOrEqual(3);
    expect(visual.rightWingMesh.children.length).toBeGreaterThanOrEqual(3);
    expect(visual.shell.rotation.x).toBeGreaterThan(0);
    expect(visual.avatar.position.z).toBeGreaterThan(0);
    expect(visual.leftWingMesh.scale.x).toBeGreaterThan(1);
    expect(visual.rightWingMesh.scale.x).toBeCloseTo(visual.leftWingMesh.scale.x, 5);
    expect(visual.leftWing.rotation.z).toBeGreaterThan(0.22);
    expect(visual.rightWing.rotation.z).toBeLessThan(-0.22);
    expect(visual.leftWingTrace.visible).toBe(true);
    expect(visual.rightWingTrace.visible).toBe(true);
    expect(visual.wingletTraceMaterial.opacity).toBeGreaterThan(0);
    expect(visual.headFeathers[0].visible).toBe(true);
    expect(visual.headFeathers[1].visible).toBe(true);
    expect(visual.headFeathers[2].visible).toBe(false);
    expect(visual.lowDetailHeadFeathers[0].visible).toBe(true);
    expect(visual.lowDetailHeadFeathers[2].visible).toBe(false);
    expect(visual.leftWingFeatherlets.every((feather: THREE.Group) => feather.visible)).toBe(true);
    expect(visual.rightWingFeatherlets.every((feather: THREE.Group) => feather.visible)).toBe(true);
    expect(visual.tail.position.z).toBeLessThan(0);

    client.dispose();
  });

  it("applies full grounded pose updates to the shared chicken rig", () => {
    const canvas = createCanvas();
    const client = GameClient.mount({
      canvas,
      initialDocument: createDefaultArenaMap(),
      initialMode: "explore",
      matchColorSeed: 23
    });

    const player = {
      id: "runner-1",
      name: "Runner",
      kind: "human",
      alive: true,
      fallingOut: false,
      grounded: true,
      mass: 84,
      livesRemaining: 3,
      maxLives: 3,
      respawning: false,
      invulnerableRemaining: 0,
      stunRemaining: 0,
      pushVisualRemaining: 0,
      position: { x: 4, y: 2, z: 5 },
      velocity: { x: 3.2, y: 0, z: 1.4 },
      facing: { x: 1, z: 0.2 },
      jetpackActive: false,
      eliminatedAt: null
    } as const;

    (client as any).syncPlayers([player], "runner-1", 1 / 60, 1.25);

    const visual = (client as any).playerVisuals.get("runner-1");
    const planarSpeed = Math.hypot(player.velocity.x, player.velocity.z);
    const poseState = getChickenPoseVisualState({
      grounded: player.grounded,
      velocityY: player.velocity.y,
      planarSpeed,
      elapsedTime: 1.25,
      motionSeed: visual.motionSeed,
      pushVisualRemaining: player.pushVisualRemaining,
      landingRollRemaining: 0,
      stunned: false
    });
    const headFeatherRotation = getChickenHeadFeatherRotation(headFeatherOffsets[0]!, poseState.featherSwing);
    const lowDetailHeadFeatherRotation = getChickenHeadFeatherRotation(
      headFeatherOffsets[0]!,
      poseState.featherSwing,
      0.82
    );
    const leftWingFeatherletRotation = getChickenWingFeatherletRotation(
      wingFeatherletOffsets[0]!,
      poseState.featherSwing,
      1
    );
    const rightWingFeatherletRotation = getChickenWingFeatherletRotation(
      wingFeatherletOffsets[0]!,
      poseState.featherSwing,
      -1
    );
    const tailMotion = getChickenTailMotion(poseState.featherSwing);

    expect(visual.body.rotation.y).toBeCloseTo(poseState.bodyYaw, 5);
    expect(visual.headPivot.rotation.x).toBeCloseTo(poseState.headPitch, 5);
    expect(visual.headPivot.rotation.y).toBeCloseTo(poseState.headYaw, 5);
    expect(visual.headPivot.position.y).toBeCloseTo(chickenModelRig.headPivotY + poseState.headYOffset, 5);
    expect(visual.lowDetailHead.rotation.x).toBeCloseTo(poseState.headPitch * 0.76, 5);
    expect(visual.lowDetailHead.rotation.y).toBeCloseTo(poseState.headYaw * 0.72, 5);
    expect(visual.leftLeg.rotation.x).toBeCloseTo(poseState.leftLegPitch, 5);
    expect(visual.rightLeg.rotation.x).toBeCloseTo(poseState.rightLegPitch, 5);
    expect(visual.headFeathers[0]?.rotation.x).toBeCloseTo(headFeatherRotation.x, 5);
    expect(visual.headFeathers[0]?.rotation.y).toBeCloseTo(headFeatherRotation.y, 5);
    expect(visual.headFeathers[0]?.rotation.z).toBeCloseTo(headFeatherRotation.z, 5);
    expect(visual.lowDetailHeadFeathers[0]?.rotation.x).toBeCloseTo(lowDetailHeadFeatherRotation.x * 0.9, 5);
    expect(visual.lowDetailHeadFeathers[0]?.rotation.z).toBeCloseTo(lowDetailHeadFeatherRotation.z * 0.86, 5);
    expect(visual.leftWingFeatherlets[0]?.rotation.x).toBeCloseTo(leftWingFeatherletRotation.x, 5);
    expect(visual.leftWingFeatherlets[0]?.rotation.z).toBeCloseTo(leftWingFeatherletRotation.z, 5);
    expect(visual.rightWingFeatherlets[0]?.rotation.y).toBeCloseTo(rightWingFeatherletRotation.y, 5);
    expect(visual.rightWingFeatherlets[0]?.rotation.z).toBeCloseTo(rightWingFeatherletRotation.z, 5);
    expect(visual.tail.rotation.x).toBeCloseTo(tailMotion.x, 5);
    expect(visual.tail.rotation.z).toBeCloseTo(tailMotion.z, 5);
    expect(visual.lowDetailTail.rotation.x).toBeCloseTo(tailMotion.x * 0.82, 5);

    client.dispose();
  });

  it("uses the selected local palette without overriding NPC palettes", () => {
    const canvas = createCanvas();
    const client = GameClient.mount({
      canvas,
      initialDocument: createDefaultArenaMap(),
      initialMode: "explore",
      localPlayerPaletteName: "gold",
      matchColorSeed: 23
    });

    (client as any).syncPlayers(
      [
        {
          id: "human-1",
          name: "You",
          kind: "human",
          alive: true,
          fallingOut: false,
          grounded: true,
          mass: 24,
          livesRemaining: 3,
          maxLives: 3,
          respawning: false,
          invulnerableRemaining: 0,
          stunRemaining: 0,
          pushVisualRemaining: 0,
          position: { x: 4, y: 2, z: 5 },
          velocity: { x: 0, y: 0, z: 0 },
          facing: { x: 1, z: 0 },
          jetpackActive: false,
          eliminatedAt: null
        },
        {
          id: "npc-1",
          name: "NPC 1",
          kind: "npc",
          alive: true,
          fallingOut: false,
          grounded: true,
          mass: 24,
          livesRemaining: 3,
          maxLives: 3,
          respawning: false,
          invulnerableRemaining: 0,
          stunRemaining: 0,
          pushVisualRemaining: 0,
          position: { x: 8, y: 2, z: 8 },
          velocity: { x: 0, y: 0, z: 0 },
          facing: { x: -1, z: 0 },
          jetpackActive: false,
          eliminatedAt: null
        }
      ],
      "human-1",
      1 / 60,
      1.25
    );

    const localVisual = (client as any).playerVisuals.get("human-1");
    const npcVisual = (client as any).playerVisuals.get("npc-1");
    const npcPaletteName = npcVisual.paletteName;

    expect(localVisual.paletteName).toBe("gold");
    expect(npcPaletteName).not.toBeUndefined();

    client.setShellState({ mode: "explore", localPlayerPaletteName: "mint" });
    (client as any).syncPlayers(
      [
        {
          id: "human-1",
          name: "You",
          kind: "human",
          alive: true,
          fallingOut: false,
          grounded: true,
          mass: 24,
          livesRemaining: 3,
          maxLives: 3,
          respawning: false,
          invulnerableRemaining: 0,
          stunRemaining: 0,
          pushVisualRemaining: 0,
          position: { x: 4, y: 2, z: 5 },
          velocity: { x: 0, y: 0, z: 0 },
          facing: { x: 1, z: 0 },
          jetpackActive: false,
          eliminatedAt: null
        },
        {
          id: "npc-1",
          name: "NPC 1",
          kind: "npc",
          alive: true,
          fallingOut: false,
          grounded: true,
          mass: 24,
          livesRemaining: 3,
          maxLives: 3,
          respawning: false,
          invulnerableRemaining: 0,
          stunRemaining: 0,
          pushVisualRemaining: 0,
          position: { x: 8, y: 2, z: 8 },
          velocity: { x: 0, y: 0, z: 0 },
          facing: { x: -1, z: 0 },
          jetpackActive: false,
          eliminatedAt: null
        }
      ],
      "human-1",
      1 / 60,
      1.35
    );

    expect((client as any).playerVisuals.get("human-1").paletteName).toBe("mint");
    expect((client as any).playerVisuals.get("npc-1").paletteName).toBe(npcPaletteName);

    client.dispose();
  });

  it("positions a higher overhead camera for menu presentation", () => {
    const menuCanvas = createCanvas();
    const editorCanvas = createCanvas();
    const menuClient = GameClient.mount({
      canvas: menuCanvas,
      initialDocument: createDefaultArenaMap(),
      initialMode: "editor",
      matchColorSeed: 9,
      presentation: "menu"
    });
    const editorClient = GameClient.mount({
      canvas: editorCanvas,
      initialDocument: createDefaultArenaMap(),
      initialMode: "editor",
      matchColorSeed: 9
    });

    const menuWorker = MockWorker.instances[0]!;
    const editorWorker = MockWorker.instances[1]!;
    const documentMap = createDefaultArenaMap();

    menuWorker.emit({
      type: "world_sync",
      mode: "editor",
      world: {
        document: documentMap,
        terrainRevision: 1,
        chunkPatches: []
      }
    });
    editorWorker.emit({
      type: "world_sync",
      mode: "editor",
      world: {
        document: documentMap,
        terrainRevision: 1,
        chunkPatches: []
      }
    });

    expect((menuClient as any).camera.position.y).toBeGreaterThan((editorClient as any).camera.position.y);

    menuClient.dispose();
    editorClient.dispose();
  });

  it("restores drifting voxel clouds across multiple altitude bands", () => {
    const canvas = createCanvas();
    const client = GameClient.mount({
      canvas,
      initialDocument: createDefaultArenaMap(),
      initialMode: "editor",
      matchColorSeed: 17
    });

    const cloudVisuals = (client as any).cloudVisuals as Array<{ group: THREE.Group }>;
    const heights = cloudVisuals.map((visual) => visual.group.position.y);

    expect(cloudVisuals).toHaveLength(9);
    expect(Math.min(...heights)).toBeGreaterThan(20);
    expect(Math.max(...heights)).toBeGreaterThan(33);
    expect((client as any).spacePlanetVisuals).toHaveLength(3);

    client.dispose();
  });

  it("hides winglet traces again once a player lands", () => {
    const canvas = createCanvas();
    const client = GameClient.mount({
      canvas,
      initialDocument: createDefaultArenaMap(),
      initialMode: "explore",
      matchColorSeed: 31
    });

    const airbornePlayer = {
      id: "human-1",
      name: "You",
      kind: "human",
      alive: true,
      fallingOut: false,
      grounded: false,
      mass: 24,
      livesRemaining: 3,
      maxLives: 3,
      respawning: false,
      invulnerableRemaining: 0,
      stunRemaining: 0,
      pushVisualRemaining: 0,
      position: { x: 4, y: 2.4, z: 5 },
      velocity: { x: 2.4, y: -3.2, z: 0.8 },
      facing: { x: 1, z: 0 },
      jetpackActive: false,
      eliminatedAt: null
    } as const;

    (client as any).syncPlayers([airbornePlayer], "human-1", 1 / 60, 1.25);
    const visual = (client as any).playerVisuals.get("human-1");

    expect(visual.leftWingTrace.visible).toBe(true);
    expect(visual.wingletTraceMaterial.opacity).toBeGreaterThan(0);

    (client as any).syncPlayers(
      [
        {
          ...airbornePlayer,
          grounded: true,
          position: { x: 4, y: 2, z: 5 },
          velocity: { x: 0, y: 0, z: 0 }
        }
      ],
      "human-1",
      1 / 60,
      1.4
    );

    expect(visual.leftWingTrace.visible).toBe(false);
    expect(visual.rightWingTrace.visible).toBe(false);
    expect(visual.lowDetailLeftTrace.visible).toBe(false);
    expect(visual.lowDetailRightTrace.visible).toBe(false);
    expect(visual.wingletTraceMaterial.opacity).toBe(0);
    expect(visual.leftWingMesh.scale.x).toBeCloseTo(1, 5);

    client.dispose();
  });

  it("anchors player shadows to the nearest surface below and falls back safely when no hit is found", () => {
    const canvas = createCanvas();
    const client = GameClient.mount({
      canvas,
      initialDocument: createDefaultArenaMap(),
      initialMode: "explore",
      matchColorSeed: 11
    });

    const player = {
      id: "human-1",
      name: "You",
      kind: "human",
      alive: true,
      fallingOut: false,
      grounded: false,
      mass: 24,
      livesRemaining: 3,
      maxLives: 3,
      respawning: false,
      invulnerableRemaining: 0,
      stunRemaining: 0,
      pushVisualRemaining: 0,
      position: { x: 4, y: 6.8, z: 5 },
      velocity: { x: 0, y: -2, z: 0 },
      facing: { x: 1, z: 0 },
      jetpackActive: false,
      eliminatedAt: null
    } as const;

    (client as any).syncPlayers([player], "human-1", 1 / 60, 1.25);
    const visual = (client as any).playerVisuals.get("human-1");
    const fallbackOffset = visual.shadow.position.y;

    const platform = new THREE.Mesh(
      new THREE.PlaneGeometry(8, 8),
      new THREE.MeshBasicMaterial()
    );
    platform.rotation.x = -Math.PI / 2;
    platform.position.set(4, 2.2, 5);
    (client as any).terrainGroup.add(platform);
    platform.updateMatrixWorld(true);
    (client as any).terrainGroup.updateMatrixWorld(true);

    (client as any).syncPlayers([player], "human-1", 1 / 60, 1.25);

    expect(fallbackOffset).toBeCloseTo(-0.77, 2);
    expect(visual.shadow.position.y).toBeCloseTo(-4.55, 1);

    client.dispose();
  });

  it("shows fullscreen speed traces only for local flight or local push bursts", () => {
    const canvas = createCanvas();
    const client = GameClient.mount({
      canvas,
      initialDocument: createDefaultArenaMap(),
      initialMode: "explore",
      matchColorSeed: 19
    });

    (client as any).latestFrame = {
      tick: 1,
      time: 0.016,
      mode: "explore",
      localPlayerId: "human-1",
      players: [
        {
          id: "human-1",
          name: "You",
          kind: "human",
          alive: true,
          fallingOut: false,
          grounded: true,
          mass: 24,
          livesRemaining: 3,
          maxLives: 3,
          respawning: false,
          invulnerableRemaining: 0,
          stunRemaining: 0,
          pushVisualRemaining: 0,
          position: { x: 4, y: 2, z: 5 },
          velocity: { x: 0, y: 0, z: 0 },
          facing: { x: 1, z: 0 },
          jetpackActive: false,
          eliminatedAt: null
        },
        {
          id: "npc-1",
          name: "NPC 1",
          kind: "npc",
          alive: true,
          fallingOut: false,
          grounded: true,
          mass: 24,
          livesRemaining: 3,
          maxLives: 3,
          respawning: false,
          invulnerableRemaining: 0,
          stunRemaining: 0,
          pushVisualRemaining: 0.2,
          position: { x: 8, y: 2, z: 8 },
          velocity: { x: 0, y: 0, z: 0 },
          facing: { x: 1, z: 0 },
          jetpackActive: false,
          eliminatedAt: null
        }
      ],
      eggs: [],
      eggScatterDebris: [],
      skyDrops: [],
      fallingClusters: []
    };

    (client as any).applyRuntimeFrame(1 / 60, 1.2);
    expect((client as any).speedTraceGroup.visible).toBe(false);

    (client as any).latestFrame = {
      ...(client as any).latestFrame,
      tick: 2,
      players: [
        {
          ...(client as any).latestFrame.players[0],
          grounded: false,
          velocity: { x: 6, y: 0.4, z: 0 },
          jetpackActive: true,
          pushVisualRemaining: 0.2
        },
        (client as any).latestFrame.players[1]
      ]
    };
    (client as any).applyRuntimeFrame(1 / 60, 1.25);

    expect((client as any).speedTraceGroup.visible).toBe(true);
    expect((client as any).speedTraceGroup.children).toHaveLength(14);
    expect(
      Math.min(
        ...(client as any).speedTraceGroup.children.map((child: THREE.Object3D) =>
          Math.hypot(child.position.x, child.position.y)
        )
      )
    ).toBeGreaterThan(0.45);
    expect((client as any).speedTraceMaterials.some((material: THREE.MeshBasicMaterial) => material.opacity > 0)).toBe(true);
    expect(
      Math.max(...(client as any).speedTraceMaterials.map((material: THREE.MeshBasicMaterial) => material.opacity)) -
        Math.min(...(client as any).speedTraceMaterials.map((material: THREE.MeshBasicMaterial) => material.opacity))
    ).toBeGreaterThan(0.1);

    const previousPositions = (client as any).speedTraceGroup.children.map((child: THREE.Object3D) => ({
      x: child.position.x,
      y: child.position.y
    }));
    (client as any).applyRuntimeFrame(1 / 60, 1.45);
    expect(
      (client as any).speedTraceGroup.children.some((child: THREE.Object3D, index: number) => {
        const previous = previousPositions[index]!;
        return Math.hypot(child.position.x - previous.x, child.position.y - previous.y) > 0.01;
      })
    ).toBe(true);

    client.dispose();
  });

  it("blends the local camera into space without letting remote players force the backdrop", () => {
    const canvas = createCanvas();
    const client = GameClient.mount({
      canvas,
      initialDocument: createDefaultArenaMap(),
      initialMode: "explore",
      matchColorSeed: 19
    });

    (client as any).camera.position.set(3, 4, 5);
    (client as any).latestFrame = {
      tick: 1,
      time: 0.016,
      mode: "explore",
      localPlayerId: "human-1",
      players: [
        {
          id: "human-1",
          name: "You",
          kind: "human",
          alive: true,
          fallingOut: false,
          grounded: false,
          mass: 24,
          livesRemaining: 3,
          maxLives: 3,
          respawning: false,
          invulnerableRemaining: 0,
          stunRemaining: 0,
          pushVisualRemaining: 0,
          spacePhase: "none",
          spacePhaseRemaining: 0,
          position: { x: 4, y: 2, z: 5 },
          velocity: { x: 0, y: 4.8, z: 0 },
          facing: { x: 1, z: 0 },
          jetpackActive: true,
          eliminatedAt: null
        },
        {
          id: "npc-1",
          name: "NPC 1",
          kind: "npc",
          alive: true,
          fallingOut: false,
          grounded: false,
          mass: 24,
          livesRemaining: 3,
          maxLives: 3,
          respawning: false,
          invulnerableRemaining: 0,
          stunRemaining: 0,
          pushVisualRemaining: 0,
          spacePhase: "float",
          spacePhaseRemaining: 0.8,
          position: { x: 8, y: 60, z: 8 },
          velocity: { x: 0, y: 1.4, z: 0 },
          facing: { x: 1, z: 0 },
          jetpackActive: false,
          eliminatedAt: null
        }
      ],
      eggs: [],
      eggScatterDebris: [],
      voxelBursts: [],
      skyDrops: [],
      fallingClusters: []
    };

    (client as any).applyRuntimeFrame(0.4, 1.2);

    expect((client as any).spaceBlend).toBe(0);
    expect((client as any).spaceBackdropGroup.visible).toBe(false);
    expect((client as any).spaceStarMaterial.opacity).toBe(0);

    (client as any).latestFrame = {
      ...(client as any).latestFrame,
      tick: 2,
      players: [
        {
          ...(client as any).latestFrame.players[0],
          spacePhase: "float",
          spacePhaseRemaining: 0.9
        },
        (client as any).latestFrame.players[1]
      ]
    };

    (client as any).applyRuntimeFrame(0.4, 1.6);

    expect((client as any).spaceBlend).toBeGreaterThan(0.7);
    expect((client as any).spaceBackdropGroup.visible).toBe(true);
    expect((client as any).spaceBackdropGroup.position).toMatchObject({ x: 3, y: 4, z: 5 });
    expect((client as any).spaceStarMaterial.opacity).toBeGreaterThan(0.6);
    expect((client as any).cloudMainMaterial.opacity).toBeLessThan(0.3);
    expect(
      (client as any).spacePlanetVisuals.every((visual: { materials: THREE.MeshBasicMaterial[] }) =>
        visual.materials.every((material) => material.opacity > 0.6)
      )
    ).toBe(true);

    client.dispose();
  });

  it("renders runtime eggs as blocky pixel-textured props", () => {
    const canvas = createCanvas();
    const client = GameClient.mount({
      canvas,
      initialDocument: createDefaultArenaMap(),
      initialMode: "explore",
      matchColorSeed: 31
    });

    (client as any).syncEggs(
      [
        {
          id: "egg-1",
          ownerId: "human-1",
          fuseRemaining: 1.2,
          position: { x: 4, y: 2, z: 5 },
          velocity: { x: 0, y: 0, z: 0 }
        }
      ],
      1.25
    );

    const visual = (client as any).eggVisuals.get("egg-1");

    expect(visual).toBeDefined();
    expect(visual.group.children).toHaveLength(3);
    expect(visual.material.map).toBe(propMaterials.egg.map);
    expect(visual.group.scale.x).toBeGreaterThan(0.85);
    expect(visual.group.scale.y).toBeGreaterThan(0.8);

    client.dispose();
  });

  it("renders egg scatter debris as flying voxel cubes and clears them when the stream is empty", () => {
    const canvas = createCanvas();
    const client = GameClient.mount({
      canvas,
      initialDocument: createDefaultArenaMap(),
      initialMode: "explore",
      matchColorSeed: 31
    });

    (client as any).syncEggScatterDebris([
      {
        id: "egg-debris-1",
        kind: "ground",
        origin: { x: 4.5, y: 10.5, z: 5.5 },
        destination: { x: 8.5, y: 11.5, z: 9.5 },
        elapsed: 0.08,
        duration: 0.65
      }
    ]);

    const mesh = (client as any).eggScatterMeshes.get("earthSurface");
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    mesh.getMatrixAt(0, matrix);
    matrix.decompose(position, quaternion, scale);

    expect(mesh.visible).toBe(true);
    expect(mesh.count).toBe(1);
    expect(position.y).toBeGreaterThan(10.5);
    expect(scale.x).not.toBe(1);
    expect(scale.y).not.toBe(1);

    (client as any).syncEggScatterDebris([]);

    expect(mesh.visible).toBe(false);
    expect(mesh.count).toBe(0);

    client.dispose();
  });

  it("renders voxel burst particles for harvest and egg explosions and clears them when empty", () => {
    const canvas = createCanvas();
    const client = GameClient.mount({
      canvas,
      initialDocument: createDefaultArenaMap(),
      initialMode: "explore",
      matchColorSeed: 31
    });

    (client as any).syncVoxelBursts([
      {
        id: "voxel-burst-1",
        style: "harvest",
        kind: "ground",
        position: { x: 6.5, y: 10.5, z: 4.5 },
        elapsed: 0.1,
        duration: 0.24
      },
      {
        id: "voxel-burst-2",
        style: "eggExplosion",
        kind: null,
        position: { x: 8.5, y: 11.5, z: 7.5 },
        elapsed: 0.12,
        duration: 0.42
      }
    ]);

    const harvestMesh = (client as any).harvestBurstMeshes.get("earthSurface").mesh;
    const eggExplosionMesh = (client as any).eggExplosionBurstMesh.mesh;
    const eggShockwaveMesh = (client as any).eggExplosionShockwaveMesh.mesh;

    expect(harvestMesh.visible).toBe(true);
    expect(harvestMesh.count).toBeGreaterThan(0);
    expect(eggExplosionMesh.visible).toBe(true);
    expect(eggExplosionMesh.count).toBeGreaterThan(0);
    expect(eggShockwaveMesh.visible).toBe(true);
    expect(eggShockwaveMesh.count).toBeGreaterThan(0);

    (client as any).syncVoxelBursts([]);

    expect(harvestMesh.visible).toBe(false);
    expect(harvestMesh.count).toBe(0);
    expect(eggExplosionMesh.visible).toBe(false);
    expect(eggExplosionMesh.count).toBe(0);
    expect(eggShockwaveMesh.visible).toBe(false);
    expect(eggShockwaveMesh.count).toBe(0);

    client.dispose();
  });

  it("shows a grounded egg trajectory preview with a landing marker and hides it once the player leaves the ground", () => {
    const canvas = createCanvas();
    const client = GameClient.mount({
      canvas,
      initialDocument: createDefaultArenaMap(),
      initialMode: "explore",
      matchColorSeed: 29
    });

    (client as any).pointerLocked = true;
    (client as any).runtimePaused = false;
    (client as any).lookPitch = (-22 * Math.PI) / 180;
    (client as any).eggChargeState.active = true;
    (client as any).eggChargeState.chargeAlpha = 0.65;

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshBasicMaterial());
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(24, 2, 24);
    (client as any).terrainGroup.add(floor);
    floor.updateMatrixWorld(true);
    (client as any).terrainGroup.updateMatrixWorld(true);

    const groundedPlayer = {
      id: "human-1",
      name: "You",
      kind: "human",
      alive: true,
      fallingOut: false,
      grounded: true,
      mass: 84,
      livesRemaining: 3,
      maxLives: 3,
      respawning: false,
      invulnerableRemaining: 0,
      stunRemaining: 0,
      pushVisualRemaining: 0,
      spacePhase: "none",
      spacePhaseRemaining: 0,
      position: { x: 4, y: 2, z: 5 },
      velocity: { x: 0, y: 0, z: 0 },
      facing: { x: 1, z: 0 },
      jetpackActive: false,
      eliminatedAt: null
    } as const;

    (client as any).updateEggLaunchPreview(groundedPlayer, 1.2);

    const preview = (client as any).eggTrajectoryPreview;
    expect(preview.group.visible).toBe(true);
    expect(preview.geometry.drawRange.count).toBeGreaterThan(2);
    expect(preview.landingRing.visible).toBe(true);
    expect(preview.landingRing.position.x).toBeGreaterThan(groundedPlayer.position.x);
    expect(preview.landingRing.position.y).toBeCloseTo(2.04, 1);

    (client as any).updateEggLaunchPreview(
      {
        ...groundedPlayer,
        grounded: false
      },
      1.3
    );

    expect(preview.group.visible).toBe(false);
    expect(preview.landingRing.visible).toBe(false);

    client.dispose();
  });

  it("applies updated runtime control settings to free-look without remounting the client", () => {
    const client = GameClient.mount({
      canvas: createCanvas(),
      initialDocument: createDefaultArenaMap(),
      initialMode: "explore",
      matchColorSeed: 30
    });

    (client as any).latestFrame = {
      tick: 1,
      time: 0,
      mode: "explore",
      localPlayerId: "human-1",
      players: [
        {
          id: "human-1",
          name: "You",
          kind: "human",
          alive: true,
          fallingOut: false,
          grounded: true,
          mass: 24,
          livesRemaining: 3,
          maxLives: 3,
          respawning: false,
          invulnerableRemaining: 0,
          stunRemaining: 0,
          pushVisualRemaining: 0,
          spacePhase: "none",
          spacePhaseRemaining: 0,
          position: { x: 4, y: 2, z: 5 },
          velocity: { x: 0, y: 0, z: 0 },
          facing: { x: 1, z: 0 },
          jetpackActive: false,
          eliminatedAt: null
        }
      ],
      eggs: [],
      eggScatterDebris: [],
      voxelBursts: [],
      skyDrops: [],
      fallingClusters: []
    };
    (client as any).lookYaw = 0;
    (client as any).lookPitch = 0;
    (client as any).pendingLookDeltaX = 40;
    (client as any).pendingLookDeltaY = 20;

    client.setShellState({
      mode: "explore",
      runtimeSettings: {
        lookSensitivity: 1.2,
        invertLookX: false,
        invertLookY: false
      }
    });
    (client as any).updateRuntimeCamera(1 / 60);

    expect((client as any).lookYaw).toBeCloseTo(0.24, 5);
    expect((client as any).lookPitch).toBeCloseTo(-0.096, 5);

    client.dispose();
  });

  it("queues build on F without triggering egg launch", () => {
    const client = GameClient.mount({
      canvas: createCanvas(),
      initialDocument: createDefaultArenaMap(),
      initialMode: "explore",
      matchColorSeed: 33
    });

    (client as any).pointerLocked = true;
    (client as any).runtimePaused = false;
    (client as any).latestFrame = createReadyRuntimeFrame();

    (client as any).handleKeyDown({
      code: "KeyF",
      preventDefault: vi.fn(),
      target: window,
      metaKey: false,
      ctrlKey: false,
      repeat: false
    });

    expect((client as any).keyboardState.placePressed).toBe(true);
    expect((client as any).keyboardState.egg).toBe(false);
    expect((client as any).eggChargeState.active).toBe(false);

    client.dispose();
  });

  it("does not launch eggs from modifier keys and ignores runtime build on Q", () => {
    const client = GameClient.mount({
      canvas: createCanvas(),
      initialDocument: createDefaultArenaMap(),
      initialMode: "explore",
      matchColorSeed: 34
    });

    (client as any).pointerLocked = true;
    (client as any).runtimePaused = false;
    (client as any).latestFrame = createReadyRuntimeFrame();

    const modifierPreventDefault = vi.fn();
    (client as any).handleKeyDown({
      code: "KeyW",
      preventDefault: modifierPreventDefault,
      target: window,
      metaKey: true,
      ctrlKey: false
    });
    expect(modifierPreventDefault).toHaveBeenCalled();

    (client as any).handleKeyDown({
      code: "KeyQ",
      preventDefault: vi.fn(),
      target: window,
      metaKey: false,
      ctrlKey: false
    });
    expect((client as any).keyboardState.placePressed).toBe(false);

    (client as any).handleKeyDown({
      code: "KeyE",
      preventDefault: vi.fn(),
      target: window,
      metaKey: false,
      ctrlKey: true
    });
    expect((client as any).keyboardState.egg).toBe(false);
    expect((client as any).eggChargeState.active).toBe(false);

    client.dispose();
  });

  it("queues a quick egg on tap E and a charged throw on hold E", () => {
    const client = GameClient.mount({
      canvas: createCanvas(),
      initialDocument: createDefaultArenaMap(),
      initialMode: "explore",
      matchColorSeed: 35
    });

    (client as any).pointerLocked = true;
    (client as any).runtimePaused = false;
    (client as any).latestFrame = createReadyRuntimeFrame();

    (client as any).handleKeyDown({
      code: "KeyE",
      preventDefault: vi.fn(),
      target: window,
      metaKey: false,
      ctrlKey: false
    });
    (client as any).handleKeyUp({
      code: "KeyE",
      preventDefault: vi.fn()
    });

    expect((client as any).quickEggQueued).toBe(true);

    (client as any).quickEggQueued = false;

    (client as any).handleKeyDown({
      code: "KeyE",
      preventDefault: vi.fn(),
      target: window,
      metaKey: false,
      ctrlKey: false
    });
    (client as any).updateHoldToThrowState((client as any).getLocalRuntimePlayer(), 0.2);
    expect((client as any).eggChargeState.active).toBe(true);

    (client as any).handleKeyUp({
      code: "KeyE",
      preventDefault: vi.fn()
    });

    expect((client as any).eggChargeState.pendingThrow).toBe(true);

    client.dispose();
  });

  it("queues a quick egg on RMB tap in runtime play", () => {
    const client = GameClient.mount({
      canvas: createCanvas(),
      initialDocument: createDefaultArenaMap(),
      initialMode: "explore",
      matchColorSeed: 36
    });

    const worker = MockWorker.instances[0]!;
    (client as any).pointerLocked = true;
    (client as any).runtimePaused = false;
    (client as any).latestFrame = createReadyRuntimeFrame();
    const preventDefault = vi.fn();

    (client as any).handlePointerDown({
      button: 2,
      preventDefault
    });
    (client as any).handlePointerUp({
      button: 2,
      preventDefault
    });

    expect(preventDefault).toHaveBeenCalledTimes(2);
    expect((client as any).quickEggQueued).toBe(true);
    expect((client as any).destroyQueued).toBe(false);

    (client as any).sendRuntimeInput((client as any).getLocalRuntimePlayer(), 0);
    const lastMessage = worker.postMessage.mock.calls.at(-1)?.[0];
    const command = unpackRuntimeInputCommand(lastMessage.buffer);
    expect(command.layEgg).toBe(true);
    expect(command.destroy).toBe(false);
    expect(command.place).toBe(false);

    client.dispose();
  });

  it("queues harvest on primary click in runtime play", () => {
    const client = GameClient.mount({
      canvas: createCanvas(),
      initialDocument: createDefaultArenaMap(),
      initialMode: "explore",
      matchColorSeed: 36
    });

    const worker = MockWorker.instances[0]!;
    (client as any).pointerLocked = true;
    (client as any).runtimePaused = false;
    (client as any).latestFrame = createReadyRuntimeFrame();
    vi.spyOn(client as any, "resolveHarvestTarget").mockReturnValue({
      voxel: { x: 4, y: 2, z: 5 },
      normal: { x: 0, y: 1, z: 0 }
    });

    (client as any).handlePointerDown({
      button: 0,
      preventDefault: vi.fn()
    });

    expect((client as any).destroyQueued).toBe(true);
    expect((client as any).queuedDestroyTarget).toEqual({
      voxel: { x: 4, y: 2, z: 5 },
      normal: { x: 0, y: 1, z: 0 }
    });

    (client as any).sendRuntimeInput((client as any).getLocalRuntimePlayer(), 0.04);
    const lastMessage = worker.postMessage.mock.calls.at(-1)?.[0];
    const command = unpackRuntimeInputCommand(lastMessage.buffer);
    expect(command.destroy).toBe(true);
    expect(command.layEgg).toBe(false);
    expect(command.targetVoxel).toEqual({ x: 4, y: 2, z: 5 });
    expect(command.targetNormal).toEqual({ x: 0, y: 1, z: 0 });

    client.dispose();
  });

  it("places on F when a build target is focused", () => {
    const client = GameClient.mount({
      canvas: createCanvas(),
      initialDocument: createDefaultArenaMap(),
      initialMode: "explore",
      matchColorSeed: 37
    });

    const worker = MockWorker.instances[0]!;

    (client as any).pointerLocked = true;
    (client as any).runtimePaused = false;
    (client as any).latestFrame = createReadyRuntimeFrame();
    (client as any).focusedTarget = {
      voxel: { x: 4, y: 2, z: 5 },
      normal: { x: 0, y: 1, z: 0 }
    };

    (client as any).handleKeyDown({
      code: "KeyF",
      preventDefault: vi.fn(),
      target: window,
      metaKey: false,
      ctrlKey: false,
      repeat: false
    });

    (client as any).sendRuntimeInput((client as any).getLocalRuntimePlayer(), 0);
    const lastMessage = worker.postMessage.mock.calls.at(-1)?.[0];
    const command = unpackRuntimeInputCommand(lastMessage.buffer);

    expect(command.place).toBe(true);
    expect(command.targetVoxel).toEqual({ x: 4, y: 2, z: 5 });
    expect(command.targetNormal).toEqual({ x: 0, y: 1, z: 0 });
    expect((client as any).keyboardState.placePressed).toBe(false);

    client.dispose();
  });

  it("does not place on F when no build target is focused", () => {
    const client = GameClient.mount({
      canvas: createCanvas(),
      initialDocument: createDefaultArenaMap(),
      initialMode: "explore",
      matchColorSeed: 38
    });

    const worker = MockWorker.instances[0]!;
    (client as any).pointerLocked = true;
    (client as any).runtimePaused = false;
    (client as any).latestFrame = createReadyRuntimeFrame();

    (client as any).handleKeyDown({
      code: "KeyF",
      preventDefault: vi.fn(),
      target: window,
      metaKey: false,
      ctrlKey: false,
      repeat: false
    });

    (client as any).sendRuntimeInput((client as any).getLocalRuntimePlayer(), 0.04);
    const lastMessage = worker.postMessage.mock.calls.at(-1)?.[0];
    const command = unpackRuntimeInputCommand(lastMessage.buffer);

    expect(command.place).toBe(false);
    expect(command.targetVoxel).toBe(null);
    expect(command.targetNormal).toBe(null);

    client.dispose();
  });

  it("prefers a nearby valid harvest snap target over an invalid center target", () => {
    const client = GameClient.mount({
      canvas: createCanvas(),
      initialDocument: createDefaultArenaMap(),
      initialMode: "explore",
      matchColorSeed: 42
    });

    const worker = MockWorker.instances[0]!;
    (client as any).pointerLocked = true;
    (client as any).runtimePaused = false;
    (client as any).latestFrame = createReadyRuntimeFrame({
      focusState: {
        focusedVoxel: { x: 24, y: 2, z: 24 },
        targetNormal: { x: 0, y: 1, z: 0 },
        placeVoxel: { x: 24, y: 3, z: 24 },
        destroyValid: false,
        placeValid: false,
        invalidReason: "outOfRange"
      }
    });
    const runtimeWorld = new MutableVoxelWorld(createDefaultArenaMap());
    runtimeWorld.setVoxel(24, 2, 24, "ground");
    runtimeWorld.setVoxel(4, 2, 5, "ground");
    (client as any).runtimeWorld = runtimeWorld;
    vi.spyOn(client as any, "getTerrainTargetAtPointer").mockImplementation(
      (offsetX = 0, offsetY = 0) => {
        if (offsetX === 0 && offsetY === 0) {
          return {
            voxel: { x: 24, y: 2, z: 24 },
            normal: { x: 0, y: 1, z: 0 }
          };
        }

        if (offsetX === 0.018 && offsetY === 0) {
          return {
            voxel: { x: 4, y: 2, z: 5 },
            normal: { x: 0, y: 1, z: 0 }
          };
        }

        return null;
      }
    );

    (client as any).handlePointerDown({
      button: 0,
      preventDefault: vi.fn()
    });

    expect((client as any).destroyQueued).toBe(true);
    expect((client as any).harvestFocusOverride?.focusState.focusedVoxel).toEqual({ x: 4, y: 2, z: 5 });

    (client as any).sendRuntimeInput((client as any).getLocalRuntimePlayer(), 0);
    const lastMessage = worker.postMessage.mock.calls.at(-1)?.[0];
    const command = unpackRuntimeInputCommand(lastMessage.buffer);

    expect(command.destroy).toBe(true);
    expect(command.targetVoxel).toEqual({ x: 4, y: 2, z: 5 });
    expect(command.targetNormal).toEqual({ x: 0, y: 1, z: 0 });

    client.dispose();
  });

  it("starts a charged throw from RMB hold in runtime mode", () => {
    const client = GameClient.mount({
      canvas: createCanvas(),
      initialDocument: createDefaultArenaMap(),
      initialMode: "explore",
      matchColorSeed: 39
    });

    (client as any).pointerLocked = true;
    (client as any).runtimePaused = false;
    (client as any).latestFrame = createReadyRuntimeFrame();

    (client as any).handlePointerDown({
      button: 2,
      preventDefault: vi.fn()
    });
    (client as any).updateHoldToThrowState((client as any).getLocalRuntimePlayer(), 0.2);

    expect((client as any).eggChargeState.active).toBe(true);
    expect((client as any).eggChargeState.source).toBe("pointer");
    expect((client as any).destroyQueued).toBe(false);

    (client as any).handlePointerUp({
      button: 2,
      preventDefault: vi.fn()
    });

    expect((client as any).eggChargeState.pendingThrow).toBe(true);

    client.dispose();
  });

  it("sends a fast Space tap as queued jump edges on the next runtime input", () => {
    const client = GameClient.mount({
      canvas: createCanvas(),
      initialDocument: createDefaultArenaMap(),
      initialMode: "explore",
      matchColorSeed: 40
    });

    const worker = MockWorker.instances[0]!;
    (client as any).pointerLocked = true;
    (client as any).runtimePaused = false;
    (client as any).latestFrame = createReadyRuntimeFrame();

    (client as any).handleKeyDown({
      code: "Space",
      key: " ",
      preventDefault: vi.fn(),
      target: window,
      metaKey: false,
      ctrlKey: false,
      repeat: false
    });
    (client as any).handleKeyUp({
      code: "Space",
      preventDefault: vi.fn()
    });

    expect((client as any).keyboardState.jump).toBe(false);
    expect((client as any).keyboardState.jumpPressed).toBe(true);
    expect((client as any).keyboardState.jumpReleased).toBe(true);

    (client as any).sendRuntimeInput((client as any).getLocalRuntimePlayer(), 0.04);

    const lastMessage = worker.postMessage.mock.calls.at(-1)?.[0];
    const command = unpackRuntimeInputCommand(lastMessage.buffer);
    expect(command.jump).toBe(false);
    expect(command.jumpPressed).toBe(true);
    expect(command.jumpReleased).toBe(true);
    expect((client as any).keyboardState.jumpPressed).toBe(false);
    expect((client as any).keyboardState.jumpReleased).toBe(false);

    client.dispose();
  });

  it("throttles steady runtime input changes to the network cadence but still sends immediate actions right away", () => {
    const client = GameClient.mount({
      canvas: createCanvas(),
      initialDocument: createDefaultArenaMap(),
      initialMode: "explore",
      matchColorSeed: 44
    });

    const worker = MockWorker.instances[0]!;
    (client as any).pointerLocked = true;
    (client as any).runtimePaused = false;
    (client as any).latestFrame = createReadyRuntimeFrame();
    const localPlayer = (client as any).getLocalRuntimePlayer();
    const initialMessageCount = worker.postMessage.mock.calls.length;

    (client as any).keyboardState.forward = true;
    (client as any).sendRuntimeInput(localPlayer, 0);

    expect(worker.postMessage.mock.calls).toHaveLength(initialMessageCount + 1);
    const firstMessage = worker.postMessage.mock.calls.at(-1)?.[0];
    const firstCommand = unpackRuntimeInputCommand(firstMessage.buffer);
    expect(firstCommand.seq).toBe(0);

    (client as any).keyboardState.right = true;
    (client as any).sendRuntimeInput(localPlayer, 0.01);
    expect(worker.postMessage.mock.calls).toHaveLength(initialMessageCount + 1);

    (client as any).sendRuntimeInput(localPlayer, 0.04);
    expect(worker.postMessage.mock.calls).toHaveLength(initialMessageCount + 2);
    const secondMessage = worker.postMessage.mock.calls.at(-1)?.[0];
    const secondCommand = unpackRuntimeInputCommand(secondMessage.buffer);
    expect(secondCommand.seq).toBe(1);
    expect(secondCommand.moveX).not.toBe(firstCommand.moveX);

    (client as any).keyboardState.jump = true;
    (client as any).keyboardState.jumpPressed = true;
    (client as any).sendRuntimeInput(localPlayer, 0.05);

    expect(worker.postMessage.mock.calls).toHaveLength(initialMessageCount + 3);
    const thirdMessage = worker.postMessage.mock.calls.at(-1)?.[0];
    const thirdCommand = unpackRuntimeInputCommand(thirdMessage.buffer);
    expect(thirdCommand.seq).toBe(2);
    expect(thirdCommand.jumpPressed).toBe(true);

    client.dispose();
  });

  it("repeats held harvest pulses on a 100ms cadence instead of every frame", () => {
    const client = GameClient.mount({
      canvas: createCanvas(),
      initialDocument: createDefaultArenaMap(),
      initialMode: "explore",
      matchColorSeed: 41
    });

    const worker = MockWorker.instances[0]!;
    const harvestTarget = {
      voxel: { x: 4, y: 2, z: 5 },
      normal: { x: 0, y: 1, z: 0 }
    };

    (client as any).pointerLocked = true;
    (client as any).runtimePaused = false;
    (client as any).latestFrame = createReadyRuntimeFrame();
    vi.spyOn(client as any, "resolveHarvestTarget").mockReturnValue(harvestTarget);

    (client as any).handlePointerDown({
      button: 0,
      preventDefault: vi.fn()
    });
    expect((client as any).destroyQueued).toBe(true);

    (client as any).sendRuntimeInput((client as any).getLocalRuntimePlayer());
    let lastMessage = worker.postMessage.mock.calls.at(-1)?.[0];
    let command = unpackRuntimeInputCommand(lastMessage.buffer);
    expect(command.destroy).toBe(true);
    expect(command.targetVoxel).toEqual(harvestTarget.voxel);

    expect((client as any).destroyQueued).toBe(false);
    (client as any).updateHeldHarvest((client as any).getLocalRuntimePlayer(), 0.05);
    expect((client as any).destroyQueued).toBe(false);

    (client as any).updateHeldHarvest((client as any).getLocalRuntimePlayer(), 0.11);
    expect((client as any).destroyQueued).toBe(true);

    (client as any).sendRuntimeInput((client as any).getLocalRuntimePlayer());
    lastMessage = worker.postMessage.mock.calls.at(-1)?.[0];
    command = unpackRuntimeInputCommand(lastMessage.buffer);
    expect(command.destroy).toBe(true);
    expect(command.targetVoxel).toEqual(harvestTarget.voxel);

    client.dispose();
  });

  it("updates the runtime focus cue from the worker frame state", () => {
    const client = GameClient.mount({
      canvas: createCanvas(),
      initialDocument: createDefaultArenaMap(),
      initialMode: "explore",
      matchColorSeed: 43
    });

    const worker = MockWorker.instances[0]!;
    (client as any).pointerLocked = true;
    (client as any).focusedTarget = {
      voxel: { x: 4, y: 2, z: 5 },
      normal: { x: 0, y: 1, z: 0 }
    };

    worker.emit({
      type: "frame",
      frame: createReadyRuntimeFrame({
        focusState: {
          focusedVoxel: { x: 4, y: 2, z: 5 },
          targetNormal: { x: 0, y: 1, z: 0 },
          placeVoxel: { x: 4, y: 3, z: 5 },
          destroyValid: false,
          placeValid: false,
          invalidReason: "outOfRange"
        }
      })
    });

    expect((client as any).focusOutline.visible).toBe(false);
    expect((client as any).focusGhost.visible).toBe(false);

    worker.emit({
      type: "frame",
      frame: createReadyRuntimeFrame()
    });

    expect((client as any).focusOutline.visible).toBe(true);
    expect((client as any).focusGhost.visible).toBe(true);

    client.dispose();
  });

  it("queues push on double tap W without breaking forward movement", () => {
    const client = GameClient.mount({
      canvas: createCanvas(),
      initialDocument: createDefaultArenaMap(),
      initialMode: "explore",
      matchColorSeed: 40
    });

    const worker = MockWorker.instances[0]!;
    const performanceNowSpy = vi.spyOn(performance, "now");
    performanceNowSpy.mockReturnValueOnce(100);
    performanceNowSpy.mockReturnValueOnce(260);

    (client as any).pointerLocked = true;
    (client as any).runtimePaused = false;
    (client as any).latestFrame = createReadyRuntimeFrame();

    (client as any).handleKeyDown({
      code: "KeyW",
      preventDefault: vi.fn(),
      target: window,
      metaKey: false,
      ctrlKey: false,
      repeat: false
    });
    (client as any).handleKeyUp({
      code: "KeyW",
      preventDefault: vi.fn()
    });
    (client as any).handleKeyDown({
      code: "KeyW",
      preventDefault: vi.fn(),
      target: window,
      metaKey: false,
      ctrlKey: false,
      repeat: false
    });

    expect((client as any).keyboardState.forward).toBe(true);
    expect((client as any).keyboardState.pushPressed).toBe(true);

    (client as any).sendRuntimeInput((client as any).getLocalRuntimePlayer());
    const lastMessage = worker.postMessage.mock.calls.at(-1)?.[0];
    const command = unpackRuntimeInputCommand(lastMessage.buffer);

    expect(command.push).toBe(true);
    expect(command.moveX).toBeCloseTo(1, 4);
    expect(command.moveZ).toBeCloseTo(0, 4);
    expect((client as any).keyboardState.pushPressed).toBe(false);

    performanceNowSpy.mockRestore();
    client.dispose();
  });

  it("ignores key repeat when detecting double tap W push", () => {
    const client = GameClient.mount({
      canvas: createCanvas(),
      initialDocument: createDefaultArenaMap(),
      initialMode: "explore",
      matchColorSeed: 41
    });

    const performanceNowSpy = vi.spyOn(performance, "now");
    performanceNowSpy.mockReturnValue(100);

    (client as any).pointerLocked = true;
    (client as any).runtimePaused = false;
    (client as any).latestFrame = createReadyRuntimeFrame();

    (client as any).handleKeyDown({
      code: "KeyW",
      preventDefault: vi.fn(),
      target: window,
      metaKey: false,
      ctrlKey: false,
      repeat: false
    });
    (client as any).handleKeyDown({
      code: "KeyW",
      preventDefault: vi.fn(),
      target: window,
      metaKey: false,
      ctrlKey: false,
      repeat: true
    });

    expect((client as any).keyboardState.pushPressed).toBe(false);

    performanceNowSpy.mockRestore();
    client.dispose();
  });

  it("does not start grounded egg charge when egg availability is blocked", () => {
    const client = GameClient.mount({
      canvas: createCanvas(),
      initialDocument: createDefaultArenaMap(),
      initialMode: "explore",
      matchColorSeed: 52
    });

    (client as any).pointerLocked = true;
    (client as any).runtimePaused = false;
    (client as any).latestFrame = {
      localPlayerId: "human-1",
      players: [
        {
          id: "human-1",
          alive: true,
          fallingOut: false,
          grounded: true,
          mass: 18,
          respawning: false,
          stunRemaining: 0,
          spacePhase: "none"
        }
      ],
      eggs: []
    };

    (client as any).handleKeyDown({
      code: "KeyE",
      preventDefault: vi.fn(),
      target: window,
      metaKey: false,
      ctrlKey: false
    });
    (client as any).updateHoldToThrowState((client as any).getLocalRuntimePlayer(), 0.2);

    expect((client as any).keyboardState.egg).toBe(true);
    expect((client as any).eggChargeState.active).toBe(false);

    client.dispose();
  });

  it("triggers matter pulse feedback and updates the chicken message when egg launches fail from low matter", () => {
    const host = document.createElement("div");
    const canvas = createCanvas();
    host.appendChild(canvas);
    document.body.appendChild(host);
    const onRuntimeOverlayChange = vi.fn();
    const client = GameClient.mount({
      canvas,
      initialDocument: createDefaultArenaMap(),
      initialMode: "explore",
      matchColorSeed: 54,
      onRuntimeOverlayChange
    });

    const noMatterFrame = createReadyRuntimeFrame();
    (noMatterFrame.players[0] as any).mass = 18;
    (noMatterFrame.hudState!.localPlayer as any).mass = 18;
    (noMatterFrame.hudState!.eggStatus as any) = {
      reason: "notEnoughMatter",
      hasMatter: false,
      ready: false,
      activeCount: 0,
      maxActiveCount: 2,
      cost: 42,
      cooldownRemaining: 0,
      cooldownDuration: 1.6,
      canQuickEgg: false,
      canChargedThrow: false
    };

    (client as any).pointerLocked = true;
    (client as any).runtimePaused = false;
    (client as any).latestFrame = noMatterFrame;

    (client as any).handleKeyDown({
      code: "KeyE",
      preventDefault: vi.fn(),
      target: window,
      metaKey: false,
      ctrlKey: false
    });

    expect(onRuntimeOverlayChange).toHaveBeenLastCalledWith({
      matterPulseActive: true,
      spaceFailPulseActive: false,
      spaceMistakePulseActive: false,
      spaceSuccessPulseActive: false,
      spaceLocalTargetKey: null,
      spaceLocalHitCount: 0
    });
    expect((client as any).eggChargeState.active).toBe(false);
    expect(
      (client as any).resourceBubbleElement?.querySelector(".chicken-taunt__text")?.textContent
    ).toBe("I need more matter");

    (client as any).applyRuntimeFrame(1 / 60, 2);
    expect(onRuntimeOverlayChange).toHaveBeenLastCalledWith({
      matterPulseActive: false,
      spaceFailPulseActive: false,
      spaceMistakePulseActive: false,
      spaceSuccessPulseActive: false,
      spaceLocalTargetKey: null,
      spaceLocalHitCount: 0
    });

    client.dispose();
    host.remove();
  });

  it("does not send immediate egg throws when egg availability is blocked", () => {
    const client = GameClient.mount({
      canvas: createCanvas(),
      initialDocument: createDefaultArenaMap(),
      initialMode: "explore",
      matchColorSeed: 53
    });

    const worker = MockWorker.instances[0]!;
    (client as any).pointerLocked = true;
    (client as any).runtimePaused = false;
    (client as any).latestFrame = {
      localPlayerId: "human-1",
      players: [
        {
          id: "human-1",
          alive: true,
          fallingOut: false,
          grounded: false,
          mass: 18,
          respawning: false,
          stunRemaining: 0,
          spacePhase: "none"
        }
      ],
      eggs: []
    };

    (client as any).handleKeyDown({
      code: "KeyE",
      preventDefault: vi.fn(),
      target: window,
      metaKey: false,
      ctrlKey: false
    });
    (client as any).handleKeyUp({
      code: "KeyE",
      preventDefault: vi.fn()
    });

    (client as any).sendRuntimeInput((client as any).getLocalRuntimePlayer());

    const lastMessage = worker.postMessage.mock.calls.at(-1)?.[0];
    const command = unpackRuntimeInputCommand(lastMessage.buffer);
    expect(command.layEgg).toBe(false);

    client.dispose();
  });

  it("hides the egg trajectory preview when charged throws are blocked", () => {
    const client = GameClient.mount({
      canvas: createCanvas(),
      initialDocument: createDefaultArenaMap(),
      initialMode: "explore",
      matchColorSeed: 55
    });

    (client as any).pointerLocked = true;
    (client as any).runtimePaused = false;
    (client as any).latestFrame = createReadyRuntimeFrame({
      hudState: {
        ...createReadyRuntimeFrame().hudState,
        eggStatus: {
          reason: "cooldown",
          hasMatter: true,
          ready: false,
          activeCount: 2,
          maxActiveCount: 2,
          cost: 42,
          cooldownRemaining: 0.8,
          cooldownDuration: 1.6,
          canQuickEgg: false,
          canChargedThrow: false
        }
      }
    });
    (client as any).eggChargeState.active = true;
    (client as any).eggChargeState.source = "key";
    (client as any).eggKeyAction.pressed = true;

    (client as any).updateEggLaunchPreview((client as any).getLocalRuntimePlayer(), 1.2);

    const preview = (client as any).eggTrajectoryPreview;
    expect(preview.group.visible).toBe(false);
    expect(preview.landingRing.visible).toBe(false);

    client.dispose();
  });

  it("applies the egg launch telegraph only to the local chicken while charging", () => {
    const canvas = createCanvas();
    const client = GameClient.mount({
      canvas,
      initialDocument: createDefaultArenaMap(),
      initialMode: "explore",
      matchColorSeed: 41
    });

    (client as any).eggChargeState.chargeAlpha = 0.82;

    (client as any).syncPlayers(
      [
        {
          id: "human-1",
          name: "You",
          kind: "human",
          alive: true,
          fallingOut: false,
          grounded: true,
          mass: 24,
          livesRemaining: 3,
          maxLives: 3,
          respawning: false,
          invulnerableRemaining: 0,
          stunRemaining: 0,
          pushVisualRemaining: 0,
          spacePhase: "none",
          spacePhaseRemaining: 0,
          position: { x: 4, y: 2, z: 5 },
          velocity: { x: 0.1, y: 0, z: 0 },
          facing: { x: 1, z: 0 },
          jetpackActive: false,
          eliminatedAt: null
        },
        {
          id: "npc-1",
          name: "NPC 1",
          kind: "npc",
          alive: true,
          fallingOut: false,
          grounded: true,
          mass: 24,
          livesRemaining: 3,
          maxLives: 3,
          respawning: false,
          invulnerableRemaining: 0,
          stunRemaining: 0,
          pushVisualRemaining: 0,
          spacePhase: "none",
          spacePhaseRemaining: 0,
          position: { x: 8, y: 2, z: 8 },
          velocity: { x: 0.1, y: 0, z: 0 },
          facing: { x: 1, z: 0 },
          jetpackActive: false,
          eliminatedAt: null
        }
      ],
      "human-1",
      1 / 60,
      1.25
    );

    const localVisual = (client as any).playerVisuals.get("human-1");
    const npcVisual = (client as any).playerVisuals.get("npc-1");

    expect(Math.abs(localVisual.rightWing.rotation.z)).toBeGreaterThan(Math.abs(npcVisual.rightWing.rotation.z));
    expect(localVisual.shell.rotation.z).toBeLessThan(npcVisual.shell.rotation.z);

    client.dispose();
  });

  it("routes mash-challenge letters into typedText and ignores space input", () => {
    const client = GameClient.mount({
      canvas: createCanvas(),
      initialDocument: createDefaultArenaMap(),
      initialMode: "explore",
      matchColorSeed: 41
    });

    const worker = MockWorker.instances[0]!;
    (client as any).pointerLocked = true;
    (client as any).runtimePaused = false;
    (client as any).latestFrame = createReadyRuntimeFrame({
      hudState: {
        ...createReadyRuntimeFrame().hudState,
        spaceChallenge: {
          targetKey: "w",
          hits: 0,
          requiredHits: 5,
          phase: "mash" as const
        }
      }
    });

    (client as any).handleKeyDown({
      code: "KeyW",
      key: "w",
      repeat: false,
      altKey: false,
      metaKey: false,
      ctrlKey: false,
      preventDefault: vi.fn(),
      target: window
    });

    expect((client as any).keyboardState.forward).toBe(false);
    (client as any).sendRuntimeInput((client as any).getLocalRuntimePlayer(), 0);

    let lastMessage = worker.postMessage.mock.calls.at(-1)?.[0];
    expect(unpackRuntimeInputCommand(lastMessage.buffer).typedText).toBe("w");

    (client as any).latestFrame = createReadyRuntimeFrame({
      hudState: {
        ...createReadyRuntimeFrame().hudState,
        spaceChallenge: {
          targetKey: "g",
          hits: 2,
          requiredHits: 5,
          phase: "mash" as const
        }
      }
    });

    (client as any).handleKeyDown({
      code: "Space",
      key: " ",
      repeat: false,
      altKey: false,
      metaKey: false,
      ctrlKey: false,
      preventDefault: vi.fn(),
      target: window
    });

    expect((client as any).keyboardState.jump).toBe(false);
    (client as any).sendRuntimeInput((client as any).getLocalRuntimePlayer(), 0.04);

    lastMessage = worker.postMessage.mock.calls.at(-1)?.[0];
    const spaceCommand = unpackRuntimeInputCommand(lastMessage.buffer);
    expect(spaceCommand.typedText).toBe("");
    expect(spaceCommand.jump).toBe(false);

    client.dispose();
  });

  it("still sends mash-challenge input in multiplayer when the local player entity is temporarily unresolved", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = GameClient.mount({
      canvas: createCanvas(),
      initialDocument: createDefaultArenaMap(),
      initialMode: "multiplayer",
      matchColorSeed: 47
    });

    const worker = MockWorker.instances[0]!;
    (client as any).pointerLocked = true;
    (client as any).runtimePaused = false;
    (client as any).latestFrame = createReadyRuntimeFrame({
      mode: "multiplayer",
      localPlayerId: "human-1",
      players: [],
      hudState: {
        ...createReadyRuntimeFrame().hudState,
        mode: "multiplayer" as const,
        spaceChallenge: {
          targetKey: "g",
          hits: 2,
          requiredHits: 5,
          phase: "mash" as const
        }
      }
    });

    (client as any).handleKeyDown({
      code: "KeyG",
      key: "g",
      repeat: false,
      altKey: false,
      metaKey: false,
      ctrlKey: false,
      preventDefault: vi.fn(),
      target: window
    });

    expect((client as any).keyboardState.jump).toBe(false);
    (client as any).sendRuntimeInput(null);

    const lastMessage = worker.postMessage.mock.calls.at(-1)?.[0];
    const command = unpackRuntimeInputCommand(lastMessage.buffer);
    expect(command.typedText).toBe("g");
    expect(command.jump).toBe(false);
    expect(command.jumpPressed).toBe(false);
    expect(command.jumpReleased).toBe(false);
    if (import.meta.env.DEV) {
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Missing local runtime player"),
        expect.objectContaining({
          localPlayerId: "human-1",
          spaceChallenge: expect.objectContaining({
            targetKey: "g",
            phase: "mash"
          })
        })
      );
    } else {
      expect(warnSpy).not.toHaveBeenCalled();
    }

    warnSpy.mockRestore();
    client.dispose();
  });

  it("fires local mash mistake and success pulses without waiting for a frame round-trip", () => {
    const onRuntimeOverlayChange = vi.fn();
    const client = GameClient.mount({
      canvas: createCanvas(),
      initialDocument: createDefaultArenaMap(),
      initialMode: "explore",
      matchColorSeed: 43,
      onRuntimeOverlayChange
    });

    (client as any).pointerLocked = true;
    (client as any).runtimePaused = false;
    (client as any).latestFrame = createReadyRuntimeFrame({
      hudState: {
        ...createReadyRuntimeFrame().hudState,
        spaceChallenge: {
          targetKey: "w",
          hits: 0,
          requiredHits: 3,
          phase: "mash" as const
        }
      }
    });

    (client as any).handleKeyDown({
      code: "KeyE",
      key: "e",
      repeat: false,
      altKey: false,
      metaKey: false,
      ctrlKey: false,
      preventDefault: vi.fn(),
      target: window
    });

    expect(onRuntimeOverlayChange).toHaveBeenLastCalledWith({
      matterPulseActive: false,
      spaceFailPulseActive: false,
      spaceMistakePulseActive: true,
      spaceSuccessPulseActive: false,
      spaceLocalTargetKey: "w",
      spaceLocalHitCount: 0
    });

    for (const key of ["w", "w", "w"]) {
      (client as any).handleKeyDown({
        code: `Key${key.toUpperCase()}`,
        key,
        repeat: false,
        altKey: false,
        metaKey: false,
        ctrlKey: false,
        preventDefault: vi.fn(),
        target: window
      });
    }

    expect(onRuntimeOverlayChange).toHaveBeenLastCalledWith({
      matterPulseActive: false,
      spaceFailPulseActive: false,
      spaceMistakePulseActive: true,
      spaceSuccessPulseActive: true,
      spaceLocalTargetKey: "w",
      spaceLocalHitCount: 3
    });

    client.dispose();
  });

  it("leans and swells the local chicken into a priming pose while mashing in space", () => {
    const client = GameClient.mount({
      canvas: createCanvas(),
      initialDocument: createDefaultArenaMap(),
      initialMode: "explore",
      matchColorSeed: 37
    });

    const player = {
      id: "human-1",
      name: "You",
      kind: "human" as const,
      alive: true,
      fallingOut: false,
      grounded: false,
      mass: 84,
      livesRemaining: 3,
      maxLives: 3,
      respawning: false,
      invulnerableRemaining: 0,
      stunRemaining: 0,
      pushVisualRemaining: 0,
      spacePhase: "float" as const,
      spacePhaseRemaining: 2.4,
      position: { x: 4, y: 22, z: 5 },
      velocity: { x: 0.8, y: 0.2, z: 0 },
      facing: { x: 0, z: 1 },
      jetpackActive: false,
      eliminatedAt: null
    };

    (client as any).syncPlayers([player], "human-1", 1 / 60, 1.25);
    const visual = (client as any).playerVisuals.get("human-1");
    const baselinePitch = visual.shell.rotation.x;
    const baselineYaw = visual.body.rotation.y;
    const baselineForwardOffset = visual.avatar.position.z;
    const baselineScale = visual.avatar.scale.x;

    (client as any).localSpaceChallengeTargetKey = "g";
    (client as any).localSpaceChallengeHitCount = 3;
    (client as any).latestFrame = createReadyRuntimeFrame({
      players: [player],
      hudState: {
        ...createReadyRuntimeFrame().hudState,
        spaceChallenge: {
          targetKey: "g",
          hits: 3,
          requiredHits: 5,
          phase: "mash" as const
        }
      }
    });
    (client as any).spaceTypePrimeUntil = 1.45;
    (client as any).spaceTypeMisfireUntil = 1.35;
    (client as any).syncPlayers([player], "human-1", 1 / 60, 1.25);

    expect(visual.shell.rotation.x).toBeGreaterThan(baselinePitch);
    expect(visual.body.rotation.y).toBeGreaterThan(baselineYaw);
    expect(visual.avatar.position.z).toBeLessThan(baselineForwardOffset);
    expect(visual.avatar.scale.x).toBeGreaterThan(baselineScale);

    client.dispose();
  });

  it("keeps the bomb shell visible through dive and impact phases and starts the impact jolt", () => {
    const client = GameClient.mount({
      canvas: createCanvas(),
      initialDocument: createDefaultArenaMap(),
      initialMode: "explore",
      matchColorSeed: 33
    });

    (client as any).syncPlayers(
      [
        {
          id: "human-1",
          name: "You",
          kind: "human",
          alive: true,
          fallingOut: false,
          grounded: false,
          mass: 84,
          livesRemaining: 3,
          maxLives: 3,
          respawning: false,
          invulnerableRemaining: 0,
          stunRemaining: 0,
          pushVisualRemaining: 0,
          spacePhase: "superBoomDive",
          spacePhaseRemaining: 0,
          position: { x: 4, y: 12, z: 5 },
          velocity: { x: 0, y: -28, z: 0 },
          facing: { x: 0, z: 1 },
          jetpackActive: false,
          eliminatedAt: null
        }
      ],
      "human-1",
      1 / 60,
      1.25
    );

    const visual = (client as any).playerVisuals.get("human-1");

    expect(visual.root.visible).toBe(false);
    expect(visual.bomb.visible).toBe(true);
    expect(visual.bomb.scale.x).toBeGreaterThan(1.9);

    (client as any).latestFrame = createReadyRuntimeFrame({
      players: [
        {
          ...(createReadyRuntimeFrame().players[0] as object),
          spacePhase: "superBoomImpact" as const,
          position: { x: 4, y: 2.05, z: 5 },
          velocity: { x: 0, y: 0, z: 0 }
        }
      ],
      hudState: {
        ...createReadyRuntimeFrame().hudState,
        spaceChallenge: {
          targetKey: "g",
          hits: 5,
          requiredHits: 5,
          phase: "dive" as const
        }
      }
    });

    (client as any).applyRuntimeFrame(1 / 60, 1.4);

    expect((client as any).superBoomImpactJoltUntil).toBeGreaterThan(1.4);
    expect(visual.root.visible).toBe(false);
    expect(visual.bomb.visible).toBe(true);
    expect(visual.bomb.position.y).toBeLessThan(0.82);

    (client as any).syncPlayers(
      [
        {
          ...(createReadyRuntimeFrame().players[0] as object),
          spacePhase: "none" as const,
          position: { x: 5.2, y: 3.3, z: 6.1 },
          velocity: { x: 1.6, y: 6.2, z: 0.8 },
          facing: { x: 0, z: 1 }
        }
      ],
      "human-1",
      1 / 60,
      1.55
    );

    expect(visual.root.visible).toBe(true);
    expect(visual.bomb.visible).toBe(false);
    expect(visual.body.rotation.x).toBe(0);
    expect(visual.avatar.rotation.z).toBe(0);

    client.dispose();
  });

  it("drives runtime pointer-lock pause state and mode transitions through the worker", () => {
    const onPauseStateChange = vi.fn();
    const canvas = createCanvas();
    const client = GameClient.mount({
      canvas,
      initialDocument: createDefaultArenaMap(),
      initialMode: "explore",
      matchColorSeed: 7,
      onPauseStateChange
    });

    const worker = MockWorker.instances[0]!;
    worker.postMessage.mockClear();

    expect(client.requestPointerLock()).toBe(true);
    expect(canvas.requestPointerLock).toHaveBeenCalledTimes(1);
    expect(onPauseStateChange).toHaveBeenLastCalledWith({
      paused: true,
      hasStarted: false,
      pointerCaptureFailureReason: null,
      pointerCapturePending: true,
      pointerLocked: false
    });

    client.setRuntimePaused(true);
    expect(worker.postMessage).toHaveBeenNthCalledWith(1, {
      type: "set_runtime_paused",
      paused: true
    });
    expect(onPauseStateChange).toHaveBeenLastCalledWith({
      paused: true,
      hasStarted: false,
      pointerCaptureFailureReason: null,
      pointerCapturePending: true,
      pointerLocked: false
    });

    client.resumeRuntime();
    expect(canvas.requestPointerLock).toHaveBeenCalledTimes(2);
    expect(onPauseStateChange).toHaveBeenLastCalledWith({
      paused: true,
      hasStarted: false,
      pointerCaptureFailureReason: null,
      pointerCapturePending: true,
      pointerLocked: false
    });

    setPointerLockElement(canvas);
    document.dispatchEvent(new Event("pointerlockchange"));
    expect(worker.postMessage).toHaveBeenNthCalledWith(2, {
      type: "set_runtime_paused",
      paused: false
    });
    expect(onPauseStateChange).toHaveBeenLastCalledWith({
      paused: false,
      hasStarted: true,
      pointerCaptureFailureReason: null,
      pointerCapturePending: false,
      pointerLocked: true
    });

    client.setShellState({ mode: "editor" });
    expect(worker.postMessage).toHaveBeenNthCalledWith(3, {
      type: "set_runtime_paused",
      paused: true
    });
    expect(worker.postMessage).toHaveBeenNthCalledWith(4, {
      type: "set_mode",
      mode: "editor"
    });
    expect(onPauseStateChange).toHaveBeenLastCalledWith({
      paused: true,
      hasStarted: true,
      pointerCaptureFailureReason: null,
      pointerCapturePending: false,
      pointerLocked: true
    });

    worker.postMessage.mockClear();
    client.setShellState({ mode: "editor" });
    client.resumeRuntime();

    expect(worker.postMessage).not.toHaveBeenCalled();
    expect(canvas.requestPointerLock).toHaveBeenCalledTimes(2);

    client.dispose();
  });

  it("reports unsupported pointer lock immediately when capture cannot start", () => {
    const onPauseStateChange = vi.fn();
    const canvas = createCanvas();
    Object.defineProperty(canvas, "requestPointerLock", {
      configurable: true,
      writable: true,
      value: undefined
    });
    const client = GameClient.mount({
      canvas,
      initialDocument: createDefaultArenaMap(),
      initialMode: "explore",
      matchColorSeed: 5,
      onPauseStateChange
    });

    expect(client.requestPointerLock()).toBe(false);
    expect(onPauseStateChange).toHaveBeenLastCalledWith({
      paused: true,
      hasStarted: false,
      pointerCaptureFailureReason: "unsupported",
      pointerCapturePending: false,
      pointerLocked: false
    });

    client.dispose();
  });

  it("times out a pending pointer-lock request after one second", () => {
    vi.useFakeTimers();
    const onPauseStateChange = vi.fn();
    const canvas = createCanvas();
    const client = GameClient.mount({
      canvas,
      initialDocument: createDefaultArenaMap(),
      initialMode: "explore",
      matchColorSeed: 5,
      onPauseStateChange
    });

    expect(client.requestPointerLock()).toBe(true);
    expect(onPauseStateChange).toHaveBeenLastCalledWith({
      paused: true,
      hasStarted: false,
      pointerCaptureFailureReason: null,
      pointerCapturePending: true,
      pointerLocked: false
    });

    vi.advanceTimersByTime(1_000);

    expect(onPauseStateChange).toHaveBeenLastCalledWith({
      paused: true,
      hasStarted: false,
      pointerCaptureFailureReason: "timeout",
      pointerCapturePending: false,
      pointerLocked: false
    });

    client.dispose();
  });

  it("reports pointer-lock errors while capture is pending", () => {
    const onPauseStateChange = vi.fn();
    const canvas = createCanvas();
    const client = GameClient.mount({
      canvas,
      initialDocument: createDefaultArenaMap(),
      initialMode: "explore",
      matchColorSeed: 5,
      onPauseStateChange
    });

    expect(client.requestPointerLock()).toBe(true);
    document.dispatchEvent(new Event("pointerlockerror"));

    expect(onPauseStateChange).toHaveBeenLastCalledWith({
      paused: true,
      hasStarted: false,
      pointerCaptureFailureReason: "error",
      pointerCapturePending: false,
      pointerLocked: false
    });

    client.dispose();
  });

  it("reports focus loss when the window blurs during a pending capture", () => {
    const onPauseStateChange = vi.fn();
    const canvas = createCanvas();
    const client = GameClient.mount({
      canvas,
      initialDocument: createDefaultArenaMap(),
      initialMode: "explore",
      matchColorSeed: 5,
      onPauseStateChange
    });

    expect(client.requestPointerLock()).toBe(true);
    window.dispatchEvent(new Event("blur"));

    expect(onPauseStateChange).toHaveBeenLastCalledWith({
      paused: true,
      hasStarted: false,
      pointerCaptureFailureReason: "focus-lost",
      pointerCapturePending: false,
      pointerLocked: false
    });

    client.dispose();
  });

  it("clears held harvest and pointer egg state on window blur during runtime play", () => {
    const client = GameClient.mount({
      canvas: createCanvas(),
      initialDocument: createDefaultArenaMap(),
      initialMode: "explore",
      matchColorSeed: 6
    });

    (client as any).pointerLocked = true;
    (client as any).runtimePaused = false;
    (client as any).latestFrame = createReadyRuntimeFrame();
    vi.spyOn(client as any, "resolveHarvestTarget").mockReturnValue({
      voxel: { x: 4, y: 2, z: 5 },
      normal: { x: 0, y: 1, z: 0 }
    });

    (client as any).handlePointerDown({
      button: 0,
      preventDefault: vi.fn()
    });
    (client as any).handlePointerDown({
      button: 2,
      preventDefault: vi.fn()
    });
    (client as any).updateHoldToThrowState((client as any).getLocalRuntimePlayer(), 0.2);

    expect((client as any).harvestPointerAction.pressed).toBe(true);
    expect((client as any).eggPointerAction.pressed).toBe(true);
    expect((client as any).eggChargeState.active).toBe(true);
    expect((client as any).destroyQueued).toBe(true);

    window.dispatchEvent(new Event("blur"));

    expect((client as any).harvestPointerAction.pressed).toBe(false);
    expect((client as any).eggPointerAction.pressed).toBe(false);
    expect((client as any).eggChargeState.active).toBe(false);
    expect((client as any).destroyQueued).toBe(false);
    expect((client as any).queuedDestroyTarget).toBe(null);

    client.dispose();
  });

  it("reports focus loss when the document is hidden during a pending capture", () => {
    const onPauseStateChange = vi.fn();
    const canvas = createCanvas();
    const client = GameClient.mount({
      canvas,
      initialDocument: createDefaultArenaMap(),
      initialMode: "explore",
      matchColorSeed: 5,
      onPauseStateChange
    });

    expect(client.requestPointerLock()).toBe(true);
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true
    });
    document.dispatchEvent(new Event("visibilitychange"));

    expect(onPauseStateChange).toHaveBeenLastCalledWith({
      paused: true,
      hasStarted: false,
      pointerCaptureFailureReason: "focus-lost",
      pointerCapturePending: false,
      pointerLocked: false
    });

    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false
    });
    client.dispose();
  });

  it("clears a previous capture failure after a later successful resume", () => {
    vi.useFakeTimers();
    const onPauseStateChange = vi.fn();
    const canvas = createCanvas();
    const client = GameClient.mount({
      canvas,
      initialDocument: createDefaultArenaMap(),
      initialMode: "explore",
      matchColorSeed: 5,
      onPauseStateChange
    });

    client.resumeRuntime();
    vi.advanceTimersByTime(1_000);
    expect(onPauseStateChange).toHaveBeenLastCalledWith({
      paused: true,
      hasStarted: false,
      pointerCaptureFailureReason: "timeout",
      pointerCapturePending: false,
      pointerLocked: false
    });

    client.resumeRuntime();
    setPointerLockElement(canvas);
    document.dispatchEvent(new Event("pointerlockchange"));

    expect(onPauseStateChange).toHaveBeenLastCalledWith({
      paused: false,
      hasStarted: true,
      pointerCaptureFailureReason: null,
      pointerCapturePending: false,
      pointerLocked: true
    });

    client.dispose();
  });

  it("treats unlocking after a successful capture as a normal pause without a failure reason", () => {
    const onPauseStateChange = vi.fn();
    const canvas = createCanvas();
    const client = GameClient.mount({
      canvas,
      initialDocument: createDefaultArenaMap(),
      initialMode: "explore",
      matchColorSeed: 5,
      onPauseStateChange
    });

    client.resumeRuntime();
    setPointerLockElement(canvas);
    document.dispatchEvent(new Event("pointerlockchange"));

    setPointerLockElement(null);
    document.dispatchEvent(new Event("pointerlockchange"));

    expect(onPauseStateChange).toHaveBeenLastCalledWith({
      paused: true,
      hasStarted: true,
      pointerCaptureFailureReason: null,
      pointerCapturePending: false,
      pointerLocked: false
    });

    client.dispose();
  });

  it("sends shell intents and resolves editor document requests from worker responses", async () => {
    const initialDocument = createDefaultArenaMap();
    const nextDocument = {
      ...initialDocument,
      meta: {
        ...initialDocument.meta,
        name: "Imported Arena"
      }
    };
    const canvas = createCanvas();
    const client = GameClient.mount({
      canvas,
      initialDocument,
      initialMode: "editor",
      matchColorSeed: 5
    });

    const worker = MockWorker.instances[0]!;
    const renderer = threeTestState.rendererInstances[0]!;
    worker.postMessage.mockClear();

    client.dispatchShellIntent({
      type: "set_editor_state",
      next: {
        mapName: "Workshop Copy",
        tool: "erase"
      }
    });
    client.dispatchShellIntent({
      type: "load_map",
      document: nextDocument
    });

    const documentPromise = client.requestEditorDocument();
    const requestMessage = worker.postMessage.mock.calls[2]?.[0] as {
      requestId: string;
      type: string;
    };

    expect(worker.postMessage).toHaveBeenNthCalledWith(1, {
      type: "set_editor_state",
      mapName: "Workshop Copy",
      tool: "erase"
    });
    expect(worker.postMessage).toHaveBeenNthCalledWith(2, {
      type: "load_map",
      document: nextDocument
    });
    expect(requestMessage.type).toBe("request_editor_document");
    expect(requestMessage.requestId).toMatch(/^editor-doc-/);

    worker.emit({
      type: "editor_document",
      requestId: requestMessage.requestId,
      document: nextDocument
    });

    await expect(documentPromise).resolves.toEqual(nextDocument);

    client.dispose();

    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(renderer.dispose).toHaveBeenCalledTimes(1);
    expect(cancelAnimationFrame).toHaveBeenCalledWith(101);
  });
});
