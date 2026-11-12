import { expect, test, type Page } from '@playwright/test';
import { mapStyle } from '../src/render/style';
import { resolvePalette } from '../src/theme/themes';
import { move, open, pick, settle } from './support';

type Rgb = [number, number, number];
const LIGHT = mapStyle('light');
const rgb = (colour: string): Rgb => (colour.startsWith('#') ? [1, 3, 5].map((i) => parseInt(colour.slice(i, i + 2), 16)) : colour.match(/\d+(\.\d+)?/g)!.slice(0, 3).map(Number)) as Rgb;

/** How many pixels of the map are within a little of a colour. */
const countOf = (page: Page, colour: Rgb, tolerance = 24) =>
  page.evaluate(
    ([colour, tolerance]) => {
      const canvas = document.querySelector<HTMLCanvasElement>('#map')!;
      const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
      let count = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (Math.abs(data[i]! - colour[0]!) + Math.abs(data[i + 1]! - colour[1]!) + Math.abs(data[i + 2]! - colour[2]!) < tolerance) count++;
      }
      return count;
    },
    [colour, tolerance] as const,
  );
/** Keeps the map as it is drawn now, and later counts the pixels that have changed since by more than a little. */
const keep = (page: Page) =>
  page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('#map')!;
    (window as any).__kept = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
  });
const changed = (page: Page) =>
  page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('#map')!;
    const now = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    const kept = (window as any).__kept as Uint8ClampedArray;
    let count = 0;
    for (let i = 0; i < now.length; i += 4) if (Math.abs(now[i]! - kept[i]!) + Math.abs(now[i + 1]! - kept[i + 1]!) + Math.abs(now[i + 2]! - kept[i + 2]!) > 12) count++;
    return count;
  });
const sceneLayerNames = (page: Page) => page.evaluate(() => Object.keys((window as any).__app.scene.layers));
const frames = (page: Page) => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
const layersButton = (page: Page) => page.getByRole('button', { name: 'Layers and colours' });
const layer = (page: Page, name: string) => page.locator('#layers-panel').getByRole('checkbox', { name, exact: true });
const onMap = async (page: Page, id: string) => {
  await open(page);
  await pick(page, id);
  await settle(page);
  await layersButton(page).click();
  await expect(page.locator('#layers-panel')).toBeVisible();
};

test('the Layers button opens a panel with every layer, as it is on the map', async ({ page }) => {
  await open(page);
  await expect(page.locator('#layers-panel')).toBeHidden();
  await layersButton(page).click();
  const names = await page.locator('#layers-panel').getByRole('checkbox').evaluateAll((els) => els.map((el) => [(el as HTMLInputElement).labels![0]!.textContent!.trim(), (el as HTMLInputElement).checked]));
  expect(names).toEqual([
    ['Land', true], ['Coastline', true], ['Graticule', true], ['Degrees', false], ['Under the land', false], ['Country borders', false], ['Political colours', false],
    ['Rivers', false], ['Lakes', false], ['Sea depth', false],
    ['Tissot indicatrices', false], ['Standard lines', false], ['Reference circles', false], ['Drawings', true],
    // And what is written and drawn over the map.
    ['Country names', false], ['Sea names', false], ['Frame', false], ['Title box', false],
  ]);
  // Each says what it is in a tip.
  for (const box of await page.locator('#layers-panel label.layer').all()) expect(await box.getAttribute('aria-description')).toBeTruthy();
  await page.keyboard.press('Escape');
  await expect(page.locator('#layers-panel')).toBeHidden();
});

test('a layer is shown and hidden by its box, and the box follows the map', async ({ page }) => {
  await onMap(page, 'mollweide');
  expect(await sceneLayerNames(page)).toContain('coast');
  await keep(page);
  await layer(page, 'Coastline').uncheck();
  await frames(page);
  // The coasts were a line of pixels all round the land, and are gone.
  expect(await changed(page)).toBeGreaterThan(1500);
  expect(await sceneLayerNames(page)).not.toContain('coast');
  expect(await page.evaluate(() => (window as any).__app.layers.on.coast)).toBe(false);
  await layer(page, 'Land').uncheck();
  await frames(page);
  // With no land and no coast the map is sea and graticule.
  expect(await countOf(page, rgb(LIGHT.land), 6)).toBe(0);
  await page.evaluate(() => (window as any).__app.setLayer('land', true));
  await expect(layer(page, 'Land')).toBeChecked();
});

