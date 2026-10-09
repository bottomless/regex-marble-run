# Decisions

Choices made where the brief was ambiguous or where reality disagreed with the plan.

## Engine

- **V8 bugs excluded from differential tests.** V8 (14.6, Node 26) leaks modifier flags into subsequent
  classes. `/(?i:a)[b]/v.exec('aB')` matches although `/(?i:a)b/v` and `/(?i:a)[b]/u` do not. The M2
  million-case run also found that `/(?-i:)[^A]+/iu` wrongly consumes `a` after the
  modifier group restores outer `i`; the spec result on `aB` is `B`. The fuzzer excludes `v` + modifiers
  and `u` + modifiers removing `i`. These cases are retained in regressions and explicit spec-semantic
  tests. A second native optimizer bug loses alternatives after a lazy universal-character scan followed
  by `^`: `/.{2,}?a^|/sy` incorrectly returns null instead of the empty alternative. The fuzzer also
  excludes lazy dot-all/universal-class scans combined with `^`; explicit tests retain their spec results.
  Word assertions can also corrupt scoped flags: `/(?i:(?:\Ba\n|[ab]|A\bc))*/sy` returns `bb` on `bbAaA`
  instead of `bbAaA`. Modifier/word-assertion combinations are excluded from the native oracle as well.
  All exclusions are centralized in the fuzz generator; both short and long runs use reproducible seeds.
  Our engines follow the spec rather than reproducing these native bugs.
- **What's a step.** One step is one gate/sensor/mirror/lookbehind test or one backtrack (a flag popped).
  Lookahead completion itself is not a step; its inner tests already are. Diverter choices are free.
- **Backreference to an in-progress group** is treated as unset (matches empty), which is what the spec
  does because a group's capture is only updated when the group closes.

## M2: Linear-time comparison and native timing

- **Pike priority and search.** Threads are visited in branch-priority order and deduplicated by program
  counter at each input position. New unanchored attempts join behind older threads; search does not
  rerun the machine for every possible start. A provisional match waits for higher-priority threads to
  fail, preserving JavaScript's leftmost-first match span rather than selecting the longest match.
- **Empty optional iterations.** Optional repetition bodies have an epsilon-prefix copy that cannot
  reach the continuation until a character has been consumed. Required iterations may still be empty.
  This preserves ECMAScript match spans for nullable bounded repeats as well as ordinary loops.
- **Pike steps and traces.** A step is one deduplicated instruction visit (a thread advance), including
  epsilon transitions and assertions. These are different units from backtracking gate/flag steps.
  Trace rows record live threads, split births, merges and deaths by UTF-16 input position, with IR node
  IDs; typed-array columns are transferable and bounded by the existing event budget.
- **Capture differences.** Pike save instructions retain earlier captures across iterations, as in the
  RE2 family; they do not reproduce ECMAScript's per-iteration reset. Differential tests compare only
  the whole-match span and text. The split-mode UI must disclose this in M7.
- **Bounded-repetition compilation guard.** Thompson compilation expands finite repetitions and stops
  at 50,000 instructions (also rejecting nonempty repetition bounds above 50,000) or 500,000 compiler
  visits. Instruction-free empty repeats are simplified before expansion. Excessive patterns return a
  span-bearing error for the linear-time comparison; backtracking and native timing remain available.
  These guards bound both compilation work and worker memory.
- **Engine cancellation.** The main-thread engine client terminates and recreates workers when an input
  changes. A queued cancellation message cannot interrupt a synchronously executing VM; termination can.
- **Native timing.** The dedicated native worker measures exec only, not worker startup or RegExp
  construction. The main-thread controller kills it after 3,000 ms, terminates it on input replacement,
  and ignores stale results. It returns structured timeout/cancellation/error states; HUD presentation
  remains in M6, and side-by-side rendering remains in M7.
- **Scope.** This change implements M2 only; the existing canvas scaffold stays unchanged.

## M3: Pure layout and routing

These are the historical M3 choices. M4 below supersedes the provisional cap, placement details, and
skeleton-only routing; the original milestone context is retained.

