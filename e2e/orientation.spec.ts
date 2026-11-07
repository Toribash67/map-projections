import { expect, test, type Page } from '@playwright/test';
import { compile } from '../src/projections/compile';
import type { LonLat, Orientation, ProjectionState } from '../src/projections/types';
import { projectPoint, screenToLonLat, type ScreenTransform } from '../src/screen/screen';
import { isCurrent, isMorphing, move, numberBox, open, openPaused, pick, settle, slider, state, stop, type } from './support';

type Pair = [number, number];

const orientation = async (page: Page): Promise<Orientation> => (await state(page)).orientation;
const setOrientation = (page: Page, o: Orientation) => page.evaluate((o) => (window as any).__app.setLive({ orientation: o }), o);

/** The map at rest: its state and the fit it is drawn with. */
const atRest = (page: Page) =>
  page.evaluate(() => {
    const a = (window as any).__app;
    return { state: JSON.parse(JSON.stringify(a.state)) as ProjectionState, screen: a.live.screen as ScreenTransform };
  });

const canvasBox = async (page: Page) => (await page.locator('#map').boundingBox())!;
const centreOf = async (page: Page): Promise<Pair> => {
  const box = await canvasBox(page);
  return [box.width / 2, box.height / 2];
};
const dist = (a: Pair, b: Pair) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Where the map now draws a geographic point, in canvas pixels. */
async function whereIs(page: Page, p: LonLat): Promise<Pair> {
  const { state: s, screen } = await atRest(page);
  return projectPoint(compile(s), screen, p);
}

/** The geographic point under a canvas pixel, or null off the map. */
async function under(page: Page, xy: Pair): Promise<LonLat | null> {
  const { state: s, screen } = await atRest(page);
  return screenToLonLat(compile(s), screen, xy);
}

/** Moves the mouse to a canvas pixel. */
async function mouseTo(page: Page, xy: Pair) {
  const box = await canvasBox(page);
  await page.mouse.move(box.x + xy[0], box.y + xy[1]);
}

/** Records the clicks the map reports, through a second listener on the same canvas. */
const recordClicks = (page: Page) =>
  page.evaluate(async () => {
    const { attachMapPointer } = await import('/src/ui/mapPointer.ts' as string);
    const w = window as any;
    w.__clicks = [];
    attachMapPointer(document.querySelector('#map'), w.__app, { onClick: (xy: Pair) => w.__clicks.push(xy) });
  });
const clicks = (page: Page): Promise<Pair[]> => page.evaluate(() => (window as any).__clicks);

test('longitude, latitude and tilt sliders and number fields stay in sync', async ({ page }) => {
  await open(page);
  await pick(page, 'robinson');
  await settle(page);

  await move(page, 'Longitude', 40);
  expect((await orientation(page)).lon).toBe(40);
  await expect(numberBox(page, 'Longitude')).toHaveValue('40°');
  await type(page, 'Latitude', '-25.5');
  expect((await orientation(page)).lat).toBe(-25.5);
  await expect(numberBox(page, 'Latitude')).toHaveValue('-25.5°');
  await move(page, 'Tilt', 30);
  expect(await orientation(page)).toEqual({ lon: 40, lat: -25.5, tilt: 30 });
  await expect(numberBox(page, 'Tilt')).toHaveValue('30°');
  await type(page, 'Longitude', '-120');
  await expect(slider(page, 'Longitude')).toHaveValue('-120');

  // A change from elsewhere, as a drag makes, shows in all three.
  await setOrientation(page, { lon: -100, lat: 12, tilt: 45 });
  await expect(slider(page, 'Longitude')).toHaveValue('-100');
  await expect(slider(page, 'Latitude')).toHaveValue('12');
  await expect(slider(page, 'Tilt')).toHaveValue('45');
  await expect(numberBox(page, 'Longitude')).toHaveValue('-100°');
  await expect(numberBox(page, 'Latitude')).toHaveValue('12°');
  await expect(numberBox(page, 'Tilt')).toHaveValue('45°');
});

