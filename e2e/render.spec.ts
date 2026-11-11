import { expect, test, type Page } from '@playwright/test';
import { stops } from '../src/projections/catalog';
import { mapStyle } from '../src/render/style';
import type { Shape } from '../src/drawing/model';

// The tests run in light mode, as the browser is told to, unless one says otherwise.
const LIGHT_STYLE = mapStyle('light');

type Rgb = [number, number, number];

const stop = (id: string) => stops.find((s) => s.id === id)!;
const rgb = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
const near = (a: readonly number[], b: readonly number[], tolerance = 3) => a.slice(0, 3).every((v, i) => Math.abs(v - b[i]!) <= tolerance);

const BACKGROUND = rgb(LIGHT_STYLE.background);
const ACCENT = rgb(LIGHT_STYLE.accent);

/** A canvas pixel at CSS coordinates. */
const pixel = (page: Page, x: number, y: number): Promise<number[]> =>
  page.evaluate(([x, y]) => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas')!;
    const ratio = canvas.width / canvas.clientWidth;
    return [...canvas.getContext('2d')!.getImageData(Math.round(x! * ratio), Math.round(y! * ratio), 1, 1).data];
  }, [x, y]);

/** The bounds of everything that is not background, in backing store pixels, and the canvas size. */
const mapBox = (page: Page, background = BACKGROUND) =>
  page.evaluate((background) => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas')!;
    const { data, width, height } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
    let [left, right, top, bottom] = [Infinity, -Infinity, Infinity, -Infinity];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = 4 * (x + y * width);
        if (Math.abs(data[i]! - background[0]!) + Math.abs(data[i + 1]! - background[1]!) + Math.abs(data[i + 2]! - background[2]!) < 12) continue;
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
    return { left, right, top, bottom, width, height };
  }, background);

/** How many canvas pixels are close to a colour. */
const countOf = (page: Page, colour: Rgb) =>
  page.evaluate((colour) => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas')!;
    const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (Math.abs(data[i]! - colour[0]!) + Math.abs(data[i + 1]! - colour[1]!) + Math.abs(data[i + 2]! - colour[2]!) < 24) count++;
    }
    return count;
  }, colour);

const frames = (page: Page, count = 2) =>
  page.evaluate((count) => new Promise<void>((done) => {
    const next = (left: number) => (left <= 0 ? done() : requestAnimationFrame(() => next(left - 1)));
    next(count);
  }), count);

const open = async (page: Page) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__app !== undefined);
  await frames(page);
};

const select = (page: Page, id: string) => page.evaluate((s) => (window as any).__app.select(s), stop(id));
const isMorphing = (page: Page): Promise<boolean> => page.evaluate(() => (window as any).__app.isMorphing);
const settle = (page: Page) => page.waitForFunction(() => !(window as any).__app.isMorphing && !(window as any).__app.isSliding);

/** Opens the app on a clock that only moves when told to, and leaves it paused. */
const openPaused = async (page: Page) => {
  await page.clock.install({ time: 1000 });
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__app !== undefined);
  await page.clock.pauseAt(60_000);
  await page.clock.runFor(32);
};

test('opens on the globe with no console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await open(page);

  expect(await page.evaluate(() => (window as any).__app.state.defId)).toBe('globe');
  // Off the centre, which has the graticule's 0, 0 on it.
  const middle = await pixel(page, 524, 324);
  expect(near(middle, rgb(LIGHT_STYLE.land)) || near(middle, rgb(LIGHT_STYLE.ocean))).toBe(true);
  for (const [x, y] of [[2, 2], [997, 2], [2, 597], [997, 597]] as const) {
    expect(near(await pixel(page, x, y), BACKGROUND)).toBe(true);
  }
  // A globe fitted with 16 px padding.
  const box = await mapBox(page);
  expect(Math.abs(box.top - 16)).toBeLessThanOrEqual(2);
  expect(Math.abs(box.bottom - 583)).toBeLessThanOrEqual(2);
  expect(Math.abs(box.right + box.left - 999)).toBeLessThanOrEqual(2);
  expect(errors).toEqual([]);
});

