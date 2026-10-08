Build: Regex Marble Run
You are building a complete web app from an empty folder. Read this whole document before writing any code. Work autonomously through every milestone in section 13; do not stop after a demo. Only stop to ask if something is truly blocking. When a choice is ambiguous, make a sensible one and record it in DECISIONS.md. Never silently drop a feature: anything not done goes into TODO.md with a reason.
The target is a Show HN launch titled roughly "Your regex as a 3D marble run – watch catastrophic backtracking happen". Hacker News readers will poke at correctness, performance and polish. Build accordingly.

0. The product in one paragraph
The user types a regular expression and a test string. The regex is built into a 3D marble-run machine. A marble is the regex engine: it rolls through gates that read the input string one character at a time, takes the preferred lane at every fork while planting a flag for the untried lanes, and when a gate rejects it, a lift carries it back to the most recent flag. That is backtracking, made physical. A pathological regex like ^(a+)+$ on aaaaaaaaaaaaaaaaaaaaaaaa! makes the flags pile up and the machine flood with marbles. A side-by-side mode runs the same regex in a linear-time engine (the RE2 / Go / Rust approach) where the marble splits into parallel marbles that never roll back. Everything runs in the browser; it's a static site deployed on Vercel.

1. The metaphor — exact mapping (implement this precisely)
Regex concept	Machine part	Behaviour
Input string	Tile rail along the front base of the machine; one lettered tile per character	A read head marks the current position. Consumed tiles light up; on backtrack they un-light back to the restored position. Long strings show a scrolling window around the read head.
Match attempt at start index k	Hopper at the top releases a marble	Read head jumps to k. If the attempt fails, the marble drops into the reject tray and the hopper advances to k+1.
Literal / class / . / \d etc.	Gate: an arch with the glyph engraved on it (a, [0-9], \w, .)	Compares with the tile under the read head. Pass → tile lights, head advances, marble continues. Reject → trapdoor drops the marble onto the return rail.
Alternation `a	b	c`
Quantifier * + ? {m,n}	Loop: the body sits in a lane; a loop lift returns the marble above the body; a bypass chute skips it	A diverter at the loop entrance chooses "again" or "exit". Greedy defaults to "again", lazy to "exit"; the other option plants a flag. A small counter dial shows the iteration count.
Choice points (backtrack stack)	Flags on diverters	Flag count = stack depth, shown in the HUD. In catastrophic cases flags stack into visible columns.
Backtrack	Marble on the return rail is carried by a lift running behind the machine (−Z) to the most recent flag	The flag is consumed, the read head rewinds to the flag's stored position, tiles un-light, and the marble takes the next lane.
Capturing group	Coloured frame around its section, labelled 1, 2 or <name>	Captured spans show as matching coloured brackets above the tile rail.
^ $ \b \B	Sensor lamp: no tile consumed	Lamp flashes green or red.
Lookahead (?=…) (?!…)	Scout: a small marble runs a side track	Ghost-highlights the tiles it reads, then returns. Main marble passes if the scout succeeded (or failed, for negative).
Backreference \1	Mirror gate whose face shows the currently captured text, updating live	Must match several tiles at once.
Lookbehind	Sealed black-box gate (v1)	Evaluated natively; see 4.2.
Match	Finish cup at the bottom	Matched tiles glow gold; result chip shows index and groups.
Why this is 3D and not a 2D diagram: gravity is progress, loops and return lifts live behind the front plane so the front stays readable, and the flood is a physical pile. Use depth deliberately.

