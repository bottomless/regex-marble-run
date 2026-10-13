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

test('playback, HUD, highlighting, trace log drawer and info sheets in the WebGL machine', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
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
  const hud = page.getByTestId('hud');
  await expect(canvas).toHaveCount(1);
  await expect(canvas).toHaveAttribute('data-pattern', PRESETS[0].pattern);
  await expect(page.locator('#test-string')).toHaveValue(PRESETS[0].input);
  expect(await canvas.evaluate((el) => (el as HTMLCanvasElement).getContext('webgl2')?.isContextLost())).toBe(false);
  await expect(page.locator('.scene-fallback:visible')).toHaveCount(0);

  // Preset sheet selection
  const greedy = PRESETS.find((p) => p.id === 'greedy')!;
  await selectPreset(page, greedy.id);
  const program = parsePattern(greedy.pattern, greedy.flags);
  const { trace, result } = runBacktrack(program, greedy.input);
  const counters = buildCounters(trace);
  const cursor = new TraceCursor(program, trace);
  const final = cursor.stateAt(trace.length);

  await expect(transport).toHaveAttribute('data-event-count', String(trace.length));
  await expect(transport).toHaveAttribute('data-event-index', '0');
  for (const label of Object.values(copy.hud.labels)) await expect(hud.locator('dt', { hasText: label })).toHaveCount(1);

  // Stepping controls
  const stepForward = transport.getByRole('button', { name: copy.transport.stepForward });
  const stepBack = transport.getByRole('button', { name: copy.transport.stepBack });
  const backtrackAt = trace.t.findIndex((t) => t === T.backtrack);
  expect(backtrackAt).toBeGreaterThan(0);
  for (let i = 1; i <= backtrackAt; i++) await stepForward.click();

  const expected = countersAt(counters, backtrackAt);
  await expect(transport).toHaveAttribute('data-event-index', String(backtrackAt));
  await expect(hud).toHaveAttribute('data-backtracks', String(expected.backtracks));
  await stepBack.click();
  await expect(transport).toHaveAttribute('data-event-index', String(backtrackAt - 1));
  await transport.getByRole('button', { name: copy.transport.restart }).click();
  await expect(transport).toHaveAttribute('data-at-start', 'true');

  // Instant finish
  const instant = transport.getByRole('button', { name: `${copy.transport.speed} ${copy.transport.speedOption(INSTANT)}`, exact: true });
  await instant.click();
  await expect(transport).toHaveAttribute('data-at-end', 'true');
  await expect(hud).toHaveAttribute('data-result', 'match');
  await expect(hud.locator('[data-field="result"] dd')).toHaveText(copy.hud.result({ kind: 'match', start: result.index, end: result.end }));
  await expect(canvas).toHaveAttribute('data-captures', JSON.stringify(captureSpans(final)));
  await expect(canvas).toHaveAttribute('data-match', JSON.stringify(matchSpan(final)));

  // Pattern hover highlighting
  const patternInput = page.locator('#pattern');
  const box = (await patternInput.boundingBox())!;
  await page.mouse.move(box.x + 3, box.y + box.height / 2);
  await expect(page.locator('.pattern-backdrop mark[data-tone="hover"]')).not.toHaveCount(0);
  await page.mouse.move(box.x + 3, box.y + box.height + 40);
  await expect(page.locator('.pattern-backdrop mark[data-tone="hover"]')).toHaveCount(0);

  // Trace log drawer
  await page.getByRole('button', { name: copy.traceLog.toggle }).click();
  const drawer = page.getByTestId('trace-log');
  await expect(drawer).toBeVisible();
  const rows = drawer.locator('ol li button');
  expect(await rows.count()).toBeGreaterThan(0);
  await rows.nth(2).click();
  await expect(transport).toHaveAttribute('data-event-index', '2');
  await drawer.getByRole('button', { name: copy.traceLog.copyAll }).click();
  await expect(drawer.locator('.trace-log-status')).toHaveText(copy.traceLog.copied);
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);

  // Legend and How it works sheets
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
  expect(external).toEqual([]);
});

test('catastrophic presets flood with exact sampled tank and gave-up totals', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = collectErrors(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await openControls(page);
  const canvas = page.locator('canvas');
  const hud = page.getByTestId('hud');

  // Evil regex
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

  // Cloudflare
  const cloudflare = PRESETS.find((p) => p.number === 9)!;
  await selectPreset(page, cloudflare.id);
  await expect(canvas).toHaveAttribute('data-pattern', cloudflare.pattern);
  await expect(canvas).toHaveAttribute('data-flood', 'true', { timeout: 20_000 });
  await expect(hud).toHaveAttribute('data-result', 'gaveUp');
  expect(Number(await hud.getAttribute('data-steps'))).toBeGreaterThan(3000);
  await expect(hud).toHaveAttribute('data-native', /success|timeout/, { timeout: 10_000 });

  expect(errors).toEqual([]);
});

test('side-by-side mode runs linear engine and URL hash round-trips state', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const errors = collectErrors(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await openControls(page);
  const canvas = page.locator('canvas');
  const single = page.getByRole('button', { name: copy.split.single, exact: true });
  const split = page.getByRole('button', { name: copy.split.sideBySide, exact: true });

  await split.click();
  await expect(split).toHaveAttribute('aria-pressed', 'true');
  await expect(canvas).toHaveAttribute('data-linear', 'ready', { timeout: 15_000 });

  const first = PRESETS[0];
  const program = parsePattern(first.pattern, first.flags);
  const pike = runPike(program, first.input);
  const linear = buildLinearRun(program, pike.trace, pike.result);
  await expect(canvas).toHaveAttribute('data-linear-ticks', String(linear.ticks.length));
  await expect(canvas).toHaveAttribute('data-linear-steps', String(linear.steps));

  // Backreference makes linear-time unavailable
  const backref = PRESETS.find((p) => p.id === 'backreference')!;
  await selectPreset(page, backref.id);
  await expect(canvas).toHaveAttribute('data-pattern', backref.pattern);
  await expect(split).toBeDisabled();
  await expect(single).toHaveAttribute('aria-pressed', 'true');
  await expect(canvas).toHaveAttribute('data-linear', 'off');
  await expect(page.locator('.mode-note')).toContainText('RE2');

  // URL hash sharing
  const shared = { pattern: '[a-z]+', flags: 'i', input: 'test string', mode: 'split' as const };
  await page.goto(`/${encodeShare(shared)}`);
  await openControls(page);
  await expect(page.locator('#pattern')).toHaveValue(shared.pattern);
  await expect(page.locator('#test-string')).toHaveValue(shared.input);
  await page.getByRole('button', { name: copy.share.copyLink }).click();
  await expect(page.locator('.share-status')).toHaveText(copy.share.copied);
  const url = await page.evaluate(() => navigator.clipboard.readText());
  expect(decodeShare(new URL(url).hash, { pattern: '', flags: '', input: '', mode: 'single' })).toEqual(shared);

  expect(errors).toEqual([]);
});