test('typing 999 in longitude gives -81; blank or "abc" reverts; 100 in latitude gives 90', async ({ page }) => {
  await open(page);
  await pick(page, 'robinson');
  await settle(page);
  await setOrientation(page, { lon: 20, lat: 10, tilt: 15 });

  await type(page, 'Longitude', '999');
  expect((await orientation(page)).lon).toBe(-81);
  await expect(numberBox(page, 'Longitude')).toHaveValue('-81°');
  await type(page, 'Longitude', '-999°');
  expect((await orientation(page)).lon).toBe(81);
  for (const bad of ['', '   ', 'abc', '12abc', 'Infinity']) {
    await type(page, 'Longitude', bad);
    await type(page, 'Latitude', bad);
    await type(page, 'Tilt', bad);
    expect(await orientation(page), `"${bad}"`).toEqual({ lon: 81, lat: 10, tilt: 15 });
    await expect(numberBox(page, 'Longitude')).toHaveValue('81°');
    await expect(numberBox(page, 'Latitude')).toHaveValue('10°');
    await expect(numberBox(page, 'Tilt')).toHaveValue('15°');
  }
  await type(page, 'Latitude', '100');
  expect((await orientation(page)).lat).toBe(90);
  await expect(numberBox(page, 'Latitude')).toHaveValue('90°');
  await type(page, 'Latitude', '-100');
  expect((await orientation(page)).lat).toBe(-90);
  await type(page, 'Tilt', '120');
  expect((await orientation(page)).tilt).toBe(90);
  await expect(numberBox(page, 'Tilt')).toHaveValue('90°');
  await type(page, 'Tilt', '-5');
  expect((await orientation(page)).tilt).toBe(0);
  expect(await orientation(page)).toEqual({ lon: 81, lat: -90, tilt: 0 });
});

test('each reset restores its default; reset-all restores all three', async ({ page }) => {
  await open(page);
  await pick(page, 'robinson');
  await settle(page);
  const reset = (name: string) => page.getByRole('button', { name, exact: true }).click();

  await setOrientation(page, { lon: 40, lat: 20, tilt: 30 });
  await reset('Reset longitude');
  expect(await orientation(page)).toEqual({ lon: 0, lat: 20, tilt: 30 });
  await reset('Reset latitude');
  expect(await orientation(page)).toEqual({ lon: 0, lat: 0, tilt: 30 });
  await reset('Reset tilt');
  expect(await orientation(page)).toEqual({ lon: 0, lat: 0, tilt: 0 });

  await setOrientation(page, { lon: -70, lat: -35, tilt: 60 });
  await reset('Reset all');
  expect(await orientation(page)).toEqual({ lon: 0, lat: 0, tilt: 0 });
  await expect(numberBox(page, 'Longitude')).toHaveValue('0°');
  await expect(numberBox(page, 'Latitude')).toHaveValue('0°');
  await expect(numberBox(page, 'Tilt')).toHaveValue('0°');

  // A conic's own centre is what its resets return to.
  await pick(page, 'albers');
  await settle(page);
  await move(page, 'Longitude', -50);
  await reset('Reset longitude');
  expect((await orientation(page)).lon).toBe(10);
  await move(page, 'Longitude', -50);
  await reset('Reset all');
  expect((await orientation(page)).lon).toBe(10);
});

test('tilt snaps at 0 and 90 and is disabled on globe, azimuthals and conics', async ({ page }) => {
  await open(page);
  await pick(page, 'mollweide');
  await settle(page);
  await move(page, 'Tilt', 89);
  expect((await orientation(page)).tilt).toBe(90);
  await move(page, 'Tilt', 45);
  expect((await orientation(page)).tilt).toBe(45);
  await move(page, 'Tilt', 1);
  expect((await orientation(page)).tilt).toBe(0);
  await move(page, 'Tilt', 4);
  expect((await orientation(page)).tilt).toBe(4);
  // The keyboard moves one step at a time, off a stop too.
  await move(page, 'Tilt', 90);
  await slider(page, 'Tilt').focus();
  await page.keyboard.press('ArrowLeft');
  expect((await orientation(page)).tilt).toBe(89);

  for (const id of ['globe', 'gnomonic', 'stereographic', 'orthographic', 'azimuthal-equidistant', 'lambert-azimuthal', 'albers', 'lambert-conformal']) {
    await pick(page, id);
    await settle(page);
    await expect(slider(page, 'Tilt'), id).toBeDisabled();
    await expect(numberBox(page, 'Tilt'), id).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Reset tilt', exact: true }), id).toBeDisabled();
    await expect(slider(page, 'Longitude'), id).toBeEnabled();
  }
  for (const id of ['mercator', 'equirectangular', 'robinson', 'goode']) {
    await pick(page, id);
    await settle(page);
    await expect(slider(page, 'Tilt'), id).toBeEnabled();
  }
  // Why it is off is said, next to it.
  await pick(page, 'gnomonic');
  await settle(page);
  await expect(page.locator('.orientation .hint')).toBeVisible();
  await expect(page.getByRole('group', { name: 'Centre and tilt' })).toHaveAccessibleDescription(/spin/);
});

