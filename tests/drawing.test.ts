import { expect, test } from 'vitest';
import { geoArea, geoContains, geoDistance } from 'd3-geo';
import { cutGeometry } from '../src/geo/cut';
import { densify, toVector } from '../src/geo/densify';
import { cutFront } from '../src/geo/frontCut';
import { DrawingModel, radiusKm, shapeToGeoJSON, type Shape, type Tracer } from '../src/drawing/model';
import { straightPath } from '../src/drawing/straight';
import { buildScene } from '../src/morph/scene';
import type { LonLat } from '../src/projections/types';
import { projectPoint } from '../src/screen/screen';
import { filledAt, member, rad } from './sceneSupport';

const HEMISPHERE = 2 * Math.PI;

/** A model with a tool chosen and the points clicked in turn. */
function drawn(tool: 'line' | 'polygon' | 'circle', ...points: LonLat[]): DrawingModel {
  const model = new DrawingModel();
  model.setTool(tool);
  for (const p of points) model.addPoint(p);
  return model;
}

const parts = (s: Shape) => (shapeToGeoJSON(s) as GeoJSON.GeometryCollection).geometries;
const polygonOf = (s: Shape) => parts(s).find((g) => g.type === 'Polygon') as GeoJSON.Polygon;
const finiteEverywhere = (coords: unknown): boolean => (Array.isArray(coords) ? coords.every(finiteEverywhere) : Number.isFinite(coords));

test('consecutive points closer than 0.01° are merged, so a double-click adds one point', () => {
  const model = drawn('line', [10, 20], [10, 20], [10.004, 20.004]);
  expect(model.draft).toEqual({ kind: 'line', points: [[10, 20]] });
  model.addPoint([10.02, 20]);
  expect((model.draft as { points: LonLat[] }).points).toHaveLength(2);
});

test('finish on a line with 1 distinct point discards it; polygon with 2 discards it', () => {
  const line = drawn('line', [10, 20], [10, 20]);
  line.finish();
  expect(line.shapes).toEqual([]);
  expect(line.draft).toBeNull();

  const polygon = drawn('polygon', [0, 0], [10, 0]);
  polygon.finish();
  expect(polygon.shapes).toEqual([]);
  expect(polygon.draft).toBeNull();

  const kept = drawn('polygon', [0, 0], [10, 0], [10, 10]);
  kept.finish();
  expect(kept.shapes).toEqual([{ kind: 'polygon', points: [[0, 0], [10, 0], [10, 10]] }]);
});

test('line between exact antipodes produces finite coordinates after cutting', () => {
  const line: Shape = { kind: 'line', points: [[0, 0], [180, 0]] };
  const geometry = shapeToGeoJSON(line) as GeoJSON.LineString;
  // One great circle, walked in steps, 180° long: not the scatter that interpolating between exact antipodes gives.
  const path = densify(geometry.coordinates as LonLat[], []);
  const normal = cross(toVector(path[0]!), toVector(path[Math.floor(path.length / 2)]!));
  const length = Math.hypot(...normal);
  let total = 0;
  path.forEach((p, i) => {
    const v = toVector(p);
    expect(Math.abs(dot(v, normal)) / length).toBeLessThan(1e-6);
    if (i > 0) {
      const step = geoDistance(path[i - 1]!, p) / rad;
      expect(step).toBeLessThan(2.5);
      total += step;
    }
  });
  expect(total).toBeCloseTo(180, 4);

  for (const id of ['globe', 'mercator', 'goode', 'gnomonic', 'orthographic']) {
    const m = member(id);
    expect(finiteEverywhere(cutGeometry(geometry, [m.compiled]).map((p) => p.coords)), `full cut, ${id}`).toBe(true);
    expect(finiteEverywhere(cutFront(geometry, m.compiled).map((p) => p.rings)), `front cut, ${id}`).toBe(true);
  }
  // Points that are nearly antipodal are the same.
  const near = shapeToGeoJSON({ kind: 'line', points: [[20, 30], [-160 + 1e-4, -30]] }) as GeoJSON.LineString;
  expect(finiteEverywhere(near.coordinates)).toBe(true);
  const dense = densify(near.coordinates as LonLat[], []);
  expect(Math.max(...dense.slice(1).map((p, i) => geoDistance(dense[i]!, p) / rad))).toBeLessThan(2.5);
});