- **Grid and pitch.** Sequences stack vertically. Alternation and repetition lanes use a 4-unit base pitch,
  with a 5-unit minimum branch pitch after considering measured width and depth. Gates are 1.2 units.
  Long sequences fold into switchbacks after six children.
- **Placement algorithm.** Every IR subtree is measured first, then placed into a lane. Branch translation
  moves the subtree's pieces, track points, and anchor metadata together. A final local offset guarantees
  separation for narrow assertion branches. This keeps the pure box model simple and passed 300 fixed-seed
  fuzzed layouts without gate overlaps.
- **Complexity guard.** Above 80 leaves, large capturing groups collapse to module placeholders; 160 leaves
  is the hard "too big to build" cap. These constants are provisional until M4 rendering proves readability.
- **Routing graph.** M3 builds a valid directed routing skeleton: every anchor connects entry to exit, nodes
  chain in IR order, and hopper/cup boundary points connect the root. A full physical return-rail graph is
  M4/M5 work when return behavior is animated.
- **Debug view.** `?debug=layout&p=...&f=...` renders a top-down SVG projection for layout inspection. It is
  intentionally unstyled relative to the final art direction and does not affect the normal app shell.

## M4: Physical layout and static workshop

- **Pure measure/place model.** Layout remains independent of React and Three.js: measure each IR
  subtree's local pieces, ports, curves, and bounds before recursively placing it. Branches use
  measured extents with a 2.4-unit gap; sequences of more than six children fold into compact
  descending switchbacks only when every child is a leaf. Graph edges reference physical pieces
  with matching endpoints, not synthetic entry-to-exit shortcuts. Centripetal spline bounds include
  overshoot; ordinary tracks descend, while rear backtrack and repetition lifts may rise.
- **Continuation backtracks and scoped scouts.** Outstanding alternation/repetition choices propagate
  through sequence and group continuations. Later failures have rear return rails and back lifts to
  earlier choices, unwinding nested choices without crossing mutually exclusive branches. Repeats
  have side bypasses and rear loop lifts. Lookahead keeps a nonconsuming main path and connected
  ghost scout tracks; scout choices stay within the assertion rather than escaping into the main
  continuation. Routing uses cached directed shortest paths weighted by stored polyline lengths;
  trace-driven route selection and animation remain M5 work.
- **Current complexity limits.** Above 80 leaves in the original program, non-root capturing or
  noncapturing groups containing more than 12 leaves collapse to expandable modules unless their
  IDs were explicitly expanded. Descendant IR anchors map to the module's ports while collapsed.
  Expansion rebuilds layout and can reveal nested modules; pointer clicks and ordinary DOM buttons
  both support it. The hard cap is now 320 original leaves, checked before collapse, replacing M3's
  provisional 160; collapsing cannot bypass the cap.
- **Demand-rendered, local WebGL assets.** React Three Fiber renders on demand with DPR capped at 1.5,
  local lights and a generated Lightformer environment rather than a remote HDR preset. Bundled IBM
  Plex fonts and procedurally generated wood textures avoid required external asset requests.
  Track tubes are merged by material finish; repeated gate, sensor, diverter, and funnel hardware is
  instanced. Labels and individual decorative pieces are not all batched. Geometry, textures, and
  materials have explicit disposal paths.
- **Local glyphs instead of drei `Text`.** The brief's required `Text` component is deliberately
  replaced by canvas-drawn `CanvasTexture` glyph planes to avoid its remote Unicode font-fallback
  asset path. Labels use bundled IBM Plex Mono with browser-local monospace fallback, not a remote
  font service. This keeps glyph generation local but does not guarantee coverage for every Unicode
  character on every system.
- **Overview and close inspection.** The display scales and centers layout to a normalized workshop
  footprint, then frames both machine and base for the viewport, reserving space for desktop controls.
  This is an overview, not a promise that every dense-pattern glyph is readable without closer zoom.
  Orbit, pan, and zoom permit close inspection. With the canvas focused, arrows orbit, Shift + arrows
  pan, + / - zoom, and R resets; the Reset view button and module-expansion buttons provide DOM
  controls. Reduced motion disables orbit damping and the brief build-settling animation.
