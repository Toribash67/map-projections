import { expect, test } from 'vitest';
import { geoArea, geoDistance, geoGraticule10 } from 'd3-geo';
import { feature } from 'topojson-client';
import landTopology from 'world-atlas/land-110m.json';
import { cutGeometry, type Piece } from '../src/geo/cut';
import { stops } from '../src/projections/catalog';
import { compile, stateForStop } from '../src/projections/compile';
import type { CompiledProjection, LonLat, Orientation } from '../src/projections/types';

const LAND_AREA = 3.62789;
const TAU = 2 * Math.PI;
const rad = Math.PI / 180;

const topology = landTopology as any;
const land = feature(topology, topology.objects.land) as unknown as GeoJSON.GeoJsonObject;
const graticule = geoGraticule10() as GeoJSON.GeoJsonObject;
const sphere = { type: 'Sphere' } as unknown as GeoJSON.GeoJsonObject;

function member(stopId: string, orientation?: Orientation): CompiledProjection {
  const stop = stops.find((s) => s.id === stopId);
  if (!stop) throw new Error(`no stop ${stopId}`);
  const state = stateForStop(stop);
  return compile(orientation ? { ...state, orientation } : state);
}

/** Signed area of a ring, so that a ring the wrong way round counts against the total. */
function ringArea(ring: LonLat[]): number {
  const a = geoArea({ type: 'Polygon', coordinates: [ring] });
  return a > TAU ? a - 2 * TAU : a;
}

function area(pieces: Piece[]): number {
  let total = 0;
  for (const piece of pieces) {
    if (!piece.closed) continue;
    for (const ring of piece.coords) total += ringArea(ring);
  }
  return total;
}

function expectLandArea(pieces: Piece[], label?: string) {
  expect(Math.abs(area(pieces) - LAND_AREA), `${label}: area ${area(pieces)}`).toBeLessThan(1e-3);
}

const allPoints = (pieces: Piece[]) => pieces.flatMap((p) => p.coords.flat());

test('land area is preserved at 3.62789 sr ±1e-3 for one member, each stop, default orientation', () => {
  expect(stops.length).toBe(21);
  for (const s of stops) expectLandArea(cutGeometry(land, [member(s.id)]), s.id);
});

test('land area is preserved through 2 members with different orientations', () => {
  const rotated = { lon: -40, lat: 20, tilt: 30 };
  expectLandArea(cutGeometry(land, [member('mercator'), member('mollweide', rotated)]), 'mercator, mollweide');
  expectLandArea(cutGeometry(land, [member('gnomonic', rotated), member('robinson')]), 'gnomonic, robinson');
  expectLandArea(cutGeometry(land, [member('globe', rotated), member('albers')]), 'globe, albers');
});

test('land area is preserved for Goode with a rotated cylindrical member', () => {
  const rotated = { lon: 70, lat: -35, tilt: 50 };
  expectLandArea(cutGeometry(land, [member('goode'), member('mercator', rotated)]), 'goode first');
  expectLandArea(cutGeometry(land, [member('mercator', rotated), member('goode')]), 'goode second');
  expectLandArea(cutGeometry(land, [member('goode', rotated)]), 'rotated goode');
});

/** Total area of a cut whole sphere, which is 4π, and which a full-sphere ring reads as 0. */
function expectWholeSphere(pieces: Piece[], label: string) {
  const total = pieces.reduce((sum, p) => sum + geoArea({ type: 'Polygon', coordinates: p.coords }), 0);
  const remainder = total % (2 * TAU);
  expect(Math.min(remainder, 2 * TAU - remainder), `${label}: area ${total}`).toBeLessThan(1e-3);
}

test('land and the whole sphere keep their area through pairs of stops', () => {
  const ids = ['globe', 'gnomonic', 'mercator', 'equirectangular', 'transverse-mercator', 'albers', 'robinson', 'goode'];
  for (const a of ids) {
    for (const b of ids) {
      const members = [member(a), member(b)];
      expectLandArea(cutGeometry(land, members), `${a}, ${b}`);
      expectWholeSphere(cutGeometry(sphere, members), `${a}, ${b}`);
    }
  }
}, 30_000);

