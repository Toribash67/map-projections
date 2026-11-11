import { geoArea } from 'd3-geo';
import { describe, expect, test } from 'vitest';
import { cutGeometry } from '../src/geo/cut';
import { cutFront } from '../src/geo/frontCut';
import { getDef } from '../src/projections/catalog';
import { compile, stateForStop } from '../src/projections/compile';
import { peirceLobes, peirceRaw } from '../src/projections/peirce';
import type { LonLat } from '../src/projections/types';
import { computeScreen, isCovered, lobeOf, projectFrame, projectPoint, screenToLonLat } from '../src/screen/screen';
import { jacobian, singularValues, type Member } from '../src/tissot/indicatrix';
import { restImages } from '../src/tissot/rest';
import { land, rng } from './sceneSupport';
import { stopOf } from './stopOf';

const rad = Math.PI / 180;
const VIEW = { width: 1000, height: 600 };
const at = (lon: number, lat: number, lobe?: number) => peirceRaw(lon * rad, lat * rad, lobe);
const member = (orientation = {}): Member => {
  const state = stateForStop(stopOf('peirce'));
  const compiled = compile({ ...state, orientation: { ...state.orientation, ...orientation } });
  return { compiled, screen: computeScreen(compiled, VIEW), weight: 1 };
};
/** The southern lobe that holds a longitude: 1 to 4, round from -90. */
const southOf = (lon: number) => peirceLobes.find((l) => l.latMax === 0 && lon >= l.lonMin && lon <= l.lonMax)!.id;