- **Static scope.** M4 builds the physical machine and input tiles, but does not run trace-driven marble
  playback. The short build-settling transition is presentation only; the UI explicitly says
  "Static build · playback arrives in M5". Engine/native-worker runtime validation is separate from
  static-scene rendering tests.
- **Fallback and debug flags.** WebGL creation or scene-render failure shows the SVG layout using the
  current program source and flags. The standalone `?debug=layout&p=...&flags=...` view remains
  available; legacy `f` is an alias, with `flags` taking precedence when present. Oversize layouts
  report the build error instead of attempting to render a scene.

## M5: Playback

### Step 1: trace state reducer (`src/playback/state.ts`)

- **Flag-granularity snapshots.** The trace does not record capture or counter undos during an
  unwind, so the reducer cannot follow `capture` events alone. Instead each planted flag stores a
  copy of the capture table and repeat counters, and a `backtrack` event restores the snapshot of
  the flag it pops, matching the engine's trail semantics at choice-point granularity. Look frames
  snapshot the same state; on `look` end the snapshot is restored unless the look was a successful
  positive lookahead (whose captures persist per spec), and the flag stack is truncated to the
  event's recorded depth, which discards choice points planted inside the lookahead.
- **Read head.** After a `test` event the head is `pos + len` on success and `pos` on failure,
  matching the engine's `curPos`/advance behaviour; consumed tiles are therefore always
  `[attemptStart, head)`.
- **Untried flags survive a match.** The engine stops at `match` without unwinding its stack, so a
  matched end state can still hold flags; only `nomatch` guarantees an empty stack.
- **Keyframes every 512 events.** `TraceCursor.stateAt(i)` clones the nearest earlier keyframe and
  applies at most 511 events, so seeking and single-stepping backward are O(keyframe interval)
  instead of O(trace length). Keyframes store private drafts; callers only receive plain immutable
  `MachineState` snapshots. Counters are exposed per repeat `NodeId`; `iter` events are the single
  source of truth for the counter dials, so silent `REP_END` increments between events never
  desynchronise a restored state.

### Step 2: timed motion timeline (`src/playback/timeline.ts`)

- **One primary segment per event.** `buildTimeline(trace, layout, { speed })` walks the SoA trace and
  emits an ordered segment list. Each trace event produces exactly one `primary` segment; motion
  lead-ins (`roll` before a `gate`, `drop`/`lift` before a backtracking `flag` pop) are extra
  non-primary segments sharing that event index. The primary segments therefore partition event
  indices `0..length-1` exactly once, which is what the tests assert for coverage.
- **Kind mapping.** `attempt`→`hop`, `test`→`gate`, `choose`→`flag`(plant), `backtrack`→`flag`(pop)
  with a preceding `drop` onto the return rail and a rear-plane `lift` back to the flag, `iter`→`iter`,
  `look`→`scout`, `capture`→`capture` (zero-duration marker), `match`/`nomatch`→`finish`. A `gate`
  carries the decoded `pos`/`len`/`ok` so the renderer can light tiles without re-decoding the trace.
- **Routing is best-effort.** Travel routes come from `routePath` between layout anchor points
  (gate `entry`/`exit`, diverter `returnPort`). Where the graph has no directed path (hopper release,
  cup finish, collapsed modules, or synthetic graphs) the segment simply omits `route` and the marble
  component interpolates directly between anchor positions. Every stored route is a real graph path.
- **Duration model.** Per-kind base times, with `roll` scaled by measured polyline length
  (`ROLL_PER_UNIT_MS`, clamped to `[ROLL_MIN_MS, ROLL_MAX_MS]`), all divided by `speed`. Times
  accumulate from `t0 = 0` and are contiguous (`segment[k].t0 === segment[k-1].t1`), so monotonicity
  holds by construction. Speed `Infinity` ("instant") makes every duration `0` and marks all segments
  `jump`; at `speed >= COLLAPSE_SPEED` (16) only travel kinds (`roll`/`drop`/`lift`) collapse to zero
  so high-speed playback teleports the marble but still ticks gates and flags.
