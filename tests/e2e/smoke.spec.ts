import { expect, test, type Page } from '@playwright/test';
import { copy } from '../../src/copy.ts';
import { parsePattern } from '../../src/engine/parse.ts';
import { runBacktrack } from '../../src/engine/backtrack.ts';
import { runPike } from '../../src/engine/pikevm.ts';
import { buildLinearRun } from '../../src/playback/linear.ts';
import { T } from '../../src/engine/trace.ts';
import { buildCounters, countersAt } from '../../src/playback/counters.ts';
import { floodAt, floodModel } from '../../src/playback/flood.ts';
import { TraceCursor } from '../../src/playback/state.ts';
import { INSTANT } from '../../src/playback/timeline.ts';
import { captureSpans, matchSpan } from '../../src/playback/captures.ts';
import { PRESETS } from '../../src/presets.ts';
import { decodeShare, encodeShare } from '../../src/share.ts';

const BUDGET = { wallMs: 2500, maxSteps: 20_000_000 } as const;

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

async function openControls(page: Page) {
  const expand = page.getByRole('button', { name: copy.expandControls });
  if (await expand.isVisible()) await expand.click();
}

async function selectPreset(page: Page, id: string) {
  await page.getByRole('button', { name: copy.presetsLabel }).click();
  await page.locator(`[data-preset-id="${id}"]`).click();
}

test('every preset builds a WebGL machine and either plays or floods, with no errors or external requests', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  const external: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (url.startsWith('http') && new URL(url).hostname !== '127.0.0.1') external.push(url);
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await openControls(page);
  const canvas = page.locator('canvas');
  const transport = page.locator('.transport-bar');
  await expect(canvas).toHaveCount(1);
  for (const preset of PRESETS) {
    await selectPreset(page, preset.id);
    await expect(canvas).toHaveAttribute('data-pattern', preset.pattern);
    await expect(page.locator('#test-string')).toHaveValue(preset.input);
    if (preset.number <= 5) {
      const { trace } = runBacktrack(parsePattern(preset.pattern, preset.flags), preset.input);
      await expect(transport).toHaveAttribute('data-event-count', String(trace.length));
      await expect(canvas).toHaveAttribute('data-flood', 'false');
    } else {
      await expect(canvas).toHaveAttribute('data-flood', 'true', { timeout: 20_000 });
    }
    expect(await canvas.evaluate((el) => (el as HTMLCanvasElement).getContext('webgl2')?.isContextLost())).toBe(false);
    await expect(page.locator('.scene-fallback:visible')).toHaveCount(0);
  }
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});

