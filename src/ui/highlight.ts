import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import type { NodeId, Program, Span } from '../engine/ir.ts';
import type { CaptureSpan, PlaybackPhase } from '../playback/state.ts';
import type { ResultReading } from '../copy.ts';
import { sameOutcome } from '../playback/outcome.ts';

/** Where the playback stands on the test string: enough to paint the string field like the old tile rail. */
export interface InputReading {
  phase: PlaybackPhase;
  attemptStart: number;
  head: number;
  match: CaptureSpan | null;
  captures: (CaptureSpan | null)[];
}

export interface HighlightState {
  /** Span under the pointer, either on a machine piece or on the pattern text. */
  hover: Span | null;
  /** Span of the node the marble is currently working through. */
  active: Span | null;
  /** Playback position on the test string, mirrored from the scene's playback store. */
  reading: InputReading | null;
  /** The run's verdict, once playback has finished; drives the string field's stamp. */
  verdict: ResultReading;
  setHover(span: Span | null): void;
  setActive(span: Span | null): void;
  setReading(reading: InputReading | null): void;
  setVerdict(verdict: ResultReading): void;
}

function sameSpan(a: Span | null, b: Span | null): boolean {
  if (a === null || b === null) return a === b;
  return a[0] === b[0] && a[1] === b[1];
}

function sameCapture(a: CaptureSpan | null, b: CaptureSpan | null): boolean {
  if (a === null || b === null) return a === b;
  return a.start === b.start && a.end === b.end;
}

function sameReading(a: InputReading | null, b: InputReading | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.phase === b.phase &&
    a.attemptStart === b.attemptStart &&
    a.head === b.head &&
    sameCapture(a.match, b.match) &&
    a.captures.length === b.captures.length &&
    a.captures.every((span, i) => sameCapture(span, b.captures[i]))
  );
}

export const highlightStore = createStore<HighlightState>()((set) => ({
  hover: null,
  active: null,
  reading: null,
  verdict: { kind: 'pending' },
  setHover: (hover) => set((s) => (sameSpan(s.hover, hover) ? s : { hover })),
  setActive: (active) => set((s) => (sameSpan(s.active, active) ? s : { active })),
  setReading: (reading) => set((s) => (sameReading(s.reading, reading) ? s : { reading })),
  setVerdict: (verdict) => set((s) => (sameOutcome(s.verdict, verdict) ? s : { verdict })),
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
export function segmentPattern(source: string, hover: Span | null, active: Span | null): PatternSegment[] {
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

/**
 * How one test-string character reads at the current playback moment:
 * - `tried`: an earlier attempt started here and failed, so no match can begin at it any more;
 * - `read`: claimed by the live attempt (between its start and the read head);
 * - `head`: the character the read head is testing next;
 * - `match`: inside the final match.
 */
export type InputTone = 'tried' | 'read' | 'head' | 'match';

export interface InputSegment {
  text: string;
  tone: InputTone | null;
  /** Innermost capture group (1-based) covering the run, or null. */
  group: number | null;
}

function inputTone(reading: InputReading, index: number): InputTone | null {
  const { phase, attemptStart, head, match } = reading;
  if (phase === 'idle' || attemptStart < 0) return null;
  if (phase === 'matched' && match) {
    if (index >= match.start && index < match.end) return 'match';
    return index < match.start ? 'tried' : null;
  }
  if (phase === 'nomatch') return 'tried';
  if (index < attemptStart) return 'tried';
  if (index === head) return 'head';
  return index < head ? 'read' : null;
}

function innermostGroup(reading: InputReading, index: number): number | null {
  if (reading.phase === 'nomatch') return null;
  let best: number | null = null;
  let bestSize = Infinity;
  for (let group = 1; group < reading.captures.length; group++) {
    const span = reading.captures[group];
    if (!span || index < span.start || index >= span.end) continue;
    const size = span.end - span.start;
    if (size <= bestSize) {
      best = group;
      bestSize = size;
    }
  }
  return best;
}

/**
 * Splits the test string into runs for the string-field backdrop. The returned runs cover
 * `input.length + 1` positions: the extra trailing run (a single space) stands for the end of the
 * string so the read head stays visible when it sits past the last character.
 */
export function segmentInput(input: string, reading: InputReading | null): InputSegment[] {
  const text = `${input} `;
  const tones: (InputTone | null)[] = [];
  const groups: (number | null)[] = [];
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const prev = i > 0 ? text.charCodeAt(i - 1) : 0;
    if (code >= 0xdc00 && code <= 0xdfff && prev >= 0xd800 && prev <= 0xdbff) {
      tones.push(tones[i - 1]);
      groups.push(groups[i - 1]);
      continue;
    }
    const tone = reading ? inputTone(reading, i) : null;
    tones.push(i === input.length && tone !== 'head' ? null : tone);
    groups.push(reading && i < input.length ? innermostGroup(reading, i) : null);
  }
  const segments: InputSegment[] = [];
  let i = 0;
  while (i < text.length) {
    let j = i + 1;
    while (j < text.length && tones[j] === tones[i] && groups[j] === groups[i] && j !== input.length) j++;
    segments.push({ text: text.slice(i, j), tone: tones[i], group: groups[i] });
    i = j;
  }
  return segments;
}
