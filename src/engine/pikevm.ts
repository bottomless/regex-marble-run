import { charLenAt, compileTesters, isLineTerminator, wordTester } from './chartest.ts';
import type { EffectiveFlags, IR, Program, Span } from './ir.ts';
import type { RunOptions } from './backtrack.ts';
import { DEFAULT_MAX_STEPS, DEFAULT_WALL_MS } from './backtrack.ts';
import { TRACE_EVENT_BUDGET } from './trace.ts';

export const MAX_PIKE_INSTRUCTIONS = 50_000;
export const MAX_PIKE_COMPILE_VISITS = 500_000;

export class PikeCompileError extends Error {
  constructor(
    message: string,
    public readonly span: Span,
    public readonly reason: 'feature' | 'complexity',
  ) {
    super(message);
    this.name = 'PikeCompileError';
  }
}

export type PikeInstruction =
  | { op: 'char'; node: number; tester: number; next: number }
  | {
      op: 'assert';
      node: number;
      what: 'start' | 'end' | 'word' | 'notWord';
      flags: EffectiveFlags;
      next: number;
    }
  | { op: 'save'; node: number; slot: number; next: number }
  | { op: 'split'; node: number; x: number; y: number }
  | { op: 'jmp'; node: number; next: number }
  | { op: 'match' | 'fail'; node: number };

export interface PikeProgram {
  code: PikeInstruction[];
  entry: number;
}

