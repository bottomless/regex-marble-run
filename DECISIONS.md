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

### Step 7: playback transport controls (`src/playback/Transport.tsx`, `tests/e2e/playback.spec.ts`)

- **Transport control bar overlay.** Built an accessible, styled playback deck mounted directly over the
  stage with Play/Pause, Step Back, Step Forward, Restart, an event counter, a timeline scrubber, and
  speed selector pills (0.5×, 1×, 2×, 4×). All buttons map directly to the zustand transport store
  actions (`toggle()`, `stepBack()`, `stepForward()`, `restart()`, `seekEvent()`, `setSpeed()`).
- **Zero render churn at 60fps.** `Transport.tsx` subscribes via individual primitive `useStore` selectors
  (`playing`, `atStart`, `atEnd`, `speed`, `eventIndex`, `eventCount`, `hasTimeline`). Because continuous
  motion values (`time`, `fraction`) are omitted, the React deck only re-renders when execution events
  advance or button states toggle, leaving 60fps frame rendering entirely to Three.js / WebGL.
- **Stage hit-testing enabled.** Changed `.workshop-stage` `z-index: -1` to `z-index: 0`. Negative z-index
  inside `.workshop-shell`'s isolated stacking context placed the canvas and overlays behind the shell
  background, blocking pointer events. Setting `z-index: 0` preserves DOM layering beneath `.control-island`,
  `.stage-status`, and `.workshop-footer` while allowing interactive clicks and scrubber drags.
- **Scrubbing by event index.** The timeline range input binds to `eventIndex` and dispatches `seekEvent(n)`.
  This guarantees every scrub stops on an exact trace event boundary with consistent keyframed machine
  state, rather than landing on fractional intermediate positions.
- **Responsive positioning.** Sits centered horizontally at `bottom: 20px` on desktop, lifts to `bottom: 74px`
  on tablet to clear the wrapped footer, and docks at `bottom: 8px` on mobile with a compact scrubber.
- **Browser verification.** Added `tests/e2e/playback.spec.ts` asserting transport mounting, play/pause toggling,
  stepping forward/backward, restarting, speed selection, and scrubbing across presets 1–5 in Chromium. All 4
  playback tests and all 4 static tests pass (8/8 e2e).

### Step 8: animated input tile rail (`src/playback/tiles.ts`, `src/scene/Machine.tsx`)

- **Pure `tileStatus(machine, index)` helper.** Classifies each rail tile as `pending`/`consumed`/`head`
  from the machine state's `(attemptStart, head)` only: tiles in `[attemptStart, head)` are consumed by the
  live attempt, the tile under the head gets the head marker, and on `matched` the terminal `match` span
  stays lit. No history is kept, so scrubbing backward or restarting re-derives highlights exactly —
  rewind parity is structural, not cached.
- **Live rail splits static from subscribed.** `TileRail` keeps the zero-subscription static branch when no
  store exists; with a store it renders `LiveTileRail`, which subscribes to `s.machine` only. Consumed
  tiles switch birch→cobalt with light glyph text; the head tile gets a brass underline bar. R3F cannot set
  `data-*` props on `<group>` (it treats them as three.js fields and throws), so e2e observability lives in
  the canvas `data-lit-tiles`/`data-head` mirror below instead of on the tile nodes.
- **Canvas attribute mirror for e2e.** `Scene` subscribes to the store and mirrors `data-event-index`,
  `data-event-count`, `data-head`, `data-attempt-start`, and `data-lit-tiles` onto the canvas, so the tile
  e2e test asserts the same `tileStatus` computation the rail renders without reading WebGL pixels.
- **Tests at both levels.** `tests/playback/tiles.test.ts` (6 tests) pins the span rule on every event of
  presets 1–5, proves backtracking unwinds consumed→head (`a+b` on `aac` retreats past tile 1), proves
  backward scrubbing reproduces forward statuses exactly, and pins the matched span end. The e2e tile test
  pauses, restarts (tile 0 holds the head marker at event 0), scrubs to the final match (`4,5,6` lit for
  `c(a|o)t` on `the cot`), and restarts back — with zero console errors. Full suite: 947 unit tests, 8/8
  e2e (playback + static) on desktop Chromium.

