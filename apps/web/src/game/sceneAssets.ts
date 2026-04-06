import * as THREE from "three";
import type { ChickenPalette } from "./colors";
import { chickenDetailPalette } from "./colors";
import { chickenFeatherGeometry } from "./playerVisuals";
import { getVoxelMaterials, type BlockRenderProfile } from "./voxelMaterials";

export interface ChickenMaterialBundle {
  body: THREE.MeshStandardMaterial;
  shade: THREE.MeshStandardMaterial;
  ring: THREE.MeshBasicMaterial;
  shadow: THREE.MeshBasicMaterial;
  wingletTrace: THREE.MeshBasicMaterial;
}

export const playerShadowGeometry = new THREE.CircleGeometry(0.62, 18);
export const playerRingGeometry = new THREE.RingGeometry(0.5, 0.66, 24);

export const chickenModelRig = {
  wingAnchorX: 0.43,
  wingAnchorY: 0.04,
  wingAnchorZ: -0.02,
  lowWingAnchorX: 0.37,
  lowWingAnchorY: 0.04,
  lowWingAnchorZ: 0,
  headPivotY: 0.16,
  headPivotZ: 0.18,
  lowHeadPivotY: 0.1,
  lowHeadPivotZ: 0.14,
  tailAnchorY: 0.08,
  tailAnchorZ: -0.42,
  lowTailAnchorY: 0.08,
  lowTailAnchorZ: -0.34,
  legAnchorX: 0.21,
  legAnchorY: -0.34,
  legAnchorZ: 0.06,
  legMeshOffsetY: -0.14
} as const;

export const chickenPartGeometries = {
  wingRoot: new THREE.BoxGeometry(0.18, 0.28, 0.28),
  wingMid: new THREE.BoxGeometry(0.16, 0.2, 0.24),
  wingTip: new THREE.BoxGeometry(0.14, 0.16, 0.18),
  wingletTrace: new THREE.PlaneGeometry(0.52, 0.18),
  body: new THREE.BoxGeometry(0.78, 0.78, 0.78),
  head: new THREE.BoxGeometry(0.44, 0.38, 0.4),
  beakBase: new THREE.BoxGeometry(0.22, 0.16, 0.18),
  beakMid: new THREE.BoxGeometry(0.18, 0.14, 0.16),
  beakTip: new THREE.BoxGeometry(0.14, 0.12, 0.14),
  beakCap: new THREE.BoxGeometry(0.1, 0.1, 0.1),
  eye: new THREE.BoxGeometry(0.18, 0.18, 0.06),
  pupil: new THREE.BoxGeometry(0.07, 0.07, 0.04),
  wattle: new THREE.BoxGeometry(0.22, 0.16, 0.16),
  leg: new THREE.BoxGeometry(0.18, 0.28, 0.18),
  featherPlume: new THREE.BoxGeometry(...chickenFeatherGeometry.plumeSize),
  featherQuill: new THREE.BoxGeometry(...chickenFeatherGeometry.quillSize),
  lowTail: new THREE.BoxGeometry(0.16, 0.18, 0.14),
  lowBody: new THREE.BoxGeometry(0.72, 0.72, 0.7),
  lowHead: new THREE.BoxGeometry(0.32, 0.28, 0.28),
  lowWing: new THREE.BoxGeometry(0.14, 0.16, 0.24),
  lowBeakBase: new THREE.BoxGeometry(0.16, 0.12, 0.16),
  lowBeakFront: new THREE.BoxGeometry(0.12, 0.1, 0.12),
  lowBeakTip: new THREE.BoxGeometry(0.08, 0.08, 0.08),
  lowCrest: new THREE.BoxGeometry(0.14, 0.14, 0.08)
} as const;

