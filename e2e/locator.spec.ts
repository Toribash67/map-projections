import { expect, test, type Page } from '@playwright/test';
import { geoOrthographic } from 'd3-geo';
import type { Shape } from '../src/drawing/model';
import { MAP_STYLE } from '../src/render/draw';
import { move, open, pick, settle, state } from './support';

type Pair = [number, number];
type LonLat = [number, number];
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

const DEG = 180 / Math.PI;

test('dragging turns the globe under the pointer: the centre moves continuously, tilt is held, and nothing jumps at press or release', async ({ page }) => {
  await open(page);
  await pick(page, 'transverse-mercator');
  await settle(page);
  await frames(page);
  const orientation = async () => (await state(page)).orientation;
  const before = await orientation();
  expect(before.tilt).toBe(90);
  const mapBefore = await snapshot(page, '#map');

  // The tool is on, as a drag on the locator is neither a click on the map nor a drag of it.
  await page.getByRole('button', { name: 'Line', exact: true }).click();
  const g = await globe(page);
  const at = ([x, y]: Pair): Pair => [g.x + g.cx + x * g.r, g.y + g.cy + y * g.r];
  // The land under the press: the globe is centred on the map's centre, so this is what the orthographic view puts at (0.3, 0).
  const grabbed: LonLat = [before.lon + Math.asin(0.3) * DEG, before.lat];

  await page.mouse.move(...at([0.3, 0]));
  await page.mouse.down();
  await frames(page);
  expect(await orientation()).toEqual(before);

  // Drag to (0.5, 0.2 up) in many small steps: the centre never moves far in one.
  let last = before;
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(...at([0.3 + (0.2 * i) / 12, (-0.2 * i) / 12]));
    await frames(page, 1);
    const o = await orientation();
    expect(Math.max(Math.abs(o.lon - last.lon), Math.abs(o.lat - last.lat))).toBeLessThan(6);
    expect(o.tilt).toBe(90);
    last = o;
  }
  // The land that was under the press is under the pointer, and the centre has moved the other way.
  const p = geoOrthographic().rotate([-last.lon, -last.lat]).scale(1).translate([0, 0])(grabbed)!;
  expect(Math.abs(p[0] - 0.5)).toBeLessThan(0.04);
  expect(Math.abs(p[1] + 0.2)).toBeLessThan(0.04);
  expect(last.lon).toBeLessThan(before.lon - 5);
  expect(await snapshot(page, '#map')).not.toBe(mapBefore);

  // Release changes neither the centre nor the locator.
  await frames(page);
  const held = await orientation();
  const heldLocator = await snapshot(page, '#locator canvas');
  await page.mouse.up();
  await frames(page);
  expect(await orientation()).toEqual(held);
  expect(await snapshot(page, '#locator canvas')).toBe(heldLocator);
  expect(await page.evaluate(() => (window as any).__drawing.draft)).toBeNull();
});

test('a press and release on the locator does nothing', async ({ page }) => {
  await open(page);
  await pick(page, 'robinson');
  await settle(page);
  await frames(page);
  const before = await state(page);
  const locator = await snapshot(page, '#locator canvas');
  const g = await globe(page);
  await page.mouse.click(g.x + g.cx + 0.4 * g.r, g.y + g.cy - 0.1 * g.r);
  await frames(page);
  expect(await state(page)).toEqual(before);
  expect(await snapshot(page, '#locator canvas')).toBe(locator);
});

test('a conic turns sideways only, the other maps both ways, and a pointer past the reach of the grab keeps the last centre', async ({ page }) => {
  await open(page);
  await pick(page, 'albers');
  await settle(page);
  const before = (await state(page)).orientation;
  await dragMarker(page, [0.2, 0], [0.5, -0.5]);
  const after = (await state(page)).orientation;
  expect(after.lat).toBe(before.lat);
  expect(after.tilt).toBe(before.tilt);
  // The land at 11.5 degrees east of the centre is now 30 degrees east of the view's middle.
  expect(Math.abs(after.lon - (before.lon - (Math.asin(0.5) - Math.asin(0.2)) * DEG))).toBeLessThan(2);

  await pick(page, 'robinson');
  await settle(page);
  const start = (await state(page)).orientation;
  const g = await globe(page);
  const at = ([x, y]: Pair): Pair => [g.x + g.cx + x * g.r, g.y + g.cy + y * g.r];
  await page.mouse.move(...at([0, 0]));
  await page.mouse.down();
  await page.mouse.move(...at([0, 0.5]), { steps: 6 });
  const down = (await state(page)).orientation;
  // The globe turned down 30 degrees, so what is at the middle is 30 degrees further north.
  expect(Math.abs(down.lat - 30)).toBeLessThan(1.5);
  expect(Math.abs(down.lon - start.lon)).toBeLessThan(1.5);

  // Far off the globe nothing can be under the pointer: the centre stays where it last was in reach.
  await page.mouse.move(...at([0, 4]));
  await frames(page);
  expect((await state(page)).orientation).toEqual(down);
  // And back in reach it holds the same land again.
  await page.mouse.move(...at([0, 0.5]));
  expect((await state(page)).orientation).toEqual(down);
  await page.mouse.up();
});

