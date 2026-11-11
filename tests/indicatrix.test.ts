import { describe, expect, test } from 'vitest';
import { buildIndicatrices } from '../src/morph/scene';
import { stops } from '../src/projections/catalog';
import { compile, stateForStop } from '../src/projections/compile';
import type { CompiledProjection, LonLat, Orientation } from '../src/projections/types';
import { computeScreen, isCovered, lobeOf, projectPoint, type ScreenTransform } from '../src/screen/screen';
import {
  INDICATRIX_RADIUS,
  indicatrixCentres,
  jacobian,
  singularValues,
  type Mat2,
} from '../src/tissot/indicatrix';

const rad = Math.PI / 180;
const view = { width: 800, height: 600 };

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

function compiled(id: string, orientation?: Partial<Orientation>) {
  const stop = stops.find((x) => x.id === id);
  if (!stop) throw new Error(`no stop ${id}`);
  const state = stateForStop(stop);
  const c = compile({ ...state, orientation: { ...state.orientation, ...orientation } });
  return { c, s: computeScreen(c, view) };
}

/** The default orientation, then seeded random ones (compile ignores the angles a projection does not allow). */
function orientations(seed: number, n = 3): Partial<Orientation>[] {
  const r = rng(seed);
  const out: Partial<Orientation>[] = [{}];
  for (let i = 0; i < n; i++) out.push({ lon: r() * 360 - 180, lat: r() * 160 - 80, tilt: r() * 360 - 180 });
  return out;
}

const axes = singularValues;

/** The centres and some random points where the map shows something. */
function samples(c: CompiledProjection, s: ScreenTransform, seed: number): { p: LonLat; m: Mat2 }[] {
  const r = rng(seed);
  const points = [...indicatrixCentres()];
  for (let i = 0; i < 40; ) {
    const p = randomPoint(r);
    if (isCovered(c, p)) {
      points.push(p);
      i++;
    }
  }
  const out: { p: LonLat; m: Mat2 }[] = [];
  for (const p of points) {
    const m = jacobian(c, s, p);
    if (m) out.push({ p, m });
  }
  return out;
}

/**
 * The derivative per radian of true distance by plain longitude and latitude
 * differences, which is independent of the great-circle steps in `jacobian`.
 * Null where the stencil leaves the map or crosses a seam, lobe edge or kink.
 */
function fdJacobian(c: CompiledProjection, s: ScreenTransform, p: LonLat): Mat2 | null {
  const lobe = lobeOf(c, c.toFrame(p));
  const mid = projectPoint(c, s, p, lobe);
  const cosPhi = Math.cos(p[1] * rad);
  const withStep = (h: number): Mat2 | null => {
    const at = (dlon: number, dlat: number): [number, number] | null => {
      const q: LonLat = [p[0] + dlon / rad, p[1] + dlat / rad];
      if (!isCovered(c, q)) return null;
      const out = projectPoint(c, s, q, lobe);
      return Math.hypot(out[0] - mid[0], out[1] - mid[1]) > s.k * 1e-3 ? null : out;
    };
    const e1 = at(h, 0);
    const e0 = at(-h, 0);
    const n1 = at(0, h);
    const n0 = at(0, -h);
    if (!e1 || !e0 || !n1 || !n0) return null;
    return [
      (e1[0] - e0[0]) / (2 * h * cosPhi),
      (n1[0] - n0[0]) / (2 * h),
      (e1[1] - e0[1]) / (2 * h * cosPhi),
      (n1[1] - n0[1]) / (2 * h),
    ];
  };
  const fine = withStep(1e-5);
  const coarse = withStep(2e-5);
  if (!fine || !coarse) return null;
  // Two step sizes that disagree mean a kink or a seam in the stencil, where there is no one derivative to compare with.
  const scale = Math.hypot(...fine);
  return fine.every((v, k) => Math.abs(v - coarse[k]!) <= 1e-4 * scale) ? fine : null;
}

