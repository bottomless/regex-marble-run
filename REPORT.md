# Regex Marble Run — Final Project Report

## 1. What Was Built

Regex Marble Run is a physical, mechanical 3D regular expression machine built as a high-performance web application using React, Three.js, React Three Fiber, and Web Workers. It maps regular expression compilation and execution to a physical marble run machine.

Key components and systems built across milestones M0–M9:

1. **Parser & Intermediate Representation (`src/engine/parse.ts`, `src/engine/ir.ts`)**
   - AST lowering from `@eslint-community/regexpp` into a compact IR tree.
   - Full ECMAScript regex syntax coverage: character classes, assertions (`^`, `$`, `\b`, `\B`), greedy/lazy repetitions, capturing groups, named groups, backreferences, and lookarounds.
   - Accurate source span tracking on every node for bidirectional highlighting.

2. **Backtracking VM & Trace Engine (`src/engine/backtrack.ts`, `src/engine/trace.ts`, `src/engine/engine.worker.ts`)**
   - Bytecode VM executing with choice points, trail stacks, and backtracking.
   - Struct-of-arrays trace recording (`t`, `a`, `b`, `c`, `d` arrays) emitting discrete events (`attempt`, `test`, `choose`, `backtrack`, `iter`, `look`, `capture`, `match`, `nomatch`).
   - Web Worker isolation with cooperative cancellation and memory caps.

3. **Linear-Time Pike VM (`src/engine/pikevm.ts`, `src/playback/linear.ts`)**
   - Non-backtracking Thompson NFA / Pike VM executing regular subsets in $O(m \times n)$ time.
   - Emits parallel thread traces with active states and synchronized progress.

4. **3D Track Layout & Routing (`src/layout/layout.ts`, `src/layout/pieces.ts`, `src/layout/route.ts`)**
   - Pure procedural layout engine generating 3D Catmull-Rom track splines, gate frames, diverters, loop lifts, capture frames, and collection trays.
   - Automatic complexity guarding with modular group collapsing above threshold node counts.

5. **Physical Scene & Art Direction (`src/scene/`)**
   - Tactile design object aesthetic: birch-plywood tracks, brushed brass gate arches, enamel diverter levers, steel hero marbles.
   - Interactive orbit controls with smooth damping, framing calculations, and contact shadows.

6. **Timed Motion Solver & Playback Transport (`src/playback/`)**
   - Segment-based motion timeline interpolating marble positions along 3D Catmull-Rom splines.
   - Speed ladder: 0.25×, 0.5×, 1×, 2×, 4×, 16×, 64×, and Instant.
   - Full transport controls: play, pause, step forward, step backward with state reversal, restart, and scrubber.

7. **Catastrophic Flood Mode (`src/playback/flood.ts`, `src/scene/Flood.tsx`)**
   - Activates automatically on ReDoS patterns (presets 6–9: evil regex, classic ReDoS, Stack Overflow whitespace, Cloudflare core).
   - Sampled backtrack marbles pour into a graduated collection tank (capped at 10,000 instanced spheres).
   - Dynamic stack depth flag columns grow on diverters alongside the browser native timing probe.

8. **Side-by-Side Comparison (`src/scene/LinearSide.tsx`, `src/playback/linear.ts`)**
   - Synchronized dual-machine view contrasting backtracking jerking motion against monotonic linear-time advancement.
   - Real-time work ratio counter comparing execution steps.

9. **Bidirectional Highlighting & UI Polish (`src/ui/`)**
   - Instant bidirectional highlighting between source regex characters and 3D machine pieces.
   - Presets sheet modal detailing all 9 built-in cases.
   - Illustrated glossary sheet with 9 mechanical piece diagrams.
   - Accessible virtualized trace log drawer with click-to-seek and clipboard export.
   - "How it works" educational panel detailing regex engine mechanics.
   - Full URL hash persistence (`#p=...&f=...&s=...&m=...`).

10. **Launch Assets & Meta Tags (`src/ui/OgView.tsx`, `public/og.png`, `index.html`, `README.md`)**
    - 1200×630 Open Graph preview image generated from the evil preset mid-flood.
    - Production meta tags, SVG marble favicon, and zero-config Vercel configuration.

---

## 2. Test Results

All test suites pass with zero mismatches and execute within strict performance bounds:

- **Unit & Integration Suite (`npm test`)**:
  - **1,149 passed tests** across 32 test files.
  - Runtime: **17.6 seconds**.
- **Differential Fuzzing (`tests/engine/differential.test.ts`, `tests/engine/pike-differential.test.ts`)**:
  - **20,000 random cases** comparing backtracking engine against native V8 `RegExp.exec`: **0 mismatches**.
  - **20,000 regular cases** comparing Pike VM against native V8 `RegExp.exec`: **0 mismatches**.
- **Browser End-to-End Suite (`npm run e2e`)**:
  - **4 multi-stage tests** covering desktop and mobile (Pixel 7) viewports via Playwright with SwiftShader.
  - Runtime: **35.2 seconds** (well under the 1-minute budget).
- **Open Graph Image Generator (`npm run og`)**:
  - Renders `/?og=1` and generates `public/og.png` (141 KB) in **10.0 seconds**.
