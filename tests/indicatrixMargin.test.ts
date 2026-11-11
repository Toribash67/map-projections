import { describe, expect, test } from 'vitest';
import { geoDistance } from 'd3-geo';
import { buildScene, type ScenePiece } from '../src/morph/scene';
import { stops } from '../src/projections/catalog';
import type { CompiledProjection, ExcludedCap, LonLat, ProjectionDef } from '../src/projections/types';
import { isClipped, projectPoint } from '../src/screen/screen';
import { INDICATRIX_RADIUS, indicatrixCentres, jacobian, singularValues, type Member } from '../src/tissot/indicatrix';
import { capMargin, FADE_BAND } from '../src/tissot/pastCap';
import { restImages } from '../src/tissot/rest';
import { filledAt, member, memberOf, ocean, pointAt, rad, ringsOf } from './sceneSupport';

// Gnomonic shows 68 degrees from its centre.
const EDGE = 68;

const cap = (radius: number): ExcludedCap => ({ frameCenter: [0, 90], radius, mode: 'clip' });
/** The images of an indicatrix at rest at `p`, the one at its own place first. */
const imagesAt = (m: Member, p: LonLat) => restImages(m, p);
const ownAlpha = (m: Member, p: LonLat) => restImages(m, p).find((image) => image.own)?.alpha ?? 0;

describe('how far past a cap\'s edge indicatrices are computed', () => {
  test('none past a small cap, the whole band past a large one, and a share between, never more than half the radius below 10 degrees', () => {
    expect(capMargin(cap(0.1))).toBe(0);
    expect(capMargin(cap(5))).toBe(0);
    expect(capMargin(cap(15))).toBe(FADE_BAND);
    expect(capMargin(cap(112))).toBe(FADE_BAND);
    for (let r = 5; r < 10; r += 0.25) expect(capMargin(cap(r))).toBeLessThanOrEqual(r / 2);
    expect(capMargin({ ...cap(90), mode: 'behind' })).toBe(0);
  });
});

describe('an indicatrix past a large cap\'s edge, at rest', () => {
  const gnomonic = member('gnomonic');
  // Along the equator, out from the centre, through the rim at 68 degrees and the end of the band at 78.
  const along = (d: number): LonLat => [d, 0];

  test('is drawn at its own projected place with the map\'s derivative there, and fades with how far past the edge it is', () => {
    let last = 1;
    for (let d = EDGE; d <= EDGE + FADE_BAND + 1; d += 0.5) {
      const p = along(d);
      const images = imagesAt(gnomonic, p);
      if (d >= EDGE + FADE_BAND) {
        expect(images, `${d}`).toEqual([]);
        continue;
      }
      expect(images, `${d}`).toHaveLength(1);
      const [image] = images;
      if (d !== EDGE) expect(image!.own).toBe(false);
      expect(image!.pos).toEqual(projectPoint(gnomonic.compiled, gnomonic.screen, p));
      expect(image!.mat).toEqual(jacobian(gnomonic.compiled, gnomonic.screen, p, { margin: capMargin }));
      expect(image!.alpha).toBeLessThanOrEqual(last);
      last = image!.alpha;
    }
    expect(ownAlpha(gnomonic, along(EDGE - 1))).toBe(1);
    expect(imagesAt(gnomonic, along(EDGE + 0.01))[0]!.alpha).toBeGreaterThan(0.99);
    expect(imagesAt(gnomonic, along(EDGE + FADE_BAND - 0.5))[0]!.alpha).toBeLessThan(0.01);
  });

  test('a map at rest draws it the same at both ends', () => {
    const live = buildScene({}, [member('gnomonic', { lon: 82 })], null, true).indicatrices;
    const past = live.filter((m) => m.alphaSrc < 1);
    expect(past.length).toBeGreaterThan(3);
    for (const m of past) {
      expect(m.alphaDst).toBe(m.alphaSrc);
      expect(m.dstPos).toEqual(m.srcPos);
      expect(m.dstMat).toEqual(m.srcMat);
      expect(m.behind).toBe(false);
    }
  });

  test('its alpha changes by little for a small turn of the map, on every map with a large cap, and it never appears or vanishes at more than a trace', () => {
    // Turning the map a hundredth of a degree at a time, every indicatrix's alpha, and its alpha times its size on screen, change gradually.
    const cases: [string, Record<string, number>, 'lon' | 'lat', number, number][] = [
      ['gnomonic', {}, 'lon', 75, 90],
      ['stereographic', {}, 'lon', 13, 17],
      ['gnomonic', { x: 0.25 }, 'lon', 15, 22],
      ['lambert-conformal', {}, 'lon', -40, -20],
    ];
    for (const [id, params, axis, from, to] of cases) {
      const shown = (value: number) => {
        const m = memberWith(id, params, { [axis]: value });
        return new Map(indicatrixCentres().map((p) => [p.join(), imagesAt(m, p)[0]] as const));
      };
      let before = shown(from);
      for (let v = from + 0.01; v <= to; v += 0.01) {
        const after = shown(v);
        for (const [key, a] of after) {
          const b = before.get(key);
          const [alphaA, alphaB] = [a?.alpha ?? 0, b?.alpha ?? 0];
          expect(Math.abs(alphaA - alphaB), `${id} ${axis} ${v.toFixed(2)} at ${key}`).toBeLessThan(0.02);
          // Its size on screen times its alpha: what it adds to the frame, before the outline cuts it.
          const size = (x: typeof a) => (x ? x.alpha * INDICATRIX_RADIUS * singularValues(x.mat)[0] : 0);
          expect(Math.abs(size(a) - size(b)), `${id} ${axis} ${v.toFixed(2)} at ${key}`).toBeLessThan(2);
        }
        before = after;
      }
    }
  }, 120_000);
});