test('latitude is disabled on conics', async ({ page }) => {
  await open(page);
  for (const id of ['albers', 'lambert-conformal']) {
    await pick(page, id);
    await settle(page);
    await expect(slider(page, 'Latitude'), id).toBeDisabled();
    await expect(numberBox(page, 'Latitude'), id).toBeDisabled();
    await expect(slider(page, 'Longitude'), id).toBeEnabled();
    await expect(page.getByRole('group', { name: 'Centre and tilt' })).toHaveAccessibleDescription(/sideways/);
  }
  await pick(page, 'robinson');
  await settle(page);
  await expect(slider(page, 'Latitude')).toBeEnabled();
  await expect(page.locator('.orientation .hint')).toBeHidden();
});

test('dragging keeps the grabbed point under the cursor within 2 px on globe, Mercator and tilted Mollweide', async ({ page }) => {
  await open(page);
  // Each drag, from and to, relative to the middle of the map. All lie where the map can follow with tilt held.
  const cases: { id: string; tilt?: number; drags: [Pair, Pair][] }[] = [
    { id: 'globe', drags: [[[30, 20], [150, -60]], [[-50, -30], [-170, 90]], [[0, 0], [10, -160]]] },
    // A long diagonal drag on Mercator tips the centre over a pole, past which tilt held cannot follow.
    { id: 'mercator', drags: [[[-100, 50], [0, -10]], [[50, -100], [-20, 0]], [[0, 0], [200, 0]]] },
    { id: 'mollweide', tilt: 30, drags: [[[0, 0], [150, 60]], [[-80, 40], [60, -90]], [[100, -50], [-150, 20]]] },
  ];
  const report: string[] = [];
  for (const { id, tilt, drags } of cases) {
    await pick(page, id);
    await settle(page);
    if (tilt !== undefined) await move(page, 'Tilt', tilt);
    const middle = await centreOf(page);
    for (const [from, to] of drags) {
      // Each from the projection's own centre.
      await setOrientation(page, { lon: 0, lat: 0, tilt: tilt ?? 0 });
      const start: Pair = [middle[0] + from[0], middle[1] + from[1]];
      const grabbed = await under(page, start);
      expect(grabbed, `${id} grab at ${from}`).not.toBeNull();
      const tiltBefore = (await orientation(page)).tilt;
      await mouseTo(page, start);
      await page.mouse.down();
      let worst = 0;
      const steps = 20;
      for (let i = 1; i <= steps; i++) {
        const cursor: Pair = [start[0] + ((to[0] - from[0]) * i) / steps, start[1] + ((to[1] - from[1]) * i) / steps];
        await mouseTo(page, cursor);
        worst = Math.max(worst, dist(await whereIs(page, grabbed!), cursor));
      }
      await page.mouse.up();
      report.push(`${id} ${from} -> ${to}: worst ${worst.toFixed(3)} px`);
      expect(worst, `${id} ${from} -> ${to}`).toBeLessThan(2);
      expect((await orientation(page)).tilt).toBe(tiltBefore);
    }
  }
  console.log(report.join('\n'));
});

