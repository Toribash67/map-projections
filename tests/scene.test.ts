import { expect, test } from 'vitest';
import { geoDistance } from 'd3-geo';
import { cutGeometry } from '../src/geo/cut';
import { MorphController } from '../src/morph/controller';
import { buildScene, type Scene, type ScenePiece } from '../src/morph/scene';
import { stops } from '../src/projections/catalog';
import { stateForStop } from '../src/projections/compile';
import type { LonLat, ProjectionState } from '../src/projections/types';
import { isCovered, projectPoint } from '../src/screen/screen';
import { destination } from '../src/screen/screen';
import { indicatrixCentres, jacobian, singularValues, type Mat2, type Member } from '../src/tissot/indicatrix';
import {
  aloneArea,
  aloneRaster,
  cellsOf,
  difference,
  filledArea,
  frameAt,
  isShown,
  land,
  line,
  longestSegment,
  member,
  memberOf,
  ocean,
  pointAt,
  rad,
  randomOrientation,
  raster,
  ringsOf,
  rng,
  STREAK,
  VIEW,
  world,
} from './sceneSupport';

test('at t=0 src equals projectPoint under the source; at t=1 dst under the target', () => {
  const pairs: [Member, Member][] = [
    [member('mercator'), member('mollweide')],
    [member('robinson', { lon: 40, lat: 20, tilt: 30 }), member('sinusoidal', { lon: -70 })],
    [member('goode'), member('hammer')],
  ];
  for (const [source, target] of pairs) {
    const scene = buildScene({ land }, [source], target, false);
    const members = [source, target];
    const cut = cutGeometry(land, members.map((m) => m.compiled)).filter(isShown);
    const pieces = scene.layers.land!;
    expect(pieces.length).toBe(cut.length);
    let checked = 0;
    cut.forEach((piece, n) => {
      if (!piece.inside[0] || !piece.inside[1]) return;
      const scenePiece = pieces[n]!;
      expect(scenePiece.closed).toBe(piece.closed);
      expect(ringsOf(scenePiece).map(([a, b]) => b - a)).toEqual(piece.coords.map((c) => c.length));
      piece.coords.flat().forEach((p, i) => {
        const src = projectPoint(source.compiled, source.screen, p, piece.lobes[0]);
        const dst = projectPoint(target.compiled, target.screen, p, piece.lobes[1]);
        expect(Math.hypot(scenePiece.src[2 * i]! - src[0], scenePiece.src[2 * i + 1]! - src[1])).toBeLessThan(1e-3);
        expect(Math.hypot(scenePiece.dst[2 * i]! - dst[0], scenePiece.dst[2 * i + 1]! - dst[1])).toBeLessThan(1e-3);
        checked++;
      });
    });
    expect(checked).toBeGreaterThan(1000);
  }
});

test('a source of several members is the weighted sum of their positions', () => {
  const [a, b, c] = [member('mercator', {}, 0.5), member('mollweide', {}, 0.3), member('hammer', {}, 0.2)];
  const target = member('robinson');
  const p: LonLat = [20, 30];
  const piece = buildScene({ probe: line(p, [20.5, 30]) }, [a, b, c], target, false).layers.probe![0]!;
  const expected = [0, 1].map(
    (k) => 0.5 * projectPoint(a.compiled, a.screen, p)[k]! + 0.3 * projectPoint(b.compiled, b.screen, p)[k]! + 0.2 * projectPoint(c.compiled, c.screen, p)[k]!,
  );
  expect(piece.src[0]).toBeCloseTo(expected[0]!, 2);
  expect(piece.src[1]).toBeCloseTo(expected[1]!, 2);
  expect(piece.alphaSrc).toBeCloseTo(1, 10);
  expect(piece.alphaDst).toBe(1);
});

test('points outside a clip cap move to the cap edge, and alpha goes to 0', () => {
  const source = member('mollweide');
  const target = member('gnomonic');
  const pieces = buildScene({ land }, [source], target, false).layers.land!;
  const centre = projectPoint(target.compiled, target.screen, [0, 0]);
  const edge = projectPoint(target.compiled, target.screen, [68, 0]);
  const limit = Math.hypot(edge[0] - centre[0], edge[1] - centre[1]);
  const outside = pieces.filter((p) => p.alphaDst === 0);
  expect(outside.length).toBeGreaterThan(0);
  for (const piece of outside) {
    expect(piece.alphaSrc).toBe(1);
    for (const [x, y] of Array.from({ length: piece.dst.length / 2 }, (_, i) => pointAt(piece.dst, i))) {
      expect(Math.abs(Math.hypot(x - centre[0], y - centre[1]) - limit)).toBeLessThan(0.1);
    }
  }
  const covered = pieces.filter((p) => p.alphaDst === 1);
  expect(covered.length).toBeGreaterThan(0);
  for (const piece of covered) expect(piece.alphaSrc).toBe(1);
});

