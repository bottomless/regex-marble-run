import { useEffect, useMemo } from 'react';
import { RoundedBox } from '@react-three/drei';
import { BoxGeometry, CylinderGeometry, SphereGeometry, TorusGeometry, Vector2 } from 'three';
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

function Bowl({
  piece,
  materials,
  hideSample = false,
}: {
  piece: Piece;
  materials: Materials;
  hideSample?: boolean;
}) {
  const p = piece.position;
  const profile = useMemo(
    () => [
      new Vector2(0.22, -0.48),
      new Vector2(0.28, -0.34),
      new Vector2(0.76, 0.14),
      new Vector2(0.92, 0.36),
      new Vector2(0.98, 0.42),
      new Vector2(1.02, 0.36),
      new Vector2(0.84, 0.05),
      new Vector2(0.32, -0.42),
      new Vector2(0.26, -0.5),
    ],
    [],
  );
  return (
    <group position={[p.x, p.y, p.z]}>
      <mesh material={materials.brass} castShadow receiveShadow>
        <latheGeometry args={[profile, 32]} />
      </mesh>
      <mesh position={[0, 0.39, 0]} rotation={[Math.PI / 2, 0, 0]} material={materials.tracks.edge}>
        <torusGeometry args={[0.98, 0.055, 8, 32]} />
      </mesh>
      {!hideSample && (
        <mesh position={[0, 0.66, 0.09]} material={materials.marble} castShadow>
          <sphereGeometry args={[0.24, 24, 16]} />
        </mesh>
      )}
      <Glyph text={copy.scene.inlet} position={[0, -0.34, 0.92]} size={0.18} width={1.1} />
    </group>
  );
}

function SuccessContainer({ piece, materials }: { piece: Piece; materials: Materials }) {
  const p = piece.position;
  return (
    <group position={[p.x, p.y - 0.12, p.z]}>
      <RoundedBox
        args={[2.38, 0.18, 1.48]}
        radius={0.05}
        smoothness={2}
        position={[0, -0.18, 0]}
        material={materials.tracks.edge}
        castShadow
        receiveShadow
      />
      <mesh position={[0, -0.06, 0]} material={materials.tracks.teal} receiveShadow>
        <boxGeometry args={[2.16, 0.08, 1.26]} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh
          key={`wall-z-${side}`}
          position={[0, 0.12, side * 0.65]}
          material={materials.tracks.teal}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[2.28, 0.36, 0.08]} />
        </mesh>
      ))}
      {[-1, 1].map((side) => (
        <mesh
          key={`wall-x-${side}`}
          position={[side * 1.1, 0.12, 0]}
          material={materials.tracks.teal}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[0.08, 0.36, 1.38]} />
        </mesh>
      ))}
      {[-1, 1].map((side) => (
        <mesh key={`rim-z-${side}`} position={[0, 0.32, side * 0.65]} material={materials.brass} castShadow>
          <boxGeometry args={[2.36, 0.07, 0.12]} />
        </mesh>
      ))}
      {[-1, 1].map((side) => (
        <mesh key={`rim-x-${side}`} position={[side * 1.1, 0.32, 0]} material={materials.brass} castShadow>
          <boxGeometry args={[0.12, 0.07, 1.42]} />
        </mesh>
      ))}
      {[-1, 1].flatMap((sx) =>
        [-1, 1].map((sz) => (
          <group key={`post-${sx}-${sz}`} position={[sx * 1.1, 0.16, sz * 0.65]}>
            <mesh material={materials.brass} castShadow>
              <cylinderGeometry args={[0.07, 0.07, 0.44, 16]} />
            </mesh>
            <mesh position={[0, 0.25, 0]} material={materials.brass} castShadow>
              <sphereGeometry args={[0.09, 14, 10]} />
            </mesh>
          </group>
        )),
      )}
      <mesh position={[0, 0.1, 0.72]} material={materials.brass} castShadow>
        <boxGeometry args={[1.86, 0.32, 0.05]} />
      </mesh>
      <mesh position={[0, 0.1, 0.745]} material={materials.ink}>
        <boxGeometry args={[1.76, 0.24, 0.03]} />
      </mesh>
      <Glyph
        text={`✓ ${copy.scene.match}`}
        position={[0, 0.1, 0.77]}
        size={0.17}
        width={1.68}
        color="#f6d379"
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
  hideSample = false,
}: {
  machine: MachineLayout;
  program: Program;
  materials: Materials;
  onExpand: (id: number) => void;
  animatedChoices?: boolean;
  hideSample?: boolean;
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
      funnel: new CylinderGeometry(0.54, 0.22, 0.32, 24),
      funnelRim: new TorusGeometry(0.54, 0.045, 8, 24),
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
            pieces={batch.funnels}
            geometry={geometry.funnelRim}
            material={materials.brass}
            offset={[0, 0, 0.14]}
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
          if (piece.kind === 'hopper')
            return <Bowl key={i} piece={piece} materials={materials} hideSample={hideSample} />;
          if (piece.kind === 'cup')
            return <SuccessContainer key={i} piece={piece} materials={materials} />;
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
                <mesh material={materials.tracks.edge} castShadow receiveShadow>
                  <boxGeometry args={[2.1, 0.22, 1.36]} />
                </mesh>
                {[-1, 1].map((side) => (
                  <mesh key={`rx-${side}`} position={[side * 1.01, 0.18, 0]} material={materials.tracks.vermilion} castShadow>
                    <boxGeometry args={[0.08, 0.32, 1.36]} />
                  </mesh>
                ))}
                {[-1, 1].map((side) => (
                  <mesh key={`rz-${side}`} position={[0, 0.18, side * 0.64]} material={materials.tracks.vermilion} castShadow>
                    <boxGeometry args={[2.1, 0.32, 0.08]} />
                  </mesh>
                ))}
                <Glyph text={copy.scene.reject} position={[0, 0.14, 0.72]} size={0.17} width={1.7} color="#f6f0e5" />
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
