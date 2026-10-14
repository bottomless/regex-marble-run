import { expect, test, type Page } from '@playwright/test';
import { copy } from '../../src/copy.ts';
import { parsePattern } from '../../src/engine/parse.ts';
import { runBacktrack } from '../../src/engine/backtrack.ts';
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

test('playback, HUD, highlighting, trace log drawer and info sheets in the WebGL machine', async ({
  page,
  context,
}) => {
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
  expect(await canvas.evaluate((el) => (el as HTMLCanvasElement).getContext('webgl2')?.isContextLost())).toBe(
    false,
  );
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
  for (const label of Object.values(copy.hud.labels))
    await expect(hud.locator('dt', { hasText: label })).toHaveCount(1);
  for (const field of ['result', 'steps', 'backtracks', 'attempts', 'flags', 'native']) {
    await expect(hud.locator(`[data-field="${field}"]`)).toBeVisible();
  }

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
  const speed = transport.getByRole('combobox', { name: copy.transport.speed, exact: true });
  await speed.selectOption(String(INSTANT));
  await expect(speed).toHaveValue(String(INSTANT));
  await expect(transport).toHaveAttribute('data-speed', String(INSTANT));
  await expect(transport).toHaveAttribute('data-at-end', 'true');
  await expect(hud).toHaveAttribute('data-result', 'match');
  await expect(hud.locator('[data-field="result"] dd')).toContainText(
    copy.hud.result({ kind: 'match', start: result.index, end: result.end }),
  );
  const matched = copy.hud.matched(greedy.input.slice(result.index, result.end));
  await expect(hud.locator('.hud-summary-match')).toHaveText(matched);
  await expect(canvas).toHaveAttribute('data-captures', JSON.stringify(captureSpans(final)));
  await expect(canvas).toHaveAttribute('data-match', JSON.stringify(matchSpan(final)));
  await expect(hud.locator('[data-field="native"]')).toBeVisible();
  await expect(hud.locator('.hud-summary-match')).toBeVisible();

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

  const guideButton = page.getByRole('button', { name: copy.guide, exact: true });
  await expect(guideButton).toHaveCount(1);
  await expect(page.getByRole('button', { name: copy.legendTitle, exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: copy.howItWorksTitle, exact: true })).toHaveCount(0);
  await guideButton.click();
  const guide = page.getByRole('dialog', { name: copy.guide, exact: true });
  const pieces = guide.locator('.guide-tabs').getByRole('button', { name: copy.legendLabel, exact: true });
  const how = guide.locator('.guide-tabs').getByRole('button', { name: copy.howItWorksTitle, exact: true });
  await expect(guide).toBeVisible();
  await expect(guide.getByRole('button', { name: copy.sheetClose, exact: true })).toBeFocused();
  await expect(guide.locator('.guide-tabs button')).toHaveCount(2);
  await expect(pieces).toHaveAttribute('aria-pressed', 'true');
  await expect(how).toHaveAttribute('aria-pressed', 'false');
  await expect(guide.locator('.legend-art')).toHaveCount(copy.legendSheet.length);
  await page.keyboard.press('Escape');
  await expect(guide).toHaveCount(0);
  await expect(guideButton).toBeFocused();

  await guideButton.click();
  await how.click();
  await expect(how).toHaveAttribute('aria-pressed', 'true');
  await expect(pieces).toHaveAttribute('aria-pressed', 'false');
  await expect(guide.locator('.legend-art')).toHaveCount(0);
  await expect(guide.locator('.how-body')).toContainText('backtracking');
  for (const section of copy.howItWorks) {
    await expect(guide.getByRole('heading', { name: section.heading, exact: true })).toBeVisible();
  }
  await pieces.click();
  await expect(pieces).toHaveAttribute('aria-pressed', 'true');
  await expect(how).toHaveAttribute('aria-pressed', 'false');
  await expect(guide.locator('.legend-art')).toHaveCount(copy.legendSheet.length);
  await how.click();
  await page.keyboard.press('Escape');
  await expect(guide).toHaveCount(0);
  await expect(guideButton).toBeFocused();

  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});

