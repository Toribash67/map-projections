import { expect, test, type Page } from '@playwright/test';
import type { Shape } from '../src/drawing/model';
import { compile } from '../src/projections/compile';
import type { LonLat, ProjectionState } from '../src/projections/types';
import { isClipped, projectPoint, type ScreenTransform } from '../src/screen/screen';
import { mapStyle } from '../src/render/style';
import { isMorphing, numberBox, open, pick, settle, state } from './support';

// The tests run in light mode, as the browser is told to, unless one says otherwise.
const LIGHT_STYLE = mapStyle('light');

type Pair = [number, number];

const tool = (page: Page, name: 'Line' | 'Polygon' | 'Circle') => page.getByRole('button', { name, exact: true });
const notice = (page: Page) => page.locator('.draw-notice');
const readout = (page: Page) => page.locator('.draw-readout');
const model = (page: Page) =>
  page.evaluate(() => {
    const m = (window as any).__drawing;
    return JSON.parse(JSON.stringify({ shapes: m.shapes, draft: m.draft, notice: m.notice, tool: m.tool }));
  }) as Promise<{ shapes: Shape[]; draft: Shape | null; notice: string | null; tool: string }>;
const draftPoints = async (page: Page): Promise<LonLat[]> => ((await model(page)).draft as { points: LonLat[] } | null)?.points ?? [];

const canvasBox = async (page: Page) => (await page.locator('#map').boundingBox())!;
const centreOf = async (page: Page): Promise<Pair> => {
  const box = await canvasBox(page);
  return [box.width / 2, box.height / 2];
};

/** The map at rest: its state and the fit it is drawn with. */
const atRest = (page: Page) =>
  page.evaluate(() => {
    const a = (window as any).__app;
    return { state: JSON.parse(JSON.stringify(a.state)) as ProjectionState, screen: a.live.screen as ScreenTransform };
  });

/** Where the map draws a geographic point, in canvas pixels. */
async function whereIs(page: Page, p: LonLat): Promise<Pair> {
  const { state: s, screen } = await atRest(page);
  return projectPoint(compile(s), screen, p);
}

/** Clicks the map where it draws a geographic point. */
async function clickAt(page: Page, p: LonLat, options?: { clickCount?: number }) {
  const [x, y] = await whereIs(page, p);
  const box = await canvasBox(page);
  await page.mouse.click(box.x + x, box.y + y, options);
}

const frames = (page: Page, count = 2) =>
  page.evaluate(
    (count) =>
      new Promise<void>((done) => {
        const next = (left: number) => (left <= 0 ? done() : requestAnimationFrame(() => next(left - 1)));
        next(count);
      }),
    count,
  );

/** The pieces of the drawings layer as last drawn: whether closed, and their points as x, y pairs. */
const drawnPieces = (page: Page) =>
  page.evaluate(() => {
    const scene = (window as any).__app.scene;
    return scene.layers.drawings.map((p: any) => ({ closed: p.closed as boolean, points: [...p.src] as number[], starts: [...p.ringStarts] as number[] }));
  }) as Promise<{ closed: boolean; points: number[]; starts: number[] }[]>;

const countOf = (page: Page, colour: number[]) =>
  page.evaluate((colour) => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas')!;
    const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (Math.abs(data[i]! - colour[0]!) + Math.abs(data[i + 1]! - colour[1]!) + Math.abs(data[i + 2]! - colour[2]!) < 24) count++;
    }
    return count;
  }, colour);
const ACCENT = [1, 3, 5].map((i) => parseInt(LIGHT_STYLE.accent.slice(i, i + 2), 16));

const setShapes = (page: Page, shapes: Shape[]) =>
  page.evaluate((shapes) => {
    const app = (window as any).__app;
    app.shapes = shapes;
    app.invalidateGeometry();
  }, shapes);

