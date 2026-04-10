import * as THREE from "three";
import type { WaterfallFeature } from "@out-of-bounds/map";
import type { QualityTier } from "./quality";
import { configureDynamicInstancedMesh, finalizeDynamicInstancedMesh } from "./instancedMeshes";
import { createPixelTexture } from "./voxelMaterials";

const WATERFALL_SHEET_THICKNESS = 0.18;
const WATERFALL_SHEET_SPEED = 0.84;
const WATERFALL_FOAM_SPEED = 0.22;
const MAX_WATERFALL_SPLASH_PARTICLES = 10;
const waterfallTempObject = new THREE.Object3D();

const hashString = (value: string) => {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
};

const getNoise = (seed: number, salt: number) => {
  const value = Math.sin(seed * 0.0017 + salt * 12.9898) * 43758.5453;
  return value - Math.floor(value);
};

export const waterfallTextureRows = {
  sheet: [
    "wwWfwwWfwwWfwwWf",
    "WwfqWwfqWwfqWwfq",
    "wfWWwfWWwfWWwfWW",
    "fqwwfqwwfqwwfqww",
    "wwWfwwWfwwWfwwWf",
    "WwfqWwfqWwfqWwfq",
    "wfWWwfWWwfWWwfWW",
    "fqwwfqwwfqwwfqww",
    "wwWfwwWfwwWfwwWf",
    "WwfqWwfqWwfqWwfq",
    "wfWWwfWWwfWWwfWW",
    "fqwwfqwwfqwwfqww",
    "wwWfwwWfwwWfwwWf",
    "WwfqWwfqWwfqWwfq",
    "wfWWwfWWwfWWwfWW",
    "fqwwfqwwfqwwfqww"
  ],
  foam: [
    "0000Ff0000Ff0000",
    "00Ffff000Ffff000",
    "0Ffffff0fffffF00",
    "00FfffffffFff000",
    "000FfffffffF0000",
    "00ffffFfFffff000",
    "0Ffff00000fffF00",
    "00Ff0000000fF000",
    "0000Ff0000Ff0000",
    "00Ffff000Ffff000",
    "0Ffffff0fffffF00",
    "00FfffffffFff000",
    "000FfffffffF0000",
    "00ffffFfFffff000",
    "0Ffff00000fffF00",
    "00Ff0000000fF000"
  ]
} as const;

export const waterfallTextures = {
  sheet: createPixelTexture(waterfallTextureRows.sheet),
  foam: createPixelTexture(waterfallTextureRows.foam, {
    transparentTokens: ["0"]
  })
};

export interface WaterfallVisual {
  feature: WaterfallFeature;
  group: THREE.Group;
  sheetMesh: THREE.Mesh;
  splashMesh: THREE.InstancedMesh;
  sheetMaterial: THREE.MeshStandardMaterial;
  splashMaterial: THREE.MeshBasicMaterial;
  sheetTexture: THREE.Texture;
  foamTexture: THREE.Texture;
  animationActive: boolean;
}

const getResolvedWaterfallWidth = (feature: WaterfallFeature) => feature.width ?? 4;
const getResolvedWaterfallDrop = (feature: WaterfallFeature) => feature.drop ?? 4;
const getResolvedWaterfallActivationRadius = (feature: WaterfallFeature) => feature.activationRadius ?? 20;

const getWaterfallSheetCenter = (feature: WaterfallFeature) => {
  const width = getResolvedWaterfallWidth(feature);
  const drop = getResolvedWaterfallDrop(feature);

  switch (feature.direction) {
    case "west":
      return new THREE.Vector3(
        feature.x - WATERFALL_SHEET_THICKNESS / 2,
        feature.y - drop / 2 + 1,
        feature.z + width / 2
      );
    case "east":
      return new THREE.Vector3(
        feature.x + 1 + WATERFALL_SHEET_THICKNESS / 2,
        feature.y - drop / 2 + 1,
        feature.z + width / 2
      );
    case "north":
      return new THREE.Vector3(
        feature.x + width / 2,
        feature.y - drop / 2 + 1,
        feature.z - WATERFALL_SHEET_THICKNESS / 2
      );
    case "south":
      return new THREE.Vector3(
        feature.x + width / 2,
        feature.y - drop / 2 + 1,
        feature.z + 1 + WATERFALL_SHEET_THICKNESS / 2
      );
  }
};

