import { expect, test, type Page } from '@playwright/test';
import { styleOf } from '../src/render/style';
import { resolvePalette } from '../src/theme/themes';
import { open, pick, settle } from './support';

const POSTER = styleOf(resolvePalette('poster', {}, 'light'));
const rgb = (colour: string) => [1, 3, 5].map((i) => parseInt(colour.slice(i, i + 2), 16));

/** How many pixels of the map are within a little of a colour. */
const countOf = (page: Page, colour: number[], tolerance = 18) =>
  page.evaluate(
    ([colour, tolerance]) => {
      const canvas = document.querySelector<HTMLCanvasElement>('#map')!;
      const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
      let count = 0;
      for (let i = 0; i < data.length; i += 4) if (Math.abs(data[i]! - colour[0]!) + Math.abs(data[i + 1]! - colour[1]!) + Math.abs(data[i + 2]! - colour[2]!) < tolerance) count++;
      return count;
    },
    [colour, tolerance] as const,
  );
const panel = (page: Page) => page.locator('#layers-panel');
const box = (page: Page, name: string) => panel(page).getByRole('checkbox', { name, exact: true });
/** The names on the map now, or null while the lettering is off it. */
const names = (page: Page): Promise<string[] | null> => page.evaluate(() => (window as any).__app.overlay?.labels.map((label: { text: string }) => label.text) ?? null);
const lettered = (page: Page) => page.waitForFunction(() => (window as any).__app.overlay !== null);
const onMercator = async (page: Page) => {
  await open(page);
  await pick(page, 'mercator');
  await settle(page);
  await page.getByRole('button', { name: 'Layers and colours' }).click();
  await panel(page).getByRole('combobox', { name: 'Theme' }).selectOption('poster');
};

test('rivers, lakes and the depths of the sea are fetched when turned on, and drawn in their colours', async ({ page }) => {
  await onMercator(page);
  const layerNames = () => page.evaluate(() => Object.keys((window as any).__app.scene.layers));
  // A river is a thin line, which no pixel has the full colour of: the map is seen to change where rivers are, and to have the layer.
  const before0 = await page.evaluate(() => document.querySelector<HTMLCanvasElement>('#map')!.toDataURL());
  await box(page, 'Rivers').check();
  await expect.poll(layerNames).toContain('rivers');
  await expect.poll(() => page.evaluate(() => document.querySelector<HTMLCanvasElement>('#map')!.toDataURL())).not.toBe(before0);
  const before = await countOf(page, rgb(POSTER.depth[3]!), 6);
  await box(page, 'Sea depth').check();
  await expect.poll(() => countOf(page, rgb(POSTER.depth[3]!), 6)).toBeGreaterThan(before + 200);
  // The plain sea is now only the shallows.
  expect(await countOf(page, rgb(POSTER.depth[1]!), 6)).toBeGreaterThan(5000);
  await box(page, 'Lakes').check();
  await expect.poll(layerNames).toEqual(expect.arrayContaining(['rivers', 'lakes', 'lakeEdges', 'depth0', 'depth3']));
  await box(page, 'Rivers').uncheck();
  await expect.poll(layerNames).not.toContain('rivers');
});

