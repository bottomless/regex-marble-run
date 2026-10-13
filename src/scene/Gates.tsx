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
import { highlightStore, nodesWithin, spanForNode, useHighlight } from '../ui/highlight.ts';
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
  onPieceHover,
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
  onPieceHover?: (piece: Piece | null) => void;
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
      onPointerMove={
        onPieceHover
          ? (event) => {
              event.stopPropagation();
              const piece = event.instanceId === undefined ? null : (pieces[event.instanceId] ?? null);
              onPieceHover(piece);
            }
          : undefined
      }
      onPointerOut={onPieceHover ? () => onPieceHover(null) : undefined}
    />
  );
}

export type PieceHighlight = Map<number, 'hover' | 'active'>;

/** Pieces whose source span falls inside the hovered pattern span or the span being played. */
export function usePieceHighlight(program: Program): PieceHighlight {
  const { hover, active } = useHighlight();
  return useMemo(() => {
    const lit: PieceHighlight = new Map();
    for (const id of nodesWithin(program, active)) lit.set(id, 'active');
    for (const id of nodesWithin(program, hover)) lit.set(id, 'hover');
    return lit;
  }, [program, hover, active]);
}

export function hoverPiece(program: Program, piece: Piece | null): void {
  highlightStore.getState().setHover(piece ? spanForNode(program, piece.node) : null);
}

const HOVER_TINT = '#a8c1ff';
const ACTIVE_TINT = '#ffbf9e';

export function highlightTint(lit: PieceHighlight): (piece: Piece) => ColorRepresentation {
  return (piece) => {
    const tone = piece.node === null ? undefined : lit.get(piece.node);
    return tone === 'hover' ? HOVER_TINT : tone === 'active' ? ACTIVE_TINT : '#ffffff';
  };
}

export default function Gates({
  machine,
  materials,
  program,
  emphasis = 1,
}: {
  machine: MachineLayout;
  materials: Materials;
  program: Program;
  /** Uniform scale for the lettered tiles, so captions stay legible when a big machine is shrunk to fit. */
  emphasis?: number;
}) {
  const gates = useMemo(() => machine.pieces.filter((piece) => piece.kind === 'gate'), [machine]);
  const sensors = useMemo(
    () => machine.pieces.filter((piece) => piece.kind === 'sensor' || piece.kind === 'scout'),
    [machine],
  );
  const lit = usePieceHighlight(program);
  const litMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: '#f0c96a',
        metalness: 0.55,
        roughness: 0.35,
        emissive: '#6b4d12',
        emissiveIntensity: 0.35,
      }),
    [],
  );
  useEffect(() => () => litMaterial.dispose(), [litMaterial]);
  const bulbs = useMemo(() => sensors.filter((piece) => piece.kind === 'sensor'), [sensors]);
  const geometry = useMemo(
    () => ({
      post: new BoxGeometry(0.14, 0.86, 0.3),
      arch: new TorusGeometry(0.4, 0.05, 6, 18, Math.PI),
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
        material={materials.tracks.edge}
        offset={[-0.5, -0.32, 0.1]}
      />
      <Hardware
        pieces={gates}
        geometry={geometry.post}
        material={materials.tracks.edge}
        offset={[0.5, -0.32, 0.1]}
      />
      <Hardware
        pieces={gates}
        geometry={geometry.arch}
        material={materials.brass}
        offset={[0, 0.12, 0.15]}
        color={highlightTint(lit)}
        onPieceHover={(piece) => hoverPiece(program, piece)}
      />
      <Hardware
        pieces={sensors}
        geometry={geometry.sensor}
        material={materials.brass}
        rotation={[Math.PI / 2, 0, 0]}
        color={highlightTint(lit)}
        onPieceHover={(piece) => hoverPiece(program, piece)}
        receiveShadow={false}
      />
      <Hardware
        pieces={sensors}
        geometry={geometry.disc}
        material={sensorMaterials.disc}
        offset={[0, 0, 0.12]}
        rotation={[Math.PI / 2, 0, 0]}
        color={(piece) => {
          const tone = piece.node === null ? undefined : lit.get(piece.node);
          if (tone === 'hover') return HOVER_TINT;
          if (tone === 'active') return ACTIVE_TINT;
          return piece.kind === 'scout' ? '#84afa1' : '#dabd72';
        }}
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
          const pieceLit = piece.node !== null && lit.has(piece.node);
          const labelLength = [...(piece.label ?? '')].length;
          const tileWidth = Math.max(1.4, Math.min(2.2, labelLength * 0.17 + 0.6));
          const glyphSize =
            piece.kind === 'gate'
              ? labelLength <= 2
                ? 0.56
                : labelLength <= 4
                  ? 0.44
                  : labelLength <= 7
                    ? 0.32
                    : 0.24
              : sensor
                ? 0.4
                : 0.29;
          return (
            <group
              key={i}
              position={[p.x, p.y, p.z]}
              scale={piece.kind === 'gate' || sensor ? emphasis : 1}
              onPointerMove={(event) => {
                event.stopPropagation();
                hoverPiece(program, piece);
              }}
              onPointerOut={() => hoverPiece(program, null)}
            >
              {piece.kind === 'gate' ? (
                <>
                  <mesh
                    position={[0, 0, -0.34]}
                    material={pieceLit ? litMaterial : materials.tile}
                    castShadow
                    receiveShadow
                  >
                    <boxGeometry args={[tileWidth, 1.5, 0.14]} />
                  </mesh>
                  <mesh position={[0, 0, -0.42]} material={materials.ink}>
                    <boxGeometry args={[tileWidth + 0.08, 1.58, 0.02]} />
                  </mesh>
                  <mesh
                    position={[0, 0.98, 0.3]}
                    material={pieceLit ? litMaterial : materials.tile}
                    castShadow
                  >
                    <boxGeometry args={[tileWidth, 0.8, 0.12]} />
                  </mesh>
                  {[-1, 1].map((side) => (
                    <mesh
                      key={side}
                      position={[side * (tileWidth / 2 - 0.09), 0.1, 0.3]}
                      material={pieceLit ? litMaterial : materials.tile}
                      castShadow
                    >
                      <boxGeometry args={[0.18, 0.96, 0.12]} />
                    </mesh>
                  ))}
                </>
              ) : !sensor ? (
                <>
                  <mesh
                    material={pieceLit ? litMaterial : piece.kind === 'opaque' ? materials.ink : materials.brass}
                    castShadow
                  >
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
                position={[0, piece.kind === 'gate' ? 0.98 : 0, piece.kind === 'gate' ? 0.37 : 0.28]}
                color={piece.kind === 'opaque' ? '#efe6d7' : '#2a2520'}
                size={glyphSize}
                width={piece.kind === 'gate' ? tileWidth - 0.2 : 2}
              />
            </group>
          );
        })}
    </group>
  );
}