export function compilePike(program: Program): PikeProgram {
  const unsupported = program.nodes.find(
    (n) => n.kind === 'backref' || n.kind === 'look' || n.kind === 'opaque',
  );
  if (unsupported) {
    throw new PikeCompileError(
      'Linear-time engines (RE2, Go, Rust) reject backreferences and lookarounds. This comparison supports only regular patterns.',
      unsupported.span,
      'feature',
    );
  }
  const code: PikeInstruction[] = [];
  let activeSpan = program.root.span;
  const emit = (instruction: PikeInstruction): number => {
    if (code.length >= MAX_PIKE_INSTRUCTIONS) {
      throw new PikeCompileError(
        'This repetition is too large to compile for the linear-time comparison.',
        activeSpan,
        'complexity',
      );
    }
    code.push(instruction);
    return code.length - 1;
  };
  const accept = emit({ op: 'match', node: program.root.id });
  const fail = emit({ op: 'fail', node: program.root.id });
  const nullable = new Map<number, boolean>();
  const canBeEmpty = (node: IR): boolean => {
    const cached = nullable.get(node.id);
    if (cached !== undefined) return cached;
    let value: boolean;
    switch (node.kind) {
      case 'char':
        value = false;
        break;
      case 'seq':
        value = node.items.every(canBeEmpty);
        break;
      case 'alt':
        value = node.branches.some(canBeEmpty);
        break;
      case 'group':
        value = canBeEmpty(node.body);
        break;
      case 'repeat':
        value = node.min === 0 || canBeEmpty(node.body);
        break;
      default:
        value = true;
    }
    nullable.set(node.id, value);
    return value;
  };

  const emptyOnly = new Map<number, boolean>();
  const instructionFree = (node: IR): boolean => {
    const cached = emptyOnly.get(node.id);
    if (cached !== undefined) return cached;
    let value = false;
    switch (node.kind) {
      case 'empty':
        value = true;
        break;
      case 'seq':
        value = node.items.every(instructionFree);
        break;
      case 'alt':
        value = node.branches.every(instructionFree);
        break;
      case 'group':
        value = node.capture === null && instructionFree(node.body);
        break;
      case 'repeat':
        value = node.max === 0 || instructionFree(node.body);
        break;
    }
    emptyOnly.set(node.id, value);
    return value;
  };

  const nonEmpty = (entry: number, exit: number): number => {
    const copies = new Map<number, number>([[exit, fail]]);
    const pending: number[] = [];
    const copy = (pc: number): number => {
      const found = copies.get(pc);
      if (found !== undefined) return found;
      const instruction = code[pc];
      if (instruction.op === 'char' || instruction.op === 'fail') return pc;
      const duplicate = emit({ ...instruction });
      copies.set(pc, duplicate);
      pending.push(pc);
      return duplicate;
    };
    const start = copy(entry);
    while (pending.length) {
      const pc = pending.pop()!;
      const instruction = code[pc];
      const duplicate = copies.get(pc)!;
      if (instruction.op === 'split') {
        code[duplicate] = { ...instruction, x: copy(instruction.x), y: copy(instruction.y) };
      } else if ('next' in instruction) {
        code[duplicate] = { ...instruction, next: copy(instruction.next) };
      }
    }
    return start;
  };

  let compileVisits = 0;
  const gen = (node: IR, next: number): number => {
    activeSpan = node.span;
    if (++compileVisits > MAX_PIKE_COMPILE_VISITS) {
      throw new PikeCompileError(
        'This repetition is too large to compile for the linear-time comparison.',
        node.span,
        'complexity',
      );
    }
    if (instructionFree(node)) return next;
    switch (node.kind) {
      case 'empty':
        return next;
      case 'char':
        return emit({ op: 'char', node: node.id, tester: node.tester, next });
      case 'assert':
        return emit({ op: 'assert', node: node.id, what: node.what, flags: node.flags, next });
      case 'seq': {
        let entry = next;
        for (let i = node.items.length - 1; i >= 0; i--) entry = gen(node.items[i], entry);
        return entry;
      }
      case 'group': {
        if (node.capture === null) return gen(node.body, next);
        const close = emit({ op: 'save', node: node.id, slot: 2 * node.capture + 1, next });
        const body = gen(node.body, close);
        return emit({ op: 'save', node: node.id, slot: 2 * node.capture, next: body });
      }
      case 'alt': {
        let entry = next;
        for (let i = node.branches.length - 1; i >= 0; i--) {
          const branch = gen(node.branches[i], next);
          entry =
            i === node.branches.length - 1
              ? branch
              : emit({ op: 'split', node: node.id, x: branch, y: entry });
        }
        return entry;
      }
      case 'repeat': {
        if (node.max === 0) return next;
        if (node.min > MAX_PIKE_INSTRUCTIONS || (node.max !== Infinity && node.max > MAX_PIKE_INSTRUCTIONS)) {
          throw new PikeCompileError(
            'This repetition is too large to compile for the linear-time comparison.',
            node.span,
            'complexity',
          );
        }
        let entry = next;
        const optionalBody = (exit: number): number => {
          const body = gen(node.body, exit);
          activeSpan = node.span;
          return canBeEmpty(node.body) ? nonEmpty(body, exit) : body;
        };
        if (node.max === Infinity) {
          const loop = emit({ op: 'split', node: node.id, x: 0, y: 0 });
          const body = optionalBody(loop);
          code[loop] = {
            op: 'split',
            node: node.id,
            x: node.greedy ? body : next,
            y: node.greedy ? next : body,
          };
          entry = loop;
        } else {
          for (let i = node.min; i < node.max; i++) {
            const body = optionalBody(entry);
            entry = emit({
              op: 'split',
              node: node.id,
              x: node.greedy ? body : entry,
              y: node.greedy ? entry : body,
            });
          }
        }
        for (let i = 0; i < node.min; i++) entry = gen(node.body, entry);
        return entry;
      }
      default:
        throw new PikeCompileError(
          'Backreferences and lookarounds are unavailable in the linear-time comparison.',
          node.span,
          'feature',
        );
    }
  };
  const entry = gen(program.root, accept);
  return { code, entry };
}

export const enum PikeEvent {
  live,
  birth,
  merge,
  death,
}

export interface PikeTrace {
  length: number;
  t: Uint8Array;
  positions: Int32Array;
  threads: Int32Array;
  others: Int32Array;
  nodes: Int32Array;
  pcs: Int32Array;
  starts: Int32Array;
  truncated: boolean;
}

class PikeTraceBuilder {
  private rows: number[] = [];
  truncated = false;