test('fading works the other way too: a piece the source cannot show fades in', () => {
  const source = member('gnomonic');
  const target = member('mollweide');
  const pieces = buildScene({ land }, [source], target, false).layers.land!;
  const fadingIn = pieces.filter((p) => p.alphaSrc === 0);
  expect(fadingIn.length).toBeGreaterThan(0);
  for (const piece of fadingIn) expect(piece.alphaDst).toBe(1);
});

test('a source member\'s weight counts toward alpha only where it can show the piece', () => {
  const source = [member('gnomonic', {}, 0.25), member('mollweide', {}, 0.75)];
  const target = member('mollweide');
  // On the far side of the world from the gnomonic centre, and well inside the other two.
  const piece = buildScene({ probe: line([170, 5], [170.5, 5]) }, source, target, false).layers.probe![0]!;
  expect(piece.alphaSrc).toBeCloseTo(0.75, 10);
  expect(piece.alphaDst).toBe(1);
});

test('a piece neither end can show is left out', () => {
  // Close to the antipode of both gnomonic centres.
  const scene = buildScene({ probe: line([170, 5], [170.5, 5]) }, [member('gnomonic')], member('gnomonic', { lon: 5 }), false);
  expect(scene.layers.probe).toEqual([]);
});

test('moving to the cap edge goes by true direction from the cap centre', () => {
  const target = member('gnomonic');
  const source = member('mollweide', { lon: 60 });
  const centre = projectPoint(target.compiled, target.screen, [0, 0]);
  for (const p of [[150, 20], [-120, -40], [100, 60], [179, 1], [-179.9, -0.5]] as LonLat[]) {
    const piece = buildScene({ probe: line(p, [p[0] + 0.01, p[1]]) }, [source], target, false).layers.probe![0]!;
    const [x, y] = pointAt(piece.dst, 0);
    // An azimuthal map shows a point at its true bearing from the centre.
    const bearing = Math.atan2(Math.cos(p[1] * rad) * Math.sin(p[0] * rad), Math.sin(p[1] * rad));
    const angle = Math.atan2(x - centre[0], -(y - centre[1]));
    expect(Math.abs(Math.atan2(Math.sin(angle - bearing), Math.cos(angle - bearing))), `${p}`).toBeLessThan(1e-3);
  }
});

test('a point at or almost at a cap centre cannot produce NaN, on a map tilted or not', () => {
  const cases: [Member, LonLat[]][] = [
    // The antipode of a gnomonic centre, exactly and almost.
    [member('gnomonic'), [[180, 0], [179.9999999, 1e-9], [-180, 0]]],
    // The frame pole of a tilted Mercator, exactly and almost.
    [member('mercator', { lon: 30, lat: 40, tilt: 50 }), []],
    [member('mercator'), [[0, 90], [120, 90], [0, -90], [50, 89.9999999]]],
    [member('goode'), [[0, 90], [120, 90], [0, -90]]],
    [member('albers'), [[10, 90], [10, -90]]],
  ];
  const [tilted] = cases[1]!;
  cases[1]![1] = [tilted.compiled.fromFrame([0, 90]), tilted.compiled.fromFrame([77, 90 - 1e-8])];
  const other = member('robinson', { lon: 77, lat: 11, tilt: 7 });
  for (const [capped, points] of cases) {
    const geometry = (p: LonLat) => line(p, [p[0] + 0.5, p[1] > 0 ? p[1] - 0.5 : p[1] + 0.5]);
    for (const p of points) {
      for (const [source, target] of [[capped, other], [other, capped]] as const) {
        const pieces = buildScene({ probe: geometry(p) }, [source], target, true).layers.probe!;
        expect(pieces.length, `${capped.compiled.def.id} ${p}`).toBeGreaterThan(0);
        for (const piece of pieces) {
          expect([...piece.src, ...piece.dst].every(Number.isFinite), `${capped.compiled.def.id} ${p}`).toBe(true);
        }
      }
    }
  }
});

