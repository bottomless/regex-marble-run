import { expect, test } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

test('generates 1200x630 og.png from ?og=1 view showing evil preset mid-flood', async ({ page }) => {
  await page.goto('/?og=1');
  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible({ timeout: 15_000 });
  await expect(canvas).toHaveAttribute('data-flood', 'true', { timeout: 20_000 });

  // Allow the settle clock to run into mid-flood (~1.5s)
  await page.waitForTimeout(1500);

  const ogPath = path.resolve(process.cwd(), 'public/og.png');
  await page.screenshot({ path: ogPath });

  expect(fs.existsSync(ogPath)).toBe(true);
  const stat = fs.statSync(ogPath);
  expect(stat.size).toBeGreaterThan(10_000);
});