const createWaterfallSheetGeometry = (feature: WaterfallFeature) => {
  const width = getResolvedWaterfallWidth(feature);
  const drop = getResolvedWaterfallDrop(feature);

  if (feature.direction === "east" || feature.direction === "west") {
    return new THREE.BoxGeometry(WATERFALL_SHEET_THICKNESS, drop, width);
  }

  return new THREE.BoxGeometry(width, drop, WATERFALL_SHEET_THICKNESS);
};

const createWaterfallSheetMaterial = (feature: WaterfallFeature) => {
  const width = getResolvedWaterfallWidth(feature);
  const drop = getResolvedWaterfallDrop(feature);
  const texture = waterfallTextures.sheet.clone();
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(width, drop);
  texture.needsUpdate = true;

  const material = new THREE.MeshStandardMaterial({
    color: "#ffffff",
    map: texture,
    roughness: 0.4,
    metalness: 0,
    transparent: true,
    opacity: 0.84,
    depthWrite: false
  });
  material.emissive = new THREE.Color("#8fd8ff");
  material.emissiveIntensity = 0.12;

  return {
    material,
    texture
  };
};

const createWaterfallFoamMaterial = () => {
  const texture = waterfallTextures.foam.clone();
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;

  const material = new THREE.MeshBasicMaterial({
    color: "#e9fbff",
    map: texture,
    transparent: true,
    opacity: 0.76,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false
  });

  return {
    material,
    texture
  };
};

const getWaterfallSplashBasePosition = (feature: WaterfallFeature, widthAlpha: number) => {
  const width = getResolvedWaterfallWidth(feature);
  const bottomY = feature.y - getResolvedWaterfallDrop(feature) + 1.02;
  const alongWidth = widthAlpha * Math.max(0, width - 1);

  switch (feature.direction) {
    case "west":
      return new THREE.Vector3(feature.x - 0.2, bottomY, feature.z + alongWidth + 0.5);
    case "east":
      return new THREE.Vector3(feature.x + 1.2, bottomY, feature.z + alongWidth + 0.5);
    case "north":
      return new THREE.Vector3(feature.x + alongWidth + 0.5, bottomY, feature.z - 0.2);
    case "south":
      return new THREE.Vector3(feature.x + alongWidth + 0.5, bottomY, feature.z + 1.2);
  }
};

const getSplashOutwardOffset = (feature: WaterfallFeature, amount: number) => {
  switch (feature.direction) {
    case "west":
      return { x: -amount, z: 0 };
    case "east":
      return { x: amount, z: 0 };
    case "north":
      return { x: 0, z: -amount };
    case "south":
      return { x: 0, z: amount };
  }
};

export const getWaterfallSplashParticleCount = (qualityTier: QualityTier) =>
  qualityTier === "high" ? 10 : qualityTier === "medium" ? 5 : 0;

export const isWaterfallAnimationActive = (feature: WaterfallFeature, cameraPosition: THREE.Vector3) =>
  cameraPosition.distanceToSquared(getWaterfallSheetCenter(feature)) <=
  getResolvedWaterfallActivationRadius(feature) * getResolvedWaterfallActivationRadius(feature);