  constructor(private readonly budget: number) {}

  push(t: PikeEvent, pos: number, thread: Thread, node: number, other = -1): void {
    if (this.truncated) return;
    if (this.rows.length / 7 >= this.budget) {
      this.truncated = true;
      return;
    }
    this.rows.push(t, pos, thread.id, other, node, thread.pc, thread.start);
  }

  finish(): PikeTrace {
    const length = this.rows.length / 7;
    const t = new Uint8Array(length);
    const columns = Array.from({ length: 6 }, () => new Int32Array(length));
    for (let i = 0; i < length; i++) {
      t[i] = this.rows[i * 7];
      for (let c = 0; c < 6; c++) columns[c][i] = this.rows[i * 7 + c + 1];
    }
    return {
      length,
      t,
      positions: columns[0],
      threads: columns[1],
      others: columns[2],
      nodes: columns[3],
      pcs: columns[4],
      starts: columns[5],
      truncated: this.truncated,
    };
  }
}

export function pikeTransferables(trace: PikeTrace): ArrayBuffer[] {
  return [
    trace.t.buffer,
    trace.positions.buffer,
    trace.threads.buffer,
    trace.others.buffer,
    trace.nodes.buffer,
    trace.pcs.buffer,
    trace.starts.buffer,
  ] as ArrayBuffer[];
}

export interface PikeResult {
  matched: boolean;
  index: number;
  end: number;
  groups: (string | undefined)[];
  namedGroups: Record<string, string | undefined> | null;
  steps: number;
  attempts: number;
  maxThreads: number;
  truncated: boolean;
  gaveUp: boolean;
  elapsedMs: number;
}

interface Capture {
  slot: number;
  pos: number;
  previous: Capture | null;
}

interface Thread {
  pc: number;
  id: number;
  start: number;
  captures: Capture | null;
}

