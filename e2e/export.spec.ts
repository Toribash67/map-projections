import { expect, test, type Download, type Page } from '@playwright/test';
import { isMorphing, open, pick, settle } from './support';

const panel = (page: Page) => page.locator('#export-panel');
const exportButton = (page: Page) => page.getByRole('button', { name: 'Export', exact: true }).first();
const go = (page: Page) => panel(page).locator('.export-go');

type Choices = { format?: 'PNG' | 'SVG'; extent?: 'Whole map' | 'Current view'; size?: string; width?: number; detail?: '110m' | '50m' | '10m'; background?: 'As on screen' | 'Transparent' };

/** Opens the panel, if it is not open, and makes the choices given. The coarse coast is the one on screen, and is the default here. */
async function choose(page: Page, { format, extent, size, width, detail = '110m', background }: Choices) {
  if (await panel(page).isHidden()) await exportButton(page).click();
  for (const name of [format, extent, background]) if (name) await panel(page).getByRole('radio', { name, exact: true }).check();
  if (size) await panel(page).getByRole('combobox', { name: 'Size' }).selectOption({ label: size });
  if (width) await panel(page).getByRole('spinbutton', { name: 'Width in pixels' }).fill(String(width));
  await panel(page).getByRole('combobox', { name: 'Detail' }).selectOption(detail);
}

/** Exports with the choices given, and gives the file that comes of it: the download, and what is in it, which the page is asked to keep as it hands it over. */
async function exported(page: Page, choices: Choices): Promise<{ download: Download; url: string }> {
  await choose(page, choices);
  await page.evaluate(() => {
    const w = window as any;
    if (w.__made) return;
    w.__made = [];
    const make = URL.createObjectURL;
    URL.createObjectURL = (blob: Blob) => {
      w.__made.push(blob);
      return make(blob);
    };
  });
  const [download] = await Promise.all([page.waitForEvent('download'), go(page).click()]);
  const url = await page.evaluate(
    () =>
      new Promise<string>((done) => {
        const reader = new FileReader();
        reader.onload = () => done(reader.result as string);
        reader.readAsDataURL((window as any).__made.at(-1));
      }),
  );
  return { download, url };
}

type Read = { width: number; height: number; difference: number; cornerAlpha: number; reddish: number };

/**
 * A picture, read in the page: its size, how see-through its corner is, how many of its pixels are reddish, which only the accent
 * is, and how far it is from the map on screen, as the mean difference of a channel out of 255. The whole map is in the middle of
 * the window, so a picture smaller than the window is held against the middle of it.
 */
const read = (page: Page, url: string): Promise<Read> =>
  page.evaluate(async (url) => {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    [canvas.width, canvas.height] = [image.naturalWidth, image.naturalHeight];
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(image, 0, 0);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let reddish = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i]! - Math.max(data[i + 1]!, data[i + 2]!) > 60) reddish++;
    const map = document.querySelector<HTMLCanvasElement>('#map')!;
    let difference = NaN;
    if (map.width >= canvas.width && map.height >= canvas.height) {
      const [x, y] = [Math.round((map.width - canvas.width) / 2), Math.round((map.height - canvas.height) / 2)];
      const screen = map.getContext('2d')!.getImageData(x, y, canvas.width, canvas.height).data;
      let total = 0;
      for (let i = 0; i < data.length; i += 4) total += Math.abs(data[i]! - screen[i]!) + Math.abs(data[i + 1]! - screen[i + 1]!) + Math.abs(data[i + 2]! - screen[i + 2]!);
      difference = total / (3 * (data.length / 4));
    }
    return { width: canvas.width, height: canvas.height, difference, cornerAlpha: data[3]!, reddish };
  }, url);

async function show(page: Page, id: string) {
  await open(page);
  await pick(page, id);
  await settle(page);
}

test('a PNG at the screen\'s size is the map on screen, with none of the controls', async ({ page }) => {
  await show(page, 'mollweide');
  const { download, url } = await exported(page, { format: 'PNG', size: 'Screen' });
  const picture = await read(page, url);
  expect(download.suggestedFilename()).toBe(`map-mollweide-${picture.width}.png`);
  // Mollweide is twice as wide as high, and the window is less: the map is as wide as the window, and half that and the margin high.
  expect([picture.width, picture.height]).toEqual([1000, 516]);
  expect(picture.difference).toBeLessThan(3);
  expect(picture.cornerAlpha).toBe(255);
});

test('an SVG is the same map as a drawing', async ({ page }) => {
  await show(page, 'mollweide');
  const { download, url } = await exported(page, { format: 'SVG' });
  await expect(panel(page).getByRole('spinbutton', { name: 'Width in pixels' })).toBeHidden();
  const picture = await read(page, url);
  expect(download.suggestedFilename()).toBe(`map-mollweide-${picture.width}.svg`);
  expect([picture.width, picture.height]).toEqual([1000, 516]);
  expect(picture.difference).toBeLessThan(4);
});