### Step 9: saved-choice flag markers (`src/playback/flags.ts`, `src/scene/Flags.tsx`)

- **State-derived, not an animation history.** `flagMarkers(layout, machine.flags)` preserves each
  choice's node, alternative, input position and global stack index. Repeated choices stack upward at
  `flagSlot`; collapsed descendants share one column beside their visible module. Layout expansion
  relocates markers without changing the saved choices. Missing anchors are skipped rather than drawn
  at an invented origin.
- **Instanced brass and enamel hardware.** `Flags` subscribes only to the saved-choice array and renders
  poles, finials and pennants using the existing `Hardware` batches and diverter-role materials. The top
  flag in each column labels the saved read position. Markers live in the machine's layout-space group,
  appear and disappear immediately, and invalidate the demand canvas on changes, including paused seeks.
  This also respects reduced motion without a separate plant/pop clock. Flood-mode sampling and dynamic
  camera framing of exceptionally tall columns remain separate work.
- **Exact rewind semantics.** Backtracking pops markers; stepping backward reconstructs them. Outstanding
  choices remain visible after a match, scoped lookahead choices disappear on completion, and new attempts
  or reset clear the stack. Canvas `data-flags` and `data-flag-count` reflect the descriptors committed by
  the flag renderer, not a second store-based rendering implementation.
- **Verified.** 23 new unit tests cover stacking, duplicate choices, per-node columns, all events in
  presets 1–5, forward/backward stepping, lookahead cleanup and collapsed-module expansion. The new
  Playwright case checks plant, pop, backward restoration, scrub restoration and restart with zero browser
  errors on desktop and mobile. Typecheck, lint and build pass; 970 unit tests and all 18 browser tests pass.

### Step 10: backtracking lift carriage (`src/playback/carriage.ts`, `src/scene/Carriage.tsx`)

- **The ride is the current segment, not a remembered animation.** `carriageAtIndex` places a deck only
  while the playhead is on a `lift` segment or on a `drop` whose route climbs a `backLift` edge. The deck
  is a fixed offset from the rail point at that fraction, and the hero marble uses a matching cradle
  offset so it sits in the carriage. Off the ride the carriage is hidden. Pause, scrub and step-back
  recompute the same pose; there is no plant/travel clock to drift.
- **Vertical shafts do not spin.** Yaw comes from the horizontal part of the travel direction. A nearly
  vertical back-lift keeps a stable facing instead of flipping as the tangent passes through pure +Y.
- **Demand-render safe.** The mesh moves in `useFrame` after the marble's single `tick`, and a store
  subscription writes `data-carriage` / `data-carriage-riding` and invalidates the canvas, including when
  playback is paused. Reduced motion gets the same instant pose with no extra tween.
- **Verified.** 28 unit tests cover presets 1–5, greedy retreat and alternation: fixed deck offset,
  monotonic travel, backward time-scrub equality, event step-back restoration, collapsed jumps, and the
  first-ride backtrack appearing at the drop and disappearing on the next event. Playwright scrubs to that
  backtrack, checks the rendered attribute, steps forward and back, and restarts, with zero console errors.

### Step 11: selected and saved alternation branches (`src/playback/alternation.ts`, `src/scene/Alternations.tsx`)

- **Selected is not saved.** Alternation `choose(node, b)` saves branch `b` while selecting `b - 1`;
  `backtrack(node, b)` selects `b`. The reducer keeps `selectedBranches` separately from the flag stack,
  and `alternationMarkers` counts saved continuations independently, including repeated entries for the
  same lane. Binary, multiway and empty branches use the same state-derived descriptors.
