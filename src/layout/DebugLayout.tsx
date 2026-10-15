import type { MachineLayout, Piece, PieceKind, Vec3 } from './pieces.ts';
import { parsePattern } from '../engine/parse.ts';
import { layout } from './layout.ts';

export interface Point2 {
  x: number;
  y: number;
}

export function project(v: Vec3): Point2 {
  return { x: v.x, y: -v.y };
}

export function pieceColor(kind: PieceKind): string {
  switch (kind) {
    case 'track':
      return '#8a8f98';
    case 'gate':
      return '#4f8ef7';
    case 'sensor':
      return '#f7b84f';
    case 'mirror':
      return '#9b6ef7';
    case 'opaque':
      return '#6b7280';
    case 'diverter':
      return '#f75f5f';
    case 'funnel':
      return '#f78f4f';
    case 'loopLift':
    case 'backLift':
      return '#3fbf7f';
    case 'bypassChute':
    case 'returnRail':
      return '#2fa39a';
    case 'groupFrame':
      return '#b0875a';
    case 'scout':
      return '#c95fb8';
    case 'hopper':
      return '#5aa9e6';
    case 'cup':
      return '#7ac74f';
    case 'rejectChute':
    case 'rejectTray':
      return '#d94848';
    case 'module':
      return '#a0a4ab';
  }
}

export function layoutViewBox(machine: MachineLayout, pad = 1): string {
  const min = project({ x: machine.bounds.min.x, y: machine.bounds.max.y, z: 0 });
  const max = project({ x: machine.bounds.max.x, y: machine.bounds.min.y, z: 0 });
  const width = Math.max(1, max.x - min.x + pad * 2);
  const height = Math.max(1, max.y - min.y + pad * 2);
  return `${min.x - pad} ${min.y - pad} ${width} ${height}`;
}

export function pieceShape(
  piece: Piece,
): { tag: 'path'; d: string } | { tag: 'rect'; x: number; y: number; w: number; h: number } {
  if (
    ['track', 'loopLift', 'backLift', 'returnRail', 'bypassChute', 'rejectChute'].includes(piece.kind) &&
    piece.points &&
    piece.points.length >= 2
  ) {
    const pts = piece.points.map(project);
    const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ');
    return { tag: 'path', d };
  }
  const c = project(piece.position);
  const w = Math.max(0.2, piece.size.x);
  const h = Math.max(0.2, piece.size.y);
  return { tag: 'rect', x: c.x - w / 2, y: c.y - h / 2, w, h };
}

export function buildDebugLayout(pattern: string, flags = ''): MachineLayout {
  return layout(parsePattern(pattern, flags));
}

export default function DebugLayout({ pattern, flags = '' }: { pattern: string; flags?: string }) {
  let machine: MachineLayout;
  try {
    machine = buildDebugLayout(pattern, flags);
  } catch (e) {
    return (
      <div className="debug-layout">
        <div className="debug-error">
          {pattern}: {e instanceof Error ? e.message : String(e)}
        </div>
      </div>
    );
  }
  const viewBox = layoutViewBox(machine);
  return (
    <div className="debug-layout">
      <div className="debug-header">
        layout: {pattern} ({machine.pieces.length} pieces, {machine.graph.edges.length} edges)
      </div>
      <svg className="debug-svg" viewBox={viewBox} role="img" aria-label={`layout for ${pattern}`}>
        {machine.graph.edges.map((edge, i) => {
          const a = project(machine.graph.points[edge.from].position);
          const b = project(machine.graph.points[edge.to].position);
          return <line key={`e${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="debug-edge" />;
        })}
        {machine.pieces.map((piece, i) => {
          const shape = pieceShape(piece);
          const fill = pieceColor(piece.kind);
          const label = piece.label ?? piece.kind;
          const c = project(piece.position);
          return (
            <g key={`p${i}`}>
              {shape.tag === 'path' ? (
                <path d={shape.d} fill="none" stroke={fill} strokeWidth={0.15} />
              ) : (
                <rect
                  x={shape.x}
                  y={shape.y}
                  width={shape.w}
                  height={shape.h}
                  fill={fill}
                  fillOpacity={0.35}
                  stroke={fill}
                  strokeWidth={0.08}
                />
              )}
              <text x={c.x} y={c.y} className="debug-label">
                {label}
              </text>
            </g>
          );
        })}
        {machine.graph.points.map((point) => {
          const p = project(point.position);
          return <circle key={`t${point.id}`} cx={p.x} cy={p.y} r={0.08} className="debug-point" />;
        })}
      </svg>
    </div>
  );
}
