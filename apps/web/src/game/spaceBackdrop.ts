import * as THREE from "three";

export interface SpacePlanetDescriptor {
  offset: readonly [number, number, number];
  radius: readonly [number, number, number];
  scale: number;
  colors: readonly [string, string, string?];
  spinSpeed: number;
  wobblePhase: number;
}

export interface VoxelPlanetMatrixBuckets {
  mainMatrices: THREE.Matrix4[];
  shadeMatrices: THREE.Matrix4[];
  accentMatrices: THREE.Matrix4[];
}

export const daySkyColorHex = "#8fc6e0";
export const daySkyColor = new THREE.Color(daySkyColorHex);
export const spaceSkyColor = new THREE.Color("#04060d");
export const dayFogColor = new THREE.Color(daySkyColorHex);
export const spaceFogColor = new THREE.Color("#070a12");
export const SPACE_BLEND_DAMPING = 4.4;
export const SPACE_STAR_COUNT = 220;

const backdropTempObject = new THREE.Object3D();

const fract = (value: number) => value - Math.floor(value);

const sampleVoxelPlanetNoise = (x: number, y: number, z: number) =>
  fract(Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453123);

export const spacePlanetDescriptors: readonly SpacePlanetDescriptor[] = [
  {
    offset: [-168, 94, -280],
    radius: [5, 5, 5],
    scale: 3.2,
    colors: ["#85b6ff", "#4b6fc0"],
    spinSpeed: 0.11,
    wobblePhase: 0.2
  },
  {
    offset: [212, -38, -316],
    radius: [6, 4, 6],
    scale: 2.7,
    colors: ["#f3c27a", "#c07a3d"],
    spinSpeed: -0.08,
    wobblePhase: 1.1
  },
  {
    offset: [28, 136, -340],
    radius: [4, 6, 4],
    scale: 2.45,
    colors: ["#97ecff", "#4d9bc7"],
    spinSpeed: 0.06,
    wobblePhase: 2.1
  },
  {
    offset: [-92, 168, -468],
    radius: [7, 7, 7],
    scale: 4.25,
    colors: ["#66a7ff", "#2e5db8", "#59bf72"],
    spinSpeed: 0.03,
    wobblePhase: 2.8
  }
] as const;

export const createSpaceStarGeometry = () => {
  const positions = new Float32Array(SPACE_STAR_COUNT * 3);

  for (let index = 0; index < SPACE_STAR_COUNT; index += 1) {
    const ratio = (index + 0.5) / SPACE_STAR_COUNT;
    const polar = Math.acos(1 - 2 * ratio);
    const azimuth = index * 2.399963229728653;
    const radius = 220 + ((index * 73) % 120);
    positions[index * 3] = Math.sin(polar) * Math.cos(azimuth) * radius;
    positions[index * 3 + 1] = Math.cos(polar) * radius * 0.9;
    positions[index * 3 + 2] = Math.sin(polar) * Math.sin(azimuth) * radius;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.computeBoundingSphere();
  return geometry;
};

export const buildVoxelPlanetMatrices = (
  descriptor: Pick<SpacePlanetDescriptor, "radius" | "colors">
): VoxelPlanetMatrixBuckets => {
  const [radiusX, radiusY, radiusZ] = descriptor.radius;
  const accentEnabled = descriptor.colors[2] !== undefined;
  const mainMatrices: THREE.Matrix4[] = [];
  const shadeMatrices: THREE.Matrix4[] = [];
  const accentMatrices: THREE.Matrix4[] = [];

  for (let x = -radiusX; x <= radiusX; x += 1) {
    for (let y = -radiusY; y <= radiusY; y += 1) {
      for (let z = -radiusZ; z <= radiusZ; z += 1) {
        const normalized =
          (x * x) / Math.max(1, radiusX * radiusX) +
          (y * y) / Math.max(1, radiusY * radiusY) +
          (z * z) / Math.max(1, radiusZ * radiusZ);
        if (normalized > 1) {
          continue;
        }

        backdropTempObject.position.set(x, y, z);
        backdropTempObject.rotation.set(0, 0, 0);
        backdropTempObject.scale.set(1, 1, 1);
        backdropTempObject.updateMatrix();
        const matrix = backdropTempObject.matrix.clone();

        if (accentEnabled) {
          const shellDepth = 1 - normalized;
          const surfaceBand = shellDepth < 0.38;
          const landNoise = sampleVoxelPlanetNoise(x, y, z);
          const continentNoise = sampleVoxelPlanetNoise(x + 11, y - 7, z + 19);
          const latitudinalBias = 0.48 + Math.abs(y / Math.max(1, radiusY)) * 0.18;
          if (surfaceBand && landNoise > latitudinalBias && continentNoise > 0.42) {
            accentMatrices.push(matrix);
            continue;
          }
        }

        const shadingSignal =
          x * 0.62 +
          y * 0.28 -
          z * 0.44 +
          sampleVoxelPlanetNoise(x + 3, y + 5, z + 7) * 0.28;
        (shadingSignal < 0 ? shadeMatrices : mainMatrices).push(matrix);
      }
    }
  }

  return {
    mainMatrices,
    shadeMatrices,
    accentMatrices
  };
};