export const createWaterfallVisual = (feature: WaterfallFeature): WaterfallVisual => {
  const group = new THREE.Group();
  group.name = feature.id;

  const { material: sheetMaterial, texture: sheetTexture } = createWaterfallSheetMaterial(feature);
  const sheetMesh = new THREE.Mesh(createWaterfallSheetGeometry(feature), sheetMaterial);
  sheetMesh.position.copy(getWaterfallSheetCenter(feature));
  sheetMesh.castShadow = false;
  sheetMesh.receiveShadow = false;
  sheetMesh.userData.waterfallFeatureId = feature.id;
  group.add(sheetMesh);

  const { material: splashMaterial, texture: foamTexture } = createWaterfallFoamMaterial();
  const splashMesh = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(0.72, 0.42),
    splashMaterial,
    MAX_WATERFALL_SPLASH_PARTICLES
  );
  splashMesh.frustumCulled = false;
  splashMesh.count = 0;
  splashMesh.visible = false;
  splashMesh.userData.waterfallFeatureId = feature.id;
  configureDynamicInstancedMesh(splashMesh);
  group.add(splashMesh);

  return {
    feature,
    group,
    sheetMesh,
    splashMesh,
    sheetMaterial,
    splashMaterial,
    sheetTexture,
    foamTexture,
    animationActive: false
  };
};

export const syncWaterfallVisual = (
  visual: WaterfallVisual,
  elapsedSeconds: number,
  cameraPosition: THREE.Vector3,
  qualityTier: QualityTier
) => {
  const active = isWaterfallAnimationActive(visual.feature, cameraPosition);
  visual.animationActive = active;

  if (active) {
    const seed = hashString(visual.feature.id);
    visual.sheetTexture.offset.y = -((elapsedSeconds * WATERFALL_SHEET_SPEED) % 1);
    visual.sheetTexture.offset.x =
      ((Math.sin(elapsedSeconds * 0.35 + seed * 0.0002) * 0.035) % 1 + 1) % 1;
    visual.foamTexture.offset.x = (elapsedSeconds * 0.08) % 1;
    visual.foamTexture.offset.y = -((elapsedSeconds * WATERFALL_FOAM_SPEED) % 1);
  }

  const particleCount = active ? getWaterfallSplashParticleCount(qualityTier) : 0;
  const featureSeed = hashString(visual.feature.id);
  for (let index = 0; index < particleCount; index += 1) {
    const particleSeed = featureSeed + index * 97;
    const widthAlpha = index / Math.max(1, particleCount - 1);
    const loop = (elapsedSeconds * 1.6 + getNoise(particleSeed, 1)) % 1;
    const pulse = Math.sin(loop * Math.PI);
    const base = getWaterfallSplashBasePosition(visual.feature, widthAlpha);
    const outward = getSplashOutwardOffset(visual.feature, 0.08 + pulse * 0.22);
    const lateralJitter = (getNoise(particleSeed, 2) - 0.5) * 0.32;

    waterfallTempObject.position.set(
      base.x + outward.x + (visual.feature.direction === "north" || visual.feature.direction === "south" ? lateralJitter : 0),
      base.y + pulse * (0.08 + getNoise(particleSeed, 3) * 0.18),
      base.z + outward.z + (visual.feature.direction === "east" || visual.feature.direction === "west" ? lateralJitter : 0)
    );
    waterfallTempObject.rotation.set(-Math.PI / 2, 0, loop * Math.PI * 2 + getNoise(particleSeed, 4));
    waterfallTempObject.scale.setScalar(0.55 + pulse * (0.3 + getNoise(particleSeed, 5) * 0.18));
    waterfallTempObject.updateMatrix();
    visual.splashMesh.setMatrixAt(index, waterfallTempObject.matrix);
  }

  finalizeDynamicInstancedMesh(visual.splashMesh, particleCount);
  return active;
};

export const disposeWaterfallVisual = (visual: WaterfallVisual) => {
  visual.sheetMesh.geometry.dispose();
  visual.sheetMaterial.dispose();
  visual.sheetTexture.dispose();
  visual.splashMesh.geometry.dispose();
  visual.splashMaterial.dispose();
  visual.foamTexture.dispose();
};
