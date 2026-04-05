import * as THREE from "three";

export const configureDynamicInstancedMesh = (mesh: THREE.InstancedMesh | null) => {
  if (!mesh) {
    return;
  }

  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
};

export const finalizeDynamicInstancedMesh = (mesh: THREE.InstancedMesh | null, count: number) => {
  if (!mesh) {
    return;
  }

  mesh.count = count;
  mesh.visible = count > 0;
  mesh.instanceMatrix.needsUpdate = true;
  if (count <= 0) {
    return;
  }

  mesh.computeBoundingSphere();
  mesh.computeBoundingBox();
  mesh.updateMatrixWorld(true);
};

export const finalizeStaticInstancedMesh = (mesh: THREE.InstancedMesh | null, count = mesh?.count ?? 0) => {
  if (!mesh) {
    return;
  }

  mesh.count = count;
  mesh.visible = count > 0;
  mesh.instanceMatrix.needsUpdate = true;
  if (count <= 0) {
    return;
  }

  mesh.computeBoundingSphere();
  mesh.computeBoundingBox();
  mesh.updateMatrixWorld(true);
};
