import { expect, test, type Page } from '@playwright/test';
import { styleOf } from '../src/render/style';
import { resolvePalette } from '../src/theme/themes';
import { open, openExport, pick, pictured, settle } from './support';

const POSTER = styleOf(resolvePalette('poster', {}, 'light'));
const rgb = (colour: string) => [1, 3, 5].map((i) => parseInt(colour.slice(i, i + 2), 16));

/** How many pixels of a canvas are within a little of a colour. */
const countOf = (page: Page, colour: number[], tolerance = 18, selector = '.preview-canvas') =>
  page.evaluate(
    ([colour, tolerance, selector]) => {
      const canvas = document.querySelector<HTMLCanvasElement>(selector)!;
      const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
      let count = 0;
      for (let i = 0; i < data.length; i += 4) if (Math.abs(data[i]! - colour[0]!) + Math.abs(data[i + 1]! - colour[1]!) + Math.abs(data[i + 2]! - colour[2]!) < tolerance) count++;
      return count;
    },
    [colour, tolerance, selector] as const,
  );
const side = (page: Page) => page.locator('#export-side');
const box = (page: Page, name: string) => side(page).getByRole('checkbox', { name, exact: true });
/** Ticks boxes in the export view, and waits for the picture with them. */
const tick = async (page: Page, ...names: string[]) => {
  for (const name of names) await box(page, name).check();
  await pictured(page);
};
type Seen = { text: string; kind: string; x: number; y: number };
/** The lettering on the picture: what each label says, its kind, and where its first letter is. */
const labels = (page: Page): Promise<Seen[]> =>
  page.evaluate(() => ((window as any).__export.picture.overlay?.labels ?? []).map((label: any) => ({ text: label.text, kind: label.kind, x: label.glyphs[0].x, y: label.glyphs[0].y })));
const names = async (page: Page) => (await labels(page)).map((label) => label.text);
const plate = (page: Page) => page.evaluate(() => (window as any).__export.picture.overlay?.plate ?? null);
const sceneLayers = (page: Page) => page.evaluate(() => Object.keys((window as any).__export.picture.exported.scene.layers));
/** Where a label is in the window: the middle of its first letter, about. */
const onScreen = (page: Page, text: string) =>
  page.evaluate((text) => {
    const { picture } = (window as any).__export;
    const label = picture.overlay.labels.find((l: any) => l.text === text);
    const canvas = document.querySelector<HTMLCanvasElement>('.preview-canvas')!;
    const box = canvas.getBoundingClientRect();
    const { width, height } = picture.exported.size;
    const s = Math.min((box.width - 56) / width, (box.height - 56) / height);
    const [x, y] = label.discs[Math.floor(label.discs.length / 2)];
    return { x: box.left + box.width / 2 + s * (x - width / 2), y: box.top + box.height / 2 + s * (y - height / 2) };
  }, text);

/** Mercator in the Poster theme, in the export view, from the coast the map itself has. */
const onMercator = async (page: Page) => {
  await open(page);
  await pick(page, 'mercator');
  await settle(page);
  await page.evaluate(() => (window as any).__app.setTheme('poster'));
  await openExport(page);
  await side(page).getByRole('combobox', { name: 'Detail' }).selectOption('110m');
  await pictured(page);
};

test('the export view takes the place of the map and the sidebar, and Escape or the way back returns to them', async ({ page }) => {
  await open(page);
  await pick(page, 'mollweide');
  await settle(page);
  await expect(side(page)).toBeHidden();
  await openExport(page);
  await expect(side(page)).toBeVisible();
  await expect(page.locator('#sidebar')).toBeHidden();
  await expect(page.locator('.preview-canvas')).toBeVisible();
  // The picture is of the map that was on screen, and the projection cannot be changed from here.
  expect(await page.evaluate(() => (window as any).__export.picture.snap.state.defId)).toBe('mollweide');
  // The keys are the picture's: the map under it is not zoomed, and its tools are not chosen.
  await page.keyboard.press('+');
  await page.keyboard.press('L');
  expect(await page.evaluate(() => [(window as any).__app.view.zoom, document.querySelector('#map')!.getAttribute('data-tool')])).toEqual([1, 'none']);
  await page.keyboard.press('Escape');
  await expect(side(page)).toBeHidden();
  await expect(page.locator('#sidebar')).toBeVisible();
  await openExport(page);
  await side(page).getByRole('button', { name: 'Back to the map' }).click();
  await expect(page.locator('#preview')).toBeHidden();
  // The map is as it was.
  await pick(page, 'mercator');
  await settle(page);
});

