import { expect, test } from '@playwright/test';
import { PRESETS } from '../../src/presets.ts';
import { copy } from '../../src/copy.ts';

test.describe('playback transport controls', () => {
  test('mounts transport bar with accessible controls and binds to playback store', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });

    await page.goto('/');

    const transport = page.locator('.transport-bar');
    await expect(transport).toBeVisible();

    // Wait for the engine to finish running and populate the timeline
    await expect.poll(async () => Number(await transport.getAttribute('data-event-count'))).toBeGreaterThan(0);

    // Speed buttons exist
    for (const s of [0.5, 1, 2, 4]) {
      const btn = transport.getByRole('button', { name: `${copy.transport.speed} ${copy.transport.speedOption(s)}` });
      await expect(btn).toBeVisible();
    }

    // Step forward, step back, play/pause, restart exist
    await expect(transport.getByRole('button', { name: copy.transport.restart })).toBeVisible();
    await expect(transport.getByRole('button', { name: copy.transport.stepBack })).toBeVisible();
    await expect(transport.getByRole('button', { name: copy.transport.stepForward })).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('pause, step forward, step back, and restart', async ({ page }) => {
    await page.goto('/');
    const transport = page.locator('.transport-bar');
    await expect(transport).toBeVisible();

    // Wait until timeline is ready
    await expect.poll(async () => Number(await transport.getAttribute('data-event-count'))).toBeGreaterThan(0);

    // Pause playback if playing
    const pauseBtn = transport.getByRole('button', { name: copy.transport.pause });
    if (await pauseBtn.isVisible()) {
      await pauseBtn.click();
    }
    await expect(transport).toHaveAttribute('data-playing', 'false');

    // Step forward advances eventIndex from current position
    const initialIndex = Number(await transport.getAttribute('data-event-index'));
    const stepForward = transport.getByRole('button', { name: copy.transport.stepForward });
    await stepForward.click();
    await expect(transport).toHaveAttribute('data-event-index', String(initialIndex + 1));

    // Step back returns to initialIndex
    const stepBack = transport.getByRole('button', { name: copy.transport.stepBack });
    await stepBack.click();
    await expect(transport).toHaveAttribute('data-event-index', String(initialIndex));

    // If not at start, restart button is enabled and brings to 0
    if (initialIndex > 0) {
      await transport.getByRole('button', { name: copy.transport.restart }).click();
      await expect(transport).toHaveAttribute('data-at-start', 'true');
      await expect(transport).toHaveAttribute('data-event-index', '0');
    } else {
      // Step forward once so restart becomes enabled
      await stepForward.click();
      await expect(transport).toHaveAttribute('data-at-start', 'false');
      await transport.getByRole('button', { name: copy.transport.restart }).click();
      await expect(transport).toHaveAttribute('data-at-start', 'true');
      await expect(transport).toHaveAttribute('data-event-index', '0');
    }
  });

  test('changing playback speed updates store and active speed pill', async ({ page }) => {
    await page.goto('/');
    const transport = page.locator('.transport-bar');
    await expect(transport).toBeVisible();
    await expect.poll(async () => Number(await transport.getAttribute('data-event-count'))).toBeGreaterThan(0);

    const btn2x = transport.getByRole('button', { name: `${copy.transport.speed} ${copy.transport.speedOption(2)}` });
    await btn2x.click();
    await expect(transport).toHaveAttribute('data-speed', '2');
    await expect(btn2x).toHaveAttribute('aria-pressed', 'true');

    const btn4x = transport.getByRole('button', { name: `${copy.transport.speed} ${copy.transport.speedOption(4)}` });
    await btn4x.click();
    await expect(transport).toHaveAttribute('data-speed', '4');
    await expect(btn4x).toHaveAttribute('aria-pressed', 'true');
    await expect(btn2x).toHaveAttribute('aria-pressed', 'false');

    const btn05x = transport.getByRole('button', { name: `${copy.transport.speed} ${copy.transport.speedOption(0.5)}` });
    await btn05x.click();
    await expect(transport).toHaveAttribute('data-speed', '0.5');
    await expect(btn05x).toHaveAttribute('aria-pressed', 'true');
  });

  test('presets 1 to 5 populate event counts and can be scrubbed', async ({ page }) => {
    await page.goto('/');
    const transport = page.locator('.transport-bar');
    const canvas = page.locator('canvas');
    const expand = page.getByRole('button', { name: copy.expandControls });
    if (await expand.isVisible()) await expand.click();

    const presets1to5 = PRESETS.filter((p) => p.number <= 5);
    for (const preset of presets1to5) {
      await page.locator('#preset').selectOption(preset.id);
      await expect(canvas).toHaveAttribute('data-pattern', preset.pattern);

      // Scrubber reflects event range
      const scrubber = transport.getByRole('slider', { name: copy.transport.scrubber });
      await expect(scrubber).toBeVisible();

      // Poll until scrubber max matches event count - 1
      await expect.poll(async () => {
        const count = Number(await transport.getAttribute('data-event-count'));
        const maxAttr = Number(await scrubber.getAttribute('max'));
        return count > 0 && maxAttr === count - 1;
      }).toBe(true);

      // Scrub to middle event
      const count = Number(await transport.getAttribute('data-event-count'));
      const mid = Math.floor(count / 2);
      await scrubber.fill(String(mid));
      await expect(transport).toHaveAttribute('data-event-index', String(mid));
    }
  });
});
