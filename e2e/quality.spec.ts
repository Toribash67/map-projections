import { expect, test, type Page } from '@playwright/test';
import { stops } from '../src/projections/catalog';
import { MAP_STYLE } from '../src/render/draw';
import type { Shape } from '../src/drawing/model';
import { isMorphing, open, openPaused, pick, settle, state } from './support';

/** Three drawings of the three kinds, spread over the world. */
const SHAPES: Shape[] = [
  { kind: 'line', points: [[-120, 35], [-30, 50], [40, 10]] },
  { kind: 'polygon', points: [[10, -10], [60, -10], [40, 30]] },
  { kind: 'circle', center: [-60, -20], radiusDeg: 20 },
];

const setScene = (page: Page, tissot: boolean, shapes: Shape[]) =>
  page.evaluate(
    ([tissot, shapes]) => {
      const app = (window as any).__app;
      app.setTissot(tissot);
      app.shapes = shapes;
      app.invalidateGeometry();
    },
    [tissot, shapes] as const,
  );

/** Counts the numbers in the scene that was last drawn which are not finite, and the pieces it has. */
const badNumbers = (page: Page) =>
  page.evaluate(() => {
    const scene = (window as any).__app.scene;
    const bad = (values: ArrayLike<number>) => {
      let n = 0;
      for (let i = 0; i < values.length; i++) if (!Number.isFinite(values[i]!)) n++;
      return n;
    };
    let count = 0;
    let pieces = 0;
    for (const layer of Object.values(scene.layers) as any[][]) {
      for (const p of layer) {
        pieces++;
        count += bad(p.src) + bad(p.dst) + bad([p.alphaSrc, p.alphaDst]);
      }
    }
    for (const i of scene.indicatrices) count += bad([...i.srcPos, ...i.dstPos, ...i.srcMat, ...i.dstMat, i.alphaSrc, i.alphaDst]);
    return { count, pieces, indicatrices: scene.indicatrices.length };
  });

/** The page's console errors and uncaught exceptions. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}

/**
 * A walk through the stops that takes every ordered pair once as one step (an Eulerian circuit
 * of the complete directed graph, by Hierholzer's method), so that 21 x 20 morphs are 420 steps.
 */
function everyPair(ids: string[]): string[] {
  const left = new Map(ids.map((a) => [a, ids.filter((b) => b !== a)]));
  const stack = [ids[0]!];
  const walk: string[] = [];
  while (stack.length > 0) {
    const at = stack[stack.length - 1]!;
    const next = left.get(at)!.pop();
    if (next === undefined) walk.push(stack.pop()!);
    else stack.push(next);
  }
  return walk.reverse();
}

test('every ordered pair of stops morphs with no console error or NaN', async ({ page }) => {
  const ids = stops.map((s) => s.id);
  const walk = everyPair(ids);
  expect(walk).toHaveLength(ids.length * (ids.length - 1) + 1);
  test.setTimeout(10 * 60_000);

  const errors = watchErrors(page);
  await openPaused(page);
  await setScene(page, true, SHAPES);
  await page.clock.runFor(32);
  // The walk starts at the globe, which is where the app opens.
  expect(walk[0]).toBe('globe');

  // Each morph is chosen from the list, then drawn at frames spread over its 1400 ms, and let settle.
  // The clock jumps between frames, so that a frame costs what it does and the waiting does not.
  const seen = new Set<string>();
  const problems: string[] = [];
  let frames = 0;
  for (let i = 1; i < walk.length; i++) {
    const [from, to] = [walk[i - 1]!, walk[i]!];
    seen.add(`${from}>${to}`);
    await pick(page, to);
    expect(await isMorphing(page)).toBe(true);
    await page.clock.runFor(16);
    let last = -1;
    for (const step of [300, 300, 300, 300, 300]) {
      const bad = await badNumbers(page);
      frames++;
      // The frame is the morph's own: it advances, and has something in it.
      const t = await page.evaluate(() => (window as any).__app.controller.t() as number);
      if (!(t > last && bad.pieces > 0)) problems.push(`${from} to ${to}: t ${t} after ${last}, ${bad.pieces} pieces`);
      last = t;
      if (bad.count > 0) problems.push(`${from} to ${to}: ${bad.count} non-finite numbers in ${bad.pieces} pieces`);
      await page.clock.fastForward(step);
      await page.clock.runFor(16);
    }
    if (await isMorphing(page)) problems.push(`${from} to ${to}: still morphing after 1.6 s`);
    const rest = await badNumbers(page);
    if (rest.count > 0) problems.push(`${from} to ${to} at rest: ${rest.count} non-finite numbers`);
    if (problems.length > 5) break;
  }
  expect(problems).toEqual([]);
  expect(seen.size).toBe(ids.length * (ids.length - 1));
  expect(frames).toBeGreaterThan(2000);
  expect(errors).toEqual([]);
});

/** The share of the 1400 ms at which the morph's eased progress (in-out cubic) is `t`. */
const timeOf = (t: number) => (t < 0.5 ? Math.cbrt(t / 4) : 1 - Math.cbrt(2 * (1 - t)) / 2);

