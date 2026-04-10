import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { chickenPoseVisualDefaults } from "../game/playerVisuals";
import { WorkerGameRuntime } from "./worker";

const createScope = () =>
  ({
    postMessage: vi.fn()
  }) as unknown as DedicatedWorkerGlobalScope;

describe("WorkerGameRuntime", () => {
  it("emits multiplayer runtime input packets on the fixed send cadence", () => {
    const scope = createScope();
    const runtime = new WorkerGameRuntime(scope);
    const runtimeState = runtime as unknown as {
      mode: "editor" | "explore" | "playNpc" | "multiplayer";
      sampleRuntimeInput: (elapsed: number) => unknown;
    };

    runtimeState.mode = "multiplayer";
    runtimeState.sampleRuntimeInput(0.06);

    expect(scope.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "runtime_input_packet",
        buffer: expect.any(ArrayBuffer)
      }),
      expect.any(Array)
    );
  });

  it("emits multiplayer runtime input packets immediately on action edges", () => {
    const scope = createScope();
    const runtime = new WorkerGameRuntime(scope);
    const runtimeState = runtime as unknown as {
      keyboardState: {
        jumpPressed: boolean;
      };
      lastMultiplayerInputSentAt: number;
      mode: "editor" | "explore" | "playNpc" | "multiplayer";
      sampleRuntimeInput: (elapsed: number) => unknown;
    };

    runtimeState.mode = "multiplayer";
    runtimeState.lastMultiplayerInputSentAt = 10;
    runtimeState.keyboardState.jumpPressed = true;
    runtimeState.sampleRuntimeInput(10.01);

    expect(scope.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "runtime_input_packet",
        buffer: expect.any(ArrayBuffer)
      }),
      expect.any(Array)
    );
  });

  it("keeps destroy and place active while their controls stay held", () => {
    const runtime = new WorkerGameRuntime(createScope());
    const runtimeState = runtime as unknown as {
      focusedTarget: {
        voxel: { x: number; y: number; z: number };
        normal: { x: number; y: number; z: number };
      } | null;
      mode: "editor" | "explore" | "playNpc" | "multiplayer";
      handleKeyEvent: (message: {
        type: "key_event";
        code: string;
        key: string;
        eventType: "down" | "up";
        repeat: boolean;
        metaKey: boolean;
        ctrlKey: boolean;
        shiftKey: boolean;
        timeMs: number;
      }) => void;
      handlePointerButton: (message: {
        type: "pointer_button";
        button: number;
        clientX: number;
        clientY: number;
        eventType: "down" | "up" | "cancel";
      }) => void;
      sampleRuntimeInput: (elapsed: number) => { destroy: boolean; place: boolean };
    };

    runtimeState.mode = "explore";
    runtimeState.focusedTarget = {
      voxel: { x: 6, y: 2, z: 4 },
      normal: { x: 0, y: 1, z: 0 }
    };
    runtimeState.handlePointerButton({
      type: "pointer_button",
      button: 0,
      clientX: 0,
      clientY: 0,
      eventType: "down"
    });
    runtimeState.handleKeyEvent({
      type: "key_event",
      code: "KeyF",
      key: "f",
      eventType: "down",
      repeat: false,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      timeMs: 0
    });

    expect(runtimeState.sampleRuntimeInput(0).destroy).toBe(true);
    expect(runtimeState.sampleRuntimeInput(0.01).destroy).toBe(true);
    expect(runtimeState.sampleRuntimeInput(0.02).place).toBe(true);
    expect(runtimeState.sampleRuntimeInput(0.03).place).toBe(true);

    runtimeState.handlePointerButton({
      type: "pointer_button",
      button: 0,
      clientX: 0,
      clientY: 0,
      eventType: "up"
    });
    runtimeState.handleKeyEvent({
      type: "key_event",
      code: "KeyF",
      key: "f",
      eventType: "up",
      repeat: false,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      timeMs: 10
    });

    const released = runtimeState.sampleRuntimeInput(0.04);
    expect(released.destroy).toBe(false);
    expect(released.place).toBe(false);
  });

  it("reuses world-sized scene objects across steady-state frames", () => {
    const runtime = new WorkerGameRuntime(createScope());
    const runtimeState = runtime as unknown as {
      groundPlane: { geometry: object };
      scene: { fog: object };
      updateShellCamera: (elapsed: number) => void;
    };

    const initialFog = runtimeState.scene.fog;
    const initialGroundGeometry = runtimeState.groundPlane.geometry;

    runtimeState.updateShellCamera(0);
    const resizedGroundGeometry = runtimeState.groundPlane.geometry;
    runtimeState.updateShellCamera(1);

    expect(runtimeState.scene.fog).toBe(initialFog);
    expect(resizedGroundGeometry).not.toBe(initialGroundGeometry);
    expect(runtimeState.groundPlane.geometry).toBe(resizedGroundGeometry);
  });

  it("builds FPS diagnostics from the rolling sample window", () => {
    const runtime = new WorkerGameRuntime(createScope());
    const runtimeState = runtime as unknown as {
      buildRenderDiagnostics: () => { fps: number; p95FrameMs: number };
      frameSampleCount: number;
      frameSamples: Float32Array;
      renderer: {
        info: {
          memory: {
            geometries: number;
            textures: number;
          };
          render: {
            calls: number;
            triangles: number;
          };
        };
      };
    };

    runtimeState.renderer = {
      info: {
        render: {
          calls: 8,
          triangles: 256
        },
        memory: {
          geometries: 10,
          textures: 4
        }
      }
    };
    runtimeState.frameSamples[0] = 10;
    runtimeState.frameSamples[1] = 20;
    runtimeState.frameSamples[2] = 30;
    runtimeState.frameSampleCount = 3;

    const diagnostics = runtimeState.buildRenderDiagnostics();

    expect(diagnostics.fps).toBeCloseTo(50, 4);
    expect(diagnostics.p95FrameMs).toBe(20);
  });

  it("rebuilds cloud and bird layers from the active quality profile", () => {
    const runtime = new WorkerGameRuntime(createScope());
    const runtimeState = runtime as unknown as {
      cloudVisuals: unknown[];
      currentDocument: {
        size: { x: number; y: number; z: number };
      };
      qualityTier: "high" | "medium" | "low";
      rebuildSkyLayers: (document: {
        size: { x: number; y: number; z: number };
      }) => void;
      skyBirdVisuals: unknown[];
    };

    runtimeState.qualityTier = "high";
    runtimeState.rebuildSkyLayers(runtimeState.currentDocument);
    expect(runtimeState.cloudVisuals.length).toBe(8);
    expect(runtimeState.skyBirdVisuals.length).toBe(3);

    runtimeState.qualityTier = "medium";
    runtimeState.rebuildSkyLayers(runtimeState.currentDocument);
    expect(runtimeState.cloudVisuals.length).toBe(5);
    expect(runtimeState.skyBirdVisuals.length).toBe(2);

    runtimeState.qualityTier = "low";
    runtimeState.rebuildSkyLayers(runtimeState.currentDocument);
    expect(runtimeState.cloudVisuals.length).toBe(0);
    expect(runtimeState.skyBirdVisuals.length).toBe(1);
  });

  it("fades from day sky into the space backdrop around the camera", () => {
    const runtime = new WorkerGameRuntime(createScope());
    const runtimeState = runtime as unknown as {
      camera: {
        position: {
          set: (x: number, y: number, z: number) => void;
          toArray: () => number[];
        };
      };
      cloudMainMaterial: {
        opacity: number;
      };
      currentDocument: {
        size: { x: number; y: number; z: number };
      };
      rebuildSkyLayers: (document: {
        size: { x: number; y: number; z: number };
      }) => void;
      sceneBackgroundColor: {
        getHexString: () => string;
      };
      spaceBackdropGroup: {
        position: {
          toArray: () => number[];
        };
        visible: boolean;
      };
      spacePlanetVisuals: Array<{
        materials: Array<{ opacity: number }>;
      }>;
      spaceStarMaterial: {
        opacity: number;
      };
      updateSkyEnvironment: (
        localPlayer: { spacePhase: string } | null,
        delta: number,
        elapsed: number
      ) => void;
    };

    runtimeState.rebuildSkyLayers(runtimeState.currentDocument);
    runtimeState.camera.position.set(4, 5, 6);
    runtimeState.updateSkyEnvironment({ spacePhase: "float" }, 0.25, 3);

    expect(runtimeState.spaceBackdropGroup.visible).toBe(true);
    expect(runtimeState.spaceBackdropGroup.position.toArray()).toEqual([4, 5, 6]);
    expect(runtimeState.spaceStarMaterial.opacity).toBeGreaterThan(0);
    expect(runtimeState.cloudMainMaterial.opacity).toBeLessThan(1);
    expect(runtimeState.sceneBackgroundColor.getHexString()).not.toBe("8fc6e0");
    expect(
      runtimeState.spacePlanetVisuals.some((visual) =>
        visual.materials.some((material) => material.opacity > 0)
      )
    ).toBe(true);
  });

  it("renders sky-drop warnings with textured voxel cubes instead of placeholder meshes", () => {
    const runtime = new WorkerGameRuntime(createScope());
    const runtimeState = runtime as unknown as {
      skyDropVisuals: Map<
        string,
        {
          beam: { visible: boolean };
          cube: { visible: boolean };
          ring: { visible: boolean };
        }
      >;
      syncSkyDrops: (
        skyDrops: Array<{
          id: string;
          landingVoxel: { x: number; y: number; z: number };
          offsetY: number;
          phase: "warning" | "falling";
          warningRemaining: number;
        }>,
        elapsed: number
      ) => void;
    };

    runtimeState.syncSkyDrops(
      [
        {
          id: "drop-warning",
          landingVoxel: { x: 2, y: 4, z: 3 },
          offsetY: 5,
          phase: "warning",
          warningRemaining: 0.8
        }
      ],
      1.2
    );

    const visual = runtimeState.skyDropVisuals.get("drop-warning");
    expect(visual).toBeDefined();
    expect(visual?.ring.visible).toBe(true);
    expect(visual?.beam.visible).toBe(true);
    expect(visual?.cube.visible).toBe(false);
  });

  it("rebuilds falling clusters as textured instanced voxel groups", () => {
    const runtime = new WorkerGameRuntime(createScope());
    const runtimeState = runtime as unknown as {
      clusterVisuals: Map<
        string,
        {
          group: { children: THREE.Object3D[] };
          materials: THREE.MeshStandardMaterial[];
        }
      >;
      syncClusters: (
        clusters: Array<{
          center: { x: number; y: number; z: number };
          id: string;
          offsetY: number;
          phase: "warning" | "falling";
          voxels: Array<{ kind: "ground" | "hazard"; x: number; y: number; z: number }>;
          warningRemaining: number;
        }>,
        elapsed: number
      ) => void;
    };

    runtimeState.syncClusters(
      [
        {
          id: "cluster-1",
          phase: "warning",
          warningRemaining: 0.4,
          offsetY: 0,
          center: { x: 4, y: 6, z: 4 },
          voxels: [
            { kind: "ground", x: 3, y: 8, z: 3 },
            { kind: "hazard", x: 4, y: 2, z: 4 }
          ]
        }
      ],
      0.6
    );

    const visual = runtimeState.clusterVisuals.get("cluster-1");
    expect(visual).toBeDefined();
    expect(visual?.group.children.length).toBeGreaterThan(0);
    expect(visual?.group.children.some((child) => child instanceof THREE.InstancedMesh)).toBe(true);
    expect(visual?.materials.length).toBeGreaterThan(0);
  });

  it("restores local egg charge, preview, and follow-through inside the worker", () => {
    const runtime = new WorkerGameRuntime(createScope());
    const runtimeState = runtime as unknown as {
      eggChargeState: {
        active: boolean;
        chargeAlpha: number;
        pendingThrow: boolean;
        releaseRemaining: number;
      };
      eggPointerAction: {
        holdTriggered: boolean;
        pressed: boolean;
      };
      eggTrajectoryPreview: {
        group: { visible: boolean };
      };
      latestRuntimeFrame: {
        eggs: [];
        localPlayerId: string;
        players: Array<{
          alive: boolean;
          eggTauntRemaining: number;
          eggTauntSequence: number;
          eliminatedAt: null;
          fallingOut: boolean;
          facing: { x: number; z: number };
          grounded: boolean;
          id: string;
          invulnerableRemaining: number;
          jetpackActive: boolean;
          livesRemaining: number;
          mass: number;
          maxLives: number;
          name: string;
          position: { x: number; y: number; z: number };
          pushVisualRemaining: number;
          respawning: boolean;
          spacePhase: "none";
          spacePhaseRemaining: number;
          stunRemaining: number;
          velocity: { x: number; y: number; z: number };
        }>;
      };
      mode: "editor" | "explore" | "playNpc" | "multiplayer";
      pointerLocked: boolean;
      releaseEggAction: (
        action: { holdTriggered: boolean; pressed: boolean },
        source: "pointer"
      ) => void;
      runtimePaused: boolean;
      startEggPointerAction: () => void;
      updateEggChargeState: (
        localPlayer: {
          alive: boolean;
          eggTauntRemaining: number;
          eggTauntSequence: number;
          eliminatedAt: null;
          fallingOut: boolean;
          facing: { x: number; z: number };
          grounded: boolean;
          id: string;
          invulnerableRemaining: number;
          jetpackActive: boolean;
          livesRemaining: number;
          mass: number;
          maxLives: number;
          name: string;
          position: { x: number; y: number; z: number };
          pushVisualRemaining: number;
          respawning: boolean;
          spacePhase: "none";
          spacePhaseRemaining: number;
          stunRemaining: number;
          velocity: { x: number; y: number; z: number };
        },
        delta: number,
        elapsed: number
      ) => void;
      updateEggLaunchPreview: (
        localPlayer: {
          alive: boolean;
          eggTauntRemaining: number;
          eggTauntSequence: number;
          eliminatedAt: null;
          fallingOut: boolean;
          facing: { x: number; z: number };
          grounded: boolean;
          id: string;
          invulnerableRemaining: number;
          jetpackActive: boolean;
          livesRemaining: number;
          mass: number;
          maxLives: number;
          name: string;
          position: { x: number; y: number; z: number };
          pushVisualRemaining: number;
          respawning: boolean;
          spacePhase: "none";
          spacePhaseRemaining: number;
          stunRemaining: number;
          velocity: { x: number; y: number; z: number };
        },
        elapsed: number
      ) => void;
      updateHoldToThrowState: (
        localPlayer: {
          alive: boolean;
          eggTauntRemaining: number;
          eggTauntSequence: number;
          eliminatedAt: null;
          fallingOut: boolean;
          facing: { x: number; z: number };
          grounded: boolean;
          id: string;
          invulnerableRemaining: number;
          jetpackActive: boolean;
          livesRemaining: number;
          mass: number;
          maxLives: number;
          name: string;
          position: { x: number; y: number; z: number };
          pushVisualRemaining: number;
          respawning: boolean;
          spacePhase: "none";
          spacePhaseRemaining: number;
          stunRemaining: number;
          velocity: { x: number; y: number; z: number };
        },
        elapsed: number
      ) => void;
    };

    const localPlayer = {
      id: "local-player",
      name: "You",
      alive: true,
      fallingOut: false,
      grounded: true,
      mass: 60,
      livesRemaining: 3,
      maxLives: 3,
      respawning: false,
      invulnerableRemaining: 0,
      stunRemaining: 0,
      pushVisualRemaining: 0,
      spacePhase: "none" as const,
      spacePhaseRemaining: 0,
      position: { x: 6, y: 4, z: 6 },
      velocity: { x: 0, y: 0, z: 0 },
      facing: { x: 1, z: 0 },
      eggTauntSequence: 0,
      eggTauntRemaining: 0,
      jetpackActive: false,
      eliminatedAt: null
    };

    runtimeState.mode = "explore";
    runtimeState.pointerLocked = true;
    runtimeState.runtimePaused = false;
    runtimeState.latestRuntimeFrame = {
      localPlayerId: localPlayer.id,
      players: [localPlayer],
      eggs: []
    };

    runtimeState.startEggPointerAction();
    runtimeState.updateHoldToThrowState(localPlayer, 0.17);
    runtimeState.updateEggChargeState(localPlayer, 0.05, 0.32);
    runtimeState.updateEggLaunchPreview(localPlayer, 0.32);

    expect(runtimeState.eggPointerAction.holdTriggered).toBe(true);
    expect(runtimeState.eggChargeState.active).toBe(true);
    expect(runtimeState.eggChargeState.chargeAlpha).toBeGreaterThan(0);
    expect(runtimeState.eggTrajectoryPreview.group.visible).toBe(true);

    runtimeState.releaseEggAction(runtimeState.eggPointerAction, "pointer");

    expect(runtimeState.eggChargeState.pendingThrow).toBe(true);
    expect(runtimeState.eggChargeState.releaseRemaining).toBeGreaterThan(0);
  });

  it("passes local egg charge and release state into the chicken throw pose", () => {
    const runtime = new WorkerGameRuntime(createScope());
    const runtimeState = runtime as unknown as {
      eggChargeState: {
        chargeAlpha: number;
        releaseRemaining: number;
      };
      playerVisuals: Map<
        string,
        {
          bomb: { visible: boolean; position: { x: number } };
          leftWing: { rotation: { z: number } };
          rightWing: { rotation: { z: number } };
        }
      >;
      syncPlayers: (
        players: Array<{
          alive: boolean;
          eggTauntRemaining: number;
          eggTauntSequence: number;
          eliminatedAt: null;
          fallingOut: boolean;
          facing: { x: number; z: number };
          grounded: boolean;
          id: string;
          invulnerableRemaining: number;
          jetpackActive: boolean;
          livesRemaining: number;
          mass: number;
          maxLives: number;
          name: string;
          position: { x: number; y: number; z: number };
          pushVisualRemaining: number;
          respawning: boolean;
          spacePhase: "none";
          spacePhaseRemaining: number;
          stunRemaining: number;
          velocity: { x: number; y: number; z: number };
        }>,
        localPlayerId: string | null,
        delta: number,
        elapsed: number
      ) => void;
    };

    const localPlayer = {
      id: "local-player",
      name: "You",
      alive: true,
      fallingOut: false,
      grounded: true,
      mass: 20,
      livesRemaining: 3,
      maxLives: 3,
      respawning: false,
      invulnerableRemaining: 0,
      stunRemaining: 0,
      pushVisualRemaining: 0,
      spacePhase: "none" as const,
      spacePhaseRemaining: 0,
      position: { x: 6, y: 4, z: 6 },
      velocity: { x: 1.2, y: 0, z: 0.2 },
      facing: { x: 1, z: 0 },
      eggTauntSequence: 0,
      eggTauntRemaining: 0,
      jetpackActive: false,
      eliminatedAt: null
    };

    runtimeState.eggChargeState.chargeAlpha = 0.8;
    runtimeState.eggChargeState.releaseRemaining =
      chickenPoseVisualDefaults.eggLaunchReleaseDuration * 0.5;
    runtimeState.syncPlayers([localPlayer], localPlayer.id, 0.016, 1.5);

    const visual = runtimeState.playerVisuals.get(localPlayer.id);
    expect(visual?.bomb.visible).toBe(true);
    expect(Math.abs(visual?.rightWing.rotation.z ?? 0)).toBeGreaterThan(
      visual?.leftWing.rotation.z ?? 0
    );
    expect(visual?.bomb.position.x ?? 0).toBeGreaterThan(0);
  });

  it("fills textured terrain and accent voxel burst resources for egg explosions", () => {
    const runtime = new WorkerGameRuntime(createScope());
    const runtimeState = runtime as unknown as {
      eggExplosionAccentBurstMesh: { mesh: { count: number } } | null;
      eggExplosionBurstMeshes: Map<
        string,
        {
          mesh: { count: number };
        }
      >;
      syncVoxelBursts: (
        voxelBursts: Array<{
          duration: number;
          elapsed: number;
          id: string;
          kind: null;
          position: { x: number; y: number; z: number };
          style: "eggExplosion";
        }>
      ) => void;
    };

    runtimeState.syncVoxelBursts([
      {
        id: "surface-burst",
        style: "eggExplosion",
        kind: null,
        position: { x: 8, y: 2, z: 8 },
        elapsed: 0.21,
        duration: 0.42
      }
    ]);

    expect(
      [...runtimeState.eggExplosionBurstMeshes.values()].some((resource) => resource.mesh.count > 0)
    ).toBe(true);
    expect(runtimeState.eggExplosionAccentBurstMesh?.mesh.count ?? 0).toBeGreaterThan(0);
  });
});
