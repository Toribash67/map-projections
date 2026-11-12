import { expect, test, type Page } from '@playwright/test';
import type { Shape } from '../src/drawing/model';
import { compile } from '../src/projections/compile';
import type { LonLat, ProjectionState } from '../src/projections/types';
import { projectPoint, type ScreenTransform } from '../src/screen/screen';
import { open, pick, settle } from './support';

// A phone: taps, no keyboard for Enter, and a double tap the map cannot rely on.
test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const model = (page: Page) =>
  page.evaluate(() => {
    const m = (window as any).__drawing;
    return JSON.parse(JSON.stringify({ shapes: m.shapes, draft: m.draft, notice: m.notice }));
  }) as Promise<{ shapes: Shape[]; draft: Shape | null; notice: string | null }>;

/** Taps the map where it draws a geographic point. */
async function tapAt(page: Page, p: LonLat) {
  const { state, screen } = await page.evaluate(() => {
    const a = (window as any).__app;
    return { state: JSON.parse(JSON.stringify(a.state)) as ProjectionState, screen: a.live.screen as ScreenTransform };
  });
  const [x, y] = projectPoint(compile(state), screen, p);
  const box = (await page.locator('#map').boundingBox())!;
  await page.touchscreen.tap(box.x + x, box.y + y);
}

test('on a touch screen, Finish ends a line or a polygon, as Enter does, and is only on while there is one to finish', async ({ page }) => {
  await open(page);
  await pick(page, 'mercator');
  await settle(page);
  // Shapes that follow the globe, which keep their corners as they were tapped.
  await page.locator('#tools [data-mode]').tap();
  const finish = button(page, 'Finish');
  await expect(finish).toBeDisabled();
  await button(page, 'Line').tap();
  await expect(finish).toBeDisabled();
  await tapAt(page, [-40, 0]);
  await expect(finish).toBeDisabled();
  await tapAt(page, [40, 20]);
  await expect(finish).toBeEnabled();
  await finish.tap();
  let m = await model(page);
  expect(m.shapes).toHaveLength(1);
  expect(m.shapes[0]!.kind).toBe('line');
  expect(m.draft).toBeNull();
  await expect(finish).toBeDisabled();

  await button(page, 'Polygon').tap();
  for (const p of [[-40, -10], [0, -10], [0, 30]] as LonLat[]) await tapAt(page, p);
  await expect(finish).toBeEnabled();
  await finish.tap();
  m = await model(page);
  expect(m.shapes.map((s) => s.kind)).toEqual(['line', 'polygon']);
});

test('on a touch screen, Finish refuses a polygon whose closing edge would cross, with the same notice as Enter', async ({ page }) => {
  await open(page);
  await pick(page, 'mercator');
  await settle(page);
  await button(page, 'Polygon').tap();
  for (const p of [[-40, 0], [0, 0], [0, 40], [40, 20]] as LonLat[]) await tapAt(page, p);
  await button(page, 'Finish').tap();
  await expect(page.locator('.draw-notice')).toContainText(/clos/i);
  const m = await model(page);
  expect(m.shapes).toHaveLength(0);
  expect((m.draft as { points: LonLat[] }).points).toHaveLength(4);
});
