import { useEffect, useId, useMemo, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { Program } from '../engine/ir.ts';
import type { MachineLayout, Piece } from '../layout/pieces.ts';
import { copy } from '../copy.ts';
import { highlightStore, spanForNode } from './highlight.ts';

export interface MachinePart {
  key: string;
  node: number | null;
  label: string;
}

const LISTED: ReadonlySet<Piece['kind']> = new Set([
  'gate',
  'sensor',
  'mirror',
  'opaque',
  'scout',
  'diverter',
  'groupFrame',
  'module',
]);

/** Keyboard-reachable catalogue of the pieces a machine is built from, in source order. */
export function machineParts(machine: MachineLayout, program: Program): MachinePart[] {
  const parts: MachinePart[] = [];
  const seen = new Set<string>();
  for (const piece of machine.pieces) {
    if (!LISTED.has(piece.kind) || piece.node === null) continue;
    const key = `${piece.kind}:${piece.node}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const node = program.nodes[piece.node];
    const span = spanForNode(program, piece.node);
    const source = span ? program.source.slice(span[0], span[1]) : '';
    let label: string;
    switch (piece.kind) {
      case 'gate':
        label = copy.parts.gate(piece.label ?? source);
        break;
      case 'sensor':
        label = copy.parts.sensor(piece.label ?? source);
        break;
      case 'mirror':
        label = copy.parts.mirror(piece.label ?? source);
        break;
      case 'opaque':
        label = copy.parts.lookbehind(source);
        break;
      case 'scout':
        label = copy.parts.scout(source);
        break;
      case 'diverter':
        label =
          node?.kind === 'repeat'
            ? copy.parts.loop(source, node.greedy)
            : copy.parts.diverter(source);
        break;
      case 'groupFrame':
        label = copy.parts.group(piece.label ?? source);
        break;
      default:
        label = copy.parts.module(piece.label ?? source);
    }
    parts.push({ key, node: piece.node, label });
  }
  parts.sort((a, b) => {
    const sa = spanForNode(program, a.node);
    const sb = spanForNode(program, b.node);
    return (sa?.[0] ?? 0) - (sb?.[0] ?? 0) || (sb?.[1] ?? 0) - (sa?.[1] ?? 0);
  });
  return parts;
}

export default function MachineParts({ machine, program }: { machine: MachineLayout; program: Program }) {
  const parts = useMemo(() => machineParts(machine, program), [machine, program]);
  const [index, setIndex] = useState(0);
  const [focused, setFocused] = useState(false);
  const id = useId();
  const current = Math.min(index, Math.max(0, parts.length - 1));

  useEffect(() => {
    if (!focused) return;
    highlightStore.getState().setHover(spanForNode(program, parts[current]?.node ?? null));
    return () => highlightStore.getState().setHover(null);
  }, [focused, current, parts, program]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (parts.length === 0) return;
    let next = current;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        next = (current + 1) % parts.length;
        break;
      case 'ArrowUp':
      case 'ArrowLeft':
        next = (current - 1 + parts.length) % parts.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = parts.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    setIndex(next);
  }

  if (parts.length === 0) return null;
  return (
    <div
      className="machine-parts"
      role="listbox"
      aria-label={copy.parts.label}
      aria-activedescendant={`${id}-${parts[current].key}`}
      tabIndex={0}
      data-focused={focused}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onKeyDown={onKeyDown}
    >
      {parts.map((part, i) => (
        <div
          key={part.key}
          id={`${id}-${part.key}`}
          role="option"
          aria-selected={i === current}
          onMouseDown={(event) => {
            event.preventDefault();
            setIndex(i);
            event.currentTarget.parentElement?.focus();
          }}
        >
          {part.label}
        </div>
      ))}
    </div>
  );
}