test('transport steps and restarts, the HUD counts along, and instant finishes with the match', async ({ page }) => {
  const errors = collectErrors(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await openControls(page);
  const greedy = PRESETS.find((p) => p.id === 'greedy')!;
  await selectPreset(page, greedy.id);
  const program = parsePattern(greedy.pattern, greedy.flags);
  const { trace, result } = runBacktrack(program, greedy.input);
  const counters = buildCounters(trace);
  const cursor = new TraceCursor(program, trace);
  const final = cursor.stateAt(trace.length);
  const transport = page.locator('.transport-bar');
  const canvas = page.locator('canvas');
  const hud = page.getByTestId('hud');
  await expect(transport).toHaveAttribute('data-event-count', String(trace.length));
  await expect(transport).toHaveAttribute('data-event-index', '0');
  await expect(transport).toHaveAttribute('data-playing', 'false');
  for (const label of Object.values(copy.hud.labels)) await expect(hud.locator('dt', { hasText: label })).toHaveCount(1);

  const check = async (eventIndex: number) => {
    const expected = countersAt(counters, eventIndex);
    const machine = cursor.stateAt(eventIndex + 1);
    await expect(transport).toHaveAttribute('data-event-index', String(eventIndex));
    await expect(hud).toHaveAttribute('data-steps', String(expected.steps));
    await expect(hud).toHaveAttribute('data-backtracks', String(expected.backtracks));
    await expect(hud).toHaveAttribute('data-attempts', String(machine.attempts));
    await expect(hud).toHaveAttribute('data-depth', String(machine.flags.length));
    await expect(canvas).toHaveAttribute('data-head', String(machine.head));
  };

  const stepForward = transport.getByRole('button', { name: copy.transport.stepForward });
  const stepBack = transport.getByRole('button', { name: copy.transport.stepBack });
  await check(0);
  await expect(hud).toHaveAttribute('data-result', 'pending');
  const backtrackAt = trace.t.findIndex((t) => t === T.backtrack);
  expect(backtrackAt).toBeGreaterThan(0);
  for (let i = 1; i <= backtrackAt; i++) await stepForward.click();
  await check(backtrackAt);
  expect(countersAt(counters, backtrackAt).backtracks).toBe(1);
  await stepBack.click();
  await check(backtrackAt - 1);
  await transport.getByRole('button', { name: copy.transport.restart }).click();
  await check(0);
  await expect(transport).toHaveAttribute('data-at-start', 'true');

  const instant = transport.getByRole('button', { name: `${copy.transport.speed} ${copy.transport.speedOption(INSTANT)}`, exact: true });
  await instant.click();
  await expect(transport).toHaveAttribute('data-at-end', 'true');
  await expect(transport).toHaveAttribute('data-playing', 'false');
  await check(trace.length - 1);
  await expect(hud).toHaveAttribute('data-result', 'match');
  await expect(hud.locator('[data-field="result"] dd')).toHaveText(copy.hud.result({ kind: 'match', start: result.index, end: result.end }));
  await expect(canvas).toHaveAttribute('data-captures', JSON.stringify(captureSpans(final)));
  await expect(canvas).toHaveAttribute('data-match', JSON.stringify(matchSpan(final)));
  await expect(hud).toHaveAttribute('data-native', 'success', { timeout: 10_000 });
  const ms = Number(await hud.getAttribute('data-native-ms'));
  expect(ms).toBeLessThan(500);
  await expect(hud.locator('[data-field="native"] dd')).toHaveText(copy.hud.nativeTime({ status: 'success', elapsedMs: ms }));
  expect(errors).toEqual([]);
});

test('catastrophic presets flood: exact sampled tank for the evil regex, gave-up totals and native time for Cloudflare', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await openControls(page);
  const canvas = page.locator('canvas');
  const hud = page.getByTestId('hud');

  const evil = PRESETS.find((p) => p.number === 6)!;
  await selectPreset(page, evil.id);
  const { trace, result } = runBacktrack(parsePattern(evil.pattern, evil.flags), evil.input, BUDGET);
  const model = floodModel(result, trace)!;
  expect(result.gaveUp).toBe(false);
  await expect(canvas).toHaveAttribute('data-flood', 'true', { timeout: 20_000 });
  await expect(canvas).toHaveAttribute('data-flood-settled', 'true');
  await expect(canvas).toHaveAttribute('data-flood-per-marble', String(model.perMarble));
  await expect(canvas).toHaveAttribute('data-flood-marbles', String(model.marbles));
  await expect(canvas).toHaveAttribute('data-flood-backtracks', String(result.backtracks));
  await expect(canvas).toHaveAttribute('data-flood-steps', String(result.steps));
  await expect(canvas).toHaveAttribute('data-flood-peak-depth', String(floodAt(model, 1).peakDepth));
  await expect(hud).toHaveAttribute('data-steps', String(result.steps));
  await expect(hud).toHaveAttribute('data-result', 'nomatch');
  expect(JSON.parse((await canvas.getAttribute('data-flood-columns')) ?? '[]').length).toBeGreaterThan(0);

  const cloudflare = PRESETS.find((p) => p.number === 9)!;
  await selectPreset(page, cloudflare.id);
  await expect(canvas).toHaveAttribute('data-pattern', cloudflare.pattern);
  await expect(canvas).toHaveAttribute('data-flood', 'true', { timeout: 20_000 });
  await expect(hud).toHaveAttribute('data-result', 'gaveUp');
  expect(Number(await hud.getAttribute('data-steps'))).toBeGreaterThan(3000);
  await expect(hud).toHaveAttribute('data-native', /success|timeout/, { timeout: 10_000 });
  if ((await hud.getAttribute('data-native')) === 'success') {
    expect(Number(await hud.getAttribute('data-native-ms'))).toBeGreaterThan(100);
  }

  await selectPreset(page, PRESETS[0].id);
  await expect(canvas).toHaveAttribute('data-flood', 'false');
  expect(await canvas.getAttribute('data-flood-columns')).toBeNull();
  expect(errors).toEqual([]);
});