test('a ring round a frame pole inside a cap stays clear of NaN and of chords', () => {
  const mercator = member('mercator', { lon: 30, lat: 40, tilt: 50 });
  const other = member('robinson', { lon: -20 });
  const ring: LonLat[] = [];
  // Round the frame pole, close to it, in big steps. On Mercator the cap's edge is the map's whole top edge.
  for (let lon = -179; lon <= 179; lon += 40) ring.push(mercator.compiled.fromFrame([lon, 89.99]));
  const scene = buildScene({ probe: line(...ring), ocean }, [other], mercator, false);
  // The sphere's own cut leaves a ring round the pole just 1e-6 radians off it.
  for (const piece of [...scene.layers.probe!, ...scene.layers.ocean!]) {
    expect([...piece.src, ...piece.dst].every(Number.isFinite)).toBe(true);
    expect(longestSegment(piece, piece.dst)).toBeLessThan(STREAK / 2);
  }
  expect(scene.layers.probe!.length).toBeGreaterThan(0);
});

test('a line passing through a cap centre runs along the cap edge, not across the map', () => {
  // The equator and the meridian through the gnomonic antipode, and close by it.
  const target = member('gnomonic');
  const source = member('mollweide', { lon: 40 });
  const lines = [line([170, 0], [-170, 0]), line([180, -10], [180, 10]), line([179.99999, -10], [-179.99999, 10]), line([170, 1e-7], [-170, 1e-7])];
  for (const geometry of lines) {
    const pieces = buildScene({ probe: geometry }, [source], target, false).layers.probe!;
    expect(pieces.length).toBeGreaterThan(0);
    for (const piece of pieces) {
      expect(longestSegment(piece, piece.dst), JSON.stringify(geometry)).toBeLessThan(STREAK / 2);
      expect(piece.src.length).toBe(piece.dst.length);
      // The extra points hardly move in the source, where this is an ordinary short line.
      expect(longestSegment(piece, piece.src), JSON.stringify(geometry)).toBeLessThan(30);
    }
  }
});

test('globe far side: behind true, alpha 1, src position is orthographic', () => {
  const globe = member('globe', { lon: 40, lat: 15 });
  const target = member('mercator');
  const pieces = buildScene({ land }, [globe], target, false).layers.land!;
  const cut = cutGeometry(land, [globe.compiled, target.compiled]);
  const behindCut = cut.filter((p) => p.behind[0]);
  expect(behindCut.length).toBeGreaterThan(0);
  const behind = pieces.filter((p) => p.behind);
  expect(behind.length).toBe(behindCut.length);
  behind.forEach((piece, n) => {
    expect(piece.alphaSrc).toBe(1);
    // Only what Mercator can show, which is all but its pole caps, stays shown at the far end.
    expect(piece.alphaDst).toBe(behindCut[n]!.inside[1] ? 1 : 0);
    if (!behindCut[n]!.inside[1]) return;
    behindCut[n]!.coords.flat().forEach((p, i) => {
      const expected = projectPoint(globe.compiled, globe.screen, p);
      expect(Math.hypot(piece.src[2 * i]! - expected[0], piece.src[2 * i + 1]! - expected[1])).toBeLessThan(1e-3);
    });
  });
  expect(pieces.some((p) => !p.behind)).toBe(true);
});

test('behind is true when the target has the piece behind', () => {
  const pieces = buildScene({ land }, [member('mercator')], member('globe', { lon: 40 }), false).layers.land!;
  expect(pieces.some((p) => p.behind)).toBe(true);
  expect(pieces.some((p) => !p.behind)).toBe(true);
});

test('with no target nothing behind or outside is kept, and both ends are the same', () => {
  for (const id of ['globe', 'gnomonic', 'mercator', 'goode', 'albers']) {
    const scene = buildScene(world, [member(id, { lon: 25 })], null, false);
    for (const pieces of Object.values(scene.layers)) {
      expect(pieces.length).toBeGreaterThan(0);
      for (const piece of pieces) {
        expect(piece.behind).toBe(false);
        expect(piece.alphaSrc).toBe(1);
        expect(piece.alphaDst).toBe(1);
        expect(piece.dst).toBe(piece.src);
      }
    }
  }
});