- **Time↔event lookup.** `segmentAt(timeline, t)` binary-searches the active segment and returns an
  interpolation `fraction` within it. The playback store composes this with the step-1 `TraceCursor`:
  a segment's `event` maps to `stateAt(event + 1)` for the resulting machine state (head moved, flag
  planted/popped), which the tests verify for `gate`, `flag`(pop) and `hop` segments.

### Step 3: transport store (`src/playback/store.ts`)

- **Vanilla zustand, framework-free.** `createPlaybackStore()` returns a `zustand/vanilla` store with
  no React or Three.js imports, so it is unit-testable headlessly and can later be bound to React with
  `useStore`. It composes the step-1 `TraceCursor` (exact state) and the step-2 `Timeline` (timed
  motion) and exposes transport state (`time`, `eventIndex`, `fraction`, `machine`, `playing`, `speed`,
  `atStart`/`atEnd`) plus actions (`play`/`pause`/`toggle`, `stepForward`/`stepBack`, `seek`/
  `seekFraction`/`seekEvent`, `setSpeed`, `setLayout`, `restart`, `tick`, `toggleFollow`).
- **Authoritative position is (segment index, fraction), not raw time.** Because many events are
  zero-duration (`capture` markers, collapsed travel at high speed), mapping a time back to an event
  via `segmentAt` is ambiguous at boundaries. Discrete navigation (`seekEvent`, `stepForward`,
  `stepBack`) therefore jumps directly to a segment index using a precomputed `eventSegment[e]` map,
  and only continuous playback (`tick`) and scrubbing (`seek`/`seekFraction`) resolve time→segment.
  This keeps single-step forward/back exact regardless of zero-length segments.
- **Step = one event.** `stepForward`/`stepBack` move a whole trace event at a time (not a segment),
  matching the brief's "single-step forward and back" over engine steps. The exposed `machine` is
  `stateAt(eventIndex + 1)`, so stepping backward restores byte-identical state to stepping forward
  to the same event (tested for every event of every preset).
- **Speed changes preserve position.** `setSpeed` rebuilds the timeline at the new speed and restores
  the current `(segment index, fraction)`, so the marble stays put while durations rescale; total
  duration shrinks monotonically across the speed ladder and is `0` at instant. `setLayout` (e.g. a
  module expand/collapse) rebuilds while preserving the current event.
- **`tick` is pure and caller-driven.** The store never owns a clock; the render loop calls
  `tick(deltaMs)` and the store advances `time`, stops at the end (`playing=false`, `atEnd=true`), and
  only recomputes `machine` when the event index actually changes, so smooth within-segment playback
  does not re-derive reducer state every frame.
- **Safe when empty.** Before `load` (or after `reset`, or for an empty trace) every action is a
  no-op and `machine` falls back to `stateAt(0)` (idle), so the transport can mount before the first
  engine result arrives.

### Step 4: motion solver (`src/playback/motion.ts`)

- **Segment + fraction → 3D pose.** `poseForSegment(layout, segment, fraction)` returns a
  `{ position, direction, moving }` marble pose with no React/Three.js dependency (plain `{x,y,z}`),
  so it is unit-testable headlessly and reusable by the hero marble, follow camera and any trail.
  Travel segments (`roll`/`drop`/`lift`) interpolate their stored `route` by arc length
  (`pointAlongPolyline`) and are `moving`; stationary segments resolve to layout anchors: `gate` to
  the node's `gate` (or the entry→exit midpoint) with a downward tangent, `flag`/`iter` to the
  `diverter`/`gate`, `scout` to the look node, `hop` to the hopper piece, `finish` to the cup
  (match) or reject tray (nomatch).
- **Arc-length, not index, interpolation.** `pointAlongPolyline` accumulates segment lengths so a
  given `fraction` maps to true distance travelled; this keeps marble speed visually constant across
  unevenly spaced track points and is the same measure the layout uses for edge weights.
- **Position-less segments hold.** `capture` markers carry no position and return `null`;
  `poseAtIndex` walks backward to the last resolvable pose and holds it at that segment's end, so a
  scrub or step landing on a capture never blanks the marble. `poseAtTime` composes `segmentAt` with
  `poseAtIndex` for time-based lookup, clamping before the start and after the end.
