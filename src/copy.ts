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
  descriptor: 'See how a regex finds a match.',
  guide: 'Guide',
  editorTitle: 'Your expression',
  editorHint: 'Edit below. The machine updates as you type.',
  noFlags: 'None',
  emptyInput: 'Empty string',
  marbleHint: 'Each marble is a match attempt. Gates test characters; loops try them again.',
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
    savedBranch: (count: number) => (count === 1 ? 'SAVED' : `SAVED ×${count}`),
    loopAgain: 'AGAIN',
    loopExit: 'EXIT',
    loopCount: (count: number) => `×${count}`,
    savedLoop: (choice: 'again' | 'exit', count: number) =>
      `${choice === 'again' ? 'AGAIN' : 'EXIT'} SAVED${count === 1 ? '' : ` ×${count}`}`,
    matchSpan: (start: number, end: number) => `MATCH @${start}..${end}`,
    modules: 'Expand modules',
    expand: 'Click a module to expand it.',
    expandModule: (label: string) => `Expand module ${label}`,
    error: 'The 3D view could not be opened. The layout is shown below.',
    canvas:
      '3D regex machine. Drag to orbit, right-drag to pan, scroll to zoom. Focus for keyboard controls.',
    tooLarge: 'This pattern is too large to build. Try a smaller section.',
  },
  flood: {
    perMarble: (n: number) =>
      n === 1 ? '1 marble = 1 backtrack' : `1 marble = ${n.toLocaleString('en-US')} backtracks`,
    backtracks: (n: number) => `${n.toLocaleString('en-US')} backtracks`,
    steps: (n: number, gaveUp: boolean) => `${n.toLocaleString('en-US')} steps${gaveUp ? ' · gave up' : ''}`,
    column: (depth: number) => `peak ×${depth.toLocaleString('en-US')}`,
    native: (reading: NativeReading) => `Native RegExp · ${nativeTime(reading)}`,
  },
  split: {
    label: 'View mode',
    single: 'Single',
    sideBySide: 'Compare engines',
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
      const text =
        more >= 100
          ? Math.round(more).toLocaleString('en-US')
          : more >= 10
            ? more.toFixed(1)
            : more.toFixed(2);
      return `${left >= right ? 'Backtracking' : 'Linear time'} takes ${text}× the steps`;
    },
  },
  hud: {
    label: 'Run results',
    details: 'Details',
    labels: {
      steps: 'Steps',
      backtracks: 'Backtracks',
      attempts: 'Attempts',
      flags: 'Saved choices',
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
    matched: (text: string) => `“${text}”`,
    group: (group: number, name: string | null) => (name ? `${group}: ${name}` : `Group ${group}`),
    unset: 'unset',
    status: { playing: 'Playing', paused: 'Paused', finished: 'Finished', loading: 'Running the engine…' },
    help: 'What do these mean?',
  },
  toolsLabel: 'Engines and sharing',
  parts: {
    label: 'Parts of the machine. Arrow keys move from part to part.',
    gate: (text: string) => `Gate ${text}`,
    sensor: (text: string) => `Sensor ${text}`,
    mirror: (text: string) => `Mirror ${text}`,
    lookbehind: (text: string) => `Lookbehind ${text}`,
    scout: (text: string) => `Scout ${text}`,
    diverter: (text: string) => `Diverter ${text}`,
    loop: (text: string, greedy: boolean) => `${greedy ? 'Greedy' : 'Lazy'} loop ${text}`,
    group: (text: string) => `Group ${text}`,
    module: (text: string) => `Module ${text}`,
  },
  editToBuild: 'Adjust the pattern to build the machine.',
  presetsLabel: 'Presets',
  customPreset: 'Your own pattern',
  customCaption: 'Change a gate, add a fork, or make a loop. The machine rebuilds as you type.',
  source: 'Original postmortem',
  patternLabel: 'Pattern',
  patternHint: 'JavaScript regular expression, without the surrounding slashes.',
  inputLabel: 'Test string',
  flagsLabel: 'Regex flags',
  unicodeHint: 'u and v are mutually exclusive.',
  expandControls: 'Edit',
  collapseControls: 'Done',
  resetView: 'Reset view',
  sheetClose: 'Close',
  share: {
    copyLink: 'Copy link',
    copied: 'Link copied.',
    failed: 'Copy failed. The address bar already holds this link.',
  },
  legendLabel: 'Machine pieces',
  legendTitle: 'How to read the machine',
  legendSheet: [
    {
      kind: 'marble',
      label: 'Marble',
      detail: 'One marble per match attempt. It enters on the left and rides the track.',
    },
    {
      kind: 'gate',
      label: 'Gate',
      detail: 'A brass arch that reads one character or class. Rejected marbles turn back.',
    },
    {
      kind: 'fork',
      label: 'Diverter',
      detail: 'Chooses a branch for | or a way through a group. The lever shows the current branch.',
    },
    {
      kind: 'loop',
      label: 'Loop diverter',
      detail: 'Greedy loops try another round first; lazy loops try the exit first.',
    },
    {
      kind: 'capture',
      label: 'Capture frame',
      detail: 'Frames a group. Brackets on the tile rail show what it caught.',
    },
    {
      kind: 'sensor',
      label: 'Sensor',
      detail: 'Checks a position (^, $, \\b, \\B) without reading a character.',
    },
    {
      kind: 'mirror',
      label: 'Mirror',
      detail: 'A backreference. Asks for the same characters its capture caught.',
    },
    {
      kind: 'scout',
      label: 'Scout',
      detail: 'A lookahead. A small marble runs a side track, reports back, and reads nothing.',
    },
    {
      kind: 'flag',
      label: 'Flag',
      detail: 'A saved choice. Backtracking pops the last flag and tries the next option.',
    },
  ],
  howItWorksTitle: 'How it works',
  howItWorks: [
    {
      heading: 'What a step is',
      body: 'A step is one test or choice. Press Play to follow the marble, or use the arrows to move one step at a time. Drag the timeline to revisit a moment. Open Trace log to read what happened.',
    },
    {
      heading: 'What the flags mean',
      body: 'i ignores case. m lets ^ and $ see line breaks. s lets the dot match line breaks. u and v turn on Unicode semantics (they exclude each other). y makes the match start at index 0. g and d do not apply to a single match, so they stay off.',
    },
    {
      heading: 'Why backtracking explodes',
      body: 'JavaScript, Python, Java and PCRE try one path, plant a flag at every choice, and come back to the last flag on failure. A loop inside a loop lets the same characters be grouped in many ways, so a short string can mean millions of tries. Presets 6 to 9 flood the tank with one marble per sampled backtrack.',
    },
    {
      heading: 'Why linear-time engines do not',
      body: 'RE2, Go and Rust advance every live thread together, one tile per tick, and never revisit a position. The same pattern that floods this machine runs in time proportional to the string length there.',
    },
    {
      heading: 'Limits',
      body: 'Lookbehind is shown as a black box: it runs, but its inner track is not drawn. v-flag string classes are not supported.',
    },
  ],
  credits:
    'Parsing by regexpp. Rendering by three.js and React Three Fiber. The linear-time idea is Russ Cox’s “Regular Expression Matching Can Be Simple And Fast”.',
  creditsLink: 'Read the article',
  orbitPointer: 'Drag to rotate · Scroll or pinch to zoom',
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
      label: 'Greedy matching',
      caption: 'The greedy loop tries another character before its exit. <.+> can span both tags.',
    },
    lazy: {
      label: 'Lazy matching',
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
  traceLog: {
    label: 'Trace log',
    toggle: 'Trace log',
    close: 'Close trace log',
    copyAll: 'Copy log',
    copied: 'Log copied.',
    failed: 'Copy failed.',
    empty: 'No run yet.',
    truncated: 'The run went on past the log budget; this is all that was recorded.',
    copyCap: (total: number) => `… ${total.toLocaleString('en-US')} more steps not copied`,
    earlier: 'Earlier steps',
    later: 'Later steps',
    jumpToPlayhead: 'Jump to the playhead',
    step: (index: number) => `step ${index + 1}`,
    seek: (index: number, text: string) => `Go to step ${index + 1}: ${text}`,
    attempt: (start: number) => `try to match from pos ${start}`,
    gatePass: (pos: number, label: string, ch: string) => `pos ${pos} · gate ${label} vs ${ch} → passes`,
    gateReject: (pos: number, label: string, ch: string) => `pos ${pos} · gate ${label} vs ${ch} → rejected`,
    mirrorPass: (pos: number, label: string, ch: string) => `pos ${pos} · mirror ${label} vs ${ch} → same`,
    mirrorReject: (pos: number, label: string, ch: string) =>
      `pos ${pos} · mirror ${label} vs ${ch} → different`,
    sensorHold: (pos: number, label: string) => `pos ${pos} · sensor ${label} → holds`,
    sensorFail: (pos: number, label: string) => `pos ${pos} · sensor ${label} → fails`,
    opaquePass: (pos: number, label: string) => `pos ${pos} · black box ${label} → passes`,
    opaqueReject: (pos: number, label: string) => `pos ${pos} · black box ${label} → rejected`,
    branch: (option: number, count: number, pos: number) =>
      `pos ${pos} · diverter tries branch ${option} of ${count}`,
    loopChoice: (choice: 'again' | 'exit', pos: number) =>
      `pos ${pos} · loop diverter tries ${choice === 'again' ? 'another round' : 'the exit'}`,
    option: (option: number, pos: number) => `pos ${pos} · diverter tries option ${option}`,
    backBranch: (option: number, count: number, pos: number) =>
      `pos ${pos} · back to the diverter · now branch ${option} of ${count}`,
    backLoop: (choice: 'again' | 'exit', pos: number) =>
      `pos ${pos} · back to the loop · now tries ${choice === 'again' ? 'another round' : 'the exit'}`,
    backOption: (option: number, pos: number) => `pos ${pos} · backtrack · now option ${option}`,
    iter: (count: number) => `loop round ${count}`,
    scoutStart: 'scout sets out',
    scoutEnd: (ok: boolean, negate: boolean) =>
      negate
        ? ok
          ? 'scout returns: found it — the negative check fails'
          : 'scout returns: nothing found — the negative check passes'
        : ok
          ? 'scout returns: found'
          : 'scout returns: not found',
    capture: (label: string, start: number, end: number) => `capture ${label} = ${start}..${end}`,
    captureClear: (label: string) => `capture ${label} cleared`,
    match: (start: number, end: number) => `match ${start}..${end}`,
    nomatch: 'no match anywhere',
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
    speedOption: (speed: number) => (speed === Infinity ? 'Instant' : `${speed}×`),
    scrubber: 'Timeline scrubber',
    stepCount: (current: number, total: number) => `Event ${current} of ${total}`,
  },
} as const;