test('ring starts mark where each ring begins, in points, and closed rings repeat their first point', () => {
  const scene = buildScene({ land }, [member('mollweide')], member('robinson', { lon: 30 }), false);
  for (const piece of scene.layers.land!) {
    expect(piece.ringStarts[0]).toBe(0);
    expect(piece.src.length).toBe(piece.dst.length);
    for (const [start, end] of ringsOf(piece)) {
      expect(end - start).toBeGreaterThanOrEqual(4);
      expect(pointAt(piece.src, end - 1)).toEqual(pointAt(piece.src, start));
      expect(pointAt(piece.dst, end - 1)).toEqual(pointAt(piece.dst, start));
    }
  }
});

// Indicatrices.

const axisRatio = (m: Parameters<typeof singularValues>[0]) => {
  const [big, small] = singularValues(m);
  return small / big;
};

test('no indicatrices unless asked for', () => {
  expect(buildScene({}, [member('mercator')], member('hammer'), false).indicatrices).toEqual([]);
  expect(buildScene({}, [member('mercator')], null, false).indicatrices).toEqual([]);
});

test('an indicatrix covered at both ends has the projected position and the Jacobian at both ends', () => {
  const [a, b] = [member('mercator'), member('mollweide', { lon: 30, lat: 10, tilt: 20 })];
  const shown = buildScene({}, [a], b, true).indicatrices.filter((m) => m.alphaSrc > 0 && m.alphaDst > 0);
  const both = indicatrixCentres().filter((p) => isCovered(a.compiled, p) && isCovered(b.compiled, p));
  expect(shown.length).toBe(both.length);
  shown.forEach((m, i) => {
    const p = both[i]!;
    expect(m.srcPos).toEqual(projectPoint(a.compiled, a.screen, p));
    expect(m.dstPos).toEqual(projectPoint(b.compiled, b.screen, p));
    expect(m.srcMat).toEqual(jacobian(a.compiled, a.screen, p));
    expect(m.dstMat).toEqual(jacobian(b.compiled, b.screen, p));
    expect([m.alphaSrc, m.alphaDst]).toEqual([1, 1]);
  });
});

test('live, an indicatrix shows the same at both ends, and only where covered', () => {
  const m = member('mollweide', { lon: 30 });
  const scene = buildScene({}, [m], null, true);
  const covered = indicatrixCentres().filter((p) => isCovered(m.compiled, p));
  expect(scene.indicatrices.length).toBe(covered.length);
  scene.indicatrices.forEach((x, i) => {
    expect(x.srcPos).toEqual(projectPoint(m.compiled, m.screen, covered[i]!));
    expect(x.dstPos).toEqual(x.srcPos);
    expect(x.dstMat).toEqual(x.srcMat);
    expect([x.alphaSrc, x.alphaDst]).toEqual([1, 1]);
  });
});

test('an indicatrix off the map at one end fades, moves to the cap edge, and keeps its shape', () => {
  const source = member('mollweide');
  const target = member('gnomonic');
  const scene = buildScene({}, [source], target, true);
  const centre = projectPoint(target.compiled, target.screen, [0, 0]);
  const rim = projectPoint(target.compiled, target.screen, [68, 0]);
  const limit = Math.hypot(rim[0] - centre[0], rim[1] - centre[1]);
  const fading = scene.indicatrices.filter((m) => m.alphaDst === 0);
  expect(fading.length).toBeGreaterThan(10);
  for (const m of fading) {
    expect(m.alphaSrc).toBe(1);
    expect(Math.abs(Math.hypot(m.dstPos[0] - centre[0], m.dstPos[1] - centre[1]) - limit)).toBeLessThan(0.1);
    expect(m.dstMat).toEqual(m.srcMat);
  }
});

test('indicatrix alpha comes from the weight of the members that can show it', () => {
  const source = [member('gnomonic', {}, 0.25), member('mollweide', {}, 0.75)];
  const target = member('robinson');
  const centres = indicatrixCentres();
  const scene = buildScene({}, source, target, true);
  // Off the gnomonic map and on the other two.
  const atFar = scene.indicatrices.find((m) => m.dstPos.join() === projectPoint(target.compiled, target.screen, [150, 30]).join())!;
  expect(centres).toContainEqual([150, 30]);
  expect(atFar.alphaSrc).toBeCloseTo(0.75, 10);
  expect(atFar.alphaDst).toBe(1);
  // The matrix is the mix of those that can, renormalised, as `blendIndicatrix` gives it.
  expect(atFar.srcMat).toEqual(jacobian(source[1]!.compiled, source[1]!.screen, [150, 30]));
  // The position still follows the land beneath it, through the gnomonic map's edge.
  const moll = projectPoint(source[1]!.compiled, source[1]!.screen, [150, 30]);
  const bearing = Math.atan2(Math.cos(30 * rad) * Math.sin(150 * rad), Math.sin(30 * rad));
  const gnomonic = source[0]!;
  const edge = projectPoint(gnomonic.compiled, gnomonic.screen, gnomonic.compiled.fromFrame(frameAt(68, bearing)));
  expect(atFar.srcPos[0]).toBeCloseTo(0.75 * moll[0] + 0.25 * edge[0], 3);
  expect(atFar.srcPos[1]).toBeCloseTo(0.75 * moll[1] + 0.25 * edge[1], 3);
});

