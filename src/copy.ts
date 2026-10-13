export type NativeReading =
  | { status: 'running' }
  | { status: 'success'; elapsedMs: number }
  | { status: 'timeout'; timeoutMs: number }
  | { status: 'error' };

export type ResultReading =
  | { kind: 'pending' }
  | { kind: 'gaveUp' }
  | { kind: 'nomatch' }
  | { kind: 'match'; start: number; end: number };

function nativeTime(reading: NativeReading): string {
  switch (reading.status) {
    case 'running':
      return 'measuring…';
    case 'timeout':
      return `over ${(reading.timeoutMs / 1000).toLocaleString('en-US')} s · stopped`;
    case 'error':
      return 'unavailable';
    case 'success': {
      const ms = reading.elapsedMs;
      if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`;
      if (ms >= 10) return `${Math.round(ms)} ms`;
      if (ms >= 1) return `${ms.toFixed(1)} ms`;
      return `${ms.toFixed(2)} ms`;
    }
  }
}

export const copy = {
  brand: 'Regex Marble Run',
  edition: 'REGEX / WORKSHOP 04',
  descriptor: 'A little machine for a regular expression.',
  controls: 'Pattern and test string controls',
  machine: 'Regular expression machine',
  building: 'Building the machine…',
  scene: {
    inlet: 'IN',
    match: 'MATCH',
    reject: 'REJECT',
    base: 'REGEX MARBLE RUN',
    input: 'INPUT / UTF-16',
    more: 'more tiles',
    activeBranch: 'ACTIVE',
    savedBranch: (count: number) => count === 1 ? 'SAVED' : `SAVED ×${count}`,
    loopAgain: 'AGAIN',
    loopExit: 'EXIT',
    loopCount: (count: number) => `×${count}`,
    savedLoop: (choice: 'again' | 'exit', count: number) =>
      `${choice === 'again' ? 'AGAIN' : 'EXIT'} SAVED${count === 1 ? '' : ` ×${count}`}`,
    matchSpan: (start: number, end: number) => `MATCH @${start}..${end}`,
    expand: 'Click a module to expand it.',
    expandModule: (label: string) => `Expand module ${label}`,
    error: 'The 3D view could not be opened. The layout is shown below.',
    canvas:
      '3D regex machine. Drag to orbit, right-drag to pan, scroll to zoom. Focus for keyboard controls.',
    tooLarge: 'This pattern is too large to build. Try a smaller section.',
  },
  flood: {
    perMarble: (n: number) => (n === 1 ? '1 marble = 1 backtrack' : `1 marble = ${n.toLocaleString('en-US')} backtracks`),
    backtracks: (n: number) => `${n.toLocaleString('en-US')} backtracks`,
    steps: (n: number, gaveUp: boolean) => `${n.toLocaleString('en-US')} steps${gaveUp ? ' · gave up' : ''}`,
    column: (depth: number) => `peak ×${depth.toLocaleString('en-US')}`,
    native: (reading: NativeReading) => `Native RegExp · ${nativeTime(reading)}`,
  },
  split: {
    label: 'View mode',
    single: 'Single',
    sideBySide: 'Side by side',
    left: 'Backtracking',
    leftEngines: 'JavaScript, Python, Java, PCRE',
    right: 'Linear time',
    rightEngines: 'RE2, Go, Rust',
    footnote:
      'V8 ships a linear-time engine only behind experimental flags; .NET 7+ offers an opt-in NonBacktracking mode; Ruby 3.2+ memoizes away many classic cases.',
    unavailable: (message: string) => `Side by side is unavailable for this pattern. ${message}`,
    running: 'Running the linear-time engine…',
    error: (message: string) => `The linear-time comparison could not run: ${message}`,
    engineMismatch: 'The worker returned a result from the wrong engine.',
    sideSteps: (n: number) => `${n.toLocaleString('en-US')} ${n === 1 ? 'step' : 'steps'}`,
    ratio: (left: number, right: number) => {
      if (right <= 0 || left <= 0) return 'Counting…';
      const more = Math.max(left, right) / Math.min(left, right);
      if (more < 1.005) return 'Same number of steps';
      const text = more >= 100 ? Math.round(more).toLocaleString('en-US') : more >= 10 ? more.toFixed(1) : more.toFixed(2);
      return `${left >= right ? 'Backtracking' : 'Linear time'} takes ${text}× the steps`;
    },
  },
  hud: {
    label: 'Run counters',
    labels: {
      steps: 'Steps',
      backtracks: 'Backtracks',
      attempts: 'Attempts',
      flags: 'Flags',
      native: 'Native time',
      result: 'Result',
    },
    count: (n: number) => n.toLocaleString('en-US'),
    nativeTime,
    result: (result: ResultReading) => {
      if (result.kind === 'pending') return '…';
      if (result.kind === 'gaveUp') return 'Gave up';
      if (result.kind === 'nomatch') return 'No match';
      return `Match @${result.start}..${result.end}`;
    },
  },
  editToBuild: 'Adjust the pattern to build the machine.',
  presetsLabel: 'Try a preset',
  customPreset: 'Your own pattern',
  customCaption: 'Change a gate, add a fork, or make a loop. The machine rebuilds as you type.',
  source: 'Original postmortem',
  patternLabel: 'Pattern',
  patternHint: 'JavaScript regular expression, without the surrounding slashes.',
  inputLabel: 'Test string',
  flagsLabel: 'Flags',
  unicodeHint: 'u and v are mutually exclusive.',
  expandControls: 'Edit pattern and string',
  collapseControls: 'Fold controls',
  resetView: 'Reset view',
  share: {
    copyLink: 'Copy link',
    copied: 'Link copied. It restores the pattern, string, flags and view.',
    failed: 'Copy failed. The address bar already holds this link.',
  },
  legendLabel: 'Machine pieces',
  orbitPointer: 'Drag to orbit · Right-drag or two fingers to pan / zoom',
  orbitKeyboard: 'Arrows orbit · Shift + arrows pan · + / − zoom',
  reducedMotion: 'Reduced motion',
  syntax: { slash: '/', caret: '^' },
  flags: {
    i: 'Ignore case',
    m: 'Multiline anchors',
    s: 'Dot matches line breaks',
    u: 'Unicode',
    v: 'Unicode sets',
    y: 'Sticky: start at index 0',
  },
  unavailableFlags: {
    g: 'Global search is not used for a single match.',
    d: 'Match indices do not change the machine.',
  },
  legend: [
    { kind: 'gate', label: 'Gate', detail: 'Reads a character' },
    { kind: 'fork', label: 'Fork', detail: 'Chooses a branch' },
    { kind: 'loop', label: 'Loop', detail: 'Repeats a section' },
    { kind: 'capture', label: 'Capture', detail: 'Frames a group' },
    { kind: 'sensor', label: 'Sensor', detail: 'Checks a position' },
  ],
  presets: {
    firstRide: {
      label: 'First ride',
      caption: 'A gate for c, a fork for a or o, and a gate for t. The test string is the cot.',
    },
    greedy: {
      label: 'Greedy vs lazy · greedy',
      caption: 'The greedy loop tries another character before its exit. <.+> can span both tags.',
    },
    lazy: {
      label: 'Greedy vs lazy · lazy',
      caption:
        'The lazy loop tries its exit before another character. <.+?> can stop at the first closing bracket.',
    },
    optional: {
      label: 'Optional letter',
      caption: 'The u has a bypass. The same pattern accepts color and colour.',
    },
    backreference: {
      label: 'Backreference',
      caption:
        'Capture a word character, then ask the mirror gate for the same character. hello contains ll.',
    },
    lookahead: {
      label: 'Lookahead password check',
      caption:
        'Two scouts check for a digit and a lowercase letter. The main lane asks for at least eight characters.',
    },
    evil: {
      label: 'The evil regex',
      caption:
        'A loop inside a loop gives the same letters many possible groupings. The final ! cannot pass the end sensor.',
    },
    classic: {
      label: 'Another classic',
      caption: 'A repeating group contains its own letter loop. The final 1 cannot pass either letter gate.',
    },
    whitespace: {
      label: 'Stack Overflow whitespace',
      caption:
        'The end loops accept whitespace and zero-width non-joiners. Here, a long run of spaces sits between two non-space characters.',
    },
    cloudflare: {
      label: 'Cloudflare core pattern',
      caption:
        'Two greedy loops lead into an equals gate. The postmortem shows x=x matching in 23 steps and 20 x’s with no equals failing in 4,067; this is 1,200 x’s with no equals. Our step counts use a different definition from theirs.',
    },
  },
  characterCount: (count: number, limit: number) => `${count} / ${limit}`,
  parserError: (index: number) => `Pattern error at character ${index + 1}`,
  unknownError: 'This pattern could not be parsed.',
  flagLabel: (flag: string, description: string) => `${flag}: ${description}`,
  presetOption: (number: number, label: string) => `${String(number).padStart(2, '0')} · ${label}`,
  transport: {
    label: 'Playback transport controls',
    play: 'Play',
    pause: 'Pause',
    restart: 'Restart from beginning',
    stepBack: 'Step back one event',
    stepForward: 'Step forward one event',
    speed: 'Playback speed',
    speedOption: (speed: number) => speed === Infinity ? 'Instant' : `${speed}×`,
    scrubber: 'Timeline scrubber',
    stepCount: (current: number, total: number) => `Event ${current} of ${total}`,
  },
} as const;
