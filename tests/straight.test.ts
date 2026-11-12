import { geoArea, geoDistance, geoInterpolate } from 'd3-geo';
import { describe, expect, test } from 'vitest';
import { circlePath, straightPath, straightRing } from '../src/drawing/straight';
import type { LonLat } from '../src/projections/types';
import { projectPoint } from '../src/screen/screen';
import type { Member } from '../src/tissot/indicatrix';
import { member } from './sceneSupport';

const rad = Math.PI / 180;
type Pair = [number, number];

const on = (m: Member, p: LonLat): Pair => projectPoint(m.compiled, m.screen, p);
/** How far a screen point is from the straight line through two others. */
const offLine = (p: Pair, a: Pair, b: Pair) => Math.abs((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) / Math.hypot(b[0] - a[0], b[1] - a[1]);
const vector = ([lon, lat]: LonLat) => [Math.cos(lat * rad) * Math.cos(lon * rad), Math.cos(lat * rad) * Math.sin(lon * rad), Math.sin(lat * rad)] as const;
const mercatorY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * rad) / 2));

describe('a path that is straight on a map', () => {
  test('begins and ends at the very points given, and is null for a map that cannot show one of them', () => {
    const m = member('mollweide');
    const [a, b]: [LonLat, LonLat] = [[-40, 20], [80, -35]];
    const path = straightPath(m.compiled, m.screen, a, b)!;
    expect(path[0]).toBe(a);
    expect(path.at(-1)).toBe(b);
    const gnomonic = member('gnomonic');
    expect(straightPath(gnomonic.compiled, gnomonic.screen, [0, 0], [150, 0])).toBeNull();
  });

  test('on Mercator it is a rhumb line: it crosses every meridian at the same angle', () => {
    const m = member('mercator');
    const path = straightPath(m.compiled, m.screen, [0, 0], [60, 50])!;
    expect(path.length).toBeGreaterThan(30);
    const slope = mercatorY(50) / 60;
    for (const [lon, lat] of path.slice(1)) expect(mercatorY(lat) / lon, `${lon}`).toBeCloseTo(slope, 4);
  });

  test('on a gnomonic map it is a great circle', () => {
    const m = member('gnomonic', { lon: 10, lat: 30 });
    const [a, b]: [LonLat, LonLat] = [[-30, 10], [50, 60]];
    const path = straightPath(m.compiled, m.screen, a, b)!;
    const [va, vb] = [vector(a), vector(b)];
    const n = [va[1] * vb[2] - va[2] * vb[1], va[2] * vb[0] - va[0] * vb[2], va[0] * vb[1] - va[1] * vb[0]];
    const length = Math.hypot(...n);
    for (const p of path) {
      const v = vector(p);
      expect(Math.abs(v[0] * n[0]! + v[1] * n[1]! + v[2] * n[2]!) / length).toBeLessThan(1e-4);
    }
  });

  test.each(['mollweide', 'robinson', 'stereographic', 'albers', 'peirce', 'butterfly', 'nicolosi', 'werner'])('on %s it strays from the straight line by under a quarter of a pixel, between its points too', (id) => {
    const m = member(id);
    // Two places that the map shows near each other, well inside one piece of it.
    const [a, b]: [LonLat, LonLat] = id === 'albers' ? [[-20, 20], [50, 55]] : id === 'butterfly' ? [[75, 15], [130, 60]] : id === 'peirce' ? [[-30, 40], [60, 70]] : id === 'nicolosi' ? [[-10, -30], [100, 40]] : [[-30, -20], [40, 50]];
    const path = straightPath(m.compiled, m.screen, a, b)!;
    expect(path, id).not.toBeNull();
    const [pa, pb] = [on(m, a), on(m, b)];
    expect(Math.hypot(pb[0] - pa[0], pb[1] - pa[1])).toBeGreaterThan(30);
    for (const p of path) expect(offLine(on(m, p), pa, pb), `${p}`).toBeLessThan(0.25);
    // The path is joined by short great-circle arcs when it is drawn: their middles are on the line too, and no arc is long.
    for (let i = 1; i < path.length; i++) {
      expect(geoDistance(path[i - 1]!, path[i]!) / rad).toBeLessThanOrEqual(1 + 1e-9);
      expect(offLine(on(m, geoInterpolate(path[i - 1]!, path[i]!)(0.5) as LonLat), pa, pb), `between ${path[i - 1]} and ${path[i]}`).toBeLessThan(0.25);
    }
    // It goes one way along the line, from the one end to the other.
    const along = path.map((p) => (on(m, p)[0] - pa[0]) * (pb[0] - pa[0]) + (on(m, p)[1] - pa[1]) * (pb[1] - pa[1]));
    for (let i = 1; i < along.length; i++) expect(along[i]!).toBeGreaterThan(along[i - 1]!);
  });

  test('a line that would leave the map, across a gap of an interrupted map or between two hemispheres, is null', () => {
    const goode = member('goode');
    // Either side of the gap between Goode's northern lobes, which opens at 40 degrees west.
    expect(straightPath(goode.compiled, goode.screen, [-70, 60], [-10, 60])).toBeNull();
    // On the same lobe it is a line.
    expect(straightPath(goode.compiled, goode.screen, [-150, 60], [-60, 50])).not.toBeNull();
    const hemispheres = member('stereographic-hemispheres');
    expect(straightPath(hemispheres.compiled, hemispheres.screen, [-100, 70], [60, 70])).toBeNull();
    const butterfly = member('butterfly');
    // From one wing to the other, above the pole.
    expect(straightPath(butterfly.compiled, butterfly.screen, butterfly.compiled.fromFrame([60, 30]), butterfly.compiled.fromFrame([120, 30]))).toBeNull();
  });

  test('a line of no length to speak of is its two ends', () => {
    const m = member('mollweide');
    expect(straightPath(m.compiled, m.screen, [10, 10], [10.001, 10])).toEqual([[10, 10], [10.001, 10]]);
  });

  test('it is the line on the zoomed map too', () => {
    const m = member('mollweide');
    const zoomed: Member = { ...m, screen: { ...m.screen, k: m.screen.k * 6, tx: 500 + 6 * (m.screen.tx - 500) - 300, ty: 300 + 6 * (m.screen.ty - 300) + 200 } };
    const [a, b]: [LonLat, LonLat] = [[5, 40], [25, 55]];
    const path = straightPath(zoomed.compiled, zoomed.screen, a, b)!;
    const [pa, pb] = [on(zoomed, a), on(zoomed, b)];
    for (const p of path) expect(offLine(on(zoomed, p), pa, pb)).toBeLessThan(0.25);
  });
});

