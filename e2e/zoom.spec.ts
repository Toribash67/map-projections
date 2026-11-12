import { expect, test, type Page } from '@playwright/test';
import { compile } from '../src/projections/compile';
import type { LonLat, ProjectionState } from '../src/projections/types';
import { projectPoint, screenToLonLat, type ScreenTransform } from '../src/screen/screen';
import type { View } from '../src/screen/view';
import { open, openPaused, pick, settle, state } from './support';

type Pair = [number, number];

const view = (page: Page): Promise<View> => page.evaluate(() => ({ ...(window as any).__app.view }));
const atRest = (page: Page) =>
  page.evaluate(() => {
    const a = (window as any).__app;
    return { state: JSON.parse(JSON.stringify(a.state)) as ProjectionState, screen: a.live.screen as ScreenTransform };
  });
const under = async (page: Page, xy: Pair): Promise<LonLat | null> => {
  const { state: s, screen } = await atRest(page);
  return screenToLonLat(compile(s), screen, xy);
};
const whereIs = async (page: Page, p: LonLat): Promise<Pair> => {
  const { state: s, screen } = await atRest(page);
  return projectPoint(compile(s), screen, p);
};
const box = async (page: Page) => (await page.locator('#map').boundingBox())!;
const mouseTo = async (page: Page, [x, y]: Pair) => {
  const b = await box(page);
  await page.mouse.move(b.x + x, b.y + y);
};
/** Turns the wheel at a place on the map; a negative amount zooms in. */
const wheel = async (page: Page, xy: Pair, amount: number, times = 1) => {
  await mouseTo(page, xy);
  for (let i = 0; i < times; i++) await page.mouse.wheel(0, amount);
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
};
const drag = async (page: Page, from: Pair, to: Pair, modifier?: 'Shift') => {
  await mouseTo(page, from);
  if (modifier) await page.keyboard.down(modifier);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await mouseTo(page, [from[0] + ((to[0] - from[0]) * i) / 8, from[1] + ((to[1] - from[1]) * i) / 8]);
  await page.mouse.up();
  if (modifier) await page.keyboard.up(modifier);
};
const onMap = async (page: Page, id: string) => {
  await open(page);
  await pick(page, id);
  await settle(page);
};

test('the wheel zooms about the cursor: the land under it stays under it', async ({ page }) => {
  await onMap(page, 'mollweide');
  const at: Pair = [640, 220];
  const before = (await under(page, at))!;
  await wheel(page, at, -100, 6);
  const v = await view(page);
  expect(v.zoom).toBeGreaterThan(1.5);
  const after = (await under(page, at))!;
  expect(Math.abs(after[0] - before[0])).toBeLessThan(0.01);
  expect(Math.abs(after[1] - before[1])).toBeLessThan(0.01);
  // And out again, all the way, is the fit.
  await wheel(page, [100, 500], 100, 30);
  expect(await view(page)).toEqual({ zoom: 1, panX: 0, panY: 0 });
});

test('zoom stops at 32 times', async ({ page }) => {
  await onMap(page, 'mollweide');
  await wheel(page, [500, 300], -400, 40);
  expect((await view(page)).zoom).toBe(32);
});

test('zoomed in, a drag still moves the centre of the map, and a Shift-drag or a middle-button drag moves the view', async ({ page }) => {
  await onMap(page, 'mollweide');
  await wheel(page, [500, 300], -100, 8);
  const [v0, s0] = [await view(page), await state(page)];
  await drag(page, [500, 300], [560, 300]);
  const [v1, s1] = [await view(page), await state(page)];
  expect(v1).toEqual(v0);
  expect(s1.orientation.lon).not.toBeCloseTo(s0.orientation.lon, 3);

  await drag(page, [500, 300], [560, 330], 'Shift');
  const [v2, s2] = [await view(page), await state(page)];
  expect(s2.orientation).toEqual(s1.orientation);
  expect(v2.panX - v1.panX).toBeCloseTo(60, 0);
  expect(v2.panY - v1.panY).toBeCloseTo(30, 0);

  await mouseTo(page, [500, 300]);
  await page.mouse.down({ button: 'middle' });
  await mouseTo(page, [470, 300]);
  await mouseTo(page, [440, 300]);
  await page.mouse.up({ button: 'middle' });
  expect((await view(page)).panX - v2.panX).toBeCloseTo(-60, 0);
  expect((await state(page)).orientation).toEqual(s1.orientation);
});

