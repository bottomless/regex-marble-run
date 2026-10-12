export const copy = {
  brand: 'Regex Marble Run',
  edition: 'REGEX / WORKSHOP 04',
  descriptor: 'A little machine for a regular expression.',
  controls: 'Pattern and test string controls',
  machine: 'Regular expression machine',
  stageStatus: 'Static build · playback arrives in M5',
  building: 'Building the machine…',
  scene: {
    inlet: 'IN',
    match: 'MATCH',
    reject: 'REJECT',
    base: 'REGEX MARBLE RUN',
    input: 'INPUT / UTF-16',
    more: 'more tiles',
    expand: 'Click a module to expand it.',
    expandModule: (label: string) => `Expand module ${label}`,
    error: 'The 3D view could not be opened. The layout is shown below.',
    canvas:
      '3D regex machine. Drag to orbit, right-drag to pan, scroll to zoom. Focus for keyboard controls.',
    tooLarge: 'This pattern is too large to build. Try a smaller section.',
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
        'Two greedy loops lead into an equals gate. This is the core pattern with the x=x sample from the postmortem.',
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
    speedOption: (speed: number) => `${speed}×`,
    scrubber: 'Timeline scrubber',
    stepCount: (current: number, total: number) => `Event ${current} of ${total}`,
  },
} as const;
