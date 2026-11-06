import { expect, test } from 'vitest';
import { geoTransverseMercator } from 'd3-geo';
import { getDef, stops } from '../src/projections/catalog';
import { compile, stateForStop } from '../src/projections/compile';
import type { CompiledProjection, LonLat, Orientation } from '../src/projections/types';
import {
  computeScreen,
  dragTo,
  isCovered,
  projectPoint,
  screenToLonLat,
  type Viewport,
} from '../src/screen/screen';

const rad = Math.PI / 180;
const view: Viewport = { width: 800, height: 600 };

/** Deterministic pseudo-random numbers in [0, 1). */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A point uniformly distributed on the sphere, in degrees. */
function randomPoint(r: () => number): LonLat {
  return [r() * 360 - 180, Math.asin(2 * r() - 1) / rad];
}

function stopState(id: string, orientation?: Partial<Orientation>) {
  const s = stops.find((x) => x.id === id);
  if (!s) throw new Error(`no stop ${id}`);
  const state = stateForStop(s);
  return { ...state, orientation: { ...state.orientation, ...orientation } };
}

function compiled(id: string, orientation?: Partial<Orientation>): CompiledProjection {
  return compile(stopState(id, orientation));
}

function coveredRandomPoints(c: CompiledProjection, n: number, seed: number): LonLat[] {
  const r = rng(seed);
  const out: LonLat[] = [];
  while (out.length < n) {
    const p = randomPoint(r);
    if (isCovered(c, p)) out.push(p);
  }
  return out;
}

const dist = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);

test('fit: every covered sample lies inside the viewport, and the map touches one axis', () => {
  const pad = 16;
  for (const s of stops) {
    for (const tilt of s.id === 'robinson' ? [0, 30] : [undefined]) {
      const c = compiled(s.id, tilt === undefined ? undefined : { tilt });
      const t = computeScreen(c, view);
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const p of coveredRandomPoints(c, 1500, 5)) {
        const [x, y] = projectPoint(c, t, p);
        expect(x, `${s.id} x`).toBeGreaterThanOrEqual(pad - 1e-6);
        expect(x, `${s.id} x`).toBeLessThanOrEqual(view.width - pad + 1e-6);
        expect(y, `${s.id} y`).toBeGreaterThanOrEqual(pad - 1e-6);
        expect(y, `${s.id} y`).toBeLessThanOrEqual(view.height - pad + 1e-6);
      }
      // A half-degree grid reaches close to the extremes.
      for (let lat = -90; lat <= 90; lat += 0.5) {
        for (let lon = -180; lon <= 180; lon += 0.5) {
          const frame: LonLat = [lon, lat];
          const p = c.fromFrame(frame);
          if (!isCovered(c, p)) continue;
          const [x, y] = projectPoint(c, t, p);
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
      }
      const slack = 0.02;
      const touchesX = minX < pad + slack * view.width && maxX > view.width - pad - slack * view.width;
      const touchesY = minY < pad + slack * view.height && maxY > view.height - pad - slack * view.height;
      expect(touchesX || touchesY, `${s.id} touches an axis`).toBe(true);
    }
  }
});

test('fit is independent of centre lon/lat', () => {
  for (const s of stops) {
    const def = getDef(s.defId);
    const tilt = def.tiltEnabled ? 25 : 0;
    const a = computeScreen(compiled(s.id, { lon: 0, lat: 0, tilt }), view);
    const b = computeScreen(compiled(s.id, { lon: 73, lat: def.latEnabled ? -41 : 0, tilt }), view);
    for (const key of ['k', 'tx', 'ty', 'cos', 'sin'] as const) {
      expect(b[key], `${s.id} ${key}`).toBeCloseTo(a[key], 9);
    }
  }
});

test('north-up: at tilt 30, a small step north of the centre moves straight up on screen', () => {
  for (const id of ['robinson', 'mercator', 'equirectangular', 'hammer', 'winkel-tripel', 'goode']) {
    for (const tilt of [30, -30, 135]) {
      for (const [lon, lat] of [[20, 10], [-60, 40], [0, -25]]) {
        const c = compiled(id, { lon: lon!, lat: lat!, tilt });
        const t = computeScreen(c, view);
        const here = projectPoint(c, t, [lon!, lat!]);
        const north = projectPoint(c, t, [lon!, lat! + 0.01]);
        const dx = north[0] - here[0];
        const dy = north[1] - here[1];
        expect(dy, `${id} tilt ${tilt} moves up`).toBeLessThan(0);
        expect(Math.abs(dx), `${id} tilt ${tilt} stays vertical`).toBeLessThan(1e-3 * Math.abs(dy));
      }
    }
  }
});

