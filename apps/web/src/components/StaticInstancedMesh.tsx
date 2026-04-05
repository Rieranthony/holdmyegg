import { useLayoutEffect, useRef } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";

export interface StaticInstanceTransform {
  position: readonly [number, number, number];
  rotation?: readonly [number, number, number];
  scale?: number | readonly [number, number, number];
}

const tempObject = new THREE.Object3D();

export function StaticInstancedMesh({
  transforms,
  matrices,
  geometry,
  material,
  castShadow = false,
  receiveShadow = false,
  onPointerDown
}: {
  transforms?: readonly StaticInstanceTransform[];
  matrices?: readonly THREE.Matrix4[];
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  castShadow?: boolean;
  receiveShadow?: boolean;
  onPointerDown?: (event: ThreeEvent<PointerEvent>) => void;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) {
      return;
    }

    const matrixEntries = matrices ?? null;
    const transformEntries = transforms ?? null;
    const entryCount = matrixEntries?.length ?? transformEntries?.length ?? 0;
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    mesh.count = entryCount;

    for (let index = 0; index < entryCount; index += 1) {
      if (matrixEntries) {
        mesh.setMatrixAt(index, matrixEntries[index]!);
        continue;
      }

      const transform = transformEntries?.[index];
      if (!transform) {
        continue;
      }

      const rotation = transform.rotation ?? [0, 0, 0];
      const scale = transform.scale ?? 1;
      tempObject.position.set(transform.position[0], transform.position[1], transform.position[2]);
      tempObject.rotation.set(rotation[0], rotation[1], rotation[2]);
      if (typeof scale === "number") {
        tempObject.scale.setScalar(scale);
      } else {
        tempObject.scale.set(scale[0], scale[1], scale[2]);
      }
      tempObject.updateMatrix();
      mesh.setMatrixAt(index, tempObject.matrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.computeBoundingBox();
    mesh.updateMatrixWorld(true);
  }, [matrices, transforms]);

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, Math.max(1, matrices?.length ?? transforms?.length ?? 0)]}
      castShadow={castShadow}
      matrixAutoUpdate={false}
      onPointerDown={onPointerDown}
      receiveShadow={receiveShadow}
    />
  );
}
