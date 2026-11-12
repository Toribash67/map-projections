import { expect, test, type Page } from '@playwright/test';
import type { Shape } from '../src/drawing/model';
import { toVector } from '../src/geo/densify';
import { DEFAULT_CAMERA, PAD, pick as pickOnGlobe, toView } from '../src/locator/camera';
import { REACH } from '../src/locator/surface';
import { mapStyle } from '../src/render/style';
import { isSliding, move, open, pick, settle, state } from './support';

// The tests run in light mode, as the browser is told to, unless one says otherwise.
const LIGHT_STYLE = mapStyle('light');

type Pair = [number, number];
type LonLat = [number, number];
type Rgb = [number, number, number];

const hex = (c: string): Rgb => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) as Rgb;
const OCEAN = hex(LIGHT_STYLE.ocean);
const apart = (a: Rgb, b: Rgb) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);

const CANVAS = '#locator canvas';
const surfaceButton = (page: Page) => page.getByRole('button', { name: 'Projection surface', exact: true });
const collapseButton = (page: Page) => page.getByRole('button', { name: 'Corner globe', exact: true });
const resetButton = (page: Page) => page.getByRole('button', { name: 'Reset the view of the corner globe', exact: true });

const frames = (page: Page, count = 3) =>
  page.evaluate(
    (count) =>
      new Promise<void>((done) => {
        const next = (left: number) => (left <= 0 ? done() : requestAnimationFrame(() => next(left - 1)));
        next(count);
      }),
    count,
  );

/** Waits out the gap the corner globe leaves between two redraws, and the redraw after it. */
const redrawn = async (page: Page) => {
  await page.waitForTimeout(60);
  await frames(page);
};

/** The corner globe on the page: the corner of its canvas, and the radius of the globe drawn on it, in CSS pixels. */
async function face(page: Page): Promise<{ x: number; y: number; middle: number; r: number }> {
  const box = (await page.locator(CANVAS).boundingBox())!;
  const withSurface = (await surfaceButton(page).getAttribute('aria-pressed')) === 'true';
  return { x: box.x, y: box.y, middle: box.width / 2, r: (box.width / 2 - PAD) / (withSurface ? REACH : 1) };
}

/** Where a place of the Earth is on the corner globe as it is first seen: an offset from its middle, in CSS pixels with y down. */
async function offsetOf(page: Page, place: LonLat): Promise<Pair> {
  const { r } = await face(page);
  const [x, y, z] = toView(DEFAULT_CAMERA, toVector(place));
  expect(z).toBeGreaterThan(0.3);
  return [r * x, -r * y];
}

/** The colour of the corner globe at an offset from its middle, in CSS pixels. */
const colourAt = (page: Page, [dx, dy]: Pair): Promise<Rgb> =>
  page.evaluate(([selector, dx, dy]) => {
    const c = document.querySelector<HTMLCanvasElement>(selector as string)!;
    const ratio = c.width / c.clientWidth;
    const [x, y] = [Math.round((c.clientWidth / 2 + (dx as number)) * ratio), Math.round((c.clientHeight / 2 + (dy as number)) * ratio)];
    return [...c.getContext('2d')!.getImageData(x, y, 1, 1).data.slice(0, 3)] as Rgb;
  }, [CANVAS, dx, dy] as const);

/** The pixels of a canvas within `half` pixels of an offset from its middle (the whole canvas if none), and how many are reddish, which only the accent is. */
const patch = (page: Page, selector: string, around?: { at: Pair; half: number }): Promise<{ pixels: string; reddish: number }> =>
  page.evaluate(
    ([selector, around]) => {
      const c = document.querySelector<HTMLCanvasElement>(selector as string)!;
      const ratio = c.width / c.clientWidth;
      const a = around as { at: Pair; half: number } | undefined;
      const [x0, y0, x1, y1] = a
        ? [(c.clientWidth / 2 + a.at[0] - a.half) * ratio, (c.clientHeight / 2 + a.at[1] - a.half) * ratio, (c.clientWidth / 2 + a.at[0] + a.half) * ratio, (c.clientHeight / 2 + a.at[1] + a.half) * ratio].map(Math.round)
        : [0, 0, c.width, c.height];
      const { data } = c.getContext('2d')!.getImageData(x0!, y0!, x1! - x0!, y1! - y0!);
      let reddish = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i]! - Math.max(data[i + 1]!, data[i + 2]!) > 60) reddish++;
      return { pixels: data.join(','), reddish };
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

