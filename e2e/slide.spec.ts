import { expect, test, type Page } from '@playwright/test';
import { isMorphing, isSliding, numberBox, openPaused, pick, state, stop } from './support';

const tilt = async (page: Page) => (await state(page)).orientation.tilt;
/** A clean start on a named projection, at rest, on the paused clock. */
async function startOn(page: Page, id: string) {
  await openPaused(page);
  await pick(page, id);
  await page.clock.runFor(1600);
  expect(await isMorphing(page)).toBe(false);
  expect(await isSliding(page)).toBe(false);
}

test('Mercator to Transverse Mercator is a slide: the tilt passes through every angle and no morph runs', async ({ page }) => {
  await startOn(page, 'mercator');
  await pick(page, 'transverse-mercator');
  await page.clock.runFor(600);
  expect(await isSliding(page)).toBe(true);
  expect(await isMorphing(page)).toBe(false);
  const mid = await tilt(page);
  expect(mid).toBeGreaterThan(0);
  expect(mid).toBeLessThan(90);
  await page.clock.runFor(1000);
  expect(await isSliding(page)).toBe(false);
  expect(await tilt(page)).toBe(90);
});

test('a slide moves the map every frame, as a real map', async ({ page }) => {
  await startOn(page, 'mercator');
  await pick(page, 'transverse-mercator');
  const seen: number[] = [];
  for (let i = 0; i < 6; i++) {
    await page.clock.runFor(200);
    seen.push(await tilt(page));
    // The map on screen is the state's own: a slide has no blend of two maps.
    expect(await page.evaluate(() => (window as any).__app.live !== null)).toBe(true);
  }
  for (let i = 1; i < seen.length; i++) expect(seen[i]!).toBeGreaterThan(seen[i - 1]!);
});

test('Mercator to Mollweide is an ordinary morph', async ({ page }) => {
  await startOn(page, 'mercator');
  await pick(page, 'mollweide');
  await page.clock.runFor(300);
  expect(await isMorphing(page)).toBe(true);
  expect(await isSliding(page)).toBe(false);
});

test('a live change takes over a slide where it is', async ({ page }) => {
  await startOn(page, 'mercator');
  await pick(page, 'transverse-mercator');
  await page.clock.runFor(400);
  const before = await tilt(page);
  expect(before).toBeGreaterThan(0);
  await page.evaluate(() => {
    const a = (window as any).__app;
    a.setLive({ orientation: { ...a.state.orientation } });
  });
  expect(await isSliding(page)).toBe(false);
  await page.clock.runFor(1500);
  expect(await tilt(page)).toBe(before);
});

test('a drag of the map during a slide stops the slide where it is and moves the map', async ({ page }) => {
  await startOn(page, 'mercator');
  await pick(page, 'transverse-mercator');
  await page.clock.runFor(400);
  const before = await state(page);
  const box = (await page.locator('#map').boundingBox())!;
  await page.mouse.move(box.x + 500, box.y + 300);
  await page.mouse.down();
  // A frame of the slide between each move, as a browser has them.
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(box.x + 500 + 10 * i, box.y + 300);
    await page.clock.runFor(16);
  }
  expect(await isSliding(page)).toBe(false);
  const held = await state(page);
  expect(held.orientation.tilt).toBeLessThan(before.orientation.tilt + 8);
  expect(Math.abs(held.orientation.lon - before.orientation.lon) + Math.abs(held.orientation.lat - before.orientation.lat)).toBeGreaterThan(3);
  await page.mouse.up();
  await page.clock.runFor(1600);
  expect((await state(page)).orientation.tilt).toBe(held.orientation.tilt);
});

test('a second value typed during a slide keeps where the first was going', async ({ page }) => {
  await startOn(page, 'mercator');
  const enter = async (name: string, text: string) => {
    const box = numberBox(page, name);
    await box.fill(text);
    await box.press('Enter');
  };
  await enter('Longitude', '100');
  await page.clock.runFor(500);
  expect(await isSliding(page)).toBe(true);
  await enter('Latitude', '40');
  await page.clock.runFor(1600);
  expect(await isSliding(page)).toBe(false);
  const { lon, lat } = (await state(page)).orientation;
  expect(lon).toBeCloseTo(100, 6);
  expect(lat).toBeCloseTo(40, 6);
});

test('another definition chosen mid-slide morphs from the map in between', async ({ page }) => {
  await startOn(page, 'mercator');
  await pick(page, 'transverse-mercator');
  await page.clock.runFor(400);
  await pick(page, 'mollweide');
  expect(await isSliding(page)).toBe(false);
  expect(await isMorphing(page)).toBe(true);
  // The morph starts from the map in between, whose tilt is neither end's.
  const source = await page.evaluate(() => (window as any).__app.controller.source()[0].compiled.state.orientation.tilt);
  expect(source).toBeGreaterThan(0);
  expect(source).toBeLessThan(90);
  await page.clock.runFor(1600);
  expect(await isMorphing(page)).toBe(false);
  expect((await state(page)).defId).toBe(stop('mollweide').defId);
});