const cross = (a: number[], b: number[]) => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;

test('polygon that winds the long way is reversed, so geoArea <= 2*PI', () => {
  const ring: LonLat[] = [[0, 0], [20, 0], [20, 20], [0, 20]];
  const forward = polygonOf({ kind: 'polygon', points: ring });
  const backward = polygonOf({ kind: 'polygon', points: [...ring].reverse() });
  for (const polygon of [forward, backward]) {
    expect(geoArea(polygon)).toBeLessThanOrEqual(HEMISPHERE);
    expect(geoContains(polygon, [10, 10])).toBe(true);
    expect(geoContains(polygon, [190, -10])).toBe(false);
  }
  expect(geoArea(forward)).toBeCloseTo(geoArea(backward), 9);
  // The ring is closed.
  expect(forward.coordinates[0]![0]).toEqual(forward.coordinates[0]!.at(-1));
});

test('polygon enclosing the pole keeps area below a hemisphere and covers the pole', () => {
  const around = (lat: number): LonLat[] => [[0, lat], [90, lat], [180, lat], [-90, lat]];
  for (const [lat, pole] of [[60, 90], [-60, -90]] as const) {
    for (const ring of [around(lat), around(lat).reverse()]) {
      const polygon = polygonOf({ kind: 'polygon', points: ring });
      expect(geoArea(polygon)).toBeLessThan(HEMISPHERE);
      expect(geoContains(polygon, [0, pole])).toBe(true);
      expect(geoContains(polygon, [0, 0])).toBe(false);
    }
  }
});

test('polygon across the antimeridian fills the side the points enclose', () => {
  const polygon = polygonOf({ kind: 'polygon', points: [[170, 0], [-170, 0], [-170, 20], [170, 20]] });
  expect(geoContains(polygon, [180, 10])).toBe(true);
  expect(geoContains(polygon, [0, 10])).toBe(false);
  expect(geoArea(polygon)).toBeLessThan(0.2);
});

test('circle GeoJSON has the correct area: 2*PI*(1-cos r)', () => {
  for (const r of [0.5, 10, 45, 89]) {
    const polygon = polygonOf({ kind: 'circle', center: [30, 40], radiusDeg: r });
    expect(geoArea(polygon) / (2 * Math.PI * (1 - Math.cos(r * rad)))).toBeCloseTo(1, 3);
    expect(geoContains(polygon, [30, 40])).toBe(true);
  }
  const ring = polygonOf({ kind: 'circle', center: [30, 40], radiusDeg: 25 }).coordinates[0]!;
  for (const p of ring) expect(geoDistance(p as LonLat, [30, 40]) / rad).toBeCloseTo(25, 6);
});

test('circle with radius above 90° is not flipped', () => {
  for (const r of [91, 120, 170]) {
    const polygon = polygonOf({ kind: 'circle', center: [30, 40], radiusDeg: r });
    expect(geoArea(polygon) / (2 * Math.PI * (1 - Math.cos(r * rad)))).toBeCloseTo(1, 3);
    expect(geoArea(polygon)).toBeGreaterThan(HEMISPHERE);
    expect(geoContains(polygon, [30, 40])).toBe(true);
    expect(geoContains(polygon, [-150, -40])).toBe(false);
  }
});

test('a shape is a line, or a fill with its outline as a line of its own', () => {
  expect((shapeToGeoJSON({ kind: 'line', points: [[0, 0], [10, 10]] }) as GeoJSON.Geometry).type).toBe('LineString');
  for (const shape of [{ kind: 'polygon', points: [[0, 0], [10, 0], [10, 10]] }, { kind: 'circle', center: [0, 0], radiusDeg: 5 }] as Shape[]) {
    expect(parts(shape).map((g) => g.type)).toEqual(['Polygon', 'LineString']);
  }
});

