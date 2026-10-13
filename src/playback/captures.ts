import type { NodeId, Program } from '../engine/ir.ts';
import type { CaptureSpan, MachineState } from './state.ts';
import { palette } from '../scene/materials.ts';

export interface CaptureBracket {
  group: number;
  name: string | null;
  start: number;
  end: number;
  color: string;
}

/** Live group brackets above the tile rail: every set capture except the whole match. */
export function captureBrackets(program: Program, state: MachineState | null): CaptureBracket[] {
  if (!state) return [];
  const brackets: CaptureBracket[] = [];
  for (let group = 1; group < state.captures.length; group++) {
    const span = state.captures[group];
    if (!span) continue;
    brackets.push({
      group,
      name: program.groupNames[group] ?? null,
      start: span.start,
      end: span.end,
      color: palette.captures[(group - 1) % palette.captures.length],
    });
  }
  return brackets;
}

export function captureSpans(state: MachineState | null): (CaptureSpan | null)[] {
  return state ? state.captures.map((span) => (span === null ? null : { ...span })) : [];
}

const MIRROR_MAX = 12;

/** The text a mirror gate currently shows: the first set group its backreference can resolve to. */
export function mirrorText(program: Program, state: MachineState | null, input: string, node: NodeId): string {
  const backref = program.nodes[node];
  if (!state || !backref || backref.kind !== 'backref') return '';
  for (const group of backref.groups) {
    const span = state.captures[group];
    if (!span) continue;
    const text = input.slice(span.start, span.end);
    return text.length > MIRROR_MAX ? `${text.slice(0, MIRROR_MAX)}…` : text;
  }
  return '';
}

export function mirrorFaces(
  program: Program,
  state: MachineState | null,
  input: string,
  nodes: NodeId[],
): { node: NodeId; text: string }[] {
  return nodes.map((node) => ({ node, text: mirrorText(program, state, input, node) }));
}

/** The finish celebration span: the match, and only once the run has matched. */
export function matchSpan(state: MachineState | null): CaptureSpan | null {
  if (!state || state.phase !== 'matched' || !state.match) return null;
  return { ...state.match };
}
