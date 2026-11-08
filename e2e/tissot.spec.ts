import { expect, test, type Page } from '@playwright/test';
import { mapStyle } from '../src/render/style';
import { open, pick, settle } from './support';

// The tests run in light mode, as the browser is told to, unless one says otherwise.
const LIGHT_STYLE = mapStyle('light');

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const BACKGROUND = rgb(LIGHT_STYLE.background);

const frames = (page: Page, count = 2) =>
  page.evaluate(
    (count) =>
      new Promise<void>((done) => {
        const next = (left: number) => (left <= 0 ? done() : requestAnimationFrame(() => next(left - 1)));
        next(count);
      }),
    count,
  );

/** Turns the map to a centre and draws it, with Tissot on or off. */
async function show(page: Page, lon: number, lat: number, tissot: boolean) {
  await page.evaluate(
    ([lon, lat, tissot]) => {
      const app = (window as any).__app;
      app.setLive({ orientation: { ...app.state.orientation, lon, lat } });
      app.setTissot(tissot);
    },
    [lon, lat, tissot] as const,
  );
  await frames(page);
}

/** Copies the canvas into the page, to compare with a later copy. */
const keep = (page: Page, name: string) =>
  page.evaluate((name) => {
    const canvas = document.querySelector<HTMLCanvasElement>('#map')!;
    (window as any)[name] = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
  }, name);

/**
 * What differs between the map with Tissot off and on, as pixels: how many, and how many of them are where the map
 * without Tissot is only background, which is outside the outline.
 */
const ellipsePixels = (page: Page, background: number[]) =>
  page.evaluate((background) => {
    const [off, on] = [(window as any).__off as ImageData, (window as any).__on as ImageData];
    const { width, height } = off;
    // The map without Tissot is background here, and so is every pixel next to it: a hair of anti-aliasing at the rim is not outside.
    const isBackground = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= width || y >= height) return true;
      const i = 4 * (x + y * width);
      return Math.abs(off.data[i]! - background[0]!) + Math.abs(off.data[i + 1]! - background[1]!) + Math.abs(off.data[i + 2]! - background[2]!) < 3;
    };
    let [drawn, outside] = [0, 0];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = 4 * (x + y * width);
        const changed = Math.abs(off.data[i]! - on.data[i]!) + Math.abs(off.data[i + 1]! - on.data[i + 1]!) + Math.abs(off.data[i + 2]! - on.data[i + 2]!) > 6;
        if (!changed) continue;
        drawn++;
        let clear = true;
        for (let dy = -1; dy <= 1 && clear; dy++) for (let dx = -1; dx <= 1 && clear; dx++) clear = isBackground(x + dx, y + dy);
        if (clear) outside++;
      }
    }
    return { drawn, outside };
  }, background);

async function gnomonic(page: Page) {
  await open(page);
  await pick(page, 'gnomonic');
  await settle(page);
  await frames(page);
}

test('gnomonic with Tissot on: no ellipse pixel is outside the map\'s outline, at rest or after turning the map', async ({ page }) => {
  await gnomonic(page);
  let overhanging = 0;
  for (const [lon, lat] of [[0, 0], [23, 18], [-41, -30], [80, 10], [100, 45], [-130, -10]] as const) {
    await show(page, lon, lat, false);
    await keep(page, '__off');
    await show(page, lon, lat, true);
    await keep(page, '__on');
    const { drawn, outside } = await ellipsePixels(page, BACKGROUND);
    expect(drawn, `${lon}, ${lat}`).toBeGreaterThan(500);
    expect(outside, `${lon}, ${lat}`).toBe(0);
    overhanging += drawn;
  }
  expect(overhanging).toBeGreaterThan(5000);
});

test('gnomonic with Tissot on: an ellipse dragged across the rim changes gradually, with no step from shown to gone', async ({ page }) => {
  await gnomonic(page);
  // Turning the map from centre longitude 90 to 64 takes the ellipses at longitude 150 (and their rows north and south) from 60 degrees
  // out to 86, over the rim at 68 and out of the margin. All the others are near the middle or out of reach throughout.
  const counts: number[] = [];
  for (let lon = 90; lon >= 64; lon -= 0.2) {
    await show(page, lon, 0, false);
    await keep(page, '__off');
    await show(page, lon, 0, true);
    await keep(page, '__on');
    counts.push((await ellipsePixels(page, BACKGROUND)).drawn);
  }
  const steps = counts.slice(1).map((n, i) => Math.abs(n - counts[i]!));
  const worst = Math.max(...steps);
  console.log('ellipse pixels from', Math.max(...counts), 'to', counts.at(-1), ', worst step', worst, 'at', steps.indexOf(worst));
  // An ellipse is some thousands of pixels, and one that vanished whole would be a step of at least a thousand.
  expect(Math.max(...counts)).toBeGreaterThan(8000);
  expect(worst).toBeLessThan(600);
});