test('undo removes the last point, then the last shape; clear removes all', () => {
  const model = drawn('line', [0, 0], [10, 0]);
  model.finish();
  model.addPoint([20, 0]);
  model.addPoint([30, 10]);
  model.addPoint([40, 10]);
  model.undo();
  expect(model.draft).toEqual({ kind: 'line', points: [[20, 0], [30, 10]] });
  model.undo();
  model.undo();
  expect(model.draft).toBeNull();
  expect(model.shapes).toHaveLength(1);
  model.undo();
  expect(model.shapes).toHaveLength(0);
  model.undo();

  model.addPoint([0, 0]);
  model.addPoint([5, 5]);
  model.finish();
  model.addPoint([8, 8]);
  model.clear();
  expect(model.shapes).toEqual([]);
  expect(model.draft).toBeNull();
});

test('undo on a circle takes back its centre', () => {
  const model = drawn('circle', [10, 10]);
  expect(model.draft).not.toBeNull();
  model.undo();
  expect(model.draft).toBeNull();
});

test('cancel drops the draft and keeps the shapes; changing tool cancels too', () => {
  const model = drawn('line', [0, 0], [10, 0]);
  model.finish();
  model.addPoint([20, 0]);
  model.cancel();
  expect(model.draft).toBeNull();
  expect(model.shapes).toHaveLength(1);
  model.addPoint([20, 0]);
  model.setTool('polygon');
  expect(model.draft).toBeNull();
  model.setTool('none');
  model.addPoint([5, 5]);
  expect(model.draft).toBeNull();
});

test('a circle: the first point is the centre, the second sets the radius and finishes it', () => {
  const model = drawn('circle', [10, 10]);
  model.preview([10, 20]);
  expect(model.radiusKm).toBeCloseTo(radiusKm(10), 6);
  expect(model.drawn()).toEqual([{ kind: 'circle', center: [10, 10], radiusDeg: expect.closeTo(10, 9) }]);
  model.addPoint([10, 30]);
  expect(model.shapes).toEqual([{ kind: 'circle', center: [10, 10], radiusDeg: expect.closeTo(20, 9) }]);
  expect(model.draft).toBeNull();
  expect(model.radiusKm).toBeNull();
  // Beyond 90° the radius is the distance to the click, however far.
  model.addPoint([0, 0]);
  model.addPoint([140, 10]);
  expect((model.shapes[1] as { radiusDeg: number }).radiusDeg).toBeGreaterThan(90);
});

test('a circle click on its centre sets no radius', () => {
  const model = drawn('circle', [10, 10]);
  model.addPoint([10, 10.001]);
  expect(model.draft).not.toBeNull();
  expect(model.shapes).toEqual([]);
});

test('the rubber band: the draft with the cursor as its last point', () => {
  const model = drawn('line', [0, 0]);
  expect(model.drawn()).toEqual([]);
  model.preview([10, 0]);
  expect(model.drawn()).toEqual([{ kind: 'line', points: [[0, 0], [10, 0]] }]);
  model.preview(null);
  expect(model.drawn()).toEqual([]);

  const polygon = drawn('polygon', [0, 0], [10, 0]);
  polygon.preview([10, 10]);
  expect(polygon.drawn().map((s) => s.kind)).toEqual(['polygon']);
  // The rubber band to a point that would cross draws as a line, not as a ring with no clear inside.
  const bow = drawn('polygon', [0, 0], [10, 0], [10, 10]);
  bow.preview([5, -5]);
  expect(bow.drawn()).toEqual([{ kind: 'line', points: [[0, 0], [10, 0], [10, 10], [5, -5]] }]);
});

test('radiusKm(1) is about 111.2', () => {
  expect(radiusKm(1)).toBeCloseTo(111.19, 1);
  expect(radiusKm(180)).toBeCloseTo(Math.PI * 6371, 6);
});

// A polygon point whose edge would cross an existing edge of the draft is refused.
test('a polygon point whose edge would cross the draft is refused with a notice; the next accepted action clears it', () => {
  const model = drawn('polygon', [0, 0], [20, 0], [20, 20]);
  model.addPoint([10, -10]);
  expect((model.draft as { points: LonLat[] }).points).toHaveLength(3);
  expect(model.notice).toMatch(/cross/i);
  model.addPoint([5, 25]);
  expect((model.draft as { points: LonLat[] }).points).toHaveLength(4);
  expect(model.notice).toBeNull();
});

