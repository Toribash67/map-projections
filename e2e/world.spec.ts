import { expect, test, type Page } from '@playwright/test';
import { styleOf } from '../src/render/style';
import { resolvePalette } from '../src/theme/themes';
import { open, openExport, pick, pictured, settle } from './support';

const ATLAS = styleOf(resolvePalette('atlas', {}, 'light'));
const rgb = (colour: string) => [1, 3, 5].map((i) => parseInt(colour.slice(i, i + 2), 16));
const side = (page: Page) => page.locator('#export-side');
const box = (page: Page, name: string) => side(page).getByRole('checkbox', { name, exact: true });
const tick = async (page: Page, ...names: string[]) => {
  for (const name of names) await box(page, name).check();
  await pictured(page);
};
const cover = async (page: Page, value: string) => {
  await side(page).getByRole('combobox', { name: 'Land colours' }).selectOption(value);
  await pictured(page);
};
const picture = <T>(page: Page, read: string): Promise<T> => page.evaluate(`(() => { const picture = window.__export.picture; return ${read}; })()`) as Promise<T>;
const sceneLayers = (page: Page) => picture<string[]>(page, 'Object.keys(picture.exported.scene.layers)');
/** How many pixels of the picture are within a little of a colour. */
const countOf = (page: Page, colour: number[], tolerance = 12) =>
  page.evaluate(
    ([colour, tolerance]) => {
      const canvas = document.querySelector<HTMLCanvasElement>('.preview-canvas')!;
      const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
      let count = 0;
      for (let i = 0; i < data.length; i += 4) if (Math.abs(data[i]! - colour[0]!) + Math.abs(data[i + 1]! - colour[1]!) + Math.abs(data[i + 2]! - colour[2]!) < tolerance) count++;
      return count;
    },
    [colour, tolerance] as const,
  );

/** Robinson in the Atlas theme, in the export view, from the coast the map itself has. */
const onRobinson = async (page: Page) => {
  await open(page);
  await pick(page, 'robinson');
  await settle(page);
  await page.evaluate(() => (window as any).__app.setTheme('atlas'));
  await openExport(page);
  await side(page).getByRole('combobox', { name: 'Detail' }).selectOption('110m');
  await pictured(page);
};

test('the land is coloured by its height, its biomes or its climates, one at a time, with a legend that says which is which', async ({ page }) => {
  await onRobinson(page);
  expect(await picture(page, 'picture.overlay')).toBeNull();
  await cover(page, 'height');
  expect((await sceneLayers(page)).filter((name) => /^height/.test(name))).toHaveLength(6);
  // The highest land is on the picture in its colour, and the legend has a row for each step.
  expect(await countOf(page, rgb(ATLAS.height[3]!))).toBeGreaterThan(500);
  const rows = () => picture<string[]>(page, 'picture.overlay.plate.legend.texts.map((text) => text.text)');
  expect(await rows()).toEqual(['HEIGHT', 'over 4500 m', '3000 – 4500 m', '2000 – 3000 m', '1000 – 2000 m', '500 – 1000 m', '200 – 500 m', 'under 200 m', 'Data: NOAA ETOPO5']);

  // It takes the place of the political colours, which are the map's still.
  await tick(page, 'Political colours');
  expect((await sceneLayers(page)).filter((name) => /^political/.test(name))).toEqual([]);
  await cover(page, 'biomes');
  expect((await sceneLayers(page)).filter((name) => /^(height|biomes)/.test(name))).toEqual(Array.from({ length: 14 }, (_, i) => `biomes${i}`));
  expect((await rows()).slice(0, 3)).toEqual(['BIOMES', 'Tropical moist forest', 'Tropical dry forest']);
  expect(await countOf(page, rgb(ATLAS.biomes[12]!))).toBeGreaterThan(2000);
  await cover(page, 'climate');
  expect((await rows()).at(-1)).toBe('Data: Beck et al. 2018 (CC BY 4.0)');
  // With the title box, the box says whose the data is.
  await tick(page, 'Title box');
  expect(await picture(page, 'picture.overlay.plate.box.lines.at(-1).text')).toBe('Data: Natural Earth, Beck et al. 2018 (CC BY 4.0)');
  expect((await rows()).some((text) => text.startsWith('Data'))).toBe(false);
  // The legend goes where it is put, and can be left out.
  const at = () => picture<{ x: number; y: number }>(page, '({ x: picture.overlay.plate.legend.x, y: picture.overlay.plate.legend.y })');
  const low = await at();
  await side(page).getByRole('radiogroup', { name: 'Legend place' }).getByRole('radio', { name: 'Top left' }).check();
  await pictured(page);
  expect((await at()).y).toBeLessThan(low.y - 100);
  await box(page, 'Legend').uncheck();
  await pictured(page);
  expect(await picture(page, 'picture.overlay.plate.legend')).toBeNull();
  await cover(page, 'none');
  expect((await sceneLayers(page)).filter((name) => /^political/.test(name))).toHaveLength(5);
  // The map as it is explored has none of it.
  await page.keyboard.press('Escape');
  expect((await page.evaluate(() => Object.keys((window as any).__app.scene.layers))).filter((name) => /height|biomes|climate/.test(name))).toEqual([]);
});