describe('Peirce quincuncial', () => {
  test('the north pole is the middle, and the equator is a square standing on a corner, its corners where the map is not conformal', () => {
    expect(Math.hypot(...at(0, 90))).toBeLessThan(1e-12);
    // At a corner the map is steep, as a square root is at nought: a hair off the equator is a good deal off the corner.
    const corners = [-135, -45, 45, 135].map((lon) => at(lon, 1e-12));
    const c = Math.hypot(...corners[0]!);
    // On the axes, all as far out.
    for (const [x, y] of corners) {
      expect(Math.hypot(x, y)).toBeCloseTo(c, 4);
      expect(Math.min(Math.abs(x), Math.abs(y))).toBeLessThan(1e-4);
    }
    // The middles of its sides, on the diagonals, nearer by the square root of two.
    for (const lon of [-90, 0, 90, 180]) {
      const [x, y] = at(lon, 1e-9);
      expect(Math.hypot(x, y)).toBeCloseTo(c / Math.SQRT2, 4);
      expect(Math.abs(x)).toBeCloseTo(Math.abs(y), 6);
    }
    // The frame's origin is at the lower right, so that the meridian 45 degrees west of it runs straight down.
    expect(at(0, 1e-9)[0]).toBeGreaterThan(0);
    expect(at(0, 1e-9)[1]).toBeLessThan(0);
    expect(Math.abs(at(-45, 30)[0])).toBeLessThan(1e-9);
    expect(at(-45, 30)[1]).toBeLessThan(0);
  });

  test('the south pole is the four corners of the map, which is an upright square twice as wide as the equator\'s', () => {
    const c = Math.SQRT2 * Math.hypot(...at(0, 1e-9));
    const corners = [-90, 0, 90, 180].map((lon) => at(lon, -90 + 1e-7, southOf(lon === 180 ? 179 : lon)));
    for (const [x, y] of corners) {
      expect(Math.abs(x)).toBeCloseTo(c, 4);
      expect(Math.abs(y)).toBeCloseTo(c, 4);
    }
    expect(new Set(corners.map(([x, y]) => `${Math.sign(x)},${Math.sign(y)}`)).size).toBe(4);
    // Fitted, it stands upright on the screen: its corners are on the diagonals from the pole in the middle, and it is as tall as the window allows.
    const m = member();
    const middle = projectPoint(m.compiled, m.screen, m.compiled.fromFrame([0, 90]));
    expect(middle[0]).toBeCloseTo(500, 3);
    expect(middle[1]).toBeCloseTo(300, 3);
    for (const lon of [-90, 0, 90, 179]) {
      const [x, y] = projectFrame(m.compiled, m.screen, [lon, -89.9], southOf(lon));
      expect(Math.abs(Math.abs(x - 500) - Math.abs(y - 300)), `${lon}`).toBeLessThan(1.5);
      expect(Math.abs(y - 300), `${lon}`).toBeGreaterThan(280);
      expect(Math.abs(y - 300), `${lon}`).toBeLessThanOrEqual(284.01);
    }
  });

  test('it runs on across the equator without a break, from the northern lobe into each southern one', () => {
    const r = rng(2);
    for (let i = 0; i < 80; i++) {
      const lon = r() * 360 - 180;
      // Clear of the four corners, where everything is steep.
      if ([-135, -45, 45, 135].some((corner) => Math.abs(lon - corner) < 1)) continue;
      const [north, south] = [at(lon, 1e-6, 0), at(lon, -1e-6, southOf(lon))];
      expect(Math.hypot(north[0] - south[0], north[1] - south[1]), `${lon}`).toBeLessThan(1e-4);
      // And each lobe's own formula carries on past the equator as the other's does: the same place by both.
      const [a, b] = [at(lon, -5, 0), at(lon, -5, southOf(lon))];
      expect(Math.hypot(a[0] - b[0], a[1] - b[1]), `${lon}`).toBeLessThan(1e-9);
      const [n, s] = [at(lon, 5, 0), at(lon, 5, southOf(lon))];
      expect(Math.hypot(n[0] - s[0], n[1] - s[1]), `${lon}`).toBeLessThan(1e-9);
    }
  });

  test('with no lobe given, a point is drawn on the lobe that holds it', () => {
    for (const [lon, lat] of [[10, 40], [-100, 5], [10, -40], [-100, -5], [170, -60], [-170, -60]] as LonLat[]) {
      const lobe = lat >= 0 ? 0 : southOf(lon);
      expect(at(lon, lat)).toEqual(at(lon, lat, lobe));
    }
  });

  test('it keeps angles: every indicatrix is a circle, in every lobe, away from the four corners of the equator', () => {
    for (const o of [{}, { lon: -70, lat: 30, tilt: 20 }]) {
      const m = member(o);
      const r = rng(9);
      let checked = 0;
      const lobes = new Set<number>();
      while (checked < 200) {
        const p: LonLat = [r() * 360 - 180, Math.asin(2 * r() - 1) / rad];
        const frame = m.compiled.toFrame(p);
        const nearCorner = [-135, -45, 45, 135].some((lon) => Math.hypot((frame[0] - lon) * Math.cos(frame[1] * rad), frame[1]) < 3);
        // Clear of the seams too, where a derivative is taken from one side.
        const nearSeam = frame[1] < 0 && [-135, -45, 45, 135].some((lon) => Math.abs(frame[0] - lon) * Math.cos(frame[1] * rad) < 1);
        if (!isCovered(m.compiled, p) || nearCorner || nearSeam || frame[1] < -88) continue;
        const [big, small] = singularValues(jacobian(m.compiled, m.screen, p)!);
        expect(small / big, `${p} frame ${frame}`).toBeGreaterThan(1 - 2e-3);
        lobes.add(lobeOf(m.compiled, frame)!);
        checked++;
      }
      expect([...lobes].sort()).toEqual([0, 1, 2, 3, 4]);
    }
  });

  test('the place under a pixel is found again, in every lobe', () => {
    const m = member();
    const r = rng(8);
    let checked = 0;
    for (let i = 0; i < 300; i++) {
      const p: LonLat = [r() * 360 - 180, Math.asin(2 * r() - 1) / rad];
      const frame = m.compiled.toFrame(p);
      if (Math.abs(frame[1]) > 85 || (frame[1] < 0 && [-135, -45, 45, 135].some((lon) => Math.abs(frame[0] - lon) < 2)) || Math.abs(frame[1]) < 1) continue;
      const back = screenToLonLat(m.compiled, m.screen, projectPoint(m.compiled, m.screen, p));
      expect(back, `${p}`).not.toBeNull();
      expect(Math.abs(back![1] - p[1]), `${p}`).toBeLessThan(0.02);
      expect(Math.abs(((back![0] - p[0] + 540) % 360) - 180) * Math.cos(p[1] * rad), `${p}`).toBeLessThan(0.02);
      checked++;
    }
    expect(checked).toBeGreaterThan(200);
  });

  test('the cuts keep all the land, at rest and for a morph', () => {
    const expected = geoArea(land as any);
    for (const o of [{}, { lon: 100, lat: -40, tilt: 35 }]) {
      const m = member(o);
      const full = cutGeometry(land, [m.compiled]);
      const area = (rings: LonLat[][]) => geoArea({ type: 'Polygon', coordinates: rings });
      expect(Math.abs(full.reduce((sum, piece) => sum + area(piece.coords), 0) - expected)).toBeLessThan(1e-3);
      const front = cutFront(land, m.compiled);
      const frontArea = front.reduce((sum, piece) => sum + area(piece.rings.map((ring) => ring.map((p) => m.compiled.fromFrame(p)))), 0);
      // All but what lies in the tenth of a degree left out round the south pole.
      expect(Math.abs(frontArea - expected)).toBeLessThan(2e-3);
    }
  });

  test('an indicatrix by a seam of the southern hemisphere is in two parts, and one on the equator is whole', () => {
    const m = member();
    const def = getDef('peirce');
    expect(def.seam.kind).toBe('lobes');
    // Two degrees from the seam at frame longitude 45, well south.
    const p = m.compiled.fromFrame([43, -40]);
    const images = restImages(m, p);
    expect(images).toHaveLength(2);
    images[1]!.cuts[0]!.forEach((v, k) => expect(v).toBeCloseTo(-images[0]!.cuts[0]![k]!, 12));
    // The parts are far apart on the map: the seam opens from the equator's corner out to the map's own.
    expect(Math.hypot(images[0]!.pos[0] - images[1]!.pos[0], images[0]!.pos[1] - images[1]!.pos[1])).toBeGreaterThan(50);
    expect(restImages(m, m.compiled.fromFrame([10, 1]))).toHaveLength(1);
    expect(restImages(m, m.compiled.fromFrame([10, 1]))[0]!.cuts).toEqual([]);
    // In the north there is no seam at all, at the join of two of the lobe's rectangles either.
    expect(restImages(m, m.compiled.fromFrame([89, 40]))).toHaveLength(1);
    expect(restImages(m, m.compiled.fromFrame([179, 40]))).toHaveLength(1);
  });
});