test('the key T turns the indicatrices on and off, and the panel shows it', async ({ page }) => {
  await onMap(page, 'mollweide');
  await page.keyboard.press('Escape');
  await page.locator('#map').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('t');
  expect(await page.evaluate(() => (window as any).__app.tissot)).toBe(true);
  await layersButton(page).click();
  await expect(layer(page, 'Tissot indicatrices')).toBeChecked();
  await layer(page, 'Tissot indicatrices').uncheck();
  expect(await page.evaluate(() => (window as any).__app.tissot)).toBe(false);
});

test('the borders between countries are drawn in their own colour, across the continents', async ({ page }) => {
  await onMap(page, 'mollweide');
  expect(await sceneLayerNames(page)).not.toContain('borders');
  await keep(page);
  await layer(page, 'Country borders').check();
  await frames(page);
  expect(await sceneLayerNames(page)).toContain('borders');
  expect(await changed(page)).toBeGreaterThan(1500);
  // On land, and darker than the land they are drawn on: the middle of Africa has some.
  const dark = await page.evaluate((land) => {
    const canvas = document.querySelector<HTMLCanvasElement>('#map')!;
    const ratio = canvas.width / canvas.clientWidth;
    const { data } = canvas.getContext('2d')!.getImageData(Math.round(500 * ratio), Math.round(240 * ratio), Math.round(90 * ratio), Math.round(110 * ratio));
    let count = 0;
    for (let i = 0; i < data.length; i += 4) if (land[0]! - data[i]! > 40 && land[1]! - data[i + 1]! > 40) count++;
    return count;
  }, rgb(LIGHT.land));
  expect(dark).toBeGreaterThan(100);
});

test('the political colours fill the countries in five colours in place of the land', async ({ page }) => {
  await onMap(page, 'mollweide');
  await layer(page, 'Political colours').check();
  await frames(page);
  const counts = await Promise.all(LIGHT.political.map((colour) => countOf(page, rgb(colour), 10)));
  for (const [i, count] of counts.entries()) expect(count, `colour ${i}`).toBeGreaterThan(300);
});

test('the graticule is as fine as chosen', async ({ page }) => {
  await onMap(page, 'equirectangular');
  const lines = () => page.evaluate(() => ((window as any).__app.scene.layers.graticule as unknown[]).length);
  const fine = await lines();
  await page.locator('#layers-panel').getByRole('radio', { name: '30°' }).check();
  await frames(page);
  expect(await page.evaluate(() => (window as any).__app.layers.graticuleStep)).toBe(30);
  expect(await lines()).toBeLessThan(fine / 2);
  // With the graticule off, its fineness has nothing to say.
  await layer(page, 'Graticule').uncheck();
  await expect(page.locator('#layers-panel').getByRole('radio', { name: '30°' })).toBeDisabled();
});

test('standard lines are the parallels of true scale: they follow the sliders, and a map with none cannot show them', async ({ page }) => {
  await onMap(page, 'albers');
  const standard = rgb(LIGHT.standard);
  await layer(page, 'Standard lines').check();
  await frames(page);
  expect(await countOf(page, standard, 40)).toBeGreaterThan(600);
  const where = () =>
    page.evaluate((colour) => {
      const canvas = document.querySelector<HTMLCanvasElement>('#map')!;
      const ratio = canvas.width / canvas.clientWidth;
      // Down the middle of the map, the rows where a line in the standard colour is.
      const rows: number[] = [];
      const ctx = canvas.getContext('2d')!;
      const column = ctx.getImageData(Math.round(500 * ratio), 0, 1, canvas.height).data;
      for (let y = 0; y < canvas.height; y++) {
        if (Math.abs(column[4 * y]! - colour[0]!) + Math.abs(column[4 * y + 1]! - colour[1]!) + Math.abs(column[4 * y + 2]! - colour[2]!) < 60) rows.push(Math.round(y / ratio));
      }
      return rows;
    }, standard);
  const before = await where();
  expect(before.length).toBeGreaterThanOrEqual(2);
  await move(page, 'First parallel', 10);
  await frames(page);
  const after = await where();
  expect(Math.max(...after)).not.toBe(Math.max(...before));

  await page.keyboard.press('Escape');
  await pick(page, 'mollweide');
  await settle(page);
  await layersButton(page).click();
  await expect(layer(page, 'Standard lines')).toBeDisabled();
  expect(await countOf(page, standard, 40)).toBe(0);
  // It is still wanted, and is back on a map that has them.
  await page.keyboard.press('Escape');
  await pick(page, 'behrmann');
  await settle(page);
  expect(await countOf(page, standard, 40)).toBeGreaterThan(600);
});