const near = (actual: number, expected: number, tol: number) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol * Math.abs(expected));

describe('jacobian', () => {
  test.each(['mercator', 'stereographic', 'lambert-conformal'])(
    '%s is conformal: axis ratio 1 within 1e-3, default and oblique',
    (id) => {
      for (const [i, o] of orientations(11).entries()) {
        const { c, s } = compiled(id, o);
        const found = samples(c, s, 100 + i);
        expect(found.length).toBeGreaterThan(30);
        for (const { p, m } of found) {
          const [big, small] = axes(m);
          expect(big / small, `${id} at ${p} ${JSON.stringify(o)}`).toBeCloseTo(1, 3);
        }
      }
    },
  );

  test.each(['mollweide', 'equal-earth', 'sinusoidal', 'hammer', 'albers', 'lambert-azimuthal', 'goode', 'gall-peters'])(
    '%s is equal-area: product of axes is constant within 1e-3 across covered points, default and oblique',
    (id) => {
      for (const [i, o] of orientations(12).entries()) {
        const { c, s } = compiled(id, o);
        const found = samples(c, s, 200 + i);
        expect(found.length).toBeGreaterThan(30);
        const [first] = axes(found[0]!.m);
        const reference = first * axes(found[0]!.m)[1];
        for (const { p, m } of found) {
          const [big, small] = axes(m);
          near(big * small, reference, 1e-3);
          expect(big * small, `${id} at ${p} ${JSON.stringify(o)}`).toBeGreaterThan(0);
        }
      }
    },
  );

  test('agrees with longitude and latitude differences on every stop, default and oblique', () => {
    for (const stop of stops) {
      for (const [i, o] of orientations(13, 2).entries()) {
        const { c, s } = compiled(stop.id, o);
        let checked = 0;
        const r = rng(300 + i);
        for (let n = 0; n < 60; n++) {
          const p = randomPoint(r);
          if (Math.abs(p[1]) > 85) continue;
          // Goode joins its sinusoidal and Mollweide parts at 40.7366 degrees with a kink, and a step that straddles it has no one derivative.
          if (stop.id === 'goode' && Math.abs(Math.abs(p[1]) - 40.7366) < 0.02) continue;
          const reference = fdJacobian(c, s, p);
          const m = jacobian(c, s, p);
          if (!reference || !m) continue;
          const scale = Math.hypot(...reference);
          for (let k = 0; k < 4; k++) {
            expect(Math.abs(m[k]! - reference[k]!), `${stop.id} at ${p} ${JSON.stringify(o)}`).toBeLessThanOrEqual(2e-3 * scale);
          }
          checked++;
        }
        expect(checked, stop.id).toBeGreaterThan(10);
      }
    }
  });

  test('Mercator scale: axis at 60 degrees latitude is twice the axis at the equator', () => {
    const { c, s } = compiled('mercator');
    const equator = axes(jacobian(c, s, [10, 0])!);
    const sixty = axes(jacobian(c, s, [10, 60])!);
    near(sixty[0], 2 * equator[0], 1e-3);
    near(sixty[1], 2 * equator[1], 1e-3);
    near(equator[0], s.k, 1e-3);
  });

  test('azimuthal equidistant at the pole of a map centred on the equator stretches the circle sideways by pi/2', () => {
    const { c, s } = compiled('azimuthal-equidistant');
    const [big, small] = axes(jacobian(c, s, [0, 90])!);
    near(small, s.k, 1e-3);
    near(big, (s.k * Math.PI) / 2, 1e-3);
  });

  test('a point inside a clip cap gives null', () => {
    const mollweide = compiled('mollweide');
    expect(jacobian(mollweide.c, mollweide.s, [20, 89.95])).toBeNull();
    expect(jacobian(mollweide.c, mollweide.s, [20, 45])).not.toBeNull();
    const gnomonic = compiled('gnomonic');
    expect(jacobian(gnomonic.c, gnomonic.s, [180, 0])).toBeNull();
    expect(jacobian(gnomonic.c, gnomonic.s, [100, 0])).toBeNull();
    expect(jacobian(gnomonic.c, gnomonic.s, [60, 0])).not.toBeNull();
  });

  test('the far side of a globe has the orthographic derivative', () => {
    const { c, s } = compiled('globe');
    const [lon, lat] = [110, 20];
    // x = k cos(lat) sin(lon), and y runs down the screen from -k sin(lat). East is per radian of true distance.
    const expected = [s.k * Math.cos(lon * rad), -s.k * Math.sin(lat * rad) * Math.sin(lon * rad), 0, -s.k * Math.cos(lat * rad)];
    const m = jacobian(c, s, [lon, lat])!;
    expect(m).not.toBeNull();
    expected.forEach((v, k) => expect(Math.abs(m[k]! - v)).toBeLessThan(1e-3 * s.k));
    const oblique = compiled('globe', { lon: 30, lat: 40 });
    expect(jacobian(oblique.c, oblique.s, [-150, -40])).not.toBeNull();
  });

  test('poles exist on azimuthal maps and are skipped on Mollweide', () => {
    for (const id of ['lambert-azimuthal', 'azimuthal-equidistant', 'stereographic']) {
      const { c, s } = compiled(id);
      for (const pole of [[0, 90], [0, -90]] as LonLat[]) {
        const m = jacobian(c, s, pole);
        expect(m, `${id} ${pole}`).not.toBeNull();
        expect(m!.every(Number.isFinite)).toBe(true);
      }
    }
    const mollweide = compiled('mollweide');
    expect(jacobian(mollweide.c, mollweide.s, [0, 90])).toBeNull();
    expect(jacobian(mollweide.c, mollweide.s, [0, -90])).toBeNull();
    const centres = indicatrixCentres().filter(([, lat]) => Math.abs(lat) === 90);
    expect(centres).toHaveLength(2);
    expect(centres.map((p) => jacobian(mollweide.c, mollweide.s, p))).toEqual([null, null]);
  });

  test('the basis at a pole is east and north of the longitude given, continuous with nearby points', () => {
    const { c, s } = compiled('stereographic');
    for (const lon of [40, -70, 170]) {
      const pole = jacobian(c, s, [lon, 90])!;
      const near = jacobian(c, s, [lon, 89.99])!;
      for (let k = 0; k < 4; k++) expect(Math.abs(pole[k]! - near[k]!), `lon ${lon}`).toBeLessThanOrEqual(2e-3 * s.k);
    }
  });

  test('seam: on Mercator at lon 179.999, no huge stretch from straddling the cut', () => {
    const { c, s } = compiled('mercator');
    const reference = jacobian(c, s, [0, 35])!;
    for (const lon of [179.999, -179.999, 180, -180]) {
      const m = jacobian(c, s, [lon, 35])!;
      expect(m, `lon ${lon}`).not.toBeNull();
      for (let k = 0; k < 4; k++) expect(Math.abs(m[k]! - reference[k]!), `lon ${lon}`).toBeLessThanOrEqual(1e-3 * s.k);
    }
  });

  test('seam: the same holds when the cut has been turned to another longitude, and with tilt', () => {
    for (const o of [{ lon: 70 }, { lon: -120, tilt: 25 }, { lon: 30, lat: 50, tilt: 70 }]) {
      const { c, s } = compiled('mollweide', o);
      // Walk a short way to either side of the frame's antimeridian along the equator of the frame.
      for (const lat of [10, -35]) {
        for (const side of [-1, 1]) {
          const p = c.fromFrame([180 - side * 0.001, lat]);
          const m = jacobian(c, s, p)!;
          expect(m).not.toBeNull();
          const [big, small] = axes(m);
          const inland = axes(jacobian(c, s, c.fromFrame([170, lat]))!);
          // Mollweide is equal-area, and its stretch cannot jump by anything like a tenth of the map.
          near(big * small, inland[0] * inland[1], 1e-3);
          expect(big).toBeLessThan(4 * s.k);
        }
      }
    }
  });

  test('Goode: either side of a lobe edge uses its own lobe, and stays equal-area', () => {
    const { c, s } = compiled('goode');
    const reference = axes(jacobian(c, s, [10, -30])!);
    for (const lon of [-100.001, -99.999, -20.001, -19.999, 80.001, 79.999]) {
      const [big, small] = axes(jacobian(c, s, [lon, -30])!);
      near(big * small, reference[0] * reference[1], 1e-3);
    }
    const north = axes(jacobian(c, s, [30, 20])!);
    for (const lon of [-40.001, -39.999]) {
      const [big, small] = axes(jacobian(c, s, [lon, 20])!);
      near(big * small, north[0] * north[1], 1e-3);
    }
  });
});