test('a drag moves the map only once the press has moved 4 px; a cursor off the map keeps the last orientation', async ({ page }) => {
  await open(page);
  await pick(page, 'mollweide');
  await settle(page);
  const middle = await centreOf(page);
  const before = await orientation(page);
  await mouseTo(page, middle);
  await page.mouse.down();
  await mouseTo(page, [middle[0] + 3, middle[1]]);
  expect(await orientation(page)).toEqual(before);
  await mouseTo(page, [middle[0] + 40, middle[1]]);
  const dragged = await orientation(page);
  expect(dragged.lon).toBeLessThan(before.lon);
  // Into the corner, which Mollweide's ellipse does not reach.
  await mouseTo(page, [4, 4]);
  expect(await orientation(page)).toEqual(dragged);
  await page.mouse.up();
  expect(await orientation(page)).toEqual(dragged);
});

test('tilt slider to 90 on Mercator highlights Transverse Mercator; moving away highlights Mercator', async ({ page }) => {
  await open(page);
  await pick(page, 'mercator');
  await settle(page);
  expect(await isCurrent(page, '[data-stop="mercator"]')).toBe(true);
  await move(page, 'Tilt', 89);
  expect(await isCurrent(page, '[data-stop="transverse-mercator"]')).toBe(true);
  expect(await isCurrent(page, '[data-stop="mercator"]')).toBe(false);
  await expect(page.locator('#note h3')).toHaveText('Transverse Mercator');
  await move(page, 'Tilt', 1);
  expect((await orientation(page)).tilt).toBe(0);
  expect(await isCurrent(page, '[data-stop="mercator"]')).toBe(true);
  expect(await isCurrent(page, '[data-stop="transverse-mercator"]')).toBe(false);
  await expect(page.locator('#note h3')).toHaveText('Mercator');
});

test('a tilted map keeps its name: Mercator and Mollweide at tilt 45', async ({ page }) => {
  await open(page);
  for (const [id, name, family] of [['mercator', 'Mercator', 'cylindrical'], ['mollweide', 'Mollweide', 'equal-area']]) {
    await pick(page, id!);
    await settle(page);
    await move(page, 'Tilt', 45);
    expect((await orientation(page)).tilt).toBe(45);
    expect(await isCurrent(page, `[data-stop="${id}"]`), id).toBe(true);
    await expect(page.locator(`[data-family="${family}"] [data-custom]`)).toBeHidden();
    await expect(page.locator('#note h3')).toHaveText(name!);
    // A drag, which can move the centre anywhere, keeps the name too.
    await setOrientation(page, { lon: -60, lat: 35, tilt: 45 });
    expect(await isCurrent(page, `[data-stop="${id}"]`), id).toBe(true);
  }
  // Custom is for parameters that match no stop.
  await pick(page, 'equirectangular');
  await settle(page);
  await move(page, 'Vertical spacing', 0.5);
  await expect(page.locator('[data-family="cylindrical"] [data-custom]')).toBeVisible();
});

test('resets return to the projection last chosen from the list, not the one highlighted', async ({ page }) => {
  await open(page);
  const reset = (name: string) => page.getByRole('button', { name, exact: true }).click();
  // Transverse Mercator chosen: its tilt is 90.
  await pick(page, 'transverse-mercator');
  await settle(page);
  await move(page, 'Tilt', 30);
  expect(await isCurrent(page, '[data-stop="mercator"]')).toBe(true);
  await reset('Reset tilt');
  expect((await orientation(page)).tilt).toBe(90);
  expect(await isCurrent(page, '[data-stop="transverse-mercator"]')).toBe(true);
  await setOrientation(page, { lon: 50, lat: -10, tilt: 20 });
  await reset('Reset all');
  expect(await orientation(page)).toEqual({ lon: 0, lat: 0, tilt: 90 });

  // Mercator chosen and tilted to 90 by slider: highlighted as Transverse Mercator, but its tilt is 0.
  await pick(page, 'mercator');
  await settle(page);
  await move(page, 'Tilt', 90);
  expect(await isCurrent(page, '[data-stop="transverse-mercator"]')).toBe(true);
  await reset('Reset tilt');
  expect((await orientation(page)).tilt).toBe(0);
  await move(page, 'Tilt', 90);
  await reset('Reset all');
  expect(await orientation(page)).toEqual({ lon: 0, lat: 0, tilt: 0 });
});