test('Enter and double-click finish, Escape cancels', async ({ page }) => {
  await open(page);
  await tool(page, 'Line').click();
  await clickAt(page, [-30, 10]);
  await clickAt(page, [20, 30]);
  expect(await draftPoints(page)).toHaveLength(2);
  await page.keyboard.press('Enter');
  let m = await model(page);
  expect(m.draft).toBeNull();
  expect(m.shapes).toHaveLength(1);

  // The double-click places its point once.
  await clickAt(page, [-20, -20]);
  await clickAt(page, [30, -10], { clickCount: 2 });
  m = await model(page);
  expect(m.draft).toBeNull();
  expect(m.shapes).toHaveLength(2);
  expect((m.shapes[1] as { points: LonLat[] }).points).toHaveLength(2);

  await clickAt(page, [-10, 40]);
  await clickAt(page, [10, 50]);
  await page.keyboard.press('Escape');
  m = await model(page);
  expect(m.draft).toBeNull();
  expect(m.shapes).toHaveLength(2);

  // A polygon closes the same way.
  await tool(page, 'Polygon').click();
  await clickAt(page, [-30, -30]);
  await clickAt(page, [30, -30]);
  await clickAt(page, [0, 30], { clickCount: 2 });
  m = await model(page);
  expect(m.shapes).toHaveLength(3);
  expect((m.shapes[2] as { points: LonLat[] }).points).toHaveLength(3);
});

test('typing in a sidebar input does not draw: Enter and Escape stay with the input', async ({ page }) => {
  await open(page);
  await pick(page, 'robinson');
  await settle(page);
  await tool(page, 'Line').click();
  await clickAt(page, [-30, 10]);
  await clickAt(page, [20, 30]);
  const box = numberBox(page, 'Longitude');
  await box.fill('40');
  await box.press('Enter');
  // The typed value moves the map there by a slide.
  await settle(page);
  expect((await state(page)).orientation.lon).toBe(40);
  expect(await draftPoints(page)).toHaveLength(2);
  await box.fill('50');
  await box.press('Escape');
  expect(await draftPoints(page)).toHaveLength(2);
  // Back on the map, the keys are the tools' again.
  await page.locator('#map').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Escape');
  expect(await draftPoints(page)).toHaveLength(0);
});

test('a click outside the map places no point', async ({ page }) => {
  await open(page);
  await tool(page, 'Line').click();
  const box = await canvasBox(page);
  // The corner of the canvas is off the globe.
  await page.mouse.click(box.x + 4, box.y + 4);
  expect((await model(page)).draft).toBeNull();
  const middle = await centreOf(page);
  await page.mouse.click(box.x + middle[0], box.y + middle[1]);
  expect(await draftPoints(page)).toHaveLength(1);
});

test('a click during a morph places no point', async ({ page }) => {
  await open(page);
  await tool(page, 'Line').click();
  await pick(page, 'mercator');
  expect(await isMorphing(page)).toBe(true);
  const [x, y] = await centreOf(page);
  const box = await canvasBox(page);
  await page.mouse.click(box.x + x, box.y + y);
  expect((await model(page)).draft).toBeNull();
  await settle(page);
  await page.mouse.click(box.x + x, box.y + y);
  expect(await draftPoints(page)).toHaveLength(1);
});

test('a shape drawn on the globe appears on Mercator and survives a morph', async ({ page }) => {
  await open(page);
  await tool(page, 'Polygon').click();
  for (const p of [[-30, -20], [30, -20], [30, 25], [-30, 25]] as LonLat[]) await clickAt(page, p);
  await page.keyboard.press('Enter');
  await tool(page, 'Circle').click();
  await clickAt(page, [0, 0]);
  await clickAt(page, [0, 12]);
  const drawn = (await model(page)).shapes;
  expect(drawn.map((s) => s.kind)).toEqual(['polygon', 'circle']);
  await frames(page);
  const onGlobe = await countOf(page, ACCENT);
  expect(onGlobe).toBeGreaterThan(300);

  await pick(page, 'mercator');
  await page.waitForTimeout(500);
  await frames(page);
  expect(await countOf(page, ACCENT)).toBeGreaterThan(200);
  await settle(page);
  await frames(page);
  expect(await countOf(page, ACCENT)).toBeGreaterThan(300);
  // Stored as latitude and longitude, unchanged by the map.
  expect((await model(page)).shapes).toEqual(drawn);
  // On Mercator a click puts a point where the map says, not where the globe had it.
  await tool(page, 'Line').click();
  await clickAt(page, [100, 40]);
  const [placed] = await draftPoints(page);
  expect(Math.abs(placed![0] - 100)).toBeLessThan(0.5);
  expect(Math.abs(placed![1] - 40)).toBeLessThan(0.5);
});