test('area survives members whose cuts line up', () => {
  const at = (lon: number, lat = 0, tilt = 0) => ({ lon, lat, tilt });
  const cases: [string, CompiledProjection[]][] = [
    // Seams and caps meeting at the same poles.
    ['mercators sharing poles', [member('mercator'), member('mercator', at(90))]],
    ['mercators back to back', [member('mercator'), member('mercator', at(180))]],
    ['mercator and goode sharing poles', [member('mercator', at(90)), member('goode', at(10))]],
    // Two circles through the same poles, where each clip reads what is inside from one point.
    ['globes sharing poles', [member('globe'), member('globe', at(10))]],
    // A circle along the meridian where Antarctica's ring has an edge.
    ['globes, one on the data seam', [member('globe', at(80)), member('globe', at(90))]],
    // A pole of the seam's frame inside a gap between lobes.
    ['goode gap on the mercator pole', [member('goode', at(-40, 0, 90)), member('mercator')]],
    ['mercator pole on the goode equator', [member('goode'), member('mercator', at(0, 90))]],
    ['goode pole on the mercator equator', [member('mercator', at(10)), member('goode', at(0, 90))]],
    // A circle through the poles, with a seam and lobes meeting there.
    ['globe, goode, robinson', [member('globe'), member('goode'), member('robinson')]],
  ];
  for (const [label, members] of cases) {
    expectLandArea(cutGeometry(land, members), label);
    expectWholeSphere(cutGeometry(sphere, members), label);
  }
});

test('no segment exceeds 2°', () => {
  const members = [member('goode'), member('mercator', { lon: 30, lat: 10, tilt: 0 })];
  for (const geom of [land, graticule, sphere]) {
    const pieces = cutGeometry(geom, members);
    expect(pieces.length).toBeGreaterThan(0);
    for (const path of pieces.flatMap((p) => p.coords)) {
      for (let i = 1; i < path.length; i++) {
        expect(geoDistance(path[i - 1]!, path[i]!) / rad).toBeLessThanOrEqual(2 + 1e-9);
      }
    }
  }
});

test('points on a seam stay on their own side after re-entering the frame', () => {
  const orientations = [undefined, { lon: 40, lat: 25, tilt: 30 }];
  for (const orientation of orientations) {
    const mercator = member('mercator', orientation);
    for (const geom of [land, graticule, sphere]) {
      const pieces = cutGeometry(geom, [mercator]);
      expect(pieces.length).toBeGreaterThan(0);
      for (const path of pieces.flatMap((p) => p.coords)) {
        const frame = path.map((p) => mercator.toFrame(p));
        for (let i = 0; i < frame.length; i++) {
          expect(Math.abs(frame[i]![0])).toBeLessThan(180);
          // Longitude means nothing at a pole of the frame, where a cap piece's ring can turn.
          if (i === 0 || Math.abs(frame[i]![1]) > 89.999 || Math.abs(frame[i - 1]![1]) > 89.999) continue;
          expect(Math.abs(frame[i]![0] - frame[i - 1]![0])).toBeLessThanOrEqual(180);
        }
      }
    }
  }
});

test('a line crossing the antimeridian comes out as 2 line pieces', () => {
  const line: GeoJSON.LineString = {
    type: 'LineString',
    coordinates: [[170, 10], [-170, 20]],
  };
  const pieces = cutGeometry(line, [member('mercator')]);
  expect(pieces.length).toBe(2);
  for (const piece of pieces) {
    expect(piece.closed).toBe(false);
    expect(piece.coords.length).toBe(1);
    expect(piece.inside).toEqual([true]);
    expect(piece.lobes).toEqual([undefined]);
  }
  const lons = pieces.map((p) => p.coords[0]!.map((c) => c[0]));
  const east = lons.find((l) => l[0]! > 0)!;
  const west = lons.find((l) => l[0]! < 0)!;
  expect(Math.min(...east)).toBeGreaterThanOrEqual(170 - 1e-9);
  expect(Math.max(...east)).toBeLessThan(180);
  expect(Math.max(...west)).toBeLessThanOrEqual(-170 + 1e-9);
  expect(Math.min(...west)).toBeGreaterThan(-180);
});

test('identical seams are cut once: same output length with [a] and [a, a]', () => {
  for (const id of ['mercator', 'goode', 'globe', 'gnomonic']) {
    const a = member(id, { lon: 15, lat: 10, tilt: 0 });
    const once = cutGeometry(land, [a]);
    const twice = cutGeometry(land, [a, a]);
    expect(twice.length, id).toBe(once.length);
    expect(twice.map((p) => p.coords)).toEqual(once.map((p) => p.coords));
    // The second member still gets its flags and lobes, from the cuts the first one made.
    for (const piece of twice) {
      expect(piece.inside[1]).toBe(piece.inside[0]);
      expect(piece.behind[1]).toBe(piece.behind[0]);
      expect(piece.lobes[1]).toBe(piece.lobes[0]);
    }
  }
});

