import { RegExpParser, RegExpSyntaxError } from '@eslint-community/regexpp';
import type { AST } from '@eslint-community/regexpp';
import {
  type EffectiveFlags,
  type Flags,
  type IR,
  type NodeId,
  type Program,
  type ProbeSpec,
  type TesterSpec,
  flagsToString,
  isLeaf,
  parseFlagString,
  testerFlags,
  walk,
} from './ir.ts';

export const PATTERN_MAX = 300;
export const STRING_MAX = 2000;

export class PatternError extends Error {
  constructor(
    message: string,
    public readonly index: number,
    public readonly end: number = index + 1,
    public readonly unsupported: boolean = false,
  ) {
    super(message);
    this.name = unsupported ? 'UnsupportedError' : 'PatternError';
  }
}

const parser = new RegExpParser({ ecmaVersion: 2025 });

function charEscape(value: number, unicode: boolean): string {
  if (unicode) return `\\u{${value.toString(16)}}`;
  return `\\u${value.toString(16).padStart(4, '0')}`;
}

export function parsePattern(source: string, flagsText: string): Program {
  if (source.length > PATTERN_MAX) {
    throw new PatternError(`Pattern is longer than ${PATTERN_MAX} characters`, PATTERN_MAX, source.length);
  }
  const flags: Flags = parseFlagString(flagsText);
  let ast: AST.Pattern;
  try {
    ast = parser.parsePattern(source, 0, source.length, {
      unicode: flags.unicode,
      unicodeSets: flags.unicodeSets,
    });
  } catch (e) {
    if (e instanceof RegExpSyntaxError) {
      const idx = Math.max(0, Math.min(e.index, source.length));
      throw new PatternError(e.message.replace(/^Invalid regular expression: \/.*\/[a-z]*: /, ''), idx);
    }
    throw e;
  }

  // Number capturing groups in source order.
  const groupNumber = new Map<AST.CapturingGroup, number>();
  const groupNames: (string | null)[] = [null];
  const groups: AST.CapturingGroup[] = [];
  const collect = (n: AST.Node): void => {
    switch (n.type) {
      case 'Pattern':
      case 'Group':
      case 'CapturingGroup':
        if (n.type === 'CapturingGroup') groups.push(n);
        for (const a of n.alternatives) collect(a);
        break;
      case 'Assertion':
        if (n.kind === 'lookahead' || n.kind === 'lookbehind') for (const a of n.alternatives) collect(a);
        break;
      case 'Alternative':
        for (const e of n.elements) collect(e);
        break;
      case 'Quantifier':
        collect(n.element);
        break;
      default:
        break;
    }
  };
  collect(ast);
  groups.sort((a, b) => a.start - b.start);
  groups.forEach((g, i) => {
    groupNumber.set(g, i + 1);
    groupNames.push(g.name);
  });

  const nodes: IR[] = [];
  const testers: TesterSpec[] = [];
  const testerIndex = new Map<string, number>();
  const probes: ProbeSpec[] = [];
  let hasBackrefs = false;
  let hasLookaround = false;

  const nextId = (): NodeId => nodes.length;
  const register = <T extends IR>(n: T): T => {
    nodes[n.id] = n;
    return n;
  };
  const tester = (raw: string, f: EffectiveFlags): number => {
    const fl = testerFlags(f);
    const key = fl + '/' + raw;
    let idx = testerIndex.get(key);
    if (idx === undefined) {
      idx = testers.length;
      testers.push({ raw, flags: fl });
      testerIndex.set(key, idx);
    }
    return idx;
  };

  const checkClassSupported = (n: AST.Node): void => {
    switch (n.type) {
      case 'CharacterSet':
        if (n.kind === 'property' && n.strings) {
          throw new PatternError(
            `Properties of strings (${n.raw}) can match several characters at once; not supported yet`,
            n.start,
            n.end,
            true,
          );
        }
        break;
      case 'ClassStringDisjunction':
        for (const alt of n.alternatives) {
          if (alt.elements.length !== 1) {
            throw new PatternError(
              `String alternatives (${n.raw}) can match several characters at once; not supported yet`,
              n.start,
              n.end,
              true,
            );
          }
        }
        break;
      case 'CharacterClass':
        for (const e of n.elements) checkClassSupported(e);
        break;
      case 'ExpressionCharacterClass':
        checkClassSupported(n.expression);
        break;
      case 'ClassIntersection':
      case 'ClassSubtraction':
        checkClassSupported(n.left);
        checkClassSupported(n.right);
        break;
      default:
        break;
    }
  };

  const containsCaptureOrBackref = (n: AST.Node): AST.Node | null => {
    switch (n.type) {
      case 'CapturingGroup':
      case 'Backreference':
        return n;
      case 'Group':
      case 'Pattern':
        for (const a of n.alternatives) {
          const r = containsCaptureOrBackref(a);
          if (r) return r;
        }
        return null;
      case 'Assertion':
        if (n.kind === 'lookahead' || n.kind === 'lookbehind') {
          for (const a of n.alternatives) {
            const r = containsCaptureOrBackref(a);
            if (r) return r;
          }
        }
        return null;
      case 'Alternative':
        for (const e of n.elements) {
          const r = containsCaptureOrBackref(e);
          if (r) return r;
        }
        return null;
      case 'Quantifier':
        return containsCaptureOrBackref(n.element);
      default:
        return null;
    }
  };

  const convertAlternatives = (
    alts: AST.Alternative[],
    span: [number, number],
    f: EffectiveFlags,
  ): IR => {
    if (alts.length === 1) return convertAlternative(alts[0], f);
    const id = nextId();
    nodes[id] = { kind: 'empty', id, span }; // placeholder to reserve id (parent before children)
    const branches = alts.map((a) => convertAlternative(a, f));
    return register({ kind: 'alt', id, span, branches });
  };

  const convertAlternative = (alt: AST.Alternative, f: EffectiveFlags): IR => {
    const span: [number, number] = [alt.start, alt.end];
    if (alt.elements.length === 0) return register({ kind: 'empty', id: nextId(), span });
    if (alt.elements.length === 1) return convertElement(alt.elements[0], f);
    const id = nextId();
    nodes[id] = { kind: 'empty', id, span };
    const items = alt.elements.map((e) => convertElement(e, f));
    return register({ kind: 'seq', id, span, items });
  };

  const convertElement = (el: AST.Element, f: EffectiveFlags): IR => {
    const span: [number, number] = [el.start, el.end];
    switch (el.type) {
      case 'Character': {
        const raw = charEscape(el.value, f.unicode || f.unicodeSets);
        return register({ kind: 'char', id: nextId(), span, label: el.raw, tester: tester(raw, f) });
      }
      case 'CharacterSet': {
        if (el.kind === 'property' && el.strings) checkClassSupported(el);
        return register({ kind: 'char', id: nextId(), span, label: el.raw, tester: tester(el.raw, f) });
      }
      case 'CharacterClass':
      case 'ExpressionCharacterClass': {
        checkClassSupported(el);
        return register({ kind: 'char', id: nextId(), span, label: el.raw, tester: tester(el.raw, f) });
      }
      case 'Group': {
        const id = nextId();
        nodes[id] = { kind: 'empty', id, span };
        let bf = f;
        if (el.modifiers) {
          bf = { ...f };
          const add = el.modifiers.add;
          if (add.ignoreCase) bf.ignoreCase = true;
          if (add.multiline) bf.multiline = true;
          if (add.dotAll) bf.dotAll = true;
          const rem = el.modifiers.remove;
          if (rem) {
            if (rem.ignoreCase) bf.ignoreCase = false;
            if (rem.multiline) bf.multiline = false;
            if (rem.dotAll) bf.dotAll = false;
          }
        }
        const body = convertAlternatives(el.alternatives, span, bf);
        return register({ kind: 'group', id, span, capture: null, name: null, body, flags: bf });
      }
      case 'CapturingGroup': {
        const id = nextId();
        nodes[id] = { kind: 'empty', id, span };
        const body = convertAlternatives(el.alternatives, span, f);
        return register({
          kind: 'group',
          id,
          span,
          capture: groupNumber.get(el)!,
          name: el.name,
          body,
          flags: f,
        });
      }
      case 'Quantifier': {
        const id = nextId();
        nodes[id] = { kind: 'empty', id, span };
        const body = convertElement(el.element, f);
        const capturesInside: number[] = [];
        for (const n of walk(body)) if (n.kind === 'group' && n.capture !== null) capturesInside.push(n.capture);
        return register({
          kind: 'repeat',
          id,
          span,
          min: el.min,
          max: el.max,
          greedy: el.greedy,
          body,
          capturesInside,
        });
      }
      case 'Assertion': {
        switch (el.kind) {
          case 'start':
            return register({ kind: 'assert', id: nextId(), span, what: 'start', flags: f });
          case 'end':
            return register({ kind: 'assert', id: nextId(), span, what: 'end', flags: f });
          case 'word':
            return register({ kind: 'assert', id: nextId(), span, what: el.negate ? 'notWord' : 'word', flags: f });
          case 'lookahead': {
            hasLookaround = true;
            const id = nextId();
            nodes[id] = { kind: 'empty', id, span };
            const body = convertAlternatives(el.alternatives, span, f);
            return register({ kind: 'look', id, span, negate: el.negate, body });
          }
          case 'lookbehind': {
            hasLookaround = true;
            const bad = containsCaptureOrBackref(el);
            if (bad) {
              throw new PatternError(
                bad.type === 'CapturingGroup'
                  ? 'Lookbehind containing a capturing group is not supported yet'
                  : 'Lookbehind containing a backreference is not supported yet',
                bad.start,
                bad.end,
                true,
              );
            }
            // Walk for unsupported v-mode classes inside too.
            for (const a of el.alternatives) {
              const visit = (n: AST.Node): void => {
                if (n.type === 'CharacterClass' || n.type === 'ExpressionCharacterClass' || n.type === 'CharacterSet') {
                  checkClassSupported(n);
                } else if (n.type === 'Alternative') n.elements.forEach(visit);
                else if (n.type === 'Group' || (n.type === 'Assertion' && (n.kind === 'lookahead' || n.kind === 'lookbehind')))
                  n.alternatives.forEach(visit);
                else if (n.type === 'Quantifier') visit(n.element);
              };
              visit(a);
            }
            const probe = probes.length;
            let pf = '';
            if (f.ignoreCase) pf += 'i';
            if (f.multiline) pf += 'm';
            if (f.dotAll) pf += 's';
            if (f.unicode) pf += 'u';
            if (f.unicodeSets) pf += 'v';
            probes.push({ raw: el.raw, flags: pf + 'y' });
            return register({ kind: 'opaque', id: nextId(), span, label: el.negate ? '(?<!…)' : '(?<=…)', probe });
          }
        }
        break;
      }
      case 'Backreference': {
        hasBackrefs = true;
        const resolved = el.ambiguous ? el.resolved : [el.resolved];
        const groupsRef = resolved.map((g) => groupNumber.get(g)!);
        return register({ kind: 'backref', id: nextId(), span, groups: groupsRef, flags: f });
      }
    }
    const anyEl = el as AST.Node;
    throw new PatternError(`Unsupported syntax: ${anyEl.raw}`, anyEl.start, anyEl.end, true);
  };

  const rootFlags: EffectiveFlags = {
    ignoreCase: flags.ignoreCase,
    multiline: flags.multiline,
    dotAll: flags.dotAll,
    unicode: flags.unicode,
    unicodeSets: flags.unicodeSets,
  };
  const root = convertAlternatives(ast.alternatives, [ast.start, ast.end], rootFlags);
  // Ensure the root node is a seq so layout always has a top-level spine.
  const finalRoot: IR =
    root.kind === 'seq' ? root : register({ kind: 'seq', id: nextId(), span: [ast.start, ast.end], items: [root] });

  let leafCount = 0;
  for (const n of walk(finalRoot)) if (isLeaf(n)) leafCount++;

  return {
    source,
    flags,
    flagsText: flagsToString(flags),
    root: finalRoot,
    nodes,
    groupCount: groups.length,
    groupNames,
    testers,
    probes,
    hasBackrefs,
    hasLookaround,
    leafCount,
  };
}
