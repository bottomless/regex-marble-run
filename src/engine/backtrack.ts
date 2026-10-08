import { charEqIgnoreCase, charLenAt, compileProbes, compileTesters, isLineTerminator, wordTester } from './chartest.ts';
import type { IR, Program } from './ir.ts';
import { T, TraceBuilder, type Trace, TRACE_EVENT_BUDGET, CHECKPOINT_EVERY } from './trace.ts';

export interface MatchResult {
  matched: boolean;
  index: number;
  end: number;
  groups: (string | undefined)[];
  namedGroups: Record<string, string | undefined> | null;
  steps: number;
  backtracks: number;
  attempts: number;
  maxDepth: number;
  truncated: boolean;
  gaveUp: boolean;
  elapsedMs: number;
}

export interface RunOptions {
  maxSteps?: number;
  wallMs?: number;
  traceBudget?: number;
  trace?: boolean;
  /** Called every ~4096 steps; return true to cancel. */
  shouldCancel?: () => boolean;
}

export const DEFAULT_MAX_STEPS = 50_000_000;
export const DEFAULT_WALL_MS = 4000;

const enum Op {
  CHAR,
  ASSERT,
  OPAQUE,
  SPLIT,
  JMP,
  GROUP_OPEN,
  GROUP_CLOSE,
  BACKREF,
  REP_INIT,
  REP_CHECK,
  REP_ENTER,
  REP_END,
  LOOK_START,
  LOOK_END,
  MATCH,
}

const enum K {
  CHOICE,
  UNDO_CAP,
  UNDO_CNT,
  UNDO_SP,
  LOOK,
}

const W = 5; // ints per instruction: op, x, y, z, w

interface Compiled {
  code: Int32Array;
  reps: { min: number; max: number; greedy: boolean; captures: number[]; node: number }[];
  backrefs: { groups: number[]; ignoreCase: boolean }[];
  groupCount: number;
}

export function compileBacktrack(prog: Program): Compiled {
  const code: number[] = [];
  const reps: Compiled['reps'] = [];
  const backrefs: Compiled['backrefs'] = [];
  const emit = (op: Op, x = 0, y = 0, z = 0, w = 0): number => {
    const pc = code.length / W;
    code.push(op, x, y, z, w);
    return pc;
  };
  const patch = (pc: number, field: 1 | 2 | 3 | 4, value: number): void => {
    code[pc * W + field] = value;
  };
  const here = (): number => code.length / W;

  const gen = (n: IR): void => {
    switch (n.kind) {
      case 'seq':
        for (const it of n.items) gen(it);
        break;
      case 'empty':
        break;
      case 'char':
        emit(Op.CHAR, n.tester, n.id);
        break;
      case 'assert': {
        const kind = n.what === 'start' ? 0 : n.what === 'end' ? 1 : n.what === 'word' ? 2 : 3;
        const fb = (n.flags.multiline ? 1 : 0) | (n.flags.ignoreCase ? 2 : 0);
        emit(Op.ASSERT, kind, n.id, fb);
        break;
      }
      case 'opaque':
        emit(Op.OPAQUE, n.probe, n.id);
        break;
      case 'backref': {
        const idx = backrefs.length;
        backrefs.push({ groups: n.groups, ignoreCase: n.flags.ignoreCase });
        emit(Op.BACKREF, idx, n.id);
        break;
      }
      case 'group':
        if (n.capture !== null) {
          emit(Op.GROUP_OPEN, n.capture, n.id);
          gen(n.body);
          emit(Op.GROUP_CLOSE, n.capture, n.id);
        } else {
          gen(n.body);
        }
        break;
      case 'alt': {
        const jumps: number[] = [];
        for (let i = 0; i < n.branches.length; i++) {
          const last = i === n.branches.length - 1;
          let split = -1;
          if (!last) split = emit(Op.SPLIT, 0, 0, n.id, i + 1);
          if (split >= 0) patch(split, 1, here());
          gen(n.branches[i]);
          if (!last) {
            jumps.push(emit(Op.JMP, 0));
            patch(split, 2, here());
          }
        }
        for (const j of jumps) patch(j, 1, here());
        break;
      }
      case 'repeat': {
        if (n.max === 0) break;
        const r = reps.length;
        reps.push({ min: n.min, max: n.max === Infinity ? -1 : n.max, greedy: n.greedy, captures: n.capturesInside, node: n.id });
        emit(Op.REP_INIT, r);
        const check = emit(Op.REP_CHECK, r, 0, 0, n.id);
        patch(check, 2, here());
        emit(Op.REP_ENTER, r, n.id);
        gen(n.body);
        emit(Op.REP_END, r, check);
        patch(check, 3, here());
        break;
      }
      case 'look': {
        const start = emit(Op.LOOK_START, 0, n.negate ? 1 : 0, n.id);
        gen(n.body);
        emit(Op.LOOK_END, n.id, n.negate ? 1 : 0);
        patch(start, 1, here());
        break;
      }
    }
  };
  gen(prog.root);
  emit(Op.MATCH);
  return { code: Int32Array.from(code), reps, backrefs, groupCount: prog.groupCount };
}

