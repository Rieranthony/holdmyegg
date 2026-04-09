import { useMemo } from "react";
import { type ThreeEvent } from "@react-three/fiber";
import {
  getMapPropVoxels,
  type MapProp,
  type MutableVoxelWorld
} from "@out-of-bounds/map";
import * as THREE from "three";
import { propMaterials } from "../game/propMaterials";
import {
  buildSurfaceDecorations,
  filterSurfaceDecorationsByDensity,
  type SurfaceDecoration
} from "../game/surfaceDecorations";
import { resolveTerrainRaycastHit } from "../game/terrainRaycast";
import { sharedVoxelGeometry } from "../game/voxelMaterials";
import type { VoxelInteractPayload } from "./VoxelWorld";
import { StaticInstancedMesh, type StaticInstanceTransform } from "./StaticInstancedMesh";

export type WorldPropsUpdateMode = "editor-live" | "runtime-static";

interface WorldPropsLayerProps {
  world: MutableVoxelWorld;
  revision: number;
  updateMode?: WorldPropsUpdateMode;
  editable?: boolean;
  decorationDensity?: number;
  onInteract?: (payload: VoxelInteractPayload) => void;
}

interface WorldPropsRenderState {
  instancedPropMatrices: ReturnType<typeof buildTreeMatrices>;
  nestMatrices: ReturnType<typeof buildNestMatrices>;
  decorationMatrices: ReturnType<typeof buildDecorationMatrices>;
}

const nestTwigGeometry = new THREE.BoxGeometry(0.5, 0.12, 0.16);
const nestEggGeometry = new THREE.BoxGeometry(0.18, 0.22, 0.18);
const grassCardGeometry = new THREE.PlaneGeometry(0.56, 0.82);
const flowerCardGeometry = new THREE.PlaneGeometry(0.72, 0.92);
const parentObject = new THREE.Object3D();
const childObject = new THREE.Object3D();

const nestTwigLocalTransforms = [
  { position: [0, 0.08, 0.26], rotation: [0, 0.12, 0] },
  { position: [0.22, 0.08, 0.18], rotation: [0, 0.62, 0] },
  { position: [0.26, 0.08, -0.04], rotation: [0, 1.24, 0] },
  { position: [0.15, 0.08, -0.24], rotation: [0, 1.86, 0] },
  { position: [-0.12, 0.08, -0.26], rotation: [0, 2.58, 0] },
  { position: [-0.28, 0.08, -0.08], rotation: [0, 3.18, 0] },
  { position: [-0.2, 0.08, 0.16], rotation: [0, 3.92, 0] },
  { position: [-0.02, 0.08, 0.28], rotation: [0, 4.44, 0] }
] as const satisfies readonly StaticInstanceTransform[];

const nestEggLocalTransforms = [
  { position: [-0.08, 0.2, 0.02], rotation: [0, 0.18, -0.12] },
  { position: [0.08, 0.18, -0.04], rotation: [0.12, -0.3, 0.12] }
] as const satisfies readonly StaticInstanceTransform[];

const grassLocalTransforms = [
  { position: [0, 0.38, 0] },
  { position: [0, 0.38, 0], rotation: [0, Math.PI / 2, 0] }
] as const satisfies readonly StaticInstanceTransform[];

const flowerCardLocalTransforms = [
  { position: [0, 0.44, 0] },
  { position: [0, 0.44, 0], rotation: [0, Math.PI / 2, 0] }
] as const satisfies readonly StaticInstanceTransform[];

