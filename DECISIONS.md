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
