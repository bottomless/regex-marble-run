# Regex Marble Run

A physical 3D regular expression machine built with React, Three.js, and React Three Fiber.

Regex Marble Run visualizes regular expression matching as a mechanical marble run. Marbles ride down birch-plywood tracks, test characters at brass gate arches, choose branches at enameled diverters, cycle through loop lifts, frame submatches in capture brackets, and trigger position sensors. When a backtracking engine hits a catastrophic ReDoS pattern, marbles flood into a collection tank.

## Features

- **Backtracking engine & physical trace**: Full ECMAScript regex engine running in a Web Worker, emitting discrete trace events mapped to 3D marble motion.
- **Side-by-side mode**: Compares backtracking (JavaScript, Python, PCRE) against linear-time execution (RE2, Go, Rust) running on a Pike VM.
- **Catastrophic flood presentation**: For exponential and polynomial ReDoS patterns, sampled backtracks pour into a graduated collection tank while flag columns grow on diverters.
- **Bidirectional highlighting**: Hovering pattern characters highlights machine pieces, and hovering gates highlights the source pattern span.
- **Trace log drawer**: An accessible, screen-reader-friendly step-by-step log of every match decision, with click-to-seek and clipboard export.
- **Presets & shareable links**: 9 curated presets (including classic ReDoS postmortems from Stack Overflow and Cloudflare) and full URL hash state persistence.
- **Responsive & accessible**: Adapts to desktop and mobile viewports with full touch orbit and respects `prefers-reduced-motion`.

## Getting Started

### Prerequisites

- Node.js >= 20
- npm >= 10

### Installation & Development

```bash
npm install
npm run dev
```

Open `http://localhost:5173` in your browser.

### Building for Production

```bash
npm run build
npm run preview
```

## Testing

The project maintains comprehensive test coverage across parser differential fuzzing, layout physics, motion timeline, and browser rendering:

```bash
# Run unit and integration tests (Vitest)
npm test

# Run Playwright browser smoke tests
npm run e2e

# Run OG image generator (1200x630 render from ?og=1)
npm run og

# Linting and type checking
npm run lint
npm run typecheck

# Extended differential testing (1,000,000 cases vs native RegExp)
npm run test:diff:long
```

## Deployment

Regex Marble Run is a pure static single-page application.

To deploy to Vercel:
1. Import the repository in the Vercel dashboard.
2. No environment variables or custom configuration are required.
3. The included `vercel.json` automatically configures Vite build output, caching headers for immutable assets, and security headers.

## Engine Semantics & Limitations

- **Backtracking VM**: Conforms to ECMAScript RegExp semantics, supporting flags `i`, `m`, `s`, `u`, `v`, `y`, named/numbered captures, backreferences, non-capturing groups, and lookarounds.
- **Linear-time Pike VM**: Executes regular expressions without backreferences or lookarounds in linear time $O(m \times n)$, advancing thread states simultaneously.
- **Lookbehind**: Lookbehinds (`(?<=...)` and `(?<!...)`) execute in the engine, but their internal tracks are represented as black boxes in the 3D layout.
- **Unicode Sets**: Unicode character classes in `v` mode are supported; nested set operations (`--`, `&&`) are evaluated via native probe fallback.
- **Repetition bounds**: Extremely large bounded repetitions (>50,000 unrolled instructions) are capped to prevent worker memory exhaustion.

## Credits

- **Parser**: [@eslint-community/regexpp](https://github.com/eslint-community/regexpp)
- **3D Graphics**: [Three.js](https://threejs.org/) and [React Three Fiber](https://r3f.docs.pmnd.rs/)
- **Linear Matching Theory**: Russ Cox, ["Regular Expression Matching Can Be Simple And Fast"](https://swtch.com/~rsc/regexp/regexp1.html)
- **Typography**: IBM Plex Sans and IBM Plex Mono (SIL Open Font License)

## License

MIT
