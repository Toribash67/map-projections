import { describe, expect, test } from 'vitest';
import { geoCentroid, geoCircle, geoContains, geoDistance } from 'd3-geo';
import { buildScene, type ScenePiece } from '../src/morph/scene';
import { stops } from '../src/projections/catalog';
import { compile, stateForStop } from '../src/projections/compile';
import type { LonLat, Orientation } from '../src/projections/types';
import { computeScreen, isCovered, projectPoint } from '../src/screen/screen';
import type { Member } from '../src/tissot/indicatrix';
import {
  aloneRaster,
  cellsOf,
  difference,
  filledArea,
  filledAt,
  frameAt,
  graticule,
  land,
  line,
  lineCells,
  member,
  memberOf,
  ocean,
  pieceLength,
  pointAt,
  rad,
  randomOrientation,
  raster,
  rng,
  strayCells,
  VIEW,
  world,
} from './sceneSupport';


const front = (pieces: ScenePiece[]) => pieces.filter((p) => p.alphaDst > 0 && !p.behind);

/** Live and full-cut pieces of one shape on one map. */
function bothCuts(shape: GeoJSON.GeoJsonObject, m: Member) {
  return { live: buildScene({ shape }, [m], null, false).layers.shape!, full: front(buildScene({ shape }, [m], m, false).layers.shape!) };
}

/** The polygons of the land, each by itself. */
const landPolygons = (() => {
  const geometry = (land as unknown as GeoJSON.FeatureCollection).features[0]!.geometry as GeoJSON.MultiPolygon;
  return geometry.coordinates.map((coordinates): GeoJSON.Polygon => ({ type: 'Polygon', coordinates }));
})();

const seamless = stops.filter((s) => compile(stateForStop(s)).def.seam.kind === 'none').map((s) => s.id);

/** A map centred so that `vertex` lies `distance` degrees from its centre, on the great circle through `towards`. */
function centredFrom(vertex: LonLat, towards: LonLat, distance: number): LonLat {
  const unit = ([lon, lat]: LonLat) => [Math.cos(lat * rad) * Math.cos(lon * rad), Math.cos(lat * rad) * Math.sin(lon * rad), Math.sin(lat * rad)];
  const [a, b] = [unit(vertex), unit(towards)];
  const along = a.reduce((sum, v, i) => sum + v * b[i]!, 0);
  const side = b.map((v, i) => v - along * a[i]!);
  const length = Math.hypot(...side);
  const q = a.map((v, i) => v * Math.cos(distance * rad) + (side[i]! / length) * Math.sin(distance * rad));
  return [Math.atan2(q[1]!, q[0]!) / rad, Math.asin(q[2]!) / rad];
}

describe('a ring with a vertex by the rim of a seamless map', () => {
  test('the gnomonic frame that came out as the whole map', () => {
    const m = member('gnomonic', { lon: -162.6805741018034, lat: 22.904225907125475 });
    const { live, full } = bothCuts(land, m);
    expect(Math.abs(filledArea(live, (p) => p.src) / filledArea(full, (p) => p.dst) - 1)).toBeLessThan(0.01);
  });

  test.each(seamless)('%s: islands stay islands, with the farthest vertex just either side of the rim', (id) => {
    const base = member(id);
    const visible = 180 - base.compiled.caps[0]!.radius;
    const islands = landPolygons.filter((p) => p.coordinates[0]!.length < 60).filter((_, i) => i % 9 === 0);
    expect(islands.length).toBeGreaterThan(8);
    for (const island of islands) {
      const centroid = geoCentroid(island) as LonLat;
      const ring = island.coordinates[0] as LonLat[];
      const vertex = ring.reduce((best, p) => (geoDistance(p, centroid) > geoDistance(best, centroid) ? p : best));
      for (const delta of [0, 1e-11, -1e-11, 1e-9, -1e-9, 1e-7, -1e-7, 1e-6, -1e-6, 1e-5, -1e-5, 1e-4, -1e-4, 3e-4, -3e-4]) {
        const [lon, lat] = centredFrom(vertex, centroid, visible + delta);
        const compiled = compile({ ...base.compiled.state, orientation: { lon, lat, tilt: 0 } });
        const m: Member = { compiled, screen: base.screen, weight: 1 };
        const label = `${id} vertex ${vertex} delta ${delta}`;
        const { live, full } = bothCuts(island, m);
        const area = Math.abs(filledArea(live, (p) => p.src));
        const expected = Math.abs(filledArea(full, (p) => p.dst));
        expect(Math.abs(area - expected), label).toBeLessThan(0.01 * VIEW.width * VIEW.height);
        // The map's centre is on the far side of the rim from the island's own far vertex, and clear of it.
        const [x, y] = projectPoint(compiled, m.screen, [lon, lat]);
        if (!geoContains(island, [lon, lat])) expect(filledAt(live, (p) => p.src, x, y), label).toBe(false);
      }
    }
  });
});