function memberWith(id: string, params: Record<string, number>, orientation: Partial<{ lon: number; lat: number }>): Member {
  const base = member(id, orientation);
  const state = { ...base.compiled.state, params: { ...base.compiled.state.params, ...params } };
  return memberOf(state);
}

describe('near a small cap, such as a pole the map cannot reach', () => {
  test('an indicatrix fades out inside the map before the cap, and none is computed inside it', () => {
    const mercator = member('mercator');
    // Mercator leaves out 5 degrees round each pole; along the meridian at 0, by latitude.
    expect(ownAlpha(mercator, [0, 74])).toBe(1);
    expect(ownAlpha(mercator, [0, 80])).toBeGreaterThan(0.2);
    expect(ownAlpha(mercator, [0, 80])).toBeLessThan(0.8);
    expect(ownAlpha(mercator, [0, 84.99])).toBeLessThan(1e-5);
    expect(imagesAt(mercator, [0, 85.5])).toEqual([]);
  });

  test('at any centre, an indicatrix near a pole of a cylindrical or conic map is faint while it is large', () => {
    // The review found a 200 pixel ellipse at full alpha on Mercator turned to latitude 2.5: its pole was 2.5 degrees inside the cap.
    for (const id of ['mercator', 'transverse-mercator', 'equirectangular', 'lambert-cylindrical', 'lambert-conformal', 'albers', 'robinson']) {
      let worst = 0;
      for (let lat = -89.75; lat <= 89.75; lat += 0.25) {
        for (const tilt of [0, 33]) {
          const m = member(id, { lat, tilt });
          for (const e of buildScene({}, [m], null, true).indicatrices) worst = Math.max(worst, e.alphaSrc * INDICATRIX_RADIUS * singularValues(e.srcMat)[0]);
        }
      }
      // In pixels: on equirectangular one 80 degrees from a pole, at full alpha, is about 80 wide; the review's was 200.
      expect(worst, id).toBeLessThan(100);
    }
  }, 120_000);
});

/** Distance (pixels) from a point to the nearest edge of the outline. */
function toOutline(outline: ScenePiece[], [x, y]: [number, number]): number {
  let best = Infinity;
  for (const piece of outline) {
    for (const [start, end] of ringsOf(piece)) {
      for (let i = start + 1; i < end; i++) {
        const [ax, ay] = pointAt(piece.src, i - 1);
        const [bx, by] = pointAt(piece.src, i);
        const [dx, dy] = [bx - ax, by - ay];
        const f = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
        best = Math.min(best, Math.hypot(ax + f * dx - x, ay + f * dy - y));
      }
    }
  }
  return best;
}

test('a copy of an indicatrix (past a cap, or across a seam) is never centred inside the outline: it is not a second copy of something the map shows', () => {
  const orientations = [{}, { lon: 70, lat: 40 }, { lon: -100, lat: -70 }, { lon: 3.5, lat: 1, tilt: 12 }];
  let copies = 0;
  for (const stop of stops) {
    for (const o of orientations) {
      const m = member(stop.id, o);
      const outline = buildScene({ ocean }, [m], null, true).layers.ocean!;
      for (const p of indicatrixCentres()) {
        // A copy across a seam is cut to its side of the seam, so that nothing is drawn twice (see the tests below). One past a cap's
        // edge is whole, and has to be centred outside the outline.
        for (const image of restImages(m, p).filter((x) => !x.own && x.cuts.length === 0)) {
          copies++;
          const inside = filledAt(outline, (piece) => piece.src, image.pos[0], image.pos[1]);
          expect(!inside || toOutline(outline, image.pos) < 1, `${stop.id} ${JSON.stringify(o)} at ${p} drawn at ${image.pos}`).toBe(true);
        }
      }
    }
  }
  expect(copies).toBeGreaterThan(20);
});