test('crossings are found on the sphere: across the antimeridian', () => {
  // The arc from 170 to -170 at latitude 10 bows north of 10, over the seam.
  const model = drawn('polygon', [170, 10], [-170, 10], [-175, 20]);
  model.addPoint([175, 0]);
  expect(model.notice).toMatch(/cross/i);
  expect((model.draft as { points: LonLat[] }).points).toHaveLength(3);
  // Straight from 175 to -175 at latitude 12 stays north of that arc and crosses nothing.
  model.addPoint([175, 20]);
  expect(model.notice).toBeNull();
  expect((model.draft as { points: LonLat[] }).points).toHaveLength(4);
});

test('crossings are found on the sphere: where edges meet over a pole', () => {
  // Both edges run over the pole, where they cross, though their longitudes never overlap in a plane.
  const model = drawn('polygon', [0, 80], [180, 80], [90, 85]);
  model.addPoint([-90, 85]);
  expect(model.notice).toMatch(/cross/i);
  expect((model.draft as { points: LonLat[] }).points).toHaveLength(3);
  model.addPoint([100, 60]);
  expect(model.notice).toBeNull();
});

test('a new edge folded back along the last one, or ending on an earlier point, is refused', () => {
  const model = drawn('polygon', [0, 0], [20, 0], [20, 20]);
  model.addPoint([20, 10]);
  expect(model.notice).not.toBeNull();
  model.addPoint([0, 0]);
  expect(model.notice).not.toBeNull();
  expect((model.draft as { points: LonLat[] }).points).toHaveLength(3);
});

test('a finish whose closing edge would cross is refused, and the draft stays', () => {
  const model = drawn('polygon', [0, 0], [10, 0], [10, 10], [20, 5]);
  expect(model.notice).toBeNull();
  model.finish();
  expect(model.shapes).toEqual([]);
  expect(model.draft).not.toBeNull();
  expect(model.notice).toMatch(/clos/i);
  // Taking the last point back lets it finish.
  model.undo();
  expect(model.notice).toBeNull();
  model.finish();
  expect(model.shapes).toHaveLength(1);
  expect(model.notice).toBeNull();
});

test('a closing edge is checked near the antimeridian and over a pole too', () => {
  const seam = drawn('polygon', [170, 10], [-170, 10], [-170, 30], [-160, 20]);
  expect(seam.notice).toBeNull();
  seam.finish();
  expect(seam.shapes).toEqual([]);
  expect(seam.notice).toMatch(/clos/i);

  const pole = drawn('polygon', [-60, 75], [0, 80], [180, 80], [60, 75]);
  expect(pole.notice).toBeNull();
  pole.finish();
  expect(pole.shapes).toHaveLength(0);
  expect(pole.notice).toMatch(/clos/i);
});

test('lines may cross themselves', () => {
  const model = drawn('line', [0, 0], [20, 20], [20, 0], [0, 20]);
  expect((model.draft as { points: LonLat[] }).points).toHaveLength(4);
  expect(model.notice).toBeNull();
});

test('a model tells its listeners when it changes', () => {
  const model = new DrawingModel();
  let calls = 0;
  const stop = model.subscribe(() => calls++);
  model.setTool('line');
  model.addPoint([0, 0]);
  model.preview([1, 1]);
  expect(calls).toBe(3);
  stop();
  model.cancel();
  expect(calls).toBe(3);
});

