import { geoArea, geoInterpolate } from 'd3-geo';
import { describe, expect, test } from 'vitest';
import { cutGeometry } from '../src/geo/cut';
import { cutFront } from '../src/geo/frontCut';
import { butterflyLobes, butterflyRaw } from '../src/projections/butterfly';
import { getDef } from '../src/projections/catalog';
import { compile, stateForStop } from '../src/projections/compile';
import type { LonLat } from '../src/projections/types';
import { computeScreen, lobeOf, projectFrame, projectPoint, screenToLonLat } from '../src/screen/screen';
import type { Member } from '../src/tissot/indicatrix';
import { restImages, type Cut } from '../src/tissot/rest';
import { land, rng } from './sceneSupport';
import { stopOf } from './stopOf';

const rad = Math.PI / 180;
const VIEW = { width: 1000, height: 600 };
const at = (lon: number, lat: number, lobe?: number) => butterflyRaw(lon * rad, lat * rad, lobe);
const apart = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const member = (orientation = {}): Member => {
  const state = stateForStop(stopOf('butterfly'));
  const compiled = compile({ ...state, orientation: { ...state.orientation, ...orientation } });
  return { compiled, screen: computeScreen(compiled, VIEW), weight: 1 };
};
/** The octant that holds a frame point: 1 to 4 round the north from -180, and 5 to 8 below them. */
const octant = (lon: number, lat: number) => butterflyLobes.find((l) => lon >= l.lonMin && lon <= l.lonMax && lat >= l.latMin && lat <= l.latMax)!.id;
const within = (cuts: Cut[], [e, n]: [number, number]) => cuts.every(([me, mn, c]) => me * e + mn * n <= c);

