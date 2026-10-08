import fc from 'fast-check';

/** Pattern AST used only by the fuzzer to render syntactically valid ECMAScript regexes. */
export type GenNode =
  | { k: 'lit'; c: string }
  | { k: 'class'; body: string; neg: boolean }
  | { k: 'dot' }
  | { k: 'esc'; c: string }
  | { k: 'assert'; c: string }
  | { k: 'group'; mode: 'cap' | 'named' | 'non' | 'mod'; mod?: string; body: GenNode }
  | { k: 'look'; neg: boolean; body: GenNode }
  | { k: 'backref'; pick: number; named: boolean }
  | { k: 'quant'; body: GenNode; q: string; lazy: boolean }
  | { k: 'seq'; items: GenNode[] }
  | { k: 'alt'; branches: GenNode[] };

const lit = fc.constantFrom('a', 'b', 'c', 'A', ' ', '1').map((c): GenNode => ({ k: 'lit', c }));
const cls = fc
  .record({
    body: fc.constantFrom('a', 'ab', 'a-c', 'A', 'a1', '\\d', '\\w', '\\s', 'b-c1', 'aA', '^', ' \\n'),
    neg: fc.boolean(),
  })
  .map((r): GenNode => ({ k: 'class', ...r }));
const dot = fc.constant<GenNode>({ k: 'dot' });
const esc = fc.constantFrom('\\d', '\\w', '\\s', '\\D', '\\W', '\\S', '\\n').map((c): GenNode => ({ k: 'esc', c }));
const assertion = fc.constantFrom('^', '$', '\\b', '\\B').map((c): GenNode => ({ k: 'assert', c }));
const backref = fc
  .record({ pick: fc.double({ min: 0, max: 1, noNaN: true, maxExcluded: true }), named: fc.boolean() })
  .map((r): GenNode => ({ k: 'backref', ...r }));
const quantOp = fc.constantFrom('*', '+', '?', '{2}', '{1,2}', '{0,3}', '{2,}', '{0}', '{1}', '{0,1}');

export const { pattern: genPattern } = fc.letrec<{ pattern: GenNode; atom: GenNode; piece: GenNode }>((tie) => ({
  atom: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    lit,
    lit,
    lit,
    cls,
    dot,
    esc,
    backref,
    fc
      .record({
        mode: fc.constantFrom('cap', 'cap', 'named', 'non', 'mod') as fc.Arbitrary<'cap' | 'named' | 'non' | 'mod'>,
        mod: fc.constantFrom('i', '-i', 'm', 's', 'i-m', 'ms-i'),
        body: tie('pattern'),
      })
      .map((r): GenNode => ({ k: 'group', ...r })),
    fc.record({ neg: fc.boolean(), body: tie('pattern') }).map((r): GenNode => ({ k: 'look', ...r })),
  ),
  piece: fc.oneof(
    { depthSize: 'small' },
    tie('atom'),
    tie('atom'),
    assertion,
    fc
      .record({ body: tie('atom'), q: quantOp, lazy: fc.boolean() })
      .map((r): GenNode => ({ k: 'quant', ...r })),
  ),
  pattern: fc.oneof(
    { depthSize: 'small' },
    fc.array(tie('piece'), { minLength: 0, maxLength: 5 }).map((items): GenNode => ({ k: 'seq', items })),
    fc.array(tie('piece'), { minLength: 1, maxLength: 4 }).map((items): GenNode => ({ k: 'seq', items })),
    fc
      .array(
        fc.array(tie('piece'), { minLength: 0, maxLength: 3 }).map((items): GenNode => ({ k: 'seq', items })),
        { minLength: 2, maxLength: 3 },
      )
      .map((branches): GenNode => ({ k: 'alt', branches })),
  ),
}));

export interface Rendered {
  source: string;
  groupCount: number;
  names: string[];
}

function countGroups(n: GenNode, acc: { count: number; names: string[] }): void {
  switch (n.k) {
    case 'group':
      if (n.mode === 'cap') acc.count++;
      if (n.mode === 'named') {
        acc.count++;
        acc.names.push('n' + acc.count);
      }
      countGroups(n.body, acc);
      break;
    case 'look':
    case 'quant':
      countGroups(n.body, acc);
      break;
    case 'seq':
      n.items.forEach((i) => countGroups(i, acc));
      break;
    case 'alt':
      n.branches.forEach((i) => countGroups(i, acc));
      break;
    default:
      break;
  }
}

export function renderPattern(root: GenNode): Rendered {
  const acc = { count: 0, names: [] as string[] };
  countGroups(root, acc);
  let groupIdx = 0;
  const quantifiable = (n: GenNode): boolean =>
    n.k === 'lit' || n.k === 'class' || n.k === 'dot' || n.k === 'esc' || n.k === 'group' || n.k === 'backref';
  const render = (n: GenNode): string => {
    switch (n.k) {
      case 'lit':
        return n.c;
      case 'class':
        return `[${n.neg ? '^' : ''}${n.body}]`;
      case 'dot':
        return '.';
      case 'esc':
        return n.c;
      case 'assert':
        return n.c;
      case 'group': {
        if (n.mode === 'cap') {
          groupIdx++;
          return `(${render(n.body)})`;
        }
        if (n.mode === 'named') {
          groupIdx++;
          return `(?<n${groupIdx}>${render(n.body)})`;
        }
        if (n.mode === 'mod') return `(?${n.mod}:${render(n.body)})`;
        return `(?:${render(n.body)})`;
      }
      case 'look':
        return `(?${n.neg ? '!' : '='}${render(n.body)})`;
      case 'backref': {
        if (acc.count === 0) return 'b';
        if (n.named && acc.names.length > 0) {
          const name = acc.names[Math.floor(n.pick * acc.names.length)];
          return `\\k<${name}>`;
        }
        return `\\${1 + Math.floor(n.pick * acc.count)}`;
      }
      case 'quant': {
        const body = quantifiable(n.body) ? render(n.body) : `(?:${render(n.body)})`;
        return `${body}${n.q}${n.lazy ? '?' : ''}`;
      }
      case 'seq':
        return n.items.map(render).join('');
      case 'alt':
        return n.branches.map(render).join('|');
    }
  };
  const source = render(root);
  return { source, groupCount: acc.count, names: acc.names };
}

export const genString = fc
  .array(fc.constantFrom('a', 'b', 'c', 'A', '\n', ' ', '1'), { minLength: 0, maxLength: 12 })
  .map((xs) => xs.join(''));

export const genFlags = fc
  .record({
    i: fc.boolean(),
    m: fc.boolean(),
    s: fc.boolean(),
    u: fc.constantFrom('', '', 'u', 'v'),
    y: fc.boolean(),
  })
  .map((f) => (f.i ? 'i' : '') + (f.m ? 'm' : '') + (f.s ? 's' : '') + f.u + (f.y ? 'y' : ''));

/** Regular-only subset for the Pike VM: no backreferences, no lookarounds. */
export function isRegular(n: GenNode): boolean {
  switch (n.k) {
    case 'backref':
    case 'look':
      return false;
    case 'group':
    case 'quant':
      return isRegular(n.body);
    case 'seq':
      return n.items.every(isRegular);
    case 'alt':
      return n.branches.every(isRegular);
    default:
      return true;
  }
}

export const genCase = fc.record({ pattern: genPattern, input: genString, flags: genFlags });