test('the view cannot be moved off the map', async ({ page }) => {
  await onMap(page, 'mollweide');
  await wheel(page, [500, 300], -100, 8);
  const { zoom } = await view(page);
  for (let i = 0; i < 12; i++) await drag(page, [100, 100], [900, 500], 'Shift');
  const v = await view(page);
  expect(v.panX).toBeCloseTo(((zoom - 1) * 1000) / 2, 6);
  expect(v.panY).toBeCloseTo(((zoom - 1) * 600) / 2, 6);
});

test('the zoom buttons and keys zoom about the middle, and 0 or the fit button returns to the fit', async ({ page }) => {
  await onMap(page, 'mollweide');
  const zoomIn = page.getByRole('button', { name: 'Zoom in' });
  const zoomOut = page.getByRole('button', { name: 'Zoom out' });
  const fit = page.getByRole('button', { name: 'Fit the map to the window' });
  await expect(zoomOut).toBeDisabled();
  await expect(fit).toBeDisabled();
  const middle = (await under(page, [500, 300]))!;
  await zoomIn.click();
  await expect.poll(async () => (await view(page)).zoom).toBe(2);
  const stillMiddle = (await under(page, [500, 300]))!;
  expect(Math.abs(stillMiddle[0] - middle[0]) + Math.abs(stillMiddle[1] - middle[1])).toBeLessThan(0.01);
  await expect(zoomOut).toBeEnabled();
  await page.locator('#map').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('+');
  await expect.poll(async () => (await view(page)).zoom).toBe(4);
  await page.keyboard.press('-');
  await expect.poll(async () => (await view(page)).zoom).toBe(2);
  await page.keyboard.press('+');
  await page.keyboard.press('0');
  await expect.poll(() => view(page)).toEqual({ zoom: 1, panX: 0, panY: 0 });
  await zoomIn.click();
  await expect.poll(async () => (await view(page)).zoom).toBe(2);
  await fit.click();
  await expect.poll(() => view(page)).toEqual({ zoom: 1, panX: 0, panY: 0 });
});

test('the zoom keys are left alone while typing in a number box', async ({ page }) => {
  await onMap(page, 'mollweide');
  const boxEl = page.getByRole('textbox', { name: 'Longitude, value', exact: true });
  await boxEl.focus();
  await page.keyboard.press('+');
  await page.keyboard.press('0');
  expect(await view(page)).toEqual({ zoom: 1, panX: 0, panY: 0 });
});

test('another projection chosen while zoomed keeps the place in the middle of the window in the middle', async ({ page }) => {
  await onMap(page, 'mercator');
  const europe: LonLat = [10, 50];
  await wheel(page, await whereIs(page, europe), -100, 9);
  // Bring it to the middle of the window.
  const at = await whereIs(page, europe);
  await drag(page, at, [500, 300], 'Shift');
  const { zoom } = await view(page);
  const middle = (await under(page, [500, 300]))!;
  await pick(page, 'mollweide');
  await settle(page);
  expect((await view(page)).zoom).toBeCloseTo(zoom, 9);
  const [x, y] = await whereIs(page, middle);
  expect(Math.hypot(x - 500, y - 300)).toBeLessThan(2);
});

test('a projection that cannot show the place in the middle of the window is shown at the fit', async ({ page }) => {
  await onMap(page, 'mollweide');
  await wheel(page, await whereIs(page, [170, 0]), -100, 9);
  await drag(page, await whereIs(page, [170, 0]), [500, 300], 'Shift');
  expect((await view(page)).zoom).toBeGreaterThan(1);
  // Gnomonic, centred on 0, 0, shows nothing beyond 68 degrees.
  await pick(page, 'gnomonic');
  await settle(page);
  expect(await view(page)).toEqual({ zoom: 1, panX: 0, panY: 0 });
});

test('a slide keeps the view as it is', async ({ page }) => {
  await onMap(page, 'mercator');
  await wheel(page, [600, 250], -100, 6);
  const before = await view(page);
  await pick(page, 'gall-peters');
  await settle(page);
  expect(await view(page)).toEqual(before);
});

test('the wheel does nothing while a morph runs', async ({ page }) => {
  await openPaused(page);
  await pick(page, 'mollweide');
  await page.clock.runFor(300);
  await mouseTo(page, [500, 300]);
  for (let i = 0; i < 5; i++) await page.mouse.wheel(0, -100);
  await page.clock.runFor(32);
  expect(await view(page)).toEqual({ zoom: 1, panX: 0, panY: 0 });
});

