import { expect, test, type Page } from '@playwright/test';
import { stops } from '../src/projections/catalog';
import { compile } from '../src/projections/compile';
import { isCovered, projectPoint } from '../src/screen/screen';
import type { LonLat, ProjectionState } from '../src/projections/types';
import { mapStyle } from '../src/render/style';
import { similarity } from '../tests/similarity';
import { isCurrent, isMorphing, move, numberBox, open, openPaused, pick, settle, slider, state, stopButton, type, mapName } from './support';

// The tests run in light mode, as the browser is told to, unless one says otherwise.
const LIGHT_STYLE = mapStyle('light');

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

/** The sliders in the projection list, not the centre and tilt ones below it. */
test('clicking Mollweide morphs: state changes at once, canvas settles after 1400 ms', async ({ page }) => {
  await openPaused(page);
  const pixelAt = (x: number, y: number) => page.evaluate(([x, y]) => {
    const canvas = document.querySelector<HTMLCanvasElement>('#map')!;
    const ratio = canvas.width / canvas.clientWidth;
    return [...canvas.getContext('2d')!.getImageData(Math.round(x! * ratio), Math.round(y! * ratio), 1, 1).data.slice(0, 3)];
  }, [x, y]);
  const background = [1, 3, 5].map((i) => parseInt(LIGHT_STYLE.background.slice(i, i + 2), 16));
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
  await expect(mapName(page)).toHaveText('Mercator');

  await move(page, 'Vertical spacing', 0.5);
  expect((await state(page)).params.spacing).toBe(0.5);
  await expect(page.locator('[data-stop="mercator"]')).not.toHaveAttribute('aria-current', 'true');
  await expect(mapName(page)).toHaveText('Custom');

  // It snaps to a named stop that it is moved close to, and the typed value and reset work too.
  await move(page, 'Vertical spacing', 1.98);
  expect((await state(page)).params.spacing).toBe(2);
  expect(await isCurrent(page, '[data-stop="lambert-cylindrical"]')).toBe(true);
  await move(page, 'Standard parallel', 44);
  expect(await isCurrent(page, '[data-stop="gall-peters"]')).toBe(true);
  const number = page.getByRole('textbox', { name: 'Standard parallel, value' });
  await number.fill('30');
  await number.press('Enter');
  await settle(page);
  expect(await isCurrent(page, '[data-stop="behrmann"]')).toBe(true);
  await page.getByRole('button', { name: 'Reset standard parallel' }).click();
  await settle(page);
  expect((await state(page)).params.phi0).toBe(0);
  expect(await isCurrent(page, '[data-stop="lambert-cylindrical"]')).toBe(true);
});

test('moving the viewpoint slider through gnomonic and stereographic highlights each, and at its far end the map is the globe', async ({ page }) => {
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
  // Seen from infinitely far it is the orthographic view, which is the globe: the heading says so, and the list marks neither.
  await expect(mapName(page)).toHaveText('Globe (slider limit)');
  expect(await isCurrent(page, '[data-stop="globe"]')).toBe(false);
  await expect(page.getByRole('textbox', { name: 'Viewpoint, value' })).toHaveValue('∞');
  await move(page, 'Viewpoint', 0.25);
  await expect(mapName(page)).toHaveText('Custom');

  // The plain azimuthals are not perspective views: they have no such slider.
  await pick(page, 'azimuthal-equidistant');
  await expect(slider(page, 'Viewpoint')).toHaveCount(0);
});