test('rivers, lakes and the depths of the sea are in the picture, in their colours, and never on the map as it is explored', async ({ page }) => {
  await onMercator(page);
  expect(await sceneLayers(page)).not.toContain('rivers2');
  await tick(page, 'Rivers');
  expect(await sceneLayers(page)).toContain('rivers2');
  const before = await countOf(page, rgb(POSTER.depth[3]!), 6);
  await tick(page, 'Sea depth');
  expect(await countOf(page, rgb(POSTER.depth[3]!), 6)).toBeGreaterThan(before + 200);
  // The plain sea is now only the shallows.
  expect(await countOf(page, rgb(POSTER.depth[1]!), 6)).toBeGreaterThan(5000);
  await tick(page, 'Lakes');
  // A lake is its own outline, with no shore drawn round it.
  expect(await sceneLayers(page)).not.toContain('lakeEdges');
  expect(await sceneLayers(page)).toEqual(expect.arrayContaining(['rivers0', 'rivers3', 'lakes', 'depth0', 'depth3']));
  // The map under the picture has none of them, and is not drawn with them when it is returned to.
  await page.keyboard.press('Escape');
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  const onMap = await page.evaluate(() => Object.keys((window as any).__app.scene.layers));
  expect(onMap.filter((name) => /rivers|lakes|depth/.test(name))).toEqual([]);
  expect(await countOf(page, rgb(POSTER.depth[3]!), 6, '#map')).toBe(0);
});

test('a layer that is turned on is cut alone: what the picture had is not cut again', async ({ page }) => {
  await onMercator(page);
  const piece = (layer: string) => page.evaluate((layer) => ((window as any).__kept ??= {})[layer] === ((window as any).__kept[layer] = (window as any).__export.picture.exported.scene.layers[layer]?.[0]), layer);
  await piece('coast');
  await tick(page, 'Rivers', 'Country names');
  expect(await piece('coast')).toBe(true);
  // A finer coast is another coast.
  await side(page).getByRole('combobox', { name: 'Detail' }).selectOption('50m');
  await pictured(page);
  expect(await piece('coast')).toBe(false);
});

