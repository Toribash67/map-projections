import { expect, test, type Page } from '@playwright/test';
import { stops } from '../src/projections/catalog';
import { open, pick, settle, state } from './support';

const sliderNames = (page: Page) => page.locator('#parameters').getByRole('slider').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') ?? (el as HTMLInputElement).labels?.[0]?.textContent ?? ''));
const onMap = async (page: Page, id: string) => {
  await open(page);
  await pick(page, id);
  await settle(page);
};

test('the sidebar has no descriptions: no hints, no notes, no explainers', async ({ page }) => {
  await open(page);
  await expect(page.locator('.hint, .note, .limits, #tissot-note')).toHaveCount(0);
  for (const id of ['globe', 'mollweide', 'albers', 'gnomonic', 'azimuthal-equidistant']) {
    await pick(page, id);
    await settle(page);
    const text = (await page.locator('#sidebar').innerText()).toLowerCase();
    for (const phrase of ['choose a tool', 'each ellipse', 'at its limits', 'is off', 'choose a projection', 'keeps ', 'click to place']) expect(text, `${id}: ${phrase}`).not.toContain(phrase);
    await expect(page.locator('#sidebar p')).toHaveCount(0);
  }
});

test('the parameters are those of the map on screen and no others: what does not apply is absent, not greyed out', async ({ page }) => {
  await open(page);
  expect(await sliderNames(page)).toEqual(['Longitude', 'Latitude']);
  const expected: Record<string, string[]> = {
    mollweide: ['Longitude', 'Latitude', 'Tilt'],
    albers: ['First parallel', 'Second parallel', 'Longitude'],
    mercator: ['Standard parallel', 'Vertical spacing', 'Longitude', 'Latitude', 'Tilt'],
    stereographic: ['Viewpoint', 'Longitude', 'Latitude'],
    'azimuthal-equidistant': ['Longitude', 'Latitude'],
    goode: ['Longitude', 'Latitude', 'Tilt'],
  };
  for (const [id, names] of Object.entries(expected)) {
    await pick(page, id);
    await settle(page);
    expect(await sliderNames(page), id).toEqual(names);
    await expect(page.locator('#parameters :disabled'), id).toHaveCount(0);
    await expect(page.locator('#parameters').getByRole('radiogroup', { name: 'Preserves' }), id).toHaveCount(id === 'albers' ? 1 : 0);
    await expect(page.locator('#parameters').getByRole('button', { name: 'Reset all', exact: true })).toBeVisible();
  }
});

test('the heading of the parameters names the map: a stop, Custom, or what a slider has made of it', async ({ page }) => {
  await onMap(page, 'mercator');
  const heading = page.locator('#parameters h2');
  await expect(heading).toHaveText('Mercator');
  await page.getByRole('slider', { name: 'Vertical spacing', exact: true }).evaluate((el: HTMLInputElement) => {
    el.value = '0.5';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(heading).toHaveText('Custom');
  await expect(page.locator('.stop[aria-current="true"]')).toHaveCount(0);
  await pick(page, 'lambert-conformal');
  await settle(page);
  await page.evaluate(() => (window as any).__app.setLive({ params: { p1: 0, p2: 0 } }));
  await expect(heading).toHaveText('Mercator (cone limit)');
  // The list marks the conic it is, not the map it has become.
  await expect(page.locator('.stop[aria-current="true"]')).toHaveCount(0);
});

test('every projection has a tag for what it preserves, in words, and its note as a tip', async ({ page }) => {
  await open(page);
  for (const stop of stops) {
    const button = page.locator(`[data-stop="${stop.id}"]`);
    await expect(button, stop.id).toHaveAttribute('aria-description', stop.note);
    const tag = button.locator('.tag');
    if (stop.preserves === 'none') await expect(tag, stop.id).toHaveCount(0);
    else await expect(tag, stop.id).toHaveText(stop.preserves);
  }
  const mercator = page.locator('[data-stop="mercator"]');
  await mercator.hover();
  await expect(page.getByRole('tooltip')).toContainText('suits navigation', { timeout: 2000 });
});

test('the filter narrows the list by name and by what is preserved, and hides a family with nothing left', async ({ page }) => {
  await open(page);
  const visible = () => page.locator('.stop:visible').evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.stop));
  const all = await visible();
  expect(all).toHaveLength(stops.length);
  await page.locator('#filter').fill('Equal');
  const equal = await visible();
  expect(equal.sort()).toEqual(stops.filter((s) => s.preserves === 'equal-area' || /equal/i.test(s.name)).map((s) => s.id).sort());
  await expect(page.locator('[data-family="globe"]')).toBeHidden();
  await page.locator('#filter').fill('merc');
  expect(await visible()).toEqual(['mercator', 'transverse-mercator']);
  await page.locator('#filter').fill('zzz');
  expect(await visible()).toEqual([]);
  await page.locator('#filter').fill('');
  expect(await visible()).toEqual(all);
});