test('borders, the political map, indicatrices and a drawing are in both formats, as on screen, and the corner globe is in neither', async ({ page }) => {
  await show(page, 'mollweide');
  const plain = await read(page, (await exported(page, { format: 'PNG', size: 'Screen' })).url);
  expect(plain.reddish).toBe(0);
  await page.evaluate(() => {
    const app = (window as any).__app;
    for (const layer of ['borders', 'political', 'tissot']) app.setLayer(layer, true);
    const shapes = [{ kind: 'circle', center: [100, 20], radiusDeg: 15 }, { kind: 'line', points: [[-40, -30], [40, 30]] }];
    (window as any).__drawing.shapes = shapes;
    app.shapes = shapes;
    app.invalidateGeometry();
  });
  // Zoomed in, the view is the window's own, corner globe and all.
  await page.evaluate(() => (window as any).__app.setView({ zoom: 2, panX: -200, panY: 60 }));
  await settle(page);
  await expect(page.locator('#locator canvas')).toBeVisible();
  for (const format of ['PNG', 'SVG'] as const) {
    const picture = await read(page, (await exported(page, format === 'PNG' ? { format, extent: 'Current view', size: 'Screen' } : { format, extent: 'Current view' })).url);
    expect([picture.width, picture.height], format).toEqual([1000, 600]);
    // The drawing and the indicatrices are there, and the whole is the canvas, on which the corner globe is not.
    expect(picture.reddish, format).toBeGreaterThan(500);
    expect(picture.difference, format).toBeLessThan(format === 'PNG' ? 3 : 4);
    expect(Math.abs(picture.difference - plain.difference), format).toBeLessThan(4);
  }
});

test('a transparent background leaves the corners clear, in a picture of the width asked for', async ({ page }) => {
  await show(page, 'mollweide');
  const picture = await read(page, (await exported(page, { format: 'PNG', width: 1500, background: 'Transparent' })).url);
  expect(picture.width).toBe(1500);
  expect(picture.cornerAlpha).toBe(0);
  await expect(panel(page).getByRole('combobox', { name: 'Size' })).toHaveValue('custom');
});

test('a 4K picture from the finer coast is made within twenty seconds', async ({ page }) => {
  test.setTimeout(40_000);
  await show(page, 'mollweide');
  const started = Date.now();
  const { download, url } = await exported(page, { format: 'PNG', size: '4K', detail: '50m' });
  expect(Date.now() - started).toBeLessThan(20_000);
  expect(download.suggestedFilename()).toBe('map-mollweide-3840.png');
  expect((await read(page, url)).width).toBe(3840);
});

test('the view can only be exported zoomed in, and the map only at rest', async ({ page }) => {
  await show(page, 'mollweide');
  await choose(page, {});
  await expect(panel(page).getByRole('radio', { name: 'Current view' })).toBeDisabled();
  await expect(go(page)).toHaveAttribute('aria-disabled', 'false');
  expect(await page.evaluate(() => (window as any).__app.snapshot() !== null)).toBe(true);

  await pick(page, 'mercator');
  expect(await isMorphing(page)).toBe(true);
  expect(await page.evaluate(() => (window as any).__app.snapshot())).toBeNull();
  // The press on the list closed the panel.
  await exportButton(page).click();
  await expect(go(page)).toHaveAttribute('aria-disabled', 'true');
  expect(await go(page).getAttribute('aria-description')).toContain('at rest');
  await settle(page);
  await expect(go(page)).toHaveAttribute('aria-disabled', 'false');

  await page.evaluate(() => (window as any).__app.setView({ zoom: 2, panX: 0, panY: 0 }));
  await expect(panel(page).getByRole('radio', { name: 'Current view' })).toBeEnabled();
});

test('a picture the browser cannot make gives a notice, and no file', async ({ page }) => {
  await show(page, 'mollweide');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let downloads = 0;
  page.on('download', () => downloads++);
  await page.evaluate(() => (HTMLCanvasElement.prototype.getContext = () => null));
  await choose(page, { format: 'PNG', size: 'A1 at 300 dpi' });
  await go(page).click();
  await expect(panel(page).getByRole('alert')).toHaveText('Too large for this browser. Try a smaller size, or SVG.');
  await expect(go(page)).toHaveText('Export');
  expect(downloads).toBe(0);
  expect(errors).toEqual([]);

  // A drawing needs no canvas, and the notice goes with the next export.
  const [download] = await Promise.all([page.waitForEvent('download'), choose(page, { format: 'SVG' }).then(() => go(page).click())]);
  expect(download.suggestedFilename()).toMatch(/^map-mollweide-\d+\.svg$/);
  await expect(panel(page).getByRole('alert')).toBeHidden();
});
