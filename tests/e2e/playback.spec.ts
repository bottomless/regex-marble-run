import { expect, test } from '@playwright/test';
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

    // Step forward advances eventIndex from current position (unless already at the end).
    const initialIndex = Number(await transport.getAttribute('data-event-index'));
    const eventCount = Number(await transport.getAttribute('data-event-count'));
    const stepForward = transport.getByRole('button', { name: copy.transport.stepForward });
    const stepBack = transport.getByRole('button', { name: copy.transport.stepBack });
    if (initialIndex < eventCount - 1) {
      await stepForward.click();
      await expect(transport).toHaveAttribute('data-event-index', String(initialIndex + 1));

      // Step back returns to initialIndex
      await stepBack.click();
      await expect(transport).toHaveAttribute('data-event-index', String(initialIndex));
    } else {
      // At the end: stepping back then forward round-trips the final event.
      await stepBack.click();
      await expect(transport).toHaveAttribute('data-event-index', String(initialIndex - 1));
      await stepForward.click();
      await expect(transport).toHaveAttribute('data-event-index', String(initialIndex));
    }

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

  test('tile rail highlights consumed characters and tracks the read head', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.goto('/');
    const transport = page.locator('.transport-bar');
    const canvas = page.locator('canvas');
    await expect(transport).toBeVisible();
    await expect.poll(async () => Number(await transport.getAttribute('data-event-count'))).toBeGreaterThan(0);

    // Pause so stepping is deterministic.
    const pauseBtn = transport.getByRole('button', { name: copy.transport.pause });
    if (await pauseBtn.isVisible()) await pauseBtn.click();
    await expect(transport).toHaveAttribute('data-playing', 'false');

    // Restart: back at event 0 (attempt 4/c, head 0) — tile 0 holds the head marker.
    await transport.getByRole('button', { name: copy.transport.restart }).click();
    await expect(canvas).toHaveAttribute('data-event-index', '0');
    await expect(canvas).toHaveAttribute('data-head', '0');
    await expect(canvas).toHaveAttribute('data-lit-tiles', '0');

    // Scrub to the end: presets 1 default ('the cot' / c(a|o)t) matches at [4, 7).
    const scrubber = transport.getByRole('slider', { name: copy.transport.scrubber });
    const max = Number(await scrubber.getAttribute('max'));
    await scrubber.fill(String(max));
    await expect(transport).toHaveAttribute('data-event-index', String(max));
    await expect(canvas).toHaveAttribute('data-lit-tiles', '4,5,6');

    // Restart clears the rail back to the start pose (rewind parity).
    await transport.getByRole('button', { name: copy.transport.restart }).click();
    await expect(canvas).toHaveAttribute('data-event-index', '0');
    await expect(canvas).toHaveAttribute('data-lit-tiles', '0');
    expect(errors).toEqual([]);
  });
});