test('side-by-side mode runs the linear-time engine for regular patterns and explains why it is unavailable otherwise', async ({ page }) => {
  const errors = collectErrors(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await openControls(page);
  const canvas = page.locator('canvas');
  const single = page.getByRole('button', { name: copy.split.single, exact: true });
  const split = page.getByRole('button', { name: copy.split.sideBySide, exact: true });
  await expect(single).toHaveAttribute('aria-pressed', 'true');
  await expect(canvas).toHaveAttribute('data-linear', 'off');
  await expect(page.locator('.mode-note')).toHaveCount(0);

  await split.click();
  await expect(split).toHaveAttribute('aria-pressed', 'true');
  await expect(canvas).toHaveAttribute('data-linear', 'ready', { timeout: 15_000 });
  const first = PRESETS[0];
  const program = parsePattern(first.pattern, first.flags);
  const pike = runPike(program, first.input);
  const linear = buildLinearRun(program, pike.trace, pike.result);
  await expect(canvas).toHaveAttribute('data-linear-ticks', String(linear.ticks.length));
  await expect(canvas).toHaveAttribute('data-linear-steps', String(linear.steps));
  await expect(canvas).toHaveAttribute('data-linear-max-threads', String(linear.maxThreads));
  await expect(canvas).toHaveAttribute('data-linear-end', String(linear.end));

  const greedy = PRESETS.find((p) => p.id === 'greedy')!;
  await selectPreset(page, greedy.id);
  await expect(canvas).toHaveAttribute('data-pattern', greedy.pattern);
  await expect(canvas).toHaveAttribute('data-linear', 'ready', { timeout: 15_000 });
  const hud = page.getByTestId('hud');
  const transport = page.locator('.transport-bar');
  await expect(transport).toHaveAttribute('data-event-index', '0');
  await expect(canvas).toHaveAttribute('data-linear-pos', '0');
  await expect(canvas).toHaveAttribute('data-linear-marbles', '1');
  await expect(hud).toHaveAttribute('data-right-steps', '0');
  const stepForward = transport.getByRole('button', { name: copy.transport.stepForward });
  let highest = 0;
  for (let i = 1; i <= 16; i++) {
    await stepForward.click();
    await expect(transport).toHaveAttribute('data-event-index', String(i));
    const head = Number(await canvas.getAttribute('data-head'));
    highest = Math.max(highest, head);
    const rightPos = Number(await canvas.getAttribute('data-linear-pos'));
    expect(rightPos, `event ${i}`).toBeLessThanOrEqual(highest);
    expect(rightPos).toBeGreaterThanOrEqual(0);
  }
  const midPos = Number(await canvas.getAttribute('data-linear-pos'));
  await transport.getByRole('button', { name: copy.transport.stepBack }).click();
  expect(Number(await canvas.getAttribute('data-linear-pos'))).toBe(midPos);
  await transport.getByRole('button', { name: `${copy.transport.speed} ${copy.transport.speedOption(INSTANT)}`, exact: true }).click();
  await expect(transport).toHaveAttribute('data-at-end', 'true');
  await expect(canvas).toHaveAttribute('data-linear-finished', 'true');
  const greedyProgram = parsePattern(greedy.pattern, greedy.flags);
  const greedyPike = runPike(greedyProgram, greedy.input);
  const greedyLinear = buildLinearRun(greedyProgram, greedyPike.trace, greedyPike.result);
  await expect(canvas).toHaveAttribute('data-linear-pos', String(greedyLinear.ticks.at(-1)!.pos));
  await expect(hud).toHaveAttribute('data-right-steps', String(greedyLinear.ticks.at(-1)!.cumulativeTests));
  await expect(page.locator('.hud-ratio')).toContainText('takes');

  const backref = PRESETS.find((p) => p.id === 'backreference')!;
  await selectPreset(page, backref.id);
  await expect(canvas).toHaveAttribute('data-pattern', backref.pattern);
  await expect(split).toBeDisabled();
  await expect(single).toHaveAttribute('aria-pressed', 'true');
  await expect(canvas).toHaveAttribute('data-linear', 'off');
  await expect(page.locator('.mode-note')).toContainText('RE2');

  const evil = PRESETS.find((p) => p.number === 6)!;
  await selectPreset(page, evil.id);
  await expect(canvas).toHaveAttribute('data-pattern', evil.pattern);
  await expect(split).toBeEnabled();
  await expect(split).toHaveAttribute('aria-pressed', 'true');
  await expect(canvas).toHaveAttribute('data-linear', 'ready', { timeout: 15_000 });
  const evilSteps = Number(await canvas.getAttribute('data-linear-steps'));
  const backtrackSteps = Number(await hud.getAttribute('data-steps'));
  expect(backtrackSteps / evilSteps).toBeGreaterThan(1000);
  await expect(canvas).toHaveAttribute('data-linear-finished', 'true');
  await expect(hud).toHaveAttribute('data-right-finished', 'true');
  expect(Number(await hud.getAttribute('data-right-steps'))).toBeGreaterThan(0);

  await single.click();
  await expect(canvas).toHaveAttribute('data-linear', 'off');
  expect(await canvas.getAttribute('data-linear-steps')).toBeNull();
  expect(errors).toEqual([]);
});

test('the URL hash restores pattern, string, flags and view mode, follows edits, and Copy link round-trips exactly', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const errors = collectErrors(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const shared = { pattern: '[😀-🙏]+', flags: 'v', input: '😀😁\n😂 tab\t& =?#%+/', mode: 'split' as const };
  await page.goto(`/${encodeShare(shared)}`);
  await openControls(page);
  const canvas = page.locator('canvas');
  await expect(page.locator('#pattern')).toHaveValue(shared.pattern);
  await expect(page.locator('#test-string')).toHaveValue(shared.input);
  await expect(page.getByRole('button', { name: copy.flagLabel('v', copy.flags.v) })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: copy.split.sideBySide, exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(canvas).toHaveAttribute('data-pattern', shared.pattern);
  await expect(canvas).toHaveAttribute('data-linear', 'ready', { timeout: 15_000 });

  await page.locator('#test-string').fill('😀😀');
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe(encodeShare({ ...shared, input: '😀😀' }));
  await page.getByRole('button', { name: copy.share.copyLink }).click();
  await expect(page.locator('.share-status')).toHaveText(copy.share.copied);
  const url = await page.evaluate(() => navigator.clipboard.readText());
  expect(decodeShare(new URL(url).hash, { pattern: '', flags: '', input: '', mode: 'single' })).toEqual({ ...shared, input: '😀😀' });

  await page.evaluate(() => { window.location.hash = '#preset=first-ride&m=single'; });
  await expect(page.locator('#pattern')).toHaveValue(PRESETS[0].pattern);
  await expect(page.locator('#test-string')).toHaveValue(PRESETS[0].input);
  await expect(page.getByRole('button', { name: copy.split.single, exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(canvas).toHaveAttribute('data-linear', 'off');
  await expect(page.getByRole('button', { name: copy.presetsLabel })).toHaveAttribute('data-current-preset', PRESETS[0].id);

  await page.goto('/');
  await expect(page.locator('#pattern')).toHaveValue(PRESETS[0].pattern);
  await expect.poll(() => page.evaluate(() => window.location.hash)).toContain('preset=first-ride');
  expect(errors).toEqual([]);
});

test('M8 polish: presets sheet, pattern highlighting, trace log drawer and the info sheets', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const errors = collectErrors(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await openControls(page);
  const transport = page.locator('.transport-bar');

  // The presets sheet lists every preset with its caption and applies one on tap.
  const presetButton = page.getByRole('button', { name: copy.presetsLabel });
  await presetButton.click();
  const sheet = page.getByRole('dialog', { name: copy.presetsLabel });
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('[data-preset-id]')).toHaveCount(PRESETS.length);
  const backref = PRESETS.find((p) => p.id === 'backreference')!;
  await expect(sheet.locator(`[data-preset-id="${backref.id}"]`)).toContainText(backref.caption);
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await presetButton.click();
  await sheet.locator(`[data-preset-id="${backref.id}"]`).click();
  await expect(page.locator('#pattern')).toHaveValue(backref.pattern);
  await expect(presetButton).toHaveAttribute('data-current-preset', backref.id);

  // Hovering the pattern backdrops the innermost node's span; leaving clears it.
  const pattern = page.locator('#pattern');
  const box = (await pattern.boundingBox())!;
  await page.mouse.move(box.x + 3, box.y + box.height / 2);
  await expect(page.locator('.pattern-backdrop mark[data-tone="hover"]')).not.toHaveCount(0);
  await page.mouse.move(box.x + 3, box.y + box.height + 40);
  await expect(page.locator('.pattern-backdrop mark[data-tone="hover"]')).toHaveCount(0);

  // Stepping the run highlights the active node's span.
  const stepForward = transport.getByRole('button', { name: copy.transport.stepForward });
  for (let i = 0; i < 4; i++) {
    await stepForward.click();
    if ((await page.locator('.pattern-backdrop mark[data-tone="active"]').count()) > 0) break;
  }
  await expect(page.locator('.pattern-backdrop mark[data-tone="active"]')).not.toHaveCount(0);

  // The trace log drawer describes the run in sentences and seeks on click.
  await page.getByRole('button', { name: copy.traceLog.toggle }).click();
  const drawer = page.getByTestId('trace-log');
  await expect(drawer).toBeVisible();
  const rows = drawer.locator('ol li button');
  expect(await rows.count()).toBeGreaterThan(0);
  await rows.nth(2).click();
  await expect(transport).toHaveAttribute('data-event-index', '2');
  await expect(rows.nth(2)).toHaveAttribute('aria-current', 'true');
  await drawer.getByRole('button', { name: copy.traceLog.copyAll }).click();
  await expect(drawer.locator('.trace-log-status')).toHaveText(copy.traceLog.copied);
  const logText = await page.evaluate(() => navigator.clipboard.readText());
  expect(logText).toContain('mirror');
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);

  // Legend and how-it-works sheets open from the footer and close with Escape.
  await page.getByRole('button', { name: copy.legendTitle }).click();
  const legend = page.getByRole('dialog', { name: copy.legendTitle });
  await expect(legend).toBeVisible();
  await expect(legend.locator('.legend-art')).toHaveCount(copy.legendSheet.length);
  await page.keyboard.press('Escape');
  await expect(legend).toHaveCount(0);
  await page.getByRole('button', { name: copy.howItWorksTitle }).click();
  const how = page.getByRole('dialog', { name: copy.howItWorksTitle });
  await expect(how).toBeVisible();
  await expect(how).toContainText('backtracking');
  await page.keyboard.press('Escape');
  await expect(how).toHaveCount(0);

  expect(errors).toEqual([]);
});