- **Choice-scoped rewind.** Each choice snapshots selections before changing them. Every backtrack restores
  that map, including repeat rollback, before applying any new alternation selection. Look completion
  restores pre-look selections without changing existing capture semantics. Attempts and nomatch clear
  selections; match retains them. Keyframes and public snapshots clone maps so seeks and caller mutation
  cannot leak state between events.
- **Live diverter and lane markers.** A teal pointer and numbered ACTIVE lane replace the static alternation
  lever; brass rings and SAVED labels show pending alternatives. Repeat hardware is unchanged. Collapsed
  alternatives omit their markers but retain state for expansion. The renderer subscribes only to machine
  state, mirrors committed descriptors in canvas `data-alternations`, and invalidates demand rendering on
  change; there is no second clock or history-dependent tween.
- **Verified.** 23 new unit tests cover branch selection, nested and repeated rollback, look scopes,
  snapshot isolation, keyframes, seeking and expansion. Binary and ternary Playwright cases verify saved
  lanes, forward/backward steps, scrubbing and restart with zero browser errors on desktop and mobile.
  Browser angle assertions tolerate insignificant Node/Chromium floating-point differences. All 1,021
  unit tests and 24 browser tests pass, along with typecheck, lint and production build.

### Step 12: loop diverters and counter dials (`src/playback/repeats.ts`, `src/scene/Repeats.tsx`)

- **Again and exit from trace events, not from counters.** A repeat `choose(node, option)` saves
  `option` (1 = exit for greedy, 0 = again for lazy) and selects the other direction; `backtrack(node,
  option)` selects `option`; every `iter` selects again, which also covers forced iterations below `min`
  that never plant a flag. A forced exit at `max` emits no event, so the diverter keeps its last setting.
  Loop choices live in their own `loops` map rather than in `selectedBranches`, keeping alternation state
  and tests untouched. The dial reads the existing `counters` map, so it rolls back with every backtrack.
- **One scope snapshot per choice.** Captures, counters, branch selections, loop choices and gate results
  are now cloned together as one `Scope` at every flag and look frame. Backtracking restores the whole
  scope; look completion always restores selections, loops and gates, and restores captures/counters only
  for negative or failed lookaheads, preserving the step-1 capture rule.
- **Pointer and dial.** The again pointer aims at the body entry, the exit pointer along the bypass
  chute's first control point. The dial sits beside the diverter opposite the flag column and shows the
  iteration count, the current direction, and whether a saved fallback exists for the other direction.
  Static repeat levers are hidden when live indicators are mounted; the greedy/lazy glyph and `min…max`
  label stay.

### Step 13: gate outcomes and sensor lamps (`src/playback/gates.ts`, `src/scene/GateLamps.tsx`)

- **Results are path state.** Each `test` writes `pass`/`reject` for its node into the scope. A gate that
  rejects shows an open trapdoor only until the backtrack restores the choice-point scope, when it
  returns to its earlier state; gates passed before the choice stay lit. New attempts clear every lamp;
  `match` and `nomatch` keep them so the final run stays readable. Lookahead completion restores the inner
  lamps to their pre-look state and lights the scout lamp with the assertion's own outcome.
- **Lamps are state, not flashes.** The brief's "flash" is realised as a persistent lamp for sensors,
  mirror gates, sealed lookbehind gates and scouts, so pausing or scrubbing shows the same frame as
  playing, and reduced motion needs no separate path. The most recently tested node also gets a teal halo.
- **Verified.** 17 repeat tests and 12 gate tests cover greedy/lazy/optional/bounded loops, nested
  catastrophic rollback, look scopes, attempt/match/nomatch handling, sensors, mirrors, lookbehind,
  collapsed modules, keyframe equivalence, snapshot isolation and store rewind parity. Three new Playwright
  cases (greedy loop, lazy loop, gates and sensors) pass on desktop and mobile with zero browser errors.
  Totals: 1,050 unit tests, 30 browser tests; typecheck, lint and production build pass.

### Step 14: lookahead scout (`src/playback/scout.ts`, `src/scene/Scout.tsx`)