test.describe('at device pixel ratio 2', () => {
  test.use({ deviceScaleFactor: 2 });

  test('canvas backing store matches devicePixelRatio 2', async ({ page }) => {
    await open(page);
    const size = await page.evaluate(() => {
      const canvas = document.querySelector('canvas')!;
      return { width: canvas.width, height: canvas.height, clientWidth: canvas.clientWidth, clientHeight: canvas.clientHeight, ratio: devicePixelRatio };
    });
    expect(size.ratio).toBe(2);
    expect(size.clientWidth).toBe(1000);
    expect(size.width).toBe(2000);
    expect(size.height).toBe(1200);
    // The map fills the larger store rather than staying in its top left corner.
    const box = await mapBox(page);
    expect(Math.abs(box.top - 32)).toBeLessThanOrEqual(3);
    expect(Math.abs(box.bottom - 1167)).toBeLessThanOrEqual(3);
  });
});

test('moving to a screen with another pixel ratio keeps the map sharp', async ({ page }) => {
  // Emulating a new ratio here fires neither the media query nor a resize, as a real move between screens does,
  // so the query's listener is caught and called by hand.
  await page.addInitScript(() => {
    const original = window.matchMedia.bind(window);
    (window as any).__ratioListeners = [];
    window.matchMedia = (query: string) => {
      const list = original(query);
      if (query.includes('resolution')) {
        list.addEventListener = (_type: string, fn: any) => void (window as any).__ratioListeners.push(fn);
      }
      return list;
    };
  });
  await open(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1260, height: 600, deviceScaleFactor: 2, mobile: false });
  await page.evaluate(() => {
    const listeners = (window as any).__ratioListeners;
    (window as any).__ratioListeners = [];
    for (const fn of listeners) fn();
  });
  await frames(page);
  expect(await page.evaluate(() => document.querySelector('canvas')!.width)).toBe(2000);
  const box = await mapBox(page);
  expect(Math.abs(box.bottom - 1167)).toBeLessThanOrEqual(3);
  // It listens again for the next change.
  expect(await page.evaluate(() => (window as any).__ratioListeners.length)).toBe(1);
});

test('resizing the window refits the map, including mid-morph', async ({ page }) => {
  await openPaused(page);
  await select(page, 'mollweide');
  await page.clock.runFor(700);
  expect(await isMorphing(page)).toBe(true);

  // Less the sidebar's 260, the map is 700 wide.
  await page.setViewportSize({ width: 960, height: 500 });
  await page.waitForFunction(() => document.querySelector('canvas')!.width === 700);

  // Mid-morph, with both ends refitted, so the blend between them fits too.
  const during = await mapBox(page);
  expect(during.width).toBe(700);
  expect(during.height).toBe(500);
  expect(during.left).toBeGreaterThanOrEqual(14);
  expect(during.right).toBeLessThanOrEqual(686);
  expect(during.top).toBeGreaterThanOrEqual(14);
  expect(during.bottom).toBeLessThanOrEqual(486);
  expect(await isMorphing(page)).toBe(true);

  await page.clock.runFor(800);
  expect(await isMorphing(page)).toBe(false);
  await page.clock.runFor(32);

  // Mollweide is twice as wide as tall, so at 700 x 500 its width is what fills the canvas.
  const after = await mapBox(page);
  expect(Math.abs(after.left - 16)).toBeLessThanOrEqual(2);
  expect(Math.abs(after.right - 683)).toBeLessThanOrEqual(2);
  expect(Math.abs((after.top + after.bottom) / 2 - 249.5)).toBeLessThanOrEqual(2);
  expect(after.bottom - after.top).toBeLessThan(0.55 * (after.right - after.left));
});

test('a morph settles on its target and draws what it shows at rest', async ({ page }) => {
  await openPaused(page);
  await select(page, 'mollweide');
  expect(await page.evaluate(() => (window as any).__app.state.defId)).toBe('mollweide');
  expect(await isMorphing(page)).toBe(true);
  await page.clock.runFor(1500);
  expect(await isMorphing(page)).toBe(false);
  // Left of the map's middle row, past the fitted ellipse's end: background, then the ocean or land of its rim.
  const box = await mapBox(page);
  expect(Math.abs(box.left - 16)).toBeLessThanOrEqual(2);
  expect(Math.abs(box.right - 983)).toBeLessThanOrEqual(2);
});