describe('a ring with a vertex by a seam of a world map', () => {
  test.each(['mollweide', 'mercator', 'goode', 'albers'])('%s: islands stay islands', (id) => {
    const base = member(id);
    const islands = landPolygons.filter((p) => p.coordinates[0]!.length < 60).filter((_, i) => i % 9 === 0);
    const liveAt = (island: GeoJSON.Polygon, lon: number) => {
      const compiled = compile({ ...base.compiled.state, orientation: { lon, lat: 0, tilt: 0 } });
      return Math.abs(filledArea(buildScene({ island }, [{ compiled, screen: base.screen, weight: 1 }], null, false).layers.island!, (p) => p.src));
    };
    for (const island of islands) {
      const centroid = geoCentroid(island) as LonLat;
      const ring = island.coordinates[0] as LonLat[];
      const vertex = ring.reduce((best, p) => (geoDistance(p, centroid) > geoDistance(best, centroid) ? p : best));
      // Turned so that the vertex lies that far from the frame's antimeridian. Compared with the
      // same island turned 0.01 degrees on, as the full cut has a band of its own on Goode.
      const reference = liveAt(island, vertex[0] - 180 + 0.01);
      for (const delta of [0, 1e-11, -1e-11, 1e-9, -1e-9, 1e-7, -1e-7, 1e-6, -1e-6, 1e-5, -1e-5, 1e-4, -1e-4]) {
        const area = liveAt(island, vertex[0] - 180 + delta);
        expect(Math.abs(area - reference), `${id} vertex ${vertex} delta ${delta}`).toBeLessThan(0.001 * VIEW.width * VIEW.height);
      }
    }
  });
});

describe('a hole', () => {
  /** A polygon covering everything except a small circle round `centre`. */
  const allBut = (centre: LonLat, radius: number) => geoCircle().center([centre[0] + 180, -centre[1]]).radius(180 - radius)() as GeoJSON.Polygon;
  /** A ring round the same hole, by reversing the small circle: d3 reads its inside as what lies to the right. */
  const reversed = (centre: LonLat, radius: number): GeoJSON.Polygon => {
    const circle = geoCircle().center(centre).radius(radius)() as GeoJSON.Polygon;
    return { type: 'Polygon', coordinates: [[...circle.coordinates[0]!].reverse()] };
  };

  const maps = ['goode', 'mercator', 'mollweide', 'albers', 'globe', 'gnomonic', 'lambert-azimuthal', 'stereographic'];

  test.each(maps)('%s: the centre of a hole stays empty, and far from it stays filled, as a full cut has it', (id) => {
    const r = rng(id.length * 131);
    const orientations: (Partial<Orientation> | undefined)[] = [undefined, randomOrientation(r), randomOrientation(r)];
    for (const orientation of orientations) {
      const m = member(id, orientation);
      for (let k = 0; k < 24; k++) {
        // Well inside the map, in the frame.
        const frame = frameAt(r() * 55, r() * 2 * Math.PI);
        const centre = m.compiled.fromFrame(frame);
        const radius = [3, 6, 10][k % 3]!;
        const away = m.compiled.fromFrame(frameAt(r() * 55, r() * 2 * Math.PI));
        if (geoDistance(centre, away) / rad < radius + 2) continue;
        const [hx, hy] = projectPoint(m.compiled, m.screen, centre);
        const [ax, ay] = projectPoint(m.compiled, m.screen, away);
        if (!isCovered(m.compiled, centre) || !isCovered(m.compiled, away)) continue;
        for (const shape of [allBut(centre, radius), reversed(centre, radius)]) {
          const label = `${id} ${JSON.stringify(orientation)} hole ${centre} radius ${radius}`;
          const { live, full } = bothCuts(shape, m);
          expect(filledAt(full, (p) => p.dst, hx, hy), `${label}, full`).toBe(false);
          expect(filledAt(live, (p) => p.src, hx, hy), `${label}, live`).toBe(false);
          expect(filledAt(live, (p) => p.src, ax, ay), `${label}, away`).toBe(filledAt(full, (p) => p.dst, ax, ay));
        }
      }
    }
  });
});

