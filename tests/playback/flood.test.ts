import { describe, expect, it } from 'vitest';
import { runBacktrack } from '../../src/engine/backtrack.ts';
import { parsePattern } from '../../src/engine/parse.ts';
import { CHECKPOINT_EVERY } from '../../src/engine/trace.ts';
import { layout } from '../../src/layout/layout.ts';
import {
  COLUMN_VISIBLE_CAP,
  FLOOD_MARBLE_CAP,
  FLOOD_STEP_THRESHOLD,
  flagColumns,
  floodAt,
  floodModel,
  marblesPerSample,
  shouldFlood,
  tankGraduations,
  tankLevel,
  tankMarblePositions,
} from '../../src/playback/flood.ts';
import { TraceCursor } from '../../src/playback/state.ts';
import { PRESETS } from '../../src/presets.ts';

const BUDGET = { wallMs: 2500, maxSteps: 20_000_000 } as const;

function run(pattern: string, input: string, flags = '', opts: Record<string, unknown> = {}) {
  const program = parsePattern(pattern, flags);
  const { trace, result } = runBacktrack(program, input, { ...BUDGET, ...opts });
  return { program, trace, result, machine: layout(program) };
}

const CATASTROPHIC = PRESETS.filter((p) => p.number >= 6);
const CALM = PRESETS.filter((p) => p.number <= 5);
const EVIL = PRESETS.find((p) => p.number === 6)!;