2. Non-negotiables
1. Correctness. The backtracking engine must agree with the browser's native RegExp (match index, matched text, every capture, named groups) on everything it claims to support. This is enforced by differential tests (section 10). If a feature can't be supported correctly, show a clear message; never silently show wrong behaviour.
2. The user's own input is the main feature: any regex, any string, instantly rebuilt.
3. Playback control: play/pause, single-step forward and back, speed from 0.25× to "instant", scrubbing.
4. The 3D view stays clean. UI chrome is compact and floats at the edges. No panel may cover more than ~20% of the canvas by default.
5. Fast and smooth. First meaningful frame < 2.5 s on a mid laptop; 60 fps in normal playback; the engine never blocks the main thread.
6. Works on mobile (390 px wide, touch orbit) and with prefers-reduced-motion.
7. No backend, no accounts, no tracking, no cookies. Static site.
8. Honest copy (section 9).

3. Stack and setup
* Vite + React + TypeScript (strict). Single-page static app; state lives in the URL hash, so no router is needed.
* three, @react-three/fiber, @react-three/drei (latest stable, compatible majors).
* zustand for app state.
* @eslint-community/regexpp for parsing.
* Web Workers via Vite's new Worker(new URL('./x.worker.ts', import.meta.url), { type: 'module' }).
* Vitest + fast-check for unit, property and differential tests; Playwright for an end-to-end smoke test.
* ESLint + Prettier. Self-hosted fonts via @fontsource/* (no runtime font CDN).
* Node ≥ 20. Use npm. Scripts: dev, build, preview, test, test:diff:long, e2e, lint, typecheck.
* git init at the start and commit at the end of each milestone with clear messages.
Suggested layout:

src/
  engine/     parse.ts ir.ts chartest.ts backtrack.ts pikevm.ts trace.ts engine.worker.ts native.worker.ts
  layout/     layout.ts pieces.ts route.ts
  scene/      Machine.tsx Gates.tsx Tracks.tsx Marbles.tsx TileRail.tsx Flood.tsx Camera.tsx materials.ts
  playback/   timeline.ts store.ts
  ui/         PatternInput.tsx TestStringInput.tsx Transport.tsx Hud.tsx Presets.tsx Legend.tsx TraceLog.tsx
  presets.ts  copy.ts  url.ts  App.tsx main.tsx
tests/        engine/ layout/ e2e/

4. Architecture
4.1 Parsing → IR
Parse with regexpp: new RegExpParser(options).parsePattern(source, 0, source.length, { unicode, unicodeSets }) and parse flags separately. Configure the parser for the latest ECMAScript version it supports (check its options) so modifiers and the v flag parse. u and v are mutually exclusive; the flag chips must enforce that. Convert the AST to a small internal IR. Every IR node keeps span: [start, end] into the pattern source, used for bidirectional highlighting (section 5).

ts
type NodeId = number;
type IR =
  | { kind: 'seq';     id: NodeId; span: Span; items: IR[] }
  | { kind: 'alt';     id: NodeId; span: Span; branches: IR[] }
  | { kind: 'char';    id: NodeId; span: Span; label: string; tester: number }   // Character, CharacterClass, CharacterSet, '.'
  | { kind: 'repeat';  id: NodeId; span: Span; min: number; max: number; greedy: boolean; body: IR; capturesInside: number[] }
  | { kind: 'group';   id: NodeId; span: Span; capture: number | null; name: string | null; body: IR; flags: EffectiveFlags }
  | { kind: 'assert';  id: NodeId; span: Span; what: 'start' | 'end' | 'word' | 'notWord' }
  | { kind: 'look';    id: NodeId; span: Span; negate: boolean; body: IR }        // lookahead only
  | { kind: 'opaque';  id: NodeId; span: Span; label: string; probe: number }     // lookbehind (v1)
  | { kind: 'backref'; id: NodeId; span: Span; groups: number[] }                // ambiguous duplicate-named refs resolve to several
  | { kind: 'empty';   id: NodeId; span: Span };
* regexpp node types you'll handle: Pattern, Alternative, Group (may carry modifiers, e.g. (?i:…)), CapturingGroup, Quantifier (min, max may be Infinity, greedy), Character, CharacterClass, CharacterSet (any, digit, space, word, property), ExpressionCharacterClass, Assertion (start, end, word with negate, lookahead, lookbehind), Backreference.
* Modifiers ((?i:…), (?-i:…)) change effective flags for their body; carry effective flags down the tree.
* Unsupported in v1, with a friendly inline message pointing at the span: lookbehind containing capturing groups or backreferences; v-flag classes that can match multi-character strings (\q{…}, properties of strings). Everything else must work.
* Limits: pattern ≤ 300 characters; test string ≤ 2,000 characters.
4.2 Backtracking engine with trace (backtrack.ts)
Implement ECMAScript RegExp.prototype.exec semantics (ECMA-262, RegExp pattern semantics) as an explicit-stack backtracking VM over the IR. No JS recursion proportional to input or iterations; deep inputs must not overflow the call stack.
Character tests via native RegExp (the key trick for exact semantics): for every char node, compile a native single-character tester once, e.g. new RegExp('^(?:' + raw + ')$', flagsFor(node)) using only the i, s, u, v flags that apply. Test the candidate character with it. Case folding, \w under iu, Unicode properties, dot vs line terminators and class ranges then all match V8 exactly. Cache testers by (raw, flags). Do the same for \b word-character checks and case-insensitive backreference comparison.
Semantics checklist (each one needs a test):
1. Unanchored search tries start positions 0..len in order; the y flag means only lastIndex = 0; g is ignored (single exec from 0); d is ignored.
2. Positions are UTF-16 code-unit indices, matching native index. With u or v, a character is a code point (advance 2 units for surrogate pairs).
3. Alternation tries branches left to right.
4. Greedy: body first, then continuation. Lazy: continuation first.
5. Empty-iteration rule: once min is satisfied, an iteration that consumes nothing fails (spec RepeatMatcher). Without it, (a*)* loops forever.
6. Capture reset: captures inside a quantified atom reset to undefined at the start of each iteration.
7. A backreference to an unset group matches the empty string. With i, compare case-insensitively via the native tester approach.
8. Lookahead is atomic: after it succeeds, its internal choice points are discarded. Captures from a positive lookahead persist; a negative lookahead leaves them undefined.
9. ^ and $ respect m (line terminators \n, \r, , 10. ).
11. {n,m} with large bounds must not allocate per possible iteration.
12. Lookbehind (opaque node) in v1: evaluate natively with a sticky probe built from the assertion's own raw text ((?<=…) or (?<!…)), i.e. new RegExp(raw, effectiveFlags + 'y') with lastIndex = pos; it holds if exec matches the empty string there. It counts as one step and shows as a black-box gate.
Steps: one step = one gate/sensor/mirror/scout test, or one backtrack (flag popped). Document this definition in the UI ("What's a step?").
Trace: record events for the animation:

ts
type TraceEvent =
  | { t: 'attempt';   start: number }
  | { t: 'test';      node: NodeId; pos: number; ok: boolean; len: number }    // gate, sensor, mirror, opaque
  | { t: 'choose';    node: NodeId; option: number; pos: number; depth: number } // flag planted
  | { t: 'backtrack'; node: NodeId; option: number; pos: number; depth: number } // flag popped, read head → pos
  | { t: 'iter';      node: NodeId; count: number }
  | { t: 'look';      node: NodeId; phase: 'start' | 'end'; ok?: boolean }
  | { t: 'capture';   group: number; start: number; end: number }             // -1 = unset
  | { t: 'match';     start: number; end: number }
  | { t: 'nomatch' };
* Run the engine in engine.worker.ts. Encode the trace as struct-of-arrays typed arrays (Int32Array columns) and transfer them; don't post 200k objects. Support cancellation when the input changes.
* Budgets: record at most 250,000 events. After that, keep running in count-only mode, sampling a checkpoint every 1,000 steps (stack depth, read-head position) for the flood visual. Hard stop at 50,000,000 steps or 4 s wall time, and report "gave up after N steps".
* Final result: { matched, index, groups, namedGroups, steps, backtracks, attempts, maxDepth, truncated, gaveUp }.
4.3 Linear-time engine (pikevm.ts)
Compile the IR to a Pike VM program (instructions: char(tester), split(x, y) with priority order, jmp, save(n), assert(kind), match) and simulate it with thread lists in priority order. That gives leftmost-first results like a backtracking engine without ever backtracking. Deduplicate threads per PC per position. Include the usual empty-loop guard.
* Only regular patterns: if the pattern has backreferences or lookarounds, the right-hand panel says that linear-time engines (RE2, Go regexp, Rust regex) reject these features, and explains why.
* Trace per input position: the set of live threads with their IR nodes, plus thread births, merges and deaths. Steps = thread-advances.
* Differential-test the match span against native. Don't compare captures: capture semantics inside repeated groups differ between ECMAScript and RE2-family engines (ES resets them per iteration), and the UI should note this in one line.
4.4 Native timing probe (native.worker.ts)
Run new RegExp(pattern, flags).exec(string) in a dedicated worker and time it with performance.now(). The main thread kills the worker after 3 s and shows "> 3 s (killed)". The HUD shows this as: "Your browser's own regex engine: 1.84 s". This line is the viral hook for the evil presets; make it prominent when it exceeds 100 ms.
4.5 Layout (layout.ts) — a pure, unit-tested function
layout(ir): MachineLayout, with no Three.js imports (use plain {x, y, z}).

ts
interface MachineLayout {
  bounds: { min: Vec3; max: Vec3 };
  pieces: Piece[];   // track segments (curves), gates, diverters, funnels, loop lifts, bypass chutes,
                     // return rail, back lifts, group frames, sensors, scouts, hopper, cup, reject tray
  graph: { points: TrackPoint[]; edges: TrackEdge[] };   // directed track graph for routing marbles
  anchors: Record<NodeId, { entry: number; exit: number; gate?: Vec3; diverter?: Vec3; flagSlot?: Vec3; returnPort?: number }>;
}
Rules:
* Flow is top to bottom (−Y). Every track segment has a slight descending slope so motion reads as gravity.
* seq stacks children vertically. Runs of more than ~6 simple gates fold into switchbacks (zig-zag ramps) so long literals stay compact.
* alt places branches side by side on X, with a diverter on top and a merge funnel below.
* repeat puts the body in a lane; the loop lift and bypass chute sit beside it; the loop-return path goes behind (−Z).
* The return rail and back lifts for backtracking run on a rear plane (−Z) and connect to each diverter's returnPort.
* Groups add a frame with a small Z offset per nesting depth.
* Measure-then-place recursion; no overlapping gate bounding boxes (tested).
* Complexity guard: above ~80 IR leaves, collapse deeper groups into compact "modules" that expand on click. Above a hard cap, show a friendly "too big to build" message; the engine HUD and trace log still work.
route.ts: shortest path on the track graph between two anchor points, cached. The animation uses it to move a marble from one gate to the next.
4.6 Rendering (scene/)
* Tracks: TubeGeometry (or extruded profiles) along curves, merged per material.
* Gates, diverters and sensors: instanced where repeated. Engraved glyphs via drei <Text>.
* Marbles: one hero marble with a nice physical material; flood and parallel marbles as InstancedMesh.
* Lighting: environment built from drei <Environment> with <Lightformer>s (no external HDR downloads), soft contact shadows, gentle ACES tone mapping. Keep post-processing light or none.
* Camera: orbit with damping; auto-frame the whole machine on rebuild; optional "follow marble" mode with smooth damping. Respect reduced motion (no camera moves; instant transitions).
* Rebuilding on input change animates pieces in briefly (≤ 300 ms); it never blocks typing.
4.7 Playback (playback/)
* timeline.ts converts trace events into timed motion segments: roll along a route, gate check (short pause plus tile highlight), trapdoor drop, lift ride on the rear plane, flag plant/pop, read-head moves. Durations scale with speed; at high speeds collapse motion into jumps.
* Transport: ⏮ step back, ▶/⏸, step ⏭, speed (0.25×, 0.5×, 1×, 2×, 4×, 16×, 64×, instant), scrubber with markers (attempts, matches) and a thin backtrack-density strip.
* Stepping backward must restore exact state (tiles, flags, read head, captures, counters). Keep periodic keyframes so seeking is fast.
* Keyboard: Space play/pause, ← / → step, + / − speed, F follow, R restart.
4.8 Flood mode (Flood.tsx)
When the recorded trace is truncated or steps exceed ~3,000, switch to flood presentation:
* The camera pulls back. Marbles stream from the hopper. Backtracks are sampled (1 marble per N, with N shown as "1 marble = N backtracks") and drop into a glass collection tank with log-scaled graduations (10², 10³ … 10⁸).
* Flag columns grow on the diverters, driven by sampled stack depth.
* Settle marbles onto a cheap heightfield (no physics engine needed), capped at ~10k instances.
* Counters spin up to the final numbers. The native-time line appears.
4.9 Side-by-side mode
Same machine twice, synchronised by input position:
* Left: "Backtracking — JavaScript, Python, Java, PCRE". The read head jerks back and forth.
* Right: "Linear time — RE2, Go, Rust". The marble splits at diverters into parallel marbles that advance together one tile per tick and merge when they reach the same gate. The read head only ever moves forward. That contrast is the point.
* Before writing the engine labels, verify the current status of each engine and phrase accordingly. For example: is V8's experimental linear-time engine enabled by default? Ruby 3.2+ added memoization that defuses many classic ReDoS patterns, which is why Ruby is left off the label; .NET has an opt-in non-backtracking mode.
* Each side has its own step counter; show the ratio.

5. UI and UX
* Full-bleed canvas. A floating pattern capsule at the top: / pattern / flags, monospace, syntax-highlighted. Below it the test string field. Invalid regex → inline error with a caret at the position.
* Flags as toggle chips: i m s u v y (g and d shown disabled, with a tooltip explaining why they don't apply).
* Bidirectional highlighting: hovering or focusing a gate highlights its source span in the pattern, and hovering pattern characters highlights the corresponding pieces. While playing, the span of the active node is highlighted. This is the main learning aid; make it feel instant.
* HUD (small, top-right): Steps · Backtracks · Attempts · Flags (stack depth) · Native time · Result.
* Transport bar at the bottom (section 4.7).
* Mode toggle: Single / Side by side.
* Presets button opening a sheet (section 7).
* Legend ("How to read the machine") with small illustrations of each piece.
* Trace log drawer (virtualised): human-readable steps such as pos 3 · gate [a-z] vs "7" → rejected · back to flag at |. Accessible, copyable, and useful to people who want proof.
* Mobile: inputs collapse into one row with an expand toggle; the HUD collapses to Steps + Result; transport stays usable with thumbs.
* Accessibility: labelled controls, visible focus, keyboard operable, the trace log as the screen-reader-friendly view, reduced motion honoured.

6. Art direction
A precision toy / design object, not a sci-fi dashboard.
* Materials: light birch-plywood tracks with visible edge layers, brushed-brass gates with engraved glyphs, steel or glass marbles, painted enamel diverters. Role colours: alternation = cobalt, quantifier = vermilion, lazy quantifier = teal, capture frames from a small harmonious palette.
* Setting: a soft off-white studio sweep with contact shadows and a warm key light. A "night workshop" dark variant follows prefers-color-scheme.
* Typography: a crisp monospace for patterns and tiles (e.g. JetBrains Mono or IBM Plex Mono) plus one characterful grotesk for UI. Self-hosted.
* Avoid: purple/blue gradients, glassmorphism cards, neon glow everywhere, emoji in UI, generic "AI landing page" sections, gratuitous bloom.
* Motion is physical and calm: ease-in on drops, small overshoot on flag pops, satisfying but quiet. Optional subtle sound (wood clicks, marble rolls) off by default, with a mute toggle.
* Define design tokens (colours, radii, spacing, type scale) in one place.

7. Presets (presets.ts)
Each preset has pattern, flags, string, a one-to-two sentence caption, and an optional source link. Calibrate the evil ones so the native engine takes roughly 0.5–2 s on a 2023 laptop, and note the calibration in DECISIONS.md.
1. First ride — c(a|o)t on the cot: attempts sliding, a diverter, one rejection.
2. Greedy vs lazy — <.+> and <.+?> on <b>bold</b> (two presets, or one with a toggle).
3. Optional letter — colou?r on my color.
4. Backreference — (\w)\1 on hello.
5. Lookahead password check — ^(?=.*\d)(?=.*[a-z]).{8,}$ on hunter22x.
6. The evil regex — ^(a+)+$ on a run of as followed by ! (exponential).
7. Another classic — ^([a-zA-Z]+)*$ on letters followed by 1 (from the OWASP ReDoS examples).
8. Stack Overflow, July 2016 — ^[\s‌]+|[\s‌]+$ on a string with a long run of whitespace that is not at the end (super-linear: quadratic). Use ~2,000 whitespace characters; the tile rail windows them.
9. Cloudflare, July 2019 — the core .*(?:.*=.*) from their postmortem on the example string the postmortem uses. Note that our step counts use a different definition from theirs.
For presets 8 and 9, read the original postmortems (Stack Exchange's outage postmortem of 20 July 2016; Cloudflare's "Details of the Cloudflare outage on July 2, 2019") and get every factual claim and link right. Don't invent numbers.

8. Sharing and URL state
* State lives in the hash: #p=<base64url pattern>&f=<flags>&s=<base64url string>&m=<single|split>&preset=<id>. Update it debounced as the user types; restore it on load.
* A "Copy link" button. Links must round-trip exactly, including Unicode and newlines (tested).
* public/og.png (1200×630): render it with Playwright from a special ?og=1 view showing the evil preset mid-flood with the product name. Generate it once and commit it; don't run Playwright during the Vercel build. Add title, description, Open Graph and Twitter meta tags, and a marble favicon.

9. Copy and honesty
* Keep all user-facing text in src/copy.ts so it can be rewritten in one place. Write short placeholder copy and mark each string // HUMAN: rewrite. The author will rewrite it in their own voice before launch.
* Avoid LLM tics: "not X, but Y" constructions, "delve", "seamless", "unlock", em-dash chains, triple adjectives, exclamation marks.
* A short "How it works" panel: what a step is, what the flags mean, why backtracking explodes, why linear-time engines don't. Credit regexpp, three.js / React Three Fiber, and Russ Cox's "Regular Expression Matching Can Be Simple And Fast" (https://swtch.com/~rsc/regexp/regexp1.html).
* State limitations plainly (lookbehind shown as a black box, v-flag string classes unsupported, capture semantics note in split mode).

10. Testing
* Parser → IR unit tests for every node type, modifiers, and spans.
* Differential: backtracking engine vs native RegExp.exec with fast-check. Generate random patterns from a grammar: literals over {a, b, c}, classes and negated classes, ., \d \w \s and negations, groups (capturing, named, non-capturing), alternation, * + ? {m,n} greedy and lazy, ^ $ \b \B, backreferences to earlier groups, lookaheads, modifiers. Generate strings over {a, b, c, A, '\n', ' ', '1'} and flag subsets of i m s u y.
    * Compare index, [0], every group and groups.
    * Run our engine first with a low step cap (e.g. 100k) and skip the case if it hits the cap, so a catastrophic random pattern never hangs the native call.
    * Seeded run of ≥ 20,000 cases in npm test; npm run test:diff:long runs ≥ 1,000,000.
    * Zero mismatches is the bar. Keep a regression file of any case that ever failed.
* Differential: Pike VM vs native, match span only, on the regular subset, ≥ 20,000 cases.
* Semantics checklist tests for every item in 4.2.
* Growth sanity: steps for ^(a+)+$ on aⁿ! grow at least exponentially as n goes from 10 to 20; Pike VM steps grow linearly.
* Layout invariants for presets and for fuzzed patterns: every leaf has a gate; no overlapping gate boxes; every route between consecutive gates exists; bounds are finite; layout of the largest allowed pattern takes < 50 ms.
* Timeline: monotonic times; stepping backward from any point restores identical state to stepping forward to that point.
* URL round-trip tests.
* Playwright e2e:
    * The page loads with no console errors.
    * Each preset runs to the end in "instant" mode.
    * Split mode renders.
    * A share link restores state.
    * A 390×844 mobile viewport screenshot looks right.

11. Performance budgets
* Initial JS ≤ 450 KB gzipped (three.js included). Code-split anything not needed for the first frame (trace log, legend, split mode).
* Main-thread tasks ≤ 50 ms while typing and playing.
* 60 fps on an M1-class laptop with 10k instanced flood marbles; ≥ 30 fps on a mid-range phone.
* Rebuilding the machine after an edit takes < 100 ms for typical patterns.

12. Deployment (Vercel)
* Static build: npm run build → dist/. No serverless functions, no environment variables.
* Add vercel.json:

json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "vite",
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "headers": [
    { "source": "/assets/(.*)", "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }] },
    { "source": "/(.*)", "headers": [
      { "key": "X-Content-Type-Options", "value": "nosniff" },
      { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" }
    ] }
  ]
}
* Verify locally with npm run build && npm run preview, and run the e2e suite against the preview build.
* README: what it is, how to run, how to test, how to deploy (import the repo in Vercel; no settings needed), the engine semantics and their limits, and credits.
* MIT license.

13. Milestones (complete all, in order; each ends with tests green and a commit)
#	Milestone	Done when
M0	Scaffold, tooling, vercel.json, CI-style scripts, empty canvas page	build, lint, typecheck, test all pass
M1	Parser → IR + backtracking engine + trace + worker	Semantics tests and 20k differential cases pass with zero mismatches
M2	Pike VM + native timing probe	Pike differential passes; growth sanity test passes
M3	Layout + routing (pure) + a ?debug=layout top-down SVG view	Layout invariant tests pass for all presets and fuzzed patterns
M4	3D machine rendering (static) with art direction	Every preset builds a clean, readable machine
M5	Playback: marble, tiles, flags, lifts, transport, backward stepping	Timeline tests pass; presets 1–5 play end to end
M6	Flood mode + native-time HUD	Presets 6–9 flood correctly; fps budget holds
M7	Side-by-side mode	Split mode works for regular patterns, with a clear message otherwise
M8	UI polish: highlighting, presets sheet, legend, trace log, mobile, a11y, reduced motion, URL sharing	e2e suite passes on desktop and mobile viewports
M9	Copy placeholders, OG image, meta tags, README, final perf pass	Bundle and fps budgets met; npm run build && npm run preview serves a launch-ready site
14. Out of scope for v1
Backend, accounts, analytics, comments, lookbehind visualisation (black box only), v-flag string classes, other regex flavours (Python/PCRE syntax), VR/XR, i18n.
Stretch goals, only after M9:
* A growth chart: steps vs input length for prefixes of the test string, with an exponential or polynomial fit.
* A "fix it" hint suggesting an equivalent non-catastrophic rewrite for the classic presets.

15. Final report
When done, write REPORT.md with:
* What was built.
* Test results (counts, mismatches = 0).
* Measured bundle size and fps.
* Known limitations.
* Everything in TODO.md and DECISIONS.md.
* The exact steps to deploy on Vercel.