- **Bounds and continuity are tested.** For every preset and edge-case pattern, every segment yields a
  finite pose at fractions 0/0.5/1, unit-length directions, travel poses stay inside their route's
  bounding box, and captures inherit the preceding resolvable pose.

### Step 5: headless end-to-end integration (`tests/playback/integration.test.ts`)

- **Compose steps 1–4 along the render-loop path, without React/Three.** The test drives the exact
  sequence the scene will use: `parsePattern` → `runBacktrack` → `layout` → `store.load`, then a 60 fps
  `tick(dt)` loop reading `(segmentIndex, fraction)` each frame and resolving it through `poseAtIndex`.
  This proves presets 1–5 "play end to end" at the logic level before any scene wiring exists, so the
  M5 done-criterion is verifiable in CI rather than only by eye in the browser.
- **Frame-accurate invariants.** Every played frame has a finite marble pose, time is monotonically
  non-decreasing, the read head stays in `[0, input.length]`, flag depth never goes negative, and the
  terminal `tick` clamps the store exactly to `duration` with `atEnd` true and the final `machine.phase`
  matching the engine result. The captured pre-terminal frame is deliberately *not* asserted equal to
  `duration`; the loop breaks at the top once `playing` flips false, so only the settled store state is
  at the endpoint.
- **End state matches the engine.** Final captures reproduce `result.index/end` and every group's text;
  a match lands the marble on the `cup` piece and a nomatch on the `rejectTray`, tying motion back to the
  authoritative engine result.
- **Determinism under scrubbing.** Stepping to every event yields a finite pose, and seeking events
  backward reconstructs the identical `machine` sequence as forward — confirming the keyframed cursor has
  no path-dependent drift, which is what makes the timeline scrubber safe to ship.

### Step 6: live wiring — engine run, playback clock, hero marble (`src/playback/usePlayback.ts`, `src/scene/Marble.tsx`)

- **First live engine run in the app.** M4 rendered a static machine only; the engine was never executed
  outside tests. `usePlaybackController` now runs the backtrack engine in a worker (via the already-tested
  `createEngineClient`) whenever pattern/flags/input change, and `store.load`s the returned trace + result.
  Runs are budgeted (`wallMs: 2500`, `maxSteps: 20M`, below the engine's 4s/50M defaults) so an evil regex
  fails fast in the worker instead of grinding, and a `gaveUp`/`truncated` run is surfaced as `partial`.
- **Client per run, disposed in cleanup — StrictMode-safe and leak-free.** The client is created *inside*
  the run effect and `dispose()`d in its cleanup. Under StrictMode's mount→cleanup→remount this leaves a
  live client (a persistent client disposed on the fake unmount would break every dev run), and an
  in-flight worker is cancelled+terminated on input change or unmount. The stable store uses a `useState`
  lazy initializer; latest `program`/`layout`/`reducedMotion` are read from a ref synced in an effect, so
  module expansion rebuilds the timeline via `setLayout` *without* re-running the engine or losing position.
- **Marble owns the clock, never re-renders React at 60fps.** `Marble.tsx` reads `store.getState()` in a
  single `useFrame`, calls one `tick(delta*1000)` per frame, and positions the mesh imperatively from
  `poseAtIndex`. It lives inside the machine's `offset`/`scale` group so layout-space poses align with the
  tracks. Under `frameloop="demand"` it invalidates each playing frame and subscribes to the store to
  invalidate on any external change (load/play/scrub), so autoplay starts and a paused scrub still repaints;
  when playback ends, `tick` early-returns and the loop rests at the final pose.
- **Reduced motion respected.** Autoplay is skipped when the user prefers reduced motion; the marble still
  renders at the start pose (hopper) and awaits manual transport (step 7).
- **Verified in a real browser.** The existing Playwright `static.spec.ts` (all 9 presets, desktop) passes
  with zero page/console errors, confirming the worker run + marble introduce no runtime failures and the
  machine still renders; production build emits the `engine.worker` chunk. Logic correctness for presets
  1–5 playing end to end is already covered headlessly by step 5.