test('drag with a tool active moves the map and adds no point', async ({ page }) => {
  await open(page);
  await tool(page, 'Polygon').click();
  const [x, y] = await centreOf(page);
  const box = await canvasBox(page);
  const before = (await state(page)).orientation;
  await page.mouse.move(box.x + x, box.y + y);
  await page.mouse.down();
  await page.mouse.move(box.x + x + 80, box.y + y + 30, { steps: 6 });
  await page.mouse.up();
  expect((await state(page)).orientation).not.toEqual(before);
  expect((await model(page)).draft).toBeNull();
});

test('circle tool shows a km readout while previewing', async ({ page }) => {
  await open(page);
  await pick(page, 'mercator');
  await settle(page);
  await tool(page, 'Circle').click();
  await expect(readout(page)).toBeHidden();
  await clickAt(page, [0, 0]);
  const [x, y] = await whereIs(page, [0, 10]);
  const box = await canvasBox(page);
  await page.mouse.move(box.x + x, box.y + y, { steps: 3 });
  await expect(readout(page)).toBeVisible();
  const km = Number((await readout(page).textContent())!.replace(/[^0-9.]/g, ''));
  // 10 degrees of a great circle on a sphere of 6371 km.
  expect(Math.abs(km - 1112)).toBeLessThan(20);
  // The circle follows the cursor, and is not a shape until the second click.
  expect((await model(page)).shapes).toHaveLength(0);
  expect(await page.evaluate(() => (window as any).__app.shapes.length)).toBe(1);
  await page.mouse.click(box.x + x, box.y + y);
  await expect(readout(page)).toBeHidden();
  expect((await model(page)).shapes).toHaveLength(1);
});

test('a line crossing the antimeridian is broken at the seam: no segment wider than half the map', async ({ page }) => {
  await open(page);
  await pick(page, 'mercator');
  await settle(page);
  await tool(page, 'Line').click();
  await clickAt(page, [160, 20]);
  await clickAt(page, [-160, 40]);
  await page.keyboard.press('Enter');
  await frames(page);
  const width = Math.abs((await whereIs(page, [179.999, 0]))[0] - (await whereIs(page, [-179.999, 0]))[0]);
  const pieces = await drawnPieces(page);
  expect(pieces.length).toBeGreaterThanOrEqual(2);
  let widest = 0;
  for (const piece of pieces) {
    for (let i = 2; i < piece.points.length; i += 2) widest = Math.max(widest, Math.abs(piece.points[i]! - piece.points[i - 2]!));
  }
  expect(widest).toBeGreaterThan(0);
  expect(widest).toBeLessThan(width / 2);
  // It reaches both edges of the map.
  const xs = pieces.flatMap((p) => p.points.filter((_, i) => i % 2 === 0));
  expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(width * 0.98);
});

test('a polygon point that would cross an edge is refused with a message that the next point clears', async ({ page }) => {
  await open(page);
  await pick(page, 'mercator');
  await settle(page);
  await tool(page, 'Polygon').click();
  await expect(notice(page)).toBeHidden();
  for (const p of [[-40, 0], [40, 0], [40, 40]] as LonLat[]) await clickAt(page, p);
  await clickAt(page, [0, -30]);
  await expect(notice(page)).toBeVisible();
  await expect(notice(page)).toContainText(/cross/i);
  expect(await draftPoints(page)).toHaveLength(3);
  await clickAt(page, [-40, 40]);
  await expect(notice(page)).toBeHidden();
  expect(await draftPoints(page)).toHaveLength(4);
});

test('a finish whose closing edge would cross is refused', async ({ page }) => {
  await open(page);
  await pick(page, 'mercator');
  await settle(page);
  await tool(page, 'Polygon').click();
  for (const p of [[-40, 0], [0, 0], [0, 40], [40, 20]] as LonLat[]) await clickAt(page, p);
  await page.keyboard.press('Enter');
  await expect(notice(page)).toContainText(/clos/i);
  expect((await model(page)).shapes).toHaveLength(0);
  expect(await draftPoints(page)).toHaveLength(4);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(notice(page)).toBeHidden();
  await page.evaluate(() => (document.activeElement as HTMLElement).blur());
  await page.keyboard.press('Enter');
  expect((await model(page)).shapes).toHaveLength(1);
});