export const chickenDetailMaterials = {
  eye: new THREE.MeshStandardMaterial({
    color: chickenDetailPalette.eye,
    roughness: 1,
    metalness: 0
  }),
  pupil: new THREE.MeshStandardMaterial({
    color: chickenDetailPalette.pupil,
    roughness: 1,
    metalness: 0
  }),
  beak: new THREE.MeshStandardMaterial({
    color: chickenDetailPalette.beak,
    roughness: 1,
    metalness: 0
  }),
  legs: new THREE.MeshStandardMaterial({
    color: chickenDetailPalette.legs,
    roughness: 1,
    metalness: 0
  })
} as const;

export const skyBirdBodyGeometry = new THREE.BoxGeometry(0.6, 0.18, 0.38);
export const skyBirdHeadGeometry = new THREE.BoxGeometry(0.16, 0.16, 0.16);
export const skyBirdWingGeometry = new THREE.BoxGeometry(0.56, 0.08, 0.24);
export const skyBirdMaterial = new THREE.MeshBasicMaterial({
  color: "#1f2429",
  toneMapped: false
});

export const skyDropWarningRingGeometry = new THREE.TorusGeometry(0.48, 0.06, 10, 24);
export const skyDropWarningBeamGeometry = new THREE.CylinderGeometry(0.12, 0.24, 1.8, 10, 1, true);
export const skyDropShadowGeometry = new THREE.CircleGeometry(0.56, 20);

const fallingClusterEmissiveColor = new THREE.Color("#f0db8a");

const cloneHighlightedVoxelMaterials = (profile: BlockRenderProfile) => {
  const baseMaterials = getVoxelMaterials(profile);
  const cloneByMaterial = new Map<THREE.Material, THREE.MeshStandardMaterial>();

  return baseMaterials.map((material) => {
    const cachedClone = cloneByMaterial.get(material);
    if (cachedClone) {
      return cachedClone;
    }

    const clone = material.clone();
    if (!(clone instanceof THREE.MeshStandardMaterial)) {
      throw new Error(`Expected MeshStandardMaterial for ${profile} highlighted voxel materials.`);
    }

    clone.emissive = fallingClusterEmissiveColor.clone();
    clone.emissiveIntensity = 0;
    cloneByMaterial.set(material, clone);
    return clone;
  });
};

export const fallingClusterMaterialsByProfile = {
  earthSurface: cloneHighlightedVoxelMaterials("earthSurface"),
  earthSubsoil: cloneHighlightedVoxelMaterials("earthSubsoil"),
  darkness: cloneHighlightedVoxelMaterials("darkness")
} satisfies Record<BlockRenderProfile, THREE.MeshStandardMaterial[]>;

export const fallingClusterSharedMaterials = [
  ...new Set([
    ...fallingClusterMaterialsByProfile.earthSurface,
    ...fallingClusterMaterialsByProfile.earthSubsoil,
    ...fallingClusterMaterialsByProfile.darkness
  ])
];

export const createChickenMaterialBundle = (palette: ChickenPalette): ChickenMaterialBundle => ({
  body: new THREE.MeshStandardMaterial({
    color: palette.body,
    roughness: 1,
    metalness: 0
  }),
  shade: new THREE.MeshStandardMaterial({
    color: palette.shade,
    roughness: 1,
    metalness: 0
  }),
  ring: new THREE.MeshBasicMaterial({
    color: palette.ringAccent,
    transparent: true,
    opacity: 0.8
  }),
  shadow: new THREE.MeshBasicMaterial({
    color: "#000000",
    transparent: true,
    opacity: 0.2,
    depthWrite: false,
    toneMapped: false
  }),
  wingletTrace: new THREE.MeshBasicMaterial({
    color: palette.ringAccent,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false
  })
});

export const disposeChickenMaterialBundle = (bundle: ChickenMaterialBundle) => {
  bundle.body.dispose();
  bundle.shade.dispose();
  bundle.ring.dispose();
  bundle.shadow.dispose();
  bundle.wingletTrace.dispose();
};