- **Scout frames are reducer state.** A `look` start pushes a `ScoutFrame { node, start, end: null, reads }`
  onto `scouts`; every `test` inside records a `ScoutRead` (node, event, pos, len, ok) on the innermost
  open frame; the matching `look` end pops the frame and parks it in `scoutClosing` with `end` set for
  exactly one event, so the return trip has a home in the state rather than in a renderer clock. Nested
  lookaheads therefore show only the innermost scout. Attempts and `nomatch` clear open frames; keyframes
  and public snapshots deep-clone frames so callers cannot corrupt later seeks.
- **Ghost tiles are derived, not lit.** `scoutTiles(frame)` is the sorted union of `[pos, pos+len)` over the
  frame's reads, including failed reads (the scout did look at that tile) and excluding zero-length sensor
  reads. The rail draws these as a translucent teal cap above the tile without changing `tileStatus`, so
  the main read head and consumed tiles stay exactly as the engine's `curPos` dictates: a lookahead never
  consumes.
- **Pose from event coordinates.** `scoutPose(layout, frame, eventIndex + fraction)` interpolates straight
  lines between event-indexed stops: home (first point of the scout side track, falling back to the
  assertion gate) at `start`, each inner gate at its `read.event`, a hold at the last gate until `end`,
  and home again at `end + 1`. Using the continuous event coordinate rather than timeline time means
  the scout agrees with scrubbing, stepping and instant speed with no separate tween; the scout is
  hidden whenever no frame is active.
- **Verified.** 10 unit tests cover open/record/close, failed and zero-length reads, nested scopes,
  negative lookahead outcomes, clearing on attempt/nomatch, stop/pose geometry, finite in-bounds poses
  for presets 1–5, forward/backward store parity, keyframe equivalence and snapshot isolation. The
  Playwright case scrubs through `c(?=o)ot` on `cot`, checking the window, ghost tile `1`, step
  back/forward, closing frame and return with zero browser errors on desktop and mobile.

### Step 15: capture brackets, mirror faces and the finish celebration (`src/playback/captures.ts`, `src/scene/Mirrors.tsx`, `src/scene/Celebration.tsx`)

- **Brackets straight from `captures`.** `captureBrackets(program, state)` lists every set group other
  than 0 with its name and a colour from `palette.captures` cycled by group number, so the bracket colour
  matches the group's frame in the machine. Brackets appear when a group closes, vanish when a quantified
  iteration resets the group, come back when a backtrack restores the scope, and clear on every new
  attempt; none of this is tracked separately because the step-1 reducer already restores `captures`.
  Brackets sit above the tile rail at the tile x-positions of `start`/`end`; spans outside the visible
  tile window are skipped rather than drawn at a guessed position.
- **Mirror text resolves like the engine.** `mirrorText` shows the first set group a backreference can
  resolve to (duplicate named groups resolve in order), empty before the group is set, and truncates
  past 12 characters with an ellipsis. The face is a light plate on the mirror gate because the brass
  mirror material renders dark under the environment and swallowed dark text.
- **Celebration only after `match`.** `matchSpan` is non-null only when `phase === 'matched'`, so the
  gold tiles, brass rings over the cup and the `MATCH @start..end` chip appear on the final event and
  disappear when stepping back one event. A matched run also keeps its brackets, flags and lamps per the
  earlier steps, so the end frame reads as a complete result.
- **Canvas mirrors are written immediately.** `Scene` now writes `data-event-index`/`data-head`/
  `data-lit-tiles`/`data-captures` from `store.getState()` when it subscribes, not only on the next
  store change. The engine can finish loading while the scene is still suspended on first mount, which
  previously left those attributes unset until the first transport action.
- **Verified.** 7 unit tests cover bracket colours and names, iteration reset and restore, attempt
  clearing, mirror text (live update, unset, duplicate names, truncation), celebration timing, backward
  stepping parity for presets 1–5 and snapshot isolation. The Playwright case drives `(?<dup>a)\k<dup>`
  on `aa` through capture close, match, step back and restart on desktop and mobile. Totals: 1,067 unit
  tests, 34 browser tests; typecheck, lint and production build pass.