test('transverse: Mercator tilt 90 at centre (0,0): lon 0 meridian is vertical, x within 1e-6 of centre', () => {
  const c = compiled('transverse-mercator');
  expect(c.state.orientation).toEqual({ lon: 0, lat: 0, tilt: 90 });
  const t = computeScreen(c, view);
  const ys: number[] = [];
  for (let lat = -70; lat <= 70; lat += 10) {
    const [x, y] = projectPoint(c, t, [0, lat]);
    expect(Math.abs(x - view.width / 2)).toBeLessThan(1e-6);
    ys.push(y);
  }
  // Latitude increases to the north, which is up the screen.
  for (let i = 1; i < ys.length; i++) expect(ys[i]!).toBeLessThan(ys[i - 1]!);
  // The equator crosses the middle at right angles to the meridian, so it runs along the horizontal.
  const east = projectPoint(c, t, [60, 0]);
  expect(Math.abs(east[0] - view.width / 2)).toBeGreaterThan(1);
  expect(Math.abs(east[1] - view.height / 2)).toBeLessThan(1e-6);
  expect(Math.abs(projectPoint(c, t, [0, 0])[1] - view.height / 2)).toBeLessThan(1e-6);

  // Pins the sign of the compensation: the screen is d3's transverse Mercator, scaled and moved.
  const d3tm = geoTransverseMercator().scale(1).translate([0, 0]);
  const r = rng(9);
  for (let i = 0; i < 30; i++) {
    const p = randomPoint(r);
    if (Math.abs(p[1]) > 80) continue;
    const [dx, dy] = d3tm(p)!;
    const [x, y] = projectPoint(c, t, p);
    expect(x).toBeCloseTo(t.tx + t.k * dx, 6);
    expect(y).toBeCloseTo(t.ty + t.k * dy, 6);
  }
});

test('inverse round trip for every stop: 200 covered points within 0.5 px', () => {
  const setups: Partial<Orientation>[] = [{}, { lon: 35, lat: 25, tilt: 20 }];
  for (const s of stops) {
    for (const o of setups) {
      const c = compiled(s.id, o);
      const t = computeScreen(c, view);
      for (const p of coveredRandomPoints(c, 200, 21)) {
        const xy = projectPoint(c, t, p);
        const back = screenToLonLat(c, t, xy);
        expect(back, `${s.id} at ${p}`).not.toBeNull();
        // The inverse may pick another point that lands on the same pixel.
        expect(dist(projectPoint(c, t, back!), xy), `${s.id} at ${p}`).toBeLessThan(0.5);
      }
    }
  }
});

test('inverse returns the same point on projections that show each point once', () => {
  for (const id of ['robinson', 'mercator', 'equal-earth', 'albers']) {
    const c = compiled(id, { lon: 30, tilt: 0 });
    const t = computeScreen(c, view);
    for (const p of coveredRandomPoints(c, 100, 4)) {
      if (Math.abs(p[1]) > 80) continue;
      const back = screenToLonLat(c, t, projectPoint(c, t, p))!;
      expect(Math.abs(back[1] - p[1]), `${id} lat at ${p}`).toBeLessThan(0.05);
      const dLon = Math.abs(((back[0] - p[0] + 540) % 360) - 180);
      expect(dLon, `${id} lon at ${p}`).toBeLessThan(0.05);
    }
  }
});

test('screenToLonLat returns null for a point outside the map, e.g. a corner on the globe', () => {
  const c = compiled('globe');
  const t = computeScreen(c, view);
  expect(screenToLonLat(c, t, [2, 2])).toBeNull();
  expect(screenToLonLat(c, t, [view.width - 2, view.height - 2])).toBeNull();
  expect(screenToLonLat(c, t, [view.width / 2, view.height / 2])).not.toBeNull();
  const m = compiled('mollweide');
  const mt = computeScreen(m, view);
  expect(screenToLonLat(m, mt, [20, 20])).toBeNull();
});