test('native pattern flags expose six supported modes and keep Unicode modes mutually exclusive', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await openControls(page);
  const patternEditor = page.locator('.pattern-editor');
  const options = patternEditor.locator('details.pattern-options');
  const flagsSummary = options.locator(':scope > summary');
  const panel = options.locator('.flag-panel');
  const supported = ['i', 'm', 's', 'u', 'v', 'y'] as const;
  const flagButton = (flag: (typeof supported)[number]) =>
    panel.getByRole('button', { name: copy.flagLabel(flag, copy.flags[flag]), exact: true });
  const sharedFlags = () =>
    decodeShare(new URL(page.url()).hash, { pattern: '', flags: '', input: '', mode: 'single' })?.flags;

  await expect(patternEditor.locator('#pattern')).toBeVisible();
  await expect(options).toHaveCount(1);
  await expect(page.locator('.editor-options, .preset-note, .pattern-flags')).toHaveCount(0);
  await expect(page.getByText('About this example', { exact: true })).toHaveCount(0);
  await expect(options).toHaveJSProperty('open', false);
  await expect(flagsSummary).toHaveAttribute('aria-label', `${copy.flagsLabel}: ${copy.noFlags}`);
  await expect(flagsSummary.locator('.active-flags')).toHaveText('');
  await expect(flagsSummary.locator('.flags-icon')).toBeVisible();
  await expect(panel).toBeHidden();
  await expect(panel.locator('.flag-controls button.flag-chip')).toHaveCount(supported.length);

  await flagsSummary.click();
  await expect(options).toHaveJSProperty('open', true);
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('button')).toHaveCount(supported.length);
  for (const flag of supported) {
    await expect(flagButton(flag)).toBeVisible();
    await expect(flagButton(flag)).toBeEnabled();
    await expect(flagButton(flag)).toHaveAttribute('aria-label', copy.flagLabel(flag, copy.flags[flag]));
    await expect(flagButton(flag)).toHaveAttribute('aria-pressed', 'false');
  }
  await expect(panel.getByRole('button', { name: /^g:/ })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: /^d:/ })).toHaveCount(0);
  await expect(panel.locator('#unicode-hint')).toHaveText(copy.unicodeHint);
  for (const flag of ['i', 'm', 's', 'y'] as const) {
    await flagButton(flag).click();
    await expect(flagButton(flag)).toHaveAttribute('aria-pressed', 'true');
  }
  for (const flag of ['u', 'v', 'u'] as const) {
    await flagButton(flag).click();
    await expect(flagButton(flag)).toHaveAttribute('aria-pressed', 'true');
    await expect(flagButton(flag === 'u' ? 'v' : 'u')).toHaveAttribute('aria-pressed', 'false');
    await expect(panel.locator('.flag-chip[aria-pressed="true"]')).toHaveCount(5);
    await expect(flagsSummary.locator('.active-flags')).toHaveText(`ims${flag}y`);
    await expect(flagsSummary).toHaveAttribute('aria-label', `${copy.flagsLabel}: ims${flag}y`);
    await expect.poll(sharedFlags).toBe(`ims${flag}y`);
    await expect(page.locator('#pattern-error')).toHaveCount(0);
  }
  await flagsSummary.click();
  await expect(options).toHaveJSProperty('open', false);
  await expect(panel).toBeHidden();
  await expect(flagsSummary.locator('.active-flags')).toHaveText('imsuy');
  await flagsSummary.press('Enter');
  await expect(options).toHaveJSProperty('open', true);
  for (const flag of ['i', 'm', 's', 'u', 'y'] as const) {
    await expect(flagButton(flag)).toHaveAttribute('aria-pressed', 'true');
  }
  await expect(flagButton('v')).toHaveAttribute('aria-pressed', 'false');
  await flagButton('u').press('Escape');
  await expect(options).toHaveJSProperty('open', false);
  await expect(panel).toBeHidden();
  await expect(flagsSummary).toBeFocused();
  await flagsSummary.press('Enter');
  await flagButton('y').focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('#test-string')).toBeFocused();
  await expect(options).toHaveJSProperty('open', false);
  await expect(panel).toBeHidden();
  await flagsSummary.click();
  await expect(options).toHaveJSProperty('open', true);
  await page.locator('#test-string').dispatchEvent('pointerdown');
  await expect(options).toHaveJSProperty('open', false);
  await expect(panel).toBeHidden();
  await page.locator('#test-string').click();
  await expect(page.locator('#test-string')).toBeFocused();
  await flagsSummary.click();
  for (const flag of ['i', 'm', 's', 'u', 'y'] as const) {
    await flagButton(flag).click();
    await expect(flagButton(flag)).toHaveAttribute('aria-pressed', 'false');
  }
  await expect(flagsSummary.locator('.active-flags')).toHaveText('');
  await expect(flagsSummary.locator('.flags-icon')).toBeVisible();
  await expect(flagsSummary).toHaveAttribute('aria-label', `${copy.flagsLabel}: ${copy.noFlags}`);
  await expect.poll(sharedFlags).toBe('');
  await flagsSummary.press('Space');
  await expect(options).toHaveJSProperty('open', false);
  await expect(panel).toBeHidden();
  expect(errors).toEqual([]);
});