describe('across a seam', () => {
  test('Mollweide at rest: an indicatrix on the seam is drawn at both edges, one the mirror of the other', () => {
    const m = member('mollweide');
    const [cx] = projectPoint(m.compiled, m.screen, [0, 0]);
    for (const lat of [-60, -30, 0, 30, 60]) {
      const images = restImages(m, [-180, lat]);
      expect(images, `${lat}`).toHaveLength(2);
      const [own, copy] = images as [(typeof images)[0], (typeof images)[0]];
      expect(copy.pos[0]).toBeCloseTo(2 * cx - own.pos[0], 3);
      expect(copy.pos[1]).toBeCloseTo(own.pos[1], 3);
      // The mirror image: east keeps its x and turns its y; north the other way about.
      const [a, b, c, d] = own.mat;
      const scale = Math.hypot(a, b, c, d);
      [a, -b, -c, d].forEach((v, k) => expect(Math.abs(copy.mat[k]! - v) / scale, `${lat} ${k}`).toBeLessThan(1e-3));
      expect(copy.alpha).toBe(own.alpha);
    }
    // Far from the seam, no copy.
    expect(restImages(m, [0, 30])).toHaveLength(1);
  });

  test('one near a seam is cut there, and its copy across the seam is the other part: between them, the disc once', () => {
    // Three degrees from the northern lobes' edge at -40 on Goode, near the equator, where the lobes meet with no gap between them.
    const goode = member('goode');
    const cases: [Member, LonLat][] = [[goode, [-37, 10]], [goode, [-37, 50]], [goode, [-178, 30]], [member('mollweide'), [178, -40]], [member('mercator', { lon: 30 }), [-151, 60]]];
    for (const [m, p] of cases) {
      const images = restImages(m, p);
      expect(images, `${p}`).toHaveLength(2);
      const [own, copy] = images as [(typeof images)[0], (typeof images)[0]];
      expect([own.own, copy.own]).toEqual([true, false]);
      expect([own.cuts.length, copy.cuts.length]).toEqual([1, 1]);
      copy.cuts[0]!.forEach((v, k) => expect(v).toBeCloseTo(-own.cuts[0]![k]!, 12));
      // The seam runs through the disc, on the copy's side of the centre.
      expect(own.cuts[0]![2]).toBeGreaterThan(0);
      expect(own.cuts[0]![2]).toBeLessThan(1);
      expect(Math.hypot(own.cuts[0]![0], own.cuts[0]![1])).toBeCloseTo(1, 12);
    }
  });

  test('one beside the meridian that a seam runs on as, past the pole where the seam ends, is whole and has no copy', () => {
    // The south pole of the Earth, twelve degrees from the frame's own, on the frame's prime meridian: the same great circle as the seam.
    for (const lat of [-11.9, -12, -12.1, -30]) {
      const images = restImages(member('equirectangular', { lon: 7.31, lat }), [0, -90]);
      expect(images, `${lat}`).toHaveLength(1);
      expect(images[0]!.cuts, `${lat}`).toEqual([]);
    }
  });

  test('two rectangles of one lobe are one piece of map: there is no seam between them, and no copy across it', () => {
    // An equirectangular map in three lobes: one is in two rectangles that meet at longitude 60, the others are cut from it at 0 and 120.
    const lobes = [
      { id: 1, lonMin: -180, lonMax: 0, latMin: -90, latMax: 90 },
      { id: 2, lonMin: 0, lonMax: 60, latMin: -90, latMax: 90 },
      { id: 2, lonMin: 60, lonMax: 120, latMin: -90, latMax: 90 },
      { id: 3, lonMin: 120, lonMax: 180, latMin: -90, latMax: 90 },
    ];
    const def: ProjectionDef = {
      id: 'test-lobes',
      family: 'test',
      defaultParams: {},
      defaultOrientation: { lon: 0, lat: 0, tilt: 0 },
      tiltEnabled: true,
      latEnabled: true,
      // Each lobe a little apart from the next, so that a seam between two of them is a real one.
      raw: () => (lambda, phi, lobe = 0) => [lambda + 0.2 * lobe, phi],
      caps: () => [],
      seam: { kind: 'lobes', lobes, smoothEquator: true },
    };
    const state = { defId: def.id, params: {}, orientation: def.defaultOrientation };
    const compiled: CompiledProjection = { def, state, raw: def.raw({}), caps: [], toFrame: (p) => p, fromFrame: (p) => p };
    const m: Member = { compiled, screen: { k: 100, tx: 500, ty: 300, cos: 1, sin: 0 }, weight: 1 };
    // Two degrees from the join of the two rectangles: one whole image.
    for (const lon of [58, 62]) {
      const images = restImages(m, [lon, 10]);
      expect(images, `${lon}`).toHaveLength(1);
      expect(images[0]!.cuts).toEqual([]);
    }
    // Two degrees from a seam between two lobes: cut there, with its other part in the next lobe.
    for (const lon of [2, 118, -2]) {
      const images = restImages(m, [lon, 10]);
      expect(images, `${lon}`).toHaveLength(2);
      expect(images[0]!.cuts).toHaveLength(1);
    }
    // The lobe's id reaches the raw projection as it is.
    expect(restImages(m, [30, 0])[0]!.pos[0]).toBeCloseTo(500 + 100 * ((30 * Math.PI) / 180 + 0.4), 9);
  });

  test('across a crease along the equator, an indicatrix is its two parts, each with its own lobe\'s derivative', () => {
    // North of the equator an equirectangular map; south of it the same, stretched to twice the height. They meet along the equator.
    const lobes = [
      { id: 1, lonMin: -180, lonMax: 180, latMin: 0, latMax: 90 },
      { id: 2, lonMin: -180, lonMax: 180, latMin: -90, latMax: 0 },
    ];
    const creased = (smoothEquator: boolean): Member => {
      const def: ProjectionDef = {
        id: 'test-crease',
        family: 'test',
        defaultParams: {},
        defaultOrientation: { lon: 0, lat: 0, tilt: 0 },
        tiltEnabled: true,
        latEnabled: true,
        raw: () => (lambda, phi, lobe) => [lambda, lobe === 2 ? 2 * phi : phi],
        caps: () => [],
        seam: { kind: 'lobes', lobes, smoothEquator },
      };
      const state = { defId: def.id, params: {}, orientation: def.defaultOrientation };
      return { compiled: { def, state, raw: def.raw({}), caps: [], toFrame: (p) => p, fromFrame: (p) => p }, screen: { k: 100, tx: 500, ty: 300, cos: 1, sin: 0 }, weight: 1 };
    };
    const m = creased(false);
    for (const [p, ownScale, farScale] of [[[10, 2], 1, 2], [[-70, -1.5], 2, 1]] as [LonLat, number, number][]) {
      const images = restImages(m, p);
      expect(images, `${p}`).toHaveLength(2);
      const [own, far] = images as [(typeof images)[0], (typeof images)[0]];
      expect([own.own, far.own]).toEqual([true, false]);
      // The two sides of one chord, which runs east and west through the disc, on the equator's side of the centre.
      expect(own.cuts).toHaveLength(1);
      far.cuts[0]!.forEach((v, k) => expect(v).toBeCloseTo(-own.cuts[0]![k]!, 12));
      expect(Math.abs(own.cuts[0]![0])).toBeLessThan(1e-9);
      expect(own.cuts[0]![1]).toBeCloseTo(-Math.sign(p[1]), 9);
      expect(own.cuts[0]![2]).toBeCloseTo(Math.abs(p[1]) / 5, 3);
      // Each has the derivative of its own lobe: pixels per radian north, 100 in the one and 200 in the other.
      expect(Math.abs(own.mat[3])).toBeCloseTo(100 * ownScale, 3);
      expect(Math.abs(far.mat[3])).toBeCloseTo(100 * farScale, 3);
      // And they meet on the equator: a point of the chord is at the same place by both.
      const onChord = (image: typeof own) => image.pos[1] + image.mat[3] * ((-p[1] * Math.PI) / 180);
      expect(onChord(own)).toBeCloseTo(onChord(far), 6);
      expect(onChord(own)).toBeCloseTo(300, 6);
    }
    // Twenty degrees from the equator it is whole.
    expect(restImages(m, [10, 20])).toHaveLength(1);
    // Where the map is smooth across the equator, as Goode's is, there is nothing to cut.
    expect(restImages(creased(true), [10, 2])).toHaveLength(1);
    expect(restImages(creased(true), [10, 2])[0]!.cuts).toEqual([]);
  });

  test('one whose disc the seam does not reach is whole, and has no part across it', () => {
    const m = member('mollweide');
    // Eight degrees from the seam: beyond the five degrees of the disc.
    const images = restImages(m, [172, 0]);
    expect(images).toHaveLength(1);
    expect(images[0]!.cuts).toEqual([]);
  });
});

test('a point well inside every map has no copy and full alpha', () => {
  for (const stop of stops) {
    const m = member(stop.id);
    const p: LonLat = stop.family === 'conic' ? [10, 40] : [10, 10];
    if (isClipped(m.compiled, p) || geoDistance(p, [0, 0]) / rad > 60) continue;
    const images = restImages(m, p);
    expect(images, stop.id).toHaveLength(1);
    expect(images[0]!.alpha, stop.id).toBe(1);
  }
});