test('singular ellipses on the opening globe are not shown, and the rest are', () => {
  const globe = member('globe');
  const scene = buildScene({}, [globe], null, true);
  const centres = indicatrixCentres().filter((p) => isCovered(globe.compiled, p));
  const onLimb = centres.filter((p) => Math.abs(geoDistance(p, [0, 0]) / rad - 90) < 1e-6);
  expect(onLimb.length).toBeGreaterThan(0);
  expect(scene.indicatrices.length).toBe(centres.length - onLimb.length);
  for (const m of scene.indicatrices) expect(axisRatio(m.srcMat)).toBeGreaterThan(0.1);
});

test('a thin ellipse close to the limb is still shown: the threshold is on near-zero axes', () => {
  // cos 89.5 degrees: the axis ratio on an orthographic map, about 0.0087.
  const globe = member('globe', { lon: -59.5 });
  const scene = buildScene({}, [globe], null, true);
  const p: LonLat = [30, 0];
  expect(isCovered(globe.compiled, p)).toBe(true);
  const expected = projectPoint(globe.compiled, globe.screen, p);
  const m = scene.indicatrices.find((x) => x.srcPos.join() === expected.join())!;
  expect(m).toBeDefined();
  expect(axisRatio(m.srcMat)).toBeCloseTo(Math.cos(89.5 * rad), 2);
});

test('an ellipse singular at one end fades in, on its true matrices, and does not pop', () => {
  const globe = member('globe');
  const target = member('mollweide');
  const scene = buildScene({}, [globe], target, true);
  const p: LonLat = [90, 30];
  const expected = projectPoint(target.compiled, target.screen, p);
  const m = scene.indicatrices.find((x) => x.dstPos.join() === expected.join())!;
  expect(m).toBeDefined();
  expect(m.alphaSrc).toBe(0);
  expect(m.alphaDst).toBe(1);
  expect(m.srcMat).toEqual(jacobian(globe.compiled, globe.screen, p));
  expect(axisRatio(m.srcMat)).toBeLessThan(1e-3);
  expect(m.dstMat).toEqual(jacobian(target.compiled, target.screen, p));
  expect(m.srcPos).toEqual(projectPoint(globe.compiled, globe.screen, p));
});

test('an indicatrix singular or off the map at both ends is left out', () => {
  // Both limbs pass through the poles.
  const scene = buildScene({}, [member('globe')], member('globe', { lon: 30 }), true);
  const poles = scene.indicatrices.filter((m) => Math.abs(axisRatio(m.srcMat)) < 1e-3 && Math.abs(axisRatio(m.dstMat)) < 1e-3);
  expect(poles).toEqual([]);
  for (const m of scene.indicatrices) expect(m.alphaSrc + m.alphaDst).toBeGreaterThan(0);
});