describe('a line lying exactly on a seam', () => {
  /** The cells a morph's end draws for the graticule, and the same for the settled map. */
  function expectEndsMatchSettled(a: Member, b: Member, label: string) {
    const morph = buildScene({ graticule }, [a], b, false).layers.graticule!;
    const settledA = lineCells(buildScene({ graticule }, [a], null, false).layers.graticule!, (p) => p.src);
    const settledB = lineCells(buildScene({ graticule }, [b], null, false).layers.graticule!, (p) => p.src);
    const long = (p: ScenePiece, at: Float32Array) => pieceLength([{ ...p, src: at }]) > 1;
    const atStart = morph.filter((p) => p.alphaSrc > 0 && !(p.behind && a.compiled.def.id === 'globe') && long(p, p.src));
    const atEnd = morph.filter((p) => p.alphaDst > 0 && !(p.behind && b.compiled.def.id === 'globe') && long(p, p.dst));
    const startCells = lineCells(atStart, (p) => p.src);
    const endCells = lineCells(atEnd, (p) => p.dst);
    expect(strayCells(startCells, settledA), `${label}, first frame`).toEqual([]);
    expect(strayCells(settledA, startCells), `${label}, settled source`).toEqual([]);
    expect(strayCells(endCells, settledB), `${label}, last frame`).toEqual([]);
    expect(strayCells(settledB, endCells), `${label}, settled target`).toEqual([]);
  }

  test('Robinson to Hammer: the ±180 meridian stays on one side from settled through the morph to settled', () => {
    const [a, b] = [member('robinson'), member('hammer')];
    const meridian: GeoJSON.LineString = line([-180, -80], [-180, 80]);
    const xRange = (pieces: ScenePiece[], at: (p: ScenePiece) => Float32Array) => {
      const xs = pieces.flatMap((p) => [...at(p)].filter((_, i) => i % 2 === 0));
      return [Math.min(...xs), Math.max(...xs)] as const;
    };
    const morph = buildScene({ meridian }, [a], b, false).layers.meridian!;
    const [sMin, sMax] = xRange(buildScene({ meridian }, [a], null, false).layers.meridian!, (p) => p.src);
    const [tMin, tMax] = xRange(buildScene({ meridian }, [b], null, false).layers.meridian!, (p) => p.src);
    const [fMin, fMax] = xRange(morph, (p) => p.src);
    const [lMin, lMax] = xRange(morph, (p) => p.dst);
    expect(sMax).toBeLessThan(VIEW.width / 2);
    expect(tMax).toBeLessThan(VIEW.width / 2);
    expect(Math.abs(fMin - sMin)).toBeLessThan(1);
    expect(Math.abs(fMax - sMax)).toBeLessThan(1);
    expect(Math.abs(lMin - tMin)).toBeLessThan(1);
    expect(Math.abs(lMax - tMax)).toBeLessThan(1);
  });

  test('first and last frames match the settled maps, for pairs of stops at their opening orientations', () => {
    for (const a of stops) {
      for (const offset of [1, 7, 13]) {
        const b = stops[(stops.indexOf(a) + offset) % stops.length]!;
        const from = stateForStop(a);
        expectEndsMatchSettled(memberOf(from), memberOf(stateForStop(b, from)), `${a.id} to ${b.id}`);
      }
    }
  }, 60_000);

  test('first and last frames match the settled maps, on the way to a conic from random orientations', () => {
    // A conic's own seam lies on the -170 meridian.
    const r = rng(404);
    for (let i = 0; i < 12; i++) {
      const a = stops[Math.floor(r() * stops.length)]!;
      const from = { ...stateForStop(a), orientation: randomOrientation(r) };
      const conic = stops.find((s) => s.id === (i % 2 ? 'albers' : 'lambert-conformal'))!;
      expectEndsMatchSettled(memberOf(from), memberOf(stateForStop(conic, from)), `${a.id} ${JSON.stringify(from.orientation)} to ${conic.id}`);
    }
  }, 30_000);
});