### Full transport speed ladder (`src/playback/Transport.tsx`, `src/playback/store.ts`)

- **One shared ladder.** Transport uses the timeline's `SPEED_STEPS` plus `INSTANT`: 0.25×, 0.5×,
  1×, 2×, 4×, 16×, 64× and Instant. Labels stay in `copy.ts`; each button exposes its pressed state
  and an accessible speed label. Tablet and mobile controls use two rows so every speed stays visible
  at 320px and 390px; the mobile status line sits above the transport rather than across the pills.
- **Finite changes preserve the pose.** The store retains the segment index and fractional progress even
  when travel durations collapse to zero at 16× or 64×. Returning to a slower speed restores the same
  pose and reducer state instead of rounding the fraction to an endpoint.
- **Instant settles immediately.** Selecting Instant, loading a new trace with Instant selected, or
  pressing Play in Instant settles on the final event without animation and leaves playback paused.
  Returning to a finite speed keeps the result; Restart returns to the first event at the selected speed.
  Event scrubbing and forward/backward stepping remain available in Instant.
- **Boundaries follow the playhead, not elapsed time.** Start/end flags use segment index and fraction,
  because every instant event has time zero. The end is no longer also marked as the start, so backward
  stepping and Restart stay enabled. Layout rebuilds preserve a settled endpoint rather than returning
  to the beginning of its final event.
- **Verified.** 45 additional store tests cover finite speed pose preservation, instant completion while
  playing, zero-duration navigation, reloads and endpoint-preserving layout rebuilds. Browser tests cover
  all finite pills without moving the paused playhead, presets 1–5 (both greedy/lazy variants) finishing
  with exact captures in Instant, restart/replay/backward steps, and unobstructed controls at 320px/390px.
  All 1,112 unit tests and 38 desktop/mobile browser tests pass; lint, typecheck and production build pass.

### M6: catastrophic-run flood presentation (`src/playback/flood.ts`, `src/scene/Flood.tsx`)

- **Trigger.** `shouldFlood` turns the flood presentation on when the trace is truncated, the engine
  gave up, or the run exceeds `FLOOD_STEP_THRESHOLD` (3,000 steps). Presets 6–8 flood; presets 1–5 and
  the greedy/lazy variants do not. Preset 9 (`.*(?:.*=.*)` on `x=x`) finishes in 28 steps and matches,
  so it stays in normal playback; its calibration against the postmortem is a separate preset decision
  (see TODO).
- **Sampling.** The flood model samples depth, read position and backtracks every `CHECKPOINT_EVERY`
  (1,000) steps from the recorded events, then continues with the engine's count-only checkpoints,
  which carry steps, depth and position. Backtracks are not counted per checkpoint, so the count-only
  phase interpolates them linearly from the last recorded total to the engine's final total; the last
  sample always lands on the exact final `steps` and `backtracks`.
- **Tank.** One marble stands for the smallest power of ten (1, 10, 100, …) that keeps the pile within
  10,000 instances; the lid label states "1 marble = N backtracks". The fill height is log-scaled from
  10¹ (floor) to 10⁸ (brim) with brass graduations at 10²…10⁸; the pile is a deterministic staggered
  heightfield, so density reads as count and height as the graduation. Counters show the sampled
  backtracks and steps (with "gave up" when the engine stopped on its budget).
- **Columns.** Flag columns replace the per-event flag stacks while flooding. The sampled depth is split
  across the diverters that held flags when recording stopped, in proportion to their recorded share
  (equal shares across all flag slots when nothing was recorded). Columns show the high-water mark
  ("peak ×N") rather than the instantaneous depth, because catastrophic runs end on an empty stack,
  and draw at most 24 pennants per column with the label carrying the full count.