test('desktop layout places Pattern and String at top-center over the full-screen canvas without overlap or overflow', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('canvas')).toHaveAttribute('data-pattern', PRESETS[0].pattern);
  await expect(page.locator('#control-fields')).toBeVisible();

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
  ]) {
    await page.setViewportSize(viewport);
    const patternEditor = page.locator('.pattern-editor');
    const stringEditor = page.locator('.string-editor');
    const options = patternEditor.locator('details.pattern-options');
    const summary = options.locator(':scope > summary');
    await expect(options).toHaveCount(1);
    await expect(page.locator('.editor-options, .preset-note, .pattern-flags')).toHaveCount(0);
    await expect(page.getByText('About this example', { exact: true })).toHaveCount(0);
    for (const expanded of [false, true]) {
      if (expanded) await summary.click();
      await expect(options).toHaveJSProperty('open', expanded);
      const row = (await patternEditor.boundingBox())!;
      const stringBox = (await stringEditor.boundingBox())!;
      const pattern = (await patternEditor.locator('#pattern').boundingBox())!;
      const flags = (await summary.boundingBox())!;
      for (const box of [pattern, flags]) {
        expect(box.width).toBeGreaterThan(0);
        expect(box.height).toBeGreaterThan(0);
        expect(box.x).toBeGreaterThanOrEqual(row.x);
        expect(box.x + box.width).toBeLessThanOrEqual(row.x + row.width);
        expect(box.y).toBeGreaterThanOrEqual(row.y);
        expect(box.y + box.height).toBeLessThanOrEqual(row.y + row.height);
      }
      expect(Math.abs(pattern.y + pattern.height / 2 - (flags.y + flags.height / 2))).toBeLessThanOrEqual(1);
      expect(pattern.x + pattern.width).toBeLessThanOrEqual(flags.x);
      expect(row.y + row.height).toBeLessThanOrEqual(stringBox.y);
      const panel = options.locator('.flag-panel');
      if (expanded) {
        await expect(panel).toBeVisible();
        const menu = (await panel.boundingBox())!;
        const input = (await page.locator('#test-string').boundingBox())!;
        expect(menu.x).toBeGreaterThanOrEqual(0);
        expect(menu.x + menu.width).toBeLessThanOrEqual(viewport.width);
        expect(menu.y).toBeGreaterThanOrEqual(row.y + row.height);
        expect(Math.max(menu.x, input.x)).toBeLessThan(Math.min(menu.x + menu.width, input.x + input.width));
        expect(Math.max(menu.y, input.y)).toBeLessThan(
          Math.min(menu.y + menu.height, input.y + input.height),
        );
      } else {
        await expect(panel).toBeHidden();
      }
      const selectors = [
        '.brand-header',
        '.control-island',
        'canvas',
        '.hud',
        '.tool-rail',
        '.playback-dock',
        '.workshop-footer',
      ];
      const boxes = await Promise.all(selectors.map((selector) => page.locator(selector).boundingBox()));
      for (const [index, box] of boxes.entries()) {
        expect(box, selectors[index]).not.toBeNull();
        expect(box!.width, selectors[index]).toBeGreaterThan(0);
        expect(box!.height, selectors[index]).toBeGreaterThan(0);
        expect(box!.x, selectors[index]).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width, selectors[index]).toBeLessThanOrEqual(viewport.width);
      }
      const [header, editor, canvas, hud, share, dock, footer] = boxes.map((box) => box!);
      expect(canvas.width).toBe(viewport.width);
      expect(canvas.height).toBe(viewport.height);
      expect(header.x + header.width).toBeLessThanOrEqual(editor.x);
      expect(editor.x + editor.width).toBeLessThanOrEqual(hud.x);
      expect(share.x + share.width).toBeLessThanOrEqual(dock.x);
      expect(dock.x + dock.width).toBeLessThanOrEqual(footer.x);
      expect(hud.y + hud.height).toBeLessThanOrEqual(footer.y);
      for (const selector of ['.transport-group', '.transport-scrubber', '.transport-speeds']) {
        const box = (await page.locator(selector).boundingBox())!;
        expect(box, selector).not.toBeNull();
        expect(box.width, selector).toBeGreaterThan(0);
        expect(box.height, selector).toBeGreaterThan(0);
        expect(box.x, selector).toBeGreaterThanOrEqual(dock.x);
        expect(box.x + box.width, selector).toBeLessThanOrEqual(dock.x + dock.width);
        expect(box.y, selector).toBeGreaterThanOrEqual(dock.y);
        expect(box.y + box.height, selector).toBeLessThanOrEqual(dock.y + dock.height);
      }
      expect(
        await page.evaluate(
          () =>
            Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) -
            document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(0);
      if (expanded) {
        await summary.click();
        await expect(options).toHaveJSProperty('open', false);
        await expect(panel).toBeHidden();
      }
    }
  }
});