test('the first frame of a peel looks like the globe at rest: nothing of the far side shows through', async ({ page }) => {
  await openPaused(page);
  await page.evaluate(() => (window as any).__app.setTissot(true));
  await page.clock.runFor(32);
  const shot = () => page.evaluate(() => document.querySelector('canvas')!.toDataURL());
  const compare = (a: string, b: string) => page.evaluate(async ([a, b]) => {
    const read = async (url: string) => {
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = new OffscreenCanvas(image.width, image.height);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(image, 0, 0);
      return ctx.getImageData(0, 0, image.width, image.height).data;
    };
    const [x, y] = [await read(a!), await read(b!)];
    let changed = 0;
    for (let i = 0; i < x.length; i += 4) {
      if (Math.abs(x[i]! - y[i]!) + Math.abs(x[i + 1]! - y[i + 1]!) + Math.abs(x[i + 2]! - y[i + 2]!) > 60) changed++;
    }
    return changed;
  }, [a, b]);

  const rest = await shot();
  await select(page, 'mollweide');
  await page.clock.runFor(32);
  expect(await isMorphing(page)).toBe(true);
  const first = await shot();
  // Line ends and edges of the two cuts differ by a hair at most. A far-side ellipse or coast would be hundreds of pixels.
  expect(await compare(rest, first)).toBeLessThan(60);
});

test('mid-peel, the folded far side is still filled: no background inside the map along the equator', async ({ page }) => {
  await openPaused(page);
  await select(page, 'mollweide');
  // Eased t = 4u^3 = 0.4 at u = 0.464, 650 ms into the morph.
  await page.clock.runFor(650);
  const t = await page.evaluate(() => (window as any).__app.controller.t());
  expect(t).toBeGreaterThan(0.35);
  expect(t).toBeLessThan(0.45);
  // Rows near the equator, from the map's left edge to its centre, where the far side folds over.
  const holes = await page.evaluate((background) => {
    const canvas = document.querySelector('canvas')!;
    const { data, width } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
    const isBackground = (x: number, y: number) => {
      const i = 4 * (x + y * width);
      // Exactly the background: land under a faint line can come within a few levels of it.
      return Math.abs(data[i]! - background[0]!) + Math.abs(data[i + 1]! - background[1]!) + Math.abs(data[i + 2]! - background[2]!) < 2;
    };
    let holes = 0;
    for (let y = 240; y <= 360; y += 4) {
      let x = 0;
      while (x < width / 2 && isBackground(x, y)) x++;
      // Past the edge's anti-aliasing.
      for (x += 2; x < width / 2; x++) if (isBackground(x, y)) holes++;
    }
    return holes;
  }, BACKGROUND);
  expect(holes).toBe(0);
});

test('indicatrices and drawn shapes appear in the accent colour, and a changed shape is a new object', async ({ page }) => {
  await openPaused(page);
  expect(await countOf(page, ACCENT)).toBe(0);

  // An indicatrix is a translucent fill of the accent with no outline: over the sea it is the two mixed.
  const [, r, g, b, a] = LIGHT_STYLE.indicatrix.match(/rgba\((\d+), (\d+), (\d+), ([\d.]+)\)/)!.map(Number) as [number, number, number, number, number];
  const onSea = rgb(LIGHT_STYLE.ocean).map((v, i) => Math.round(v * (1 - a) + [r, g, b][i]! * a)) as Rgb;
  expect(await countOf(page, onSea)).toBe(0);
  await page.evaluate(() => (window as any).__app.setTissot(true));
  await page.clock.runFor(32);
  expect(await countOf(page, onSea)).toBeGreaterThan(2000);
  // No outline in the accent itself.
  expect(await countOf(page, ACCENT)).toBe(0);
  await page.evaluate(() => (window as any).__app.setTissot(false));
  await page.clock.runFor(32);
  expect(await countOf(page, onSea)).toBe(0);

  const shapes: Shape[] = [{ kind: 'line', points: [[-40, -30], [40, 30]] }];
  await page.evaluate((shapes) => {
    const app = (window as any).__app;
    app.shapes = shapes;
    app.invalidateGeometry();
  }, shapes);
  await page.clock.runFor(32);
  const line = await countOf(page, ACCENT);
  expect(line).toBeGreaterThan(300);

  // A shape survives a morph, and so does a new one added afterwards.
  await select(page, 'mercator');
  await page.clock.runFor(1500);
  const onMercator = await countOf(page, ACCENT);
  expect(onMercator).toBeGreaterThan(100);

  const before = await page.evaluate(() => {
    const app = (window as any).__app;
    (window as any).__drawings = app.drawings;
    app.shapes = [...app.shapes, { kind: 'circle', center: [0, 0], radiusDeg: 20 }, { kind: 'polygon', points: [[60, 10], [75, 40], [90, 10], [60, 10]] }];
    app.invalidateGeometry();
    return app.drawings !== (window as any).__drawings;
  });
  expect(before).toBe(true);
  await page.clock.runFor(32);
  expect(await countOf(page, ACCENT)).toBeGreaterThan(onMercator + 200);
});

