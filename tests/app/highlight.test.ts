import { describe, expect, it } from 'vitest';
import {
  nodeAtIndex,
  nodesWithin,
  segmentInput,
  segmentPattern,
  spanForNode,
} from '../../src/ui/highlight.ts';
import { parsePattern } from '../../src/engine/parse.ts';
import { walk } from '../../src/engine/ir.ts';

describe('pattern↔piece highlighting (M8)', () => {
  const program = parsePattern('c(a|o)t', '');

  it('maps every pattern index to the innermost IR node covering it', () => {
    const byId = (index: number) => {
      const id = nodeAtIndex(program, index);
      return id === null ? null : program.nodes[id];
    };
    expect(byId(0)?.kind).toBe('char');
    expect(byId(2)?.kind).toBe('char');
    expect(byId(6)?.kind).toBe('char');
    const paren = byId(1);
    expect(paren?.kind).toBe('group');
    expect(nodeAtIndex(program, -1)).toBeNull();
    expect(nodeAtIndex(program, program.source.length)).toBeNull();
  });

  it('spanForNode returns the source span and tolerates unknown ids', () => {
    const char = [...walk(program.root)].find((node) => node.kind === 'char')!;
    expect(spanForNode(program, char.id)).toEqual(char.span);
    expect(spanForNode(program, null)).toBeNull();
    expect(spanForNode(program, 9999)).toBeNull();
  });

  it('nodesWithin lights every node a hovered span covers, and nothing outside it', () => {
    const group = [...walk(program.root)].find((node) => node.kind === 'group')!;
    const inside = nodesWithin(program, group.span);
    expect(inside.has(group.id)).toBe(true);
    for (const node of program.nodes) {
      const covered = node.span[0] >= group.span[0] && node.span[1] <= group.span[1];
      expect(inside.has(node.id), `node ${node.id} ${node.kind}`).toBe(covered);
    }
    const firstChar = [...walk(program.root)].find((node) => node.kind === 'char')!;
    expect([...nodesWithin(program, firstChar.span)]).toEqual([firstChar.id]);
    expect(nodesWithin(program, null).size).toBe(0);
  });

  it('segmentPattern splits the source into marked runs with hover winning over active', () => {
    const segments = segmentPattern('c(a|o)t', [1, 5], [4, 7]);
    expect(segments).toEqual([
      { text: 'c', tone: null },
      { text: '(a|o', tone: 'hover' },
      { text: ')t', tone: 'active' },
    ]);
    expect(segmentPattern('c(a|o)t', null, [0, 1])).toEqual([
      { text: 'c', tone: 'active' },
      { text: '(a|o)t', tone: null },
    ]);
    expect(segmentPattern('abc', null, null)).toEqual([{ text: 'abc', tone: null }]);
  });

  it('segmentPattern clamps out-of-range spans instead of throwing', () => {
    const segments = segmentPattern('ab', [-5, 99], null);
    expect(segments).toEqual([{ text: 'ab', tone: 'hover' }]);
  });
});

describe('test-string highlighting', () => {
  const base = { attemptStart: 0, head: 0, match: null, captures: [] };
  const tones = (input: string, reading: Parameters<typeof segmentInput>[1]) =>
    segmentInput(input, reading).map((segment) => [segment.text, segment.tone]);

  it('leaves the string plain before playback, with a trailing end-of-string slot', () => {
    expect(tones('abc', null)).toEqual([
      ['abc', null],
      [' ', null],
    ]);
  });

  it('marks failed start positions, the live read span and the head', () => {
    expect(tones('xxabc', { ...base, phase: 'running', attemptStart: 2, head: 4 })).toEqual([
      ['xx', 'tried'],
      ['ab', 'read'],
      ['c', 'head'],
      [' ', null],
    ]);
    expect(tones('ab', { ...base, phase: 'running', attemptStart: 0, head: 2 }).at(-1)).toEqual([
      ' ',
      'head',
    ]);
  });

  it('gilds the final match and dims everything on no match', () => {
    const matched = {
      ...base,
      phase: 'matched' as const,
      attemptStart: 1,
      head: 3,
      match: { start: 1, end: 3 },
    };
    expect(tones('xaby', matched)).toEqual([
      ['x', 'tried'],
      ['ab', 'match'],
      ['y', null],
      [' ', null],
    ]);
    expect(tones('ab', { ...base, phase: 'nomatch', attemptStart: 2, head: 2 })[0]).toEqual(['ab', 'tried']);
  });

  it('tags runs with the innermost capture group', () => {
    const segments = segmentInput('abcd', {
      ...base,
      phase: 'matched',
      head: 4,
      match: { start: 0, end: 4 },
      captures: [
        { start: 0, end: 4 },
        { start: 0, end: 3 },
        { start: 1, end: 2 },
      ],
    });
    expect(segments.map((segment) => [segment.text, segment.group])).toEqual([
      ['a', 1],
      ['b', 2],
      ['c', 1],
      ['d', null],
      [' ', null],
    ]);
  });
});