describe('jacobian with a margin past a clip cap', () => {
  // Gnomonic shows up to 68 degrees from its centre. On the equator of a map centred on (0, 0), longitude is distance from the centre.
  const edge = 68;

  test('a point past the edge but within the margin has a derivative, and one beyond it is still null', () => {
    const { c, s } = compiled('gnomonic');
    expect(jacobian(c, s, [edge + 4, 0])).toBeNull();
    expect(jacobian(c, s, [edge + 4, 0], { margin: 5 })).not.toBeNull();
    expect(jacobian(c, s, [edge + 6, 0], { margin: 5 })).toBeNull();
    expect(jacobian(c, s, [edge + 4, 0], { margin: 0 })).toBeNull();
  });

  test('past the edge it is the map\'s own derivative: gnomonic stretches by sec^2 along the radius and sec across it', () => {
    const { c, s } = compiled('gnomonic');
    for (const distance of [edge + 0.5, edge + 4, edge + 9]) {
      const m = jacobian(c, s, [distance, 0], { margin: 10 })!;
      expect(m, `${distance}`).not.toBeNull();
      const [big, small] = axes(m);
      const cos = Math.cos(distance * rad);
      near(big, s.k / (cos * cos), 2e-3);
      near(small, s.k / Math.abs(cos), 2e-3);
    }
  });

  test('where the map covers a point the margin changes nothing', () => {
    for (const id of ['gnomonic', 'mollweide', 'lambert-conformal', 'globe', 'goode']) {
      const { c, s } = compiled(id);
      for (const p of indicatrixCentres()) {
        if (isCovered(c, p)) expect(jacobian(c, s, p, { margin: 10 }), `${id} ${p}`).toEqual(jacobian(c, s, p));
      }
    }
  });

  test('the far side of a globe is as it was, with or without a margin', () => {
    const { c, s } = compiled('globe');
    expect(jacobian(c, s, [110, 20], { margin: 10 })).toEqual(jacobian(c, s, [110, 20]));
  });

  test('the derivative stays one-sided where the other side is past the margin', () => {
    const { c, s } = compiled('gnomonic');
    // A hair inside the margin: the step outwards leaves it, so the derivative is the one from the inside, and still the true one.
    const inside = edge + 5 - 1e-6;
    const m = jacobian(c, s, [inside, 0], { margin: 5 })!;
    expect(m).not.toBeNull();
    const [big, small] = axes(m);
    const cos = Math.cos(inside * rad);
    near(big, s.k / (cos * cos), 5e-3);
    near(small, s.k / Math.abs(cos), 5e-3);
    expect(jacobian(c, s, [edge + 5 + 1e-6, 0], { margin: 5 })).toBeNull();
  });

  test('with a margin every stop gives a matrix of finite numbers or null, never infinity or NaN', () => {
    const r = rng(41);
    for (const stop of stops) {
      const { c, s } = compiled(stop.id);
      for (let n = 0; n < 150; n++) {
        const m = jacobian(c, s, randomPoint(r), { margin: 10 });
        if (m) expect(m.every(Number.isFinite), stop.id).toBe(true);
      }
      for (const pole of [[0, 90], [0, -90]] as LonLat[]) {
        const m = jacobian(c, s, pole, { margin: 10 });
        if (m) expect(m.every(Number.isFinite), `${stop.id} ${pole}`).toBe(true);
      }
    }
  });
});