// What the shapes look like once cut: the fill goes to the right side on a map, whatever it crosses.
const live = (id: string, shape: Shape, orientation?: Partial<{ lon: number; lat: number; tilt: number }>) => {
  const m = member(id, orientation);
  const pieces = buildScene({ drawings: { type: 'GeometryCollection', geometries: [shapeToGeoJSON(shape) as GeoJSON.Geometry] } as GeoJSON.GeoJsonObject }, [m], null, false).layers.drawings!;
  const full = buildScene({ drawings: { type: 'GeometryCollection', geometries: [shapeToGeoJSON(shape) as GeoJSON.Geometry] } as GeoJSON.GeoJsonObject }, [m], m, false).layers.drawings!.filter((p) => p.alphaDst > 0 && !p.behind);
  const fills = (list: typeof pieces, at: (p: (typeof pieces)[number]) => Float32Array) => (p: LonLat) => {
    const [x, y] = projectPoint(m.compiled, m.screen, p);
    return filledAt(list.filter((q) => q.closed), at, x, y);
  };
  return { front: fills(pieces, (p) => p.src), full: fills(full, (p) => p.dst) };
};

test('fills land on the right side of a seam and a pole, in the live and the full cut', () => {
  const seam: Shape = { kind: 'polygon', points: [[170, 0], [-170, 0], [-170, 20], [170, 20]] };
  const pole: Shape = { kind: 'polygon', points: [[0, 60], [90, 60], [180, 60], [-90, 60]] };
  const big: Shape = { kind: 'circle', center: [0, 0], radiusDeg: 120 };
  for (const id of ['mercator', 'goode', 'robinson']) {
    for (const cut of ['front', 'full'] as const) {
      const a = live(id, seam);
      expect(a[cut]([178, 10]), `${id} ${cut} seam inside, east`).toBe(true);
      expect(a[cut]([-178, 10]), `${id} ${cut} seam inside, west`).toBe(true);
      expect(a[cut]([0, 10]), `${id} ${cut} seam outside`).toBe(false);
      const b = live(id, pole);
      expect(b[cut]([30, 75]), `${id} ${cut} pole inside`).toBe(true);
      expect(b[cut]([30, 40]), `${id} ${cut} pole outside`).toBe(false);
      expect(b[cut]([30, -40]), `${id} ${cut} south`).toBe(false);
      const c = live(id, big, { lon: 100 });
      expect(c[cut]([100, 0]), `${id} ${cut} circle across the seam`).toBe(true);
      expect(c[cut]([-100, 0]), `${id} ${cut} circle far side`).toBe(true);
      expect(c[cut]([180, 0]), `${id} ${cut} circle opposite`).toBe(false);
    }
  }
});

test('canFinish: a line from two points and a polygon from three, and never a circle or no draft', () => {
  const model = new DrawingModel();
  expect(model.canFinish).toBe(false);
  model.setTool('line');
  model.addPoint([0, 0]);
  expect(model.canFinish).toBe(false);
  model.addPoint([10, 0]);
  expect(model.canFinish).toBe(true);
  model.setTool('polygon');
  model.addPoint([0, 0]);
  model.addPoint([10, 0]);
  expect(model.canFinish).toBe(false);
  model.addPoint([10, 10]);
  expect(model.canFinish).toBe(true);
  model.setTool('circle');
  model.addPoint([0, 0]);
  expect(model.canFinish).toBe(false);
});

/** Whether any two neighbours of a path, the last and first too if it is closed, are within 1e-3 degrees of antipodal. */
const nearlyAntipodal = (path: LonLat[], closed: boolean) =>
  path.some((p, i) => {
    const q = path[i + 1] ?? (closed ? path[0] : undefined);
    return q !== undefined && geoDistance(p, q) / rad > 180 - 1e-3;
  });

test('a polygon with an edge between antipodes gets a vertex on the edge, and draws finite and the right size on every map', () => {
  // The closing edge, from (180, 0) back to (0, 0), runs between antipodes: it goes over the north pole.
  const polygon: Shape = { kind: 'polygon', points: [[0, 0], [90, -20], [180, 0]] };
  // A fill and its outline as a line of its own.
  const geometry = (shapeToGeoJSON(polygon) as GeoJSON.GeometryCollection).geometries[0] as GeoJSON.Polygon;
  const ring = geometry.coordinates[0] as LonLat[];
  expect(nearlyAntipodal(ring, true)).toBe(false);
  expect(ring.some(([, lat]) => lat === 90)).toBe(true);
  // Bounded by the equator's half, the meridian over the pole and the path south: under a hemisphere.
  expect(geoArea(geometry)).toBeLessThan(2 * Math.PI);
  expect(geoArea(geometry)).toBeGreaterThan(0);
  for (const id of ['globe', 'mercator', 'goode', 'gnomonic', 'mollweide']) {
    const m = member(id);
    expect(finiteEverywhere(cutGeometry(geometry, [m.compiled]).map((p) => p.coords)), `full cut, ${id}`).toBe(true);
    expect(finiteEverywhere(cutFront(geometry, m.compiled).map((p) => p.rings)), `front cut, ${id}`).toBe(true);
  }
});