test('Undo takes back the last point, then the last shape; Clear removes everything', async ({ page }) => {
  await open(page);
  await tool(page, 'Line').click();
  await clickAt(page, [-30, 0]);
  await clickAt(page, [30, 0]);
  await page.keyboard.press('Enter');
  await clickAt(page, [-30, 20]);
  await clickAt(page, [30, 20]);
  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  const clear = page.getByRole('button', { name: 'Clear', exact: true });
  await undo.click();
  expect(await draftPoints(page)).toHaveLength(1);
  await undo.click();
  await undo.click();
  expect((await model(page)).shapes).toHaveLength(0);
  await expect(undo).toBeDisabled();
  await clickAt(page, [-30, 20]);
  await clickAt(page, [30, 20]);
  await page.keyboard.press('Enter');
  await clear.click();
  expect((await model(page)).shapes).toHaveLength(0);
  expect(await page.evaluate(() => (window as any).__app.shapes.length)).toBe(0);
});

test('a tool button toggles its tool, and only one is on', async ({ page }) => {
  await open(page);
  await tool(page, 'Line').click();
  await expect(tool(page, 'Line')).toHaveAttribute('aria-pressed', 'true');
  await tool(page, 'Circle').click();
  await expect(tool(page, 'Line')).toHaveAttribute('aria-pressed', 'false');
  await expect(tool(page, 'Circle')).toHaveAttribute('aria-pressed', 'true');
  await tool(page, 'Circle').click();
  await expect(tool(page, 'Circle')).toHaveAttribute('aria-pressed', 'false');
  expect((await model(page)).tool).toBe('none');
});

// A line drawn anywhere stays exactly straight in gnomonic while the centre is dragged.
test('a line stays straight in gnomonic while the centre is dragged', async ({ page }) => {
  await open(page);
  await pick(page, 'gnomonic');
  await settle(page);
  const lines: LonLat[][] = [
    [[-60, -20], [40, 30]],
    [[10, -60], [20, 50]],
    // Across most of the disc.
    [[-70, 5], [70, 5]],
    // Out of view to begin with, and brought in by the drag.
    [[120, 10], [-100, 40]],
    [[30, -70], [-100, -10]],
    [[0, 80], [100, -30]],
  ];
  const [cx, cy] = await centreOf(page);
  const box = await canvasBox(page);
  // Steps of a drag that goes out and comes back by another way.
  const path: Pair[] = [[40, 15], [90, 30], [130, 10], [80, -50], [10, -70], [-50, -30], [-90, 20], [-30, 40], [0, 0]];
  let samples = 0;
  for (const points of lines) {
    await page.evaluate(() => (window as any).__app.setLive({ orientation: { lon: 0, lat: 0, tilt: 0 } }));
    await setShapes(page, [{ kind: 'line', points }]);
    await page.mouse.move(box.x + cx, box.y + cy);
    await page.mouse.down();
    for (const [dx, dy] of [[0, 0] as Pair, ...path]) {
      await page.mouse.move(box.x + cx + dx, box.y + cy + dy, { steps: 3 });
      await frames(page);
      const { state: s, screen } = await atRest(page);
      const compiled = compile(s);
      const pieces = await drawnPieces(page);
      const drawn: Pair[] = pieces.flatMap((p) => p.points.flatMap((_, i) => (i % 2 === 0 ? [[p.points[i]!, p.points[i + 1]!] as Pair] : [])));
      if (drawn.length < 2) continue;
      // The farthest apart two drawn points define the line; every other point lies on it.
      let [a, b] = [drawn[0]!, drawn[1]!];
      let far = 0;
      for (const p of drawn) for (const q of drawn) if (Math.hypot(p[0] - q[0], p[1] - q[1]) > far) [a, b, far] = [p, q, Math.hypot(p[0] - q[0], p[1] - q[1])];
      if (far < 20) continue;
      const deviation = Math.max(...drawn.map((p) => Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / far));
      expect(deviation, `${JSON.stringify(points)} at ${s.orientation.lon.toFixed(1)}, ${s.orientation.lat.toFixed(1)}`).toBeLessThan(0.5);
      // When both ends are on the map, the drawn line runs from one to the other.
      if (points.every((p) => !isClipped(compiled, p))) {
        const ends = points.map((p) => projectPoint(compiled, screen, p));
        const reach = (e: Pair) => Math.min(Math.hypot(e[0] - a[0], e[1] - a[1]), Math.hypot(e[0] - b[0], e[1] - b[1]));
        expect(Math.max(...ends.map(reach))).toBeLessThan(0.5);
      }
      samples++;
    }
    await page.mouse.up();
  }
  expect(samples).toBeGreaterThan(30);
});
