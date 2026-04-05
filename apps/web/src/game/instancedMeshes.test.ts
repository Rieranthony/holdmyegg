import { afterEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  configureDynamicInstancedMesh,
  finalizeDynamicInstancedMesh,
  finalizeStaticInstancedMesh
} from "./instancedMeshes";

const tempMatrix = new THREE.Matrix4();

const createMesh = (count = 4) => new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), count);

afterEach(() => {
  tempMatrix.identity();
});

describe("instanced mesh bounds helpers", () => {
  it("updates dynamic bounds for a high sky-drop-style instance", () => {
    const mesh = createMesh();
    configureDynamicInstancedMesh(mesh);
    mesh.setMatrixAt(0, tempMatrix.makeTranslation(20.5, 18.5, 12.5));

    finalizeDynamicInstancedMesh(mesh, 1);

    expect(mesh.instanceMatrix.usage).toBe(THREE.DynamicDrawUsage);
    expect(mesh.visible).toBe(true);
    expect(mesh.count).toBe(1);
    expect(mesh.boundingBox).not.toBeNull();
    expect(mesh.boundingSphere).not.toBeNull();
    expect(mesh.boundingBox?.min.y).toBeCloseTo(18, 5);
    expect(mesh.boundingBox?.max.y).toBeCloseTo(19, 5);
    expect(mesh.boundingSphere?.center.y).toBeCloseTo(18.5, 5);

    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  });

  it("hides dynamic meshes when there are no live instances", () => {
    const mesh = createMesh();
    configureDynamicInstancedMesh(mesh);

    finalizeDynamicInstancedMesh(mesh, 0);

    expect(mesh.visible).toBe(false);
    expect(mesh.count).toBe(0);
    expect(mesh.instanceMatrix.usage).toBe(THREE.DynamicDrawUsage);

    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  });

  it("computes static bounds for falling-cluster-style authored matrices", () => {
    const mesh = createMesh(2);
    mesh.setMatrixAt(0, tempMatrix.makeTranslation(10.5, 4.5, 10.5));
    mesh.setMatrixAt(1, tempMatrix.makeTranslation(11.5, 4.5, 10.5));

    finalizeStaticInstancedMesh(mesh, 2);

    expect(mesh.visible).toBe(true);
    expect(mesh.count).toBe(2);
    expect(mesh.boundingBox).not.toBeNull();
    expect(mesh.boundingSphere).not.toBeNull();
    expect(mesh.boundingBox?.min.x).toBeCloseTo(10, 5);
    expect(mesh.boundingBox?.max.x).toBeCloseTo(12, 5);
    expect(mesh.boundingSphere?.center.x).toBeCloseTo(11, 5);

    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  });
});