test('a line with an end at a pole, or from one pole to the other, draws finite, and no edge left between antipodes', () => {
  const lines: LonLat[][] = [
    [[0, 90], [30, 20]],
    [[10, -90], [0, 0], [40, 10]],
    [[0, 90], [0, -90]],
    // Near the poles, but not quite at them, and within 1e-3 degrees of antipodal.
    [[0, 89.9985], [180, -89.9993]],
    [[20, -89.9993], [-160, 89.9985]],
  ];
  for (const points of lines) {
    const geometry = shapeToGeoJSON({ kind: 'line', points }) as GeoJSON.LineString;
    expect(nearlyAntipodal(geometry.coordinates as LonLat[], false), JSON.stringify(points)).toBe(false);
    for (const id of ['globe', 'mercator', 'goode', 'lambert-conformal']) {
      const m = member(id);
      expect(finiteEverywhere(cutGeometry(geometry, [m.compiled]).map((p) => p.coords)), `${JSON.stringify(points)} full cut, ${id}`).toBe(true);
      expect(finiteEverywhere(cutFront(geometry, m.compiled).map((p) => p.rings)), `${JSON.stringify(points)} front cut, ${id}`).toBe(true);
    }
  }
});

// Shapes that follow the map: the model is told how to trace on the map on screen with each click.

/** A tracer that joins two points by a few points along a straight line of longitude and latitude, as an equirectangular map would, and refuses anything past 100 degrees east. */
const flat: Tracer = {
  line(a, b) {
    if (Math.max(a[0], b[0]) > 100) return null;
    return [0, 0.25, 0.5, 0.75, 1].map((u) => (u === 0 ? a : u === 1 ? b : [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u])) as LonLat[];
  },
  circle(centre, edge) {
    const r = Math.hypot(edge[0] - centre[0], edge[1] - centre[1]);
    if (centre[0] + r > 100) return null;
    // Clockwise seen from outside the Earth: east, south, west, north.
    const ring = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => [centre[0] + r * Math.cos((k * Math.PI) / 4), centre[1] - r * Math.sin((k * Math.PI) / 4)] as LonLat);
    return [...ring, ring[0]!];
  },
};
function traced(tool: 'line' | 'polygon' | 'circle', ...points: LonLat[]): DrawingModel {
  const model = new DrawingModel();
  model.setMode('map');
  model.setTool(tool);
  for (const p of points) model.addPoint(p, flat);
  return model;
}

test('a model follows the globe until told to follow the map, and changing which drops a shape half drawn', () => {
  const model = new DrawingModel();
  expect(model.mode).toBe('globe');
  model.setTool('line');
  model.addPoint([0, 0]);
  model.setMode('map');
  expect(model.mode).toBe('map');
  expect(model.draft).toBeNull();
  expect(model.tool).toBe('line');
  // The same again changes nothing, and keeps a draft.
  model.addPoint([0, 0], flat);
  model.setMode('map');
  expect(model.draft).not.toBeNull();
});

test('following the map, a line is the paths traced between its points, joined, and is kept as a path of points on the Earth', () => {
  const model = traced('line', [0, 0], [20, 10], [40, 0]);
  model.finish(flat);
  expect(model.shapes).toHaveLength(1);
  const shape = model.shapes[0]!;
  expect(shape.kind).toBe('path');
  if (shape.kind !== 'path') return;
  expect(shape.closed).toBe(false);
  // Two traces of five points, sharing the point where they join.
  expect(shape.points).toHaveLength(9);
  expect(shape.points[0]).toEqual([0, 0]);
  expect(shape.points[2]).toEqual([10, 5]);
  expect(shape.points[4]).toEqual([20, 10]);
  expect(shape.points.at(-1)).toEqual([40, 0]);
  expect(shapeToGeoJSON(shape)).toEqual({ type: 'LineString', coordinates: shape.points });
});