const composeMatrices = (
  parentTransform: StaticInstanceTransform,
  localTransforms: readonly StaticInstanceTransform[]
) => {
  const parentRotation = parentTransform.rotation ?? [0, 0, 0];
  const parentScale = parentTransform.scale ?? 1;
  parentObject.position.set(
    parentTransform.position[0],
    parentTransform.position[1],
    parentTransform.position[2]
  );
  parentObject.rotation.set(parentRotation[0], parentRotation[1], parentRotation[2]);
  if (typeof parentScale === "number") {
    parentObject.scale.setScalar(parentScale);
  } else {
    parentObject.scale.set(parentScale[0], parentScale[1], parentScale[2]);
  }
  parentObject.updateMatrix();

  return localTransforms.map((transform) => {
    const rotation = transform.rotation ?? [0, 0, 0];
    const scale = transform.scale ?? 1;
    childObject.position.set(transform.position[0], transform.position[1], transform.position[2]);
    childObject.rotation.set(rotation[0], rotation[1], rotation[2]);
    if (typeof scale === "number") {
      childObject.scale.setScalar(scale);
    } else {
      childObject.scale.set(scale[0], scale[1], scale[2]);
    }
    childObject.updateMatrix();
    return new THREE.Matrix4().multiplyMatrices(parentObject.matrix, childObject.matrix);
  });
};

const handlePropInteract = (
  event: ThreeEvent<PointerEvent>,
  editable: boolean,
  onInteract?: (payload: VoxelInteractPayload) => void
) => {
  if (!editable || !onInteract) {
    return;
  }

  const terrainHit = resolveTerrainRaycastHit(event.point, event.face?.normal);
  if (!terrainHit) {
    return;
  }

  event.stopPropagation();
  onInteract({
    voxel: terrainHit.voxel,
    normal: terrainHit.normal
  });
};

const buildTreeMatrices = (props: MapProp[]) => {
  const barkMatrices: THREE.Matrix4[] = [];
  const leafMatrices: THREE.Matrix4[] = [];

  for (const prop of props) {
    for (const voxel of getMapPropVoxels(prop)) {
      const matrix = new THREE.Matrix4().compose(
        new THREE.Vector3(voxel.x + 0.5, voxel.y + 0.5, voxel.z + 0.5),
        new THREE.Quaternion(),
        new THREE.Vector3(1, 1, 1)
      );
      if (voxel.kind === "wood") {
        barkMatrices.push(matrix);
      } else {
        leafMatrices.push(matrix);
      }
    }
  }

  return {
    barkMatrices,
    leafMatrices
  };
};

const buildNestMatrices = (world: MutableVoxelWorld) => {
  const twigMatrices: THREE.Matrix4[] = [];
  const eggMatrices: THREE.Matrix4[] = [];

  for (const spawn of world.listSpawns()) {
    const parentTransform: StaticInstanceTransform = {
      position: [spawn.x, spawn.y - 1.02, spawn.z]
    };
    twigMatrices.push(...composeMatrices(parentTransform, nestTwigLocalTransforms));
    eggMatrices.push(...composeMatrices(parentTransform, nestEggLocalTransforms));
  }

  return {
    twigMatrices,
    eggMatrices
  };
};