test('selecting Mercator from Transverse Mercator returns tilt to 0', async ({ page }) => {
  await open(page);
  await pick(page, 'transverse-mercator');
  await settle(page);
  await expect(slider(page, 'Tilt')).toHaveValue('90');
  await pick(page, 'mercator');
  expect((await orientation(page)).tilt).toBe(0);
  await settle(page);
  await expect(slider(page, 'Tilt')).toHaveValue('0');
  await expect(numberBox(page, 'Tilt')).toHaveValue('0°');
});

test('dragging during a morph does nothing, and the morph completes', async ({ page }) => {
  await openPaused(page);
  await pick(page, 'robinson');
  await page.clock.runFor(1500);
  expect(await isMorphing(page)).toBe(false);

  await pick(page, 'mollweide');
  await page.clock.runFor(100);
  expect(await isMorphing(page)).toBe(true);
  const before = await orientation(page);
  const middle = await centreOf(page);
  await mouseTo(page, middle);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await mouseTo(page, [middle[0] + 15 * i, middle[1] - 5 * i]);
  await page.mouse.up();
  expect(await orientation(page)).toEqual(before);
  // Sliders and typed values are ignored too, and show the map again.
  await move(page, 'Longitude', 77);
  await type(page, 'Tilt', '33');
  expect(await orientation(page)).toEqual(before);
  await expect(slider(page, 'Longitude')).toHaveValue(String(before.lon));
  await expect(numberBox(page, 'Tilt')).toHaveValue(`${before.tilt}°`);

  await page.clock.runFor(1500);
  expect(await isMorphing(page)).toBe(false);
  expect((await state(page)).defId).toBe('mollweide');
  expect(await orientation(page)).toEqual(before);
  // At rest, a drag works again.
  await mouseTo(page, middle);
  await page.mouse.down();
  await mouseTo(page, [middle[0] + 60, middle[1]]);
  await page.mouse.up();
  expect((await orientation(page)).lon).not.toBe(before.lon);
});

test('a morph that ends mid-drag leaves the map where it is, then the point under the cursor follows it', async ({ page }) => {
  await openPaused(page);
  await pick(page, 'robinson');
  await page.clock.runFor(1500);
  const middle = await centreOf(page);
  await mouseTo(page, middle);
  await page.mouse.down();
  await mouseTo(page, [middle[0] + 30, middle[1]]);
  const dragged = await orientation(page);
  expect(dragged.lon).not.toBe(0);

  await page.evaluate((s) => (window as any).__app.select(s), stop('mollweide'));
  await mouseTo(page, [middle[0] + 60, middle[1] + 10]);
  await page.clock.runFor(1500);
  expect(await isMorphing(page)).toBe(false);
  const ended = await orientation(page);
  expect(ended).toEqual(dragged);

  // The first move after the morph takes hold of what is under the cursor, without moving the map.
  const cursor: Pair = [middle[0] + 70, middle[1] + 10];
  await mouseTo(page, cursor);
  expect(await orientation(page)).toEqual(ended);
  const held = (await under(page, cursor))!;
  for (let i = 1; i <= 5; i++) {
    const next: Pair = [cursor[0] + 10 * i, cursor[1] - 6 * i];
    await mouseTo(page, next);
    expect(dist(await whereIs(page, held), next)).toBeLessThan(2);
  }

  // The same when the whole morph falls between two moves.
  const last: Pair = [cursor[0] + 50, cursor[1] - 30];
  const beforeMorph = await orientation(page);
  await page.evaluate((s) => (window as any).__app.select(s), stop('robinson'));
  await page.clock.runFor(1500);
  expect(await isMorphing(page)).toBe(false);
  const after: Pair = [last[0] - 10, last[1]];
  await mouseTo(page, after);
  expect(await orientation(page)).toEqual(beforeMorph);
  const heldAgain = (await under(page, after))!;
  await mouseTo(page, [after[0] - 20, after[1] + 10]);
  expect(dist(await whereIs(page, heldAgain), [after[0] - 20, after[1] + 10])).toBeLessThan(2);
  await page.mouse.up();
});