test('dragTo keeps the grabbed point within 1 px of the cursor after a 30 px move, for every stop with free drag', () => {
  // Each cursor is where the grabbed point lands when the centre is moved along `dir`, by an amount
  // that makes the point travel 30 px, so a solution always exists.
  const dirs: [number, number][] = [[1, 0], [0, 1], [-1, -1], [-1, 1]];
  let checked = 0;
  for (const s of stops) {
    const def = getDef(s.defId);
    if (!def.latEnabled) continue;
    for (const o of [{}, { lon: -50, lat: 15, tilt: def.tiltEnabled ? 25 : 0 }] as Partial<Orientation>[]) {
      const c = compiled(s.id, o);
      const t = computeScreen(c, view);
      const { lon, lat, tilt } = c.state.orientation;
      const centred = (dLon: number, dLat: number) =>
        compile({ ...c.state, orientation: { lon: lon + dLon, lat: Math.max(-89, Math.min(89, lat + dLat)), tilt } });
      for (const frame of [[15, 10], [-30, -20], [0, 5]] as LonLat[]) {
        const grabbed = c.fromFrame(frame);
        const from = projectPoint(c, t, grabbed);
        for (const [ux, uy] of dirs) {
          let amount = 0.5;
          for (let i = 0; i < 4; i++) {
            const moved = dist(projectPoint(centred(amount * ux, amount * uy), t, grabbed), from);
            amount *= 30 / Math.max(moved, 1e-6);
          }
          const cursor = projectPoint(centred(amount * ux, amount * uy), t, grabbed);
          // An interrupted map can jump between lobes, so its moves are not smooth in the centre.
          const size = def.seam.kind === 'lobes' ? [5, 80] : [25, 35];
          expect(dist(cursor, from), `${s.id} test move`).toBeGreaterThan(size[0]!);
          expect(dist(cursor, from), `${s.id} test move`).toBeLessThan(size[1]!);
          const next = dragTo(c, t, grabbed, cursor);
          const got = projectPoint(compile({ ...c.state, orientation: next }), t, grabbed);
          expect(dist(got, cursor), `${s.id} move ${ux},${uy} grabbing ${frame}`).toBeLessThan(1);
          expect(next.tilt).toBe(c.state.orientation.tilt);
          checked++;
        }
      }
    }
  }
  expect(checked).toBeGreaterThan(200);
});

test('dragTo on Mercator at tilt 0 and lat 0: a purely horizontal move leaves lat at 0', () => {
  const c = compiled('mercator');
  const t = computeScreen(c, view);
  const grabbed: LonLat = [25, 40];
  const from = projectPoint(c, t, grabbed);
  const next = dragTo(c, t, grabbed, [from[0] + 40, from[1]]);
  expect(Math.abs(next.lat)).toBeLessThan(1e-9);
  expect(next.lon).toBeLessThan(0);
  expect(next.tilt).toBe(0);
});

test('dragTo on a conic changes lon only', () => {
  for (const id of ['albers', 'lambert-conformal']) {
    const c = compiled(id);
    const t = computeScreen(c, view);
    const grabbed: LonLat = [20, 40];
    const from = projectPoint(c, t, grabbed);
    const next = dragTo(c, t, grabbed, [from[0] + 25, from[1] - 10]);
    expect(next.lat).toBe(c.state.orientation.lat);
    expect(next.tilt).toBe(0);
    expect(next.lon).not.toBe(c.state.orientation.lon);
    // The best a rotation about the apex can do for a sideways move is within a pixel or two.
    const got = projectPoint(compile({ ...c.state, orientation: next }), t, grabbed);
    expect(got[0]).toBeGreaterThan(from[0]);
  }
});

test('dragTo holds tilt, and at lat near 90 it clamps without NaN', () => {
  const c = compiled('robinson', { lon: 10, lat: 85, tilt: 20 });
  const t = computeScreen(c, view);
  const grabbed = c.fromFrame([5, -10]);
  const from = projectPoint(c, t, grabbed);
  for (const dy of [-60, 60, -400, 400]) {
    const next = dragTo(c, t, grabbed, [from[0], from[1] + dy]);
    expect(Number.isFinite(next.lon) && Number.isFinite(next.lat)).toBe(true);
    expect(next.lat).toBeLessThanOrEqual(90);
    expect(next.lat).toBeGreaterThanOrEqual(-90);
    expect(Math.abs(next.lon)).toBeLessThanOrEqual(180);
    expect(next.tilt).toBe(20);
  }
  // A drag that would pass over the pole stops at it and keeps the longitude.
  const over = dragTo(c, t, grabbed, [from[0], from[1] + 400]);
  expect(over.lat).toBe(90);
  expect(over.lon).toBe(10);
});
