import { expect, test, type Page } from '@playwright/test';
import { stops } from '../src/projections/catalog';
import { compile } from '../src/projections/compile';
import { isCovered, projectPoint } from '../src/screen/screen';
import type { LonLat, ProjectionState } from '../src/projections/types';
import { MAP_STYLE } from '../src/render/draw';
import { similarity } from '../tests/similarity';

const stop = (id: string) => stops.find((s) => s.id === id)!;

const open = async (page: Page) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__app !== undefined);
};

/** Opens the app on a clock that only moves when told to, and leaves it paused. */
const openPaused = async (page: Page) => {
  await page.clock.install({ time: 1000 });
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__app !== undefined);
  await page.clock.pauseAt(60_000);
  await page.clock.runFor(32);
};

const head = (page: Page, family: string) => page.locator(`[data-family="${family}"] > .family-head`);
const stopButton = (page: Page, id: string) => page.locator(`[data-stop="${id}"]`);
const slider = (page: Page, name: string) => page.getByRole('slider', { name, exact: true });
const settle = (page: Page) => page.waitForFunction(() => !(window as any).__app.isMorphing);
const isMorphing = (page: Page): Promise<boolean> => page.evaluate(() => (window as any).__app.isMorphing);
const state = (page: Page): Promise<ProjectionState> => page.evaluate(() => JSON.parse(JSON.stringify((window as any).__app.state)));

/** Clicks a named projection in its family, opening the family first as a person would. */
async function pick(page: Page, id: string) {
  const family = stop(id).family;
  if ((await head(page, family).getAttribute('aria-expanded')) !== 'true') await head(page, family).click();
  await stopButton(page, id).click();
}