- **Settle clock.** The presentation plays the run forward once over three seconds in 20 buckets
  (instanced marble count updates per frame; columns and counters per bucket) and then stays settled.
  Reduced motion shows the settled state immediately. The transport still scrubs the recorded prefix.
- **Layout.** The board widens by `TANK_SPAN` on the right while flooding and the tank sits in the added
  span, so the fixed camera framing pulls back automatically. Scene data attributes expose
  `data-flood`, per-marble ratio, marble count, backtracks, steps, depth, peak depth, level and columns.
- **Verified.** 8 unit tests cover trigger thresholds, power-of-ten sampling, log graduations, sample
  monotonicity through both phases, frame interpolation, column distribution and tank packing. Browser
  tests check presets 6–8 settle to the expected marble count, totals, peak depth and column JSON on
  desktop and mobile, that presets 1–5 and 9 stay in normal playback, and that leaving a flooded preset
  clears the flood state. Totals: 1,120 unit tests; 42 browser tests pass (one playback test timed out
  once under host load and passed on rerun); lint, typecheck and production build pass.

### M6: native-time HUD and Cloudflare calibration (`src/playback/Hud.tsx`, `src/playback/counters.ts`)

- **HUD.** A top-right readout shows Steps · Backtracks · Attempts · Flags · Native time · Result, as
  PLAN §5 lists. Steps and backtracks come from prefix counts over the recorded trace (one step per
  gate test or backtrack, the engine's own definition), so they follow the playhead exactly, including
  backward stepping and scrubbing. Attempts and flag depth come from the reconstructed machine state.
  Flooded runs show the engine totals directly, because their trace is truncated. The result is shown
  only once the playhead reaches the end (or immediately for floods) so the ride is not spoiled; it
  reads "Match @a..b", "No match" or "Gave up". On phones the HUD collapses to Steps + Result and sits
  directly above the transport. The stale "Static build · playback arrives in M5" status is gone.
- **Native timing.** The playback controller runs the M2 native worker alongside the engine for every
  pattern/input change and publishes the reading through the playback store (`setNative`), where both
  the HUD and the flood tank's "Native RegExp · …" line read it. The reading is independent of the
  trace lifecycle: it stays "measuring…" until the probe reports, shows "over 3 s · stopped" on the
  worker budget and "unavailable" if the browser rejects the pattern. Milliseconds are formatted to
  two decimals under 1 ms, one under 10 ms, whole ms under 1 s, and seconds above.
- **Preset 9 calibration.** `.*(?:.*=.*)` on `x=x` matches in 28 steps and never floods. The postmortem
  itself notes that 20 x's with no `=` take 4,067 steps, so the preset now uses 1,200 x's with no
  equals: the failure is cubic, the native engine takes about 1 s on this machine (0.85–1.1 s measured
  in Chromium and Node), and our engine gives up on its 20M-step budget inside the 2.5 s wall. This
  is within PLAN §7's 0.5–2 s target; the caption states both postmortem figures and that our step
  counts use a different definition. 1,300 x's would be ~1.3 s and 2,000 ~4 s.
- **Browser suite reduced to a 46 s smoke set.** The previous 22 tests × 2 viewports took 8–9 minutes
  under SwiftShader: every piece test stepped through every trace event with a click and attribute
  poll per event, the flood sweep ran four catastrophic presets through the 2.5 s engine budget twice
  (browser and Node), and everything ran serially on both projects. The suite is now three desktop
  tests (all presets build/play/flood with no errors or external requests; transport + HUD + instant;
  evil-regex tank exactness + Cloudflare gave-up/native time) and one phone layout test. Piece-level
  behaviour (tiles, flags, carriage, diverters, lamps, scout, brackets, mirrors, celebration) remains
  covered by the 1,123 unit tests over the same pure modules the scene mirrors into data attributes.
- **Verified.** 3 counter tests (prefix totals equal engine totals for presets 1–5, per-event
  increments, store lifecycle for counters and native reading); flood tests updated so presets 6–9
  flood and preset 9 gives up; preset tests assert the new input. Totals: 1,123 unit tests;
  4 browser tests in 46 s; lint, typecheck and production build pass.

## M7: Side-by-side mode

### Steps 1–3: mode toggle, linear-time run, and the linear playback model (`src/playback/linear.ts`)

- **Eligibility is decided from the IR, before any worker runs.** `linearEligibility` wraps M2's
  `compilePike`, so the Side-by-side button is disabled (with the compile error as the explanation)
  for backreferences, lookarounds, lookbehind and repetitions beyond the Thompson budget. Presets 4
  and 5 are the ineligible presets. If the pattern becomes ineligible while split mode is selected,
  the view falls back to single mode but remembers the choice, so returning to a regular pattern
  re-enters split mode without another click.
- **Second engine run, same budget.** In split mode the controller runs the Pike VM in its own worker
  alongside the backtracker (2.5 s wall, 20M steps) and publishes `{off | running | ready | unavailable
  | error}` through the playback store (`linear`). Cancelled runs are discarded silently; the stale
  reading is replaced when the new one arrives.
- **Model: one tick per visited input position.** `buildLinearRun` folds the per-thread trace into
  ticks. Each tick lists the live threads after the epsilon closure (in priority order, each with its
  IR node, start and the parent it split from), births, merges (thread → owner), deaths, whether a
  fresh attempt started there, and whether an accepting thread stands there. The head is the tick's
  position and only ever moves forward; `tickAtPosition` is the hook for synchronising both sides by
  input position (PLAN §4.9). Surrogate pairs under `u` produce ticks at 0, 2, 3 — UTF-16 positions,
  the same convention as the left side.
- **Two step figures, used deliberately.** `tick.tests`/`cumulativeTests` count one character test per
  live non-accepting thread: the honest per-tile work of a linear engine, derivable from the trace.
  `run.steps` is the engine's instruction count (includes epsilon moves), the figure that will be
  compared against the backtracking side's `steps` for the ratio, because both are instruction counts.
  The engine trace is unchanged.
- **Labels fact-checked** (PLAN §4.9): V8's non-backtracking engine still ships only behind
  `--enable-experimental-regexp-engine` flags (v8.dev, 2021 post is current); .NET 7+ has an opt-in
  `RegexOptions.NonBacktracking`; Ruby 3.2+ memoizes. The copy therefore says "Backtracking —
  JavaScript, Python, Java, PCRE" and "Linear time — RE2, Go, Rust" with a footnote for V8/.NET/Ruby.
- **Verified.** 7 unit tests (eligibility and spans, one tick per position with forward-only head,
  split/merge/death bookkeeping against `maxThreads`, accepting ticks and test counts against live
  rows, >1,000× step ratio on the evil regex, surrogate positions, truncated traces). Browser smoke
  test toggles the mode, checks the mirrored run attributes, the disabled state and message on the
  backreference preset, the ratio on the evil regex, and switching back. Totals: 1,130 unit tests;
  5 browser tests in 54 s; lint, typecheck and production build pass. Rendering the second board,
  the parallel marbles and per-side counters is the next step.

### Steps 4–7: the second board, parallel marbles, synchronised playback and per-side counters

- **Two boards, one layout.** In split mode the scene places the backtracking machine on the left and
  a second copy of the same `MachineLayout` on the right (`src/scene/LinearSide.tsx`), separated by
  `SPLIT_GAP`. `splitPlacement` derives both X offsets and a framing metric spanning the pair; the
  camera frames that and reserves 320 px on the right for the HUD so neither board hides behind it.
  The left board keeps its flood tank when it floods; the right board never floods, because the
  linear engine finishes. Each base plate carries its label: "BACKTRACKING · JavaScript, Python,
  Java, PCRE" and "LINEAR TIME · RE2, Go, Rust".
- **Synchronised by input position, forward only.** `buildCounters` now also records the head's
  high-water mark after each event. The right side shows the tick for that waterline (`syncLinear`),
  so when the left head jerks backward the right side holds still, and when the left finishes or
  floods the right side snaps to its last tick. The reconstructed head is checked against the
  waterline for every event of presets 1–5.
- **Parallel marbles.** One instanced sphere per live thread (`parallelMarbles`): on its gate when it
  waits at a character test, in the cup once it accepts, else on the node's entry point; threads that
  share a spot fan out on X. A newborn thread starts at its parent's marble and glides to its own
  gate with exponential smoothing (instant under reduced motion); merged and dead threads leave.
  Capped at 256 instances. The right tile rail colours consumed tiles teal and its head never moves
  backward.
- **Per-side counters and the ratio.** The HUD gains a two-column strip: left shows the backtracking
  step count already in the HUD; right shows the linear side's cumulative character tests (one per
  live non-accepting thread per position), counted as positions are left so both start at 0. The
  ratio line names the side that did more work ("Backtracking takes 6,827× the steps" on the evil
  regex; "Linear time takes 1.56× the steps" on `<.+>`, which is honest: several threads stay alive
  there). Engine instruction totals are mirrored on the canvas but not compared, because the two
  engines count instructions differently. On phones the strip shows the two counts only.