export function runPike(
  program: Program,
  input: string,
  options: RunOptions = {},
): { result: PikeResult; trace: PikeTrace } {
  const t0 = performance.now();
  const { code, entry } = compilePike(program);
  const testers = compileTesters(program.testers);
  const unicode = program.flags.unicode || program.flags.unicodeSets;
  const word = wordTester(false, program.flags.unicode, program.flags.unicodeSets);
  const wordCi = wordTester(true, program.flags.unicode, program.flags.unicodeSets);
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  const wallMs = options.wallMs ?? DEFAULT_WALL_MS;
  const tracing = options.trace !== false;
  const tb = new PikeTraceBuilder(tracing ? (options.traceBudget ?? TRACE_EVENT_BUDGET) : 0);
  const seen = new Int32Array(code.length).fill(-1);
  const owners = new Int32Array(code.length);
  let steps = 0;
  let attempts = 0;
  let maxThreads = 0;
  let gaveUp = false;
  let nextThreadId = 0;
  let candidate: { thread: Thread; end: number } | null = null;
  let seeds: Thread[] = [];

  const record = (t: PikeEvent, pos: number, thread: Thread, other = -1): void => {
    if (tracing) tb.push(t, pos, thread, code[thread.pc].node, other);
  };
  const tick = (): boolean => {
    if (steps >= maxSteps) {
      gaveUp = true;
      return false;
    }
    if ((steps & 4095) === 0 && (performance.now() - t0 >= wallMs || options.shouldCancel?.())) {
      gaveUp = true;
      return false;
    }
    steps++;
    return true;
  };
  const assert = (instruction: Extract<PikeInstruction, { op: 'assert' }>, pos: number): boolean => {
    if (instruction.what === 'start')
      return pos === 0 || (instruction.flags.multiline && isLineTerminator(input.charCodeAt(pos - 1)));
    if (instruction.what === 'end')
      return pos === input.length || (instruction.flags.multiline && isLineTerminator(input.charCodeAt(pos)));
    const re = instruction.flags.ignoreCase ? wordCi : word;
    const before = pos > 0 && re.test(input[pos - 1]);
    const after = pos < input.length && re.test(input[pos]);
    return instruction.what === 'word' ? before !== after : before === after;
  };

  outer: for (let pos = 0; ;) {
    if (!candidate && (!program.flags.sticky || pos === 0)) {
      const thread = { pc: entry, id: nextThreadId++, start: pos, captures: null };
      seeds.push(thread);
      attempts++;
      record(PikeEvent.birth, pos, thread);
    }
    const live: Thread[] = [];
    const pending = seeds.reverse();
    while (pending.length) {
      const thread = pending.pop()!;
      const instruction = code[thread.pc];
      if (seen[thread.pc] === pos) {
        record(PikeEvent.merge, pos, thread, owners[thread.pc]);
        continue;
      }
      seen[thread.pc] = pos;
      owners[thread.pc] = thread.id;
      if (!tick()) break outer;
      switch (instruction.op) {
        case 'char':
        case 'match':
          live.push(thread);
          record(PikeEvent.live, pos, thread);
          break;
        case 'fail':
          record(PikeEvent.death, pos, thread);
          break;
        case 'jmp':
          pending.push({ ...thread, pc: instruction.next });
          break;
        case 'assert':
          if (assert(instruction, pos)) pending.push({ ...thread, pc: instruction.next });
          else record(PikeEvent.death, pos, thread);
          break;
        case 'save':
          pending.push({
            ...thread,
            pc: instruction.next,
            captures: { slot: instruction.slot, pos, previous: thread.captures },
          });
          break;
        case 'split': {
          const second = { ...thread, pc: instruction.y, id: nextThreadId++ };
          record(PikeEvent.birth, pos, second, thread.id);
          pending.push(second, { ...thread, pc: instruction.x });
          break;
        }
      }
    }
    maxThreads = Math.max(maxThreads, live.length);
    seeds = [];
    const length = charLenAt(input, pos, unicode);
    for (let i = 0; i < live.length; i++) {
      const thread = live[i];
      const instruction = code[thread.pc];
      if (instruction.op === 'match') {
        candidate = { thread, end: pos };
        for (let j = i + 1; j < live.length; j++) record(PikeEvent.death, pos, live[j]);
        break;
      }
      if (
        instruction.op === 'char' &&
        length > 0 &&
        testers[instruction.tester].test(input.slice(pos, pos + length))
      ) {
        seeds.push({ ...thread, pc: instruction.next });
      } else {
        record(PikeEvent.death, pos, thread);
      }
    }
    if (
      (candidate && seeds.length === 0) ||
      pos === input.length ||
      (program.flags.sticky && seeds.length === 0)
    )
      break;
    pos += length;
  }

  const matched = candidate !== null && !gaveUp;
  const groups: (string | undefined)[] = [];
  const namedGroups: Record<string, string | undefined> | null = program.groupNames.some(
    (name) => name !== null,
  )
    ? (Object.create(null) as Record<string, string | undefined>)
    : null;
  if (candidate && matched) {
    const slots = new Int32Array(2 * (program.groupCount + 1)).fill(-1);
    for (let capture = candidate.thread.captures; capture; capture = capture.previous) {
      if (slots[capture.slot] < 0) slots[capture.slot] = capture.pos;
    }
    groups.push(input.slice(candidate.thread.start, candidate.end));
    for (let group = 1; group <= program.groupCount; group++) {
      const start = slots[2 * group];
      const end = slots[2 * group + 1];
      groups.push(start >= 0 && end >= start ? input.slice(start, end) : undefined);
      const name = program.groupNames[group];
      if (name !== null && namedGroups && namedGroups[name] === undefined) namedGroups[name] = groups[group];
    }
  }
  const trace = tb.finish();
  return {
    result: {
      matched,
      index: matched ? candidate!.thread.start : -1,
      end: matched ? candidate!.end : -1,
      groups,
      namedGroups,
      steps,
      attempts,
      maxThreads,
      truncated: tracing && trace.truncated,
      gaveUp,
      elapsedMs: performance.now() - t0,
    },
    trace,
  };
}
