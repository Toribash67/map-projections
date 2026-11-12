import { describe, expect, test } from 'vitest';
import { toVector, type Vector } from '../src/geo/densify';
import { DEFAULT_CAMERA, orbit, pick, toView } from '../src/locator/camera';
import { surfaceFor, visibleRuns } from '../src/locator/surface';
import { compile, stateForStop } from '../src/projections/compile';
import type { CompiledProjection, Orientation } from '../src/projections/types';
import { stopOf } from './stopOf';

const rad = Math.PI / 180;
const compiled = (id: string, orientation: Partial<Orientation> = {}, params: Record<string, number> = {}): CompiledProjection => {
  const state = stateForStop(stopOf(id));
  return compile({ ...state, params: { ...state.params, ...params }, orientation: { ...state.orientation, ...orientation } });
};
const dot = (a: Vector, b: Vector) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const length = (a: Vector) => Math.hypot(...a);
const minus = (a: Vector, b: Vector): Vector => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vector, b: Vector): Vector => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** How far a point is from the line through the origin along a unit axis. */
const fromAxis = (p: Vector, axis: Vector) => length(cross(p, axis));
/** How far the straight line through two points passes from the origin. */
const lineFromOrigin = (a: Vector, b: Vector) => length(cross(a, b)) / length(minus(b, a));

describe('the camera of the corner globe', () => {
  test('the place it faces is in the middle, towards the viewer, with north up', () => {
    const facing = toVector([DEFAULT_CAMERA.lon, DEFAULT_CAMERA.lat]);
    const [x, y, z] = toView(DEFAULT_CAMERA, facing);
    expect([x, y, z].map((v) => +v.toFixed(12))).toEqual([0, 0, 1]);
    expect(DEFAULT_CAMERA).toEqual({ lon: 10, lat: 25 });
    // A place north of it is above the middle, and one east of it to the right.
    expect(toView(DEFAULT_CAMERA, toVector([10, 45]))[1]).toBeGreaterThan(0.3);
    expect(Math.abs(toView(DEFAULT_CAMERA, toVector([10, 45]))[0])).toBeLessThan(1e-12);
    expect(toView(DEFAULT_CAMERA, toVector([40, 25]))[0]).toBeGreaterThan(0.3);
    // The far side is away from the viewer.
    expect(toView(DEFAULT_CAMERA, toVector([-170, -25]))[2]).toBeCloseTo(-1, 12);
  });

  test('a place on its face is picked back, and off the globe there is none', () => {
    expect(pick(DEFAULT_CAMERA, 0, 0)!.map((v) => +v.toFixed(9))).toEqual([10, 25]);
    for (const p of [[30, 40], [-40, 10], [10, -60], [80, 25]] as [number, number][]) {
      const [x, y] = toView(DEFAULT_CAMERA, toVector(p));
      const back = pick(DEFAULT_CAMERA, x, y)!;
      expect(back[0]).toBeCloseTo(p[0], 9);
      expect(back[1]).toBeCloseTo(p[1], 9);
    }
    expect(pick(DEFAULT_CAMERA, 0.8, 0.8)).toBeNull();
  });

  test('a drag turns the globe with the pointer, and cannot turn it over a pole', () => {
    // Dragged to the right by the globe's radius: the globe turns a radian, so the camera faces a place a radian to the west.
    expect(orbit({ lon: 0, lat: 0 }, 90, 0, 90).lon).toBeCloseTo(-1 / rad, 9);
    expect(orbit({ lon: 0, lat: 0 }, 0, 90, 90).lat).toBeCloseTo(1 / rad, 9);
    expect(orbit({ lon: 170, lat: 0 }, -90, 0, 90).lon).toBeCloseTo(170 + 1 / rad - 360, 9);
    expect(orbit({ lon: 0, lat: 80 }, 0, 500, 90).lat).toBe(85);
    expect(orbit({ lon: 0, lat: -80 }, 0, -500, 90).lat).toBe(-85);
  });
});