test('the same definition chosen mid-slide slides on from the map in between', async ({ page }) => {
  await startOn(page, 'mercator');
  await pick(page, 'transverse-mercator');
  await page.clock.runFor(700);
  const mid = await tilt(page);
  await pick(page, 'mercator');
  expect(await isSliding(page)).toBe(true);
  expect(await tilt(page)).toBeCloseTo(mid, 6);
  await page.clock.runFor(1600);
  expect(await tilt(page)).toBe(0);
});

test('choosing the map already on screen starts nothing', async ({ page }) => {
  await startOn(page, 'mercator');
  await pick(page, 'mercator');
  expect(await isSliding(page)).toBe(false);
  expect(await isMorphing(page)).toBe(false);
});

test('input arriving in a storm during a slide and a morph throws nothing and ends on the last projection chosen', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await startOn(page, 'mercator');
  const box = (await page.locator('#map').boundingBox())!;
  const storm = async () => {
    await page.mouse.move(box.x + 500, box.y + 300);
    for (let i = 0; i < 20; i++) await page.mouse.wheel(0, i % 2 ? 40 : -40);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(box.x + 500 + 8 * i, box.y + 300 + 3 * i);
      await page.clock.runFor(16);
    }
    await page.mouse.up();
  };
  await pick(page, 'transverse-mercator'); // a slide
  await page.clock.runFor(200);
  await storm();
  await pick(page, 'mollweide'); // a morph
  await page.clock.runFor(200);
  await storm();
  for (const id of ['gall-peters', 'robinson', 'behrmann']) {
    await pick(page, id);
    await page.clock.runFor(50);
  }
  await page.clock.runFor(3200);
  expect(errors).toEqual([]);
  expect(await isMorphing(page)).toBe(false);
  expect(await isSliding(page)).toBe(false);
  const s = await state(page);
  expect(s.defId).toBe(stop('behrmann').defId);
  expect(s.params.phi0).toBe(30);
  expect(s.params.spacing).toBe(2);
});

const setLive = (page: Page, orientation: { lon: number; lat: number; tilt: number }) =>
  page.evaluate((o) => (window as any).__app.setLive({ orientation: o }), orientation);

test('reset all slides the map back', async ({ page }) => {
  await startOn(page, 'mollweide');
  await setLive(page, { lon: 80, lat: 30, tilt: 0 });
  await page.getByRole('button', { name: 'Reset all', exact: true }).click();
  await page.clock.runFor(500);
  expect(await isSliding(page)).toBe(true);
  const mid = (await state(page)).orientation;
  expect(mid.lon).toBeGreaterThan(0);
  expect(mid.lon).toBeLessThan(80);
  await page.clock.runFor(1200);
  expect((await state(page)).orientation).toEqual({ lon: 0, lat: 0, tilt: 0 });
});

test("a slider's own reset slides", async ({ page }) => {
  await startOn(page, 'mollweide');
  await setLive(page, { lon: 80, lat: 0, tilt: 0 });
  await page.getByRole('button', { name: 'Reset longitude', exact: true }).click();
  await page.clock.runFor(500);
  expect(await isSliding(page)).toBe(true);
  await page.clock.runFor(1200);
  expect((await state(page)).orientation.lon).toBe(0);
});

test('a typed value slides', async ({ page }) => {
  await startOn(page, 'mollweide');
  const box = page.getByRole('textbox', { name: 'Longitude, value', exact: true });
  await box.fill('60');
  await box.press('Enter');
  await page.clock.runFor(500);
  expect(await isSliding(page)).toBe(true);
  const mid = (await state(page)).orientation.lon;
  expect(mid).toBeGreaterThan(0);
  expect(mid).toBeLessThan(60);
  await page.clock.runFor(1200);
  expect((await state(page)).orientation.lon).toBe(60);
  await expect(box).toHaveValue('60°');
});

test('dragging a slider is still immediate', async ({ page }) => {
  await startOn(page, 'mollweide');
  await page.getByRole('slider', { name: 'Longitude', exact: true }).evaluate((el: HTMLInputElement) => {
    el.value = '45';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(await isSliding(page)).toBe(false);
  expect((await state(page)).orientation.lon).toBe(45);
});

test('the conic switch between conformal and equal-area is a morph, never a jump', async ({ page }) => {
  await startOn(page, 'albers');
  await page.getByRole('radio', { name: 'Conformal' }).check();
  expect(await isMorphing(page)).toBe(true);
  await page.clock.runFor(1600);
  expect(await isMorphing(page)).toBe(false);
  expect((await state(page)).defId).toBe('conic-conformal');
});
