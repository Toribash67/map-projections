import { expect, test, type Page } from '@playwright/test';
import { mapStyle } from '../src/render/style';
import { DARK, LIGHT } from '../src/theme/palette';
import { open, pick, settle } from './support';

type Rgb = [number, number, number];
const rgb = (colour: string): Rgb => (colour.startsWith('#') ? [1, 3, 5].map((i) => parseInt(colour.slice(i, i + 2), 16)) : (colour.match(/\d+(\.\d+)?/g)!.slice(0, 3).map(Number))) as Rgb;
/** The locator tints the whole globe of a map that covers it all with a share of slate. */
const tinted = (colour: string, tint: string): Rgb => (rgb(colour).map((v, i) => v * 0.68 + rgb(tint)[i]! * 0.32) as Rgb);
const near = (a: readonly number[], b: readonly number[], tolerance = 3) => b.every((v, i) => Math.abs(a[i]! - v) <= tolerance);

/** A pixel of a canvas, at CSS coordinates. */
const pixel = (page: Page, selector: string, x: number, y: number): Promise<Rgb> =>
  page.evaluate(
    ([selector, x, y]) => {
      const canvas = document.querySelector<HTMLCanvasElement>(selector as string)!;
      const ratio = canvas.width / canvas.clientWidth;
      return [...canvas.getContext('2d')!.getImageData(Math.round((x as number) * ratio), Math.round((y as number) * ratio), 1, 1).data.slice(0, 3)] as Rgb;
    },
    [selector, x, y] as const,
  );

const sidebar = (page: Page) => page.evaluate(() => getComputedStyle(document.querySelector('#sidebar')!).backgroundColor);
const body = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const frames = (page: Page, count = 3) =>
  page.evaluate((count) => new Promise<void>((done) => { const next = (left: number): void => (left <= 0 ? done() : void requestAnimationFrame(() => next(left - 1))); next(count); }), count);

/** The globe's middle is sea or land, and the corners are the surround. */
async function mapColours(page: Page) {
  return { corner: await pixel(page, '#map', 2, 2), middle: await pixel(page, '#map', 524, 324) };
}

for (const [scheme, palette] of [['light', LIGHT], ['dark', DARK]] as const) {
  test(`${scheme} at load: the canvas, the sidebar and the page are the ${scheme} palette`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await open(page);
    await frames(page);
    const style = mapStyle(scheme);
    const { corner, middle } = await mapColours(page);
    expect(near(corner, rgb(style.background))).toBe(true);
    expect(near(middle, rgb(style.land)) || near(middle, rgb(style.ocean))).toBe(true);
    expect(rgb(await sidebar(page))).toEqual(rgb(palette.panel));
    expect(rgb(await body(page))).toEqual(rgb(palette.paper));
    // The browser's own controls follow, and its chrome has a colour for each scheme.
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('light dark');
    const metas = await page.evaluate(() => [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => [m.getAttribute('media'), m.getAttribute('content')]));
    expect(metas).toEqual([['(prefers-color-scheme: light)', LIGHT.paper], ['(prefers-color-scheme: dark)', DARK.paper]]);
  });
}

test('switching the system setting repaints the map, the locator and the sidebar live, with no reload, and back again', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await open(page);
  await pick(page, 'mollweide');
  await settle(page);
  await frames(page);
  await page.evaluate(() => ((window as any).__marker = Math.random()));
  const marker = await page.evaluate(() => (window as any).__marker);

  const look = async () => {
    const locator = await page.evaluate(() => {
      const c = document.querySelector<HTMLCanvasElement>('#locator canvas')!;
      const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      // The commonest opaque colours are the sea and the land of the globe, tinted.
      const seen = new Map<string, number>();
      for (let i = 0; i < data.length; i += 4) if (data[i + 3] === 255) seen.set(`${data[i]},${data[i + 1]},${data[i + 2]}`, (seen.get(`${data[i]},${data[i + 1]},${data[i + 2]}`) ?? 0) + 1);
      return [...seen].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => k.split(',').map(Number));
    });
    return { ...(await mapColours(page)), locator, sidebar: rgb(await sidebar(page)) };
  };

  const before = await look();
  expect(near(before.corner, rgb(LIGHT.paper))).toBe(true);
  expect(before.locator.some((c) => near(c, tinted(LIGHT.ocean, LIGHT.tint)))).toBe(true);
  expect(before.sidebar).toEqual(rgb(LIGHT.panel));

  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(async () => near((await look()).corner, rgb(DARK.paper)), { message: 'the canvas follows' }).toBe(true);
  const dark = await look();
  expect(near(dark.middle, rgb(DARK.land)) || near(dark.middle, rgb(DARK.ocean))).toBe(true);
  expect(dark.locator.some((c) => near(c, tinted(DARK.ocean, DARK.tint)))).toBe(true);
  expect(dark.locator.some((c) => near(c, tinted(LIGHT.ocean, LIGHT.tint)))).toBe(false);
  expect(dark.sidebar).toEqual(rgb(DARK.panel));

  await page.emulateMedia({ colorScheme: 'light' });
  await expect.poll(async () => near((await look()).corner, rgb(LIGHT.paper))).toBe(true);
  expect(await look()).toEqual(before);
  // The same page throughout.
  expect(await page.evaluate(() => (window as any).__marker)).toBe(marker);
});

