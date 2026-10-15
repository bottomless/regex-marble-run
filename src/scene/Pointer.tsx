import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Group } from 'three';
import type { Vec3 } from '../layout/pieces.ts';
import type { Materials } from './materials.ts';

const STIFFNESS = 78;
const DAMPING = 12;

function shortest(from: number, to: number): number {
  let delta = to - from;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return from + delta;
}

export default function Pointer({
  position,
  angle,
  materials,
  reducedMotion = false,
}: {
  position: Vec3;
  angle: number;
  materials: Materials;
  reducedMotion?: boolean;
}) {
  const ref = useRef<Group>(null);
  const current = useRef(angle);
  const velocity = useRef(0);
  useFrame((state, delta) => {
    const group = ref.current;
    if (!group) return;
    if (reducedMotion) {
      current.current = angle;
      velocity.current = 0;
      group.rotation.z = angle;
      return;
    }
    const dt = Math.min(delta, 0.05);
    const aim = shortest(current.current, angle);
    const force = (aim - current.current) * STIFFNESS - velocity.current * DAMPING;
    velocity.current += force * dt;
    current.current += velocity.current * dt;
    group.rotation.z = current.current;
    if (Math.abs(aim - current.current) > 0.004 || Math.abs(velocity.current) > 0.02) state.invalidate();
  });
  return (
    <group ref={ref} position={[position.x, position.y, position.z]} rotation={[0, 0, angle]}>
      <mesh material={materials.brass}>
        <sphereGeometry args={[0.08, 12, 8]} />
      </mesh>
      <mesh position={[0, -0.25, 0]} material={materials.tracks.teal}>
        <boxGeometry args={[0.09, 0.5, 0.07]} />
      </mesh>
      <mesh position={[0, -0.59, 0]} rotation={[0, 0, Math.PI]} material={materials.tracks.teal}>
        <coneGeometry args={[0.15, 0.2, 3]} />
      </mesh>
    </group>
  );
}