/** Opens a projection with the corner globe showing, and its surface shown or not. */
async function show(page: Page, id: string, surface = false) {
  await open(page);
  await pick(page, id);
  await settle(page);
  if (((await surfaceButton(page).getAttribute('aria-pressed')) === 'true') !== surface) await surfaceButton(page).click();
  await redrawn(page);
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

test('its view is fixed: dragging the map moves the centre marker over it and leaves its land where it was', async ({ page }) => {
  await show(page, 'robinson');
  // Scandinavia, far from the marker, the map's equator and the poles.
  const north = { at: await offsetOf(page, [10, 60]), half: 12 };
  const start = await state(page);
  const marker = { at: await offsetOf(page, [start.orientation.lon, start.orientation.lat]), half: 8 };
  const before = { north: await patch(page, CANVAS, north), marker: await patch(page, CANVAS, marker), state: start };
  expect(before.marker.reddish).toBeGreaterThan(10);

  const map = (await page.locator('#map').boundingBox())!;
  await page.mouse.move(map.x + map.width / 2, map.y + map.height / 2);
  await page.mouse.down();
  await page.mouse.move(map.x + map.width / 2 - 160, map.y + map.height / 2, { steps: 8 });
  await page.mouse.up();
  await redrawn(page);

  const after = await state(page);
  expect(Math.abs(after.orientation.lon - before.state.orientation.lon)).toBeGreaterThan(20);
  expect((await patch(page, CANVAS, north)).pixels).toBe(before.north.pixels);
  // The marker has gone with the centre.
  expect((await patch(page, CANVAS, marker)).reddish).toBe(0);
  expect((await patch(page, CANVAS, { at: await offsetOf(page, [after.orientation.lon, after.orientation.lat]), half: 8 })).reddish).toBeGreaterThan(10);
});

test('dragging it turns it and changes nothing of the map, and the reset button turns it back', async ({ page }) => {
  await show(page, 'robinson');
  const before = { state: await state(page), globe: await snapshot(page, CANVAS), map: await snapshot(page, '#map') };
  await expect(resetButton(page)).toBeHidden();

  // The tool is on, as a drag on the corner globe is neither a click on the map nor a drag of it.
  await page.getByRole('button', { name: 'Line', exact: true }).click();
  const f = await face(page);
  await page.mouse.move(f.x + f.middle, f.y + f.middle);
  await page.mouse.down();
  await page.mouse.move(f.x + f.middle + 50, f.y + f.middle + 20, { steps: 6 });
  await page.mouse.up();
  await redrawn(page);

  expect(await snapshot(page, CANVAS)).not.toBe(before.globe);
  expect(await state(page)).toEqual(before.state);
  expect(await snapshot(page, '#map')).toBe(before.map);
  expect(await page.evaluate(() => (window as any).__drawing.draft)).toBeNull();

  await resetButton(page).click();
  await redrawn(page);
  expect(await snapshot(page, CANVAS)).toBe(before.globe);
  await expect(resetButton(page)).toBeHidden();
});

test('a click on it moves the centre of the map there, by a slide, with the tilt held', async ({ page }) => {
  await show(page, 'transverse-mercator');
  const before = (await state(page)).orientation;
  expect(before.tilt).toBe(90);
  const f = await face(page);
  // Three tenths of a radius right of the middle and two up.
  const [lon, lat] = pickOnGlobe(DEFAULT_CAMERA, 0.3, 0.2)!;
  await page.mouse.click(f.x + f.middle + 0.3 * f.r, f.y + f.middle - 0.2 * f.r);
  expect(await isSliding(page)).toBe(true);
  await settle(page);
  const after = (await state(page)).orientation;
  expect(Math.abs(after.lon - lon)).toBeLessThan(1);
  expect(Math.abs(after.lat - lat)).toBeLessThan(1);
  expect(after.tilt).toBe(90);

  // Outside the globe's edge, though on its face, there is nothing to pick.
  await show(page, 'equirectangular', true);
  const withSurface = await face(page);
  const held = await state(page);
  await page.mouse.click(withSurface.x + withSurface.middle + 1.3 * withSurface.r, withSurface.y + withSurface.middle);
  await frames(page);
  expect(await isSliding(page)).toBe(false);
  expect(await state(page)).toEqual(held);
});

test('a click moves a conic sideways only: its centre latitude is its own', async ({ page }) => {
  await show(page, 'albers');
  const before = (await state(page)).orientation;
  const f = await face(page);
  const [lon] = pickOnGlobe(DEFAULT_CAMERA, -0.4, 0.3)!;
  await page.mouse.click(f.x + f.middle - 0.4 * f.r, f.y + f.middle - 0.3 * f.r);
  await settle(page);
  const after = (await state(page)).orientation;
  expect(Math.abs(after.lon - lon)).toBeLessThan(1);
  expect(after.lat).toBe(before.lat);
});

test('the surface the map is projected onto is drawn about the globe, follows the parameters, and is not offered where there is none', async ({ page }) => {
  await show(page, 'albers', true);
  await expect(surfaceButton(page)).toBeEnabled();
  const cone = await snapshot(page, CANVAS);
  // Beyond the globe's edge there is something drawn: the cone.
  const f = await face(page);
  const beyond = await page.evaluate(
    ([selector, r]) => {
      const c = document.querySelector<HTMLCanvasElement>(selector as string)!;
      const ratio = c.width / c.clientWidth;
      const { data } = c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
      let n = 0;
      for (let y = 0; y < c.height; y++)
        for (let x = 0; x < c.width; x++) if (data[4 * (y * c.width + x) + 3]! > 0 && Math.hypot(x - c.width / 2, y - c.height / 2) > ((r as number) + 3) * ratio) n++;
      return n;
    },
    [CANVAS, f.r] as const,
  );
  expect(beyond).toBeGreaterThan(100);

  await move(page, 'First parallel', 5);
  await redrawn(page);
  const flatter = await snapshot(page, CANVAS);
  expect(flatter).not.toBe(cone);

  // Without it the globe has the whole face.
  await surfaceButton(page).click();
  await redrawn(page);
  await expect(surfaceButton(page)).toHaveAttribute('aria-pressed', 'false');
  expect((await face(page)).r).toBeGreaterThan(f.r * 1.5);
  expect(await snapshot(page, CANVAS)).not.toBe(flatter);
  await surfaceButton(page).click();

  // Mollweide is worked out by formula: there is no surface to show, and the button says so.
  await pick(page, 'mollweide');
  await settle(page);
  await expect(surfaceButton(page)).toBeDisabled();
  await expect(surfaceButton(page)).toHaveAttribute('aria-pressed', 'false');
  expect(await surfaceButton(page).getAttribute('aria-description')).toContain('formula');
  // The choice is kept for the maps that have one.
  await pick(page, 'mercator');
  await settle(page);
  await expect(surfaceButton(page)).toBeEnabled();
  await expect(surfaceButton(page)).toHaveAttribute('aria-pressed', 'true');
});

test('it folds away, and that and the surface are remembered over a reload', async ({ page }) => {
  await show(page, 'mercator', true);
  await expect(page.locator(CANVAS)).toBeVisible();
  await surfaceButton(page).click();
  await collapseButton(page).click();
  await expect(page.locator(CANVAS)).toBeHidden();
  await expect(surfaceButton(page)).toBeHidden();
  await expect(collapseButton(page)).toHaveAttribute('aria-expanded', 'false');
  expect(JSON.parse((await page.evaluate((key) => localStorage.getItem(key), 'map-projections:prefs:v1'))!).locator).toEqual({ surface: false, collapsed: true });

  await page.reload();
  await page.waitForFunction(() => (window as any).__app !== undefined);
  await pick(page, 'mercator');
  await settle(page);
  await expect(page.locator(CANVAS)).toBeHidden();
  await collapseButton(page).click();
  await expect(page.locator(CANVAS)).toBeVisible();
  await expect(surfaceButton(page)).toHaveAttribute('aria-pressed', 'false');
});

test('it tints the area the map covers: all of Mollweide, a disc round the centre of gnomonic', async ({ page }) => {
  await show(page, 'mollweide');
  // The Barents Sea is 79 degrees from the centre, past gnomonic's 68; the South Atlantic is 18 degrees from it.
  const [far, near] = [await offsetOf(page, [42, 75]), await offsetOf(page, [-10, -15])];
  const [farMollweide, nearMollweide] = [await colourAt(page, far), await colourAt(page, near)];
  expect(apart(farMollweide, OCEAN)).toBeGreaterThan(25);
  expect(apart(nearMollweide, OCEAN)).toBeGreaterThan(25);
  expect(apart(farMollweide, nearMollweide)).toBeLessThan(12);

  await show(page, 'gnomonic');
  // The same tint inside the disc, and the plain globe outside it.
  expect(apart(await colourAt(page, near), nearMollweide)).toBeLessThan(12);
  expect(apart(await colourAt(page, far), OCEAN)).toBeLessThan(12);
});

test('it shows the coverage of the projection a morph is going to', async ({ page }) => {
  // Gnomonic has a surface, and the globe is drawn smaller with it shown: it is turned off there, and stays off.
  await show(page, 'gnomonic');
  await pick(page, 'mollweide');
  await settle(page);
  await redrawn(page);
  const far = await offsetOf(page, [42, 75]);
  expect(apart(await colourAt(page, far), OCEAN)).toBeGreaterThan(25);
  await pick(page, 'gnomonic');
  expect(await page.evaluate(() => (window as any).__app.isMorphing)).toBe(true);
  await redrawn(page);
  expect(apart(await colourAt(page, far), OCEAN)).toBeLessThan(12);
});

test('it draws a shape in full on gnomonic even when the main map clips it', async ({ page }) => {
  await show(page, 'gnomonic');
  // 81 degrees from the centre and 6 across: all of it is past gnomonic's 68.
  await setShapes(page, [{ kind: 'circle', center: [80, 30], radiusDeg: 6 }]);
  await redrawn(page);
  expect((await patch(page, '#map')).reddish).toBe(0);
  expect((await patch(page, CANVAS, { at: await offsetOf(page, [80, 30]), half: 14 })).reddish).toBeGreaterThan(10);

  // Moving the centre brings it onto the main map.
  await move(page, 'Longitude', 60);
  await frames(page);
  expect((await patch(page, '#map')).reddish).toBeGreaterThan(20);
});

test('a centre on the far side is marked by an empty ring, seen through the globe', async ({ page }) => {
  await show(page, 'robinson');
  const near = (await patch(page, CANVAS)).reddish;
  await page.evaluate(() => (window as any).__app.setLive({ orientation: { lon: -170, lat: -25, tilt: 0 } }));
  await redrawn(page);
  const far = (await patch(page, CANVAS)).reddish;
  expect(far).toBeGreaterThan(0);
  expect(far).toBeLessThan(near);
});

test('it follows the centre and the tilt: the frame equator turns with a tilted map', async ({ page }) => {
  await show(page, 'robinson');
  const before = await snapshot(page, CANVAS);
  await move(page, 'Longitude', 90);
  await redrawn(page);
  const turned = await snapshot(page, CANVAS);
  expect(turned).not.toBe(before);
  await move(page, 'Tilt', 90);
  await redrawn(page);
  expect(await snapshot(page, CANVAS)).not.toBe(turned);
});

test('redraws are spaced at least 30 ms apart during rapid changes, and the last change is always drawn', async ({ page }) => {
  await show(page, 'robinson');
  const setLon = (lon: number) => page.evaluate((lon) => (window as any).__app.setLive({ orientation: { lon, lat: 10, tilt: 0 } }), lon);
  // The corner globe clears its canvas once for each redraw, and nothing else does.
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
  const burst = await snapshot(page, CANVAS);
  await setLon(20);
  await page.waitForTimeout(150);
  await setLon(40);
  await page.waitForTimeout(150);
  expect(await snapshot(page, CANVAS)).toBe(burst);
});

test('a click in a corner of it, outside its round edge, reaches the map', async ({ page }) => {
  // Equirectangular is 2:1, so this window leaves it no margin: the corner lies on the map.
  await page.setViewportSize({ width: 1300, height: 500 });
  await show(page, 'equirectangular');
  await page.getByRole('button', { name: 'Line', exact: true }).click();
  const box = (await page.locator('#locator').boundingBox())!;
  // The corner with no button in it, while the globe is as it was first seen.
  await page.mouse.click(box.x + 3, box.y + 3);
  const draft = await page.evaluate(() => (window as any).__drawing.draft);
  expect(draft?.points).toHaveLength(1);
  // The same on the globe itself places nothing.
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await settle(page);
  expect((await page.evaluate(() => (window as any).__drawing.draft)).points).toHaveLength(1);
});

test('on a phone it sits inside the map, clear of the controls', async ({ page }) => {
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
