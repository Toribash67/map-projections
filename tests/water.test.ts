import { geoArea } from 'd3-geo';
import { describe, expect, test } from 'vitest';
import { DEPTHS, lakeEdgesOf, loadWater, waterNow } from '../src/data/water';

const SCALES = ['110m', '50m', '10m'] as const;
// Each file as its text, to weigh it.
const texts = import.meta.glob('../src/data/ne/*.json', { query: '?raw', import: 'default' }) as Record<string, () => Promise<string>>;
const kB = async (name: string) => (await texts[`../src/data/ne/${name}.json`]!()).length / 1024;
const areaOf = (polygon: GeoJSON.Position[][]) => geoArea({ type: 'Polygon', coordinates: polygon });

describe('the water of Natural Earth', () => {
  test('nothing is there until it is asked for, and then the same thing every time', async () => {
    expect(waterNow('rivers', '50m')).toBeNull();
    const rivers = await loadWater('rivers', '50m');
    expect(await loadWater('rivers', '50m')).toBe(rivers);
    expect(waterNow('rivers', '50m')).toBe(rivers);
  });

  test.each(SCALES)('at %s the rivers are lines and the lakes polygons, each lake wound as the cut reads it', async (scale) => {
    const rivers = await loadWater('rivers', scale);
    expect(rivers.type).toBe('MultiLineString');
    expect(rivers.coordinates.length).toBeGreaterThan(10);
    const lakes = await loadWater('lakes', scale);
    expect(lakes.type).toBe('MultiPolygon');
    expect(lakes.coordinates.length).toBeGreaterThan(10);
    // Wound the other way a lake would be all the Earth but the lake.
    for (const lake of lakes.coordinates) expect(areaOf(lake)).toBeLessThan(0.1);
  });

  test('the edges of the lakes are their rings as lines, the same object for the same lakes', async () => {
    const lakes = await loadWater('lakes', '110m');
    const edges = lakeEdgesOf(lakes);
    expect(edges.type).toBe('MultiLineString');
    expect(edges.coordinates).toHaveLength(lakes.coordinates.reduce((sum, lake) => sum + lake.length, 0));
    expect(lakeEdgesOf(lakes)).toBe(edges);
  });

  test.each(['110m', '50m'] as const)('the depths at %s are four steps, each within the last and wound as the cut reads it', async (scale) => {
    const depth = await loadWater('depth', scale);
    expect(depth).toHaveLength(DEPTHS.length);
    const areas = depth.map((step) => step.coordinates.reduce((sum, polygon) => sum + areaOf(polygon), 0));
    // The sea is seven tenths of the Earth, whose whole is 4 pi: what is deeper than 200 m is most of that, and no more.
    expect(areas[0]).toBeGreaterThan(0.5 * 4 * Math.PI);
    expect(areas[0]).toBeLessThan(0.72 * 4 * Math.PI);
    for (let i = 1; i < areas.length; i++) expect(areas[i]).toBeLessThan(areas[i - 1]!);
    expect(areas[3]).toBeGreaterThan(0);
  });

  test('the fine depths serve both finer scales, and the coarse are fewer points', async () => {
    expect(await loadWater('depth', '10m')).toBe(await loadWater('depth', '50m'));
    const points = (steps: GeoJSON.MultiPolygon[]) => steps.reduce((sum, step) => sum + step.coordinates.reduce((n, polygon) => n + polygon.reduce((k, ring) => k + ring.length, 0), 0), 0);
    expect(points(await loadWater('depth', '110m'))).toBeLessThan(points(await loadWater('depth', '50m')) / 3);
  });

  test('no edge is so long that a great arc would stray from it', async () => {
    for (const step of await loadWater('depth', '110m')) {
      for (const polygon of step.coordinates) {
        for (const ring of polygon) {
          for (let i = 1; i < ring.length; i++) {
            expect(Math.abs(ring[i]![0]! - ring[i - 1]![0]!)).toBeLessThanOrEqual(4.001);
            expect(Math.abs(ring[i]![1]! - ring[i - 1]![1]!)).toBeLessThanOrEqual(4.001);
          }
        }
      }
    }
  });

  test('the seas have the oceans first, and every one a name and a shape', async () => {
    const seas = await loadWater('seas', '110m');
    expect(await loadWater('seas', '10m')).toBe(seas);
    const oceans = seas.filter((sea) => sea.ocean).map((sea) => sea.name.toLowerCase());
    for (const ocean of ['arctic', 'indian', 'north atlantic', 'south pacific', 'southern']) expect(oceans.some((name) => name.includes(ocean)), ocean).toBe(true);
    expect(seas[0]!.ocean).toBe(true);
    for (const sea of seas) {
      expect(sea.name.length).toBeGreaterThan(2);
      expect(sea.geometry.coordinates.length).toBeGreaterThan(0);
    }
  });

  test('the files are no heavier than was aimed for', async () => {
    expect(await kB('depth-coarse')).toBeLessThan(400);
    expect(await kB('depth-fine')).toBeLessThan(2048);
    for (const name of ['seas', ...SCALES.flatMap((scale) => [`rivers-${scale}`, `lakes-${scale}`])]) expect(await kB(name), name).toBeLessThan(1024);
  });
});
