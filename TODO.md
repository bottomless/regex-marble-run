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
  Still open for the milestone: keyboard transport shortcuts (Space, arrows, +/-, F, R), the
  0.25x/16x/64x/instant speed pills and scrubber markers (attempts, matches, backtrack-density strip),
  follow-marble camera, and replacing the stale "Static build · playback arrives in M5" stage status.
  Capture brackets whose span falls outside the visible tile window are not drawn.