describe('flood sampler (M6)', () => {
  it('activates for truncated or long runs (presets 6-9) and stays off for presets 1-5', () => {
    for (const preset of CATASTROPHIC) {
      const b = run(preset.pattern, preset.input, preset.flags);
      expect(b.trace.truncated, preset.id).toBe(true);
      if (preset.number === 9) expect(b.result.gaveUp, preset.id).toBe(true);
      expect(shouldFlood(b.result, b.trace), preset.id).toBe(true);
      expect(floodModel(b.result, b.trace), preset.id).not.toBeNull();
    }
    for (const preset of CALM) {
      const b = run(preset.pattern, preset.input, preset.flags);
      expect(b.result.steps, preset.id).toBeLessThanOrEqual(FLOOD_STEP_THRESHOLD);
      expect(shouldFlood(b.result, b.trace), preset.id).toBe(false);
      expect(floodModel(b.result, b.trace), preset.id).toBeNull();
    }
    expect(shouldFlood({ steps: FLOOD_STEP_THRESHOLD + 1, gaveUp: false }, { truncated: false })).toBe(true);
    expect(shouldFlood({ steps: 10, gaveUp: true }, { truncated: false })).toBe(true);
    expect(shouldFlood({ steps: 10, gaveUp: false }, { truncated: true })).toBe(true);
  });

  it('floods an untruncated run that merely exceeds the step threshold', () => {
    const b = run('^(a+)+$', `${'a'.repeat(11)}!`);
    expect(b.trace.truncated).toBe(false);
    expect(b.result.steps).toBeGreaterThan(FLOOD_STEP_THRESHOLD);
    const model = floodModel(b.result, b.trace)!;
    expect(model.truncated).toBe(false);
    expect(model.samples[0]).toEqual({ step: 0, depth: 0, pos: 0, backtracks: 0 });
    expect(model.samples.at(-1)).toMatchObject({ step: b.result.steps, backtracks: b.result.backtracks });
    expect(model.samples.length).toBeGreaterThan(2);
  });

  it('chooses one marble per power of ten so the pile never exceeds the instance cap', () => {
    expect(marblesPerSample(0)).toBe(1);
    expect(marblesPerSample(FLOOD_MARBLE_CAP)).toBe(1);
    expect(marblesPerSample(FLOOD_MARBLE_CAP + 1)).toBe(10);
    expect(marblesPerSample(131_070)).toBe(100);
    expect(marblesPerSample(1_999_002)).toBe(1000);
    expect(marblesPerSample(10 ** 8)).toBe(10_000);
    for (const preset of CATASTROPHIC) {
      const b = run(preset.pattern, preset.input, preset.flags);
      const model = floodModel(b.result, b.trace)!;
      expect(model.marbles).toBeLessThanOrEqual(FLOOD_MARBLE_CAP);
      expect(model.marbles).toBe(Math.ceil(b.result.backtracks / model.perMarble));
      expect(Math.log10(model.perMarble) % 1).toBe(0);
    }
  });

  it('log-scales the tank from 10^2 to 10^8', () => {
    expect(tankLevel(0)).toBe(0);
    expect(tankLevel(10)).toBe(0);
    expect(tankLevel(100)).toBeCloseTo(1 / 7);
    expect(tankLevel(10 ** 8)).toBe(1);
    expect(tankLevel(10 ** 9)).toBe(1);
    const marks = tankGraduations();
    expect(marks.map((m) => m.value)).toEqual([100, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8]);
    for (let i = 1; i < marks.length; i++) expect(marks[i].level).toBeGreaterThan(marks[i - 1].level);
    expect(marks.at(-1)!.level).toBe(1);
  });

  it('samples every checkpoint interval through recording and count-only phases, monotonically', () => {
    for (const preset of CATASTROPHIC) {
      const b = run(preset.pattern, preset.input, preset.flags);
      const model = floodModel(b.result, b.trace)!;
      const steps = model.samples.map((s) => s.step);
      for (let i = 1; i < steps.length; i++) expect(steps[i]).toBeGreaterThan(steps[i - 1]);
      for (let i = 1; i < model.samples.length; i++) {
        expect(model.samples[i].backtracks).toBeGreaterThanOrEqual(model.samples[i - 1].backtracks);
        expect(model.samples[i].depth).toBeGreaterThanOrEqual(0);
        expect(model.samples[i].depth).toBeLessThanOrEqual(model.maxDepth);
        expect(model.samples[i].pos).toBeGreaterThanOrEqual(0);
        expect(model.samples[i].pos).toBeLessThanOrEqual(preset.input.length);
      }
      const recorded = model.samples.filter((s) => s.step > 0 && s.step % CHECKPOINT_EVERY === 0);
      expect(recorded.length).toBeGreaterThanOrEqual(Math.floor(b.result.steps / CHECKPOINT_EVERY) - 1);
      expect(model.samples.at(-1)).toMatchObject({ step: b.result.steps, backtracks: b.result.backtracks });
      expect(model.level).toBe(tankLevel(b.result.backtracks));
    }
  });

  it('interpolates frames by progress and lands exactly on the final totals', () => {
    const b = run(EVIL.pattern, EVIL.input, EVIL.flags);
    const model = floodModel(b.result, b.trace)!;
    expect(floodAt(model, 0)).toEqual({ step: 0, depth: 0, peakDepth: 0, pos: 0, backtracks: 0, marbles: 0, level: 0 });
    const end = floodAt(model, 1);
    expect(end).toMatchObject({ step: model.steps, backtracks: model.backtracks, marbles: model.marbles, level: model.level });
    expect(floodAt(model, 2)).toEqual(end);
    expect(end.peakDepth).toBe(Math.max(...model.samples.map((s) => s.depth)));
    expect(end.peakDepth).toBeGreaterThan(0);
    let last = floodAt(model, 0);
    for (let p = 0.05; p <= 1; p += 0.05) {
      const frame = floodAt(model, p);
      expect(frame.step).toBeGreaterThanOrEqual(last.step);
      expect(frame.backtracks).toBeGreaterThanOrEqual(last.backtracks);
      expect(frame.marbles).toBeGreaterThanOrEqual(last.marbles);
      expect(frame.marbles).toBeLessThanOrEqual(model.marbles);
      expect(frame.depth).toBeLessThanOrEqual(model.maxDepth);
      expect(frame.peakDepth).toBeGreaterThanOrEqual(frame.depth);
      expect(frame.peakDepth).toBeGreaterThanOrEqual(last.peakDepth);
      expect(frame.peakDepth).toBeLessThanOrEqual(model.maxDepth);
      last = frame;
    }
  });

  it('grows flag columns on the diverters that held the recorded flags, capped per column', () => {
    const b = run(EVIL.pattern, EVIL.input, EVIL.flags);
    const model = floodModel(b.result, b.trace)!;
    const recorded = new TraceCursor(b.program, b.trace).stateAt(b.trace.length).flags;
    expect(recorded.length).toBeGreaterThan(0);
    const depth = floodAt(model, 1).peakDepth;
    const columns = flagColumns(b.machine, recorded, Math.max(depth, 30));
    expect(columns.length).toBeGreaterThan(0);
    expect(columns.reduce((sum, c) => sum + c.depth, 0)).toBe(Math.max(depth, 30));
    for (const column of columns) {
      expect(b.machine.anchors[column.node].flagSlot).toEqual(column.position);
      expect(column.visible).toBeLessThanOrEqual(COLUMN_VISIBLE_CAP);
      expect(column.visible).toBe(Math.min(COLUMN_VISIBLE_CAP, column.depth));
      expect(recorded.some((flag) => flag.node === column.node)).toBe(true);
    }
    expect(flagColumns(b.machine, recorded, 0)).toEqual([]);
    const fallback = flagColumns(b.machine, [], 7);
    expect(fallback.reduce((sum, c) => sum + c.depth, 0)).toBe(7);
    expect(fallback.length).toBeGreaterThan(0);
  });

  it('piles marbles inside the tank up to the log-scaled fill level', () => {
    const tank = { width: 2, depth: 2, height: 6, radius: 0.08 };
    for (const [count, level] of [
      [1, 0.05],
      [400, 0.4],
      [FLOOD_MARBLE_CAP, 1],
    ] as const) {
      const positions = tankMarblePositions(count, level, tank);
      expect(positions).toHaveLength(count * 3);
      let top = 0;
      for (let i = 0; i < count; i++) {
        const x = positions[i * 3];
        const y = positions[i * 3 + 1];
        const z = positions[i * 3 + 2];
        expect(Math.abs(x)).toBeLessThanOrEqual(tank.width / 2 - tank.radius + 1e-6);
        expect(Math.abs(z)).toBeLessThanOrEqual(tank.depth / 2 - tank.radius + 1e-6);
        expect(y).toBeGreaterThanOrEqual(tank.radius - 1e-6);
        top = Math.max(top, y);
      }
      expect(top).toBeLessThanOrEqual(Math.max(tank.radius * 2, level * tank.height) + tank.radius);
    }
    expect(tankMarblePositions(0, 1, tank)).toHaveLength(0);
    expect(tankMarblePositions(50, 0.5, tank)).toEqual(tankMarblePositions(50, 0.5, tank));
  });
});
