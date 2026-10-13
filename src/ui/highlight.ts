import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import type { NodeId, Program, Span } from '../engine/ir.ts';

export interface HighlightState {
  /** Span under the pointer, either on a machine piece or on the pattern text. */
  hover: Span | null;
  /** Span of the node the marble is currently working through. */
  active: Span | null;
  setHover(span: Span | null): void;
  setActive(span: Span | null): void;
}

function sameSpan(a: Span | null, b: Span | null): boolean {
  if (a === null || b === null) return a === b;
  return a[0] === b[0] && a[1] === b[1];
}

export const highlightStore = createStore<HighlightState>()((set) => ({
  hover: null,
  active: null,
  setHover: (hover) => set((s) => (sameSpan(s.hover, hover) ? s : { hover })),
  setActive: (active) => set((s) => (sameSpan(s.active, active) ? s : { active })),
}));

export function useHighlight(): HighlightState {
  return useStore(highlightStore);
}

/** The innermost IR node whose span covers `index` (the node a hovered pattern character belongs to). */
export function nodeAtIndex(program: Program, index: number): number | null {
  let best: number | null = null;
  let bestSize = Infinity;
  for (const node of program.nodes) {
    const [start, end] = node.span;
    if (index < start || index >= end) continue;
    const size = end - start;
    if (size < bestSize) {
      best = node.id;
      bestSize = size;
    }
  }
  return best;
}

export function spanForNode(program: Program, node: NodeId | null): Span | null {
  if (node === null) return null;
  return program.nodes[node]?.span ?? null;
}

/** All node ids whose span sits inside `span`; used to light every piece a hovered source span covers. */
export function nodesWithin(program: Program, span: Span | null): Set<NodeId> {
  const found = new Set<NodeId>();
  if (!span) return found;
  for (const node of program.nodes) {
    if (node.span[0] >= span[0] && node.span[1] <= span[1]) found.add(node.id);
  }
  return found;
}

export type HighlightTone = 'hover' | 'active';

export interface PatternSegment {
  text: string;
  tone: HighlightTone | null;
}

/**
 * Splits the pattern source into plain and marked runs for the pattern-capsule backdrop.
 * Hover wins over the active span where the two overlap.
 */
export function segmentPattern(
  source: string,
  hover: Span | null,
  active: Span | null,
): PatternSegment[] {
  const marks: (HighlightTone | null)[] = new Array<HighlightTone | null>(source.length).fill(null);
  const paint = (span: Span | null, tone: HighlightTone) => {
    if (!span) return;
    const start = Math.max(0, Math.min(span[0], source.length));
    const end = Math.max(start, Math.min(span[1], source.length));
    for (let i = start; i < end; i++) marks[i] = tone;
  };
  paint(active, 'active');
  paint(hover, 'hover');
  const segments: PatternSegment[] = [];
  let i = 0;
  while (i < source.length) {
    let j = i + 1;
    while (j < source.length && marks[j] === marks[i]) j++;
    segments.push({ text: source.slice(i, j), tone: marks[i] });
    i = j;
  }
  return segments;
}
