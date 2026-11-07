import { geoContains, geoDistance } from 'd3-geo';
import { expect, test } from 'vitest';
import { capCells } from '../src/geo/capCells';
import { stops } from '../src/projections/catalog';
import { compile, stateForStop } from '../src/projections/compile';

const compiledOf = (id: string) => compile(stateForStop(stops.find((s) => s.id === id)!));
const rad = Math.PI / 180;

test('capCells: a map with no cap, or only a small one at the poles, has none', () => {
  for (const id of ['robinson', 'mollweide', 'goode', 'mercator', 'equirectangular']) {
    expect(capCells(compiledOf(id), { behind: 10, clip: 15 }).geometries, id).toHaveLength(0);
  }
});

test('capCells: the cells of a gnomonic map cover its whole cap', () => {
  const c = compiledOf('gnomonic');
  const cap = c.caps[0]!;
  expect(cap.mode).toBe('clip');
  const cells = capCells(c, { behind: 10, clip: 15 }).geometries as GeoJSON.Polygon[];
  expect(cells.length).toBeGreaterThan(100);
  const holds = (p: [number, number]) => cells.some((cell) => geoContains({ type: 'Polygon', coordinates: cell.coordinates }, p));
  // Every sampled point in the cap lies in a cell.
  let sampled = 0;
  for (let lon = -176.5; lon < 180; lon += 7) {
    for (let lat = -86.5; lat <= 88; lat += 7) {
      const frame: [number, number] = [lon, lat];
      if (geoDistance(frame, cap.frameCenter) / rad < cap.radius - 0.5) {
        sampled++;
        expect(holds(c.fromFrame(frame)), `${lon}, ${lat}`).toBe(true);
      }
    }
  }
  expect(sampled).toBeGreaterThan(500);
});

test('capCells: a globe has the cells of its far hemisphere, as the grid of far cells did', () => {
  const c = compiledOf('globe');
  const cells = capCells(c, { behind: 10, clip: 15 }).geometries as GeoJSON.Polygon[];
  // 18 columns of 10 degrees from frame longitude 90 to 270, and 18 rows.
  expect(cells).toHaveLength(18 * 18);
});
