import { expect, test, type Page } from '@playwright/test';
import type { Shape } from '../src/drawing/model';
import { MAP_STYLE } from '../src/render/draw';
import { move, open, pick, settle, state } from './support';

type Pair = [number, number];
type Rgb = [number, number, number];

const hex = (c: string): Rgb => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) as Rgb;
const OCEAN = hex(MAP_STYLE.ocean);
const apart = (a: Rgb, b: Rgb) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);

const frames = (page: Page, count = 3) =>
  page.evaluate(
    (count) =>
      new Promise<void>((done) => {
        const next = (left: number) => (left <= 0 ? done() : requestAnimationFrame(() => next(left - 1)));
        next(count);
      }),
    count,
  );

/** The locator's globe on the page: its centre and radius, found from the pixels it paints, in CSS pixels. */
async function globe(page: Page): Promise<{ cx: number; cy: number; r: number; x: number; y: number }> {
  const box = (await page.locator('#locator canvas').boundingBox())!;
  const r = await page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('#locator canvas')!;
    const ratio = c.width / c.clientWidth;
    const row = c.getContext('2d')!.getImageData(0, Math.floor(c.height / 2), c.width, 1).data;
    let [first, last] = [-1, -1];
    for (let i = 0; i < c.width; i++) {
      if (row[4 * i + 3]! > 0) {
        if (first < 0) first = i;
        last = i;
      }
    }
    // Less the rim's outline, which is drawn over the edge.
    return (last - first + 1) / 2 / ratio - 1;
  });
  return { cx: box.width / 2, cy: box.height / 2, r, x: box.x, y: box.y };
}

/** The colour of the locator at an offset from the centre of its globe, in CSS pixels. */
const colourAt = (page: Page, dx: number, dy: number): Promise<Rgb> =>
  page.evaluate(([dx, dy]) => {
    const c = document.querySelector<HTMLCanvasElement>('#locator canvas')!;
    const ratio = c.width / c.clientWidth;
    const [x, y] = [Math.round((c.clientWidth / 2 + dx!) * ratio), Math.round((c.clientHeight / 2 + dy!) * ratio)];
    return [...c.getContext('2d')!.getImageData(x, y, 1, 1).data.slice(0, 3)] as Rgb;
  }, [dx, dy]);

/** Reddish pixels, which only the accent is, in the part of a canvas within `half` pixels of an offset from its centre (the whole canvas if none). */
const reddish = (page: Page, selector: string, around?: { dx: number; dy: number; half: number }): Promise<number> =>
  page.evaluate(
    ([selector, around]) => {
      const c = document.querySelector<HTMLCanvasElement>(selector as string)!;
      const ratio = c.width / c.clientWidth;
      const a = around as { dx: number; dy: number; half: number } | undefined;
      const [x0, y0, x1, y1] = a
        ? [(c.clientWidth / 2 + a.dx - a.half) * ratio, (c.clientHeight / 2 + a.dy - a.half) * ratio, (c.clientWidth / 2 + a.dx + a.half) * ratio, (c.clientHeight / 2 + a.dy + a.half) * ratio].map(Math.round)
        : [0, 0, c.width, c.height];
      const { data } = c.getContext('2d')!.getImageData(x0!, y0!, x1! - x0!, y1! - y0!);
      let n = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i]! - Math.max(data[i + 1]!, data[i + 2]!) > 60) n++;
      return n;
    },
    [selector, around] as const,
  );

const setShapes = (page: Page, shapes: Shape[]) =>
  page.evaluate((shapes) => {
    const app = (window as any).__app;
    app.shapes = shapes;
    app.invalidateGeometry();
  }, shapes);

const snapshot = (page: Page, selector: string) => page.evaluate((s) => document.querySelector<HTMLCanvasElement>(s)!.toDataURL(), selector);

/** A real drag with the mouse, from an offset from the centre of the locator's globe to another. */
async function dragMarker(page: Page, from: Pair, to: Pair) {
  const g = await globe(page);
  await page.mouse.move(g.x + g.cx + from[0] * g.r, g.y + g.cy + from[1] * g.r);
  await page.mouse.down();
  await page.mouse.move(g.x + g.cx + to[0] * g.r, g.y + g.cy + to[1] * g.r, { steps: 6 });
  await page.mouse.up();
  await frames(page);
}

test('hidden on the globe, visible on other projections', async ({ page }) => {
  await open(page);
  await expect(page.locator('#locator')).toBeHidden();
  await pick(page, 'robinson');
  await expect(page.locator('#locator')).toBeVisible();
  await settle(page);
  await pick(page, 'globe');
  await expect(page.locator('#locator')).toBeHidden();
  await settle(page);
  await pick(page, 'albers');
  await expect(page.locator('#locator')).toBeVisible();
});

test('dragging the centre marker changes centre, holds tilt, and moves the map', async ({ page }) => {
  await open(page);
  await pick(page, 'transverse-mercator');
  await settle(page);
  await frames(page);
  const before = await state(page);
  expect(before.orientation.tilt).toBe(90);
  const mapBefore = await snapshot(page, '#map');

  // The tool is on, as a drag on the locator is neither a click on the map nor a drag of it.
  await page.getByRole('button', { name: 'Line', exact: true }).click();
  // The globe was centred on the map's centre, so a drag from its middle to (0.4, 0.3 up) of its radius lands at this longitude and latitude.
  await dragMarker(page, [0, 0], [0.4, -0.3]);
  const after = await state(page);
  const [lon, lat] = [(Math.atan2(0.4, Math.sqrt(1 - 0.4 ** 2 - 0.3 ** 2)) * 180) / Math.PI, (Math.asin(0.3) * 180) / Math.PI];
  expect(after.orientation.tilt).toBe(90);
  expect(Math.abs(after.orientation.lon - before.orientation.lon - lon)).toBeLessThan(1.5);
  expect(Math.abs(after.orientation.lat - before.orientation.lat - lat)).toBeLessThan(1.5);
  expect(await snapshot(page, '#map')).not.toBe(mapBefore);
  const draft = await page.evaluate(() => (window as any).__drawing.draft);
  expect(draft).toBeNull();
});