test('capture groups stay inside a short viewport', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(
    `/${encodeShare({ pattern: '(a)'.repeat(8), input: 'a'.repeat(8), flags: '', mode: 'single' })}`,
  );
  await expect(page.locator('canvas')).toHaveAttribute('data-pattern', '(a)'.repeat(8));
  await page.getByRole('combobox', { name: copy.transport.speed }).selectOption(String(INSTANT));
  const hud = page.getByTestId('hud');
  await expect(hud).toHaveAttribute('data-result', 'match');
  await expect(hud.locator('.hud-groups li')).toHaveCount(8);
  for (const height of [600, 560]) {
    await page.setViewportSize({ width: 800, height });
    const box = (await hud.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(height);
    await expect(hud.locator('[data-field="attempts"]')).toBeInViewport();
  }
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

test('machine always runs in single view and URL hash round-trips state', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const errors = collectErrors(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await openControls(page);
  const canvas = page.locator('canvas');

  await expect(canvas).toHaveAttribute('data-linear', 'off');
  await expect(page.getByRole('button', { name: copy.split.single, exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: copy.split.sideBySide, exact: true })).toHaveCount(0);
  await expect(page.locator('.stage-toolbar h2')).toHaveCount(0);
  await expect(page.getByRole('button', { name: copy.resetView, exact: true })).toBeVisible();

  const backref = PRESETS.find((p) => p.id === 'backreference')!;
  await selectPreset(page, backref.id);
  await expect(canvas).toHaveAttribute('data-pattern', backref.pattern);
  await expect(canvas).toHaveAttribute('data-linear', 'off');
  await expect(page.locator('.mode-note')).toHaveCount(0);

  // URL hash sharing: a legacy split link still opens in single view
  const shared = { pattern: '[a-z]+', flags: 'i', input: 'test string', mode: 'split' as const };
  await page.goto(`/${encodeShare(shared)}`);
  await openControls(page);
  await expect(page.locator('#pattern')).toHaveValue(shared.pattern);
  await expect(page.locator('#test-string')).toHaveValue(shared.input);
  const flagsSummary = page.locator('.pattern-editor .pattern-options > summary');
  await expect(flagsSummary.locator('.active-flags')).toHaveText(shared.flags);
  await expect(flagsSummary).toHaveAttribute('aria-label', `${copy.flagsLabel}: ${shared.flags}`);
  await expect(canvas).toHaveAttribute('data-linear', 'off');
  await page.getByRole('button', { name: copy.share.copyLink }).click();
  await expect(page.locator('.share-status')).toHaveText(copy.share.copied);
  const url = await page.evaluate(() => navigator.clipboard.readText());
  expect(decodeShare(new URL(url).hash, { pattern: '', flags: '', input: '', mode: 'single' })).toEqual({
    ...shared,
    mode: 'single',
  });

  expect(errors).toEqual([]);
});