describe('a circle that is round on a map', () => {
  test('every point of it is as far from the centre on the map as the point it was drawn through', () => {
    for (const id of ['mercator', 'mollweide', 'stereographic']) {
      const m = member(id);
      const [centre, edge]: [LonLat, LonLat] = [[20, 30], [45, 40]];
      const ring = circlePath(m.compiled, m.screen, centre, edge)!;
      expect(ring, id).not.toBeNull();
      const [pc, pe] = [on(m, centre), on(m, edge)];
      const radius = Math.hypot(pe[0] - pc[0], pe[1] - pc[1]);
      for (const p of ring) expect(Math.abs(Math.hypot(on(m, p)[0] - pc[0], on(m, p)[1] - pc[1]) - radius), `${id} ${p}`).toBeLessThan(0.25);
      // Closed, in short steps, and wound round its inside, which is the smaller side of it.
      expect(ring.at(-1)).toEqual(ring[0]);
      expect(ring.length).toBeGreaterThan(60);
      expect(geoArea({ type: 'Polygon', coordinates: [ring] })).toBeLessThan(2 * Math.PI);
      expect(geoArea({ type: 'Polygon', coordinates: [ring] })).toBeGreaterThan(0.01);
    }
  });

  test('on Mercator, away from the equator, it is no circle on the globe: it is longer north to south than it is wide', () => {
    const m = member('mercator');
    const centre: LonLat = [0, 60];
    const ring = circlePath(m.compiled, m.screen, centre, [20, 60])!;
    const lats = ring.map((p) => p[1]);
    const lons = ring.map((p) => p[0]);
    // 40 degrees of longitude at 60 north is 20 degrees of true distance; the same height on a Mercator map is less of latitude.
    expect(Math.max(...lons) - Math.min(...lons)).toBeCloseTo(40, 0);
    expect(Math.max(...lats) - Math.min(...lats)).toBeLessThan(21);
    expect(Math.max(...lats) - 60).toBeLessThan(60 - Math.min(...lats));
  });

  test('one that would leave the map is null', () => {
    const m = member('mollweide');
    expect(circlePath(m.compiled, m.screen, [150, 0], [100, 0])).toBeNull();
    expect(circlePath(m.compiled, m.screen, [150, 0], [150.0001, 0])).toBeNull();
  });
});

describe('a polygon whose sides are straight on a map', () => {
  test('is closed and wound round its inside whichever way its corners were given', () => {
    const m = member('equirectangular');
    const corners: LonLat[] = [[0, 0], [40, 0], [40, 30], [0, 30]];
    for (const vertices of [corners, [...corners].reverse()]) {
      const ring = straightRing(m.compiled, m.screen, vertices)!;
      expect(ring.at(-1)).toEqual(ring[0]);
      // On an equirectangular map a rectangle's sides are meridians and parallels: its area is that of the cell.
      const area = geoArea({ type: 'Polygon', coordinates: [ring] });
      expect(area).toBeCloseTo((40 * rad) * Math.sin(30 * rad), 3);
      for (const p of ring) {
        expect(p[0]).toBeGreaterThan(-1e-6);
        expect(p[0]).toBeLessThan(40 + 1e-6);
        expect(p[1]).toBeGreaterThan(-1e-6);
        expect(p[1]).toBeLessThan(30 + 1e-6);
      }
    }
  });

  test('is null if a side would leave the map, and for fewer than three corners', () => {
    const goode = member('goode');
    expect(straightRing(goode.compiled, goode.screen, [[-70, 60], [-10, 60], [-30, 20]])).toBeNull();
    const m = member('mollweide');
    expect(straightRing(m.compiled, m.screen, [[0, 0], [10, 10]])).toBeNull();
  });
});
