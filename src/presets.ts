import { copy } from './copy.ts';

export interface Preset {
  readonly id: string;
  readonly number: number;
  readonly label: string;
  readonly pattern: string;
  readonly flags: string;
  readonly input: string;
  readonly caption: string;
  readonly variant?: 'greedy' | 'lazy';
  readonly source?: string;
}

export const PRESETS: readonly Preset[] = [
  {
    id: 'first-ride',
    number: 1,
    ...copy.presets.firstRide,
    pattern: 'c(a|o)t',
    flags: '',
    input: 'the cot',
  },
  {
    id: 'greedy',
    number: 2,
    ...copy.presets.greedy,
    variant: 'greedy',
    pattern: '<.+>',
    flags: '',
    input: '<b>bold</b>',
  },
  {
    id: 'lazy',
    number: 2,
    ...copy.presets.lazy,
    variant: 'lazy',
    pattern: '<.+?>',
    flags: '',
    input: '<b>bold</b>',
  },
  {
    id: 'optional-letter',
    number: 3,
    ...copy.presets.optional,
    pattern: 'colou?r',
    flags: '',
    input: 'my color',
  },
  {
    id: 'backreference',
    number: 4,
    ...copy.presets.backreference,
    pattern: String.raw`(\w)\1`,
    flags: '',
    input: 'hello',
  },
  {
    id: 'lookahead-password',
    number: 5,
    ...copy.presets.lookahead,
    pattern: String.raw`^(?=.*\d)(?=.*[a-z]).{8,}$`,
    flags: '',
    input: 'hunter22x',
  },
  {
    id: 'evil-regex',
    number: 6,
    ...copy.presets.evil,
    pattern: '^(a+)+$',
    flags: '',
    input: `${'a'.repeat(16)}!`,
  },
  {
    id: 'another-classic',
    number: 7,
    ...copy.presets.classic,
    pattern: '^([a-zA-Z]+)*$',
    flags: '',
    input: `${'a'.repeat(16)}1`,
  },
  {
    id: 'stackoverflow-whitespace',
    number: 8,
    ...copy.presets.whitespace,
    pattern: String.raw`^[\s\u200c]+|[\s\u200c]+$`,
    flags: '',
    input: `x${' '.repeat(1998)}x`,
  },
  {
    id: 'cloudflare-core',
    number: 9,
    ...copy.presets.cloudflare,
    pattern: '.*(?:.*=.*)',
    flags: '',
    input: 'x=x',
    source: 'https://blog.cloudflare.com/details-of-the-cloudflare-outage-on-july-2-2019/',
  },
];

export const DEFAULT_PRESET = PRESETS[0];
