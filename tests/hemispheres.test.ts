import { geoAzimuthalEqualAreaRaw, geoStereographicRaw } from 'd3-geo';
import { describe, expect, test } from 'vitest';
import { getDef, stops } from '../src/projections/catalog';
import { compile, stateForStop } from '../src/projections/compile';
import type { LonLat } from '../src/projections/types';
import { computeScreen, isCovered, lobeOf, projectFrame, projectPoint, screenToLonLat } from '../src/screen/screen';
import { jacobian, singularValues, type Member } from '../src/tissot/indicatrix';
import { restImages } from '../src/tissot/rest';
import { rng } from './sceneSupport';
import { stopOf } from './stopOf';

const rad = Math.PI / 180;
const VIEW = { width: 1000, height: 600 };
const IDS = ['nicolosi', 'stereographic-hemispheres', 'equal-area-hemispheres'];

function memberOf(id: string): Member {
  const compiled = compile(stateForStop(stopOf(id)));
  return { compiled, screen: computeScreen(compiled, VIEW), weight: 1 };
}
/** The raw position of a frame point (degrees), on the lobe that holds it. */
const rawAt = (id: string, frame: LonLat): [number, number] => {
  const c = compile(stateForStop(stopOf(id)));
  return c.raw(frame[0] * rad, frame[1] * rad, lobeOf(c, frame));
};

