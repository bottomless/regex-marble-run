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
- Implement trace-driven marble playback in M5. M4 has physical tracks, continuation return routes,
  scoped scout routes, and a static input rail, but does not animate regex execution.