test('far-side ellipses in a globe morph are the derivative of the in-between map, at every moment', () => {
  const globe = member('globe');
  const target = member('mollweide');
  const scene = buildScene({}, [globe], target, true);
  const inBetween = (p: LonLat, t: number): [number, number] => {
    const [a, b] = [projectPoint(globe.compiled, globe.screen, p), projectPoint(target.compiled, target.screen, p)];
    return [(1 - t) * a[0] + t * b[0], (1 - t) * a[1] + t * b[1]];
  };
  const h = 1e-4; // radians of true distance
  let checked = 0;
  for (const p of indicatrixCentres()) {
    const [lon, lat] = p;
    // On the far side, away from the poles, and with the Mollweide seam out of the derivative's reach.
    if (geoDistance(p, [0, 0]) / rad <= 90 + 1e-6 || Math.abs(lat) === 90 || Math.abs(Math.abs(target.compiled.toFrame(p)[0]) - 180) < 0.1) continue;
    const expected = projectPoint(target.compiled, target.screen, p);
    const m = scene.indicatrices.find((x) => x.dstPos.join() === expected.join())!;
    expect(m, `${lon},${lat}`).toBeDefined();
    expect(m.behind).toBe(true);
    expect(m.alphaSrc).toBe(1);
    expect(m.alphaDst).toBe(1);
    for (const t of [0, 0.25, 0.5, 0.8, 1]) {
      const drawn = m.srcMat.map((v, k) => (1 - t) * v + t * m.dstMat[k]!) as Mat2;
      const along = (azimuth: number) => {
        const [plus, minus] = [inBetween(destination(p, h / rad, azimuth), t), inBetween(destination(p, -h / rad, azimuth), t)];
        return [(plus[0] - minus[0]) / (2 * h), (plus[1] - minus[1]) / (2 * h)];
      };
      const [east, north] = [along(90), along(0)];
      const numeric = [east[0]!, north[0]!, east[1]!, north[1]!];
      const scale = Math.max(...numeric.map(Math.abs));
      numeric.forEach((v, k) => expect(Math.abs(drawn[k]! - v), `${lon},${lat} at t ${t}`).toBeLessThan(2e-3 * scale));
    }
    checked++;
  }
  expect(checked).toBeGreaterThanOrEqual(20);
});

test('only the far side of a globe is marked behind, at either end of a morph', () => {
  const globe = member('globe');
  const flat = member('robinson');
  for (const scene of [buildScene({}, [globe], flat, true), buildScene({}, [flat], globe, true)]) {
    expect(scene.indicatrices.some((m) => m.behind)).toBe(true);
    expect(scene.indicatrices.some((m) => !m.behind)).toBe(true);
  }
  expect(buildScene({}, [flat], member('hammer'), true).indicatrices.every((m) => !m.behind)).toBe(true);
  // On a globe at rest, the far side is not drawn at all.
  const live = buildScene({}, [globe], null, true).indicatrices;
  expect(live.every((m) => !m.behind)).toBe(true);
  expect(live.length).toBeLessThanOrEqual(indicatrixCentres().filter((p) => geoDistance(p, [0, 0]) / rad <= 90).length);
});

test('a clip cap still fades an indicatrix, where a behind cap does not', () => {
  const scene = buildScene({}, [member('gnomonic')], member('mollweide'), true);
  expect(scene.indicatrices.some((m) => m.alphaSrc === 0 && m.alphaDst === 1 && !m.behind)).toBe(true);
  const toGlobe = buildScene({}, [member('mollweide')], member('globe'), true);
  for (const m of toGlobe.indicatrices.filter((x) => x.behind)) expect(m.alphaDst).toBe(1);
});

test('an ellipse on the limb is singular and fades, and those just either side of it are thin and shown', () => {
  // A globe turned so that one centre lies a whisker to either side of the limb, as a far-side ellipse goes through it.
  const target = member('mollweide');
  const p: LonLat = [30, 0];
  for (const [offset, shown] of [[0, false], [1e-3, false], [-1e-3, false], [0.2, true], [-0.2, true]] as const) {
    const globe = member('globe', { lon: 30 - 90 + offset });
    const m = buildScene({}, [globe], target, true).indicatrices.find((x) => x.dstPos.join() === projectPoint(target.compiled, target.screen, p).join())!;
    expect(m, `offset ${offset}`).toBeDefined();
    expect(m.alphaSrc, `offset ${offset}`).toBe(shown ? 1 : 0);
    expect(m.alphaDst, `offset ${offset}`).toBe(1);
    expect(m.srcMat).toEqual(jacobian(globe.compiled, globe.screen, p));
  }
});

// Every pair of stops.

type SweepResult = { nan: string[]; streaks: string[]; worst: number; pairs: number };

function sweepScene(scene: Scene, label: string, out: SweepResult) {
  for (const [name, pieces] of Object.entries(scene.layers)) {
    if (pieces.length === 0) out.nan.push(`${label}: ${name} is empty`);
    for (const piece of pieces) {
      for (const [end, positions] of [['src', piece.src], ['dst', piece.dst]] as const) {
        if (!positions.every(Number.isFinite)) out.nan.push(`${label}: ${name} ${end}`);
        const longest = longestSegment(piece, positions);
        out.worst = Math.max(out.worst, longest);
        if (longest >= STREAK) out.streaks.push(`${label}: ${name} ${end} ${longest.toFixed(0)} px`);
      }
    }
  }
  for (const m of scene.indicatrices) {
    if (![...m.srcPos, ...m.dstPos, ...m.srcMat, ...m.dstMat, m.alphaSrc, m.alphaDst].every(Number.isFinite)) out.nan.push(`${label}: indicatrix`);
  }
}

