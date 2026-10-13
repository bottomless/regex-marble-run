import { createStore, type StoreApi } from 'zustand/vanilla';
import type { Program } from '../engine/ir.ts';
import type { Trace } from '../engine/trace.ts';
import type { MatchResult } from '../engine/backtrack.ts';
import type { MachineLayout } from '../layout/pieces.ts';
import { DEFAULT_KEYFRAME_EVERY, TraceCursor, type MachineState } from './state.ts';
import { buildTimeline, segmentAt, INSTANT, type Timeline } from './timeline.ts';
import { buildCounters, type NativeTiming, type RunCounters } from './counters.ts';
import type { LinearRun } from './linear.ts';

export interface PlaybackLoadInput {
  program: Program;
  trace: Trace;
  layout: MachineLayout;
  result?: MatchResult;
  speed?: number;
}

export type LinearState =
  | { status: 'off' }
  | { status: 'running' }
  | { status: 'ready'; run: LinearRun }
  | { status: 'unavailable'; message: string }
  | { status: 'error'; message: string };

type Preserve =
  | { kind: 'start' }
  | { kind: 'end' }
  | { kind: 'segment'; index: number; fraction: number }
  | { kind: 'event'; event: number };

export interface PlaybackState {
  program: Program | null;
  trace: Trace | null;
  layout: MachineLayout | null;
  result: MatchResult | null;
  cursor: TraceCursor | null;
  counters: RunCounters | null;
  /** Native RegExp timing for the same pattern/input; independent of the trace lifecycle. */
  native: NativeTiming | null;
  /** Linear-time run for the side-by-side view; null in single mode or while the Pike engine runs. */
  linear: LinearState;
  timeline: Timeline | null;
  /** eventStarts[e] = time (ms) the first segment of event `e` begins; entry [eventCount] is duration. */
  eventStarts: number[];
  /** eventSegment[e] = index of the first segment animating event `e`. */
  eventSegment: number[];

  time: number;
  duration: number;
  speed: number;
  playing: boolean;
  follow: boolean;
  atStart: boolean;
  atEnd: boolean;

  segmentIndex: number;
  eventIndex: number;
  eventCount: number;
  fraction: number;
  machine: MachineState | null;

  load(input: PlaybackLoadInput): void;
  reset(): void;
  play(): void;
  pause(): void;
  toggle(): void;
  restart(): void;
  setSpeed(speed: number): void;
  setLayout(layout: MachineLayout): void;
  seek(time: number): void;
  seekFraction(fraction: number): void;
  seekEvent(event: number): void;
  stepForward(): void;
  stepBack(): void;
  tick(deltaMs: number): void;
  toggleFollow(): void;
  setNative(native: NativeTiming | null): void;
  setLinear(linear: LinearState): void;
}

export type PlaybackStore = StoreApi<PlaybackState>;

function clamp(value: number, lo: number, hi: number): number {
  return value < lo ? lo : value > hi ? hi : value;
}

interface EventMaps {
  eventStarts: number[];
  eventSegment: number[];
}

function eventMapsFor(timeline: Timeline): EventMaps {
  const eventStarts = new Array<number>(timeline.eventCount + 1).fill(timeline.duration);
  const eventSegment = new Array<number>(timeline.eventCount).fill(-1);
  for (let i = 0; i < timeline.segments.length; i++) {
    const ev = timeline.segments[i].event;
    if (ev >= 0 && ev < timeline.eventCount && eventSegment[ev] === -1) {
      eventSegment[ev] = i;
      eventStarts[ev] = timeline.segments[i].t0;
    }
  }
  eventStarts[timeline.eventCount] = timeline.duration;
  return { eventStarts, eventSegment };
}