test('the lines are as heavy as chosen, with nothing cut again', async ({ page }) => {
  await onMercator(page);
  const coast = () => countOf(page, rgb(POSTER.coast), 60);
  const scene = () => page.evaluate(() => ((window as any).__keptScene === ((window as any).__keptScene = (window as any).__export.picture.exported.scene)));
  await scene();
  const usual = await coast();
  const weight = side(page).getByRole('slider', { name: 'Line weight' });
  await weight.evaluate((el: HTMLInputElement) => {
    el.value = '3';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await pictured(page);
  expect(await page.evaluate(() => (window as any).__export.picture.snap.layers.lineWeight)).toBe(3);
  expect(await coast()).toBeGreaterThan(usual * 1.5);
  // Nothing is cut again for it.
  expect(await scene()).toBe(true);
  // A finer coast is drawn with finer lines, which is not for the picture's placing to say: it is as much larger as it was.
  const lineScale = () => page.evaluate(() => (window as any).__export.picture.exported.lineScale);
  const larger = await lineScale();
  await side(page).getByRole('combobox', { name: 'Detail' }).selectOption('50m');
  await pictured(page);
  expect(await lineScale()).toBe(larger);
});

test('the picture is drawn from the finest coast, which has far more to it', async ({ page }) => {
  test.setTimeout(120_000);
  await onMercator(page);
  const points = () => page.evaluate(() => (window as any).__export.picture.exported.scene.layers.coast.reduce((n: number, piece: any) => n + piece.src.length / 2, 0));
  const coarse = await points();
  await side(page).getByRole('combobox', { name: 'Detail' }).selectOption('10m');
  await pictured(page);
  expect(await page.evaluate(() => (window as any).__export.picture.opts.detail)).toBe('10m');
  expect(await points()).toBeGreaterThan(coarse * 20);
  // And it can be looked at closely: zooming enlarges the picture, and makes no other of it.
  const made = () => page.evaluate(() => ((window as any).__keptScene === ((window as any).__keptScene = (window as any).__export.picture.exported.scene)));
  await made();
  await page.locator('.preview-canvas').hover();
  await page.mouse.wheel(0, -600);
  await expect(page.locator('#preview').getByRole('button', { name: 'Zoom out' })).toBeEnabled();
  expect(await made()).toBe(true);
});

test('country names are fitted to the picture, more of them the smaller they may be, and the map as it is explored has none', async ({ page }) => {
  await onMercator(page);
  expect(await names(page)).toEqual([]);
  await tick(page, 'Country names');
  const first = await names(page);
  expect(first).toEqual(expect.arrayContaining(['BRAZIL', 'RUSSIA', 'CANADA', 'AUSTRALIA']));
  // The lettering is on the picture in its colour.
  expect(await countOf(page, rgb(POSTER.labels), 40)).toBeGreaterThan(300);
  expect(await countOf(page, rgb(POSTER.labels), 40, '#map')).toBeLessThan(20);

  const slider = side(page).getByRole('slider', { name: 'Smallest name' });
  await slider.evaluate((el: HTMLInputElement) => {
    el.value = '2';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction((n) => (window as any).__export.settled && (window as any).__export.picture.overlay.labels.length > n, first.length);
  expect(await page.evaluate(() => (window as any).__app.snapshot().layers.on.countryNames)).toBeUndefined();
});

test('sea names and degrees have their own switches, and the degrees go with the graticule', async ({ page }) => {
  await onMercator(page);
  await tick(page, 'Sea names');
  expect(await names(page)).toEqual(expect.arrayContaining(['Indian Ocean', 'South Pacific Ocean']));
  await tick(page, 'Degrees');
  expect(await names(page)).toEqual(expect.arrayContaining(['30°N', '60°W', '0°']));
  // The map's own layers are here too, and are the map's still.
  await box(page, 'Graticule').uncheck();
  await pictured(page);
  await expect(box(page, 'Degrees')).toBeDisabled();
  expect((await labels(page)).every((label) => label.kind !== 'degree')).toBe(true);
  expect(await page.evaluate(() => (window as any).__app.layers.on.graticule)).toBe(false);
});

test('the title box says what is typed, in the place chosen, and the frame gives the map more margin', async ({ page }) => {
  await onMercator(page);
  const title = side(page).getByRole('textbox', { name: 'Title', exact: true });
  await expect(title).toBeDisabled();
  await tick(page, 'Title box');
  await expect(title).toHaveValue('The World');
  await title.fill('Mercator, for the hall');
  await side(page).getByRole('textbox', { name: 'Subtitle' }).fill('not for navigation');
  await pictured(page);
  expect((await plate(page)).box.lines.map((line: { text: string }) => line.text)).toEqual(['MERCATOR, FOR THE HALL', 'NOT FOR NAVIGATION', 'MERCATOR PROJECTION', 'Centre 0°', 'Made with Natural Earth']);
  const right = (await plate(page)).box;
  await side(page).getByRole('radiogroup', { name: 'Place', exact: true }).getByRole('radio', { name: 'Bottom left' }).check();
  await pictured(page);
  expect((await plate(page)).box.x).toBeLessThan(right.x - 200);
  expect((await plate(page)).box.y).toBeGreaterThan(right.y + 100);
  // Any of nine places: the middle of the top is between the two top corners, as high as they are.
  const left = (await plate(page)).box;
  await side(page).getByRole('radiogroup', { name: 'Place', exact: true }).getByRole('radio', { name: 'Top middle' }).check();
  await pictured(page);
  expect((await plate(page)).box.y).toBe(right.y);
  expect((await plate(page)).box.x).toBeCloseTo((left.x + right.x) / 2, 3);

  // The frame is the picture's: the map in it is smaller, and the map as it is explored is as it was.
  const fit = () => page.evaluate(() => [(window as any).__export.picture.exported.member.screen.k, (window as any).__app.live.screen.k]);
  const [k, live] = await fit();
  await tick(page, 'Frame');
  expect((await plate(page)).frame).not.toBeNull();
  expect((await fit())[0]).toBeLessThan(k! * 0.97);
  expect((await fit())[1]).toBe(live);
});

/** How wide the picture is, in its own pixels, and how many pixels of the window one of those is at the fit. */
const pictureScale = (page: Page) =>
  page.evaluate(() => {
    const { width, height } = (window as any).__export.picture.exported.size;
    const box = document.querySelector('.preview-canvas')!.getBoundingClientRect();
    return { width: width as number, scale: Math.min((box.width - 56) / width, (box.height - 56) / height) };
  });

test('a name is dragged to another place, taken off with Delete, and put back', async ({ page }) => {
  await onMercator(page);
  await tick(page, 'Country names');
  const find = async (text: string) => (await labels(page)).find((label) => label.text === text);
  const putBack = side(page).getByRole('button', { name: 'Put the names back' });
  const [fitted, russia] = [(await find('BRAZIL'))!, (await find('RUSSIA'))!];
  const small = await pictureScale(page);
  const from = await onScreen(page, 'BRAZIL');
  await expect(putBack).toBeHidden();
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 30, from.y + 10, { steps: 3 });
  await page.mouse.move(from.x + 60, from.y + 20, { steps: 3 });
  await page.mouse.up();
  const moved = (await find('BRAZIL'))!;
  expect((moved.x - fitted.x) * small.scale).toBeCloseTo(60, 0);
  expect((moved.y - fitted.y) * small.scale).toBeCloseTo(20, 0);
  // The others are where they were.
  expect(await find('RUSSIA')).toEqual(russia);
  await expect(putBack).toBeVisible();

  // The arrows move the one that is chosen, a pixel of the window at a time.
  await page.keyboard.press('ArrowRight');
  expect(((await find('BRAZIL'))!.x - moved.x) * small.scale).toBeCloseTo(1, 1);
  await page.keyboard.press('ArrowLeft');

  // It stays moved, by as much of the picture, when the names are fitted again for another size.
  await side(page).getByRole('combobox', { name: 'Size' }).selectOption({ label: '4K' });
  await pictured(page);
  const large = await pictureScale(page);
  expect(large.width).toBe(3840);
  expect((await find('BRAZIL'))!.x / large.width).toBeCloseTo(moved.x / small.width, 2);

  // Delete takes off the name that is chosen: the one last dragged.
  await page.keyboard.press('Delete');
  expect(await find('BRAZIL')).toBeUndefined();
  expect(await find('RUSSIA')).toBeDefined();
  await putBack.click();
  expect((await find('BRAZIL'))!.x / large.width).toBeCloseTo(fitted.x / small.width, 2);
  await expect(putBack).toBeHidden();
});

test('what is chosen for the picture is kept for the next visit', async ({ page }) => {
  await onMercator(page);
  await tick(page, 'Rivers', 'Country names', 'Degrees', 'Frame', 'Title box');
  await side(page).getByRole('textbox', { name: 'Title', exact: true }).fill('Kept');
  await side(page).getByRole('radiogroup', { name: 'Place', exact: true }).getByRole('radio', { name: 'Top left' }).check();
  await page.reload();
  await page.waitForFunction(() => (window as any).__app !== undefined);
  // The map as it is explored comes back plain.
  expect(await page.evaluate(() => Object.keys((window as any).__app.layers.on))).not.toContain('rivers');
  await openExport(page);
  for (const name of ['Rivers', 'Country names', 'Degrees', 'Frame', 'Title box']) await expect(box(page, name)).toBeChecked();
  await expect(side(page).getByRole('textbox', { name: 'Title', exact: true })).toHaveValue('Kept');
  await expect(side(page).getByRole('radiogroup', { name: 'Place', exact: true }).getByRole('radio', { name: 'Top left' })).toBeChecked();
  expect((await names(page)).length).toBeGreaterThan(10);
});

test('the side fits the window: what is chosen scrolls, the file stays in view, and every control says what it is', async ({ page }) => {
  await onMercator(page);
  const bounds = await side(page).boundingBox();
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(600);
  await expect(side(page).locator('.export-go')).toBeInViewport();
  await box(page, 'Title box').scrollIntoViewIfNeeded();
  await expect(box(page, 'Title box')).toBeInViewport();
  await expect(side(page).locator('.export-go')).toBeInViewport();
  for (const name of ['Rivers', 'Lakes', 'Sea depth', 'Country names', 'Sea names', 'Degrees', 'Frame', 'Title box']) {
    // Scrolling hides a tip, so the box is brought into view before the pointer comes to rest on it.
    await box(page, name).scrollIntoViewIfNeeded();
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    await page.mouse.move(0, 0);
    await box(page, name).hover();
    await expect(page.getByRole('tooltip')).toBeVisible();
  }
});

test('an exported drawing has the names where they were put, the title and the frame', async ({ page }) => {
  await onMercator(page);
  await tick(page, 'Country names', 'Frame', 'Title box');
  const from = await onScreen(page, 'BRAZIL');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 40, from.y, { steps: 4 });
  await page.mouse.up();
  await side(page).getByRole('radio', { name: 'SVG' }).check();
  await pictured(page);
  const brazil = (await labels(page)).find((label) => label.text === 'BRAZIL')!;
  // The page is asked to keep the file as it hands it over.
  await page.evaluate(() => {
    const make = URL.createObjectURL;
    URL.createObjectURL = (blob: Blob) => {
      (window as any).__made = blob;
      return make(blob);
    };
  });
  await Promise.all([page.waitForEvent('download'), side(page).getByRole('button', { name: 'Export' }).click()]);
  const svg = await page.evaluate(() => ((window as any).__made as Blob).text());
  expect(svg).toContain('<g id="names"');
  expect(svg).toMatch(new RegExp(`<text[^>]* x="${brazil.x.toFixed(2).replace(/\\.?0+$/, '')} [^>]*>BRAZIL</text>`));
  expect(svg).toMatch(/>THE WORLD<\/text>/);
  expect(svg).toContain('<g id="plate"');
  expect(svg).toContain('@font-face{font-family:Jost');
});