test('it tints the area the map covers: all of Mollweide, a disc round the centre of gnomonic', async ({ page }) => {
  await open(page);
  await pick(page, 'mollweide');
  await settle(page);
  await frames(page);
  const g = await globe(page);
  // 70 degrees east, 20 south is open ocean 71 degrees from the centre, past gnomonic's 68 and clear of the rim; the South Atlantic is 28 degrees from the centre.
  const [dx, dy] = [g.r * Math.cos((20 * Math.PI) / 180) * Math.sin((70 * Math.PI) / 180), g.r * Math.sin((20 * Math.PI) / 180)];
  const [nx, ny] = [-g.r * 0.32, g.r * 0.34];
  const [farMollweide, nearMollweide] = [await colourAt(page, dx, dy), await colourAt(page, nx, ny)];
  expect(apart(farMollweide, OCEAN)).toBeGreaterThan(25);
  expect(apart(nearMollweide, OCEAN)).toBeGreaterThan(25);
  expect(apart(farMollweide, nearMollweide)).toBeLessThan(12);

  await pick(page, 'gnomonic');
  await settle(page);
  await frames(page);
  // The same tint inside the disc, and the plain globe outside it.
  expect(apart(await colourAt(page, nx, ny), nearMollweide)).toBeLessThan(12);
  expect(apart(await colourAt(page, dx, dy), OCEAN)).toBeLessThan(12);
});

test('it shows the coverage of the projection a morph is going to', async ({ page }) => {
  await open(page);
  await pick(page, 'mollweide');
  await settle(page);
  await frames(page);
  const g = await globe(page);
  const [dx, dy] = [g.r * Math.cos((20 * Math.PI) / 180) * Math.sin((70 * Math.PI) / 180), g.r * Math.sin((20 * Math.PI) / 180)];
  expect(apart(await colourAt(page, dx, dy), OCEAN)).toBeGreaterThan(25);
  await pick(page, 'gnomonic');
  expect(await page.evaluate(() => (window as any).__app.isMorphing)).toBe(true);
  await frames(page);
  expect(apart(await colourAt(page, dx, dy), OCEAN)).toBeLessThan(12);
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

test('redraws are spaced at least 30 ms apart during rapid changes, and the last change is always drawn', async ({ page }) => {
  await open(page);
  await pick(page, 'robinson');
  await settle(page);
  const setLon = (lon: number) => page.evaluate((lon) => (window as any).__app.setLive({ orientation: { lon, lat: 10, tilt: 0 } }), lon);
  // The locator clears its canvas once for each redraw, and nothing else does.
  const times = await page.evaluate(
    () =>
      new Promise<number[]>((done) => {
        const times: number[] = [];
        const clear = CanvasRenderingContext2D.prototype.clearRect;
        CanvasRenderingContext2D.prototype.clearRect = function (...args) {
          times.push(performance.now());
          return clear.apply(this, args);
        };
        // Forty changes, five milliseconds apart, the last to longitude 40.
        let lon = 0;
        const timer = setInterval(() => {
          (window as any).__app.setLive({ orientation: { lon: lon++, lat: 10, tilt: 0 } });
          if (lon > 40) {
            clearInterval(timer);
            setTimeout(() => {
              CanvasRenderingContext2D.prototype.clearRect = clear;
              done(times);
            }, 200);
          }
        }, 5);
      }),
  );
  expect(times.length).toBeGreaterThan(2);
  for (let i = 1; i < times.length; i++) expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(28);
  const burst = await snapshot(page, '#locator canvas');
  await setLon(20);
  await page.waitForTimeout(150);
  await setLon(40);
  await page.waitForTimeout(150);
  expect(await snapshot(page, '#locator canvas')).toBe(burst);
});

test('a click in the corner of the locator, outside its round edge, reaches the map', async ({ page }) => {
  // Equirectangular is 2:1, so this window leaves it no margin: the corner lies on the map.
  await page.setViewportSize({ width: 1300, height: 500 });
  await open(page);
  await pick(page, 'equirectangular');
  await settle(page);
  await page.getByRole('button', { name: 'Line', exact: true }).click();
  const box = (await page.locator('#locator').boundingBox())!;
  await page.mouse.click(box.x + 3, box.y + 3);
  const draft = await page.evaluate(() => (window as any).__drawing.draft);
  expect(draft?.points).toHaveLength(1);
  // The same on the locator itself places nothing.
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  expect((await page.evaluate(() => (window as any).__drawing.draft)).points).toHaveLength(1);
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
