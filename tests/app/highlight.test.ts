import { describe, expect, it } from 'vitest';
import { nodeAtIndex, nodesWithin, segmentPattern, spanForNode } from '../../src/ui/highlight.ts';
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
