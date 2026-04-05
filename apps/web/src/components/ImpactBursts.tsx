import { useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { OutOfBoundsSimulation } from "@out-of-bounds/sim";

interface ImpactBurst {
  id: string;
  origin: THREE.Vector3;
  createdAt: number;
}

const PARTICLE_COUNT = 10;
const PARTICLE_LIFETIME = 0.55;
const tempPosition = new THREE.Vector3();

const hashString = (value: string) => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash;
};

export function ImpactBurstsLayer({ runtime, playerIds }: { runtime: OutOfBoundsSimulation; playerIds: string[] }) {
  const [bursts, setBursts] = useState<ImpactBurst[]>([]);
  const previousStunRef = useRef<Record<string, number>>({});
  const nextBurstIdRef = useRef(1);

  useFrame((state) => {
    const now = state.clock.elapsedTime;
    const nextBursts = bursts.filter((burst) => now - burst.createdAt < PARTICLE_LIFETIME);

    for (const playerId of playerIds) {
      const player = runtime.getPlayerState(playerId);
      const previousStun = previousStunRef.current[playerId] ?? 0;
      const nextStun = player?.stunRemaining ?? 0;

      if (player && player.alive && previousStun <= 0 && nextStun > 0) {
        nextBursts.push({
          id: `burst-${nextBurstIdRef.current}`,
          origin: new THREE.Vector3(player.position.x, player.position.y + 0.45, player.position.z),
          createdAt: now
        });
        nextBurstIdRef.current += 1;
      }

      previousStunRef.current[playerId] = nextStun;
    }

    if (
      nextBursts.length !== bursts.length ||
      nextBursts.some((burst, index) => burst.id !== bursts[index]?.id)
    ) {
      setBursts(nextBursts);
    }
  });

  return (
    <group>
      {bursts.map((burst) => (
        <ImpactBurstMesh
          key={burst.id}
          burst={burst}
        />
      ))}
    </group>
  );
}

function ImpactBurstMesh({ burst }: { burst: ImpactBurst }) {
  const particlesRef = useRef<THREE.Mesh[]>([]);

  useFrame((state) => {
    const age = Math.min(1, (state.clock.elapsedTime - burst.createdAt) / PARTICLE_LIFETIME);

    particlesRef.current.forEach((particle, index) => {
      const seed = hashString(`${burst.id}:${index}`);
      const yaw = ((seed % 360) * Math.PI) / 180;
      const spread = 0.25 + (seed % 7) * 0.035;
      const lift = 0.55 + ((seed >> 3) % 5) * 0.08;
      tempPosition.set(
        burst.origin.x + Math.sin(yaw) * spread * (0.2 + age),
        burst.origin.y + lift * age - age * age * 0.28,
        burst.origin.z + Math.cos(yaw) * spread * (0.2 + age)
      );
      particle.position.copy(tempPosition);
      const scale = Math.max(0.08, 0.22 * (1 - age));
      particle.scale.setScalar(scale);
      (particle.material as THREE.MeshBasicMaterial).opacity = 1 - age;
    });
  });

  return (
    <group>
      {Array.from({ length: PARTICLE_COUNT }, (_, index) => (
        <mesh
          key={index}
          ref={(mesh) => {
            if (mesh) {
              particlesRef.current[index] = mesh;
            }
          }}
        >
          <boxGeometry args={[0.18, 0.18, 0.18]} />
          <meshBasicMaterial
            color="#fff4c6"
            transparent
            opacity={1}
          />
        </mesh>
      ))}
    </group>
  );
}