/** Moves a slider the way the browser does: set a value and fire `input`. */
const move = (page: Page, name: string, value: number) =>
  slider(page, name).evaluate((el: HTMLInputElement, v) => {
    el.value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);

const isCurrent = (page: Page, selector: string) => page.locator(selector).getAttribute('aria-current').then((v) => v === 'true');

/** A moment of the map: its state and the screen fit it is drawn with. */
const snapshot = (page: Page) => page.evaluate(() => {
  const a = (window as any).__app;
  return { state: JSON.parse(JSON.stringify(a.state)) as ProjectionState, screen: a.controller.source()[0].screen };
});

const GRID: LonLat[] = [];
for (let lat = -60; lat <= 80; lat += 10) for (let lon = -165; lon <= 175; lon += 20) GRID.push([lon, lat]);

/** Where both maps put the points that both show. */
function bothShow(a: Awaited<ReturnType<typeof snapshot>>, b: Awaited<ReturnType<typeof snapshot>>) {
  const [ca, cb] = [compile(a.state), compile(b.state)];
  const shown = GRID.filter((p) => isCovered(ca, p) && isCovered(cb, p));
  return { a: shown.map((p) => projectPoint(ca, a.screen, p)), b: shown.map((p) => projectPoint(cb, b.screen, p)), count: shown.length };
}

test('clicking a family opens it and shows only its sliders', async ({ page }) => {
  await open(page);
  // The app opens on the globe, with its family open and no sliders.
  await expect(head(page, 'globe')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('slider')).toHaveCount(0);

  await head(page, 'azimuthal').click();
  await expect(head(page, 'azimuthal')).toHaveAttribute('aria-expanded', 'true');
  await expect(head(page, 'globe')).toHaveAttribute('aria-expanded', 'false');
  await expect(stopButton(page, 'gnomonic')).toBeVisible();
  await expect(stopButton(page, 'mercator')).toBeHidden();
  await expect(slider(page, 'Viewpoint')).toBeVisible();
  await expect(page.getByRole('slider')).toHaveCount(1);

  await head(page, 'cylindrical').click();
  await expect(slider(page, 'Viewpoint')).toBeHidden();
  await expect(slider(page, 'Standard parallel')).toBeVisible();
  await expect(slider(page, 'Vertical spacing')).toBeVisible();
  await expect(page.getByRole('slider')).toHaveCount(2);

  await head(page, 'conic').click();
  await expect(page.getByRole('slider')).toHaveCount(2);
  await expect(slider(page, 'First parallel')).toBeVisible();
  await expect(slider(page, 'Second parallel')).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Conformal' })).toBeVisible();

  // Opening a family does not change the map.
  expect((await state(page)).defId).toBe('globe');
  await head(page, 'equal-area').click();
  await expect(page.getByRole('slider')).toHaveCount(0);
});

test('clicking Mollweide morphs: state changes at once, canvas settles after 1400 ms', async ({ page }) => {
  await openPaused(page);
  const pixelAt = (x: number, y: number) => page.evaluate(([x, y]) => {
    const canvas = document.querySelector<HTMLCanvasElement>('#map')!;
    const ratio = canvas.width / canvas.clientWidth;
    return [...canvas.getContext('2d')!.getImageData(Math.round(x! * ratio), Math.round(y! * ratio), 1, 1).data.slice(0, 3)];
  }, [x, y]);
  const background = [1, 3, 5].map((i) => parseInt(MAP_STYLE.background.slice(i, i + 2), 16));
  expect(await pixelAt(20, 300)).toEqual(background);

  await pick(page, 'mollweide');
  expect((await state(page)).defId).toBe('mollweide');
  await expect(stopButton(page, 'mollweide')).toHaveAttribute('aria-current', 'true');
  expect(await isMorphing(page)).toBe(true);
  await page.clock.runFor(700);
  expect(await isMorphing(page)).toBe(true);
  await page.clock.runFor(800);
  expect(await isMorphing(page)).toBe(false);
  await page.clock.runFor(32);
  // Mollweide's ellipse reaches the padding at its middle row and not at its top corner.
  expect(await pixelAt(20, 300)).not.toEqual(background);
  expect(await pixelAt(20, 40)).toEqual(background);
});

test('moving the spacing slider to 0 highlights Mercator; 0.5 shows Custom', async ({ page }) => {
  await open(page);
  await pick(page, 'equirectangular');
  await settle(page);
  expect(await isCurrent(page, '[data-stop="equirectangular"]')).toBe(true);

  await move(page, 'Vertical spacing', 0);
  expect((await state(page)).params.spacing).toBe(0);
  expect(await isCurrent(page, '[data-stop="mercator"]')).toBe(true);
  await expect(page.locator('#note h3')).toHaveText('Mercator');

  await move(page, 'Vertical spacing', 0.5);
  expect((await state(page)).params.spacing).toBe(0.5);
  await expect(page.locator('[data-family="cylindrical"] [data-custom]')).toBeVisible();
  await expect(page.locator('[data-family="cylindrical"] [data-custom]')).toHaveText('Custom');
  await expect(page.locator('[data-stop="mercator"]')).not.toHaveAttribute('aria-current', 'true');
  await expect(page.locator('#note h3')).toHaveText('Custom');

  // It snaps to a named stop that it is moved close to, and the typed value and reset work too.
  await move(page, 'Vertical spacing', 1.98);
  expect((await state(page)).params.spacing).toBe(2);
  expect(await isCurrent(page, '[data-stop="lambert-cylindrical"]')).toBe(true);
  await move(page, 'Standard parallel', 44);
  expect(await isCurrent(page, '[data-stop="gall-peters"]')).toBe(true);
  const number = page.getByRole('textbox', { name: 'Standard parallel, value' });
  await number.fill('30');
  await number.press('Enter');
  expect(await isCurrent(page, '[data-stop="behrmann"]')).toBe(true);
  await page.getByRole('button', { name: 'Reset standard parallel' }).click();
  expect((await state(page)).params.phi0).toBe(0);
  expect(await isCurrent(page, '[data-stop="lambert-cylindrical"]')).toBe(true);
});

test('moving the viewpoint slider through gnomonic, stereographic and orthographic highlights each', async ({ page }) => {
  await open(page);
  await pick(page, 'stereographic');
  await settle(page);
  expect(await isCurrent(page, '[data-stop="stereographic"]')).toBe(true);
  await expect(page.getByRole('textbox', { name: 'Viewpoint, value' })).toHaveValue('1');

  await move(page, 'Viewpoint', 0.01);
  expect(await isCurrent(page, '[data-stop="gnomonic"]')).toBe(true);
  expect((await state(page)).params.x).toBe(0);
  await move(page, 'Viewpoint', 0.51);
  expect(await isCurrent(page, '[data-stop="stereographic"]')).toBe(true);
  await move(page, 'Viewpoint', 0.99);
  expect(await isCurrent(page, '[data-stop="orthographic"]')).toBe(true);
  await expect(page.getByRole('textbox', { name: 'Viewpoint, value' })).toHaveValue('∞');
  await move(page, 'Viewpoint', 0.25);
  await expect(page.locator('[data-family="azimuthal"] [data-custom]')).toBeVisible();

  // The plain azimuthals are not perspective views: the slider is off for them.
  await pick(page, 'azimuthal-equidistant');
  await expect(slider(page, 'Viewpoint')).toBeDisabled();
});

test('moving Albers parallels to 45/-45 highlights Gall-Peters with the conic indication', async ({ page }) => {
  await open(page);
  await pick(page, 'albers');
  await settle(page);
  expect(await isCurrent(page, '[data-stop="albers"]')).toBe(true);
  await expect(page.locator('.limits-reached')).toBeHidden();

  await move(page, 'First parallel', 45);
  await move(page, 'Second parallel', -45);
  expect(await isCurrent(page, '[data-limit="gall-peters"]')).toBe(true);
  expect(await isCurrent(page, '[data-stop="albers"]')).toBe(false);
  await expect(page.locator('.limits-reached')).toBeVisible();
  await expect(page.locator('#note h3')).toHaveText('Gall-Peters, reached from the conic sliders');
  expect((await state(page)).defId).toBe('conic-equal-area');

  // The switch keeps the parallels and gives the conformal conic, which is Mercator here.
  await page.getByRole('radio', { name: 'Conformal' }).check();
  expect((await state(page)).defId).toBe('conic-conformal');
  expect(await isCurrent(page, '[data-limit="mercator"]')).toBe(true);

  // Both parallels to the pole make a disc, and the slider stops there.
  await move(page, 'First parallel', 100);
  await move(page, 'Second parallel', 100);
  expect((await state(page)).params).toEqual({ p1: 89.9, p2: 89.9 });
  expect(await isCurrent(page, '[data-limit="stereographic"]')).toBe(true);
  await page.getByRole('radio', { name: 'Equal-area' }).check();
  expect(await isCurrent(page, '[data-limit="lambert-azimuthal"]')).toBe(true);

  // Anything between is custom; reset returns to the conic's own parallels.
  await move(page, 'First parallel', 60);
  await expect(page.locator('[data-family="conic"] [data-custom]')).toBeVisible();
  await page.getByRole('button', { name: 'Reset first parallel' }).click();
  await page.getByRole('button', { name: 'Reset second parallel' }).click();
  expect(await isCurrent(page, '[data-stop="albers"]')).toBe(true);
});

test('slider reaching a stop gives the same map as selecting it, by comparing positions', async ({ page }) => {
  await open(page);
  // Same projection, so the positions are the very same.
  const viaSlider = async (start: string, name: string, value: number, target: string) => {
    await pick(page, start);
    await settle(page);
    await move(page, name, value);
    const reached = await snapshot(page);
    await pick(page, target);
    await settle(page);
    const selected = await snapshot(page);
    const { a, b, count } = bothShow(reached, selected);
    expect(count, target).toBeGreaterThan(60);
    a.forEach((p, i) => {
      expect(Math.abs(p[0] - b[i]![0]) + Math.abs(p[1] - b[i]![1]), `${target} ${GRID[i]}`).toBeLessThan(0.01);
    });
  };
  await viaSlider('equirectangular', 'Vertical spacing', 0, 'mercator');
  await viaSlider('mercator', 'Vertical spacing', 2, 'lambert-cylindrical');
  await viaSlider('lambert-cylindrical', 'Standard parallel', 45, 'gall-peters');
  await viaSlider('stereographic', 'Viewpoint', 0, 'gnomonic');
  await viaSlider('gnomonic', 'Viewpoint', 1, 'orthographic');
});

test('a conic slider reaching a limit gives the same map as selecting what it becomes, up to turning, shift and scale', async ({ page }) => {
  await open(page);
  const viaConic = async (conic: string, p1: number, p2: number, target: string, pole = false) => {
    await pick(page, 'globe');
    await settle(page);
    await pick(page, conic);
    await settle(page);
    await move(page, 'First parallel', p1);
    await move(page, 'Second parallel', p2);
    const reached = await snapshot(page);
    await pick(page, target);
    await settle(page);
    // A polar view is centred on the pole.
    if (pole) await page.evaluate(() => (window as any).__app.setLive({ orientation: { lon: 0, lat: 90, tilt: 0 } }));
    const selected = await snapshot(page);
    const { a, b, count } = bothShow(reached, selected);
    expect(count, target).toBeGreaterThan(100);
    // The same size once fitted: both show the same part of the world.
    const { error, scale } = similarity(a, b);
    expect(error, target).toBeLessThan(0.01);
    expect(scale, `${target} scale`).toBeGreaterThan(0.99);
    expect(scale, `${target} scale`).toBeLessThan(1.01);
  };
  await viaConic('lambert-conformal', 0, 0, 'mercator');
  await viaConic('albers', 0, 0, 'lambert-cylindrical');
  await viaConic('albers', 45, -45, 'gall-peters');
  await viaConic('lambert-conformal', 100, 100, 'stereographic', true);
  await viaConic('albers', 100, 100, 'lambert-azimuthal', true);
});

test('rapid clicks across 5 projections settle on the last with no console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await open(page);

  for (const id of ['mollweide', 'goode', 'albers', 'gnomonic', 'robinson']) await pick(page, id);
  expect((await state(page)).defId).toBe('robinson');
  await settle(page);
  await expect(stopButton(page, 'robinson')).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('[aria-current="true"].stop')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('slider input during a morph is ignored, the slider shows the map again, and the morph completes', async ({ page }) => {
  await openPaused(page);
  await pick(page, 'equirectangular');
  await page.clock.runFor(1500);
  expect(await isMorphing(page)).toBe(false);

  await pick(page, 'mercator');
  await page.clock.runFor(100);
  expect(await isMorphing(page)).toBe(true);
  await move(page, 'Vertical spacing', 2);
  expect((await state(page)).params.spacing).toBe(0);
  await expect(slider(page, 'Vertical spacing')).toHaveValue('0');
  expect(await isMorphing(page)).toBe(true);

  await page.clock.runFor(1500);
  expect(await isMorphing(page)).toBe(false);
  expect((await state(page)).params.spacing).toBe(0);
  await expect(slider(page, 'Vertical spacing')).toHaveValue('0');
  expect(await isCurrent(page, '[data-stop="mercator"]')).toBe(true);
  // Once at rest, the slider works again.
  await move(page, 'Vertical spacing', 1);
  expect((await state(page)).params.spacing).toBe(1);
});

test('conic round trip restores the centre: set lon 50, go to Albers and back, lon is 50', async ({ page }) => {
  await open(page);
  const lon = async () => (await state(page)).orientation.lon;
  const setLon = (v: number) => page.evaluate((v) => (window as any).__app.setLive({ orientation: { ...(window as any).__app.state.orientation, lon: v } }), v);

  await setLon(50);
  await pick(page, 'albers');
  expect(await lon()).toBe(10);
  await settle(page);
  // Dragged sideways on a conic, the longitude stays through another conic, and is the conic's when leaving it for a map that follows.
  await setLon(70);
  await pick(page, 'lambert-conformal');
  expect(await lon()).toBe(70);
  await settle(page);
  await pick(page, 'globe');
  expect(await lon()).toBe(50);
  await settle(page);
  // Between maps that are not conic the centre carries over.
  await setLon(-30);
  await pick(page, 'robinson');
  expect(await lon()).toBe(-30);
});

test('a tilt set by hand carries over; the 90 degrees of Transverse Mercator does not', async ({ page }) => {
  await open(page);
  const tilt = async () => (await state(page)).orientation.tilt;
  const setTilt = (v: number) => page.evaluate((v) => (window as any).__app.setLive({ orientation: { ...(window as any).__app.state.orientation, tilt: v } }), v);

  await pick(page, 'robinson');
  await settle(page);
  await setTilt(40);
  await pick(page, 'mercator');
  expect(await tilt()).toBe(40);
  await settle(page);
  await pick(page, 'globe');
  expect(await tilt()).toBe(0);
  await settle(page);
  await pick(page, 'robinson');
  expect(await tilt()).toBe(0);
  await settle(page);

  await pick(page, 'transverse-mercator');
  expect(await tilt()).toBe(90);
  await settle(page);
  await pick(page, 'robinson');
  expect(await tilt()).toBe(0);
  await settle(page);

  // Put there by hand, 90 stays; Mercator is Transverse Mercator turned back.
  await pick(page, 'mercator');
  await settle(page);
  await setTilt(90);
  expect(await isCurrent(page, '[data-stop="transverse-mercator"]')).toBe(true);
  await pick(page, 'equirectangular');
  expect(await tilt()).toBe(90);
  await settle(page);
  // Tilted so, equirectangular is a custom map, and Mercator takes the tilt on; the highlighted Transverse Mercator is turned back by Mercator.
  await pick(page, 'mercator');
  expect(await tilt()).toBe(90);
  await settle(page);
  expect(await isCurrent(page, '[data-stop="transverse-mercator"]')).toBe(true);
  await pick(page, 'mercator');
  expect(await tilt()).toBe(0);
});

test('every projection shows its note, Equal Earth names the UN resolution, and the Tissot toggle explains itself', async ({ page }) => {
  await open(page);
  for (const s of stops) {
    await pick(page, s.id);
    await expect(page.locator('#note h3')).toHaveText(s.name);
    await expect(page.locator('#note p')).toHaveText(s.note);
  }
  await pick(page, 'equal-earth');
  const text = await page.locator('#note p').innerText();
  expect(text).toContain('UN General Assembly');
  expect(text).toContain('September 2026');
  expect(text).toContain('Correct the Map');
  expect(text).toContain('non-binding');
  expect(text).not.toMatch(/\bban/i);

  const toggle = page.getByRole('checkbox', { name: 'Tissot indicatrices' });
  await expect(page.locator('#tissot-note')).toContainText('tiny circle');
  await expect(page.locator('#tissot-note')).toContainText('real circles');
  expect(await page.evaluate(() => (window as any).__app.tissot)).toBe(false);
  await toggle.check();
  expect(await page.evaluate(() => (window as any).__app.tissot)).toBe(true);
  await toggle.uncheck();
  expect(await page.evaluate(() => (window as any).__app.tissot)).toBe(false);
  // The store can change it too, and the toggle follows.
  await page.evaluate(() => (window as any).__app.setTissot(true));
  await expect(toggle).toBeChecked();
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('no horizontal scroll, a map above the controls, and the controls reach every family', async ({ page }) => {
    await open(page);
    const layout = () => page.evaluate(() => {
      const box = (s: string) => document.querySelector(s)!.getBoundingClientRect();
      return {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        canvas: box('#map'),
        sidebar: box('#sidebar'),
        sidebarScrolls: document.querySelector('#sidebar')!.scrollHeight > document.querySelector('#sidebar')!.clientHeight,
      };
    });
    let l = await layout();
    expect(l.scrollWidth).toBeLessThanOrEqual(l.clientWidth);
    expect(l.canvas.width).toBe(390);
    expect(l.canvas.height).toBeGreaterThan(300);
    expect(l.sidebar.top).toBeGreaterThanOrEqual(l.canvas.bottom - 1);
    expect(l.sidebar.bottom).toBeLessThanOrEqual(844);

    await head(page, 'conic').click();
    await expect(slider(page, 'First parallel')).toBeVisible();
    await slider(page, 'First parallel').scrollIntoViewIfNeeded();
    await page.locator('#tissot-note').scrollIntoViewIfNeeded();
    await expect(page.getByRole('checkbox', { name: 'Tissot indicatrices' })).toBeVisible();
    l = await layout();
    expect(l.sidebarScrolls).toBe(true);
    expect(l.scrollWidth).toBeLessThanOrEqual(l.clientWidth);

    await pick(page, 'mollweide');
    await settle(page);
    expect((await state(page)).defId).toBe('mollweide');
    // The map was refitted to the narrower canvas.
    expect(await page.evaluate(() => (window as any).__app.viewport.width)).toBe(390);
  });
});