test('gnomonic to Albers: the ocean that unfolds from gnomonic\'s rim leaves no hole mid-morph', async ({ page }) => {
  const errors = watchErrors(page);
  await openPaused(page);
  await pick(page, 'gnomonic');
  await page.clock.runFor(1600);
  const background = [1, 3, 5].map((i) => parseInt(MAP_STYLE.background.slice(i, i + 2), 16));
  // Canvas pixels (the map is 1000 x 600) inside the cone's upper right, where the far side of gnomonic
  // arrives. Before the fix the ocean was missing there from about t = 0.5 to 0.8, down to the bare background.
  const spots = [[700, 110], [680, 100], [720, 130], [740, 100]];
  for (const t of [0.5, 0.6, 0.7, 0.8]) {
    await pick(page, 'albers');
    await page.clock.runFor(16);
    await page.clock.fastForward(Math.round(timeOf(t) * 1400) - 32);
    await page.clock.runFor(16);
    expect(Math.abs((await page.evaluate(() => (window as any).__app.controller.t() as number)) - t)).toBeLessThan(0.01);
    const seen = await page.evaluate((spots) => {
      const canvas = document.querySelector<HTMLCanvasElement>('#map')!;
      const ratio = canvas.width / canvas.clientWidth;
      const ctx = canvas.getContext('2d')!;
      return spots.map(([x, y]) => [...ctx.getImageData(Math.round(x! * ratio), Math.round(y! * ratio), 1, 1).data.slice(0, 3)]);
    }, spots);
    seen.forEach((rgb, i) => {
      const away = Math.abs(rgb[0]! - background[0]!) + Math.abs(rgb[1]! - background[1]!) + Math.abs(rgb[2]! - background[2]!);
      expect(away, `t ${t} at ${spots[i]}`).toBeGreaterThanOrEqual(2);
    });
    await page.clock.runFor(1500);
    await pick(page, 'gnomonic');
    await page.clock.runFor(1600);
  }
  expect(errors).toEqual([]);
});

// Frame times. These run on a real clock, so the figure is a machine's: the target is 60 fps, 16.7 ms,
// and the limit here is the brief's 20 ms. A slower machine than a laptop may need a real GPU to meet it.
const LIMIT_MS = 20;

/** Starts recording the time each animation frame begins. */
const recordFrames = (page: Page) =>
  page.evaluate(() => {
    const w = window as any;
    w.__frames = [] as number[];
    w.__recording = true;
    const next = (ts: number) => {
      w.__frames.push(ts);
      if (w.__recording) requestAnimationFrame(next);
    };
    requestAnimationFrame(next);
  });

/** Stops recording, and gives the mean and the worst gap between frames. */
const stopFrames = (page: Page) =>
  page.evaluate(() => {
    const w = window as any;
    w.__recording = false;
    const f: number[] = w.__frames;
    const gaps = f.slice(1).map((ts, i) => ts - f[i]!);
    return { frames: gaps.length, mean: (f.at(-1)! - f[0]!) / gaps.length, worst: Math.max(...gaps) };
  });

/** A map with Tissot indicatrices and three drawings on, at rest on Mercator. */
async function mercatorScene(page: Page) {
  await open(page);
  await setScene(page, true, SHAPES);
  await pick(page, 'mercator');
  await settle(page);
  await page.evaluate(() => new Promise((done) => setTimeout(done, 200)));
}

test('performance: a Mercator to Mollweide morph with Tissot and 3 shapes averages under 20 ms per frame', async ({ page }) => {
  await mercatorScene(page);
  await recordFrames(page);
  await pick(page, 'mollweide');
  expect(await isMorphing(page)).toBe(true);
  await settle(page);
  const { frames, mean, worst } = await stopFrames(page);
  console.log('morph frames', `${frames} frames, mean ${mean.toFixed(1)} ms, worst ${worst.toFixed(1)} ms`);
  expect(frames).toBeGreaterThan(40);
  expect(mean).toBeLessThan(LIMIT_MS);
});

test('performance: dragging on the same scene averages under 20 ms per frame', async ({ page }) => {
  await mercatorScene(page);
  const box = (await page.locator('#map').boundingBox())!;
  const [cx, cy] = [box.x + box.width / 2, box.y + box.height / 2];
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await recordFrames(page);
  // Moves sent 16 ms apart, along a loop, for three seconds.
  for (let i = 0; i < 180; i++) {
    const started = Date.now();
    const a = (2 * Math.PI * i) / 180;
    await page.mouse.move(cx + 110 * Math.sin(a), cy + 70 * (1 - Math.cos(a)) - 70);
    await page.waitForTimeout(Math.max(0, 16 - (Date.now() - started)));
  }
  const { frames, mean, worst } = await stopFrames(page);
  await page.mouse.up();
  // The drag turned the map, so the frames were drags' own.
  expect(Math.abs((await state(page)).orientation.lon)).toBeGreaterThan(1);
  console.log('drag frames', `${frames} frames, mean ${mean.toFixed(1)} ms, worst ${worst.toFixed(1)} ms`);
  expect(frames).toBeGreaterThan(100);
  expect(mean).toBeLessThan(LIMIT_MS);
});