describe('drawn shapes in odd forms', () => {
  const a: LonLat = [10, 20];
  const b: LonLat = [30, 40];
  const nothing: [string, GeoJSON.GeoJsonObject][] = [
    ['a polygon with no rings', { type: 'Polygon', coordinates: [] } as GeoJSON.Polygon],
    ['a multipolygon with no rings', { type: 'MultiPolygon', coordinates: [[]] } as GeoJSON.MultiPolygon],
    ['a ring there and back', { type: 'Polygon', coordinates: [[a, b, a]] } as GeoJSON.Polygon],
    ['an empty line', line()],
    ['a line of one point', line(a)],
    ['a multiline of one point', { type: 'MultiLineString', coordinates: [[a]] } as GeoJSON.MultiLineString],
  ];
  test.each(['mercator', 'goode', 'gnomonic', 'globe'])('%s: neither cut draws what has nothing to draw', (id) => {
    const m = member(id);
    for (const [name, shape] of nothing) {
      const { live, full } = bothCuts(shape, m);
      expect(full, `${name}, full`).toEqual([]);
      expect(live, `${name}, live`).toEqual([]);
    }
  });

  test('a line there and back is still a line, in both cuts', () => {
    const m = member('mercator');
    const { live, full } = bothCuts(line(a, b, a), m);
    expect(full.length).toBeGreaterThan(0);
    expect(live.length).toBe(full.length);
  });
});

test('near the rim, land is the same picture as a full cut', () => {
  // Random orientations almost never land in the band where a vertex touches the rim, so these aim for it.
  const polygons = landPolygons.filter((_, i) => i % 7 === 0);
  const deltas = [1e-7, -1e-7, 2e-5, -2e-5, 1.5e-4];
  for (const id of seamless) {
    const base = member(id);
    const visible = 180 - base.compiled.caps[0]!.radius;
    polygons.forEach((polygon, i) => {
      const centroid = geoCentroid(polygon) as LonLat;
      const ring = polygon.coordinates[0] as LonLat[];
      const vertex = ring[i % ring.length]!;
      const [lon, lat] = centredFrom(vertex, centroid, visible + deltas[i % deltas.length]!);
      const compiled = compile({ ...base.compiled.state, orientation: { lon, lat, tilt: 0 } });
      const m: Member = { compiled, screen: base.screen, weight: 1 };
      const label = `${id} centre ${lon},${lat}`;
      const { live, full } = bothCuts(land, m);
      expect(Math.abs(filledArea(live, (p) => p.src) / filledArea(full, (p) => p.dst) - 1), label).toBeLessThan(0.01);
      // Centres of whole islands, wherever they are shown.
      for (const island of landPolygons.filter((_, n) => n % 11 === 0)) {
        const c = geoCentroid(island) as LonLat;
        if (!geoContains(island, c) || !isCovered(compiled, c)) continue;
        // Right by the rim of a Lambert map a degree is a hundredth of a pixel, too little to tell by.
        if (geoDistance(c, [lon, lat]) / rad > visible - 5) continue;
        const [x, y] = projectPoint(compiled, m.screen, c);
        expect(filledAt(live, (p) => p.src, x, y), `${label}, island at ${c}`).toBe(filledAt(full, (p) => p.dst, x, y));
      }
    });
  }
}, 60_000);

