import { useEffect, useMemo } from 'react';
import { RoundedBox } from '@react-three/drei';
import { BoxGeometry, CylinderGeometry, SphereGeometry, Vector2 } from 'three';
import type { Program } from '../engine/ir.ts';
import type { MachineLayout, Piece } from '../layout/pieces.ts';
import { roleFinish } from './geometry.ts';
import type { TrackFinish } from './geometry.ts';
import { Hardware, highlightTint, hoverPiece, usePieceHighlight } from './Gates.tsx';
import { palette } from './materials.ts';
import type { Materials } from './materials.ts';
import Glyph from './Glyph.tsx';
import { copy } from '../copy.ts';

function CaptureFrame({ piece, onHover }: { piece: Piece; onHover?: (piece: Piece | null) => void }) {
  const p = piece.position;
  const w = piece.size.x;
  const h = piece.size.y;
  const color = palette.captures[(piece.node ?? 0) % palette.captures.length];
  return (
    <group
      position={[p.x, p.y, p.z]}
      onPointerMove={
        onHover
          ? (event) => {
              event.stopPropagation();
              onHover(piece);
            }
          : undefined
      }
      onPointerOut={onHover ? () => onHover(null) : undefined}
    >
      {[-1, 1].map((side) => (
        <group key={side}>
          <mesh position={[(side * w) / 2, 0, 0]}>
            <boxGeometry args={[0.14, h + 0.14, 0.14]} />
            <meshStandardMaterial color={color} roughness={0.45} metalness={0.25} />
          </mesh>
          <mesh position={[0, (side * h) / 2, 0]}>
            <boxGeometry args={[w + 0.14, 0.14, 0.14]} />
            <meshStandardMaterial color={color} roughness={0.45} metalness={0.25} />
          </mesh>
        </group>
      ))}
      <mesh position={[-w / 2 + 0.45, h / 2 + 0.08, 0.06]}>
        <boxGeometry args={[0.9, 0.5, 0.14]} />
        <meshStandardMaterial color={color} roughness={0.5} />
      </mesh>
      <Glyph
        text={piece.label ?? ''}
        position={[-w / 2 + 0.45, h / 2 + 0.08, 0.14]}
        size={0.26}
        width={0.85}
        color="#f6f0e5"
      />
    </group>
  );
}

function Bowl({ piece, materials }: { piece: Piece; materials: Materials }) {
  const p = piece.position;
  const hopper = piece.kind === 'hopper';
  const profile = useMemo(
    () => [
      new Vector2(0.18, -0.48),
      new Vector2(0.22, -0.35),
      new Vector2(0.64, 0.14),
      new Vector2(0.74, 0.33),
      new Vector2(0.78, 0.37),
      new Vector2(0.82, 0.33),
      new Vector2(0.7, 0.05),
      new Vector2(0.27, -0.42),
      new Vector2(0.23, -0.5),
    ],
    [],
  );
  return (
    <group position={[p.x, p.y, p.z]}>
      <mesh material={hopper ? materials.brass : materials.tracks.teal} castShadow>
        <latheGeometry args={[profile, 32]} />
      </mesh>
      <mesh position={[0, 0.34, 0]} rotation={[Math.PI / 2, 0, 0]} material={materials.brass}>
        <torusGeometry args={[0.8, 0.045, 8, 32]} />
      </mesh>
      {hopper && (
        <mesh position={[0, 0.66, 0.09]} material={materials.marble} castShadow>
          <sphereGeometry args={[0.24, 24, 16]} />
        </mesh>
      )}
      <Glyph
        text={hopper ? copy.scene.inlet : copy.scene.match}
        position={[0, -0.38, 0.78]}
        size={0.18}
        width={1}
      />
    </group>
  );
}

