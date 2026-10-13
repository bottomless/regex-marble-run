import type { Vec3 } from '../layout/pieces.ts';
import type { Materials } from './materials.ts';

export default function Pointer({
  position,
  angle,
  materials,
}: {
  position: Vec3;
  angle: number;
  materials: Materials;
}) {
  return (
    <group position={[position.x, position.y, position.z]} rotation={[0, 0, angle]}>
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