export function createPlaybackStore(): PlaybackStore {
  return createStore<PlaybackState>()((set, get) => {
    function empty(extra: Partial<PlaybackState> = {}): void {
      const s = get();
      set({
        time: 0,
        segmentIndex: -1,
        eventIndex: -1,
        fraction: 0,
        machine: s.cursor ? s.cursor.stateAt(0) : null,
        atStart: true,
        atEnd: true,
        duration: s.timeline?.duration ?? 0,
        eventCount: s.timeline?.eventCount ?? 0,
        ...extra,
      });
    }

    /** Authoritative position setter: (segment index, fraction within that segment). */
    function syncSegment(index: number, fraction: number, force: boolean, extra: Partial<PlaybackState> = {}): void {
      const s = get();
      const timeline = s.timeline;
      const cursor = s.cursor;
      if (!timeline || timeline.segments.length === 0 || !cursor) {
        empty(extra);
        return;
      }
      const idx = clamp(index, 0, timeline.segments.length - 1);
      const seg = timeline.segments[idx];
      const span = seg.t1 - seg.t0;
      const frac = clamp(fraction, 0, 1);
      const time = seg.t0 + frac * span;
      const eventIndex = seg.event;
      const machine =
        force || s.machine === null || eventIndex !== s.eventIndex
          ? cursor.stateAt(clamp(eventIndex + 1, 0, timeline.eventCount))
          : s.machine;
      set({
        time,
        segmentIndex: idx,
        eventIndex,
        fraction: frac,
        machine,
        atStart: idx === 0 && frac === 0,
        atEnd: idx === timeline.segments.length - 1 && frac === 1,
        duration: timeline.duration,
        eventCount: timeline.eventCount,
        ...extra,
      });
    }

    function syncTime(time: number, force: boolean, extra: Partial<PlaybackState> = {}): void {
      const s = get();
      const timeline = s.timeline;
      if (!timeline || timeline.segments.length === 0) {
        empty(extra);
        return;
      }
      const clamped = clamp(time, 0, timeline.duration);
      const at = segmentAt(timeline, clamped);
      if (!at) {
        empty(extra);
        return;
      }
      syncSegment(at.index, at.fraction, force, extra);
    }

    function rebuild(preserve: Preserve, speed?: number, layout?: MachineLayout): void {
      const s = get();
      const trace = s.trace;
      const nextLayout = layout ?? s.layout;
      if (!trace || !nextLayout) return;
      const nextSpeed = speed ?? s.speed;
      const timeline = buildTimeline(trace, nextLayout, { speed: nextSpeed });
      const maps = eventMapsFor(timeline);
      set({
        timeline,
        layout: nextLayout,
        speed: nextSpeed,
        duration: timeline.duration,
        eventCount: timeline.eventCount,
        eventStarts: maps.eventStarts,
        eventSegment: maps.eventSegment,
      });
      const last = timeline.segments.length - 1;
      switch (preserve.kind) {
        case 'start':
          syncSegment(0, 0, true);
          break;
        case 'end':
          syncSegment(last, 1, true);
          break;
        case 'segment':
          syncSegment(preserve.index, preserve.fraction, true);
          break;
        case 'event': {
          const e = clamp(preserve.event, 0, timeline.eventCount);
          if (e >= timeline.eventCount) syncSegment(last, 1, true);
          else syncSegment(maps.eventSegment[e] ?? 0, 0, true);
          break;
        }
      }
    }

    return {
      program: null,
      trace: null,
      layout: null,
      result: null,
      cursor: null,
      counters: null,
      native: null,
      linear: { status: 'off' },
      timeline: null,
      eventStarts: [],
      eventSegment: [],
      time: 0,
      duration: 0,
      speed: 1,
      playing: false,
      follow: false,
      atStart: true,
      atEnd: true,
      segmentIndex: -1,
      eventIndex: -1,
      eventCount: 0,
      fraction: 0,
      machine: null,

      load(input) {
        const speed = input.speed ?? get().speed;
        const cursor = new TraceCursor(input.program, input.trace, DEFAULT_KEYFRAME_EVERY);
        const timeline = buildTimeline(input.trace, input.layout, { speed });
        const maps = eventMapsFor(timeline);
        set({
          program: input.program,
          trace: input.trace,
          layout: input.layout,
          result: input.result ?? null,
          cursor,
          counters: buildCounters(input.trace),
          timeline,
          eventStarts: maps.eventStarts,
          eventSegment: maps.eventSegment,
          speed,
          duration: timeline.duration,
          eventCount: timeline.eventCount,
          playing: false,
        });
        if (timeline.instant) syncSegment(timeline.segments.length - 1, 1, true);
        else syncSegment(0, 0, true);
      },

      reset() {
        set({
          program: null,
          trace: null,
          layout: null,
          result: null,
          cursor: null,
          counters: null,
          timeline: null,
          eventStarts: [],
          eventSegment: [],
          playing: false,
          duration: 0,
          eventCount: 0,
        });
        empty();
      },

      play() {
        const s = get();
        if (!s.timeline) return;
        if (s.timeline.instant) syncSegment(s.timeline.segments.length - 1, 1, true, { playing: false });
        else if (s.atEnd) syncSegment(0, 0, true, { playing: true });
        else set({ playing: true });
      },

      pause() {
        set({ playing: false });
      },

      toggle() {
        if (get().playing) get().pause();
        else get().play();
      },

      restart() {
        if (!get().timeline) return;
        syncSegment(0, 0, true);
      },

      setSpeed(speed) {
        const s = get();
        if (!s.trace || !s.layout) {
          set({ speed });
          return;
        }
        if (!Number.isFinite(speed)) {
          rebuild({ kind: 'end' }, INSTANT);
          set({ playing: false });
        } else if (s.atEnd) rebuild({ kind: 'end' }, speed);
        else rebuild({ kind: 'segment', index: s.segmentIndex, fraction: s.fraction }, speed);
      },

      setLayout(layout) {
        const s = get();
        if (!s.trace) {
          set({ layout });
          return;
        }
        rebuild(s.atEnd ? { kind: 'end' } : { kind: 'event', event: Math.max(0, s.eventIndex) }, s.speed, layout);
      },

      seek(time) {
        if (!get().timeline) return;
        syncTime(time, true, { playing: false });
      },

      seekFraction(fraction) {
        const s = get();
        if (!s.timeline) return;
        syncTime(clamp(fraction, 0, 1) * s.duration, true, { playing: false });
      },

      seekEvent(event) {
        const s = get();
        if (!s.timeline || s.eventCount === 0) return;
        const e = clamp(event, 0, s.eventCount);
        if (e >= s.eventCount) syncSegment(s.timeline.segments.length - 1, 1, true, { playing: false });
        else syncSegment(s.eventSegment[e] ?? 0, 0, true, { playing: false });
      },

      stepForward() {
        const s = get();
        if (!s.timeline || s.eventCount === 0) return;
        const next = s.eventIndex + 1;
        if (next >= s.eventCount) syncSegment(s.timeline.segments.length - 1, 1, true, { playing: false });
        else syncSegment(s.eventSegment[next] ?? 0, 0, true, { playing: false });
      },

      stepBack() {
        const s = get();
        if (!s.timeline || s.eventCount === 0) return;
        const prev = s.eventIndex - 1;
        if (prev < 0) syncSegment(0, 0, true, { playing: false });
        else syncSegment(s.eventSegment[prev] ?? 0, 0, true, { playing: false });
      },

      tick(deltaMs) {
        const s = get();
        if (!s.playing || !s.timeline || !(deltaMs > 0)) return;
        if (s.time + deltaMs >= s.duration) syncSegment(s.timeline.segments.length - 1, 1, true, { playing: false });
        else syncTime(s.time + deltaMs, false);
      },

      toggleFollow() {
        set({ follow: !get().follow });
      },

      setNative(native) {
        set({ native });
      },

      setLinear(linear) {
        set({ linear });
      },
    };
  });
}
