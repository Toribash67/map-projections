import { expect, test } from 'vitest';
import { geoArea, geoDistance, geoGraticule10 } from 'd3-geo';
import { feature } from 'topojson-client';
import landTopology from 'world-atlas/land-110m.json';
import { cutGeometry, type Piece } from '../src/geo/cut';
import { stops } from '../src/projections/catalog';
import { compile, stateForStop } from '../src/projections/compile';
import { computeScreen, projectPoint } from '../src/screen/screen';
import type { CompiledProjection, LonLat, Orientation } from '../src/projections/types';
import { stopOf } from './stopOf';

const LAND_AREA = 3.62789;
const TAU = 2 * Math.PI;
const rad = Math.PI / 180;

const topology = landTopology as any;
const land = feature(topology, topology.objects.land) as unknown as GeoJSON.GeoJsonObject;
const graticule = geoGraticule10() as GeoJSON.GeoJsonObject;
const sphere = { type: 'Sphere' } as unknown as GeoJSON.GeoJsonObject;

function member(stopId: string, orientation?: Orientation): CompiledProjection {
  const stop = stopOf(stopId);
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

/** Area as d3 reads it. Unlike `area`, this also sees a tiny ring turned inside out, which then reads as nearly 4π. */
const unsignedArea = (pieces: Piece[]) =>
  pieces.filter((p) => p.closed).reduce((sum, p) => sum + geoArea({ type: 'Polygon', coordinates: p.coords }), 0);

function expectLandArea(pieces: Piece[], label?: string) {
  expect(Math.abs(area(pieces) - LAND_AREA), `${label}: area ${area(pieces)}`).toBeLessThan(1e-3);
  expect(Math.abs(unsignedArea(pieces) - LAND_AREA), `${label}: unsigned area ${unsignedArea(pieces)}`).toBeLessThan(1e-3);
}

const allPoints = (pieces: Piece[]) => pieces.flatMap((p) => p.coords.flat());

test('land area is preserved at 3.62789 sr ±1e-3 for one member, each stop, default orientation', () => {
  expect(stops.length).toBe(30);
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

/** The pieces of a cut sphere partition it. Every stop has a cap, so no single piece reads as a full-sphere 0. */
function expectWholeSphere(pieces: Piece[], label: string) {
  const total = unsignedArea(pieces);
  expect(Math.abs(total - 2 * TAU), `${label}: area ${total}`).toBeLessThan(1e-3);
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
    // The globe's circle through the pole of the first of several seams, which pulls furthest.
    ['globe through a far-pulled seam', [member('globe'), member('transverse-mercator'), member('mercator', at(5)), member('mollweide', at(20)), member('goode')]],
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

test('the whole sphere survives a redirect from the globe through Goode to Transverse Mercator', () => {
  const orders = [
    ['globe', 'goode', 'transverse-mercator'],
    ['orthographic', 'goode', 'transverse-mercator'],
    ['goode', 'globe', 'transverse-mercator'],
  ];
  for (const ids of orders) expectWholeSphere(cutGeometry(sphere, ids.map((id) => member(id))), ids.join(', '));
});

test('the whole sphere survives a redirect through two Goodes centred apart', () => {
  // Five members, as on a redirect mid-morph: clicks from a globe dragged to lon -59. The
  // conic in the middle resets the centre, so the two Goodes end their lobes at one pole
  // with different longitudes, and the sphere used to come out about 10 sr too large.
  let state = { ...stateForStop(stops.find((s) => s.id === 'globe')!), orientation: { lon: -59, lat: 0, tilt: 0 } };
  const states = [state];
  for (const id of ['goode', 'mercator', 'lambert-conformal', 'goode']) {
    state = stateForStop(stopOf(id), state);
    states.push(state);
  }
  const members = states.map(compile);
  expectWholeSphere(cutGeometry(sphere, members), 'dragged redirect');
  expectLandArea(cutGeometry(land, members), 'dragged redirect');
});

test('a cut that comes out wrong is redone another way', () => {
  // No mock: at the first attempt the sphere here gains about 11 sr, and the graticule steps across
  // a seam, when lobes of two Goodes meet at exactly placed centres. The second attempt is right.
  const at = (lon: number, lat = 0, tilt = 0) => ({ lon, lat, tilt });
  expectWholeSphere(cutGeometry(sphere, [member('goode'), member('goode', at(0, 45, 45))]), 'goodes, sphere');
  expectWholeSphere(cutGeometry(sphere, [member('goode', at(-40, 0, 90)), member('goode')]), 'goodes, sphere');
  const members = [member('goode', at(0, 45, 45)), member('goode', at(90))];
  expect(seamJumps(cutGeometry(graticule, members), members)).toEqual([]);
});

test('invariant: no land ring reads as the whole sphere on these sets', () => {
  // Plain invariant, not a test of the retry. These used to leave a ring inside out at the first
  // attempt; the retry in `cutGeometry` no longer fires on them.
  const sets = [
    ['goode', 'globe', 'robinson'],
    ['mercator', 'goode', 'transverse-mercator'],
    ['equirectangular', 'gnomonic', 'goode'],
  ];
  for (const ids of sets) expectLandArea(cutGeometry(land, ids.map((id) => member(id))), ids.join(', '));
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
    const lobe = seam.lobes.find((l) => l.id === piece.lobes[0]);
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

const VIEWPORT = { width: 1000, height: 600 };
const isFront = (piece: Piece, i: number) => piece.inside[i] && !piece.behind[i];

/** The members a click from `from` to each stop in turn compiles to, carrying state as the app does. */
function clicks(from: Orientation, ids: string[]): CompiledProjection[] {
  let state = { ...stateForStop(stops.find((s) => s.id === ids[0])!), orientation: from };
  const states = [state];
  for (const id of ids.slice(1)) {
    state = stateForStop(stopOf(id), state);
    states.push(state);
  }
  return states.map(compile);
}

/** Total signed area in pixels of what member `i` fills. */
function planarArea(pieces: Piece[], members: CompiledProjection[], i: number): number {
  const m = members[i]!;
  const screen = computeScreen(m, VIEWPORT);
  let total = 0;
  for (const piece of pieces) {
    if (!piece.closed || !isFront(piece, i)) continue;
    for (const ring of piece.coords) {
      const points = ring.map((p) => projectPoint(m, screen, p, piece.lobes[i]));
      for (let k = 1; k < points.length; k++) {
        total += (points[k - 1]![0] * points[k]![1] - points[k]![0] * points[k - 1]![1]) / 2;
      }
    }
  }
  return total;
}

/** Consecutive points on opposite sides of a frame's antimeridian, which every seam includes, away from the poles where longitude means nothing. */
function seamJumps(pieces: Piece[], members: CompiledProjection[]): string[] {
  const jumps: string[] = [];
  members.forEach((m, i) => {
    if (m.def.seam.kind === 'none') return;
    for (const path of pieces.flatMap((p) => p.coords)) {
      const frame = path.map((p) => m.toFrame(p));
      for (let k = 1; k < frame.length; k++) {
        const [a, b] = [frame[k - 1]!, frame[k]!];
        if (Math.abs(a[1]) > 89.9 || Math.abs(b[1]) > 89.9) continue;
        if (Math.abs(a[0] - b[0]) > 180) jumps.push(`member ${i} ${a} to ${b}`);
      }
    }
  });
  return jumps;
}

test('a tilted world map keeps its ocean on the way to a conic', () => {
  const r = rng(31);
  const worlds = ['mercator', 'equirectangular', 'gall-peters', 'robinson', 'mollweide', 'hammer', 'sinusoidal', 'equal-earth'];
  const cases: [string, Orientation, string][] = [
    ['hammer', { lon: -59.7, lat: -14.7, tilt: 35 }, 'albers'],
    ['equirectangular', { lon: 75.3, lat: -14.7, tilt: 30 }, 'albers'],
  ];
  for (let i = 0; i < 40; i++) {
    const orientation = { lon: r() * 360 - 180, lat: r() * 120 - 60, tilt: r() * 180 - 90 };
    cases.push([worlds[i % worlds.length]!, orientation, i % 2 ? 'albers' : 'lambert-conformal']);
  }
  for (const [world, orientation, conic] of cases) {
    const label = `${world} ${JSON.stringify(orientation)} to ${conic}`;
    const members = clicks(orientation, [world, conic]);
    const pieces = cutGeometry(sphere, members);
    expect(seamJumps(pieces, members), label).toEqual([]);
    const alone = planarArea(cutGeometry(sphere, members.slice(0, 1)), members, 0);
    expect(Math.abs(planarArea(pieces, members, 0) / alone - 1), label).toBeLessThan(0.01);
  }
}, 30_000);

test('seams close together or crossing shallowly stay on their own sides', () => {
  const at = (lon: number, lat = 0, tilt = 0) => ({ lon, lat, tilt });
  const sets: [string, CompiledProjection[]][] = [];
  for (const eps of [5e-5, 1e-4, 1.5e-4, -1e-4]) {
    sets.push([`mercator ${eps} from a conic's seam`, [member('mercator', at(10 + eps)), member('albers')]]);
    sets.push([`robinson ${eps} from a conic's seam`, [member('robinson', at(10 + eps)), member('lambert-conformal')]]);
    sets.push([`mercators ${eps} apart`, [member('mercator', at(10)), member('mercator', at(10 + eps))]]);
  }
  for (const [label, members] of sets) {
    for (const geom of [sphere, land, graticule]) expect(seamJumps(cutGeometry(geom, members), members), label).toEqual([]);
  }
});

test('five independently oriented seams stay on their own sides', () => {
  // Crossing at a shallow angle, a later seam's pull could carry a point over an earlier seam.
  const r = rng(8675309);
  const worlds = ['mercator', 'equirectangular', 'gall-peters', 'robinson', 'mollweide', 'hammer', 'winkel-tripel', 'behrmann', 'goode', 'transverse-mercator'];
  const orientation = () => ({ lon: r() * 360 - 180, lat: r() * 120 - 60, tilt: r() * 180 - 90 });
  const world = () => worlds[Math.floor(r() * worlds.length)]!;
  for (let i = 0; i < 50; i++) {
    const ids = [world(), world(), world(), world(), i % 2 ? 'albers' : 'lambert-conformal'];
    const members = ids.map((id) => member(id, orientation()));
    const label = members.map((m) => `${m.def.id} ${JSON.stringify(m.state.orientation)}`).join(', ');
    expect(seamJumps(cutGeometry(sphere, members), members), label).toEqual([]);
  }
}, 30_000);

test('two Goodes whose lobe edges line up keep their lobes apart', () => {
  const at = (lon: number, lat = 0, tilt = 0) => ({ lon, lat, tilt });
  const sets = [
    [at(90), at(10)],
    [at(0, 90), at(-40, 0, 90)],
    [at(0, 45, 45), at(0)],
    [at(0, 45, 45), at(90)],
  ];
  for (const [a, b] of sets) {
    const members = [member('goode', a), member('goode', b)];
    const label = JSON.stringify([a, b]);
    const pieces = cutGeometry(sphere, members);
    members.forEach((_, i) => {
      const alone = planarArea(cutGeometry(sphere, [members[i]!]), [members[i]!], 0);
      expect(Math.abs(planarArea(pieces, members, i) / alone - 1), `${label} member ${i}`).toBeLessThan(0.01);
    });
  }
});

test('a graticule line along the central meridian of a clip stays on its side of the cap', () => {
  // At lon -112.7 the meridian -150 runs at frame lon -37.3, which was the first clip spin.
  // Plain regression: any spin has such a longitude, so the spins are not round numbers.
  const conic = member('lambert-conformal', { lon: -112.7, lat: 0, tilt: 0 });
  const [, far] = conic.caps;
  for (const piece of cutGeometry(graticule, [conic])) {
    if (!piece.inside[0]) continue;
    for (const p of piece.coords.flat()) {
      expect(geoDistance(conic.toFrame(p), far!.frameCenter) / rad).toBeGreaterThan(far!.radius - 0.01);
    }
  }
});

test('a graticule line along a seam through a pole stays in the caps it is flagged in', () => {
  // The equator lies on Transverse Mercator's seam from its pole at [90, 0] onward.
  const ids = ['orthographic', 'transverse-mercator', 'albers', 'mollweide', 'lambert-azimuthal'];
  const members = ids.map((id) => member(id));
  const orthographic = members[0]!;
  const cap = orthographic.caps[0]!;
  for (const piece of cutGeometry(graticule, members)) {
    if (piece.inside[0]) continue;
    for (const p of piece.coords.flat()) {
      expect(geoDistance(orthographic.toFrame(p), cap.frameCenter) / rad).toBeLessThan(cap.radius + 0.01);
    }
  }
});

test('a Goode and a world map one degree apart in tilt keep their ocean', () => {
  // They share a centre and so an antipode, where the world map's seam meets the corners of the lobes.
  const r = rng(99);
  const at = (lon: number, lat = 0, tilt = 0) => ({ lon, lat, tilt });
  const sets: CompiledProjection[][] = [
    [member('goode', at(0, 0, 1)), member('mercator')],
    [member('goode', at(0, 0, 1)), member('robinson')],
    [member('goode', at(0, 0, 1)), member('hammer'), member('mollweide')],
  ];
  for (let i = 0; i < 6; i++) {
    const [lon, lat, tilt] = [Math.round(r() * 36000 - 18000) / 100, Math.round(r() * 12000 - 6000) / 100, Math.round(r() * 18000 - 9000) / 100];
    sets.push([member('goode', at(lon, lat, tilt)), member(i % 2 ? 'mercator' : 'robinson', at(lon, lat, tilt - 1))]);
  }
  for (const members of sets) {
    const label = members.map((m) => `${m.def.id} ${JSON.stringify(m.state.orientation)}`).join(', ');
    const pieces = cutGeometry(sphere, members);
    expectWholeSphere(pieces, label);
    expectLandArea(cutGeometry(land, members), label);
    members.forEach((m, i) => {
      const alone = planarArea(cutGeometry(sphere, [m]), [m], 0);
      expect(Math.abs(planarArea(pieces, members, i) / alone - 1), `${label}, member ${i}`).toBeLessThan(0.01);
    });
  }
});

/** Land and the whole sphere come through a member set with the right area and no step across a seam. */
function expectCleanCut(members: CompiledProjection[]) {
  const label = members.map((m) => `${m.def.id} ${JSON.stringify(m.state.orientation)}`).join(', ');
  const [landPieces, spherePieces] = [cutGeometry(land, members), cutGeometry(sphere, members)];
  expect(seamJumps(landPieces, members), `land: ${label}`).toEqual([]);
  expect(seamJumps(spherePieces, members), `sphere: ${label}`).toEqual([]);
  expectLandArea(landPieces, label);
  expectWholeSphere(spherePieces, label);
}

test('near-aligned tilted members stay clean: sets that once failed every attempt', () => {
  const set = (a: string, b: string, lon: number, lat: number, tilt: number, lon2: number, lat2: number, tilt2: number) => [
    member(a, { lon, lat, tilt }),
    member(b, { lon: lon2, lat: lat2, tilt: tilt2 }),
  ];
  const sets = [
    set('mollweide', 'sinusoidal', -39.95, -49.41, -16.79, -39.95, -49.41, -16.78),
    set('mollweide', 'sinusoidal', 111.28, 52.69, -58.8, 111.28, 52.69, -58.79),
    set('mollweide', 'sinusoidal', 32.52, 53.24, -89.59, 32.52, 53.239, -89.59),
    set('mollweide', 'sinusoidal', -137.66, 26.34, -19.95, -137.66, 26.34, -19.949),
    set('equal-earth', 'winkel-tripel', -80.47, -50.2, 88.42, -80.47, -50.201, 88.42),
    set('equal-earth', 'winkel-tripel', 95.57, -59.87, 3.55, 95.47, -59.87, 3.55),
    set('hammer', 'equirectangular', -63.03, 59.42, 3.31, -63.05, 59.42, 3.31),
    set('mercator', 'robinson', 171.1, 59.53, 16.68, 171.09, 59.53, 16.68),
    set('mercator', 'robinson', 121.72, -53.44, 42.65, 121.77, -53.44, 42.65),
    set('goode', 'mercator', -86.47, -5.06, -88.3, -86.471, -5.06, -88.3),
  ];
  for (const members of sets) expectCleanCut(members);
});

test('near-aligned tilted members stay clean, seeded across separations', () => {
  const r = rng(4711);
  const pairs = [['mercator', 'robinson'], ['hammer', 'equirectangular'], ['equal-earth', 'winkel-tripel'], ['mollweide', 'sinusoidal'], ['goode', 'mercator']];
  const round = (x: number) => Math.round(x * 100) / 100;
  for (const separation of [0.001, 0.01, 0.05, 0.2]) {
    for (let i = 0; i < 10; i++) {
      const shift = separation * (i % 2 ? 1 : -1);
      const a = { lon: round(r() * 360 - 180), lat: round(r() * 120 - 60), tilt: round(r() * 180 - 90) };
      const b = { lon: a.lon + (i % 3 === 0 ? shift : 0), lat: a.lat + (i % 3 === 1 ? shift : 0), tilt: a.tilt + (i % 3 === 2 ? shift : 0) };
      const [first, second] = pairs[i % pairs.length]!;
      expectCleanCut([member(first!, a), member(second!, b)]);
    }
  }
}, 30_000);

test('no front segment is a long chord round a small cap, at random orientations', () => {
  const r = rng(55);
  const limit = 0.25 * Math.hypot(VIEWPORT.width, VIEWPORT.height);
  for (const s of stops) {
    for (let i = 0; i < 5; i++) {
      const m = member(s.id, { lon: r() * 360 - 180, lat: r() * 170 - 85, tilt: s.id === 'transverse-mercator' ? 90 : 0 });
      const screen = computeScreen(m, VIEWPORT);
      for (const geom of [land, graticule]) {
        for (const piece of cutGeometry(geom, [m])) {
          if (!isFront(piece, 0)) continue;
          for (const path of piece.coords) {
            const points = path.map((p) => projectPoint(m, screen, p, piece.lobes[0]));
            let longest = 0;
            for (let k = 1; k < points.length; k++) {
              longest = Math.max(longest, Math.hypot(points[k]![0] - points[k - 1]![0], points[k]![1] - points[k - 1]![1]));
            }
            if (longest >= limit) expect.fail(`${s.id} ${JSON.stringify(m.state.orientation)}: ${longest} px near ${path[0]}`);
          }
        }
      }
    }
  }
}, 60_000);

test('invariant: land stays whole on the two sets that once left a sliver near Wrangel Island', () => {
  // Land-110m has an edge on the meridian ±180 there. Plain invariant.
  const sets = [
    clicks({ lon: 115, lat: -10, tilt: 45 }, ['globe', 'albers', 'robinson', 'goode', 'albers']),
    clicks({ lon: 55, lat: 65, tilt: 30 }, ['globe', 'albers', 'hammer', 'lambert-azimuthal', 'goode']),
  ];
  for (const members of sets) expectLandArea(cutGeometry(land, members), members.map((m) => m.def.id).join(', '));
});

test('a ring reading within 1e-9 of 4π is dropped', () => {
  // A tiny triangle wound the wrong way round reads as nearly the whole sphere, on the way in and out.
  const size = 1e-4; // degrees: about 1.5e-12 sr
  const inverted = {
    type: 'Polygon',
    coordinates: [[[20, 30], [20 + size, 30], [20, 30 + size], [20, 30]]],
  } as GeoJSON.Polygon;
  expect(2 * TAU - geoArea(inverted)).toBeLessThan(1e-9);
  for (const ring of cutGeometry(inverted, [member('mercator')]).flatMap((p) => p.coords)) expect(2 * TAU - geoArea({ type: 'Polygon', coordinates: [ring] })).toBeGreaterThan(1e-9);
});

test('a repeated Goode does not change how the next one is cut', () => {
  const a = member('goode');
  const b = member('goode', { lon: 40, lat: 0, tilt: 0 });
  expect(cutGeometry(sphere, [a, a, b]).map((p) => p.coords)).toEqual(cutGeometry(sphere, [a, b]).map((p) => p.coords));
});

test('flags and lobes describe where each piece lies, for rotated member sets', () => {
  const r = rng(4242);
  const TOLERANCE = 0.01; // degrees
  const ids = stops.map((s) => s.id);
  const orientation = () => ({ lon: r() * 360 - 180, lat: r() * 170 - 85, tilt: r() * 180 - 90 });
  for (let n = 0; n < 24; n++) {
    const chain = ['globe', ...Array.from({ length: 1 + (n % 4) }, () => ids[Math.floor(r() * ids.length)]!)];
    const members = n % 3 ? clicks(orientation(), chain) : chain.map((id) => member(id, orientation()));
    for (const geom of [land, sphere, graticule]) {
      for (const piece of cutGeometry(geom, members)) {
        members.forEach((m, i) => {
          const label = `${chain} member ${i} ${m.def.id} ${JSON.stringify(m.state.orientation)}`;
          const frame = piece.coords.flat().map((p) => m.toFrame(p));
          const within = (radius: number, centre: LonLat) =>
            frame.every((f) => geoDistance(f, centre) / rad <= radius + TOLERANCE);
          const beyond = (radius: number, centre: LonLat) =>
            frame.every((f) => geoDistance(f, centre) / rad >= radius - TOLERANCE);
          const inMode = (mode: string) => m.caps.filter((c) => c.mode === mode);
          if (piece.inside[i]) {
            for (const c of inMode('clip')) expect(beyond(c.radius, c.frameCenter), `inside ${label}`).toBe(true);
          } else {
            expect(inMode('clip').some((c) => within(c.radius, c.frameCenter)), `outside ${label}`).toBe(true);
          }
          if (piece.behind[i]) {
            expect(inMode('behind').some((c) => within(c.radius, c.frameCenter)), `behind ${label}`).toBe(true);
          } else {
            for (const c of inMode('behind')) expect(beyond(c.radius, c.frameCenter), `front ${label}`).toBe(true);
          }
          const seam = m.def.seam;
          if (seam.kind !== 'lobes') {
            expect(piece.lobes[i], label).toBeUndefined();
            return;
          }
          // A lobe may be in more than one rectangle, with no seam between them; a piece lies within one of them.
          const rectangles = seam.lobes.filter((l) => l.id === piece.lobes[i]);
          expect(rectangles.length, label).toBeGreaterThan(0);
          const escapesFrom = (lobe: (typeof rectangles)[number]) =>
            frame.filter(
              ([lon, lat]) =>
                lat < lobe.latMin - TOLERANCE ||
                lat > lobe.latMax + TOLERANCE ||
                // Longitude means nothing right at a pole.
                (Math.abs(lat) <= 89.9 && (lon < lobe.lonMin - TOLERANCE || lon > lobe.lonMax + TOLERANCE)),
            );
          const escapes = rectangles.map(escapesFrom).sort((x, y) => x.length - y.length)[0]!;
          expect(escapes, label).toEqual([]);
        });
      }
    }
  }
}, 60_000);