test('a window made smaller while zoomed and panned to a limit keeps the view within its limits and the map drawn', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await onMap(page, 'mollweide');
  await wheel(page, [500, 300], -100, 6);
  // To the limit sideways: the left end of the map, with the sea and the page beside it both in the window.
  for (let i = 0; i < 4; i++) await drag(page, [100, 300], [900, 300], 'Shift');
  const before = await view(page);
  expect(before.panX).toBeCloseTo(((before.zoom - 1) * 1000) / 2, 6);
  await page.setViewportSize({ width: 800, height: 450 });
  await page.waitForFunction(() => (window as any).__app.viewport.height === 450);
  const [v, size] = [await view(page), await page.evaluate(() => (window as any).__app.viewport)];
  expect(v.zoom).toBe(before.zoom);
  expect(Math.abs(v.panX)).toBeLessThanOrEqual(((v.zoom - 1) * size.width) / 2 + 1e-9);
  expect(Math.abs(v.panY)).toBeLessThanOrEqual(((v.zoom - 1) * size.height) / 2 + 1e-9);
  // Something of the map is on the canvas: not all one colour.
  const colours = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('#map')!;
    const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
    const seen = new Set<number>();
    for (let i = 0; i < data.length; i += 4 * 97) seen.add((data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!);
    return seen.size;
  });
  expect(colours).toBeGreaterThan(1);
  expect(errors).toEqual([]);
});

/** Two fingers on the map, moved apart or together about the middle between them. */
async function pinch(page: Page, centre: Pair, from: number, to: number) {
  const b = await box(page);
  await page.evaluate(
    ([cx, cy, from, to]) => {
      const canvas = document.querySelector<HTMLCanvasElement>('#map')!;
      const fire = (type: string, id: number, x: number, y: number) =>
        canvas.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: id === 11, clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true }));
      fire('pointerdown', 11, cx! - from! / 2, cy!);
      fire('pointerdown', 12, cx! + from! / 2, cy!);
      for (let i = 1; i <= 6; i++) {
        const d = from! + ((to! - from!) * i) / 6;
        fire('pointermove', 11, cx! - d / 2, cy!);
        fire('pointermove', 12, cx! + d / 2, cy!);
      }
      fire('pointerup', 11, cx! - to! / 2, cy!);
      fire('pointerup', 12, cx! + to! / 2, cy!);
    },
    [b.x + centre[0], b.y + centre[1], from, to] as const,
  );
}

test('two fingers pinch to zoom, about the place between them', async ({ page }) => {
  await onMap(page, 'mollweide');
  const before = (await under(page, [600, 250]))!;
  await pinch(page, [600, 250], 80, 240);
  const v = await view(page);
  expect(v.zoom).toBeCloseTo(3, 1);
  const after = (await under(page, [600, 250]))!;
  expect(Math.abs(after[0] - before[0]) + Math.abs(after[1] - before[1])).toBeLessThan(0.05);
});

test('a pinch with a drawing tool active zooms and places no point', async ({ page }) => {
  await onMap(page, 'mollweide');
  await page.getByRole('button', { name: 'Line', exact: true }).click();
  await pinch(page, [500, 300], 80, 200);
  expect((await view(page)).zoom).toBeGreaterThan(2);
  expect(await page.evaluate(() => (window as any).__drawing.draft)).toBeNull();
  // Nor does it move the centre of the map.
  expect((await state(page)).orientation).toEqual({ lon: 0, lat: 0, tilt: 0 });
});

test('with Tissot on, zooming in shows more indicatrices, each smaller on the Earth', async ({ page }) => {
  await onMap(page, 'mollweide');
  await page.evaluate(() => (window as any).__app.setTissot(true));
  const read = () =>
    page.evaluate(() => {
      const scene = (window as any).__app.scene;
      return { radius: scene.indicatrixRadius as number, count: scene.indicatrices.length as number };
    });
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  const wide = await read();
  expect(wide.radius).toBeCloseTo((5 * Math.PI) / 180, 12);
  await wheel(page, [500, 300], -100, 14);
  expect((await view(page)).zoom).toBeGreaterThanOrEqual(8);
  const close = await read();
  expect(close.radius).toBeCloseTo((5 * Math.PI) / 180 / 6, 12);
  // Only those in or near the window are worked out, and of those there are more than a handful.
  expect(close.count).toBeGreaterThan(8);
  expect(close.count).toBeLessThan(400);
});