test('following the map, an edge that the map cannot trace is refused with a notice, and the draft is as it was', () => {
  const model = traced('line', [0, 0], [20, 10]);
  const before = model.draft;
  model.addPoint([120, 0], flat);
  expect(model.draft).toBe(before);
  expect(model.notice).toBe('A straight line there would leave the map.');
  // The next point that can be traced clears it.
  model.addPoint([30, 0], flat);
  expect(model.notice).toBeNull();
  expect(model.canFinish).toBe(true);
});

test('following the map, undo takes back a point with the path traced to it', () => {
  const model = traced('line', [0, 0], [20, 10], [40, 0]);
  model.undo();
  model.finish(flat);
  const shape = model.shapes[0]!;
  expect(shape.kind === 'path' && shape.points).toHaveLength(5);
  expect(shape.kind === 'path' && shape.points.at(-1)).toEqual([20, 10]);
});

test('following the map, a polygon is closed by one more traced edge and wound round its inside, whichever way it was drawn', () => {
  for (const corners of [[[0, 0], [30, 0], [30, 20], [0, 20]], [[0, 0], [0, 20], [30, 20], [30, 0]]] as LonLat[][]) {
    const model = traced('polygon', ...corners);
    model.finish(flat);
    const shape = model.shapes[0]!;
    expect(shape.kind).toBe('path');
    if (shape.kind !== 'path') return;
    expect(shape.closed).toBe(true);
    expect(shape.points.at(-1)).toEqual(shape.points[0]);
    expect(shape.points).toHaveLength(17);
    const [fill, outline] = parts(shape);
    expect(fill!.type).toBe('Polygon');
    expect(outline).toEqual({ type: 'LineString', coordinates: shape.points });
    expect(geoArea(fill as GeoJSON.Polygon)).toBeLessThan(HEMISPHERE);
    expect(geoContains(fill as GeoJSON.Polygon, [15, 10])).toBe(true);
  }
});

test('following the map, a polygon whose new edge or closing edge would cross it, or leave the map, is refused', () => {
  const crossing = traced('polygon', [0, 0], [30, 0], [30, 20]);
  crossing.addPoint([15, -10], flat);
  expect(crossing.notice).toBe('That point would make the polygon cross itself.');
  expect((crossing.draft as { points: LonLat[] }).points).toHaveLength(3);

  // A spiral: each edge clear of those before it, and the way back to the start across one of them.
  const bowtie = traced('polygon', [0, 0], [30, 0], [30, 30], [0, 30], [0, 10], [20, 10], [20, 20]);
  expect((bowtie.draft as { points: LonLat[] }).points).toHaveLength(7);
  bowtie.finish(flat);
  expect(bowtie.shapes).toEqual([]);
  expect(bowtie.notice).toBe('The edge that closes the polygon would cross it. Undo a point, or place the last one elsewhere.');
  expect(bowtie.draft).not.toBeNull();

  // The closing edge is traced like any other, and may leave the map.
  const wide: Tracer = { ...flat, line: (a, b) => (a[0] === 90 && b[0] === 0 ? null : flat.line(a, b)) };
  const leaves = new DrawingModel();
  leaves.setMode('map');
  leaves.setTool('polygon');
  for (const p of [[0, 0], [45, 30], [90, 0]] as LonLat[]) leaves.addPoint(p, wide);
  leaves.finish(wide);
  expect(leaves.shapes).toEqual([]);
  expect(leaves.notice).toBe('A straight line there would leave the map.');
});

