import { describe, expect, test } from 'vitest';
import { buildIndicatrices, type SceneIndicatrix } from '../src/morph/scene';
import type { LonLat, Orientation } from '../src/projections/types';
import { destination, projectPoint } from '../src/screen/screen';
import { INDICATRIX_RADIUS, indicatrixCentres, singularValues, type Mat2, type Member } from '../src/tissot/indicatrix';
import { foldedJacobian, restImages, type Cut } from '../src/tissot/rest';
import { member, rad, rng } from './sceneSupport';

type Pair = [number, number];

/** Whether a place in the unit disc, as east and north of the centre in radii, is in the part that the cuts leave. */
const within = (cuts: Cut[], [e, n]: Pair, slack = 0) => cuts.every(([me, mn, c]) => me * e + mn * n <= c - slack);

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const posAt = (m: SceneIndicatrix, t: number): Pair => [lerp(m.srcPos[0], m.dstPos[0], t), lerp(m.srcPos[1], m.dstPos[1], t)];
const matAt = (m: SceneIndicatrix, t: number): Mat2 => m.srcMat.map((v, k) => lerp(v, m.dstMat[k]!, t)) as Mat2;
/** Where an indicatrix puts the place `x` of its disc (east and north, in radii) at `t`. */
function imageOf(m: SceneIndicatrix, x: Pair, t: number): Pair {
  const [pos, mat] = [posAt(m, t), matAt(m, t)];
  const [e, n] = [x[0] * INDICATRIX_RADIUS, x[1] * INDICATRIX_RADIUS];
  return [pos[0] + mat[0] * e + mat[1] * n, pos[1] + mat[2] * e + mat[3] * n];
}
/** The point of the Earth at the place `x` of the disc round `p`. */
function pointOf(p: LonLat, [e, n]: Pair): LonLat {
  const distance = (Math.hypot(e, n) * INDICATRIX_RADIUS) / rad;
  return distance === 0 ? p : destination(p, distance, Math.atan2(e, n) / rad);
}
const blended = (source: Member[], target: Member, q: LonLat, t: number): Pair => {
  const at = (m: Member) => projectPoint(m.compiled, m.screen, q);
  const from = source.reduce<Pair>((sum, m) => [sum[0] + m.weight * at(m)[0], sum[1] + m.weight * at(m)[1]], [0, 0]);
  const to = at(target);
  return [lerp(from[0], to[0], t), lerp(from[1], to[1], t)];
};
const discPoints = (count: number, seed: number, radius = 1): Pair[] => {
  const r = rng(seed);
  const out: Pair[] = [];
  while (out.length < count) {
    const x: Pair = [2 * r() - 1, 2 * r() - 1];
    if (Math.hypot(...x) < 1) out.push([x[0] * radius, x[1] * radius]);
  }
  return out;
};
const rankOne = (mat: Mat2) => singularValues(mat)[1] < 1e-6 * singularValues(mat)[0];

describe('where a map cannot show a point, its derivative is that of the map folded onto its edge', () => {
  test('it has rank one: the indicatrix is flat along the edge, with no area', () => {
    const gnomonic = member('gnomonic');
    for (const p of [[98, 0], [120, 40], [-150, -20], [100, 70]] as LonLat[]) {
      const mat = foldedJacobian(gnomonic, p);
      expect(mat.every(Number.isFinite), `${p}`).toBe(true);
      expect(singularValues(mat)[0], `${p}`).toBeGreaterThan(0);
      expect(rankOne(mat), `${p}`).toBe(true);
    }
  });

  test('it is never huge: a step across a seam of the edge is taken from one side', () => {
    // Mercator's caps are at its poles, whose edges the antimeridian cuts.
    const mercator = member('mercator');
    const reference = singularValues(foldedJacobian(mercator, [10, 88]))[0];
    for (const lon of [179.9999, -179.9999, 180]) {
      expect(singularValues(foldedJacobian(mercator, [lon, 88]))[0], `${lon}`).toBeLessThan(3 * reference);
    }
  });
});

describe('an indicatrix in a morph is the disc split along every seam that crosses it, each part carried with its own side', () => {
  // The source's seam is at 180, two degrees from the point; the target's is far away, at -90.
  const [a, b] = [member('equirectangular'), member('equirectangular', { lon: 90 })];
  const p: LonLat = [178, 20];
  const parts = buildIndicatrices(p, [a], b);

  test('the parts are two, and between them they hold every place of the disc once', () => {
    expect(parts).toHaveLength(2);
    for (const x of discPoints(500, 7)) expect(parts.filter((m) => within(m.cuts, x)).length, `${x}`).toBe(1);
  });

  test('every part puts its places where the blended map puts them, at every moment', () => {
    for (const t of [0, 0.3, 0.7, 1]) {
      let checked = 0;
      for (const x of discPoints(300, 11)) {
        // Clear of the cut, where the place is on one side by any reckoning.
        const part = parts.find((m) => within(m.cuts, x, 0.02));
        if (!part) continue;
        const [want, got] = [blended([a], b, pointOf(p, x), t), imageOf(part, x, t)];
        // An equirectangular map is all but linear over five degrees.
        expect(Math.hypot(want[0] - got[0], want[1] - got[1]), `t ${t} at ${x}`).toBeLessThan(0.4);
        checked++;
      }
      expect(checked).toBeGreaterThan(250);
    }
  });

  test('the same holds on a pair of maps whose seams both cross it', () => {
    const [c, d] = [member('equirectangular', { lon: 0 }), member('mollweide', { lon: 3 })];
    const q: LonLat = [-179, -10];
    const pieces = buildIndicatrices(q, [c], d);
    expect(pieces.length).toBeGreaterThanOrEqual(3);
    let checked = 0;
    for (const x of discPoints(400, 5)) {
      expect(pieces.filter((m) => within(m.cuts, x)).length, `${x}`).toBe(1);
      const part = pieces.find((m) => within(m.cuts, x, 0.03))!;
      if (!part) continue;
      for (const t of [0, 0.5, 1]) {
        const [want, got] = [blended([c], d, pointOf(q, x), t), imageOf(part, x, t)];
        expect(Math.hypot(want[0] - got[0], want[1] - got[1]), `t ${t} at ${x}`).toBeLessThan(1.5);
      }
      checked++;
    }
    expect(checked).toBeGreaterThan(300);
  });
});

