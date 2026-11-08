import { expect, test } from '@playwright/test';
import { getDef, stops } from '../src/projections/catalog';
import { installTissotHarness, tissotDifference, tissotSweep, tissotTiles, tissotTotal, type MapSpec } from './tissotHarness';
import { open } from './support';

// What Tissot adds to a frame is measured as the sum over pixels and channels of the change it makes, over 255: an ellipse's fill
// changes a pixel by about a third, its outline by more. See tissotHarness.ts.

// A change, tile by tile, between neighbouring steps of a sweep above this is narrowed down, halving the step, down to NARROWEST
// degrees, to find what is left of it. See `tissotSweep`.
const FLAG = 400;
const NARROWEST = 1e-4;
// What is left of a change after narrowing it down, pixel by pixel. An ellipse that moves or grows changes next to nothing over so
// short a step; one that appears or vanishes at once, or jumps across the map, is a thousand or more. A faint sliver of the map itself
// that the cut of a map at rest gains or loses under an ellipse can leave about a hundred.
const POP = 300;

// Centres a little off round numbers, as a hand would leave them, so no meridian sits exactly on a cap's edge or a lobe's.
const LON = 7.31;
const LAT = 23.37;

type Case = { spec: MapSpec; axis: 'lon' | 'lat' | 'tilt'; start: number; end: number; step: number };

function casesFor(id: string): Case[] {
  const stop = stops.find((s) => s.id === id)!;
  const def = getDef(stop.defId);
  const cases: Case[] = [{ spec: { id, orientation: { lat: 0 } }, axis: 'lon', start: -180.13, end: 180, step: 6 }];
  if (def.latEnabled) {
    cases.push({ spec: { id, orientation: { lat: LAT } }, axis: 'lon', start: -180.13, end: 180, step: 6 });
    cases.push({ spec: { id, orientation: { lon: LON } }, axis: 'lat', start: -89.13, end: 89.9, step: 5 });
  }
  if (def.tiltEnabled) cases.push({ spec: { id, orientation: { lon: LON, lat: LAT } }, axis: 'tilt', start: -90.13, end: 90, step: 6 });
  return cases;
}

const sweepAll = async (page: any, cases: Case[]) => {
  const pops: string[] = [];
  let samples = 0;
  for (const c of cases) {
    const r = await tissotSweep(page, c.spec, c.axis, c.start, c.end, c.step, FLAG, NARROWEST);
    samples += r.samples;
    if (r.change > POP) pops.push(`${JSON.stringify(c.spec)} ${c.axis} ${r.from.toFixed(4)} to ${r.to.toFixed(4)}: ${r.change.toFixed(0)} (over the coarse step ${r.coarse.toFixed(0)})`);
  }
  console.log(`${cases.length} sweeps, ${samples} frames`);
  return pops;
};

test.describe('Tissot at a map\'s boundaries: turning any map changes its ellipses gradually, with nothing appearing, vanishing or jumping at once', () => {
  test.describe.configure({ mode: 'parallel' });
  test.beforeEach(async ({ page }) => {
    await open(page);
    await installTissotHarness(page);
  });

  test('the cases the review found: Mercator\'s latitude 2 to 2.5, stereographic\'s longitude 14.9 to 15.1', async ({ page }) => {
    const pops = await sweepAll(page, [
      { spec: { id: 'mercator' }, axis: 'lat', start: 1.9, end: 2.6, step: 0.1 },
      { spec: { id: 'mercator' }, axis: 'lat', start: 27.5, end: 28.3, step: 0.1 },
      { spec: { id: 'stereographic' }, axis: 'lon', start: 14.8, end: 15.2, step: 0.1 },
      // The in-between viewpoint at x = 0.25, a quarter of the way from gnomonic to orthographic.
      { spec: { id: 'gnomonic', params: { x: 0.25 } }, axis: 'lon', start: -180.13, end: 180, step: 3 },
    ]);
    expect(pops).toEqual([]);
  });

  // Seven tests of three stops each, so that two workers share them.
  for (let group = 0; group < stops.length; group += 3) {
    const ids = stops.slice(group, group + 3).map((s) => s.id);
    test(`every stop, centre and tilt swept: ${ids.join(', ')}`, async ({ page }) => {
      test.setTimeout(240_000);
      const pops = await sweepAll(page, ids.flatMap(casesFor));
      expect(pops).toEqual([]);
    });
  }
});

test.describe('Tissot at a morph\'s ends', () => {
  test.beforeEach(async ({ page }) => {
    await open(page);
    await installTissotHarness(page);
  });

  test('gnomonic turned to (82, 0), to Mollweide and back: the first and last frames add what the map at rest adds', async ({ page }) => {
    const gnomonic: MapSpec = { id: 'gnomonic', orientation: { lon: 82, lat: 0 } };
    const mollweide: MapSpec = { id: 'mollweide', orientation: { lon: 82, lat: 0 } };
    const results: string[] = [];
    for (const [rest, frame] of [
      [[gnomonic, null, 1], [gnomonic, mollweide, 0]],
      [[mollweide, null, 1], [gnomonic, mollweide, 1]],
      [[mollweide, null, 1], [mollweide, gnomonic, 0]],
      [[gnomonic, null, 1], [mollweide, gnomonic, 1]],
      // A globe's near side ends at its limb, where the far side begins: the ellipses there are cut by the map's outline, not at the limb.
      [[{ id: 'mollweide' }, null, 1], [{ id: 'globe' }, { id: 'mollweide' }, 1]],
      [[{ id: 'mollweide', orientation: { lon: 82 } }, null, 1], [{ id: 'globe', orientation: { lon: 82 } }, mollweide, 1]],
    ] as [[MapSpec, MapSpec | null, number], [MapSpec, MapSpec | null, number]][]) {
      const [all, apart] = [await tissotTotal(page, ...rest), await tissotDifference(page, rest, frame)];
      results.push(`${rest[0].id} at rest against ${frame[0].id} to ${frame[1]!.id} at t = ${frame[2]}: ${apart.toFixed(0)} of ${all.toFixed(0)}`);
      // The cut of a morph and the cut of a map at rest are made differently, and agree to within a pixel along the outline.
      expect(apart, results.at(-1)).toBeLessThan(0.02 * all);
    }
    console.log(results.join('\n'));
  });
});

test.describe('Tissot at a seam', () => {
  test.beforeEach(async ({ page }) => {
    await open(page);
    await installTissotHarness(page);
  });

  test('Mollweide at rest: an ellipse on the seam shows its halves at both edges, the one a mirror of the other', async ({ page }) => {
    // Tiles are 100 pixels wide, so the outer column of tiles on each side holds the ellipses on the seam.
    const tiles = await tissotTiles(page, { id: 'mollweide' });
    const [columns, rows] = [10, 6];
    for (let row = 0; row < rows; row++) {
      const [left, right] = [tiles[row * columns]!, tiles[row * columns + columns - 1]!];
      expect(Math.abs(left - right), `row ${row}: left ${left.toFixed(0)}, right ${right.toFixed(0)}`).toBeLessThan(0.1 * Math.max(left, right) + 5);
    }
    // There is something at each edge to compare: the rows of ellipses at the equator and 30 degrees.
    expect(tiles[2 * columns + columns - 1]! + tiles[3 * columns + columns - 1]!).toBeGreaterThan(100);
  });
});
