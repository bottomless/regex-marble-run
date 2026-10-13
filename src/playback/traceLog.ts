import type { IR, Program } from '../engine/ir.ts';
import { traceEvent, type Trace } from '../engine/trace.ts';
import { copy } from '../copy.ts';

/** Rows rendered around the playhead; earlier and later steps page in on demand. */
export const LOG_WINDOW = 200;
/** Copying is capped so a flooded run cannot freeze the tab. */
export const LOG_COPY_CAP = 20_000;

function showChars(input: string, pos: number, len: number): string {
  const raw = input.slice(pos, pos + len);
  const shown = raw
    .replace(/\n/g, '⏎')
    .replace(/\t/g, '⇥')
    .replace(/\r/g, '␍')
    .replace(/ /g, '·');
  return `"${shown}"`;
}

export function nodeLabel(program: Program, nodeId: number): string {
  const node: IR | undefined = program.nodes[nodeId];
  if (!node) return `#${nodeId}`;
  switch (node.kind) {
    case 'char':
      return node.label;
    case 'assert':
      return node.what === 'start' ? '^' : node.what === 'end' ? '$' : node.what === 'word' ? '\\b' : '\\B';
    case 'backref':
      return `\\${node.groups.join('|')}`;
    case 'opaque':
      return node.label;
    case 'group':
      return node.capture === null ? '(?:…)' : node.name ? `(${node.capture}: ${node.name})` : `(${node.capture})`;
    case 'look':
      return node.negate ? '(?!…)' : '(?=…)';
    case 'alt':
      return 'a|b';
    case 'repeat':
      return `{${node.min},${node.max === Infinity ? '' : node.max}}`;
    default:
      return node.kind;
  }
}

function captureLabel(program: Program, group: number): string {
  const name = program.groupNames[group];
  return name ? `${group} (${name})` : String(group);
}

/** One human-readable line for the trace log, e.g. `pos 3 · gate [a-z] vs "7" → rejected`. */
export function describeEvent(program: Program, input: string, trace: Trace, index: number): string {
  const event = traceEvent(trace, index);
  const log = copy.traceLog;
  switch (event.t) {
    case 'attempt':
      return log.attempt(event.start);
    case 'test': {
      const node = program.nodes[event.node];
      const label = nodeLabel(program, event.node);
      const kind = node?.kind ?? 'char';
      if (kind === 'assert') return event.ok ? log.sensorHold(event.pos, label) : log.sensorFail(event.pos, label);
      if (kind === 'backref')
        return event.ok
          ? log.mirrorPass(event.pos, label, showChars(input, event.pos, event.len))
          : log.mirrorReject(event.pos, label, showChars(input, event.pos, event.len));
      if (kind === 'opaque') return event.ok ? log.opaquePass(event.pos, label) : log.opaqueReject(event.pos, label);
      return event.ok
        ? log.gatePass(event.pos, label, showChars(input, event.pos, event.len))
        : log.gateReject(event.pos, label, showChars(input, event.pos, event.len));
    }
    case 'choose': {
      const node = program.nodes[event.node];
      if (node?.kind === 'alt') return log.branch(event.option, node.branches.length, event.pos);
      if (node?.kind === 'repeat') return log.loopChoice(event.option === 1 ? 'again' : 'exit', event.pos);
      return log.option(event.option + 1, event.pos);
    }
    case 'backtrack': {
      const node = program.nodes[event.node];
      if (node?.kind === 'alt') return log.backBranch(event.option + 1, node.branches.length, event.pos);
      if (node?.kind === 'repeat') return log.backLoop(event.option === 1 ? 'exit' : 'again', event.pos);
      return log.backOption(event.option + 1, event.pos);
    }
    case 'iter':
      return log.iter(event.count);
    case 'look': {
      const node = program.nodes[event.node];
      const negate = node?.kind === 'look' && node.negate;
      if (event.phase === 'start') return log.scoutStart;
      return log.scoutEnd(event.ok === true, negate);
    }
    case 'capture':
      if (event.start < 0) return log.captureClear(captureLabel(program, event.group));
      return log.capture(captureLabel(program, event.group), event.start, event.end);
    case 'match':
      return log.match(event.start, event.end);
    case 'nomatch':
      return log.nomatch;
  }
}

/** The whole log as copyable text, capped at LOG_COPY_CAP steps with a note about the rest. */
export function formatLog(program: Program, input: string, trace: Trace): string {
  const count = Math.min(trace.length, LOG_COPY_CAP);
  const lines: string[] = [];
  for (let i = 0; i < count; i++) lines.push(`${i + 1}. ${describeEvent(program, input, trace, i)}`);
  if (trace.length > count) lines.push(copy.traceLog.copyCap(trace.length - count));
  if (trace.truncated) lines.push(copy.traceLog.truncated);
  return lines.join('\n');
}