describe('the surface a map is projected onto', () => {
  test('a cylindrical map has a cylinder about the map\'s own axis, touching the globe at the equator', () => {
    const s = surfaceFor(compiled('mercator'))!;
    expect(s.kind).toBe('cylinder');
    const axis: Vector = [0, 0, 1];
    for (const line of s.lines) for (const p of line) expect(fromAxis(p, axis)).toBeCloseTo(1, 9);
    // It reaches above and below the globe.
    const heights = s.lines.flat().map((p) => p[2]);
    expect(Math.max(...heights)).toBeGreaterThan(1.2);
    expect(Math.min(...heights)).toBeLessThan(-1.2);
    // It touches along the equator.
    expect(s.touch).toHaveLength(1);
    for (const p of s.touch[0]!) {
      expect(length(p)).toBeCloseTo(1, 9);
      expect(Math.abs(p[2])).toBeLessThan(1e-9);
    }
  });

  test('it turns with the map: at tilt 90 the cylinder lies on its side, and with the centre off the equator it leans', () => {
    const transverse = surfaceFor(compiled('transverse-mercator'))!;
    // Its axis is the map's pole, which at tilt 90 is on the equator of the Earth.
    const axisOf = (c: CompiledProjection) => toVector(c.fromFrame([0, 90]));
    expect(Math.abs(axisOf(compiled('transverse-mercator'))[2])).toBeLessThan(1e-9);
    for (const p of transverse.lines.flat()) expect(fromAxis(p, axisOf(compiled('transverse-mercator')))).toBeCloseTo(1, 9);
    const leaning = compiled('mercator', { lon: 30, lat: 40 });
    for (const p of surfaceFor(leaning)!.lines.flat()) expect(fromAxis(p, axisOf(leaning))).toBeCloseTo(1, 9);
    expect(Math.abs(axisOf(leaning)[2])).toBeLessThan(0.99);
  });

  test('a cylinder with a standard parallel off the equator is narrower, and cuts the globe at that parallel north and south', () => {
    const s = surfaceFor(compiled('behrmann'))!;
    for (const p of s.lines.flat()) expect(fromAxis(p, [0, 0, 1])).toBeCloseTo(Math.cos(30 * rad), 9);
    expect(s.touch).toHaveLength(2);
    expect(s.touch.map((line) => Math.round(Math.asin(line[0]![2]) / rad))).toEqual([30, -30]);
    for (const p of s.touch.flat()) expect(length(p)).toBeCloseTo(1, 9);
  });

  test('a conic map has a cone through its two standard parallels: every line down it passes through both', () => {
    const s = surfaceFor(compiled('albers'))!;
    expect(s.kind).toBe('cone');
    expect(s.touch.map((line) => +(Math.asin(line[0]![2]) / rad).toFixed(1))).toEqual([29.5, 45.5]);
    // The straight lines of the cone: those that are not circles about the axis.
    const straight = s.lines.filter((line) => Math.abs(line[0]![2] - line.at(-1)![2]) > 0.1);
    expect(straight.length).toBeGreaterThanOrEqual(8);
    for (const line of straight) {
      const [a, b] = [line[0]!, line.at(-1)!];
      const direction = minus(b, a);
      // Where the line is at the height of each parallel, it is on the globe.
      for (const lat of [29.5, 45.5]) {
        const t = (Math.sin(lat * rad) - a[2]) / direction[2];
        const p: Vector = [a[0] + t * direction[0], a[1] + t * direction[1], a[2] + t * direction[2]];
        expect(length(p), `${lat}`).toBeCloseTo(1, 6);
      }
    }
    // It comes to a point above the north pole, on the axis.
    const top = s.lines.flat().reduce((best, p) => (p[2] > best[2] ? p : best));
    expect(Math.hypot(top[0], top[1])).toBeLessThan(0.05);
    expect(top[2]).toBeGreaterThan(1);
  });

  test('with one standard parallel the cone touches the globe along it', () => {
    const s = surfaceFor(compiled('albers', {}, { p1: 30, p2: 30 }))!;
    expect(s.touch).toHaveLength(1);
    const straight = s.lines.filter((line) => Math.abs(line[0]![2] - line.at(-1)![2]) > 0.1);
    for (const line of straight) expect(lineFromOrigin(line[0]!, line.at(-1)!)).toBeCloseTo(1, 6);
  });

  test('at the limits of its sliders the cone is a cylinder, and all but a flat disc', () => {
    const cylinder = surfaceFor(compiled('lambert-conformal', {}, { p1: 0, p2: 0 }))!;
    for (const p of cylinder.lines.flat()) expect(fromAxis(p, [0, 0, 1])).toBeCloseTo(1, 6);
    const disc = surfaceFor(compiled('albers', {}, { p1: 89.9, p2: 89.9 }))!;
    const heights = disc.lines.flat().map((p) => p[2]);
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(0.02);
    expect(Math.min(...heights)).toBeGreaterThan(0.98);
    for (const p of disc.lines.flat()) expect(p.every(Number.isFinite)).toBe(true);
    // Southward, the cone opens the other way.
    const south = surfaceFor(compiled('albers', {}, { p1: -29.5, p2: -45.5 }))!;
    const bottom = south.lines.flat().reduce((best, p) => (p[2] < best[2] ? p : best));
    expect(bottom[2]).toBeLessThan(-1);
    expect(Math.hypot(bottom[0], bottom[1])).toBeLessThan(0.05);
  });

  test('an azimuthal map has a plane touching the globe at the map\'s centre', () => {
    for (const id of ['azimuthal-equidistant', 'lambert-azimuthal', 'gnomonic', 'stereographic']) {
      const c = compiled(id, { lon: 40, lat: 30 });
      const s = surfaceFor(c)!;
      expect(s.kind, id).toBe('plane');
      const centre = toVector([40, 30]);
      for (const p of s.lines.flat()) expect(dot(p, centre), id).toBeCloseTo(1, 9);
      // A square about the centre, a little wider than the globe.
      const reach = Math.max(...s.lines.flat().map((p) => length(minus(p, centre))));
      expect(reach).toBeGreaterThan(1.4);
      expect(reach).toBeLessThan(1.8);
    }
  });

  test('a perspective map shows where its rays come from: the centre of the globe, its far side, or nowhere near', () => {
    const centre = toVector([0, 0]);
    const gnomonic = surfaceFor(compiled('gnomonic'))!;
    expect(length(gnomonic.eye!)).toBeLessThan(1e-12);
    const stereographic = surfaceFor(compiled('stereographic'))!;
    expect(stereographic.eye!.map((v) => +v.toFixed(9))).toEqual([-1, 0, 0]);
    expect(surfaceFor(compiled('stereographic', {}, { x: 0.75 }))!.eye!.map((v) => +v.toFixed(9))).toEqual([-3, 0, 0]);
    // Each ray runs from the eye, through a point of the globe, to the plane.
    for (const s of [gnomonic, stereographic]) {
      expect(s.rays).toHaveLength(3);
      for (const [from, to] of s.rays!) {
        expect(length(minus(from, s.eye!))).toBeLessThan(1e-12);
        expect(dot(to, centre)).toBeCloseTo(1, 9);
        // It meets the globe on the way: the line passes within the globe's radius of the middle.
        expect(lineFromOrigin(from, to)).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
    // From infinitely far the rays are parallel, and there is no eye to show.
    const far = surfaceFor(compiled('stereographic', {}, { x: 1 }))!;
    expect(far.eye).toBeUndefined();
    for (const [from, to] of far.rays!) expect(length(cross(minus(to, from), centre))).toBeLessThan(1e-9);
    // The maps that are not perspective views have neither.
    expect(surfaceFor(compiled('lambert-azimuthal'))!.rays).toBeUndefined();
    expect(surfaceFor(compiled('lambert-azimuthal'))!.eye).toBeUndefined();
  });

  test('the butterfly has an octahedron about the globe, each face touching it', () => {
    const c = compiled('butterfly');
    const s = surfaceFor(c)!;
    expect(s.kind).toBe('octahedron');
    expect(s.lines).toHaveLength(12);
    for (const line of s.lines) {
      // An edge runs between two corners, each the square root of three from the middle, and is the square root of six long.
      expect(length(line[0]!)).toBeCloseTo(Math.sqrt(3), 9);
      expect(length(line.at(-1)!)).toBeCloseTo(Math.sqrt(3), 9);
      expect(length(minus(line.at(-1)!, line[0]!))).toBeCloseTo(Math.sqrt(6), 9);
    }
    // Its corners are on the map's own axes: one over each pole of the frame.
    const pole = toVector(c.fromFrame([0, 90]));
    expect(s.lines.flat().some((p) => length(minus(p, [pole[0] * Math.sqrt(3), pole[1] * Math.sqrt(3), pole[2] * Math.sqrt(3)])) < 1e-9)).toBe(true);
  });

  test('a map that is projected onto nothing of the kind has no surface', () => {
    for (const id of ['globe', 'mollweide', 'robinson', 'sinusoidal', 'goode', 'peirce', 'nicolosi', 'winkel-tripel', 'van-der-grinten']) expect(surfaceFor(compiled(id)), id).toBeNull();
    expect(surfaceFor(compiled('miller'))!.kind).toBe('cylinder');
  });
});

describe('what of a line the globe hides', () => {
  test('a line passing behind the globe is seen, hidden, and seen again', () => {
    const line: Vector[] = [];
    for (let x = -2; x <= 2.0001; x += 0.05) line.push([x, 0, -2]);
    const runs = visibleRuns(line);
    expect(runs.map((r) => r.hidden)).toEqual([false, true, false]);
    // Hidden from one edge of the disc to the other.
    const hidden = runs[1]!.points;
    expect(hidden[0]![0]).toBeCloseTo(-1, 1);
    expect(hidden.at(-1)![0]).toBeCloseTo(1, 1);
    // The runs join: each begins where the one before ends.
    expect(runs[1]!.points[0]).toEqual(runs[0]!.points.at(-1));
    expect(runs[2]!.points[0]).toEqual(runs[1]!.points.at(-1));
  });

  test('a line in front of the globe is all seen, one within it all hidden, and one beside it all seen', () => {
    const along = (z: number, y = 0): Vector[] => Array.from({ length: 41 }, (_, i) => [-1 + i * 0.05, y, z]);
    expect(visibleRuns(along(2)).map((r) => r.hidden)).toEqual([false]);
    expect(visibleRuns(along(0).slice(15, 26)).map((r) => r.hidden)).toEqual([true]);
    expect(visibleRuns(along(-3, 1.5)).map((r) => r.hidden)).toEqual([false]);
    expect(visibleRuns([])).toEqual([]);
  });
});
