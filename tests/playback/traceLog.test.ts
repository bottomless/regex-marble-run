import { describe, expect, it } from 'vitest';
import { parsePattern } from '../../src/engine/parse.ts';
import { runBacktrack } from '../../src/engine/backtrack.ts';
import { T } from '../../src/engine/trace.ts';
import { describeEvent, formatLog, LOG_COPY_CAP, nodeLabel } from '../../src/playback/traceLog.ts';
import { copy } from '../../src/copy.ts';
import { PRESETS } from '../../src/presets.ts';

function run(pattern: string, flags: string, input: string) {
  const program = parsePattern(pattern, flags);
  const { trace } = runBacktrack(program, input);
  return { program, trace };
}

describe('trace log (M8)', () => {
  it('describes the first ride with plain sentences', () => {
    const preset = PRESETS[0];
    const { program, trace } = run(preset.pattern, preset.flags, preset.input);
    expect(trace.length).toBeGreaterThan(0);
    const firstAttempt = trace.t.indexOf(T.attempt);
    expect(describeEvent(program, preset.input, trace, firstAttempt)).toBe(copy.traceLog.attempt(0));

    const testAt = trace.t.indexOf(T.test);
    const testLine = describeEvent(program, preset.input, trace, testAt);
    expect(testLine).toMatch(/^pos \d+ · gate c vs ".*" → (passes|rejected)$/);

    const chooseAt = trace.t.indexOf(T.choose);
    expect(describeEvent(program, preset.input, trace, chooseAt)).toBe(
      copy.traceLog.branch(1, 2, 5),
    );

    const matchAt = trace.t.indexOf(T.match);
    expect(describeEvent(program, preset.input, trace, matchAt)).toBe(copy.traceLog.match(4, 7));
  });

  it('describes backtracking through a diverter', () => {
    const preset = PRESETS[0];
    const { program, trace } = run(preset.pattern, preset.flags, preset.input);
    const backAt = trace.t.indexOf(T.backtrack);
    expect(backAt).toBeGreaterThan(-1);
    const line = describeEvent(program, preset.input, trace, backAt);
    expect(line).toContain('back to the diverter');
  });

  it('describes loop choices, sensors and the final no-match', () => {
    const { program, trace } = run('^a+$', '', 'aa!');
    const chooseAt = trace.t.indexOf(T.choose);
    expect(describeEvent(program, 'aa!', trace, chooseAt)).toBe(
      copy.traceLog.loopChoice('again', 1),
    );
    const lines = Array.from({ length: trace.length }, (_, i) => describeEvent(program, 'aa!', trace, i));
    expect(lines.some((line) => line.includes('sensor $'))).toBe(true);
    expect(lines.at(-1)).toBe(copy.traceLog.nomatch);
  });

  it('describes captures, scouts and mirrors', () => {
    const backref = PRESETS.find((p) => p.id === 'backreference')!;
    const { program, trace } = run(backref.pattern, backref.flags, backref.input);
    const lines = Array.from({ length: trace.length }, (_, i) =>
      describeEvent(program, backref.input, trace, i),
    );
    expect(lines.some((line) => line.startsWith('capture 1 = '))).toBe(true);
    expect(lines.some((line) => line.includes('mirror \\1'))).toBe(true);

    const look = PRESETS.find((p) => p.id === 'lookahead-password')!;
    const lookRun = run(look.pattern, look.flags, look.input);
    const lookStart = lookRun.trace.t.indexOf(T.look);
    expect(describeEvent(lookRun.program, look.input, lookRun.trace, lookStart)).toBe(
      copy.traceLog.scoutStart,
    );
    const lookLines = Array.from({ length: lookRun.trace.length }, (_, i) =>
      describeEvent(lookRun.program, look.input, lookRun.trace, i),
    );
    expect(lookLines.some((line) => line.startsWith('scout returns:'))).toBe(true);
  });

  it('labels sensors and quotes whitespace visibly', () => {
    const { program } = run('\\b\\d\\n', '', '1\n');
    expect(nodeLabel(program, program.nodes.findIndex((n) => n.kind === 'assert'))).toBe('\\b');
    const { trace } = run('\\n', '', '\n');
    const testAt = trace.t.indexOf(T.test);
    expect(describeEvent(parsePattern('\\n', ''), '\n', trace, testAt)).toContain('"⏎"');
  });

  it('formatLog numbers the steps and caps very long logs', () => {
    const preset = PRESETS[0];
    const { program, trace } = run(preset.pattern, preset.flags, preset.input);
    const text = formatLog(program, preset.input, trace);
    const lines = text.split('\n');
    expect(lines).toHaveLength(trace.length);
    expect(lines[0]).toMatch(/^1\. /);
    expect(lines.at(-1)).toContain(copy.traceLog.match(4, 7));

    const longInput = 'a'.repeat(LOG_COPY_CAP);
    const long = run('z', '', longInput);
    expect(long.trace.length).toBeGreaterThan(LOG_COPY_CAP);
    const capped = formatLog(long.program, longInput, long.trace).split('\n');
    expect(capped).toHaveLength(LOG_COPY_CAP + 1);
    expect(capped.at(-1)).toBe(copy.traceLog.copyCap(long.trace.length - LOG_COPY_CAP));
  });
});