describe('indicatrixCentres', () => {
  test('every 30 degrees from -60 to 60 in latitude, around the whole globe, plus both poles', () => {
    const centres = indicatrixCentres();
    const lats = new Set(centres.filter(([, lat]) => Math.abs(lat) < 90).map(([, lat]) => lat));
    expect([...lats].sort((a, b) => a - b)).toEqual([-60, -30, 0, 30, 60]);
    const lons = new Set(centres.filter(([, lat]) => lat === 0).map(([lon]) => lon));
    expect(lons.size).toBe(12);
    expect(centres.filter(([, lat]) => lat === 90)).toHaveLength(1);
    expect(centres.filter(([, lat]) => lat === -90)).toHaveLength(1);
    expect(centres).toHaveLength(62);
  });
});

let checked = 0;

describe('an indicatrix in a morph', () => {
  const member = (id: string, weight: number, o?: Partial<Orientation>) => ({ ...compiled(id, o), weight });
  const asMember = ({ c, s, weight }: ReturnType<typeof member>) => ({ compiled: c, screen: s, weight });

  test('mid-morph matrix equals a numeric derivative of the interpolated map', () => {
    for (const o of orientations(14, 3)) {
      const a = member('mercator', 1, o);
      const b = member('mollweide', 1, o);
      const p: LonLat = [20, 35];
      // By a seam it is in parts: the one that holds its centre goes from its place on the one map to its place on the other.
      const part = buildIndicatrices(p, [asMember(a)], asMember(b)).find((m) => m.cuts.every((cut) => cut[2] > 0));
      if (!part || Math.abs(a.c.toFrame(p)[1]) > 80 || Math.abs(b.c.toFrame(p)[1]) > 80) continue;
      const t = 0.7;
      const pos = (q: LonLat): [number, number] => {
        const pa = projectPoint(a.c, a.s, q);
        const pb = projectPoint(b.c, b.s, q);
        return [(1 - t) * pa[0] + t * pb[0], (1 - t) * pa[1] + t * pb[1]];
      };
      const h = 1e-5;
      const cosPhi = Math.cos(p[1] * rad);
      const e1 = pos([p[0] + h / rad, p[1]]);
      const e0 = pos([p[0] - h / rad, p[1]]);
      const n1 = pos([p[0], p[1] + h / rad]);
      const n0 = pos([p[0], p[1] - h / rad]);
      const reference: Mat2 = [
        (e1[0] - e0[0]) / (2 * h * cosPhi),
        (n1[0] - n0[0]) / (2 * h),
        (e1[1] - e0[1]) / (2 * h * cosPhi),
        (n1[1] - n0[1]) / (2 * h),
      ];
      const scale = Math.hypot(...reference);
      for (let k = 0; k < 4; k++) {
        const drawn = (1 - t) * part!.srcMat[k]! + t * part!.dstMat[k]!;
        expect(Math.abs(drawn - reference[k]!), JSON.stringify(o)).toBeLessThanOrEqual(1e-3 * scale);
      }
      const centre = pos(p);
      expect((1 - t) * part!.srcPos[0] + t * part!.dstPos[0]).toBeCloseTo(centre[0], 6);
      expect((1 - t) * part!.srcPos[1] + t * part!.dstPos[1]).toBeCloseTo(centre[1], 6);
      checked++;
    }
    expect(checked).toBe(4);
  });

  test('exports the 5 degree display radius in radians', () => {
    expect(INDICATRIX_RADIUS).toBeCloseTo(5 * rad, 12);
  });
});