test('zoomed well in, the coast is drawn in finer detail, and stays so while the map moves', async ({ page }) => {
  await onMap(page, 'mollweide');
  // The points of the land that are in the window: several times as many with the finer coast.
  const inWindow = () =>
    page.evaluate(() => {
      const app = (window as any).__app;
      let count = 0;
      for (const { src } of app.scene.layers.land as { src: Float32Array }[]) {
        for (let i = 0; i < src.length; i += 2) if (src[i]! >= 0 && src[i]! <= app.viewport.width && src[i + 1]! >= 0 && src[i + 1]! <= app.viewport.height) count++;
      }
      return count;
    });
  const landPoints = () => page.evaluate(() => ((window as any).__app.scene.layers.land as { src: Float32Array }[]).reduce((sum, piece) => sum + piece.src.length / 2, 0));
  // Just short of where the finer coast comes, and then just past it, which changes the window little.
  await wheel(page, [520, 200], -100, 7);
  expect((await view(page)).zoom).toBeLessThan(3);
  const coarse = await inWindow();
  await wheel(page, [520, 200], -100, 1);
  expect((await view(page)).zoom).toBeGreaterThanOrEqual(3);
  await expect.poll(inWindow, { timeout: 10_000 }).toBeGreaterThan(3 * coarse);
  // Closer in, every frame of a drag has the finer coast: none goes back to the coarse one, of which the whole is cut.
  await wheel(page, [520, 200], -100, 6);
  const [fine, whole] = [await inWindow(), await landPoints()];
  const seen = await page.evaluate(async () => {
    const app = (window as any).__app;
    const canvas = document.querySelector('canvas')!;
    const box = canvas.getBoundingClientRect();
    const fire = (type: string, x: number, y: number) =>
      canvas.dispatchEvent(new PointerEvent(type, { pointerId: 7, isPrimary: true, button: 0, buttons: 1, clientX: box.left + x, clientY: box.top + y, bubbles: true }));
    const counts: number[] = [];
    fire('pointerdown', 500, 300);
    for (let i = 1; i <= 12; i++) {
      fire('pointermove', 500 + 2 * i, 300 + i);
      await new Promise((done) => requestAnimationFrame(done));
      let count = 0;
      for (const { src } of app.scene.layers.land as { src: Float32Array }[]) {
        for (let k = 0; k < src.length; k += 2) if (src[k]! >= 0 && src[k]! <= app.viewport.width && src[k + 1]! >= 0 && src[k + 1]! <= app.viewport.height) count++;
      }
      counts.push(count);
    }
    fire('pointerup', 524, 312);
    return counts;
  });
  expect(seen).toHaveLength(12);
  for (const count of seen) expect(count).toBeGreaterThan(0.6 * fine);
  // And only what the window shows, and what is near it, is cut: a small share of the sixty thousand points the finer land has.
  expect(whole).toBeLessThan(15_000);
});

test('where the finer coast is too slow for a moving map, the map moves with the coarse one and has the finer when left alone', async ({ page }) => {
  await onMap(page, 'mollweide');
  // The points of the land that are in the window: several times as many with the finer coast.
  const inWindow = () =>
    page.evaluate(() => {
      const app = (window as any).__app;
      let count = 0;
      for (const { src } of app.scene.layers.land as { src: Float32Array }[]) {
        for (let i = 0; i < src.length; i += 2) if (src[i]! >= 0 && src[i]! <= app.viewport.width && src[i + 1]! >= 0 && src[i + 1]! <= app.viewport.height) count++;
      }
      return count;
    });
  await wheel(page, [520, 200], -100, 14);
  await page.waitForFunction(() => (window as any).__app.fine !== null);
  // A few frames with it first, as the first of them are slow, the browser not having made the code quick yet.
  for (let i = 0; i < 3; i++) await drag(page, [500, 300], [505, 300]);
  const fine = await inWindow();
  expect(fine).toBeGreaterThan(100);
  // As a slow machine would have found it.
  await page.evaluate(() => ((window as any).__app.fineCost = 1000));
  await drag(page, [500, 300], [505, 300]);
  expect(await inWindow()).toBeLessThan(fine / 3);
  await expect.poll(inWindow, { timeout: 10_000 }).toBeGreaterThan(0.8 * fine);
  // That frame was quick, which is believed at once: the next drag has the finer coast all the way.
  await drag(page, [500, 300], [505, 300]);
  expect(await inWindow()).toBeGreaterThan(0.8 * fine);
});