test('a drag that leaves the globe stops at its rim, and a conic moves only sideways', async ({ page }) => {
  await open(page);
  await pick(page, 'albers');
  await settle(page);
  const before = (await state(page)).orientation;
  await dragMarker(page, [0, 0], [3, -3]);
  const after = (await state(page)).orientation;
  expect(after.lat).toBe(before.lat);
  expect(after.tilt).toBe(before.tilt);
  // The rim is 90 degrees from the old centre, so the new longitude is nearly that far round.
  expect(after.lon).toBeGreaterThan(before.lon + 30);
  expect(after.lon).toBeLessThanOrEqual(90 + before.lon);

  await pick(page, 'robinson');
  await settle(page);
  await dragMarker(page, [0, 0], [0, 3]);
  const robinson = (await state(page)).orientation;
  expect(robinson.lat).toBeLessThan(0);
  expect(robinson.lat).toBeGreaterThanOrEqual(-90);
});

test('it shades excluded caps on gnomonic and shades nothing visible on Mollweide', async ({ page }) => {
  await open(page);
  await pick(page, 'mollweide');
  await settle(page);
  await frames(page);
  const g = await globe(page);
  // 70 degrees east, 20 south: open ocean, 71 degrees from the centre, past gnomonic's 68, and clear of the rim.
  const [dx, dy] = [g.r * Math.cos((20 * Math.PI) / 180) * Math.sin((70 * Math.PI) / 180), g.r * Math.sin((20 * Math.PI) / 180)];
  expect(apart(await colourAt(page, dx, dy), OCEAN)).toBeLessThan(12);
  const mollweide = await snapshot(page, '#locator canvas');

  await pick(page, 'gnomonic');
  await settle(page);
  await frames(page);
  const shaded = await colourAt(page, dx, dy);
  expect(apart(shaded, OCEAN)).toBeGreaterThan(40);
  // The covered part is left as it was: the South Atlantic, 28 degrees from the centre.
  expect(apart(await colourAt(page, -g.r * 0.32, g.r * 0.34), OCEAN)).toBeLessThan(12);
  expect(await snapshot(page, '#locator canvas')).not.toBe(mollweide);
});

test('it shows the coverage of the projection a morph is going to', async ({ page }) => {
  await open(page);
  await pick(page, 'mollweide');
  await settle(page);
  await frames(page);
  const g = await globe(page);
  const [dx, dy] = [g.r * Math.cos((20 * Math.PI) / 180) * Math.sin((70 * Math.PI) / 180), g.r * Math.sin((20 * Math.PI) / 180)];
  await pick(page, 'gnomonic');
  expect(await page.evaluate(() => (window as any).__app.isMorphing)).toBe(true);
  await frames(page);
  expect(apart(await colourAt(page, dx, dy), OCEAN)).toBeGreaterThan(40);
});

test('it draws a shape in full on gnomonic even when the main map clips it', async ({ page }) => {
  await open(page);
  await pick(page, 'gnomonic');
  await settle(page);
  // 79 degrees from the centre and 6 across: all of it is past gnomonic's 68.
  await setShapes(page, [{ kind: 'circle', center: [78, -20], radiusDeg: 6 }]);
  await frames(page);
  expect(await reddish(page, '#map')).toBe(0);
  const g = await globe(page);
  const [dx, dy] = [g.r * Math.cos((20 * Math.PI) / 180) * Math.sin((78 * Math.PI) / 180), g.r * Math.sin((20 * Math.PI) / 180)];
  expect(await reddish(page, '#locator canvas', { dx, dy, half: g.r * 0.2 })).toBeGreaterThan(10);

  // Moving the centre brings it onto the main map.
  await move(page, 'Longitude', 60);
  await frames(page);
  expect(await reddish(page, '#map')).toBeGreaterThan(20);
});

test('it follows the centre and the tilt: the frame equator turns with a tilted map', async ({ page }) => {
  await open(page);
  await pick(page, 'robinson');
  await settle(page);
  await frames(page);
  const before = await snapshot(page, '#locator canvas');
  await move(page, 'Longitude', 90);
  await frames(page);
  const turned = await snapshot(page, '#locator canvas');
  expect(turned).not.toBe(before);
  await move(page, 'Tilt', 90);
  await frames(page);
  expect(await snapshot(page, '#locator canvas')).not.toBe(turned);
});

test('on a phone the locator sits inside the map, clear of the controls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await pick(page, 'robinson');
  await settle(page);
  const [loc, map, side] = await Promise.all(['#locator', '#map', '#sidebar'].map((s) => page.locator(s).boundingBox()));
  expect(loc!.width).toBeGreaterThan(40);
  expect(loc!.width).toBeLessThan(map!.width / 3);
  expect(loc!.x).toBeGreaterThanOrEqual(map!.x);
  expect(loc!.x + loc!.width).toBeLessThanOrEqual(map!.x + map!.width);
  expect(loc!.y).toBeGreaterThanOrEqual(map!.y);
  expect(loc!.y + loc!.height).toBeLessThanOrEqual(map!.y + map!.height);
  expect(loc!.y + loc!.height).toBeLessThanOrEqual(side!.y);
});
