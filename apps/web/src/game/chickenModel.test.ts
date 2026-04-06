import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { getChickenPaletteByName } from "./colors";
import { createChickenAvatarRig } from "./chickenModel";
import { headFeatherOffsets, wingFeatherletOffsets } from "./playerVisuals";
import {
  chickenPartGeometries,
  createChickenMaterialBundle,
  disposeChickenMaterialBundle
} from "./sceneAssets";

describe("createChickenAvatarRig", () => {
  it("builds mirrored wings, a three-feather crest, horizontal wing featherlets, and a tail", () => {
    const materialBundle = createChickenMaterialBundle(getChickenPaletteByName("gold"));

    try {
      const rig = createChickenAvatarRig(materialBundle);
      const headGroup = rig.headPivot.children[0];
      const beakGeometries = new Set<THREE.BufferGeometry>([
        chickenPartGeometries.beakBase,
        chickenPartGeometries.beakMid,
        chickenPartGeometries.beakTip,
        chickenPartGeometries.beakCap
      ]);

      expect(rig.leftWingMesh.children).toHaveLength(6);
      expect(rig.rightWingMesh.children).toHaveLength(6);
      expect(rig.leftWing.position.x).toBeCloseTo(-rig.rightWing.position.x, 5);
      expect(rig.leftWingMesh.position.x).toBeCloseTo(-rig.rightWingMesh.position.x, 5);
      expect(rig.leftWingMesh.children[1]?.position.x).toBeCloseTo(
        -(rig.rightWingMesh.children[1] as THREE.Object3D).position.x,
        5
      );
      expect(rig.leftWingMesh.children[2]?.rotation.z).toBeCloseTo(
        -((rig.rightWingMesh.children[2] as THREE.Object3D).rotation.z),
        5
      );

      expect(headGroup).toBeInstanceOf(THREE.Group);
      expect(
        (headGroup as THREE.Group).children.filter(
          (child): child is THREE.Mesh => child instanceof THREE.Mesh && beakGeometries.has(child.geometry)
        )
      ).toHaveLength(4);

      expect(rig.headFeathers).toHaveLength(3);
      expect(rig.lowDetailHeadFeathers).toHaveLength(3);
      expect(rig.headFeathers.every((feather) => feather.parent === headGroup)).toBe(true);
      expect(
        rig.headFeathers.map((feather) => [
          feather.position.x,
          feather.position.y,
          feather.position.z,
          feather.rotation.x,
          feather.rotation.y,
          feather.rotation.z
        ])
      ).toEqual(
        headFeatherOffsets.map((feather) => [
          feather.x,
          feather.y,
          feather.z,
          feather.rotationX,
          feather.rotationY,
          feather.rotationZ
        ])
      );

      expect(rig.leftWingFeatherlets).toHaveLength(3);
      expect(rig.rightWingFeatherlets).toHaveLength(3);
      expect(rig.leftWingFeatherlets.every((feather) => feather.parent === rig.leftWingMesh)).toBe(true);
      expect(rig.rightWingFeatherlets.every((feather) => feather.parent === rig.rightWingMesh)).toBe(true);
      expect(
        rig.leftWingFeatherlets.map((feather) => [
          feather.position.x,
          feather.position.y,
          feather.position.z,
          feather.rotation.x,
          feather.rotation.y,
          feather.rotation.z
        ])
      ).toEqual(
        wingFeatherletOffsets.map((feather) => [
          feather.x,
          feather.y,
          feather.z,
          feather.rotationX,
          feather.rotationY,
          feather.rotationZ
        ])
      );
      expect(
        rig.rightWingFeatherlets.map((feather) => [
          feather.position.x,
          feather.position.y,
          feather.position.z,
          feather.rotation.x,
          feather.rotation.y,
          feather.rotation.z
        ])
      ).toEqual(
        wingFeatherletOffsets.map((feather) => [
          -feather.x,
          feather.y,
          feather.z,
          feather.rotationX,
          -feather.rotationY,
          -feather.rotationZ
        ])
      );
      expect(Math.abs(rig.leftWingFeatherlets[0]!.rotation.z)).toBeGreaterThan(
        Math.abs(rig.leftWingFeatherlets[0]!.rotation.x)
      );
      expect(rig.tailFeathers).toHaveLength(3);
      expect(rig.tail.parent).toBe(rig.highDetail);
      expect(rig.tail.position.z).toBeLessThan(0);
      expect(rig.lowDetailTail.parent).toBe(rig.lowDetail);
      expect(rig.lowDetailTail.position.z).toBeLessThan(0);
    } finally {
      disposeChickenMaterialBundle(materialBundle);
    }
  });
});
