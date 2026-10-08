export type NodeId = number;
export type Span = [start: number, end: number];

export interface EffectiveFlags {
  ignoreCase: boolean;
  multiline: boolean;
  dotAll: boolean;
  unicode: boolean;
  unicodeSets: boolean;
}

export interface Flags extends EffectiveFlags {
  global: boolean;
  sticky: boolean;
  hasIndices: boolean;
}

export type AssertKind = 'start' | 'end' | 'word' | 'notWord';

export type IR =
  | { kind: 'seq'; id: NodeId; span: Span; items: IR[] }
  | { kind: 'alt'; id: NodeId; span: Span; branches: IR[] }
  | { kind: 'char'; id: NodeId; span: Span; label: string; tester: number }
  | {
      kind: 'repeat';
      id: NodeId;
      span: Span;
      min: number;
      max: number;
      greedy: boolean;
      body: IR;
      capturesInside: number[];
    }
  | {
      kind: 'group';
      id: NodeId;
      span: Span;
      capture: number | null;
      name: string | null;
      body: IR;
      flags: EffectiveFlags;
    }
  | { kind: 'assert'; id: NodeId; span: Span; what: AssertKind; flags: EffectiveFlags }
  | { kind: 'look'; id: NodeId; span: Span; negate: boolean; body: IR }
  | { kind: 'opaque'; id: NodeId; span: Span; label: string; probe: number }
  | { kind: 'backref'; id: NodeId; span: Span; groups: number[]; flags: EffectiveFlags }
  | { kind: 'empty'; id: NodeId; span: Span };

export type IRKind = IR['kind'];

/** A single-character tester: compiled lazily to a native RegExp `^(?:raw)$` with `flags`. */
export interface TesterSpec {
  raw: string;
  flags: string;
}

/** A lookbehind probe: compiled lazily to a sticky native RegExp. */
export interface ProbeSpec {
  raw: string;
  flags: string;
}

export interface Program {
  source: string;
  flags: Flags;
  flagsText: string;
  root: IR;
  nodes: IR[]; // indexed by NodeId
  groupCount: number;
  groupNames: (string | null)[]; // index = group number (1-based; [0] is null)
  testers: TesterSpec[];
  probes: ProbeSpec[];
  /** true when the pattern contains backreferences or lookarounds (not expressible in a Pike VM). */
  hasBackrefs: boolean;
  hasLookaround: boolean;
  leafCount: number;
}

export function flagsToString(f: Flags): string {
  let s = '';
  if (f.hasIndices) s += 'd';
  if (f.global) s += 'g';
  if (f.ignoreCase) s += 'i';
  if (f.multiline) s += 'm';
  if (f.dotAll) s += 's';
  if (f.unicode) s += 'u';
  if (f.unicodeSets) s += 'v';
  if (f.sticky) s += 'y';
  return s;
}

export function parseFlagString(s: string): Flags {
  const f: Flags = {
    ignoreCase: false,
    multiline: false,
    dotAll: false,
    unicode: false,
    unicodeSets: false,
    global: false,
    sticky: false,
    hasIndices: false,
  };
  for (const c of s) {
    switch (c) {
      case 'i':
        f.ignoreCase = true;
        break;
      case 'm':
        f.multiline = true;
        break;
      case 's':
        f.dotAll = true;
        break;
      case 'u':
        f.unicode = true;
        break;
      case 'v':
        f.unicodeSets = true;
        break;
      case 'g':
        f.global = true;
        break;
      case 'y':
        f.sticky = true;
        break;
      case 'd':
        f.hasIndices = true;
        break;
      default:
        throw new SyntaxError(`Invalid regular expression flag "${c}"`);
    }
  }
  if (f.unicode && f.unicodeSets) throw new SyntaxError('Flags u and v cannot be combined');
  return f;
}

/** Flags string for a native single-character tester given effective flags. */
export function testerFlags(f: EffectiveFlags): string {
  let s = '';
  if (f.ignoreCase) s += 'i';
  if (f.dotAll) s += 's';
  if (f.unicode) s += 'u';
  if (f.unicodeSets) s += 'v';
  return s;
}

export function isLeaf(n: IR): boolean {
  return n.kind === 'char' || n.kind === 'assert' || n.kind === 'opaque' || n.kind === 'backref';
}

export function* walk(n: IR): Generator<IR> {
  yield n;
  switch (n.kind) {
    case 'seq':
      for (const c of n.items) yield* walk(c);
      break;
    case 'alt':
      for (const c of n.branches) yield* walk(c);
      break;
    case 'repeat':
    case 'group':
    case 'look':
      yield* walk(n.body);
      break;
    default:
      break;
  }
}
