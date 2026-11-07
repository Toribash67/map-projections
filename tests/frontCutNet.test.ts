import { beforeEach, expect, test, vi } from 'vitest';
import type { GeoStream } from 'd3-geo';
import { geoCircle } from 'd3-geo';
import { buildScene, type ScenePiece } from '../src/morph/scene';
import type { Member } from '../src/tissot/indicatrix';
import { stops } from '../src/projections/catalog';
import { filledArea, land, member, randomOrientation, rng, VIEW } from './sceneSupport';

/**
 * The clips here have no fault left that can be reached on demand, so one is made: the next clip
 * called goes wrong in the way asked, and every later one, as in the long way round, goes right.
 */
const fault: { next: 'double' | 'reverse' | 'swallow' | null; used: number } = { next: null, used: 0 };

function faulty(sink: GeoStream, kind: 'double' | 'reverse' | 'swallow'): GeoStream {
  let rings: [number, number][][] = [];
  let ring: [number, number][] = [];
  let depth = 0;
  const flush = (points: [number, number][]) => {
    sink.lineStart();
    for (const [x, y] of points) sink.point(x, y);
    sink.lineEnd();
  };
  return {
    point: (x, y) => void ring.push([x, y]),
    lineStart: () => void (ring = []),
    lineEnd: () => void rings.push(ring),
    polygonStart: () => void depth++,
    polygonEnd() {
      if (--depth > 0) return;
      sink.polygonStart();
      if (kind !== 'swallow') {
        for (const r of rings) {
          flush(kind === 'reverse' ? [...r].reverse() : r);
          if (kind === 'double') flush(r);
        }
      }
      sink.polygonEnd();
      rings = [];
    },
    sphere: () => sink.sphere?.(),
  };
}

/** How many polygons have been cut the long way. */
const longCuts = { count: 0 };

vi.mock('../src/geo/cut', async (original) => {
  const real = await original<typeof import('../src/geo/cut')>();
  return {
    ...real,
    cutGeometry: (...args: Parameters<typeof real.cutGeometry>) => {
      longCuts.count++;
      return real.cutGeometry(...args);
    },
  };
});

vi.mock('d3-geo', async (original) => {
  const real = await original<typeof import('d3-geo')>();
  const wrap = (clip: (sink: GeoStream) => GeoStream) => (sink: GeoStream) => {
    if (!fault.next) return clip(sink);
    const kind = fault.next;
    fault.next = null;
    fault.used++;
    return clip(faulty(sink, kind));
  };
  return {
    ...real,
    geoClipAntimeridian: wrap(real.geoClipAntimeridian as unknown as (sink: GeoStream) => GeoStream),
    geoClipCircle: (radius: number) => wrap(real.geoClipCircle(radius) as unknown as (sink: GeoStream) => GeoStream),
    geoClipRectangle: (x0: number, y0: number, x1: number, y1: number) => wrap(real.geoClipRectangle(x0, y0, x1, y1)),
  };
});

beforeEach(() => {
  fault.next = null;
  fault.used = 0;
});

/** A disc that one kind of map has to clip. */
const disc = (lon: number, lat: number, radius: number) => geoCircle().center([lon, lat]).radius(radius)() as GeoJSON.GeoJsonObject;

const front = (pieces: ScenePiece[]) => pieces.filter((p) => p.alphaDst > 0 && !p.behind);

const cases: [string, Member, GeoJSON.GeoJsonObject][] = [
  ["a world map's seam", member('mollweide'), disc(178, 10, 15)],
  ["a world map's pole cap", member('mercator'), disc(30, 85, 15)],
  ["Goode's lobes", member('goode'), disc(-40, 20, 25)],
  ["a gnomonic map's circle", member('gnomonic'), disc(60, 10, 20)],
  ["a globe's limb", member('globe'), disc(85, 0, 20)],
  ['the rim of an azimuthal map, nearly the whole sphere round', member('lambert-azimuthal'), disc(179, 1, 8)],
];

test.each(cases)('a clip gone wrong at %s is caught, and the polygon cut the long way', (name, m, shape) => {
  const right = Math.abs(filledArea(front(buildScene({ shape }, [m], m, false).layers.shape!), (p) => p.dst));
  expect(right, name).toBeGreaterThan(10);
  for (const kind of ['double', 'reverse', 'swallow'] as const) {
    fault.next = kind;
    fault.used = 0;
    const live = buildScene({ shape }, [m], null, false).layers.shape!;
    expect(fault.used, `${name}: the clip ran`).toBe(1);
    const area = Math.abs(filledArea(live, (p) => p.src));
    expect(Math.abs(area / right - 1), `${name}, ${kind}`).toBeLessThan(0.01);
  }
});

test('a polygon clear of every seam and cap goes through no clip, so there is nothing to check', () => {
  const m = member('mollweide');
  fault.next = 'swallow';
  const pieces = buildScene({ shape: disc(20, 10, 5) }, [m], null, false).layers.shape!;
  expect(fault.used).toBe(0);
  expect(Math.abs(filledArea(pieces, (p) => p.src))).toBeGreaterThan(0.001 * VIEW.width * VIEW.height);
});

test('correct clips are not mistaken for wrong ones: no land polygon is cut the long way, on any stop', () => {
  // A wrong alarm costs a frame its budget. A small island over a nearly whole-sphere map's antipode
  // is the hard case: the polygon is tiny, and what is left of it is the map's whole rim.
  const r = rng(31337);
  const counted: string[] = [];
  for (const s of stops) {
    for (let i = 0; i < 40; i++) {
      const orientation = randomOrientation(r);
      longCuts.count = 0;
      buildScene({ land }, [member(s.id, orientation)], null, false);
      if (longCuts.count > 0) counted.push(`${s.id} ${JSON.stringify(orientation)}: ${longCuts.count}`);
    }
  }
  expect(counted).toEqual([]);
}, 60_000);

test('nor over an island lying right on the antipode', () => {
  for (const id of ['azimuthal-equidistant', 'lambert-azimuthal']) {
    // Madagascar, the Falklands' neighbours and Borneo, each with the antipode inside it.
    for (const [lon, lat] of [[46.5, -19], [-59, -51.7], [114, 1]] as const) {
      longCuts.count = 0;
      buildScene({ land }, [member(id, { lon: lon + 180, lat: -lat })], null, false);
      expect(longCuts.count, `${id} antipode at ${lon},${lat}`).toBe(0);
    }
  }
});