- **Verified.** 4 more unit tests (waterline monotonic and equal to the running max head, sync holds
  on backward steps and snaps at the end, marble placement and cup, split placement framing). The
  browser smoke test now steps the greedy preset in split mode and checks the right position never
  exceeds the left head's high-water mark, holds on step back, finishes with the final tick and test
  count, and that the evil regex floods on the left while the right finishes. Totals: 1,134 unit
  tests; 5 browser tests; lint, typecheck and production build pass. M7 done-criterion: split mode
  works for regular patterns with a clear message otherwise.

## M8: UI polish

### Step 1: URL sharing (`src/share.ts`)

- **Hash scheme as planned.** `#p=<base64url pattern>&f=<flags>&s=<base64url string>&m=<single|split>
  &preset=<id>`. Pattern and string are base64url over UTF-8 with padding stripped, so Unicode,
  newlines, `#`, `&`, `=` and `%` round-trip without percent-encoding anywhere in the hash. `f` is
  always written (an empty flag set must also round-trip); `m` is written only for split; `preset` is
  written only when all three fields equal a preset. When reading, explicit fields win over the
  preset, so an edited link keeps the edits, and `#preset=…` alone restores the whole preset.
- **Forgiving reader.** Hashes with no recognised keys (plain anchors, unknown preset ids) are ignored
  and the defaults load. Corrupt base64 or invalid UTF-8 falls back field by field; flags are
  filtered to `imsuvy`, de-duplicated into canonical order, and `uv` resolves to `v` as the toggle
  does; an unknown `m` keeps the current mode; oversized fields are clamped to `PATTERN_MAX` and
  `STRING_MAX`.
- **Writing and listening.** The app writes the hash with `history.replaceState` 250 ms after the
  last change so typing does not pollute history, and listens to `hashchange` so pasting a link into
  the address bar (or back/forward across hand-edited hashes) updates the inputs, the mode and the
  camera. Hashes the app itself wrote are recognised and ignored by the listener.
- **Copy link.** Writes the current state to the hash immediately and the full URL to the clipboard;
  a status line confirms or, if the clipboard is unavailable, says the address bar already holds it.
- **Verified.** 4 unit tests round-trip seven samples (Unicode, CR/LF, every flag, split mode, empty
  pattern and string, 2,000-character string), check preset detection and precedence, and the
  forgiving cases. The browser smoke test loads a Unicode split-mode link, checks the inputs, flag
  chip, mode and running comparison, edits the string and watches the hash follow, copies the link
  and decodes the clipboard, changes the hash by hand and sees the preset and mode switch, and
  confirms a plain load writes the default preset's hash. Totals: 1,138 unit tests; 6 browser tests;
  lint, typecheck and production build pass.