export interface RunOutput {
  result: MatchResult;
  trace: Trace;
}

export function runBacktrack(prog: Program, input: string, opts: RunOptions = {}): RunOutput {
  const compiled = compileBacktrack(prog);
  return execute(prog, compiled, input, opts);
}

function execute(prog: Program, cm: Compiled, input: string, opts: RunOptions): RunOutput {
  const t0 = performance.now();
  const maxSteps = opts.maxSteps ?? DEFAULT_MAX_STEPS;
  const wallMs = opts.wallMs ?? DEFAULT_WALL_MS;
  const tracing = opts.trace !== false;
  const tb = new TraceBuilder(tracing ? (opts.traceBudget ?? TRACE_EVENT_BUDGET) : 0);
  if (!tracing) tb.truncated = true;

  const code = cm.code;
  const testers = compileTesters(prog.testers);
  const probes = compileProbes(prog.probes);
  const unicode = prog.flags.unicode || prog.flags.unicodeSets;
  const wordRe = wordTester(prog.flags.ignoreCase, prog.flags.unicode, prog.flags.unicodeSets);
  const wordReCi = wordTester(true, prog.flags.unicode, prog.flags.unicodeSets);
  const len = input.length;
  const nGroups = cm.groupCount;
  const caps = new Int32Array(2 * (nGroups + 1));
  const counters = new Int32Array(cm.reps.length);
  const startPos = new Int32Array(cm.reps.length);

  let stack = new Int32Array(3 * 1024);
  let sp = 0; // number of entries
  let depth = 0;
  let maxDepth = 0;
  let steps = 0;
  let backtracks = 0;
  let attempts = 0;
  let gaveUp = false;
  let cancelled = false;

  const push = (k: K, a: number, b: number): void => {
    if (sp * 3 + 3 > stack.length) {
      const n = new Int32Array(stack.length * 2);
      n.set(stack);
      stack = n;
    }
    const i = sp++ * 3;
    stack[i] = k;
    stack[i + 1] = a;
    stack[i + 2] = b;
  };
  const setCap = (slot: number, v: number): void => {
    push(K.UNDO_CAP, slot, caps[slot]);
    caps[slot] = v;
  };

  const isWordAt = (i: number, ci: boolean): boolean => {
    if (i < 0 || i >= len) return false;
    const re = ci ? wordReCi : wordRe;
    // Word characters are always BMP; a lone surrogate is never a word char.
    return re.test(input[i]);
  };

  const tick = (): boolean => {
    steps++;
    if (steps >= maxSteps) {
      gaveUp = true;
      return false;
    }
    if ((steps & 4095) === 0) {
      if (performance.now() - t0 > wallMs) {
        gaveUp = true;
        return false;
      }
      if (opts.shouldCancel && opts.shouldCancel()) {
        cancelled = true;
        gaveUp = true;
        return false;
      }
    }
    if (tb.truncated && steps % CHECKPOINT_EVERY === 0) tb.checkpoint(steps, depth, curPos);
    return true;
  };

  let curPos = 0;
  let matched = false;
  let matchStart = -1;
  let matchEnd = -1;

  const starts: number[] = [];
  if (prog.flags.sticky) starts.push(0);
  else {
    for (let s = 0; s <= len; ) {
      starts.push(s);
      if (s >= len) break;
      s += charLenAt(input, s, unicode);
    }
  }

  outer: for (const start of starts) {
    attempts++;
    caps.fill(-1);
    sp = 0;
    depth = 0;
    let pc = 0;
    let pos = start;
    curPos = pos;
    tb.push(T.attempt, start);

    while (true) {
      const base = pc * W;
      const op = code[base] as Op;
      let fail = false;
      switch (op) {
        case Op.CHAR: {
          const l = charLenAt(input, pos, unicode);
          let ok = false;
          if (l > 0) ok = testers[code[base + 1]].test(l === 2 ? input.substr(pos, 2) : input[pos]);
          tb.push(T.test, code[base + 2], pos, ok ? 1 : 0, l);
          curPos = pos;
          if (!tick()) break outer;
          if (ok) {
            pos += l;
            pc++;
          } else fail = true;
          break;
        }
        case Op.ASSERT: {
          const kind = code[base + 1];
          const fb = code[base + 3];
          const multiline = (fb & 1) !== 0;
          const ci = (fb & 2) !== 0;
          let ok: boolean;
          if (kind === 0) ok = pos === 0 || (multiline && isLineTerminator(input.charCodeAt(pos - 1)));
          else if (kind === 1) ok = pos === len || (multiline && isLineTerminator(input.charCodeAt(pos)));
          else {
            const a = isWordAt(pos - 1, ci);
            const b = isWordAt(pos, ci);
            ok = kind === 2 ? a !== b : a === b;
          }
          tb.push(T.test, code[base + 2], pos, ok ? 1 : 0, 0);
          curPos = pos;
          if (!tick()) break outer;
          if (ok) pc++;
          else fail = true;
          break;
        }
        case Op.OPAQUE: {
          const re = probes[code[base + 1]];
          re.lastIndex = pos;
          const ok = re.exec(input) !== null;
          tb.push(T.test, code[base + 2], pos, ok ? 1 : 0, 0);
          curPos = pos;
          if (!tick()) break outer;
          if (ok) pc++;
          else fail = true;
          break;
        }
        case Op.BACKREF: {
          const br = cm.backrefs[code[base + 1]];
          let g = -1;
          for (const cand of br.groups) {
            if (caps[2 * cand + 1] >= 0) {
              g = cand;
              break;
            }
          }
          let ok = true;
          let l = 0;
          if (g >= 0) {
            const s = caps[2 * g];
            const e = caps[2 * g + 1];
            if (!br.ignoreCase) {
              l = e - s;
              ok = pos + l <= len && input.startsWith(input.slice(s, e), pos);
            } else {
              let i = s;
              let j = pos;
              while (i < e) {
                const li = charLenAt(input, i, unicode);
                const lj = charLenAt(input, j, unicode);
                if (lj === 0) {
                  ok = false;
                  break;
                }
                const ca = input.substr(i, li);
                const cb = input.substr(j, lj);
                if (!charEqIgnoreCase(ca, cb, prog.flags.unicode, prog.flags.unicodeSets)) {
                  ok = false;
                  break;
                }
                i += li;
                j += lj;
              }
              l = ok ? j - pos : 0;
            }
          }
          tb.push(T.test, code[base + 2], pos, ok ? 1 : 0, l);
          curPos = pos;
          if (!tick()) break outer;
          if (ok) {
            pos += l;
            pc++;
          } else fail = true;
          break;
        }
        case Op.SPLIT: {
          push(K.CHOICE, pc, pos);
          depth++;
          if (depth > maxDepth) maxDepth = depth;
          tb.push(T.choose, code[base + 3], code[base + 4], pos, depth);
          pc = code[base + 1];
          break;
        }
        case Op.JMP:
          pc = code[base + 1];
          break;
        case Op.GROUP_OPEN: {
          const g = code[base + 1];
          setCap(2 * g, pos);
          setCap(2 * g + 1, -1);
          pc++;
          break;
        }
        case Op.GROUP_CLOSE: {
          const g = code[base + 1];
          setCap(2 * g + 1, pos);
          tb.push(T.capture, g, caps[2 * g], pos);
          pc++;
          break;
        }
        case Op.REP_INIT: {
          const r = code[base + 1];
          push(K.UNDO_CNT, r, counters[r]);
          counters[r] = 0;
          pc++;
          break;
        }
        case Op.REP_CHECK: {
          const r = code[base + 1];
          const rep = cm.reps[r];
          const count = counters[r];
          if (count < rep.min) pc = code[base + 2];
          else if (rep.max >= 0 && count >= rep.max) pc = code[base + 3];
          else {
            push(K.CHOICE, pc, pos);
            depth++;
            if (depth > maxDepth) maxDepth = depth;
            tb.push(T.choose, code[base + 4], rep.greedy ? 1 : 0, pos, depth);
            pc = rep.greedy ? code[base + 2] : code[base + 3];
          }
          break;
        }
        case Op.REP_ENTER: {
          const r = code[base + 1];
          const rep = cm.reps[r];
          push(K.UNDO_SP, r, startPos[r]);
          startPos[r] = pos;
          for (const g of rep.captures) {
            if (caps[2 * g] >= 0 || caps[2 * g + 1] >= 0) {
              setCap(2 * g, -1);
              setCap(2 * g + 1, -1);
              tb.push(T.capture, g, -1, -1);
            }
          }
          tb.push(T.iter, code[base + 2], counters[r] + 1);
          pc++;
          break;
        }
        case Op.REP_END: {
          const r = code[base + 1];
          const rep = cm.reps[r];
          if (counters[r] >= rep.min && pos === startPos[r]) {
            fail = true;
            break;
          }
          push(K.UNDO_CNT, r, counters[r]);
          counters[r]++;
          pc = code[base + 2];
          break;
        }
        case Op.LOOK_START: {
          push(K.LOOK, pc, pos);
          tb.push(T.look, code[base + 3], 0, -1, depth);
          pc++;
          break;
        }
        case Op.LOOK_END: {
          const negate = code[base + 2] === 1;
          // Find nearest LOOK frame.
          let li = sp - 1;
          while (li >= 0 && stack[li * 3] !== K.LOOK) li--;
          const framePc = stack[li * 3 + 1];
          const framePos = stack[li * 3 + 2];
          if (negate) {
            for (let i = sp - 1; i > li; i--) {
              const k = stack[i * 3] as K;
              const a = stack[i * 3 + 1];
              const b = stack[i * 3 + 2];
              if (k === K.UNDO_CAP) caps[a] = b;
              else if (k === K.UNDO_CNT) counters[a] = b;
              else if (k === K.UNDO_SP) startPos[a] = b;
              else if (k === K.CHOICE) depth--;
            }
            sp = li;
            tb.push(T.look, code[base + 1], 1, 0, depth);
            fail = true;
          } else {
            let w = li;
            for (let i = li + 1; i < sp; i++) {
              const k = stack[i * 3] as K;
              if (k === K.CHOICE) depth--;
              else {
                stack[w * 3] = k;
                stack[w * 3 + 1] = stack[i * 3 + 1];
                stack[w * 3 + 2] = stack[i * 3 + 2];
                w++;
              }
            }
            sp = w;
            pos = framePos;
            pc = code[framePc * W + 1];
            tb.push(T.look, code[base + 1], 1, 1, depth);
          }
          break;
        }
        case Op.MATCH:
          matched = true;
          matchStart = start;
          matchEnd = pos;
          caps[0] = start;
          caps[1] = pos;
          tb.push(T.match, start, pos);
          break outer;
      }

      if (fail) {
        // Backtrack: unwind the trail until a choice point or look frame decides.
        let resumed = false;
        while (sp > 0) {
          sp--;
          const i = sp * 3;
          const k = stack[i] as K;
          const a = stack[i + 1];
          const b = stack[i + 2];
          if (k === K.UNDO_CAP) caps[a] = b;
          else if (k === K.UNDO_CNT) counters[a] = b;
          else if (k === K.UNDO_SP) startPos[a] = b;
          else if (k === K.CHOICE) {
            depth--;
            backtracks++;
            const sb = a * W;
            const sop = code[sb] as Op;
            let node: number;
            let option: number;
            if (sop === Op.SPLIT) {
              pc = code[sb + 2];
              node = code[sb + 3];
              option = code[sb + 4];
            } else {
              const rep = cm.reps[code[sb + 1]];
              pc = rep.greedy ? code[sb + 3] : code[sb + 2];
              node = code[sb + 4];
              option = rep.greedy ? 1 : 0;
            }
            pos = b;
            curPos = pos;
            tb.push(T.backtrack, node, option, pos, depth);
            if (!tick()) break outer;
            resumed = true;
            break;
          } else {
            // LOOK frame reached: body failed.
            const negate = code[a * W + 2] === 1;
            if (negate) {
              pos = b;
              pc = code[a * W + 1];
              tb.push(T.look, code[a * W + 3], 1, 1, depth);
              resumed = true;
              break;
            } else {
              tb.push(T.look, code[a * W + 3], 1, 0, depth);
            }
          }
        }
        if (!resumed) break; // attempt failed; next start
      }
    }
  }

  if (!matched && !gaveUp) tb.push(T.nomatch);

  const groups: (string | undefined)[] = [];
  const namedGroups: Record<string, string | undefined> | null = prog.groupNames.some((n) => n !== null) ? {} : null;
  if (matched) {
    for (let g = 0; g <= nGroups; g++) {
      const s = caps[2 * g];
      const e = caps[2 * g + 1];
      groups.push(s >= 0 && e >= 0 ? input.slice(s, e) : undefined);
    }
    if (namedGroups) {
      for (let g = 1; g <= nGroups; g++) {
        const name = prog.groupNames[g];
        if (name === null) continue;
        if (!(name in namedGroups) || namedGroups[name] === undefined) namedGroups[name] = groups[g];
      }
    }
  }

  const trace = tb.finish();
  return {
    result: {
      matched,
      index: matchStart,
      end: matchEnd,
      groups,
      namedGroups,
      steps,
      backtracks,
      attempts,
      maxDepth,
      truncated: trace.truncated && tracing,
      gaveUp: gaveUp && !cancelled,
      elapsedMs: performance.now() - t0,
    },
    trace,
  };
}

/** Convenience: run against native RegExp for comparison. */
export function nativeExec(pattern: string, flags: string, input: string): RegExpExecArray | null {
  const re = new RegExp(pattern, flags.replace(/[gd]/g, ''));
  re.lastIndex = 0;
  return re.exec(input);
}