test('every control that applies is in the window without scrolling, for every projection, on a small laptop', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await open(page);
  for (const stop of stops) {
    await pick(page, stop.id);
    await settle(page);
    const box = (await page.locator('#parameters').boundingBox())!;
    expect(box.y, stop.id).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height, stop.id).toBeLessThanOrEqual(720);
    // Nothing of it is scrolled out of sight within itself.
    const hidden = await page.locator('#parameters').evaluate((el) => el.scrollHeight - el.clientHeight);
    expect(hidden, stop.id).toBeLessThanOrEqual(1);
    // And the list still has room for a good few rows.
    const list = (await page.locator('.projection-list').boundingBox())!;
    expect(list.height, stop.id).toBeGreaterThan(200);
  }
});

test('the keys L, P and C choose the drawing tools and T turns the indicatrices on and off, but not while typing', async ({ page }) => {
  await onMap(page, 'mollweide');
  await page.locator('#map').click({ position: { x: 5, y: 5 } });
  const tool = () => page.evaluate(() => (window as any).__drawing.tool);
  for (const [key, name] of [['l', 'line'], ['p', 'polygon'], ['c', 'circle']] as const) {
    await page.keyboard.press(key);
    expect(await tool()).toBe(name);
    await expect(page.locator(`#tools [data-tool="${name}"]`)).toHaveAttribute('aria-pressed', 'true');
  }
  // The same key again puts the tool down.
  await page.keyboard.press('c');
  expect(await tool()).toBe('none');
  await page.keyboard.press('t');
  expect(await page.evaluate(() => (window as any).__app.tissot)).toBe(true);
  await page.keyboard.press('T');
  expect(await page.evaluate(() => (window as any).__app.tissot)).toBe(false);

  await page.locator('#filter').focus();
  await page.keyboard.type('lpct');
  expect(await tool()).toBe('none');
  expect(await page.evaluate(() => (window as any).__app.tissot)).toBe(false);
  await expect(page.locator('#filter')).toHaveValue('lpct');
});

test('the map has the window beside a 260 pixel sidebar, and its controls float on it', async ({ page }) => {
  await open(page);
  const map = (await page.locator('#map').boundingBox())!;
  expect([map.x, map.y, map.width, map.height]).toEqual([260, 0, 1000, 600]);
  const inMap = async (selector: string) => {
    const box = (await page.locator(selector).boundingBox())!;
    expect(box.x, selector).toBeGreaterThanOrEqual(map.x);
    expect(box.x + box.width, selector).toBeLessThanOrEqual(map.x + map.width);
    return box;
  };
  const [tools, actions, zoom] = [await inMap('#tools'), await inMap('#actions'), await inMap('#zoom')];
  expect(tools.x - map.x).toBeLessThan(40);
  expect(tools.y).toBeLessThan(40);
  expect(map.x + map.width - (actions.x + actions.width)).toBeLessThan(40);
  expect(actions.y).toBeLessThan(40);
  expect(zoom.x - map.x).toBeLessThan(40);
  expect(600 - (zoom.y + zoom.height)).toBeLessThan(40);
  await pick(page, 'mollweide');
  await settle(page);
  const locator = await inMap('#locator');
  expect(600 - (locator.y + locator.height)).toBeLessThan(40);
});

test('every button on the map and in the parameters says what it does in a tip of the app\'s own, not the browser\'s', async ({ page }) => {
  await onMap(page, 'mercator');
  const described = await page.locator('#stage button, #parameters button').evaluateAll((els) => els.map((el) => ({ label: el.getAttribute('aria-label') ?? el.textContent, tip: el.getAttribute('aria-description'), title: el.getAttribute('title') })));
  expect(described.length).toBeGreaterThan(12);
  for (const d of described) {
    expect(d.tip, `${d.label}`).toBeTruthy();
    expect(d.title, `${d.label}`).toBeNull();
  }
});

test('on a narrow screen the map is above the controls, with its own controls still on it', async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 800 });
  await onMap(page, 'mollweide');
  const [map, sidebar, tools] = [(await page.locator('#map').boundingBox())!, (await page.locator('#sidebar').boundingBox())!, (await page.locator('#tools').boundingBox())!];
  expect(map.width).toBe(400);
  expect(sidebar.y).toBeGreaterThanOrEqual(map.y + map.height - 1);
  expect(tools.y + tools.height).toBeLessThanOrEqual(map.y + map.height);
  expect((await state(page)).defId).toBe('mollweide');
});
