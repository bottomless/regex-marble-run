import { expect, test, type Page } from '@playwright/test';
import { copy } from '../../src/copy.ts';
import { INSTANT, SPEED_STEPS } from '../../src/playback/timeline.ts';
import { PRESETS } from '../../src/presets.ts';

async function expectMobileLayout(page: Page) {
  const width = page.viewportSize()!.width;
  const selectors = ['.brand-header', '.control-island', 'canvas', '.hud', '.playback-dock'];
  const boxes = await Promise.all(selectors.map((selector) => page.locator(selector).boundingBox()));
  for (const [index, box] of boxes.entries()) {
    expect(box, selectors[index]).not.toBeNull();
    expect(box!.width, selectors[index]).toBeGreaterThan(0);
    expect(box!.height, selectors[index]).toBeGreaterThan(0);
    expect(box!.x, selectors[index]).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width, selectors[index]).toBeLessThanOrEqual(width);
    if (index > 0) {
      const previous = boxes[index - 1]!;
      expect(
        previous.y + previous.height,
        `${selectors[index - 1]} above ${selectors[index]}`,
      ).toBeLessThanOrEqual(box!.y);
    }
  }
  const canvas = boxes[2]!;
  const hint = (await page.locator('.orbit-hint').boundingBox())!;
  expect(hint.y).toBeGreaterThanOrEqual(canvas.y + canvas.height);
  const dock = boxes[boxes.length - 1]!;
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
}