export default function Pieces({
  machine,
  program,
  materials,
  onExpand,
  animatedChoices = false,
}: {
  machine: MachineLayout;
  program: Program;
  materials: Materials;
  onExpand: (id: number) => void;
  animatedChoices?: boolean;
}) {
  const lit = usePieceHighlight(program);
  const hardware = useMemo(() => {
    const controls = machine.pieces.filter((piece) => piece.kind === 'diverter' || piece.kind === 'funnel');
    const diverters = controls.filter((piece) => piece.kind === 'diverter');
    const buckets = new Map<TrackFinish, { diverters: Piece[]; funnels: Piece[] }>();
    for (const piece of controls) {
      const finish = roleFinish(piece);
      const bucket = buckets.get(finish) ?? { diverters: [], funnels: [] };
      bucket[piece.kind === 'diverter' ? 'diverters' : 'funnels'].push(piece);
      buckets.set(finish, bucket);
    }
    const staticLever = (piece: Piece) => {
      if (!animatedChoices || piece.node === null) return true;
      const kind = program.nodes[piece.node]?.kind;
      return kind !== 'alt' && kind !== 'repeat';
    };
    return {
      controls,
      diverters: diverters.filter(staticLever),
      batches: [...buckets].map(([finish, pieces]) => ({
        finish,
        ...pieces,
        handles: pieces.diverters.filter(staticLever),
      })),
    };
  }, [machine, program, animatedChoices]);
  const geometry = useMemo(
    () => ({
      diverter: new CylinderGeometry(0.52, 0.52, 0.24, 24),
      housing: new BoxGeometry(1.4, 1.0, 0.14),
      funnel: new CylinderGeometry(0.48, 0.18, 0.24, 24),
      button: new CylinderGeometry(0.33, 0.33, 0.045, 24),
      lever: new BoxGeometry(0.28, 0.06, 0.1),
      handle: new SphereGeometry(0.12, 12, 8),
    }),
    [],
  );
  useEffect(() => () => Object.values(geometry).forEach((item) => item.dispose()), [geometry]);
  return (
    <group>
      {hardware.batches.map((batch) => (
        <group key={batch.finish}>
          <Hardware
            pieces={batch.diverters}
            geometry={geometry.housing}
            material={materials.tracks[batch.finish]}
            offset={[0, 0, -0.34]}
          />
          <Hardware
            pieces={batch.diverters}
            geometry={geometry.diverter}
            material={materials.tracks[batch.finish]}
            rotation={[Math.PI / 2, 0, 0]}
            receiveShadow={false}
          />
          <Hardware
            pieces={batch.funnels}
            geometry={geometry.funnel}
            material={materials.tracks[batch.finish]}
            rotation={[Math.PI / 2, 0, 0]}
            receiveShadow={false}
          />
          <Hardware
            pieces={batch.handles}
            geometry={geometry.handle}
            material={materials.tracks[batch.finish]}
            offset={[0.82, 0, 0.08]}
            castShadow={false}
            receiveShadow={false}
          />
        </group>
      ))}
      <Hardware
        pieces={hardware.controls}
        geometry={geometry.button}
        material={materials.brass}
        offset={[0, 0, 0.16]}
        rotation={[Math.PI / 2, 0, 0]}
        color={highlightTint(lit)}
        onPieceHover={(piece) => hoverPiece(program, piece)}
        castShadow={false}
        receiveShadow={false}
      />
      <Hardware
        pieces={hardware.diverters}
        geometry={geometry.lever}
        material={materials.brass}
        offset={[0.68, 0, 0.08]}
        receiveShadow={false}
      />
      {machine.pieces
        .filter((piece) =>
          ['diverter', 'funnel', 'groupFrame', 'hopper', 'cup', 'rejectTray', 'module'].includes(piece.kind),
        )
        .map((piece, i) => {
          const p = piece.position;
          if (piece.kind === 'groupFrame')
            return <CaptureFrame key={i} piece={piece} onHover={(hovered) => hoverPiece(program, hovered)} />;
          if (piece.kind === 'hopper' || piece.kind === 'cup')
            return <Bowl key={i} piece={piece} materials={materials} />;
          if (piece.kind === 'module')
            return (
              <group
                key={i}
                position={[p.x, p.y, p.z]}
                onClick={(event) => {
                  event.stopPropagation();
                  onExpand(piece.node!);
                }}
              >
                <RoundedBox
                  args={[2.1, 1.8, 0.8]}
                  radius={0.1}
                  smoothness={2}
                  material={materials.tracks.teal}
                  castShadow
                />
                <Glyph text={piece.label ?? ''} position={[0, 0.25, 0.43]} size={0.28} color="#f6f0e5" />
                <Glyph text="+" position={[0, -0.3, 0.43]} size={0.5} color="#f6f0e5" />
              </group>
            );
          if (piece.kind === 'rejectTray')
            return (
              <group key={i} position={[p.x, p.y - 0.15, p.z]}>
                <mesh material={materials.tracks.edge} castShadow>
                  <boxGeometry args={[2, 0.25, 1.3]} />
                </mesh>
                {[-1, 1].map((side) => (
                  <mesh key={side} position={[side * 0.96, 0.16, 0]} material={materials.tracks.vermilion}>
                    <boxGeometry args={[0.08, 0.3, 1.3]} />
                  </mesh>
                ))}
                <Glyph text={copy.scene.reject} position={[0, -0.04, 0.69]} size={0.18} width={1.7} />
              </group>
            );
          const node = piece.node === null ? null : program.nodes[piece.node];
          const repeat = node?.kind === 'repeat';
          const label = repeat ? `${node.min}…${node.max === Infinity ? '∞' : node.max}` : '|';
          return (
            <group key={i} position={[p.x, p.y, p.z]}>
              <Glyph
                text={piece.kind === 'funnel' ? '↓' : label}
                position={[0, 0, 0.2]}
                size={repeat ? 0.17 : 0.25}
                width={0.63}
              />
              {piece.kind === 'diverter' && repeat && (
                <Glyph text={node.greedy ? '+' : '?'} position={[-0.64, 0.05, 0.2]} size={0.18} />
              )}
            </group>
          );
        })}
    </group>
  );
}
