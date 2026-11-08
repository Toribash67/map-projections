import { describe, expect, test } from 'vitest';
import { geoDistance } from 'd3-geo';
import { buildScene, type SceneIndicatrix, type ScenePiece } from '../src/morph/scene';
import { alphaOf } from '../src/render/draw';
import { stops } from '../src/projections/catalog';
import type { ExcludedCap, LonLat } from '../src/projections/types';
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
        // A copy in the next lobe of an interrupted map can be centred in a lobe that meets that one at the equator; it is cut to its
        // side of the edge, so that it is not drawn twice (see the Goode test below).
        for (const image of restImages(m, p).filter((x) => !x.own && !x.cut)) {
          copies++;
          const inside = filledAt(outline, (piece) => piece.src, image.pos[0], image.pos[1]);
          expect(!inside || toOutline(outline, image.pos) < 1, `${stop.id} ${JSON.stringify(o)} at ${p} drawn at ${image.pos}`).toBe(true);
        }
      }
    }
  }
  expect(copies).toBeGreaterThan(100);
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

  test('Goode: one near the edge of a lobe is cut there, and its copy in the next lobe is the other part', () => {
    // Three degrees from the northern lobes' edge at -40, near the equator, where the lobes meet and the gap between them is narrow.
    const goode = member('goode');
    const images = restImages(goode, [-37, 10]);
    expect(images).toHaveLength(2);
    const [own, copy] = images as [(typeof images)[0], (typeof images)[0]];
    expect(own.cut).toBeDefined();
    copy.cut!.forEach((v, k) => expect(v).toBeCloseTo(-own.cut![k]!, 12));
    // The edge runs through the disc, on the copy's side of the centre.
    expect(own.cut![2]).toBeGreaterThan(0);
    expect(own.cut![2]).toBeLessThan(1);
    // Far from the equator the gap between the lobes, past the outline, cuts it, and so it is whole.
    expect(restImages(goode, [-37, 50]).map((x) => x.cut)).toEqual([undefined, undefined]);
    // At the antimeridian the outline does the cutting, and no part is taken off.
    const around = restImages(member('goode'), [-180, 30]);
    expect(around).toHaveLength(2);
    expect(around.every((x) => x.cut === undefined)).toBe(true);
  });
});

/** What a frame of a scene draws of each indicatrix at `t`: where, with what matrix and part, and how strongly. */
const drawn = (items: SceneIndicatrix[], t: number, globe = false) =>
  items
    // What is behind a globe's near side is not seen at the globe's end, and a globe at rest leaves it out.
    .filter((m) => !(globe && m.behind))
    .map((m) => ({ m, alpha: alphaOf(m, t) }))
    .filter(({ alpha }) => alpha > 1e-9)
    .map(({ m, alpha }) => ({
      pos: [0, 1].map((k) => (1 - t) * m.srcPos[k]! + t * m.dstPos[k]!),
      mat: [0, 1, 2, 3].map((k) => (1 - t) * m.srcMat[k]! + t * m.dstMat[k]!),
      alpha,
      cut: m.cut ? (t === 0 ? m.cut.src : m.cut.dst) : null,
    }))
    .sort((a, b) => a.pos[0]! - b.pos[0]! || a.pos[1]! - b.pos[1]!);

function expectSameFrame(a: ReturnType<typeof drawn>, b: ReturnType<typeof drawn>, label: string) {
  expect(a.length, label).toBe(b.length);
  a.forEach((x, i) => {
    const y = b[i]!;
    x.pos.forEach((v, k) => expect(v, label).toBeCloseTo(y.pos[k]!, 6));
    x.mat.forEach((v, k) => expect(Math.abs(v - y.mat[k]!), label).toBeLessThan(1e-6 * (1 + Math.abs(v))));
    expect(x.alpha, label).toBeCloseTo(y.alpha, 9);
    expect(x.cut === null, label).toBe(y.cut === null);
    x.cut?.forEach((v, k) => expect(v, label).toBeCloseTo(y.cut![k]!, 9));
  });
}

describe('at a morph\'s ends', () => {
  const pairs: [string, Record<string, number>][] = [
    ['gnomonic', { lon: 82, lat: 0 }],
    ['gnomonic', { lon: 14, lat: 8 }],
    ['mercator', { lat: 12 }],
    ['goode', { lon: 6 }],
    ['stereographic', { lon: 15.05 }],
  ];
  test('the first frame draws every indicatrix as the map at rest does, and the last as the map arrived at', () => {
    for (const [id, o] of pairs) {
      for (const other of ['mollweide', 'globe', 'gnomonic']) {
        if (other === id) continue;
        const [a, b] = [member(id, o), member(other, o)];
        const morph = buildScene({}, [a], b, true).indicatrices;
        expectSameFrame(drawn(morph, 0), drawn(buildScene({}, [a], null, true).indicatrices, 0), `${id} to ${other}, first frame`);
        expectSameFrame(drawn(morph, 1, other === 'globe'), drawn(buildScene({}, [b], null, true).indicatrices, 1), `${id} to ${other}, last frame`);
      }
    }
  });

  test('a copy that a map shows at rest fades out on that map\'s curve as the morph leaves it, and in as one arrives', () => {
    const [a, b] = [member('gnomonic', { lon: 82 }), member('mollweide', { lon: 82 })];
    const copies = buildScene({}, [a], b, true).indicatrices.filter((m) => m.clip !== undefined);
    expect(copies.some((m) => m.clip === 0)).toBe(true);
    expect(copies.some((m) => m.clip === 1)).toBe(true);
    for (const m of copies) {
      let last = alphaOf(m, 0);
      for (let t = 0.01; t <= 1; t += 0.01) {
        const alpha = alphaOf(m, t);
        expect(Math.abs(alpha - last)).toBeLessThan(0.05);
        expect(m.clip === 0 ? alpha <= last + 1e-12 : alpha >= last - 1e-12).toBe(true);
        last = alpha;
      }
    }
  });

  test('a morph redirected under way starts each indicatrix where it was, as strong as it was', () => {
    for (const t of [0.1, 0.4, 0.8]) {
      const [a, b, c] = [member('gnomonic', { lon: 82 }), member('mollweide', { lon: 82 }), member('goode', { lon: 82 })];
      const before = buildScene({}, [a], b, true).indicatrices;
      const after = buildScene({}, [{ ...a, weight: 1 - t }, { ...b, weight: t }], c, true).indicatrices;
      const [was, now] = [drawn(before, t), drawn(after, 0)];
      for (const x of was.filter((x) => x.alpha > 1e-3)) {
        const twin = now.find((y) => Math.hypot(y.pos[0]! - x.pos[0]!, y.pos[1]! - x.pos[1]!) < 1e-3 && Math.abs(y.alpha - x.alpha) < 1e-9);
        expect(twin, `t ${t} at ${x.pos} alpha ${x.alpha}`).toBeDefined();
      }
    }
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