test('gnomonic: inside and outside pieces partition land area', () => {
  const orientation = { lon: 20, lat: 30, tilt: 0 };
  const gnomonic = member('gnomonic', orientation);
  const pieces = cutGeometry(land, [gnomonic]);
  const inside = pieces.filter((p) => p.inside[0]);
  const outside = pieces.filter((p) => !p.inside[0]);
  expect(area(inside)).toBeGreaterThan(0.1);
  expect(area(outside)).toBeGreaterThan(0.1);
  expect(Math.abs(area(inside) + area(outside) - LAND_AREA)).toBeLessThan(1e-3);
  // The two sides really are the two sides of the 68° circle around the centre.
  const distance = (p: LonLat) => geoDistance(p, [orientation.lon, orientation.lat]) / rad;
  for (const p of allPoints(inside)) expect(distance(p)).toBeLessThanOrEqual(68 + 0.01);
  for (const p of allPoints(outside)) expect(distance(p)).toBeGreaterThanOrEqual(68 - 0.01);
});

test('Sphere produces at least one closed piece for each stop', () => {
  for (const s of stops) {
    const pieces = cutGeometry(sphere, [member(s.id)]);
    expect(pieces.some((p) => p.closed && p.coords.length > 0), s.id).toBe(true);
  }
});

test('the globe far side is behind, not outside', () => {
  const orientation = { lon: 40, lat: 15, tilt: 0 };
  const pieces = cutGeometry(land, [member('globe', orientation)]);
  expect(pieces.every((p) => p.inside[0])).toBe(true);
  const behind = pieces.filter((p) => p.behind[0]);
  const front = pieces.filter((p) => !p.behind[0]);
  expect(area(behind)).toBeGreaterThan(0.1);
  expect(area(front)).toBeGreaterThan(0.1);
  const distance = (p: LonLat) => geoDistance(p, [orientation.lon, orientation.lat]) / rad;
  for (const p of allPoints(front)) expect(distance(p)).toBeLessThanOrEqual(90 + 0.01);
  for (const p of allPoints(behind)) expect(distance(p)).toBeGreaterThanOrEqual(90 - 0.01);
});

test('flags and lobes are kept per member', () => {
  const pieces = cutGeometry(land, [member('gnomonic'), member('goode')]);
  expect(pieces.some((p) => !p.inside[0] && p.inside[1])).toBe(true);
  expect(pieces.every((p) => p.lobes[0] === undefined)).toBe(true);
  expect(pieces.every((p) => p.lobes[1] !== undefined)).toBe(true);
  expect(pieces.every((p) => p.inside.length === 2 && p.behind.length === 2 && p.lobes.length === 2)).toBe(true);
});

test('a Goode piece carries the central longitude of the lobe holding all its points', () => {
  const goode = member('goode');
  const seam = goode.def.seam;
  if (seam.kind !== 'lobes') throw new Error('goode has lobes');
  const pieces = cutGeometry(land, [goode]);
  const used = new Set(pieces.map((p) => p.lobes[0]));
  expect(used.size).toBeGreaterThan(1);
  for (const piece of pieces) {
    const lobe = seam.lobes.find((l) => l.centralLon === piece.lobes[0]);
    expect(lobe).toBeDefined();
    const contained = (p: LonLat) =>
      p[0] >= lobe!.lonMin && p[0] <= lobe!.lonMax && p[1] >= lobe!.latMin && p[1] <= lobe!.latMax;
    expect(piece.coords.flat().every(contained)).toBe(true);
  }
});

test('graticule lines lying on Goode lobe edges survive the cut', () => {
  const goode = member('goode');
  const pieces = cutGeometry(graticule, [goode]);
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-3;
  const lines = pieces.map((p) => p.coords[0]!);
  // The equator between the northern and southern lobes, and a meridian between two southern lobes.
  const equator = lines.filter((line) => line.every((p) => near(p[1], 0)));
  const meridian = lines.filter((line) => line.every((p) => near(p[0], -100)) && line[0]![1] < 0);
  expect(equator.flat().length).toBeGreaterThan(100);
  expect(meridian.flat().length).toBeGreaterThan(30);
});
