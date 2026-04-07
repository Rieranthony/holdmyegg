import * as THREE from "three";
import { PIXEL_TEXTURE_SIZE, propTexturePalette, propTextureRows } from "./propMaterials";

export const eggBaseGeometry = new THREE.BoxGeometry(0.34, 0.18, 0.34);
export const eggMiddleGeometry = new THREE.BoxGeometry(0.46, 0.2, 0.46);
export const eggCapGeometry = new THREE.BoxGeometry(0.26, 0.16, 0.26);

export const eggPartLayout = [
  {
    key: "cap",
    width: 26,
    height: 16,
    x: 10,
    y: 0
  },
  {
    key: "middle",
    width: 46,
    height: 20,
    x: 0,
    y: 16
  },
  {
    key: "base",
    width: 34,
    height: 18,
    x: 6,
    y: 33
  }
] as const;

export const eggIconViewBox = {
  width: 46,
  height: 51
} as const;

export const eggTextureRows = propTextureRows.egg;
export const eggTexturePixels = eggTextureRows.flatMap((row, y) =>
  [...row].map((token, x) => ({
    x,
    y,
    color: propTexturePalette[token as keyof typeof propTexturePalette]
  }))
);

export const eggTextureSize = PIXEL_TEXTURE_SIZE;