test('ice, time zones, the date line, provinces and the plates are layers of the picture, with volcanoes and earthquakes marked', async ({ page }) => {
  await onRobinson(page);
  await tick(page, 'Ice', 'Time zones', 'Date line', 'States and provinces', 'Tectonic plates', 'Volcanoes', 'Earthquakes');
  expect(await sceneLayers(page)).toEqual(expect.arrayContaining(['ice', 'zonesOdd', 'zonesPart', 'zoneLines', 'dateLine', 'provinces', 'plates']));
  expect(await countOf(page, rgb(ATLAS.ice), 4)).toBeGreaterThan(3000);
  const kinds = await picture<Record<string, number>>(page, 'picture.overlay.marks.reduce((count, mark) => ({ ...count, [mark.kind]: (count[mark.kind] ?? 0) + 1 }), {})');
  expect(kinds.volcano).toBeGreaterThan(1000);
  expect(kinds.quake).toBeGreaterThan(1000);
  // The hours of the zones are written across the picture, and the legend says what the marks are.
  expect(await picture(page, 'picture.overlay.labels.filter((label) => label.kind === "zone").map((label) => label.text)')).toEqual(expect.arrayContaining(['UTC', '+1', '−5']));
  expect(await picture(page, 'picture.overlay.plate.legend.texts.map((text) => text.text)')).toEqual(expect.arrayContaining(['Ice', 'Plate boundary', 'Volcano', 'Date line']));
  await box(page, 'Volcanoes').uncheck();
  await box(page, 'Earthquakes').uncheck();
  await pictured(page);
  expect(await picture(page, 'picture.overlay.marks.length')).toBe(0);
});

test('capitals, cities, peaks and the regions of the land are named, and a city that is dragged leaves its mark behind', async ({ page }) => {
  await onRobinson(page);
  const texts = (kind: string) => picture<string[]>(page, `picture.overlay.labels.filter((label) => label.kind === ${JSON.stringify(kind)}).map((label) => label.text)`);
  await tick(page, 'Capitals');
  const capitals = await texts('capital');
  expect(capitals).toEqual(expect.arrayContaining(['Tokyo', 'Moscow']));
  expect(await texts('city')).toEqual([]);
  await tick(page, 'Cities', 'Peaks', 'Ranges and deserts');
  expect((await texts('city')).length).toBeGreaterThan(10);
  const slider = side(page).getByRole('slider', { name: 'Smallest name' });
  await expect(slider).toBeEnabled();
  const before = (await texts('city')).length;
  await slider.evaluate((el: HTMLInputElement) => {
    el.value = '2';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction((n) => (window as any).__export.settled && (window as any).__export.picture.overlay.labels.filter((label: any) => label.kind === 'city').length > n, before);
  expect((await texts('peak')).some((text) => /\d{4}$/.test(text))).toBe(true);
  expect((await texts('region')).length).toBeGreaterThan(3);

  // A capital far from the rest, dragged by its name: the name goes, and the mark stays on the city.
  const place = () =>
    page.evaluate(() => {
      const { picture } = (window as any).__export;
      const label = picture.overlay.labels.find((l: any) => l.text === 'Wellington');
      const canvas = document.querySelector<HTMLCanvasElement>('.preview-canvas')!.getBoundingClientRect();
      const { width, height } = picture.exported.size;
      const s = Math.min((canvas.width - 56) / width, (canvas.height - 56) / height);
      const [x, y] = label.discs[1];
      return { x: canvas.left + canvas.width / 2 + s * (x - width / 2), y: canvas.top + canvas.height / 2 + s * (y - height / 2), letter: label.glyphs[0].x, mark: label.mark.x };
    });
  const from = await place();
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x - 20, from.y + 8, { steps: 4 });
  await page.mouse.move(from.x - 40, from.y + 16, { steps: 4 });
  await page.mouse.up();
  const to = await place();
  expect(to.letter).toBeLessThan(from.letter - 20);
  expect(to.mark).toBe(from.mark);
});

test('the title box and the legend have a colour of their own, and all of it is kept and is in an exported drawing', async ({ page }) => {
  await onRobinson(page);
  await cover(page, 'height');
  await tick(page, 'Title box', 'Capitals', 'Tectonic plates');
  await side(page).locator('summary', { hasText: 'Colours' }).click();
  await side(page).locator('[id^="colour-box-"]').fill('#ffe9a8');
  await side(page).locator('[id^="colour-high-"]').fill('#804020');
  await pictured(page);
  expect(await picture(page, 'picture.snap.style.box')).toBe('#ffe9a8');
  expect(await picture(page, 'picture.snap.style.height[5]')).toBe('#804020');
  expect(await countOf(page, [255, 233, 168], 6)).toBeGreaterThan(2000);

  await side(page).getByRole('radio', { name: 'SVG' }).check();
  await pictured(page);
  await page.evaluate(() => {
    const make = URL.createObjectURL;
    URL.createObjectURL = (blob: Blob) => {
      (window as any).__made = blob;
      return make(blob);
    };
  });
  await Promise.all([page.waitForEvent('download'), side(page).getByRole('button', { name: 'Export' }).click()]);
  const svg = await page.evaluate(() => ((window as any).__made as Blob).text());
  expect(svg).toContain('<clipPath id="within-land"><use href="#land-shape"/></clipPath>');
  expect(svg).toMatch(/<g id="height5" clip-path="url\(#within-land\)">\s*<path fill-rule="nonzero" fill="#804020"/);
  expect(svg).toContain('<g id="plates">');
  expect(svg).toContain('<g id="legend"');
  expect(svg).toMatch(/<g id="capitals"[^>]*>\s*<circle/);
  expect(svg).toContain('fill="#ffe9a8"');
  expect(svg).toContain('NOAA ETOPO5');

  await page.reload();
  await page.waitForFunction(() => (window as any).__app !== undefined);
  await openExport(page);
  await expect(side(page).getByRole('combobox', { name: 'Land colours' })).toHaveValue('height');
  for (const name of ['Title box', 'Capitals', 'Tectonic plates', 'Legend']) await expect(box(page, name)).toBeChecked();
  expect(await picture(page, 'picture.snap.style.box')).toBe('#ffe9a8');
});
