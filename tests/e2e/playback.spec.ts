import { expect, test } from '@playwright/test';
import { copy } from '../../src/copy.ts';
import { parsePattern } from '../../src/engine/parse.ts';
import { runBacktrack } from '../../src/engine/backtrack.ts';
import { T } from '../../src/engine/trace.ts';
import { layout } from '../../src/layout/layout.ts';
import { flagMarkers } from '../../src/playback/flags.ts';
import { carriageAtIndex, formatCarriage } from '../../src/playback/carriage.ts';
import { TraceCursor } from '../../src/playback/state.ts';
import { buildTimeline } from '../../src/playback/timeline.ts';
import { alternationMarkers } from '../../src/playback/alternation.ts';
import { repeatMarkers } from '../../src/playback/repeats.ts';
import { gateMarkers } from '../../src/playback/gates.ts';
import { scoutTiles, scoutWindow } from '../../src/playback/scout.ts';
import { captureSpans, matchSpan, mirrorFaces } from '../../src/playback/captures.ts';

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

  test('choice flags plant, pop, and restore exactly on backward stepping and scrubbing', async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    const program = parsePattern('c(a|o)t', '');
    const { trace } = runBacktrack(program, 'the cot');
    const machine = layout(program);
    const cursor = new TraceCursor(program, trace);
    const choose = trace.t.findIndex((type) => type === T.choose);
    const pop = trace.t.findIndex((type) => type === T.backtrack);
    expect(choose).toBeGreaterThan(0);
    expect(pop).toBeGreaterThan(choose);
    const transport = page.locator('.transport-bar');
    const canvas = page.locator('canvas');
    await expect(transport).toHaveAttribute('data-event-count', String(trace.length));
    await expect(canvas).toHaveAttribute('data-flag-count', '0');
    await expect(transport).toHaveAttribute('data-playing', 'false');
    const scrubber = transport.getByRole('slider', { name: copy.transport.scrubber });
    const planted = JSON.stringify(flagMarkers(machine, cursor.stateAt(choose + 1).flags));
    const beforePop = JSON.stringify(flagMarkers(machine, cursor.stateAt(pop).flags));

    await scrubber.fill(String(choose));
    await expect(canvas).toHaveAttribute('data-flags', planted);
    await expect(canvas).toHaveAttribute('data-flag-count', '1');
    await page.screenshot({ path: testInfo.outputPath('saved-choice-flag.png') });
    await scrubber.fill(String(pop));
    await expect(canvas).toHaveAttribute('data-flags', '[]');
    await expect(canvas).toHaveAttribute('data-flag-count', '0');
    await transport.getByRole('button', { name: copy.transport.stepBack }).click();
    await expect(canvas).toHaveAttribute('data-flags', beforePop);
    await expect(canvas).toHaveAttribute('data-flag-count', '1');
    await transport.getByRole('button', { name: copy.transport.stepForward }).click();
    await expect(canvas).toHaveAttribute('data-flags', '[]');
    await scrubber.fill(String(choose));
    await expect(canvas).toHaveAttribute('data-flags', planted);
    await transport.getByRole('button', { name: copy.transport.restart }).click();
    await expect(canvas).toHaveAttribute('data-flags', '[]');
    await expect(page.locator('.scene-fallback:visible')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('lift carriage rides the backtrack route and restores when stepped backward', async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    const program = parsePattern('c(a|o)t', '');
    const { trace } = runBacktrack(program, 'the cot');
    const machine = layout(program);
    const timeline = buildTimeline(trace, machine, { speed: 1 });
    const backtrack = trace.t.findIndex((type) => type === T.backtrack);
    const ride = timeline.segments.findIndex((segment) => segment.event === backtrack);
    const riding = formatCarriage(carriageAtIndex(machine, timeline, ride, 0));
    expect(backtrack).toBeGreaterThan(0);
    expect(riding).not.toBe('');
    const transport = page.locator('.transport-bar');
    const canvas = page.locator('canvas');
    await expect(transport).toHaveAttribute('data-event-count', String(trace.length));
    await expect(transport).toHaveAttribute('data-playing', 'false');
    await expect(canvas).toHaveAttribute('data-carriage', '');
    await expect(canvas).toHaveAttribute('data-carriage-riding', 'false');

    const scrubber = transport.getByRole('slider', { name: copy.transport.scrubber });
    await scrubber.fill(String(backtrack));
    await expect(canvas).toHaveAttribute('data-carriage', riding);
    await expect(canvas).toHaveAttribute('data-carriage-riding', 'true');
    await page.screenshot({ path: testInfo.outputPath('lift-carriage.png') });

    await transport.getByRole('button', { name: copy.transport.stepForward }).click();
    await expect(canvas).toHaveAttribute('data-carriage', '');
    await expect(canvas).toHaveAttribute('data-carriage-riding', 'false');
    await transport.getByRole('button', { name: copy.transport.stepBack }).click();
    await expect(canvas).toHaveAttribute('data-carriage', riding);
    await expect(canvas).toHaveAttribute('data-carriage-riding', 'true');
    await transport.getByRole('button', { name: copy.transport.restart }).click();
    await expect(canvas).toHaveAttribute('data-carriage', '');
    await expect(page.locator('.scene-fallback:visible')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  for (const sample of [
    { name: 'binary', pattern: 'c(a|o)t', input: 'the cot', selected: [0, 1], saved: [[1], []] },
    { name: 'ternary', pattern: 'a|b|c', input: 'c', selected: [0, 1, 1, 2], saved: [[1], [], [2], []] },
  ]) {
    test(`${sample.name} alternation shows the selected and saved lanes and restores on rewind`, async ({ page }, testInfo) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto('/');
      const expand = page.getByRole('button', { name: copy.expandControls });
      if (await expand.isVisible()) await expand.click();
      await page.locator('#test-string').fill(sample.input);
      await page.locator('#pattern').fill(sample.pattern);
      const collapse = page.getByRole('button', { name: copy.collapseControls });
      if (await collapse.isVisible()) await collapse.click();

      const program = parsePattern(sample.pattern, '');
      const { trace } = runBacktrack(program, sample.input);
      const machine = layout(program);
      const cursor = new TraceCursor(program, trace);
      const canvas = page.locator('canvas');
      const transport = page.locator('.transport-bar');
      const scrubber = transport.getByRole('slider', { name: copy.transport.scrubber });
      const expectMarkers = async (event: number) => {
        const expected = alternationMarkers(program, machine, cursor.stateAt(event + 1)).map((marker) => ({
          ...marker,
          angle: marker.angle === null ? null : expect.closeTo(marker.angle, 10),
        }));
        await expect.poll(async () => JSON.parse((await canvas.getAttribute('data-alternations')) ?? 'null'))
          .toEqual(expected);
      };
      await expect(canvas).toHaveAttribute('data-pattern', sample.pattern);
      await expect(transport).toHaveAttribute('data-event-count', String(trace.length));
      await expect(transport).toHaveAttribute('data-playing', 'false');
      await expectMarkers(0);
      const transitions = Array.from({ length: trace.length }, (_, event) => event).filter((event) =>
        (trace.t[event] === T.choose || trace.t[event] === T.backtrack) && program.nodes[trace.a[event]].kind === 'alt',
      );
      expect(transitions).toHaveLength(sample.selected.length);
      for (const [index, event] of transitions.entries()) {
        await scrubber.fill(String(event));
        await expectMarkers(event);
        const rendered = JSON.parse((await canvas.getAttribute('data-alternations'))!);
        expect(rendered[0].activeBranch).toBe(sample.selected[index]);
        expect(rendered[0].branches.filter((branch: { savedCount: number }) => branch.savedCount > 0)
          .map((branch: { option: number }) => branch.option)).toEqual(sample.saved[index]);
        if (index === 0) await page.screenshot({ path: testInfo.outputPath('alternation-saved-lane.png') });
        await transport.getByRole('button', { name: copy.transport.stepBack }).click();
        await expectMarkers(event - 1);
        await transport.getByRole('button', { name: copy.transport.stepForward }).click();
        await expectMarkers(event);
        await transport.getByRole('button', { name: copy.transport.stepForward }).click();
        await expectMarkers(event + 1);
      }
      await scrubber.fill(String(transitions[0]));
      await expectMarkers(transitions[0]);
      await transport.getByRole('button', { name: copy.transport.restart }).click();
      await expectMarkers(0);
      await expect(page.locator('.scene-fallback:visible')).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  }

  for (const sample of [
    { name: 'greedy', pattern: '<.+>', input: '<b>bold</b>', first: 'again', retreat: 'exit' },
    { name: 'lazy', pattern: '<.+?>', input: '<bb>bold</b>', first: 'exit', retreat: 'again' },
  ]) {
    test(`${sample.name} loop diverter points again/exit with a live counter dial and rewinds exactly`, async ({ page }, testInfo) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto('/');
      const expand = page.getByRole('button', { name: copy.expandControls });
      if (await expand.isVisible()) await expand.click();
      await page.locator('#test-string').fill(sample.input);
      await page.locator('#pattern').fill(sample.pattern);
      const collapse = page.getByRole('button', { name: copy.collapseControls });
      if (await collapse.isVisible()) await collapse.click();

      const program = parsePattern(sample.pattern, '');
      const { trace } = runBacktrack(program, sample.input);
      const machine = layout(program);
      const cursor = new TraceCursor(program, trace);
      const rep = program.nodes.find((node) => node.kind === 'repeat')!.id;
      const canvas = page.locator('canvas');
      const transport = page.locator('.transport-bar');
      const scrubber = transport.getByRole('slider', { name: copy.transport.scrubber });
      const expectMarkers = async (event: number) => {
        const expected = JSON.parse(JSON.stringify(repeatMarkers(program, machine, cursor.stateAt(event + 1)))).map(
          (marker: { angle: number | null }) => ({
            ...marker,
            angle: marker.angle === null ? null : expect.closeTo(marker.angle, 10),
          }),
        );
        await expect.poll(async () => JSON.parse((await canvas.getAttribute('data-repeats')) ?? 'null')).toEqual(expected);
      };
      await expect(canvas).toHaveAttribute('data-pattern', sample.pattern);
      await expect(transport).toHaveAttribute('data-event-count', String(trace.length));
      await expect(transport).toHaveAttribute('data-playing', 'false');
      await expectMarkers(0);
      const choose = trace.t.findIndex((type, i) => type === T.choose && trace.a[i] === rep);
      const pop = trace.t.findIndex((type, i) => type === T.backtrack && trace.a[i] === rep);
      const iter = trace.t.findIndex((type, i) => type === T.iter && trace.a[i] === rep && i > pop);
      expect(choose).toBeGreaterThan(0);
      expect(pop).toBeGreaterThan(choose);
      for (const [event, choice] of [[choose, sample.first], [pop, sample.retreat]] as const) {
        await scrubber.fill(String(event));
        await expectMarkers(event);
        const rendered = JSON.parse((await canvas.getAttribute('data-repeats'))!);
        expect(rendered[0].choice).toBe(choice);
        expect(rendered[0].count).toBe(cursor.stateAt(event + 1).counters.get(rep));
        if (event === pop) await page.screenshot({ path: testInfo.outputPath('loop-diverter.png') });
        await transport.getByRole('button', { name: copy.transport.stepBack }).click();
        await expectMarkers(event - 1);
        await transport.getByRole('button', { name: copy.transport.stepForward }).click();
        await expectMarkers(event);
      }
      if (iter > 0) {
        await scrubber.fill(String(iter));
        await expectMarkers(iter);
        expect(JSON.parse((await canvas.getAttribute('data-repeats'))!)[0]).toMatchObject({ choice: 'again', count: trace.b[iter] });
      }
      await transport.getByRole('button', { name: copy.transport.restart }).click();
      await expectMarkers(0);
      expect(JSON.parse((await canvas.getAttribute('data-repeats'))!)[0]).toMatchObject({ choice: null, count: 0 });
      await expect(page.locator('.scene-fallback:visible')).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  }

  test('gates light green or red, trapdoors reset on backtrack, and sensors lamp without consuming tiles', async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    const expand = page.getByRole('button', { name: copy.expandControls });
    if (await expand.isVisible()) await expand.click();
    const pattern = String.raw`^c(a|o)t\b`;
    const input = 'cot!';
    await page.locator('#test-string').fill(input);
    await page.locator('#pattern').fill(pattern);
    const collapse = page.getByRole('button', { name: copy.collapseControls });
    if (await collapse.isVisible()) await collapse.click();

    const program = parsePattern(pattern, '');
    const { trace, result } = runBacktrack(program, input);
    expect(result.matched).toBe(true);
    const machine = layout(program);
    const cursor = new TraceCursor(program, trace);
    const canvas = page.locator('canvas');
    const transport = page.locator('.transport-bar');
    const scrubber = transport.getByRole('slider', { name: copy.transport.scrubber });
    const expectLamps = async (event: number) => {
      const expected = JSON.parse(JSON.stringify(gateMarkers(machine, cursor.stateAt(event + 1))));
      await expect.poll(async () => JSON.parse((await canvas.getAttribute('data-gates')) ?? 'null')).toEqual(expected);
    };
    await expect(canvas).toHaveAttribute('data-pattern', pattern);
    await expect(transport).toHaveAttribute('data-event-count', String(trace.length));
    await expect(transport).toHaveAttribute('data-playing', 'false');
    await expectLamps(0);
    expect(JSON.parse((await canvas.getAttribute('data-gates'))!)).toEqual([]);

    const tests = Array.from(trace.t).flatMap((type, i) => (type === T.test ? [i] : []));
    const reject = tests.find((i) => trace.c[i] === 0)!;
    const pop = trace.t.findIndex((type, i) => type === T.backtrack && i > reject);
    const sensors = tests.filter((i) => program.nodes[trace.a[i]].kind === 'assert');
    expect(sensors).toHaveLength(2);
    expect(reject).toBeGreaterThan(0);
    expect(pop).toBeGreaterThan(reject);

    await scrubber.fill(String(sensors[0]));
    await expectLamps(sensors[0]);
    expect(JSON.parse((await canvas.getAttribute('data-gates'))!)).toEqual([
      expect.objectContaining({ kind: 'sensor', status: 'pass', active: true }),
    ]);
    await expect(canvas).toHaveAttribute('data-head', '0');
    await expect(canvas).toHaveAttribute('data-lit-tiles', '0');

    await scrubber.fill(String(reject));
    await expectLamps(reject);
    const rejected = JSON.parse((await canvas.getAttribute('data-gates'))!);
    expect(rejected.filter((m: { status: string }) => m.status === 'reject')).toEqual([
      expect.objectContaining({ kind: 'gate', node: trace.a[reject], active: true }),
    ]);
    expect(rejected.filter((m: { status: string }) => m.status === 'pass')).toHaveLength(2);
    await page.screenshot({ path: testInfo.outputPath('gate-trapdoor.png') });

    await scrubber.fill(String(pop));
    await expectLamps(pop);
    expect(JSON.parse((await canvas.getAttribute('data-gates'))!).some((m: { status: string }) => m.status === 'reject')).toBe(false);
    await transport.getByRole('button', { name: copy.transport.stepBack }).click();
    await expectLamps(pop - 1);
    await transport.getByRole('button', { name: copy.transport.stepForward }).click();
    await expectLamps(pop);

    await scrubber.fill(String(sensors[1]));
    await expectLamps(sensors[1]);
    expect(JSON.parse((await canvas.getAttribute('data-gates'))!).find((m: { node: number }) => m.node === trace.a[sensors[1]]))
      .toMatchObject({ kind: 'sensor', status: 'pass', active: true });
    await scrubber.fill(String(trace.length - 1));
    await expectLamps(trace.length - 1);
    const final = JSON.parse((await canvas.getAttribute('data-gates'))!);
    expect(final.filter((m: { status: string }) => m.status === 'pass')).toHaveLength(5);
    await page.screenshot({ path: testInfo.outputPath('gates-matched.png') });
    await transport.getByRole('button', { name: copy.transport.restart }).click();
    await expectLamps(0);
    await expect(page.locator('.scene-fallback:visible')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('lookahead scout runs the side track, ghost-reads tiles, and returns home', async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    const expand = page.getByRole('button', { name: copy.expandControls });
    if (await expand.isVisible()) await expand.click();
    const pattern = 'c(?=o)ot';
    const input = 'cot';
    await page.locator('#test-string').fill(input);
    await page.locator('#pattern').fill(pattern);
    const collapse = page.getByRole('button', { name: copy.collapseControls });
    if (await collapse.isVisible()) await collapse.click();

    const program = parsePattern(pattern, '');
    const { trace, result } = runBacktrack(program, input);
    expect(result.matched).toBe(true);
    const cursor = new TraceCursor(program, trace);
    const canvas = page.locator('canvas');
    const transport = page.locator('.transport-bar');
    const scrubber = transport.getByRole('slider', { name: copy.transport.scrubber });
    const expectScout = async (event: number) => {
      const expected = JSON.parse(JSON.stringify(scoutWindow(cursor.stateAt(event + 1))));
      await expect.poll(async () => JSON.parse((await canvas.getAttribute('data-scout')) ?? 'null')).toEqual(expected);
      await expect(canvas).toHaveAttribute('data-scout-tiles', scoutTiles(expected).join(','));
    };
    await expect(canvas).toHaveAttribute('data-pattern', pattern);
    await expect(transport).toHaveAttribute('data-event-count', String(trace.length));
    await expect(transport).toHaveAttribute('data-playing', 'false');
    await expectScout(0);
    expect(JSON.parse((await canvas.getAttribute('data-scout'))!)).toBeNull();

    const look = program.nodes.find((node) => node.kind === 'look')!.id;
    const inner = (program.nodes[look] as { body: { id: number } }).body.id;
    const [start, end] = Array.from(trace.t).flatMap((type, i) => (type === T.look && trace.a[i] === look ? [i] : []));
    const read = Array.from(trace.t).findIndex((type, i) => type === T.test && trace.a[i] === inner);
    expect(start).toBeLessThan(read);
    expect(read).toBeLessThan(end);

    await scrubber.fill(String(start));
    await expectScout(start);
    expect(JSON.parse((await canvas.getAttribute('data-scout'))!)).toMatchObject({ node: look, start, end: null, reads: [] });
    await expect(canvas).toHaveAttribute('data-scout-tiles', '');

    await scrubber.fill(String(read));
    await expectScout(read);
    expect(JSON.parse((await canvas.getAttribute('data-scout'))!).reads).toEqual([
      { node: inner, event: read, pos: 1, len: 1, ok: true },
    ]);
    await expect(canvas).toHaveAttribute('data-scout-tiles', '1');
    await page.screenshot({ path: testInfo.outputPath('scout-ghost-tiles.png') });

    await transport.getByRole('button', { name: copy.transport.stepBack }).click();
    await expectScout(read - 1);
    await expect(canvas).toHaveAttribute('data-scout-tiles', '');
    await transport.getByRole('button', { name: copy.transport.stepForward }).click();
    await expectScout(read);

    await scrubber.fill(String(end));
    await expectScout(end);
    expect(JSON.parse((await canvas.getAttribute('data-scout'))!)).toMatchObject({ node: look, end });
    await scrubber.fill(String(end + 1));
    await expectScout(end + 1);
    expect(JSON.parse((await canvas.getAttribute('data-scout'))!)).toBeNull();
    await transport.getByRole('button', { name: copy.transport.restart }).click();
    await expectScout(0);
    await expect(page.locator('.scene-fallback:visible')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('capture brackets, mirror faces and the match celebration follow the playhead', async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    const expand = page.getByRole('button', { name: copy.expandControls });
    if (await expand.isVisible()) await expand.click();
    const pattern = String.raw`(?<dup>a)\k<dup>`;
    const input = 'aa';
    await page.locator('#test-string').fill(input);
    await page.locator('#pattern').fill(pattern);
    const collapse = page.getByRole('button', { name: copy.collapseControls });
    if (await collapse.isVisible()) await collapse.click();

    const program = parsePattern(pattern, '');
    const { trace, result } = runBacktrack(program, input);
    expect(result.matched).toBe(true);
    const cursor = new TraceCursor(program, trace);
    const canvas = page.locator('canvas');
    const transport = page.locator('.transport-bar');
    const scrubber = transport.getByRole('slider', { name: copy.transport.scrubber });
    const backref = program.nodes.find((node) => node.kind === 'backref')!.id;
    const expectCaptures = async (event: number) => {
      const state = cursor.stateAt(event + 1);
      await expect.poll(async () => JSON.parse((await canvas.getAttribute('data-captures')) ?? 'null'))
        .toEqual(JSON.parse(JSON.stringify(captureSpans(state))));
      await expect.poll(async () => JSON.parse((await canvas.getAttribute('data-mirrors')) ?? 'null'))
        .toEqual(mirrorFaces(program, state, input, [backref]));
      await expect.poll(async () => JSON.parse((await canvas.getAttribute('data-match')) ?? 'null'))
        .toEqual(JSON.parse(JSON.stringify(matchSpan(state))));
    };
    await expect(canvas).toHaveAttribute('data-pattern', pattern);
    await expect(transport).toHaveAttribute('data-event-count', String(trace.length));
    await expect(transport).toHaveAttribute('data-playing', 'false');
    await expectCaptures(0);
    expect(JSON.parse((await canvas.getAttribute('data-captures'))!)).toEqual([null, null]);
    expect(JSON.parse((await canvas.getAttribute('data-mirrors'))!)).toEqual([{ node: backref, text: '' }]);
    expect(JSON.parse((await canvas.getAttribute('data-match'))!)).toBeNull();

    const close = Array.from(trace.t).findIndex((type, i) => type === T.capture && trace.a[i] === 1 && trace.b[i] >= 0);
    const match = trace.t.findIndex((type) => type === T.match);
    expect(close).toBeGreaterThan(0);
    expect(match).toBe(trace.length - 1);

    await scrubber.fill(String(close));
    await expectCaptures(close);
    expect(JSON.parse((await canvas.getAttribute('data-captures'))!)).toEqual([null, { start: 0, end: 1 }]);
    expect(JSON.parse((await canvas.getAttribute('data-mirrors'))!)).toEqual([{ node: backref, text: 'a' }]);
    expect(JSON.parse((await canvas.getAttribute('data-match'))!)).toBeNull();

    await scrubber.fill(String(match));
    await expectCaptures(match);
    expect(JSON.parse((await canvas.getAttribute('data-captures'))!)).toEqual([
      { start: 0, end: 2 }, { start: 0, end: 1 },
    ]);
    expect(JSON.parse((await canvas.getAttribute('data-match'))!)).toEqual({ start: 0, end: 2 });
    await page.screenshot({ path: testInfo.outputPath('capture-celebration.png') });

    await transport.getByRole('button', { name: copy.transport.stepBack }).click();
    await expectCaptures(match - 1);
    expect(JSON.parse((await canvas.getAttribute('data-match'))!)).toBeNull();
    await transport.getByRole('button', { name: copy.transport.stepForward }).click();
    await expectCaptures(match);
    await transport.getByRole('button', { name: copy.transport.restart }).click();
    await expectCaptures(0);
    await expect(page.locator('.scene-fallback:visible')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
