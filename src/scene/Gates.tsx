import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  InstancedMesh,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import type { BufferGeometry, ColorRepresentation, Material } from 'three';
import type { MachineLayout, Piece } from '../layout/pieces.ts';
import type { Program } from '../engine/ir.ts';
import Glyph from './Glyph.tsx';
import type { Materials } from './materials.ts';

export function Hardware({
  pieces,
  geometry,
  material,
  offset,
  rotation,
  scale,
  color,
  castShadow = true,
  receiveShadow = true,
}: {
  pieces: Piece[];
  geometry: BufferGeometry;
  material: Material;
  offset?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number | [number, number, number];
  color?: ColorRepresentation | ((piece: Piece) => ColorRepresentation);
  castShadow?: boolean;
  receiveShadow?: boolean;
}) {
  const ref = useRef<InstancedMesh>(null);
  const invalidate = useThree((state) => state.invalidate);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh || !pieces.length) return;
    const object = new Object3D();
    const tint = new Color();
    if (rotation) object.rotation.set(...rotation);
    if (typeof scale === 'number') object.scale.setScalar(scale);
    else if (scale) object.scale.set(...scale);
    pieces.forEach((piece, i) => {
      object.position.set(
        piece.position.x + (offset?.[0] ?? 0),
        piece.position.y + (offset?.[1] ?? 0),
        piece.position.z + (offset?.[2] ?? 0),
      );
      object.updateMatrix();
      mesh.setMatrixAt(i, object.matrix);
      if (color !== undefined || mesh.instanceColor) {
        mesh.setColorAt(i, tint.set(typeof color === 'function' ? color(piece) : (color ?? '#ffffff')));
      }
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    invalidate();
  }, [pieces, geometry, material, offset, rotation, scale, color, invalidate]);
  if (!pieces.length) return null;
  return (
    <instancedMesh
      ref={ref}
      args={[geometry, material, pieces.length]}
      castShadow={castShadow}
      receiveShadow={receiveShadow}
    />
  );
}

export default function Gates({
  machine,
  materials,
  program,
}: {
  machine: MachineLayout;
  materials: Materials;
  program: Program;
}) {
  const gates = useMemo(() => machine.pieces.filter((piece) => piece.kind === 'gate'), [machine]);
  const sensors = useMemo(
    () => machine.pieces.filter((piece) => piece.kind === 'sensor' || piece.kind === 'scout'),
    [machine],
  );
  const bulbs = useMemo(() => sensors.filter((piece) => piece.kind === 'sensor'), [sensors]);
  const geometry = useMemo(
    () => ({
      post: new BoxGeometry(0.12, 0.72, 0.24),
      feet: new BoxGeometry(0.26, 0.1, 0.45),
      arch: new TorusGeometry(0.43, 0.075, 6, 18, Math.PI),
      sensor: new CylinderGeometry(0.45, 0.45, 0.16, 24),
      disc: new CylinderGeometry(0.33, 0.33, 0.06, 24),
      bulb: new SphereGeometry(0.07, 12, 8),
    }),
    [],
  );
  const sensorMaterials = useMemo(
    () => ({
      disc: new MeshStandardMaterial({ metalness: 0.3, roughness: 0.3 }),
      bulb: new MeshStandardMaterial({ color: '#8f986b', roughness: 0.4 }),
    }),
    [],
  );
  useEffect(() => () => Object.values(geometry).forEach((item) => item.dispose()), [geometry]);
  useEffect(() => () => Object.values(sensorMaterials).forEach((item) => item.dispose()), [sensorMaterials]);
  return (
    <group>
      <Hardware
        pieces={gates}
        geometry={geometry.post}
        material={materials.brass}
        offset={[-0.43, -0.21, 0.2]}
      />
      <Hardware
        pieces={gates}
        geometry={geometry.post}
        material={materials.brass}
        offset={[0.43, -0.21, 0.2]}
      />
      <Hardware
        pieces={gates}
        geometry={geometry.feet}
        material={materials.tracks.edge}
        offset={[-0.43, -0.6, 0.2]}
      />
      <Hardware
        pieces={gates}
        geometry={geometry.feet}
        material={materials.tracks.edge}
        offset={[0.43, -0.6, 0.2]}
      />
      <Hardware pieces={gates} geometry={geometry.arch} material={materials.brass} offset={[0, 0.15, 0.2]} />
      <Hardware
        pieces={sensors}
        geometry={geometry.sensor}
        material={materials.brass}
        rotation={[Math.PI / 2, 0, 0]}
        receiveShadow={false}
      />
      <Hardware
        pieces={sensors}
        geometry={geometry.disc}
        material={sensorMaterials.disc}
        offset={[0, 0, 0.12]}
        rotation={[Math.PI / 2, 0, 0]}
        color={(piece) => (piece.kind === 'scout' ? '#84afa1' : '#dabd72')}
        castShadow={false}
        receiveShadow={false}
      />
      <Hardware
        pieces={bulbs}
        geometry={geometry.bulb}
        material={sensorMaterials.bulb}
        offset={[0, -0.48, 0.22]}
        castShadow={false}
        receiveShadow={false}
      />
      {machine.pieces
        .filter((piece) => ['gate', 'sensor', 'mirror', 'opaque', 'scout'].includes(piece.kind))
        .map((piece, i) => {
          const p = piece.position;
          const node = piece.node === null ? null : program.nodes[piece.node];
          const sensor = piece.kind === 'sensor' || piece.kind === 'scout';
          return (
            <group key={i} position={[p.x, p.y, p.z]}>
              {piece.kind === 'gate' ? (
                <mesh position={[0, 0.74, 0.27]} material={materials.tracks.birch} castShadow>
                  <boxGeometry
                    args={[Math.max(0.9, Math.min(2.1, (piece.label?.length ?? 1) * 0.13 + 0.5)), 0.34, 0.14]}
                  />
                </mesh>
              ) : !sensor ? (
                <>
                  <mesh material={piece.kind === 'opaque' ? materials.ink : materials.brass} castShadow>
                    <boxGeometry args={[1.05, 0.95, 0.45]} />
                  </mesh>
                  {piece.kind === 'mirror' && (
                    <mesh position={[0, 0, 0.24]} material={materials.mirror}>
                      <boxGeometry args={[0.82, 0.72, 0.02]} />
                    </mesh>
                  )}
                </>
              ) : null}
              <Glyph
                text={
                  piece.kind === 'opaque'
                    ? node?.kind === 'opaque' && node.label.startsWith('(?<!')
                      ? '?<!'
                      : '?<='
                    : (piece.label ?? '')
                }
                position={[0, piece.kind === 'gate' ? 0.75 : 0, piece.kind === 'gate' ? 0.355 : 0.28]}
                color={piece.kind === 'opaque' ? '#efe6d7' : '#34372f'}
                size={piece.kind === 'gate' && (piece.label?.length ?? 0) > 7 ? 0.19 : 0.29}
                width={2}
              />
            </group>
          );
        })}
    </group>
  );
}
