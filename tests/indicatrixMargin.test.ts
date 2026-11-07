import { describe, expect, test } from 'vitest';
import { geoDistance } from 'd3-geo';
import { buildScene } from '../src/morph/scene';
import { stops } from '../src/projections/catalog';
import { isCovered, projectPoint } from '../src/screen/screen';
import { INDICATRIX_RADIUS, indicatrixCentres, jacobian, singularValues } from '../src/tissot/indicatrix';
import { filledAt, member, ocean, rad } from './sceneSupport';

// A map at rest or being dragged shows an indicatrix a margin past a clip cap's edge, where its centre has left the map and the part
// of the ellipse still inside the outline shows. Gnomonic shows 68 degrees from its centre.
const EDGE = 68;

describe('indicatrices past a clip cap, at rest', () => {
  const gnomonic = member('gnomonic');
  const live = buildScene({}, [gnomonic], null, true).indicatrices;
  const covered = indicatrixCentres().filter((p) => isCovered(gnomonic.compiled, p));
  const centre = projectPoint(gnomonic.compiled, gnomonic.screen, [0, 0]);
  const distance = ([x, y]: [number, number]) => Math.hypot(x - centre[0], y - centre[1]);
  const rim = distance(projectPoint(gnomonic.compiled, gnomonic.screen, [EDGE, 0]));
  const past = live.filter((m) => distance(m.srcPos) > rim + 1e-6);

  test('there are some, and they are at their own projected place, not moved to the edge', () => {
    expect(live.length).toBeGreaterThan(covered.length);
    expect(past.length).toBeGreaterThan(0);
    const places = indicatrixCentres()
      .filter((p) => !isCovered(gnomonic.compiled, p))
      .map((p) => projectPoint(gnomonic.compiled, gnomonic.screen, p));
    for (const m of past) {
      expect(places.some(([x, y]) => Math.abs(x - m.srcPos[0]) < 1e-3 && Math.abs(y - m.srcPos[1]) < 1e-3)).toBe(true);
    }
  });

  test('each has the map\'s derivative there, full alpha, the same at both ends', () => {
    for (const m of past) {
      expect([m.alphaSrc, m.alphaDst]).toEqual([1, 1]);
      expect(m.dstPos).toEqual(m.srcPos);
      expect(m.dstMat).toEqual(m.srcMat);
      expect(m.behind).toBe(false);
    }
    const p = indicatrixCentres().find((q) => geoDistance(q, [0, 0]) / rad > EDGE && geoDistance(q, [0, 0]) / rad < EDGE + 10)!;
    const expected = jacobian(gnomonic.compiled, gnomonic.screen, p, { margin: 10 })!;
    expect(live.some((m) => m.srcMat.every((v, k) => v === expected[k]))).toBe(true);
  });

  test('none is beyond the margin, or larger than the cap on size', () => {
    // Gnomonic maps a point and its antipode to the same place, so a point 120 degrees out must not be mistaken for the one 60 out.
    const within = indicatrixCentres().filter((p) => geoDistance(p, [0, 0]) / rad < EDGE + 10);
    expect(live.length).toBeLessThanOrEqual(within.length);
    expect(live.length).toBeGreaterThan(covered.length);
    for (const m of live) expect((INDICATRIX_RADIUS * singularValues(m.srcMat)[0]) / gnomonic.screen.k).toBeLessThan(2.5);
  });

  test('one whose centre is exactly on the edge is there, as it is a hair either side', () => {
    // Turned to longitude 82, the ellipses at longitude 150 are 68 degrees out, on the rim.
    const counts = [81.9, 82 - 1e-9, 82, 82 + 1e-9, 82.1].map((lon) => {
      const turned = member('gnomonic', { lon });
      return buildScene({}, [turned], null, true).indicatrices.length;
    });
    expect(new Set(counts).size, counts.join()).toBe(1);
  });

  test('in a morph the margin is not used: what is off the map fades by its own curve, as before', () => {
    const scene = buildScene({}, [gnomonic], member('mollweide'), true);
    const uncovered = indicatrixCentres().filter((p) => !isCovered(gnomonic.compiled, p));
    expect(uncovered.length).toBeGreaterThan(0);
    expect(scene.indicatrices.filter((m) => m.alphaSrc === 0).length).toBeGreaterThan(10);
  });
});

test('Mercator\'s poles, at infinity, give no indicatrix however the margin treats them', () => {
  for (const id of ['mercator', 'equirectangular', 'lambert-conformal']) {
    const m = member(id);
    for (const e of buildScene({}, [m], null, true).indicatrices) {
      expect((INDICATRIX_RADIUS * singularValues(e.srcMat)[0]) / m.screen.k, id).toBeLessThan(2.5);
    }
  }
});

test('an indicatrix shown past a cap is never inside the outline of the map: it is not a second copy of something the map shows', () => {
  const orientations = [{}, { lon: 70, lat: 40 }, { lon: -100, lat: -70 }];
  for (const stop of stops) {
    for (const o of orientations) {
      const m = member(stop.id, o);
      const scene = buildScene({ ocean }, [m], null, true);
      const outline = scene.layers.ocean!;
      const covers = indicatrixCentres().filter((p) => isCovered(m.compiled, p));
      const shown = scene.indicatrices;
      // The ones past a cap are those left when the covered centres' places are taken away.
      const own = new Set(covers.map((p) => projectPoint(m.compiled, m.screen, p).map((v) => v.toFixed(3)).join()));
      const extra = shown.filter((e) => !own.has(e.srcPos.map((v) => v.toFixed(3)).join()));
      for (const e of extra) {
        expect(filledAt(outline, (piece) => piece.src, e.srcPos[0], e.srcPos[1]), `${stop.id} ${JSON.stringify(o)} at ${e.srcPos}`).toBe(false);
      }
    }
  }
});