/** Runs once, for the two tests below: the sweep takes a good while, and looks at the same scenes. */
let defaultSweep: SweepResult | undefined;
function allPairs(): SweepResult {
  if (defaultSweep) return defaultSweep;
  const out: SweepResult = { nan: [], streaks: [], worst: 0, pairs: 0 };
  for (const a of stops) {
    const from = stateForStop(a);
    for (const b of stops) {
      if (a === b) continue;
      const scene = buildScene(world, [memberOf(from)], memberOf(stateForStop(b, from)), true);
      sweepScene(scene, `${a.id} to ${b.id}`, out);
      out.pairs++;
    }
  }
  defaultSweep = out;
  return out;
}

test('no NaN in any array for any pair of stops (all ordered pairs)', () => {
  const result = allPairs();
  expect(result.pairs).toBe(21 * 20);
  expect(result.nan).toEqual([]);
}, 180_000);

test('no streak: no segment in src or dst longer than 25% of the viewport diagonal, all ordered pairs at default orientations', () => {
  expect(allPairs().streaks).toEqual([]);
}, 180_000);

test('no streak and no NaN at seeded random orientations, independently oriented and carried over as clicks are', () => {
  const r = rng(20261106);
  const out: SweepResult = { nan: [], streaks: [], worst: 0, pairs: 0 };
  const pick = () => stops[Math.floor(r() * stops.length)]!;
  for (let i = 0; i < 60; i++) {
    const [a, b] = [pick(), pick()];
    const from = { ...stateForStop(a), orientation: randomOrientation(r) };
    const to = i % 2 ? { ...stateForStop(b), orientation: randomOrientation(r) } : stateForStop(b, from);
    const label = `${a.id} ${JSON.stringify(from.orientation)} to ${b.id} ${JSON.stringify(to.orientation)}`;
    sweepScene(buildScene(world, [memberOf(from)], memberOf(to), true), label, out);
  }
  expect(out.nan).toEqual([]);
  expect(out.streaks).toEqual([]);
}, 60_000);

test('no streak and no NaN on a settled or dragged map, for every stop', () => {
  const r = rng(1009);
  const out: SweepResult = { nan: [], streaks: [], worst: 0, pairs: 0 };
  for (const s of stops) {
    for (let i = 0; i < 12; i++) {
      const state = stateForStop(s);
      const orientation = i === 0 ? state.orientation : randomOrientation(r);
      const label = `${s.id} ${JSON.stringify(orientation)}`;
      sweepScene(buildScene(world, [memberOf({ ...state, orientation })], null, true), label, out);
    }
  }
  expect(out.nan).toEqual([]);
  expect(out.streaks).toEqual([]);
}, 60_000);

test('no streak and no NaN for conics away from their defaults, live and morphing to and from a world map', () => {
  const r = rng(7771);
  const out: SweepResult = { nan: [], streaks: [], worst: 0, pairs: 0 };
  const conic = (defId: string, p1: number, p2: number): ProjectionState => ({
    ...stateForStop(stops.find((s) => s.defId === defId)!),
    params: { p1, p2 },
  });
  const conics = [
    conic('conic-equal-area', 10, 60),
    conic('conic-conformal', 5, 15),
    // Close to a cylinder, close to a disc, and a cone opening the other way.
    conic('conic-conformal', 3, -2),
    conic('conic-equal-area', 80, 89.9),
    conic('conic-conformal', -60, -30),
  ];
  const maps = ['globe', 'equirectangular', 'mercator', 'robinson', 'mollweide', 'goode'].map((id) => stops.find((s) => s.id === id)!);
  for (const c of conics) {
    const name = `${c.defId} ${c.params.p1}/${c.params.p2}`;
    // Settled, and dragged sideways.
    for (const lon of [c.orientation.lon, -150, 40, 170]) {
      const state = { ...c, orientation: { ...c.orientation, lon } };
      sweepScene(buildScene(world, [memberOf(state)], null, true), `${name} at lon ${lon}`, out);
    }
    for (const w of maps) {
      sweepScene(buildScene(world, [memberOf(c)], memberOf(stateForStop(w, c)), true), `${name} to ${w.id}`, out);
      const wm = { ...stateForStop(w), orientation: randomOrientation(r) };
      sweepScene(buildScene(world, [memberOf(wm)], memberOf(stateForStop(stops.find((s) => s.defId === c.defId)!, wm)), true), `${w.id} to ${c.defId}`, out);
      const to = { ...c, orientation: { ...c.orientation, lon: r() * 360 - 180 } };
      sweepScene(buildScene(world, [memberOf({ ...stateForStop(w), orientation: randomOrientation(r) })], memberOf(to), true), `${w.id} to ${name} at ${to.orientation.lon.toFixed(0)}`, out);
    }
  }
  expect(out.nan).toEqual([]);
  expect(out.streaks).toEqual([]);
}, 120_000);

