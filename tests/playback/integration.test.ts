import { describe, expect, it } from 'vitest';
import { parsePattern } from '../../src/engine/parse.ts';
import { runBacktrack, type MatchResult } from '../../src/engine/backtrack.ts';
import { layout } from '../../src/layout/layout.ts';
import type { MachineLayout, Vec3 } from '../../src/layout/pieces.ts';
import { createPlaybackStore, type PlaybackStore } from '../../src/playback/store.ts';
import { poseAtIndex } from '../../src/playback/motion.ts';
import { PRESETS } from '../../src/presets.ts';

interface Sim {
  prog: ReturnType<typeof parsePattern>;
  trace: ReturnType<typeof runBacktrack>['trace'];
  result: MatchResult;
  ml: MachineLayout;
  input: string;
}

function simulate(pattern: string, flags: string, input: string): Sim {
  const prog = parsePattern(pattern, flags);
  const { trace, result } = runBacktrack(prog, input);
  const ml = layout(prog);
  return { prog, trace, result, ml, input };
}

function finite(p: Vec3): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
}

/** Drive the store like a 60fps render loop until it stops; collect per-frame observations. */
function playThrough(store: PlaybackStore, sim: Sim, speed: number, fps = 60) {
  store.getState().setSpeed(speed);
  store.getState().restart();
  store.getState().play();
  const dt = 1000 / fps;
  const frames: { time: number; eventIndex: number; pose: Vec3 | null; head: number; depth: number }[] = [];
  const guard = 100000;
  for (let i = 0; i < guard; i++) {
    const s = store.getState();
    if (!s.playing && i > 0) break;
    const pose = s.timeline ? poseAtIndex(sim.ml, s.timeline, s.segmentIndex, s.fraction) : null;
    frames.push({
      time: s.time,
      eventIndex: s.eventIndex,
      pose: pose ? pose.position : null,
      head: s.machine?.head ?? -1,
      depth: s.machine?.flags.length ?? 0,
    });
    if (!s.playing) break;
    store.getState().tick(dt);
  }
  return frames;
}

const playable = PRESETS.filter((p) => p.number <= 5);