test('a click on the map is reported once; a click off the map, a drag, or a click during a morph is not', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openPaused(page);
  await recordClicks(page);
  const middle = await centreOf(page);
  const box = await canvasBox(page);

  // On the globe, the middle is on the map and the corner is not.
  await mouseTo(page, middle);
  await page.mouse.down();
  await page.mouse.up();
  expect(await clicks(page)).toEqual([middle]);
  await page.mouse.click(box.x + 3, box.y + 3);
  expect((await clicks(page)).length).toBe(1);
  // A press that moves under 4 px is still a click; one that moves further is a drag.
  await mouseTo(page, middle);
  await page.mouse.down();
  await mouseTo(page, [middle[0] + 3, middle[1]]);
  await page.mouse.up();
  expect((await clicks(page)).length).toBe(2);
  await mouseTo(page, middle);
  await page.mouse.down();
  await mouseTo(page, [middle[0] + 30, middle[1]]);
  await page.mouse.up();
  expect((await clicks(page)).length).toBe(2);

  await pick(page, 'mollweide');
  await page.clock.runFor(100);
  expect(await isMorphing(page)).toBe(true);
  await page.mouse.click(box.x + middle[0], box.y + middle[1]);
  expect((await clicks(page)).length).toBe(2);
  await page.clock.runFor(1500);
  await page.mouse.click(box.x + middle[0], box.y + middle[1]);
  expect((await clicks(page)).length).toBe(3);
  expect(errors).toEqual([]);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('a touch drag moves the map and does not scroll the page', async ({ page }) => {
    await open(page);
    await pick(page, 'mollweide');
    await settle(page);
    expect(await page.locator('#map').evaluate((c) => getComputedStyle(c).touchAction)).toBe('none');
    const box = await canvasBox(page);
    const middle = await centreOf(page);
    const grabbed = (await under(page, middle))!;
    const scrolled = () => page.evaluate(() => [window.scrollY, document.querySelector('#sidebar')!.scrollTop]);
    const scrollBefore = await scrolled();
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', xy: Pair) =>
      cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: box.x + xy[0], y: box.y + xy[1] }] });
    await touch('touchStart', middle);
    const to: Pair = [middle[0] - 20, middle[1] + 80];
    for (let i = 1; i <= 10; i++) await touch('touchMove', [middle[0] + ((to[0] - middle[0]) * i) / 10, middle[1] + ((to[1] - middle[1]) * i) / 10]);
    // A touch is handled after the call that sends it returns: one frame later, it has been.
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    expect(dist(await whereIs(page, grabbed), to)).toBeLessThan(2);
    await touch('touchEnd', to);
    expect(await scrolled()).toEqual(scrollBefore);
  });
});

test('a press whose end never arrives does not block the drag after it', async ({ page }) => {
  // The canvas can be made to miss the end of a press, as it does when a context menu opens over it.
  await page.addInitScript(() => {
    const add = HTMLCanvasElement.prototype.addEventListener;
    HTMLCanvasElement.prototype.addEventListener = function (type: string, listener: any, options?: any) {
      const ends = ['pointerup', 'pointercancel', 'lostpointercapture'];
      const wrapped = ends.includes(type) ? (e: Event) => (window as any).__dropEnds || listener.call(this, e) : listener;
      return add.call(this, type, wrapped, options);
    };
  });
  await open(page);
  await pick(page, 'robinson');
  await settle(page);
  const middle = await centreOf(page);
  const before = await orientation(page);

  // A touch has an id of its own each time, so a press that never ended cannot be mistaken for the next.
  const cdp = await page.context().newCDPSession(page);
  const box = await canvasBox(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', at?: Pair) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: at ? [{ x: box.x + at[0], y: box.y + at[1] }] : [] });

  await page.evaluate(() => ((window as any).__dropEnds = true));
  await touch('touchStart', middle);
  await touch('touchEnd');
  await page.evaluate(() => ((window as any).__dropEnds = false));

  await touch('touchStart', middle);
  for (let i = 1; i <= 6; i++) await touch('touchMove', [middle[0] + 10 * i, middle[1] + 3 * i]);
  await touch('touchEnd');
  expect(await orientation(page)).not.toEqual(before);
});