for (const width of [390, 320]) {
  test(`phone layout keeps the machine, HUD and all eight speed options usable at ${width}px`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    const canvas = page.locator('canvas');
    const editor = page.locator('.control-island');
    const transport = page.locator('.transport-bar');
    const dock = page.locator('.playback-dock');
    const hud = page.getByTestId('hud');
    const details = hud.locator('.hud-details');
    const speedSelect = transport.getByRole('combobox', { name: copy.transport.speed, exact: true });
    await expect(canvas).toHaveAttribute('data-pattern', PRESETS[0].pattern);
    await expect(editor).toHaveAttribute('data-expanded', 'false');
    await expect(editor.getByRole('button', { name: copy.expandControls, exact: true })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await expect(editor.locator('#control-fields')).toBeHidden();
    await expect(editor.locator('.collapsed-preview')).toBeVisible();
    await expect(transport.getByRole('button', { name: copy.transport.play, exact: true })).toBeEnabled();
    await expect(details).toHaveJSProperty('open', false);
    for (const field of ['result', 'steps', 'backtracks']) {
      await expect(hud.locator(`[data-field="${field}"]`)).toBeVisible();
    }
    await expect(hud.locator('[data-field="native"]')).toBeHidden();
    await expectMobileLayout(page);
    const speeds = [...SPEED_STEPS, INSTANT];
    await expect(speedSelect.locator('option')).toHaveText(speeds.map(copy.transport.speedOption));
    for (const speed of speeds) {
      await speedSelect.scrollIntoViewIfNeeded();
      await expect(speedSelect).toBeInViewport();
      const bounds = (await dock.boundingBox())!;
      const box = (await speedSelect.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(bounds.x);
      expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width);
      await speedSelect.selectOption(String(speed));
      await expect(speedSelect).toHaveValue(String(speed));
      await expect(transport).toHaveAttribute('data-speed', String(speed));
    }
    await expect(transport).toHaveAttribute('data-at-end', 'true');
    await expect(hud).toHaveAttribute('data-result', 'match');
    await expect(hud.locator('.hud-summary-match')).toHaveText(copy.hud.matched(PRESETS[0].input));
    await expectMobileLayout(page);
    await details.locator('summary').scrollIntoViewIfNeeded();
    await details.locator('summary').click();
    await expect(details).toHaveJSProperty('open', true);
    await expect(hud.locator('[data-field="native"]')).toBeVisible();
    await details.locator('summary').click();
    await expect(details).toHaveJSProperty('open', false);
    await expect(hud.locator('[data-field="native"]')).toBeHidden();
    await expectMobileLayout(page);
    expect(errors).toEqual([]);
  });

  test(`short ${width}px phone allows editing and disclosures without overlapping the machine or overflowing`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 568 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    const editor = page.locator('.control-island');
    const expand = editor.getByRole('button', { name: copy.expandControls, exact: true });
    const done = editor.getByRole('button', { name: copy.collapseControls, exact: true });
    const options = editor.locator('.editor-options');
    const note = editor.locator('.preset-note');
    await expect(page.locator('canvas')).toHaveAttribute('data-pattern', PRESETS[0].pattern);
    await expect(editor).toHaveAttribute('data-expanded', 'false');
    await expect(editor.locator('#pattern')).toBeHidden();
    await expect(editor.locator('#test-string')).toBeHidden();
    await expectMobileLayout(page);
    await expand.scrollIntoViewIfNeeded();
    await expand.click();
    await expect(editor).toHaveAttribute('data-expanded', 'true');
    await expect(done).toHaveAttribute('aria-expanded', 'true');
    await expect(editor.locator('#control-fields')).toBeVisible();
    await expect(editor.locator('.collapsed-preview')).toBeHidden();
    await expect(options).toHaveJSProperty('open', false);
    await expect(note).toHaveJSProperty('open', false);
    await expect(options.locator('.flag-controls')).toBeHidden();
    await expect(note.locator('p')).toBeHidden();
    await expectMobileLayout(page);
    await options.locator('summary').scrollIntoViewIfNeeded();
    await options.locator('summary').click();
    await expect(options).toHaveJSProperty('open', true);
    await expect(options.getByRole('button')).toHaveCount(6);
    await note.locator('summary').scrollIntoViewIfNeeded();
    await note.locator('summary').click();
    await expect(note).toHaveJSProperty('open', true);
    await expect(note.locator('p')).toBeVisible();
    await expect(note.locator('p')).toHaveText(PRESETS[0].caption);
    await expectMobileLayout(page);
    await note.locator('summary').click();
    await options.locator('summary').scrollIntoViewIfNeeded();
    await options.locator('summary').click();
    await expect(options).toHaveJSProperty('open', false);
    await expect(note).toHaveJSProperty('open', false);
    await expect(options.locator('.flag-controls')).toBeHidden();
    await expect(note.locator('p')).toBeHidden();

    const pattern = 'a+';
    const input = 'a'.repeat(80);
    await editor.locator('#pattern').scrollIntoViewIfNeeded();
    await editor.locator('#pattern').fill(pattern);
    await editor.locator('#test-string').scrollIntoViewIfNeeded();
    await editor.locator('#test-string').fill(input);
    await expect(page.locator('canvas')).toHaveAttribute('data-pattern', pattern);
    await expectMobileLayout(page);
    await done.scrollIntoViewIfNeeded();
    await done.click();
    await expect(editor).toHaveAttribute('data-expanded', 'false');
    await expect(expand).toHaveAttribute('aria-expanded', 'false');
    await expect(editor.locator('#control-fields')).toBeHidden();
    await expect(editor.locator('.collapsed-preview code')).toHaveText(
      `${copy.syntax.slash}${pattern}${copy.syntax.slash}`,
    );
    await expect(editor.locator('.collapsed-preview > span')).toHaveText(input);
    await expectMobileLayout(page);
    await expand.click();
    await expect(editor.locator('#pattern')).toHaveValue(pattern);
    await expect(editor.locator('#test-string')).toHaveValue(input);
    await done.click();

    const guideButton = page.getByRole('button', { name: copy.guide, exact: true });
    await guideButton.scrollIntoViewIfNeeded();
    await guideButton.click();
    const guide = page.getByRole('dialog', { name: copy.guide, exact: true });
    await expect(guide).toBeVisible();
    await expect(guide.locator('.legend-art')).toHaveCount(copy.legendSheet.length);
    await guide
      .locator('.guide-tabs')
      .getByRole('button', { name: copy.howItWorksTitle, exact: true })
      .click();
    await expect(guide.locator('.how-body')).toContainText('backtracking');
    await page.keyboard.press('Escape');
    await expect(guide).toHaveCount(0);
    await expect(guideButton).toBeFocused();
    await expectMobileLayout(page);
    expect(errors).toEqual([]);
  });
}