function expectSamePicture(m: Member, label: string) {
  const live = buildScene(world, [m], null, false);
  const morph = buildScene(world, [m], m, false);
  const front = (pieces: ScenePiece[]) => pieces.filter((p) => p.alphaDst > 0 && !p.behind);
  for (const name of ['land', 'ocean'] as const) {
    const a = raster(live.layers[name]!.map((piece) => ({ piece, positions: piece.src })));
    const b = raster(front(morph.layers[name]!).map((piece) => ({ piece, positions: piece.dst })));
    // Edge cells can differ by a hair where a cap's edge is pulled by a thousandth of a degree.
    expect(difference(a, b), `${label} ${name}`).toBeLessThanOrEqual(Math.max(6, 0.004 * Math.max(cellsOf(a), cellsOf(b))));
  }
  const liveLines = lineCells(live.layers.graticule!, (p) => p.src);
  const morphLines = lineCells(front(morph.layers.graticule!), (p) => p.dst);
  expect(strayCells(liveLines, morphLines), `${label} live graticule`).toEqual([]);
  expect(strayCells(morphLines, liveLines), `${label} morph graticule`).toEqual([]);
  const liveLength = pieceLength(live.layers.graticule!);
  const morphLength = pieceLength(front(morph.layers.graticule!).map((p) => ({ ...p, src: p.dst })));
  expect(Math.abs(liveLength / morphLength - 1), `${label} graticule length`).toBeLessThan(0.02);
}

test('a settled or dragged map is the same picture as the end of a morph, for every stop at its default orientation', () => {
  for (const s of stops) expectSamePicture(memberOf(stateForStop(s)), s.id);
}, 60_000);

test('a dragged map is the same picture as the end of a morph, at seeded random orientations', () => {
  const r = rng(77);
  const ids = ['globe', 'gnomonic', 'orthographic', 'stereographic', 'lambert-azimuthal', 'mercator', 'gall-peters', 'mollweide', 'robinson', 'goode', 'albers', 'lambert-conformal'];
  for (let i = 0; i < 48; i++) {
    const id = ids[i % ids.length]!;
    const o = randomOrientation(r);
    expectSamePicture(member(id, o), `${id} ${JSON.stringify(o)}`);
  }
}, 60_000);

test('a dragged map holds shapes that surround the pole, the seam or the whole map', () => {
  const circle = (lon: number, lat: number, radius: number) => geoCircle().center([lon, lat]).radius(radius)() as GeoJSON.GeoJsonObject;
  const shapes: [string, GeoJSON.GeoJsonObject][] = [
    ['small circle', circle(20, 30, 10)],
    ['circle round the north pole', circle(40, 80, 25)],
    ['circle round the south pole', circle(-40, -70, 40)],
    ['circle across the seam', circle(179, 10, 15)],
    ['hemisphere', circle(50, 10, 90)],
    ['nearly everything', circle(-130, -30, 170)],
    ['box', { type: 'Polygon', coordinates: [[[-20, -10], [-20, 20], [30, 20], [30, -10], [-20, -10]]] } as GeoJSON.Polygon],
  ];
  const r = rng(5);
  const maps: Member[] = [];
  for (const id of ['globe', 'gnomonic', 'lambert-azimuthal', 'mercator', 'mollweide', 'goode', 'albers']) {
    maps.push(member(id), member(id, randomOrientation(r)), member(id, randomOrientation(r)));
  }
  for (const m of maps) {
    for (const [name, shape] of shapes) {
      const label = `${m.compiled.def.id} ${JSON.stringify(m.compiled.state.orientation)} ${name}`;
      const live = raster(buildScene({ shape }, [m], null, false).layers.shape!.map((piece) => ({ piece, positions: piece.src })));
      const morph = aloneRaster(m, shape);
      expect(difference(live, morph), label).toBeLessThanOrEqual(Math.max(6, 0.01 * cellsOf(morph)));
    }
  }
}, 60_000);

