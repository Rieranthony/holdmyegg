import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  createWaterfallVisual,
  disposeWaterfallVisual,
  getWaterfallSplashParticleCount,
  syncWaterfallVisual,
  waterfallTextures
} from "./waterfalls";

const createWaterfallFeature = () => ({
  id: "waterfall-1",
  x: 16,
  y: 7,
  z: 8,
  direction: "west" as const,
  width: 4,
  drop: 4,
  activationRadius: 20
});

describe("waterfalls", () => {
  it("creates tiny pixel textures for the waterfall sheet and foam", () => {
    expect(waterfallTextures.sheet).toBeInstanceOf(THREE.DataTexture);
    expect(waterfallTextures.foam).toBeInstanceOf(THREE.DataTexture);
    expect(waterfallTextures.sheet.image.width).toBe(16);
    expect(waterfallTextures.sheet.image.height).toBe(16);
    expect(waterfallTextures.foam.image.width).toBe(16);
    expect(waterfallTextures.foam.image.height).toBe(16);
  });

  it("animates the waterfall sheet and enables splash particles only while nearby", () => {
    const visual = createWaterfallVisual(createWaterfallFeature());
    const nearCamera = new THREE.Vector3(16, 6, 10);
    const farCamera = new THREE.Vector3(64, 20, 64);

    expect(syncWaterfallVisual(visual, 1.25, nearCamera, "medium")).toBe(true);
    expect(visual.sheetTexture.offset.y).not.toBe(0);
    expect(visual.splashMesh.visible).toBe(true);
    expect(visual.splashMesh.count).toBe(getWaterfallSplashParticleCount("medium"));

    const frozenOffsetY = visual.sheetTexture.offset.y;
    expect(syncWaterfallVisual(visual, 2.5, farCamera, "medium")).toBe(false);
    expect(visual.splashMesh.visible).toBe(false);
    expect(visual.splashMesh.count).toBe(0);

    syncWaterfallVisual(visual, 3.5, farCamera, "medium");
    expect(visual.sheetTexture.offset.y).toBe(frozenOffsetY);

    disposeWaterfallVisual(visual);
  });

  it("keeps the sheet active on low quality while dropping splash particles first", () => {
    const visual = createWaterfallVisual(createWaterfallFeature());
    const nearCamera = new THREE.Vector3(16, 6, 10);

    expect(syncWaterfallVisual(visual, 0.9, nearCamera, "low")).toBe(true);
    expect(visual.sheetTexture.offset.y).not.toBe(0);
    expect(visual.splashMesh.count).toBe(0);
    expect(visual.splashMesh.visible).toBe(false);

    disposeWaterfallVisual(visual);
  });
});