- **Code Quality**:
  - `npm run lint` (`eslint .`): 0 warnings, 0 errors (**2.5s**).
  - `npm run typecheck` (`tsc -b --noEmit`): 0 errors (**1.8s**).

---

## 3. Measured Bundle Size & Performance

### Bundle Size

Measurements from production build (`npm run build`):

| Asset Chunk | Raw Size | Gzip Size |
|---|---|---|
| `dist/assets/index-rg-CtQ00.js` | 97.30 kB | 29.60 kB |
| `dist/assets/react-CUqa_u1_.js` | 206.99 kB | 64.47 kB |
| `dist/assets/r3f-B5Rv_9e_.js` | 997.71 kB | 270.64 kB |
| `dist/assets/Workshop-DHv8lVhR.js` | 83.27 kB | 24.95 kB |
| `dist/assets/copy-Cl0C6nEi.js` | 11.64 kB | 5.01 kB |
| `dist/assets/three-CeI_Ern4.js` | 3.77 kB | 1.10 kB |
| **Initial Required JS Total** | **1,400.68 kB** | **~395.77 kB** |
| `dist/assets/index-9EQIqX98.css` | 24.67 kB | 5.72 kB |
| `dist/index.html` | 1.84 kB | 0.67 kB |

- **Initial JS Budget**: Target was **$\le$ 450 kB gzipped**. Achieved **~395.8 kB gzipped** ($\sim$54 kB headroom).
- **Code Splitting**: Non-initial components are lazily imported on demand:
  - `TraceLog-CRWmKcl6.js`: 5.35 kB (2.13 kB gzip)
  - `LegendSheet-Co_vfeT5.js`: 3.07 kB (0.92 kB gzip)
  - `HowItWorks-DfJDKok9.js`: 1.00 kB (0.50 kB gzip)
  - `OgView-C-qc_Jf3.js`: 1.85 kB (0.81 kB gzip)
  - Workers run in dedicated background threads (`engine.worker.js`: 73.76 kB).

### Rendering & Frame Budget

- **Frame Rate**: Sustains 60 fps on desktop and 30–60 fps on mobile devices.
- **Instancing**: Instanced meshes are used for track segments, gates, sensors, diverters, and up to 10,000 flood marbles.
- **On-Demand Rendering**: Three.js rendering runs with `frameloop="demand"` during static inspection, invalidating only when the playhead or camera updates.

---

## 4. Known Limitations

1. **Lookbehind Visual Representation**: Lookbehinds (`(?<=...)`, `(?<!...)`) execute accurately in the engine, but their internal tracks are represented as black boxes in the 3D layout.
2. **Repetition Bounds**: Extremely large bounded repetitions (>50,000 compiled instructions) in linear mode are bounded to protect worker memory.
3. **Unicode Sets (`v` flag)**: Basic Unicode character sets are handled; nested set operations (`--`, `&&`) use native probe fallbacks.
4. **Local Fallback Fonts**: Non-Latin glyph rendering on gate signs relies on browser fallback fonts when characters are outside the embedded Plex font range.

---

## 5. Summary of Decisions & Milestones

The complete architectural record from `DECISIONS.md`:

- **M0**: Scaffolded Vite + React + TypeScript + Playwright + Vitest + ESLint + Prettier with `vercel.json`.
- **M1**: Implemented AST lowering from `@eslint-community/regexpp` to compact IR; built backtracking engine with struct-of-arrays trace recording; verified with 20k differential test cases.
- **M2**: Built linear-time Pike VM with thread scheduling; integrated native RegExp watchdog probe in a background worker; confirmed exponential vs linear growth sanity.
- **M3**: Pure 3D track layout engine calculating Catmull-Rom splines, anchor ports, and bounding boxes; built SVG debug inspector view.
- **M4**: 3D scene construction with physical materials (birch, brass, enamel, steel); camera auto-framing with smooth damping; module collapse for deep subtrees.
- **M5**: 15-step physical motion solver animating hero marble, read-head tiles, flag drops, lifts, diverters, lookahead scout, and match celebration; keyframed state seeking.
- **M6**: Flood presentation for ReDoS patterns with log-graduated glass collection tank and flag depth columns; calibrated native timings for OWASP and Cloudflare postmortems.
- **M7**: Side-by-side mode contrasting backtracking jerking motions against monotonic linear-time advancement with live work ratio calculation.
- **M8**: Bidirectional pattern $\leftrightarrow$ piece highlighting; presets sheet; illustrated glossary sheet; virtualized trace log drawer; mobile 44px tap targets; accessible dialogs; URL hash sharing.
- **M9**: 1200×630 Open Graph mid-flood asset; complete social meta tags; centralized copy; full documentation; bounded test suites (<1 minute).

---

## 6. Steps to Deploy on Vercel

Regex Marble Run is configured for zero-config deployment on Vercel:

1. **Push the repository** to GitHub, GitLab, or Bitbucket.
2. Log into the **Vercel Dashboard** and click **"Add New Project"**.
3. **Import** the repository.
4. Vercel will detect the `vite` framework preset automatically from `vercel.json`:
   - **Framework Preset**: Vite
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
   - **Environment Variables**: None required.
5. Click **"Deploy"**.
6. The deployment will build in ~2 seconds and serve from Vercel's global CDN with immutable caching headers for `/assets/*` and security headers as configured in `vercel.json`.
