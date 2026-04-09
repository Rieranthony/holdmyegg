import * as THREE from "three";
import { CSM } from "three/examples/jsm/csm/CSM.js";

export const SUN_SHADOW_LAYER = 1;

const SUN_DIRECTION = new THREE.Vector3(-0.72, -1, -0.5).normalize();
const SHADOW_MAP_SIZE = 1024;
const SHADOW_CAMERA_EPSILON = 1e-3;
const SHADOW_NORMAL_BIAS = 0.02;
const SHADOW_BIAS = -0.00025;

const formatLightCoordinate = (value: number) => value.toFixed(3);

const buildLightStateSignature = (lights: readonly THREE.DirectionalLight[]) =>
  lights
    .map((light) =>
      [
        formatLightCoordinate(light.position.x),
        formatLightCoordinate(light.position.y),
        formatLightCoordinate(light.position.z),
        formatLightCoordinate(light.target.position.x),
        formatLightCoordinate(light.target.position.y),
        formatLightCoordinate(light.target.position.z)
      ].join(":")
    )
    .join("|");

export interface SunShadowDiagnostics {
  sunShadowsEnabled: boolean;
  shadowMapRefreshCount: number;
}

export interface SunShadowWorldState {
  maxFar: number;
  lightFar: number;
  lightMargin: number;
}

export class SunShadows {
  private readonly trackedMaterials = new Set<THREE.Material>();
  private csm: CSM | null = null;
  private enabled = false;
  private dirty = true;
  private lightStateSignature = "";
  private lightIntensity = 1;
  private worldState: SunShadowWorldState = {
    maxFar: 96,
    lightFar: 160,
    lightMargin: 24
  };
  private shadowMapRefreshCount = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly renderer: THREE.WebGLRenderer
  ) {}

  trackMaterial(materials: THREE.Material | readonly THREE.Material[] | null | undefined) {
    if (!materials) {
      return;
    }

    const nextMaterials = Array.isArray(materials) ? materials : [materials];
    for (const material of nextMaterials) {
      if (this.trackedMaterials.has(material)) {
        continue;
      }

      this.trackedMaterials.add(material);
      this.csm?.setupMaterial(material);
      material.needsUpdate = true;
    }
  }

  setEnabled(enabled: boolean) {
    if (this.enabled === enabled) {
      return;
    }

    this.enabled = enabled;
    if (enabled) {
      this.enable();
      return;
    }

    this.disable();
  }

  setLightIntensity(intensity: number) {
    if (Math.abs(this.lightIntensity - intensity) <= SHADOW_CAMERA_EPSILON) {
      return;
    }

    this.lightIntensity = intensity;
    if (!this.csm) {
      return;
    }

    for (const light of this.csm.lights) {
      light.intensity = intensity;
    }
  }

  syncWorld(nextState: SunShadowWorldState) {
    const changed =
      Math.abs(this.worldState.maxFar - nextState.maxFar) > SHADOW_CAMERA_EPSILON ||
      Math.abs(this.worldState.lightFar - nextState.lightFar) > SHADOW_CAMERA_EPSILON ||
      Math.abs(this.worldState.lightMargin - nextState.lightMargin) > SHADOW_CAMERA_EPSILON;

    if (!changed) {
      return;
    }

    this.worldState = nextState;
    if (!this.csm) {
      this.markDirty();
      return;
    }

    this.csm.maxFar = nextState.maxFar;
    this.csm.lightFar = nextState.lightFar;
    this.csm.lightMargin = nextState.lightMargin;
    this.csm.updateFrustums();
    this.markDirty();
  }

  handleCameraProjectionChange() {
    if (!this.csm) {
      this.markDirty();
      return;
    }

    this.csm.updateFrustums();
    this.markDirty();
  }

  markDirty() {
    this.dirty = true;
  }

  update() {
    if (!this.enabled || !this.csm) {
      return false;
    }

    this.csm.update();
    const nextSignature = buildLightStateSignature(this.csm.lights);
    if (!this.dirty && nextSignature === this.lightStateSignature) {
      return false;
    }

    this.dirty = false;
    this.lightStateSignature = nextSignature;
    this.renderer.shadowMap.needsUpdate = true;
    this.shadowMapRefreshCount += 1;
    return true;
  }

  getDiagnostics(): SunShadowDiagnostics {
    return {
      sunShadowsEnabled: this.enabled,
      shadowMapRefreshCount: this.shadowMapRefreshCount
    };
  }

  dispose() {
    this.disable();
  }

  private enable() {
    this.ensureCsm();
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.BasicShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    this.markDirty();
  }

  private disable() {
    this.csm?.remove();
    this.csm?.dispose();
    this.csm = null;
    this.renderer.shadowMap.enabled = false;
    this.renderer.shadowMap.autoUpdate = true;
    this.renderer.shadowMap.needsUpdate = false;
    this.lightStateSignature = "";
    this.dirty = true;
  }

  private ensureCsm() {
    if (this.csm) {
      return;
    }

    const csm = new CSM({
      camera: this.camera,
      parent: this.scene,
      cascades: 2,
      maxFar: this.worldState.maxFar,
      mode: "practical",
      shadowMapSize: SHADOW_MAP_SIZE,
      shadowBias: SHADOW_BIAS,
      lightDirection: SUN_DIRECTION.clone(),
      lightIntensity: this.lightIntensity,
      lightFar: this.worldState.lightFar,
      lightMargin: this.worldState.lightMargin
    });
    csm.fade = false;

    for (const light of csm.lights) {
      light.shadow.normalBias = SHADOW_NORMAL_BIAS;
      light.layers.set(SUN_SHADOW_LAYER);
    }

    for (const material of this.trackedMaterials) {
      csm.setupMaterial(material);
      material.needsUpdate = true;
    }

    this.csm = csm;
    this.lightStateSignature = "";
    this.markDirty();
  }
}

export const enableSunShadowLayer = (object: Pick<THREE.Object3D, "layers"> | null | undefined) => {
  if (!object) {
    return;
  }

  object.layers.enable(SUN_SHADOW_LAYER);
};

export const syncDirectionalLightSunLayer = (light: THREE.DirectionalLight, sunShadowsEnabled: boolean) => {
  light.layers.set(0);
  if (!sunShadowsEnabled) {
    light.layers.enable(SUN_SHADOW_LAYER);
  }
};