test('switching in the middle of a morph repaints it, and the morph carries on', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await open(page);
  await pick(page, 'mollweide');
  expect(await page.evaluate(() => (window as any).__app.isMorphing)).toBe(true);
  await page.emulateMedia({ colorScheme: 'dark' });
  await settle(page);
  await frames(page);
  expect(near((await mapColours(page)).corner, rgb(DARK.paper))).toBe(true);
  expect(await page.evaluate(() => (window as any).__app.state.defId)).toBe('mollweide');
});

test('a theme chosen in the app repaints the map, the locator and the page, whatever the system says, and auto follows the system again', async ({ page }) => {
  const { resolvePalette } = await import('../src/theme/themes');
  await page.emulateMedia({ colorScheme: 'light' });
  await open(page);
  await pick(page, 'mollweide');
  await settle(page);
  // In the sea, south of the middle of the map: the Gulf of Guinea.
  const sea = () => pixel(page, '#map', 520, 322);
  const set = (theme: string) => page.evaluate((theme) => (window as any).__app.setTheme(theme), theme);
  for (const theme of ['blueprint', 'print', 'atlas', 'dark'] as const) {
    await set(theme);
    await frames(page);
    const p = resolvePalette(theme, {}, 'light');
    expect(near(await sea(), rgb(p.ocean)), theme).toBe(true);
    expect(near(await pixel(page, '#map', 2, 2), rgb(p.paper)), theme).toBe(true);
    expect(rgb(await sidebar(page)), theme).toEqual(rgb(p.panel));
    expect(rgb(await body(page)), theme).toEqual(rgb(p.paper));
    // The browser's own controls are light or dark with the page.
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), theme).toBe(theme === 'blueprint' || theme === 'dark' ? 'dark' : 'light');
  }
  await set('auto');
  await frames(page);
  expect(near(await sea(), rgb(LIGHT.ocean))).toBe(true);
  expect(rgb(await sidebar(page))).toEqual(rgb(LIGHT.panel));
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('light dark');
  // And the system's change is followed again.
  await page.emulateMedia({ colorScheme: 'dark' });
  await frames(page);
  expect(near(await sea(), rgb(DARK.ocean))).toBe(true);
  expect(rgb(await sidebar(page))).toEqual(rgb(DARK.panel));
});

test('a colour set by hand is laid over the theme, on the map and the page, and taken off again', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await open(page);
  await pick(page, 'mollweide');
  await settle(page);
  const override = (key: string, colour: string | null) => page.evaluate(([key, colour]) => (window as any).__app.setOverride(key, colour), [key, colour] as const);
  await override('ocean', '#ff0000');
  await override('paper', '#00ff00');
  await frames(page);
  expect(near(await pixel(page, '#map', 520, 322), [255, 0, 0])).toBe(true);
  expect(near(await pixel(page, '#map', 2, 2), [0, 255, 0])).toBe(true);
  expect(rgb(await body(page))).toEqual([0, 255, 0]);
  expect(await page.evaluate(() => (window as any).__app.overrides)).toEqual({ ocean: '#ff0000', paper: '#00ff00' });
  // It stays through a change of theme, and comes off when it is cleared.
  await page.evaluate(() => (window as any).__app.setTheme('atlas'));
  await frames(page);
  expect(near(await pixel(page, '#map', 520, 322), [255, 0, 0])).toBe(true);
  await override('ocean', null);
  await override('paper', null);
  await page.evaluate(() => (window as any).__app.setTheme('auto'));
  await frames(page);
  expect(near(await pixel(page, '#map', 520, 322), rgb(LIGHT.ocean))).toBe(true);
  expect(rgb(await body(page))).toEqual(rgb(LIGHT.paper));
  expect(await page.evaluate(() => (window as any).__app.overrides)).toEqual({});
});