test('moving Albers parallels to 45/-45 highlights Gall-Peters with the conic indication', async ({ page }) => {
  await open(page);
  await pick(page, 'albers');
  await settle(page);
  expect(await isCurrent(page, '[data-stop="albers"]')).toBe(true);
  await expect(mapName(page)).toHaveText('Albers');

  await move(page, 'First parallel', 45);
  await move(page, 'Second parallel', -45);
  // It has become Gall-Peters, which the heading says; the list marks neither the conic nor the cylindrical map.
  await expect(mapName(page)).toHaveText('Gall-Peters (cone limit)');
  expect(await isCurrent(page, '[data-stop="albers"]')).toBe(false);
  expect(await isCurrent(page, '[data-stop="gall-peters"]')).toBe(false);
  expect((await state(page)).defId).toBe('conic-equal-area');

  // The switch keeps the parallels and gives the conformal conic, which is Mercator here.
  await page.getByRole('radio', { name: 'Conformal' }).check();
  expect((await state(page)).defId).toBe('conic-conformal');
  // Two formulas, so the map morphs from one to the other.
  expect(await isMorphing(page)).toBe(true);
  await settle(page);
  await expect(mapName(page)).toHaveText('Mercator (cone limit)');

  // Both parallels to the pole make a disc, and the slider stops there.
  await move(page, 'First parallel', 100);
  await move(page, 'Second parallel', 100);
  expect((await state(page)).params).toEqual({ p1: 89.9, p2: 89.9 });
  await expect(mapName(page)).toHaveText('Stereographic (cone limit)');
  await page.getByRole('radio', { name: 'Equal-area' }).check();
  await settle(page);
  await expect(mapName(page)).toHaveText('Lambert azimuthal equal-area (cone limit)');

  // Anything between is custom; reset returns to the conic's own parallels.
  await move(page, 'First parallel', 60);
  await expect(mapName(page)).toHaveText('Custom');
  await page.getByRole('button', { name: 'Reset first parallel' }).click();
  await settle(page);
  await page.getByRole('button', { name: 'Reset second parallel' }).click();
  await settle(page);
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
  // The far end of the viewpoint is the globe from infinitely far.
  await viaSlider('gnomonic', 'Viewpoint', 1, 'globe');
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

test('arrow keys move a slider off a stop by one step, forward when forward and back when back', async ({ page }) => {
  await open(page);
  // Each starts on a stop it snaps to: Behrmann's 30 degrees, equirectangular's spacing 1, stereographic's 0.5,
  // and a conic parallel at the equator and at the pole.
  const cases: { start: string; name: string; key: string; step: number; at?: number }[] = [
    { start: 'behrmann', name: 'Standard parallel', key: 'phi0', step: 0.5 },
    { start: 'equirectangular', name: 'Vertical spacing', key: 'spacing', step: 0.01 },
    { start: 'stereographic', name: 'Viewpoint', key: 'x', step: 0.005 },
    { start: 'albers', name: 'First parallel', key: 'p1', step: 0.1, at: 0 },
    { start: 'albers', name: 'First parallel', key: 'p1', step: 0.1, at: 89.9 },
  ];
  for (const { start, name, key, step, at } of cases) {
    await pick(page, start);
    await settle(page);
    if (at !== undefined) await type(page, name, String(at));
    const value = async () => (await state(page)).params[key]!;
    const first = await value();
    await slider(page, name).focus();
    const atTop = at === 89.9;
    const [forward, backward] = atTop ? ['ArrowLeft', 'ArrowRight'] : ['ArrowRight', 'ArrowLeft'];
    const sign = atTop ? -1 : 1;
    let last = first;
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press(forward);
      const now = await value();
      expect(now, `${name} from ${first}, press ${i + 1}`).toBeCloseTo(last + sign * step, 6);
      last = now;
    }
    // And back, past where it started and on to the other side; a slider at its end can only come back to it.
    for (let i = 0; i < (atTop ? 8 : 12); i++) {
      await page.keyboard.press(backward);
      const now = await value();
      expect(now, `${name} back, press ${i + 1}`).toBeCloseTo(last - sign * step, 6);
      last = now;
    }
    // What the box shows is what the map took.
    expect((await state(page)).params[key]).toBeCloseTo(last, 6);
  }

  // From a value near a stop, but not on it, it still goes the way it was pushed: 31 with a stop at 30.
  await pick(page, 'behrmann');
  await settle(page);
  await type(page, 'Standard parallel', '31');
  await slider(page, 'Standard parallel').focus();
  await page.keyboard.press('ArrowRight');
  expect((await state(page)).params.phi0).toBe(31.5);
  // Dragging or setting a value without the keyboard still snaps, once the keys are let go.
  await move(page, 'Standard parallel', 44);
  expect((await state(page)).params.phi0).toBe(45);
});

test('typed values: bad ones revert, out-of-range ones clamp, and the box shows the value the map took', async ({ page }) => {
  await open(page);
  const params = async () => (await state(page)).params;
  const shows = async (name: string) => numberBox(page, name).inputValue();

  await pick(page, 'albers');
  await settle(page);
  for (const bad of ['abc', '', '   ', '12abc', 'Infinity']) {
    await type(page, 'First parallel', bad);
    expect((await params()).p1, `"${bad}"`).toBe(29.5);
    expect(await shows('First parallel'), `"${bad}"`).toBe('29.5°');
  }
  await type(page, 'First parallel', '999');
  expect((await params()).p1).toBe(89.9);
  expect(await shows('First parallel')).toBe('89.9°');
  await expect(slider(page, 'First parallel')).toHaveValue('89.9');
  await type(page, 'Second parallel', '-999°');
  expect((await params()).p2).toBe(-89.9);
  expect(await shows('Second parallel')).toBe('-89.9°');
  await type(page, 'First parallel', '45 °');
  expect((await params()).p1).toBe(45);

  await pick(page, 'equirectangular');
  await settle(page);
  await type(page, 'Vertical spacing', '5');
  expect((await params()).spacing).toBe(2);
  expect(await shows('Vertical spacing')).toBe('2');
  await type(page, 'Vertical spacing', '-1');
  expect((await params()).spacing).toBe(0);
  expect(await shows('Vertical spacing')).toBe('0');
  // A value between two steps of the slider is taken as typed and shown as typed, not as the thumb's nearest step.
  await type(page, 'Standard parallel', '30.25');
  expect((await params()).phi0).toBe(30.25);
  expect(await shows('Standard parallel')).toBe('30.25°');
  await type(page, 'Standard parallel', '12abc');
  expect((await params()).phi0).toBe(30.25);
  expect(await shows('Standard parallel')).toBe('30.25°');

  await pick(page, 'stereographic');
  await settle(page);
  for (const [text, x, shown] of [['inf', 1, '∞'], ['∞', 1, '∞'], ['3', 0.75, '3'], ['-3', 0, '0'], ['0', 0, '0']] as const) {
    await type(page, 'Viewpoint', text);
    expect((await params()).x, text).toBe(x);
    expect(await shows('Viewpoint'), text).toBe(shown);
  }
  for (const bad of ['abc', '', '-inf']) {
    await type(page, 'Viewpoint', bad);
    expect((await params()).x, `"${bad}"`).toBe(0);
    expect(await shows('Viewpoint'), `"${bad}"`).toBe('0');
  }
});

test('each slider is labelled by its visible label, and the viewpoint reads out its distance and name', async ({ page }) => {
  await open(page);
  await pick(page, 'stereographic');
  await settle(page);
  const labelled = await page.evaluate(() => [...document.querySelectorAll<HTMLInputElement>('.slider-range')].map((r) => [r.labels?.[0]?.textContent ?? '', r.labels?.[0]?.classList.contains('slider-label') ?? false]));
  // The viewpoint, and longitude and latitude.
  expect(labelled.length).toBe(3);
  for (const [text, isLabel] of labelled) {
    expect(text).not.toBe('');
    expect(isLabel).toBe(true);
  }
  const viewpoint = slider(page, 'Viewpoint');
  await expect(viewpoint).toHaveAttribute('aria-valuetext', 'P = 1, stereographic');
  await move(page, 'Viewpoint', 0);
  await expect(viewpoint).toHaveAttribute('aria-valuetext', 'P = 0, gnomonic');
  await move(page, 'Viewpoint', 1);
  await expect(viewpoint).toHaveAttribute('aria-valuetext', 'P = ∞, orthographic');
  await move(page, 'Viewpoint', 0.25);
  await expect(viewpoint).toHaveAttribute('aria-valuetext', 'P = 0.333');
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
  // From another definition, so that it is a morph and not a slide, which a slider takes over.
  await pick(page, 'mollweide');
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
  // Tilted so, equirectangular keeps its name, and Mercator takes the tilt on; the highlighted Transverse Mercator is turned back by Mercator.
  await pick(page, 'mercator');
  expect(await tilt()).toBe(90);
  await settle(page);
  expect(await isCurrent(page, '[data-stop="transverse-mercator"]')).toBe(true);
  await pick(page, 'mercator');
  await settle(page);
  expect(await tilt()).toBe(0);
});

test('every projection is named over its parameters and has its note as a tip, Equal Earth names the UN resolution, and the Tissot layer explains itself', async ({ page }) => {
  await open(page);
  for (const s of stops) {
    await pick(page, s.id);
    await expect(mapName(page)).toHaveText(s.name);
    await expect(stopButton(page, s.id)).toHaveAttribute('aria-description', s.note);
  }
  const text = (await stopButton(page, 'equal-earth').getAttribute('aria-description'))!;
  expect(text).toContain('UN General Assembly');
  expect(text).toContain('September 2026');
  expect(text).toContain('Correct the Map');
  expect(text).toContain('non-binding');
  expect(text).not.toMatch(/\bban/i);

  // The indicatrices are a layer: its box, in the Layers panel, says what they are, and follows the store.
  await page.getByRole('button', { name: 'Layers and colours' }).click();
  const toggle = page.locator('#layers-panel').getByRole('checkbox', { name: 'Tissot indicatrices' });
  await expect(page.locator('#layers-panel label.layer', { hasText: 'Tissot indicatrices' })).toHaveAttribute('aria-description', /small circle on the globe/);
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  expect(await page.evaluate(() => (window as any).__app.tissot)).toBe(true);
  await toggle.uncheck();
  expect(await page.evaluate(() => (window as any).__app.tissot)).toBe(false);
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

    await stopButton(page, 'albers').scrollIntoViewIfNeeded();
    await pick(page, 'albers');
    await settle(page);
    await slider(page, 'First parallel').scrollIntoViewIfNeeded();
    await expect(slider(page, 'First parallel')).toBeVisible();
    // The map's own controls are on the map, not in the scroll.
    await expect(page.getByRole('button', { name: 'Layers and colours' })).toBeVisible();
    await stopButton(page, 'goode').scrollIntoViewIfNeeded();
    await expect(stopButton(page, 'goode')).toBeVisible();
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

test('the globe has a view distance: from nearer, less of it is in sight, and it still drags, slides and morphs', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await open(page);
  const visible = () => page.evaluate(() => 180 - (window as any).__app.live.compiled.caps[0].radius);
  expect(await visible()).toBeCloseTo(90, 9);
  await move(page, 'View distance', 0.5);
  expect((await state(page)).params.d).toBe(0.5);
  expect(await visible()).toBeCloseTo(60, 9);
  await expect(numberBox(page, 'View distance')).toHaveValue('2×');
  await expect(mapName(page)).toHaveText('Globe');
  expect(await isCurrent(page, '[data-stop="globe"]')).toBe(true);
  // The globe still fills the window: the limb is fitted, not the whole sphere.
  const { screen, viewport } = await page.evaluate(() => ({ screen: (window as any).__app.live.screen, viewport: (window as any).__app.viewport }));
  const limb = screen.k * (Math.sin(Math.PI / 3) / 1.5);
  expect(Math.abs(2 * limb - (viewport.height - 32))).toBeLessThan(1);

  // The land under the cursor follows a drag.
  const at = (xy: [number, number]) =>
    page.evaluate(async (xy) => {
      const { screenToLonLat } = await import('/src/screen/screen.ts' as string);
      const live = (window as any).__app.live;
      return screenToLonLat(live.compiled, live.screen, xy) as [number, number] | null;
    }, xy);
  const box = (await page.locator('#map').boundingBox())!;
  const held = (await at([500, 300]))!;
  await page.mouse.move(box.x + 500, box.y + 300);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(box.x + 500 + 12 * i, box.y + 300 - 6 * i);
  await page.mouse.up();
  const now = (await at([572, 264]))!;
  expect(Math.abs(now[0] - held[0]) + Math.abs(now[1] - held[1])).toBeLessThan(0.05);

  // A typed distance slides there, and the reset slides back to infinitely far.
  await type(page, 'View distance', '6.6');
  expect((await state(page)).params.d).toBeCloseTo(1 / 6.6, 9);
  await page.getByRole('button', { name: 'Reset view distance', exact: true }).click();
  expect(await page.evaluate(() => (window as any).__app.isSliding)).toBe(true);
  await settle(page);
  expect((await state(page)).params.d).toBe(0);
  await expect(numberBox(page, 'View distance')).toHaveValue('∞');

  // From close by, it opens into a map and comes back.
  await move(page, 'View distance', 0.7);
  await pick(page, 'mollweide');
  await settle(page);
  await pick(page, 'globe');
  await settle(page);
  expect((await state(page)).params.d).toBe(0);
  expect(errors).toEqual([]);
});