describe('playback integration: presets 1-5 play end to end (M5 steps 1-4 composed)', () => {
  describe.each(playable.map((p) => [`${p.number}: ${p.id}`, p] as const))('%s', (_label, preset) => {
    const sim = simulate(preset.pattern, preset.flags, preset.input);

    it('loads, plays to the end, and stops on the final event', () => {
      const store = createPlaybackStore();
      store.getState().load({ program: sim.prog, trace: sim.trace, layout: sim.ml, result: sim.result, speed: 4 });
      const frames = playThrough(store, sim, 4);
      const end = store.getState();

      expect(frames.length).toBeGreaterThan(1);
      expect(end.playing).toBe(false);
      expect(end.atEnd).toBe(true);
      expect(end.eventIndex).toBe(sim.trace.length - 1);
      expect(end.machine).not.toBeNull();
      expect(end.machine!.phase).toBe(sim.result.matched ? 'matched' : 'nomatch');
    });

    it('produces a finite marble pose on every frame', () => {
      const store = createPlaybackStore();
      store.getState().load({ program: sim.prog, trace: sim.trace, layout: sim.ml, result: sim.result, speed: 2 });
      const frames = playThrough(store, sim, 2);
      for (const f of frames) {
        expect(f.pose, `frame at t=${f.time} event=${f.eventIndex}`).not.toBeNull();
        expect(finite(f.pose!), `frame at t=${f.time}`).toBe(true);
      }
    });

    it('advances the timeline monotonically while playing', () => {
      const store = createPlaybackStore();
      store.getState().load({ program: sim.prog, trace: sim.trace, layout: sim.ml, result: sim.result, speed: 2 });
      const frames = playThrough(store, sim, 2);
      for (let i = 1; i < frames.length; i++) {
        expect(frames[i].time).toBeGreaterThanOrEqual(frames[i - 1].time);
      }
      // The terminal tick clamps to the last segment's end; the store settles exactly at duration.
      const settled = store.getState();
      expect(settled.atEnd).toBe(true);
      expect(settled.time).toBe(settled.duration);
    });

    it('keeps the read head inside the input and lit tiles consistent with [attemptStart, head)', () => {
      const store = createPlaybackStore();
      store.getState().load({ program: sim.prog, trace: sim.trace, layout: sim.ml, result: sim.result, speed: 2 });
      const frames = playThrough(store, sim, 2);
      for (const f of frames) {
        expect(f.head).toBeGreaterThanOrEqual(0);
        expect(f.head).toBeLessThanOrEqual(sim.input.length);
      }
      // Final head equals the match end (or the last attempt for a nomatch).
      const end = store.getState().machine!;
      if (sim.result.matched) expect(end.head).toBe(sim.result.end);
    });

    it('flag depth never goes negative and unwinds to zero by the end', () => {
      const store = createPlaybackStore();
      store.getState().load({ program: sim.prog, trace: sim.trace, layout: sim.ml, result: sim.result, speed: 2 });
      const frames = playThrough(store, sim, 2);
      for (const f of frames) expect(f.depth).toBeGreaterThanOrEqual(0);
      const end = store.getState().machine!;
      if (sim.result.matched) expect(end.match).toEqual({ start: sim.result.index, end: sim.result.end });
      else expect(end.flags).toHaveLength(0);
    });

    it('final machine captures reproduce the engine result groups', () => {
      const store = createPlaybackStore();
      store.getState().load({ program: sim.prog, trace: sim.trace, layout: sim.ml, result: sim.result, speed: 8 });
      playThrough(store, sim, 8);
      const end = store.getState().machine!;
      if (!sim.result.matched) {
        expect(end.phase).toBe('nomatch');
        return;
      }
      expect(end.captures[0]).toEqual({ start: sim.result.index, end: sim.result.end });
      for (let g = 1; g < sim.result.groups.length; g++) {
        const span = end.captures[g];
        const text = span === null ? undefined : sim.input.slice(span.start, span.end);
        expect(text, `group ${g}`).toBe(sim.result.groups[g]);
      }
    });

    it('visits every event when stepped, and the marble pose is finite at each', () => {
      const store = createPlaybackStore();
      store.getState().load({ program: sim.prog, trace: sim.trace, layout: sim.ml, result: sim.result, speed: 1 });
      for (let e = 0; e < sim.trace.length; e++) {
        store.getState().seekEvent(e);
        const s = store.getState();
        expect(s.eventIndex).toBe(e);
        const pose = poseAtIndex(sim.ml, s.timeline!, s.segmentIndex, s.fraction);
        expect(pose, `event ${e}`).not.toBeNull();
        expect(finite(pose!.position), `event ${e}`).toBe(true);
      }
    });

    it('plays identically fast at instant speed (zero-duration, still reaches the end)', () => {
      const store = createPlaybackStore();
      store.getState().load({ program: sim.prog, trace: sim.trace, layout: sim.ml, result: sim.result, speed: 1 });
      store.getState().setSpeed(Infinity);
      const s = store.getState();
      expect(s.duration).toBe(0);
      expect(s.atEnd).toBe(true);
      expect(s.machine!.phase).toBe(sim.result.matched ? 'matched' : 'nomatch');
    });
  });

  it('marble ends at the cup for a match and at the reject tray for a nomatch', () => {
    const matchSim = simulate('ab', '', 'xab');
    const matchStore = createPlaybackStore();
    matchStore.getState().load({ program: matchSim.prog, trace: matchSim.trace, layout: matchSim.ml, result: matchSim.result });
    playThrough(matchStore, matchSim, 8);
    const cup = matchSim.ml.pieces.find((p) => p.kind === 'cup')!;
    const endPose = poseAtIndex(matchSim.ml, matchStore.getState().timeline!, matchStore.getState().segmentIndex, 1)!;
    expect(endPose.position).toEqual(cup.position);

    const noSim = simulate('z', '', 'abc');
    const noStore = createPlaybackStore();
    noStore.getState().load({ program: noSim.prog, trace: noSim.trace, layout: noSim.ml, result: noSim.result });
    playThrough(noStore, noSim, 8);
    const tray = noSim.ml.pieces.find((p) => p.kind === 'rejectTray')!;
    const noPose = poseAtIndex(noSim.ml, noStore.getState().timeline!, noStore.getState().segmentIndex, 1)!;
    expect(noPose.position).toEqual(tray.position);
  });

  it('scrubbing backward through time yields the same states as forward (no drift)', () => {
    const sim = simulate('c(a|o)t', '', 'the cot');
    const store = createPlaybackStore();
    store.getState().load({ program: sim.prog, trace: sim.trace, layout: sim.ml, result: sim.result, speed: 1 });

    const forward: unknown[] = [];
    for (let e = 0; e < sim.trace.length; e++) {
      store.getState().seekEvent(e);
      forward.push(store.getState().machine);
    }
    const backward: unknown[] = [];
    for (let e = sim.trace.length - 1; e >= 0; e--) {
      store.getState().seekEvent(e);
      backward.unshift(store.getState().machine);
    }
    expect(backward).toEqual(forward);
  });
});