const buildDecorationMatrices = (decorations: SurfaceDecoration[]) => {
  const grassMatrices: THREE.Matrix4[] = [];
  const flowerYellowMatrices: THREE.Matrix4[] = [];
  const flowerPinkMatrices: THREE.Matrix4[] = [];
  const flowerWhiteMatrices: THREE.Matrix4[] = [];
  const flowerBlueMatrices: THREE.Matrix4[] = [];

  for (const decoration of decorations) {
    const parentTransform: StaticInstanceTransform = {
      position: [decoration.x, decoration.y, decoration.z],
      rotation: [0, decoration.rotation, 0],
      scale: decoration.scale
    };

    if (decoration.kind === "grass") {
      grassMatrices.push(...composeMatrices(parentTransform, grassLocalTransforms));
      continue;
    }

    const flowerMatrices = composeMatrices(parentTransform, flowerCardLocalTransforms);
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

export const createWorldPropsRenderState = (
  world: MutableVoxelWorld,
  decorationDensity: number
): WorldPropsRenderState => {
  const props = world.listProps();
  const decorations = filterSurfaceDecorationsByDensity(
    buildSurfaceDecorations(world),
    decorationDensity
  );

  return {
    instancedPropMatrices: buildTreeMatrices(props),
    nestMatrices: buildNestMatrices(world),
    decorationMatrices: buildDecorationMatrices(decorations)
  };
};

export function WorldPropsLayer({
  world,
  revision,
  updateMode = "editor-live",
  editable = false,
  decorationDensity = 1,
  onInteract
}: WorldPropsLayerProps) {
  if (updateMode === "runtime-static") {
    return (
      <RuntimeStaticWorldPropsLayer
        decorationDensity={decorationDensity}
        editable={editable}
        onInteract={onInteract}
        revision={revision}
        world={world}
      />
    );
  }

  return (
    <EditorLiveWorldPropsLayer
      decorationDensity={decorationDensity}
      editable={editable}
      onInteract={onInteract}
      revision={revision}
      world={world}
    />
  );
}

function RuntimeStaticWorldPropsLayer({
  world,
  revision,
  editable,
  decorationDensity,
  onInteract
}: WorldPropsLayerProps) {
  const runtimeStaticRenderState = useMemo(
    () => createWorldPropsRenderState(world, decorationDensity),
    [decorationDensity, world]
  );

  return (
    <WorldPropsMeshes
      editable={editable}
      onInteract={onInteract}
      renderState={runtimeStaticRenderState}
    />
  );
}

function EditorLiveWorldPropsLayer({
  world,
  revision,
  editable,
  decorationDensity,
  onInteract
}: WorldPropsLayerProps) {
  const renderState = useMemo(
    () => createWorldPropsRenderState(world, decorationDensity),
    [decorationDensity, revision, world]
  );
 
  return (
    <WorldPropsMeshes
      editable={editable}
      onInteract={onInteract}
      renderState={renderState}
    />
  );
}

function WorldPropsMeshes({
  editable,
  onInteract,
  renderState
}: {
  editable: boolean;
  onInteract?: (payload: VoxelInteractPayload) => void;
  renderState: WorldPropsRenderState;
}) {
  const handleInstancedPropInteract = useMemo(
    () =>
      editable && onInteract
        ? (event: ThreeEvent<PointerEvent>) => handlePropInteract(event, editable, onInteract)
        : undefined,
    [editable, onInteract]
  );

  return (
    <group>
      <StaticInstancedMesh
        castShadow
        geometry={sharedVoxelGeometry}
        material={propMaterials.bark}
        matrices={renderState.instancedPropMatrices.barkMatrices}
        onPointerDown={handleInstancedPropInteract}
        receiveShadow
      />
      <StaticInstancedMesh
        castShadow
        geometry={sharedVoxelGeometry}
        material={propMaterials.leaves}
        matrices={renderState.instancedPropMatrices.leafMatrices}
        onPointerDown={handleInstancedPropInteract}
        receiveShadow
      />
      <StaticInstancedMesh
        geometry={nestTwigGeometry}
        material={propMaterials.nest}
        matrices={renderState.nestMatrices.twigMatrices}
      />
      <StaticInstancedMesh
        geometry={nestEggGeometry}
        material={propMaterials.egg}
        matrices={renderState.nestMatrices.eggMatrices}
      />
      <StaticInstancedMesh
        geometry={grassCardGeometry}
        material={propMaterials.grass}
        matrices={renderState.decorationMatrices.grassMatrices}
      />
      <StaticInstancedMesh
        geometry={flowerCardGeometry}
        material={propMaterials.flowerYellow}
        matrices={renderState.decorationMatrices.flowerYellowMatrices}
      />
      <StaticInstancedMesh
        geometry={flowerCardGeometry}
        material={propMaterials.flowerPink}
        matrices={renderState.decorationMatrices.flowerPinkMatrices}
      />
      <StaticInstancedMesh
        geometry={flowerCardGeometry}
        material={propMaterials.flowerWhite}
        matrices={renderState.decorationMatrices.flowerWhiteMatrices}
      />
      <StaticInstancedMesh
        geometry={flowerCardGeometry}
        material={propMaterials.flowerBlue}
        matrices={renderState.decorationMatrices.flowerBlueMatrices}
      />
    </group>
  );
}