test('following the map, a circle is the ring the map traces through the second click, and has no radius in kilometres', () => {
  const model = traced('circle', [10, 10]);
  model.preview([20, 10], flat);
  expect(model.radiusKm).toBeNull();
  const shown = model.drawn().at(-1)!;
  expect(shown.kind).toBe('path');
  model.addPoint([20, 10], flat);
  expect(model.draft).toBeNull();
  const shape = model.shapes[0]!;
  expect(shape.kind === 'path' && shape.closed).toBe(true);
  expect(shape.kind === 'path' && shape.points).toHaveLength(9);
  // One the map cannot trace is refused, and the centre stays.
  const refused = traced('circle', [80, 0], [95, 20]);
  expect(refused.shapes).toEqual([]);
  expect(refused.notice).toBe('A circle that size would leave the map.');
  expect(refused.draft).toEqual({ kind: 'circle', center: [80, 0], radiusDeg: 0 });
});

test('following the map, the rubber band is the path traced on to the cursor, and a polygon is shown closed once it can be', () => {
  const line = traced('line', [0, 0], [20, 10]);
  line.preview([40, 0], flat);
  const band = line.drawn().at(-1)!;
  expect(band.kind === 'path' && !band.closed && band.points.length).toBe(9);
  // Where the map cannot trace to the cursor, what is placed is shown and no more.
  line.preview([120, 0], flat);
  const held = line.drawn().at(-1)!;
  expect(held.kind === 'path' && held.points.length).toBe(5);
  line.preview(null);
  expect((line.drawn().at(-1) as { points: LonLat[] }).points).toHaveLength(5);

  const polygon = traced('polygon', [0, 0], [30, 0]);
  polygon.preview([30, 20], flat);
  const closed = polygon.drawn().at(-1)!;
  expect(closed.kind === 'path' && closed.closed).toBe(true);
  // With one corner there is only the line to the cursor.
  const first = traced('polygon', [0, 0]);
  first.preview([30, 0], flat);
  const open = first.drawn().at(-1)!;
  expect(open.kind === 'path' && open.closed).toBe(false);
});

test('following the globe, the model is as it was: great-circle shapes, with no tracer asked for', () => {
  const model = new DrawingModel();
  model.setMode('map');
  model.setMode('globe');
  model.setTool('polygon');
  for (const p of [[0, 0], [10, 0], [10, 10]] as LonLat[]) model.addPoint(p, flat);
  model.finish(flat);
  expect(model.shapes).toEqual([{ kind: 'polygon', points: [[0, 0], [10, 0], [10, 10]] }]);
});

test('a long path drawn straight on Mercator cuts on the most interrupted maps without a throw, and keeps its length', () => {
  const mercator = member('mercator');
  const path = straightPath(mercator.compiled, mercator.screen, [-170, 60], [170, -60])!;
  expect(path.length).toBeGreaterThan(300);
  const shape: Shape = { kind: 'path', points: path, closed: false };
  const geometry = shapeToGeoJSON(shape);
  const total = (lines: LonLat[][]) => lines.reduce((sum, line) => sum + line.slice(1).reduce((s, p, i) => s + geoDistance(line[i]!, p), 0), 0);
  const whole = total([path]);
  for (const id of ['peirce', 'butterfly', 'goode', 'nicolosi']) {
    for (const o of [{}, { lon: 33, lat: 21, tilt: 40 }]) {
      const m = member(id, o);
      const full = cutGeometry(geometry, [m.compiled]);
      expect(finiteEverywhere(full.map((p) => p.coords)), `${id} full`).toBe(true);
      expect(total(full.flatMap((p) => p.coords)) / whole, `${id} full`).toBeGreaterThan(0.99);
      expect(total(full.flatMap((p) => p.coords)) / whole, `${id} full`).toBeLessThan(1.01);
      const front = cutFront(geometry, m.compiled);
      const onEarth = front.flatMap((p) => p.rings.map((ring) => ring.map((q) => m.compiled.fromFrame(q))));
      expect(total(onEarth) / whole, `${id} front`).toBeGreaterThan(0.98);
      expect(total(onEarth) / whole, `${id} front`).toBeLessThan(1.01);
      // And in a morph from the map it was drawn on.
      const scene = buildScene({ drawing: geometry }, [mercator], m, false);
      expect(scene.layers.drawing!.length, `${id} morph`).toBeGreaterThan(0);
      for (const piece of scene.layers.drawing!) expect([...piece.src, ...piece.dst].every(Number.isFinite), `${id} morph`).toBe(true);
    }
  }
});
