# TODO

- Support very large bounded repetitions in the Pike comparison without Thompson-program expansion.
  M2 currently returns a clear error above 50,000 compiled instructions/nonempty repetition bounds or
  500,000 compiler visits to protect worker memory and compilation time. The backtracking engine and
  native timing probe remain available for these patterns.
- Re-run the real-browser worker smoke check when the environment can launch Chromium. Playwright's
  installed headless browser stalled during launch; the worker protocol, native watchdog, replacement,
  cancellation and cleanup are covered by unit tests. The assigned preview proxy also returned 404
  despite Vite listening on the assigned port and returning HTTP 200 locally.
