import { expect, test } from '@playwright/test';
import { PRESETS } from '../../src/presets.ts';
import { copy } from '../../src/copy.ts';

test('every preset builds a static WebGL machine without external asset requests', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  const external: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('request', (request) => {
    const url = request.url();
    if (url.startsWith('http') && new URL(url).hostname !== '127.0.0.1') external.push(url);
  });
  await page.goto('/');
  const expand = page.getByRole('button', { name: copy.expandControls });
  if (await expand.isVisible()) await expand.click();
  const canvas = page.locator('canvas');
  await expect(canvas).toHaveCount(1);
  for (const preset of PRESETS) {
    await page.locator('#preset').selectOption(preset.id);
    await expect(canvas).toHaveAttribute('data-pattern', preset.pattern);
    await expect(page.locator('#pattern')).toHaveValue(preset.pattern);
    await expect(page.locator('#test-string')).toHaveValue(preset.input);
    expect(
      await canvas.evaluate((element) =>
        (element as HTMLCanvasElement).getContext('webgl2')?.isContextLost(),
      ),
    ).toBe(false);
    await expect(page.locator('.scene-fallback:visible')).toHaveCount(0);
    const collapse = page.getByRole('button', { name: copy.collapseControls });
    if (await collapse.isVisible()) await collapse.click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: testInfo.outputPath(`preset-${preset.id}.png`) });
    if (await expand.isVisible()) await expand.click();
  }
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});

test('machine fits the viewport, supports edits, flags, and keyboard orbit', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const canvas = page.locator('canvas');
  await expect(canvas).toHaveAttribute('data-pattern', PRESETS[0].pattern);
  const expand = page.getByRole('button', { name: copy.expandControls });
  if (await expand.isVisible()) await expand.click();
  await page.evaluate(() => {
    (window as unknown as { initialCanvas: HTMLCanvasElement }).initialCanvas =
      document.querySelector('canvas')!;
  });
  for (const pattern of ['', '^$', 'colou?r']) {
    await page.locator('#pattern').fill(pattern);
    await expect(canvas).toHaveAttribute('data-pattern', pattern);
    expect(
      await page.evaluate(
        () =>
          document.querySelector('canvas') ===
          (window as unknown as { initialCanvas: HTMLCanvasElement }).initialCanvas,
      ),
    ).toBe(true);
    await expect(page.locator('.scene-fallback:visible')).toHaveCount(0);
  }
  await page.getByRole('button', { name: copy.flagLabel('u', copy.flags.u), exact: true }).click();
  await page.getByRole('button', { name: copy.flagLabel('v', copy.flags.v), exact: true }).click();
  await expect(
    page.getByRole('button', { name: copy.flagLabel('u', copy.flags.u), exact: true }),
  ).toHaveAttribute('aria-pressed', 'false');
  await expect(
    page.getByRole('button', { name: copy.flagLabel('v', copy.flags.v), exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#pattern').fill('[');
  await expect(page.locator('#pattern-error')).toBeVisible();
  await page.locator('#pattern').fill('c(a|o)t');
  await expect(canvas).toHaveAttribute('data-pattern', 'c(a|o)t');
  const collapse = page.getByRole('button', { name: copy.collapseControls });
  if (await collapse.isVisible()) await collapse.click();
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  const viewport = page.viewportSize()!;
  expect(box!.width).toBeLessThanOrEqual(viewport.width);
  expect(box!.height).toBeGreaterThan(250);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
  await canvas.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowUp');
  await page.keyboard.press('+');
  await page.getByRole('button', { name: copy.resetView }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: testInfo.outputPath('static-machine.png') });
  expect(errors).toEqual([]);
});

test('collapsed modules can be expanded with a keyboard-accessible control', async ({ page }) => {
  await page.goto('/');
  const expandControls = page.getByRole('button', { name: copy.expandControls });
  if (await expandControls.isVisible()) await expandControls.click();
  const pattern = `(${'a'.repeat(90)})`;
  await page.locator('#pattern').fill(pattern);
  const canvas = page.locator('canvas');
  await expect(canvas).toHaveAttribute('data-pattern', pattern);
  const before = Number(await canvas.getAttribute('data-pieces'));
  const expand = page.getByRole('button', { name: copy.scene.expandModule('1'), exact: true });
  await expect(expand).toBeVisible();
  await expand.focus();
  await page.keyboard.press('Enter');
  await expect(expand).toHaveCount(0);
  await expect.poll(async () => Number(await canvas.getAttribute('data-pieces'))).toBeGreaterThan(before);
  await expect(page.locator('.scene-fallback:visible')).toHaveCount(0);
});

test('dark and reduced-motion preferences preserve the model and debug view', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('canvas')).toHaveAttribute('data-pattern', PRESETS[0].pattern);
  await expect(page.locator('.workshop-shell')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByText(copy.reducedMotion, { exact: true })).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: testInfo.outputPath('night-workshop.png') });
  await page.goto('/?debug=layout&p=abc%7Cd%2B');
  await expect(page.locator('.debug-svg')).toBeVisible();
  await expect(page.locator('.debug-error')).toHaveCount(0);
});
