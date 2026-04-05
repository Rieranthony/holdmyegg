import { useEffect, useLayoutEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { OutOfBoundsSimulation } from "@out-of-bounds/sim";
import { configureDynamicInstancedMesh, finalizeDynamicInstancedMesh } from "../game/instancedMeshes";

interface ImpactBurstSlot {
  active: boolean;
  serial: number;
  origin: THREE.Vector3;
  createdAt: number;
}

const PARTICLE_COUNT = 10;
const PARTICLE_LIFETIME = 0.55;
const particleGeometry = new THREE.BoxGeometry(0.18, 0.18, 0.18);
const particleMaterial = new THREE.MeshBasicMaterial({
  color: "#fff4c6"
});
const tempObject = new THREE.Object3D();

const createBurstSlots = (count: number): ImpactBurstSlot[] =>
  Array.from({ length: count }, () => ({
    active: false,
    serial: 0,
    origin: new THREE.Vector3(),
    createdAt: -Infinity
  }));

const hashSeed = (serial: number, index: number) => ((serial * 73856093) ^ (index * 19349663)) >>> 0;

const getBurstSlot = (slots: ImpactBurstSlot[], now: number) => {
  for (const slot of slots) {
    if (!slot.active || now - slot.createdAt >= PARTICLE_LIFETIME) {
      return slot;
    }
  }

  return slots.reduce<ImpactBurstSlot | null>((oldest, slot) => {
    if (!oldest || slot.createdAt < oldest.createdAt) {
      return slot;
    }

    return oldest;
  }, null);
};

export function ImpactBurstsLayer({
  runtime,
  playerIds,
  maxBursts = 12
}: {
  runtime: OutOfBoundsSimulation;
  playerIds: string[];
  maxBursts?: number;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const previousStunRef = useRef<Record<string, number>>({});
  const nextSerialRef = useRef(1);
  const slotsRef = useRef<ImpactBurstSlot[]>(createBurstSlots(maxBursts));

  useLayoutEffect(() => {
    configureDynamicInstancedMesh(meshRef.current);
  }, []);

  useEffect(() => {
    slotsRef.current = createBurstSlots(maxBursts);
  }, [maxBursts]);

  useFrame((state) => {
    const now = state.clock.elapsedTime;
    const slots = slotsRef.current;

    for (const playerId of playerIds) {
      const player = runtime.getPlayerRuntimeState(playerId);
      const previousStun = previousStunRef.current[playerId] ?? 0;
      const nextStun = player?.stunRemaining ?? 0;

      if (player && player.alive && previousStun <= 0 && nextStun > 0) {
        const slot = getBurstSlot(slots, now);
        if (slot) {
          slot.active = true;
          slot.serial = nextSerialRef.current;
          slot.origin.set(player.position.x, player.position.y + 0.45, player.position.z);
          slot.createdAt = now;
          nextSerialRef.current += 1;
        }
      }

      previousStunRef.current[playerId] = nextStun;
    }

    const mesh = meshRef.current;
    if (!mesh) {
      return;
    }

    let instanceIndex = 0;
    for (const slot of slots) {
      if (!slot.active) {
        continue;
      }

      const age = Math.min(1, (now - slot.createdAt) / PARTICLE_LIFETIME);
      if (age >= 1) {
        slot.active = false;
        continue;
      }

      for (let particleIndex = 0; particleIndex < PARTICLE_COUNT; particleIndex += 1) {
        const seed = hashSeed(slot.serial, particleIndex);
        const yaw = ((seed % 360) * Math.PI) / 180;
        const spread = 0.25 + (seed % 7) * 0.035;
        const lift = 0.55 + ((seed >> 3) % 5) * 0.08;
        const scale = Math.max(0.04, 0.24 * (1 - age));

        tempObject.position.set(
          slot.origin.x + Math.sin(yaw) * spread * (0.2 + age),
          slot.origin.y + lift * age - age * age * 0.28,
          slot.origin.z + Math.cos(yaw) * spread * (0.2 + age)
        );
        tempObject.scale.setScalar(scale);
        tempObject.updateMatrix();
        mesh.setMatrixAt(instanceIndex, tempObject.matrix);
        instanceIndex += 1;
      }
    }

    finalizeDynamicInstancedMesh(mesh, instanceIndex);
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[particleGeometry, particleMaterial, Math.max(1, maxBursts * PARTICLE_COUNT)]}
      matrixAutoUpdate={false}
    />
  );
}