// Fills in the plane.

test('the ocean fills correctly at both ends of globe, Goode, then Transverse Mercator redirected mid-morph', () => {
  // The route behind ruling R13, through the real controller. A wrong cut walks whole lobes here,
  // on top of pieces that are right, so the area has to be checked as well as what gets covered.
  let time = 0;
  const controller = new MorphController(() => time);
  const globe = member('globe');
  const goode = memberOf(stateForStop(stops.find((s) => s.id === 'goode')!, globe.compiled.state));
  const transverse = memberOf(stateForStop(stops.find((s) => s.id === 'transverse-mercator')!, goode.compiled.state));
  controller.jumpTo(globe);
  controller.morphTo(goode);
  time += 700;
  const midT = controller.t();
  const before = buildScene({ ocean }, controller.source(), controller.target(), false).layers.ocean!;
  controller.morphTo(transverse);
  expect(controller.source().length).toBe(2);
  const after = buildScene({ ocean }, controller.source(), controller.target(), false).layers.ocean!;

  // Target end: exactly Transverse Mercator's ocean.
  // Pieces behind the globe at the source end are as much a part of the map as any at this one.
  const shownAtEnd = after.filter((p) => p.alphaDst > 0);
  const atEnd = raster(shownAtEnd.map((piece) => ({ piece, positions: piece.dst })));
  const aloneEnd = aloneRaster(transverse, ocean);
  expect(cellsOf(aloneEnd)).toBeGreaterThan(1000);
  expect(difference(atEnd, aloneEnd) / cellsOf(aloneEnd)).toBeLessThan(0.01);
  expect(Math.abs(filledArea(shownAtEnd, (p) => p.dst) / aloneArea(transverse, ocean) - 1)).toBeLessThan(0.01);

  // Source end: the same picture as the morph it interrupted, at the moment it was interrupted.
  const blendOf = (p: ScenePiece) => {
    const out = new Float32Array(p.src.length);
    for (let i = 0; i < out.length; i++) out[i] = (1 - midT) * p.src[i]! + midT * p.dst[i]!;
    return out;
  };
  const shownBefore = before.filter((p) => (1 - midT) * p.alphaSrc + midT * p.alphaDst > 0.01);
  const shownAfter = after.filter((p) => p.alphaSrc > 0.01);
  const rasterBefore = raster(shownBefore.map((piece) => ({ piece, positions: blendOf(piece) })));
  const rasterAfter = raster(shownAfter.map((piece) => ({ piece, positions: piece.src })));
  expect(cellsOf(rasterBefore)).toBeGreaterThan(1000);
  expect(difference(rasterBefore, rasterAfter) / cellsOf(rasterBefore)).toBeLessThan(0.01);
  expect(Math.abs(filledArea(shownAfter, (p) => p.src) / filledArea(shownBefore, blendOf) - 1)).toBeLessThan(0.01);

  // And the morph it interrupted ends on Goode's ocean, with its gaps.
  const atGoode = raster(before.filter((p) => p.alphaDst > 0).map((piece) => ({ piece, positions: piece.dst })));
  const aloneGoode = aloneRaster(goode, ocean);
  expect(cellsOf(aloneGoode)).toBeLessThan(0.75 * VIEW.width * VIEW.height / 100);
  expect(difference(atGoode, aloneGoode) / cellsOf(aloneGoode)).toBeLessThan(0.01);
  const goodeEnd = before.filter((p) => p.alphaDst > 0);
  expect(Math.abs(filledArea(goodeEnd, (p) => p.dst) / aloneArea(goode, ocean) - 1)).toBeLessThan(0.01);
});