test('live changes apply at rest, are ignored during a morph, and the morph completes', async ({ page }) => {
  await openPaused(page);
  const setLon = (lon: number) => page.evaluate((lon) => {
    const app = (window as any).__app;
    app.setLive({ orientation: { ...app.state.orientation, lon } });
    return app.state.orientation.lon;
  }, lon);

  expect(await setLon(40)).toBe(40);
  await select(page, 'mollweide');
  await page.clock.runFor(100);
  expect(await isMorphing(page)).toBe(true);
  expect(await setLon(90)).toBe(40);
  await page.clock.runFor(1400);
  expect(await isMorphing(page)).toBe(false);
  expect(await setLon(90)).toBe(90);
});

test('a centre move reuses the fitted screen, and a tilt refits it', async ({ page }) => {
  await openPaused(page);
  await select(page, 'mollweide');
  await page.clock.runFor(1500);
  const screenAfter = (patch: string) => page.evaluate((patch) => {
    const app = (window as any).__app;
    const before = app.controller.source()[0].screen;
    const { lon, lat, tilt } = app.state.orientation;
    const orientation = patch === 'centre' ? { lon: lon + 20, lat: lat + 10, tilt } : { lon, lat, tilt: tilt + 20 };
    app.setLive({ orientation });
    return { same: app.controller.source()[0].screen === before };
  }, patch);

  expect((await screenAfter('centre')).same).toBe(true);
  expect((await screenAfter('tilt')).same).toBe(false);
});

test('frames run only while something is pending', async ({ page }) => {
  await page.addInitScript(() => {
    const original = window.requestAnimationFrame.bind(window);
    (window as any).__requests = 0;
    window.requestAnimationFrame = (fn) => {
      (window as any).__requests++;
      return original(fn);
    };
  });
  await open(page);
  const requests = (): Promise<number> => page.evaluate(() => (window as any).__requests);
  const idle = () => page.evaluate(() => new Promise((done) => setTimeout(done, 200)));

  await idle();
  const atRest = await requests();
  await idle();
  expect(await requests()).toBe(atRest);

  await select(page, 'goode');
  await settle(page);
  await idle();
  const settled = await requests();
  expect(settled).toBeGreaterThan(atRest + 10);
  await idle();
  expect(await requests()).toBe(settled);
});

/** Keeps the canvas as it is now, and later counts the pixels that have changed by more than 8 in any channel since. */
const keepCanvas = (page: Page) =>
  page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('#map')!;
    (window as any).__kept = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
  });
const changedSince = (page: Page) =>
  page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('#map')!;
    const now = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    const kept = (window as any).__kept as Uint8ClampedArray;
    let changed = 0;
    for (let i = 0; i < now.length; i += 4) {
      if (Math.abs(now[i]! - kept[i]!) > 8 || Math.abs(now[i + 1]! - kept[i + 1]!) > 8 || Math.abs(now[i + 2]! - kept[i + 2]!) > 8) changed++;
    }
    return changed / (now.length / 4);
  });

for (const [from, to] of [['mollweide', 'gnomonic'], ['gnomonic', 'mollweide'], ['mercator', 'stereographic']] as const) {
  test(`${from} to ${to}: nothing fades, and what folds onto an edge leaves no trace there as the morph starts or settles`, async ({ page }) => {
    await openPaused(page);
    await select(page, from);
    await page.clock.runFor(1600);
    await keepCanvas(page);
    await select(page, to);
    // One frame in: the map has hardly moved, and nothing has appeared along its edge.
    await page.clock.runFor(16);
    expect(await isMorphing(page)).toBe(true);
    expect(await changedSince(page), 'first frame').toBeLessThan(0.0005);
    // One frame from the end, against the map at rest.
    await page.clock.runFor(1364);
    expect(await isMorphing(page)).toBe(true);
    await keepCanvas(page);
    await page.clock.runFor(100);
    expect(await isMorphing(page)).toBe(false);
    expect(await changedSince(page), 'last frame').toBeLessThan(0.0005);
  });
}