describe('double hemispheres', () => {
  test('there are three, in a family of their own, split where the Old World and the New are', () => {
    expect(stops.filter((s) => s.family === 'hemispheres').map((s) => [s.id, s.name, s.preserves])).toEqual([
      ['nicolosi', 'Nicolosi globular', 'compromise'],
      ['stereographic-hemispheres', 'Stereographic hemispheres', 'conformal'],
      ['equal-area-hemispheres', 'Equal-area hemispheres', 'equal-area'],
    ]);
    for (const id of IDS) {
      const def = getDef(stopOf(id).defId);
      expect(def.defaultOrientation, id).toEqual({ lon: -20, lat: 0, tilt: 0 });
      expect(def.seam, id).toEqual({
        kind: 'lobes',
        // Each half in two rectangles with one id: a rectangle that is a whole hemisphere cannot be clipped to.
        lobes: [
          { id: -90, lonMin: -180, lonMax: 0, latMin: 0, latMax: 90 },
          { id: -90, lonMin: -180, lonMax: 0, latMin: -90, latMax: 0 },
          { id: 90, lonMin: 0, lonMax: 180, latMin: 0, latMax: 90 },
          { id: 90, lonMin: 0, lonMax: 180, latMin: -90, latMax: 0 },
        ],
        smoothEquator: true,
      });
    }
  });

  test.each(IDS)('%s: two discs of one size, side by side, touching at the middle of the map', (id) => {
    const east = rawAt(id, [90, 0]);
    const west = rawAt(id, [-90, 0]);
    const R = east[0];
    expect(R).toBeGreaterThan(0);
    expect(east[1]).toBeCloseTo(0, 12);
    expect(west[0]).toBeCloseTo(-R, 12);
    // Every point of a hemisphere is within its disc, and its rim is on the disc's edge.
    const r = rng(3);
    for (let i = 0; i < 300; i++) {
      const frame: LonLat = [r() * 360 - 180, Math.asin(2 * r() - 1) / rad];
      if (Math.abs(frame[1]) > 89.8) continue;
      const [x, y] = rawAt(id, frame);
      const centre = frame[0] >= 0 ? R : -R;
      expect(Math.hypot(x - centre, y), `${frame}`).toBeLessThanOrEqual(R * (1 + 1e-9));
    }
    for (const lat of [-80, -30, 0, 45, 89]) {
      // The frame's prime meridian and its antimeridian are the rims: on the discs' edges, and the prime meridian where they touch.
      for (const lon of [1e-9, 180]) expect(Math.hypot(rawAt(id, [lon, lat])[0] - R, rawAt(id, [lon, lat])[1]), `${lon} ${lat}`).toBeCloseTo(R, 6);
      for (const lon of [-1e-9, -180]) expect(Math.hypot(rawAt(id, [lon, lat])[0] + R, rawAt(id, [lon, lat])[1]), `${lon} ${lat}`).toBeCloseTo(R, 6);
    }
    expect(rawAt(id, [1e-9, 0])[0]).toBeCloseTo(0, 6);
    expect(rawAt(id, [-1e-9, 0])[0]).toBeCloseTo(0, 6);
    // Fitted, the map is twice as wide as it is tall.
    const m = memberOf(id);
    const [left, right, top] = [projectFrame(m.compiled, m.screen, [-180, 0], -90), projectFrame(m.compiled, m.screen, [180, 0], 90), projectFrame(m.compiled, m.screen, [90, 89.9], 90)];
    // The top is taken a tenth of a degree short of the pole, which the map leaves out.
    expect(Math.abs(right[0] - left[0] - 4 * (300 - top[1]))).toBeLessThan(3);
  });

  test('each hemisphere is the plain azimuthal map of its half, about its own middle', () => {
    for (const [id, raw] of [['stereographic-hemispheres', geoStereographicRaw], ['equal-area-hemispheres', geoAzimuthalEqualAreaRaw]] as const) {
      const R = raw(Math.PI / 2, 0)[0];
      for (const frame of [[30, 20], [150, -60], [-45, 5], [-170, 70]] as LonLat[]) {
        const middle = frame[0] >= 0 ? 90 : -90;
        const [x, y] = raw((frame[0] - middle) * rad, frame[1] * rad);
        const got = rawAt(id, frame);
        expect(got[0]).toBeCloseTo(x + Math.sign(middle) * R, 12);
        expect(got[1]).toBeCloseTo(y, 12);
      }
    }
  });

  const grid = (m: Member) => {
    const out: { p: LonLat; axes: [number, number] }[] = [];
    for (let lat = -75; lat <= 75; lat += 15) {
      for (let lon = -172.5; lon < 180; lon += 15) {
        const p: LonLat = [lon, lat];
        // Clear of the rims, where a derivative is taken from one side.
        const frame = m.compiled.toFrame(p);
        if (!isCovered(m.compiled, p) || Math.min(Math.abs(frame[0]), 180 - Math.abs(frame[0])) < 3) continue;
        const mat = jacobian(m.compiled, m.screen, p);
        if (mat) out.push({ p, axes: singularValues(mat) });
      }
    }
    return out;
  };

  test('stereographic hemispheres keep angles: every indicatrix is a circle', () => {
    const found = grid(memberOf('stereographic-hemispheres'));
    expect(found.length).toBeGreaterThan(150);
    for (const { p, axes } of found) expect(axes[1] / axes[0], `${p}`).toBeGreaterThan(1 - 1e-3);
  });

  test('equal-area hemispheres keep areas: every indicatrix has the same area', () => {
    const found = grid(memberOf('equal-area-hemispheres'));
    expect(found.length).toBeGreaterThan(150);
    const reference = found[0]!.axes[0] * found[0]!.axes[1];
    for (const { p, axes } of found) expect((axes[0] * axes[1]) / reference, `${p}`).toBeCloseTo(1, 3);
  });

  test.each(IDS)('%s: the place under a pixel is found again, in both discs', (id) => {
    const m = memberOf(id);
    const r = rng(8);
    let checked = 0;
    for (let i = 0; i < 200; i++) {
      const p: LonLat = [r() * 360 - 180, Math.asin(2 * r() - 1) / rad];
      const frame = m.compiled.toFrame(p);
      if (!isCovered(m.compiled, p) || Math.min(Math.abs(frame[0]), 180 - Math.abs(frame[0])) < 1 || Math.abs(frame[1]) > 85) continue;
      const back = screenToLonLat(m.compiled, m.screen, projectPoint(m.compiled, m.screen, p));
      expect(back, `${p}`).not.toBeNull();
      expect(Math.abs(back![1] - p[1]), `${p}`).toBeLessThan(0.01);
      expect(Math.abs(((back![0] - p[0] + 540) % 360) - 180) * Math.cos(p[1] * rad), `${p}`).toBeLessThan(0.01);
      checked++;
    }
    expect(checked).toBeGreaterThan(150);
  });

  test('an indicatrix by the rim where the discs touch is in two parts, one in each disc', () => {
    const m = memberOf('equal-area-hemispheres');
    // Two degrees east of the frame's prime meridian, which is 20 degrees west on the Earth.
    const images = restImages(m, [-18, 10]);
    expect(images).toHaveLength(2);
    expect(images[0]!.cuts).toHaveLength(1);
    images[1]!.cuts[0]!.forEach((v, k) => expect(v).toBeCloseTo(-images[0]!.cuts[0]![k]!, 12));
    // The other part is in the other disc: on the far side of the middle of the map.
    const middle = projectPoint(m.compiled, m.screen, [-20, 0])[0];
    expect(Math.sign(images[0]!.pos[0] - middle)).toBe(1);
    // And far from any rim it is whole, on the equator too, where the two rectangles of a half meet with no seam.
    expect(restImages(m, [70, 10])).toHaveLength(1);
    expect(restImages(m, [70, 1])).toHaveLength(1);
    expect(restImages(m, [70, 1])[0]!.cuts).toEqual([]);
  });
});