describe('the ends of a morph draw what the maps at rest draw', () => {
  // Each with the orientation both maps take; several are cases that once went wrong.
  const pairs: [string, string, Partial<Orientation>, Partial<Orientation>][] = [
    ['mercator', 'mollweide', { lon: 20 }, { lon: -35, lat: 15 }],
    ['mollweide', 'gnomonic', { lon: 20 }, { lon: -35, lat: 15 }],
    ['goode', 'equirectangular', { lon: 20 }, { lon: -35, lat: 15 }],
    ['globe', 'robinson', { lon: 20 }, { lon: -35, lat: 15 }],
    ['albers', 'stereographic', { lon: 20 }, { lon: -35, lat: 15 }],
    ['gnomonic', 'mollweide', { lon: 82, lat: 0 }, { lon: 82, lat: 0 }],
    ['gnomonic', 'globe', { lon: 14, lat: 8 }, { lon: 14, lat: 8 }],
    ['mercator', 'gnomonic', { lat: 12 }, { lat: 12 }],
    ['goode', 'globe', { lon: 6 }, { lon: 6 }],
    ['stereographic', 'mollweide', { lon: 15.05 }, { lon: 15.05 }],
    ['mollweide', 'mollweide', {}, { lon: 40 }],
  ];
  test.each(pairs)('%s to %s', (from, to, oa, ob) => {
    const [a, b] = [member(from, oa), member(to, ob)];
    const sample = discPoints(40, 3);
    for (const [end, m, t] of [['start', a, 0], ['end', b, 1]] as const) {
      for (const p of indicatrixCentres()) {
        const atRest = restImages(m, p);
        // What has no area, flat on an edge or on a globe's limb, draws nothing, and the far side of a globe is under the near side.
        const hiddenByGlobe = (x: SceneIndicatrix) => x.behind && (t === 1 ? to : from) === 'globe';
        const drawn = buildIndicatrices(p, [a], b).filter((x) => !rankOne(matAt(x, t)) && !hiddenByGlobe(x));
        for (const x of sample) {
          const want = atRest.filter((image) => within(image.cuts, x)).map((image) => [image.pos[0] + INDICATRIX_RADIUS * (image.mat[0] * x[0] + image.mat[1] * x[1]), image.pos[1] + INDICATRIX_RADIUS * (image.mat[2] * x[0] + image.mat[3] * x[1]), image.alpha]);
          const got = drawn.filter((d) => within(d.cuts, x) && lerp(d.alphaSrc, d.alphaDst, t) > 0).map((d) => [...imageOf(d, x, t), lerp(d.alphaSrc, d.alphaDst, t)]);
          const sorted = (list: number[][]) => [...list].sort((u, v) => u[0]! - v[0]! || u[1]! - v[1]!);
          expect(got.length, `${end} ${p} ${x}`).toBe(want.length);
          sorted(got).forEach((g, i) => g.forEach((value, k) => expect(value, `${end} ${p} ${x}`).toBeCloseTo(sorted(want)[i]![k]!, 6)));
        }
      }
    }
  });
});

describe('how strong an indicatrix is in a morph', () => {
  test('one that a map cannot show takes the strength it has on the other, for the whole morph: it flattens, and does not fade', () => {
    const [a, b] = [member('mollweide'), member('gnomonic')];
    // Far beyond gnomonic's edge, and well inside Mollweide.
    const [only] = buildIndicatrices([150, 0], [a], b);
    expect([only!.alphaSrc, only!.alphaDst]).toEqual([1, 1]);
    expect(rankOne(only!.dstMat)).toBe(true);
    expect(rankOne(only!.srcMat)).toBe(false);
  });

  test('one that neither end can show is left out', () => {
    const [a, b] = [member('gnomonic'), member('gnomonic', { lon: 10 })];
    expect(buildIndicatrices([170, 0], [a], b)).toEqual([]);
  });

  test('a morph redirected under way starts every part where it was, as strong as it was', () => {
    const [a, b, c] = [member('mercator'), member('gnomonic', { lon: 40 }), member('robinson', { lon: -20 })];
    const t = 0.4;
    for (const p of indicatrixCentres()) {
      const before = buildIndicatrices(p, [a], b);
      const after = buildIndicatrices(p, [{ ...a, weight: 1 - t }, { ...b, weight: t }], c);
      for (const x of discPoints(12, 9)) {
        const was = before.filter((m) => within(m.cuts, x, 0.01)).map((m) => [...imageOf(m, x, t), lerp(m.alphaSrc, m.alphaDst, t)]);
        const is = after.filter((m) => within(m.cuts, x, 0.01)).map((m) => [...imageOf(m, x, 0), m.alphaSrc]);
        // The new target's seams may split a part further, into parts that start at the same place.
        for (const now of is) {
          expect(was.some((old) => Math.hypot(old[0]! - now[0]!, old[1]! - now[1]!) < 1e-6 && Math.abs(old[2]! - now[2]!) < 1e-9), `${p} ${x}`).toBe(true);
        }
        if (was.length > 0) expect(is.length, `${p} ${x}`).toBeGreaterThan(0);
      }
    }
  });
});