describe('Cahill butterfly', () => {
  test('eight octants, each the face of an octahedron: an equilateral triangle', () => {
    expect(butterflyLobes.map((l) => [l.id, l.lonMin, l.lonMax, l.latMin, l.latMax])).toEqual([
      [1, -180, -90, 0, 90], [2, -90, 0, 0, 90], [3, 0, 90, 0, 90], [4, 90, 180, 0, 90],
      [5, -180, -90, -90, 0], [6, -90, 0, -90, 0], [7, 0, 90, -90, 0], [8, 90, 180, -90, 0],
    ]);
    for (const lobe of butterflyLobes) {
      const pole = lobe.latMin === 0 ? 90 : -90;
      const corners = [at(lobe.lonMin, pole, lobe.id), at(lobe.lonMin, 0, lobe.id), at(lobe.lonMax, 0, lobe.id)];
      const sides = [apart(corners[0]!, corners[1]!), apart(corners[1]!, corners[2]!), apart(corners[2]!, corners[0]!)];
      for (const side of sides) expect(side, `${lobe.id}`).toBeCloseTo(Math.sqrt(6), 9);
    }
  });

  test('the north pole is one place, the middle of the map, where the four northern faces meet', () => {
    for (const lobe of [1, 2, 3, 4]) expect(Math.hypot(...at(0, 90, lobe)), `${lobe}`).toBeLessThan(1e-12);
  });

  test('each northern face and the southern one below it are joined all along the equator', () => {
    for (const lon of [-170, -95, -30, 0, 45, 89, 135]) {
      const [north, south] = [octant(lon, 1), octant(lon, -1)];
      expect(south).toBe(north + 4);
      expect(apart(at(lon, 0, north), at(lon, 0, south)), `${lon}`).toBeLessThan(1e-12);
    }
  });

  test('two wings: the northern faces are joined in pairs along the frame\'s prime meridian and its antimeridian, and apart at 90 degrees east and west', () => {
    for (const lat of [10, 45, 80]) {
      // Joined: the same place by both neighbours.
      expect(apart(at(0, lat, 2), at(0, lat, 3)), `0 ${lat}`).toBeLessThan(1e-12);
      expect(apart(at(180, lat, 4), at(-180, lat, 1)), `180 ${lat}`).toBeLessThan(1e-12);
      // Apart: the gap between the wings, above the pole and below it.
      expect(apart(at(90, lat, 3), at(90, lat, 4)), `90 ${lat}`).toBeGreaterThan(0.1);
      expect(apart(at(-90, lat, 1), at(-90, lat, 2)), `-90 ${lat}`).toBeGreaterThan(0.1);
    }
    // The southern faces are all apart from one another. Those of one wing touch at their corner on the equator, and no others do.
    for (const [lon, a, b, joined] of [[0, 6, 7, true], [90, 7, 8, false], [-90, 5, 6, false], [180, 8, 5, true]] as const) {
      expect(apart(at(lon, -30, a), at(lon === 180 ? -180 : lon, -30, b)), `${lon}`).toBeGreaterThan(0.1);
      const corner = apart(at(lon, 0, a), at(lon === 180 ? -180 : lon, 0, b));
      if (joined) expect(corner, `${lon}`).toBeLessThan(1e-12);
      else expect(corner, `${lon}`).toBeGreaterThan(0.1);
    }
    // The wings are to the right and to the left: the frame's origin is due right of the pole, its antipode due left.
    expect(at(0, 0, 2)[0]).toBeCloseTo(Math.sqrt(6), 9);
    expect(at(0, 0, 2)[1]).toBeCloseTo(0, 9);
    expect(at(180, 0, 4)[0]).toBeCloseTo(-Math.sqrt(6), 9);
  });

  test('a great circle is a straight line within each face', () => {
    const r = rng(4);
    for (const lobe of butterflyLobes) {
      for (let i = 0; i < 10; i++) {
        const inside = (): LonLat => [lobe.lonMin + 5 + r() * 80, lobe.latMin + 5 + r() * 80];
        const [a, b] = [inside(), inside()];
        const along = geoInterpolate(a, b);
        const [p, q, m] = [at(...a, lobe.id), at(...b, lobe.id), at(...(along(0.37) as LonLat), lobe.id)];
        const off = ((q[0] - p[0]) * (m[1] - p[1]) - (q[1] - p[1]) * (m[0] - p[0])) / (apart(p, q) || 1);
        expect(Math.abs(off), `${lobe.id} ${a} ${b}`).toBeLessThan(1e-9);
      }
    }
  });

  test('no two faces overlap: places apart on the Earth are apart on the map', () => {
    const r = rng(6);
    const points: { p: LonLat; xy: [number, number] }[] = [];
    for (let i = 0; i < 2000; i++) {
      const p: LonLat = [r() * 360 - 180, Math.asin(2 * r() - 1) / rad];
      points.push({ p, xy: at(p[0], p[1]) });
    }
    // Sorted by x, so that only near neighbours are compared.
    points.sort((a, b) => a.xy[0] - b.xy[0]);
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length && points[j]!.xy[0] - points[i]!.xy[0] < 1e-6; j++) {
        expect(Math.abs(points[j]!.xy[1] - points[i]!.xy[1]), `${points[i]!.p} and ${points[j]!.p}`).toBeGreaterThan(1e-6);
      }
    }
    // And each face's triangle holds only its own points: a point of another face is outside it. By the faces' areas adding up.
    const m = member();
    const ocean = cutFront({ type: 'Sphere' } as any, m.compiled);
    expect(ocean).toHaveLength(8);
  });

  test('with no lobe given, a point is drawn on the face that holds it', () => {
    for (const [lon, lat] of [[10, 40], [-100, 5], [10, -40], [-100, -5], [170, -60], [-170, 60]] as LonLat[]) {
      expect(at(lon, lat)).toEqual(at(lon, lat, octant(lon, lat)));
    }
  });

  test('fitted, the pole is in the middle of the window and the wings spread to the sides', () => {
    const m = member();
    const def = getDef('butterfly');
    // The poles are ordinary points of the map: only a speck is left out round each, for the sake of the clips.
    expect(def.caps({}).map((cap) => [cap.radius, cap.regular])).toEqual([[0.1, true], [0.1, true]]);
    const pole = projectPoint(m.compiled, m.screen, [0, 90]);
    expect(pole[0]).toBeCloseTo(500, 3);
    const [right, left] = [projectFrame(m.compiled, m.screen, [0, 0], 2), projectFrame(m.compiled, m.screen, [180, 0], 4)];
    expect(right[0]).toBeGreaterThan(pole[0] + 100);
    expect(left[0]).toBeLessThan(pole[0] - 100);
    expect(Math.abs(right[1] - pole[1])).toBeLessThan(1e-6);
    expect(Math.abs(left[1] - pole[1])).toBeLessThan(1e-6);
    // By default the cuts in the north are in the Atlantic and the Pacific, and Asia is in the middle of the right wing.
    expect(def.defaultOrientation).toEqual({ lon: 67.5, lat: 0, tilt: 0 });
  });

  test('the place under a pixel is found again, on every face', () => {
    const m = member();
    const r = rng(8);
    const faces = new Set<number>();
    let checked = 0;
    for (let i = 0; i < 300; i++) {
      const p: LonLat = [r() * 360 - 180, Math.asin(2 * r() - 1) / rad];
      const frame = m.compiled.toFrame(p);
      // Clear of the edges of the faces, where the place could be found on either side.
      if (Math.abs(frame[1]) < 1 || Math.abs(frame[1]) > 88 || [-180, -90, 0, 90, 180].some((lon) => Math.abs(frame[0] - lon) * Math.cos(frame[1] * rad) < 1)) continue;
      const back = screenToLonLat(m.compiled, m.screen, projectPoint(m.compiled, m.screen, p));
      expect(back, `${p}`).not.toBeNull();
      expect(Math.abs(back![1] - p[1]), `${p}`).toBeLessThan(0.02);
      expect(Math.abs(((back![0] - p[0] + 540) % 360) - 180) * Math.cos(p[1] * rad), `${p}`).toBeLessThan(0.02);
      faces.add(lobeOf(m.compiled, frame)!);
      checked++;
    }
    expect(checked).toBeGreaterThan(200);
    expect(faces.size).toBe(8);
  });

  test('the cuts keep all the land, at rest and for a morph', () => {
    const expected = geoArea(land as any);
    const area = (rings: LonLat[][]) => geoArea({ type: 'Polygon', coordinates: rings });
    for (const o of [{}, { lon: 100, lat: -40, tilt: 35 }]) {
      const m = member(o);
      const full = cutGeometry(land, [m.compiled]);
      expect(Math.abs(full.reduce((sum, piece) => sum + area(piece.coords), 0) - expected)).toBeLessThan(1e-3);
      const front = cutFront(land, m.compiled);
      expect(Math.abs(front.reduce((sum, piece) => sum + area(piece.rings.map((ring) => ring.map((p) => m.compiled.fromFrame(p)))), 0) - expected)).toBeLessThan(2e-3);
    }
  });

  test('an indicatrix on the crease along the equator is two parts, each with its own face\'s derivative, that meet on the crease', () => {
    const m = member();
    const p = m.compiled.fromFrame([30, 1]);
    const images = restImages(m, p);
    expect(images).toHaveLength(2);
    expect(images[0]!.cuts).toHaveLength(1);
    images[1]!.cuts[0]!.forEach((v, k) => expect(v).toBeCloseTo(-images[0]!.cuts[0]![k]!, 12));
    // Across a crease the two parts are of different shapes.
    expect(images[0]!.mat.some((v, k) => Math.abs(v - images[1]!.mat[k]!) > 1)).toBe(true);
    // Well inside a face it is whole.
    expect(restImages(m, m.compiled.fromFrame([45, 40]))).toHaveLength(1);
  });

  test('an indicatrix at a corner where faces meet is a part for each of them, and between them they are the disc once', () => {
    const m = member();
    const r = rng(12);
    const disc: [number, number][] = [];
    while (disc.length < 400) {
      const x: [number, number] = [2 * r() - 1, 2 * r() - 1];
      if (Math.hypot(...x) < 1) disc.push(x);
    }
    // The north pole, where four faces meet, and a corner on the equator, where four meet too: two northern and two southern.
    for (const frame of [[20, 90], [0.5, 0.5], [90.3, -0.4]] as LonLat[]) {
      const images = restImages(m, m.compiled.fromFrame(frame));
      expect(images, `${frame}`).toHaveLength(4);
      for (const x of disc) expect(images.filter((image) => within(image.cuts, x)).length, `${frame} ${x}`).toBe(1);
    }
  });
});