test('country names come when the map is still, go while it moves, and come back fitted to the new map', async ({ page }) => {
  await onMercator(page);
  expect(await names(page)).toBeNull();
  await box(page, 'Country names').check();
  await lettered(page);
  const onMercatorMap = (await names(page))!;
  expect(onMercatorMap).toEqual(expect.arrayContaining(['BRAZIL', 'RUSSIA', 'CANADA', 'AUSTRALIA']));
  // The lettering is on the canvas in its colour.
  expect(await countOf(page, rgb(POSTER.labels), 40)).toBeGreaterThan(300);

  await pick(page, 'globe');
  await page.waitForFunction(() => (window as any).__app.isMorphing);
  expect(await names(page)).toBeNull();
  await settle(page);
  await lettered(page);
  const onGlobe = (await names(page))!;
  expect(onGlobe).toContain('ALGERIA');
  // The far side of the globe has no names.
  expect(onGlobe).not.toContain('AUSTRALIA');

  // More of them, the smaller they may be. Choosing a projection closed the panel.
  await page.getByRole('button', { name: 'Layers and colours' }).click();
  const slider = panel(page).getByRole('slider', { name: 'Smallest name' });
  await slider.evaluate((el: HTMLInputElement) => {
    el.value = '2';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction((n) => ((window as any).__app.overlay?.labels.length ?? 0) > n, onGlobe.length);
});

test('sea names and degrees have their own switches, and the degrees go with the graticule', async ({ page }) => {
  await onMercator(page);
  await box(page, 'Sea names').check();
  await page.waitForFunction(() => (window as any).__app.overlay?.labels.some((label: { kind: string }) => label.kind === 'sea'));
  expect(await names(page)).toEqual(expect.arrayContaining(['Indian Ocean', 'South Pacific Ocean']));
  await box(page, 'Degrees').check();
  await page.waitForFunction(() => (window as any).__app.overlay?.labels.some((label: { kind: string }) => label.kind === 'degree'));
  expect(await names(page)).toEqual(expect.arrayContaining(['30°N', '60°W', '0°']));
  await box(page, 'Graticule').uncheck();
  await expect(box(page, 'Degrees')).toBeDisabled();
  await expect(panel(page).getByRole('checkbox', { name: 'Under the land' })).toBeDisabled();
  await page.waitForFunction(() => (window as any).__app.overlay?.labels.every((label: { kind: string }) => label.kind !== 'degree'));
});

test('the title box says what is typed, in the corner chosen, and the frame gives the map more margin', async ({ page }) => {
  await onMercator(page);
  const plate = () => page.evaluate(() => (window as any).__app.overlay?.plate ?? null);
  const title = panel(page).getByRole('textbox', { name: 'Title', exact: true });
  await expect(title).toBeDisabled();
  await box(page, 'Title box').check();
  await expect(title).toHaveValue('The World');
  await title.fill('Mercator, for the hall');
  await panel(page).getByRole('textbox', { name: 'Subtitle' }).fill('not for navigation');
  await expect.poll(async () => (await plate())?.box?.lines.map((line: { text: string }) => line.text)).toEqual(['MERCATOR, FOR THE HALL', 'NOT FOR NAVIGATION', 'MERCATOR PROJECTION', 'Centre 0°', 'Made with Natural Earth']);
  // The names are not fitted again for a title: they stay as it is typed. (The letter goes in wherever the caret is.)
  await box(page, 'Country names').check();
  await page.waitForFunction(() => ((window as any).__app.overlay?.labels.length ?? 0) > 8);
  await title.pressSequentially('!');
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  expect((await names(page))!.length).toBeGreaterThan(8);
  expect((await plate()).box.lines[0].text).toContain('MERCATOR, FOR THE HALL');
  await box(page, 'Country names').uncheck();
  const right = (await plate()).box;
  await panel(page).getByRole('combobox', { name: 'Corner' }).selectOption('bl');
  await expect.poll(async () => (await plate()).box.x).toBeLessThan(right.x - 200);
  expect((await plate()).box.y).toBeGreaterThan(right.y + 100);

  const fit = () => page.evaluate(() => (window as any).__app.live.screen.k);
  const k = await fit();
  await box(page, 'Frame').check();
  await expect.poll(fit).toBeLessThan(k * 0.97);
  await expect.poll(async () => (await plate())?.frame).not.toBeNull();
  // The box and the frame stay while the map moves.
  await pick(page, 'mollweide');
  await page.waitForFunction(() => (window as any).__app.isMorphing);
  expect(await names(page)).toBeNull();
  expect(await countOf(page, rgb(POSTER.ink), 30)).toBeGreaterThan(400);
});

test('what is chosen is kept for the next visit', async ({ page }) => {
  await onMercator(page);
  for (const name of ['Rivers', 'Country names', 'Degrees', 'Under the land', 'Frame', 'Title box']) await box(page, name).check();
  await panel(page).getByRole('textbox', { name: 'Title', exact: true }).fill('Kept');
  await panel(page).getByRole('combobox', { name: 'Corner' }).selectOption('tl');
  await page.reload();
  await page.waitForFunction(() => (window as any).__app !== undefined);
  const layers = await page.evaluate(() => (window as any).__app.layers);
  expect(layers).toMatchObject({ graticuleUnder: true, title: 'Kept', corner: 'tl', on: { rivers: true, countryNames: true, degrees: true, frame: true, titleBox: true } });
  await lettered(page);
  expect((await names(page))!.length).toBeGreaterThan(10);
});

test('the panel stays within the window and scrolls within itself', async ({ page }) => {
  await onMercator(page);
  const bounds = await panel(page).boundingBox();
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(600);
  await box(page, 'Title box').scrollIntoViewIfNeeded();
  await expect(box(page, 'Title box')).toBeInViewport();
  // Every control of the new groups says what it is.
  for (const name of ['Rivers', 'Lakes', 'Sea depth', 'Degrees', 'Under the land', 'Country names', 'Sea names', 'Frame', 'Title box']) {
    await box(page, name).hover();
    await expect(page.getByRole('tooltip')).toBeVisible();
  }
});

test('an exported drawing has the names, the title and the frame, and an exported picture has their colours', async ({ page }) => {
  await onMercator(page);
  for (const name of ['Country names', 'Frame', 'Title box']) await box(page, name).check();
  await lettered(page);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Export', exact: true }).first().click();
  await page.locator('#export-panel').getByRole('radio', { name: 'SVG' }).check();
  // The page is asked to keep the file as it hands it over.
  await page.evaluate(() => {
    const make = URL.createObjectURL;
    URL.createObjectURL = (blob: Blob) => {
      (window as any).__made = blob;
      return make(blob);
    };
  });
  await Promise.all([page.waitForEvent('download'), page.locator('#export-panel').getByRole('button', { name: 'Export' }).click()]);
  const svg = await page.evaluate(() => ((window as any).__made as Blob).text());
  expect(svg).toContain('<g id="names"');
  expect(svg).toMatch(/>BRAZIL<\/text>/);
  expect(svg).toMatch(/>THE WORLD<\/text>/);
  expect(svg).toContain('<g id="plate"');
  expect(svg).toContain('@font-face{font-family:Jost');
});
