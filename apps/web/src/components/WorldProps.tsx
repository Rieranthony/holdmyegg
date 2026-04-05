import { useMemo } from "react";
import { type ThreeEvent } from "@react-three/fiber";
import {
  getMapPropVoxels,
  type MapProp,
  type MutableVoxelWorld
} from "@out-of-bounds/map";
import * as THREE from "three";
import { propMaterials } from "../game/propMaterials";
import { buildSurfaceDecorations } from "../game/surfaceDecorations";
import { resolveTerrainRaycastHit } from "../game/terrainRaycast";
import { sharedVoxelGeometry } from "../game/voxelMaterials";
import type { VoxelInteractPayload } from "./VoxelWorld";

interface WorldPropsLayerProps {
  world: MutableVoxelWorld;
  revision: number;
  editable?: boolean;
  onInteract?: (payload: VoxelInteractPayload) => void;
}

const nestTwigGeometry = new THREE.BoxGeometry(0.5, 0.12, 0.16);
const nestEggGeometry = new THREE.BoxGeometry(0.18, 0.22, 0.18);
const grassBladeGeometry = new THREE.BoxGeometry(0.08, 0.46, 0.18);
const flowerStemGeometry = new THREE.BoxGeometry(0.08, 0.4, 0.08);
const flowerPetalGeometry = new THREE.BoxGeometry(0.12, 0.12, 0.12);
const flowerCenterGeometry = new THREE.BoxGeometry(0.1, 0.1, 0.1);

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

export function WorldPropsLayer({ world, revision, editable = false, onInteract }: WorldPropsLayerProps) {
  const props = world.listProps();
  const decorations = useMemo(() => buildSurfaceDecorations(world), [world, revision]);

  return (
    <group>
      {props.map((prop) => (
        <MapPropMesh
          editable={editable}
          key={prop.id}
          onInteract={onInteract}
          prop={prop}
        />
      ))}
      <SpawnNests world={world} />
      <SurfaceDecorations decorations={decorations} />
    </group>
  );
}

function MapPropMesh({
  prop,
  editable,
  onInteract
}: {
  prop: MapProp;
  editable: boolean;
  onInteract?: (payload: VoxelInteractPayload) => void;
}) {
  const voxels = getMapPropVoxels(prop);

  return (
    <group>
      {voxels.map((voxel, index) => (
        <mesh
          castShadow
          geometry={sharedVoxelGeometry}
          key={`${prop.id}:${index}`}
          material={voxel.kind === "wood" ? propMaterials.bark : propMaterials.leaves}
          onPointerDown={(event) => handlePropInteract(event, editable, onInteract)}
          position={[voxel.x + 0.5, voxel.y + 0.5, voxel.z + 0.5]}
          receiveShadow
        />
      ))}
    </group>
  );
}

function SpawnNests({ world }: { world: MutableVoxelWorld }) {
  return (
    <group>
      {world.listSpawns().map((spawn) => {
        const nestY = spawn.y - 1.02;
        return (
          <group
            key={spawn.id}
            position={[spawn.x, nestY, spawn.z]}
          >
            {[
              { x: 0, z: 0.26, rotation: 0.12 },
              { x: 0.22, z: 0.18, rotation: 0.62 },
              { x: 0.26, z: -0.04, rotation: 1.24 },
              { x: 0.15, z: -0.24, rotation: 1.86 },
              { x: -0.12, z: -0.26, rotation: 2.58 },
              { x: -0.28, z: -0.08, rotation: 3.18 },
              { x: -0.2, z: 0.16, rotation: 3.92 },
              { x: -0.02, z: 0.28, rotation: 4.44 }
            ].map((twig, index) => (
              <mesh
                geometry={nestTwigGeometry}
                key={`${spawn.id}:twig:${index}`}
                material={propMaterials.nest}
                position={[twig.x, 0.08, twig.z]}
                rotation={[0, twig.rotation, 0]}
              />
            ))}
            <mesh
              geometry={nestEggGeometry}
              material={propMaterials.egg}
              position={[-0.08, 0.2, 0.02]}
              rotation={[0, 0.18, -0.12]}
            />
            <mesh
              geometry={nestEggGeometry}
              material={propMaterials.egg}
              position={[0.08, 0.18, -0.04]}
              rotation={[0.12, -0.3, 0.12]}
            />
          </group>
        );
      })}
    </group>
  );
}

function SurfaceDecorations({
  decorations
}: {
  decorations: ReturnType<typeof buildSurfaceDecorations>;
}) {
  return (
    <group>
      {decorations.map((decoration) => (
        <group
          key={decoration.id}
          position={[decoration.x, decoration.y, decoration.z]}
          rotation={[0, decoration.rotation, 0]}
          scale={decoration.scale}
        >
          {decoration.kind === "grass" ? (
            <GrassDecoration />
          ) : (
            <FlowerDecoration kind={decoration.kind} />
          )}
        </group>
      ))}
    </group>
  );
}

function GrassDecoration() {
  return (
    <group>
      <mesh
        geometry={grassBladeGeometry}
        material={propMaterials.grass}
        position={[0, 0.2, 0]}
      />
      <mesh
        geometry={grassBladeGeometry}
        material={propMaterials.grass}
        position={[0.07, 0.18, -0.03]}
        rotation={[0, 0.6, 0.22]}
      />
      <mesh
        geometry={grassBladeGeometry}
        material={propMaterials.grass}
        position={[-0.06, 0.17, 0.04]}
        rotation={[0, -0.48, -0.18]}
      />
    </group>
  );
}

function FlowerDecoration({
  kind
}: {
  kind: "flower-yellow" | "flower-pink" | "flower-white";
}) {
  const petalMaterial =
    kind === "flower-yellow"
      ? propMaterials.flowerYellow
      : kind === "flower-pink"
        ? propMaterials.flowerPink
        : propMaterials.flowerWhite;

  return (
    <group>
      <mesh
        geometry={flowerStemGeometry}
        material={propMaterials.stem}
        position={[0, 0.16, 0]}
      />
      <mesh
        geometry={flowerPetalGeometry}
        material={petalMaterial}
        position={[0.12, 0.38, 0]}
      />
      <mesh
        geometry={flowerPetalGeometry}
        material={petalMaterial}
        position={[-0.12, 0.38, 0]}
      />
      <mesh
        geometry={flowerPetalGeometry}
        material={petalMaterial}
        position={[0, 0.38, 0.12]}
      />
      <mesh
        geometry={flowerPetalGeometry}
        material={petalMaterial}
        position={[0, 0.38, -0.12]}
      />
      <mesh
        geometry={flowerCenterGeometry}
        material={propMaterials.egg}
        position={[0, 0.38, 0]}
      />
    </group>
  );
}