test('where a dragged map cuts a shape at its circle, the cut follows the circle closely', () => {
  for (const [id, limit, lon] of [['gnomonic', 68, 100], ['stereographic', 165, 150]] as const) {
    const shape = geoCircle().center([lon, 0]).radius(60)() as GeoJSON.GeoJsonObject;
    const m = member(id);
    const centre = projectPoint(m.compiled, m.screen, [0, 0]);
    const rim = Math.hypot(...([0, 1] as const).map((k) => projectPoint(m.compiled, m.screen, frameAt(limit, Math.PI / 2))[k] - centre[k]));
    const live = buildScene({ shape }, [m], null, false).layers.shape!;
    let along = 0;
    for (const piece of live) {
      for (let i = 1; i < piece.src.length / 2; i++) {
        const [ax, ay] = pointAt(piece.src, i - 1).map((v, k) => v - centre[k]!) as [number, number];
        const [bx, by] = pointAt(piece.src, i).map((v, k) => v - centre[k]!) as [number, number];
        if (Math.abs(Math.hypot(ax, ay) - rim) > 0.5 || Math.abs(Math.hypot(bx, by) - rim) > 0.5) continue;
        along++;
        expect(Math.abs(Math.atan2(ax * by - bx * ay, ax * bx + ay * by)) / rad, id).toBeLessThan(2.3);
      }
    }
    expect(along, id).toBeGreaterThan(5);
  }
});

test('a dragged map holds lines along lobe edges, and close by or through the poles', () => {
  const lines: GeoJSON.LineString[] = [
    line([-100, -70], [-100, -5]),
    line([-170, 0], [170, 0]),
    line([30, 60], [30, 89], [-150, 89], [-150, 60]),
    line([0, 80], [170, 80]),
    line([0, 80], [180, 80]),
    line([180, -60], [180, 60]),
    line([0, 0], [20, 20], [40, 0]),
  ];
  for (const id of ['mercator', 'goode', 'mollweide', 'gnomonic', 'globe', 'albers']) {
    for (const m of [member(id), member(id, { lon: 33, lat: 27, tilt: 41 })]) {
      for (const shape of lines) {
        const label = `${id} ${JSON.stringify(m.compiled.state.orientation)} ${JSON.stringify(shape.coordinates)}`;
        const live = buildScene({ shape }, [m], null, false).layers.shape!;
        const morph = buildScene({ shape }, [m], m, false).layers.shape!.filter((p) => p.alphaDst > 0 && !p.behind);
        // A full cut can leave a line of no length on the far side of a seam the shape ends on.
        const a = lineCells(live, (p) => p.src);
        const b = lineCells(morph.filter((p) => pieceLength([{ ...p, src: p.dst }]) > 1), (p) => p.dst);
        expect(strayCells(a, b), `${label}, live`).toEqual([]);
        expect(strayCells(b, a), `${label}, morph`).toEqual([]);
      }
    }
  }
});

test('the same geometry object can be shown again after other maps', () => {
  const m = member('mollweide', { lon: 12 });
  const first = buildScene(world, [m], null, false);
  buildScene(world, [member('goode')], null, false);
  const again = buildScene(world, [m], null, false);
  for (const name of Object.keys(world)) {
    expect(again.layers[name]!.map((p) => [...p.src])).toEqual(first.layers[name]!.map((p) => [...p.src]));
  }
});
