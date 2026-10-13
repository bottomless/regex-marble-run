import { expect, test } from '@playwright/test';
import { copy } from '../../src/copy.ts';
import { INSTANT, SPEED_STEPS } from '../../src/playback/timeline.ts';
import { PRESETS } from '../../src/presets.ts';

test('phone layout keeps the machine, HUD and all eight speed controls usable at 390px and 320px', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const canvas = page.locator('canvas');
  await expect(canvas).toHaveAttribute('data-pattern', PRESETS[0].pattern);
  const transport = page.locator('.transport-bar');
  const hud = page.getByTestId('hud');
  await expect(transport.getByRole('button', { name: copy.transport.play, exact: true })).toBeEnabled();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const bounds = (await transport.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    const status = (await hud.boundingBox())!;
    expect(status.y + status.height).toBeLessThanOrEqual(bounds.y);
    await expect(hud.locator('[data-field="steps"]')).toBeVisible();
    await expect(hud.locator('[data-field="native"]')).toBeHidden();
    for (const speed of [...SPEED_STEPS, INSTANT]) {
      const button = transport.getByRole('button', { name: `${copy.transport.speed} ${copy.transport.speedOption(speed)}`, exact: true });
      await expect(button).toBeInViewport();
      const box = (await button.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(bounds.x);
      expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width);
      await button.click();
      await expect(button).toHaveAttribute('aria-pressed', 'true');
    }
  }
  expect(errors).toEqual([]);
});
