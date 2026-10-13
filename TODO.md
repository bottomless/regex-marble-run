# TODO

- Support very large bounded repetitions in the Pike comparison without Thompson-program expansion.
  M2 currently returns a clear error above 50,000 compiled instructions/nonempty repetition bounds or
  500,000 compiler visits to protect worker memory and compilation time. The backtracking engine and
  native timing probe remain available for these patterns.
- Re-run the real-browser native-worker smoke check. Chromium has since been tested with SwiftShader
  (`--enable-unsafe-swiftshader`), and the preview proxy worked previously; the old Chromium-launch
  stall and proxy 404 are not current standing blockers. The native-worker browser smoke has **not**
  been rerun. Worker protocol, native watchdog, replacement, cancellation, and cleanup have unit-test
  coverage, but M4 static-scene browser tests do not exercise native timing or worker lifecycle.
  The latest static-scene E2E run passed all eight desktop/mobile tests; this does not verify the
  native-worker smoke check.
- Improve dense-pattern glyph readability and verify close-inspection zoom, especially on mobile.
  Screenshot review confirms that Cloudflare desktop and lookahead mobile gate captions are too
  small at overview scale. M4 normalizes the whole machine to fit; pan/zoom is available, but
  close-inspection readability has not been visually verified. Dark-mode desktop/mobile screenshots
  show distinct controls and main tracks, but small gate captions and muted capture frames still
  need a focused contrast/legibility review. All-preset visual readability acceptance remains open.
  Unicode glyph coverage also depends on browser-local fallback fonts.
- Finish M5 playback. Steps 1–15 animate the marble, tiles, flags, lifts, alternation and loop
  diverters, gate lamps, lookahead scout, capture brackets, mirror faces and the match celebration.
  The full 0.25x/0.5x/1x/2x/4x/16x/64x/instant speed ladder is available, including instant results
  for presets 1–5. Still open for the milestone: keyboard transport shortcuts (Space, arrows, +/-, F, R),
  scrubber markers (attempts, matches, backtrack-density strip) and the follow-marble camera.
  Capture brackets whose span falls outside the visible tile window are not drawn.
- M6 fps budget. Flood (sampled tank, log graduations, peak flag columns, settle clock), the
  Steps/Backtracks/Attempts/Flags/Native/Result HUD and preset 9's calibration are done; presets 6–9
  flood. Not yet measured: 60 fps on an M1-class laptop and ≥ 30 fps on a mid-range phone with 10,000
  instanced flood marbles (PLAN §11). Native time is measured on the visitor's machine, so the
  0.5–2 s calibration of preset 9 only holds for 2023-laptop-class CPUs.
- Browser coverage is a 46 s smoke set (4 tests). Piece-level playback behaviour (tile rail, flags,
  carriage, diverters, gate lamps, scout, capture brackets, mirrors, celebration), speed-ladder pose
  preservation, module expansion, dark/reduced-motion/debug views and the native-worker smoke are no
  longer exercised in a browser; they rely on unit tests over the pure modules.
- Desktop footer: the orbit hints overlapped the Instant speed pill; hints are now hidden below
  1600 px and the learn buttons moved into the control island. Resolved, pending screenshot review.
- Split mode polish: the right board repeats module expansion buttons' targets (expanding a module
  expands both sides, which is correct, but the right side has no gate lamps, diverter levers or
  capture brackets of its own); parallel marbles are not visualised merging into their owner (they
  simply disappear); the V8/.NET/Ruby footnote is a tooltip on the ratio line only.
- M8 done: URL sharing, bidirectional pattern↔piece highlighting, presets sheet, illustrated legend
  sheet, trace log drawer, "How it works" panel, mobile input row polish (16 px inputs, wrapping flag
  chips, bottom sheets), a11y pass (dialog semantics, scrubber value text, live result), reduced-motion
  audit. Module expansion state is not part of the shared URL. On mobile the legend and how-it-works
  buttons live inside the expandable controls, so they are one tap further away than on desktop.