test('a theme is chosen from the panel, and repaints the map and the page', async ({ page }) => {
  await onMap(page, 'mollweide');
  const theme = page.locator('#layers-panel').getByRole('combobox', { name: 'Theme' });
  await expect(theme).toHaveValue('auto');
  await theme.selectOption('blueprint');
  await frames(page);
  const blueprint = resolvePalette('blueprint', {}, 'light');
  expect(await countOf(page, rgb(blueprint.ocean), 6)).toBeGreaterThan(50_000);
  expect(rgb(await page.evaluate(() => getComputedStyle(document.querySelector('#sidebar')!).backgroundColor))).toEqual(rgb(blueprint.panel));
  // The panel itself is of the theme.
  expect(rgb(await page.evaluate(() => getComputedStyle(document.querySelector('#layers-panel')!).backgroundColor))).toEqual(rgb(blueprint.panel));
});

test('a colour is set by hand in the panel, kept over a reload, and reset to the theme\'s', async ({ page }) => {
  await onMap(page, 'mollweide');
  const sea = page.locator('#colour-ocean');
  await expect(sea).toHaveValue(LIGHT.ocean);
  await expect(page.getByRole('button', { name: 'Reset sea' })).toHaveCount(0);
  await sea.fill('#ff0000');
  await frames(page);
  expect(await countOf(page, [255, 0, 0], 6)).toBeGreaterThan(50_000);
  await expect(page.getByRole('button', { name: 'Reset sea' })).toBeVisible();

  await page.reload();
  await page.waitForFunction(() => (window as any).__app !== undefined);
  await frames(page);
  expect(await countOf(page, [255, 0, 0], 6)).toBeGreaterThan(50_000);
  await layersButton(page).click();
  await expect(page.locator('#colour-ocean')).toHaveValue('#ff0000');
  await page.getByRole('button', { name: 'Reset sea' }).click();
  await frames(page);
  expect(await countOf(page, [255, 0, 0], 6)).toBe(0);
  await expect(page.locator('#colour-ocean')).toHaveValue(LIGHT.ocean);
  // Reset colours takes off all of them at once.
  await page.locator('#colour-land').fill('#00ff00');
  await page.locator('#colour-accent').fill('#0000ff');
  expect(await page.evaluate(() => (window as any).__app.overrides)).toEqual({ land: '#00ff00', accent: '#0000ff' });
  await page.getByRole('button', { name: 'Reset colours' }).click();
  expect(await page.evaluate(() => (window as any).__app.overrides)).toEqual({});
});

test('with every layer on, a morph and a slide run with no error, and the layers stay on', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await onMap(page, 'albers');
  for (const name of ['Country borders', 'Political colours', 'Tissot indicatrices', 'Standard lines', 'Reference circles']) await layer(page, name).check();
  await page.keyboard.press('Escape');
  for (const id of ['mercator', 'gall-peters', 'peirce', 'butterfly', 'globe', 'lambert-conformal']) {
    await pick(page, id);
    await settle(page);
  }
  const names = await page.evaluate(() => Object.keys((window as any).__app.scene.layers).sort());
  expect(names).toEqual(['borders', 'coast', 'drawings', 'graticule', 'ocean', 'political0', 'political1', 'political2', 'political3', 'political4', 'reference', 'standard']);
  expect(errors).toEqual([]);
});
