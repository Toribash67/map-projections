import { geoOrthographic } from 'd3-geo';
import { expect, test } from 'vitest';
import { centreFor, MAX_STEP } from '../src/geo/grab';
import type { LonLat } from '../src/projections/types';

type Pair = [number, number];
const rad = Math.PI / 180;

/** Where the globe centred on `centre` shows `land`, as fractions of its radius with north up. */
const placeOf = (centre: LonLat, land: LonLat): Pair => {
  const p = geoOrthographic().rotate([-centre[0], -centre[1]]).scale(1).translate([0, 0])(land)!;
  return [p[0], -p[1]];
};
/** The land at a place on the globe centred on `centre`. */
const landAt = (centre: LonLat, [x, y]: Pair): LonLat => geoOrthographic().rotate([-centre[0], -centre[1]]).scale(1).translate([0, 0]).invert!([x, -y]) as LonLat;
/** The depth of `land` seen from `centre`: positive on the visible side. */
const depth = (centre: LonLat, land: LonLat): number =>
  Math.sin(centre[1] * rad) * Math.sin(land[1] * rad) + Math.cos(centre[1] * rad) * Math.cos(land[1] * rad) * Math.cos((land[0] - centre[0]) * rad);

const expectAt = (centre: LonLat | null, land: LonLat, place: Pair) => {
  expect(centre).not.toBeNull();
  const [x, y] = placeOf(centre!, land);
  expect(x).toBeCloseTo(place[0], 6);
  expect(y).toBeCloseTo(place[1], 6);
  expect(depth(centre!, land)).toBeGreaterThanOrEqual(-1e-9);
};

test('a centre that would put the land on the far side is not taken, though it is the nearer', () => {
  // Both (-58, 1) and (-58, -57) put the land at the place; seen from the second, the nearer, it is behind the globe. The first
  // is 41 degrees from here, too far for a step of the pointer, so the globe stays; from nearer it, it is the one taken.
  const land: LonLat = [0, 45];
  const place: Pair = [0.6, 0.7];
  expect(centreFor(land, place, [-58, -40], true)).toBeNull();
  expectAt(centreFor(land, place, [-58, -12], true), land, place);
});

test('no walk of the pointer near the rim lands the grabbed land on the far side', () => {
  let seed = 7;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  let moves = 0;
  for (let walk = 0; walk < 3000; walk++) {
    let centre: LonLat = [rnd() * 360 - 180, (rnd() * 2 - 1) * 80];
    const r0 = 0.85 + rnd() * 0.1;
    const t0 = rnd() * 2 * Math.PI;
    let place: Pair = [r0 * Math.cos(t0), r0 * Math.sin(t0)];
    const land = landAt(centre, place);
    for (let step = 0; step < 40; step++) {
      const next: Pair = [place[0] + (rnd() - 0.5) * 0.5, place[1] + (rnd() - 0.5) * 0.5];
      if (Math.hypot(...next) >= 1) continue;
      place = next;
      const c = centreFor(land, place, centre, true);
      if (!c) continue;
      moves++;
      expectAt(c, land, place);
      centre = c;
    }
  }
  expect(moves).toBeGreaterThan(10000);
});

test('land at the limb stays at the limb, and near the poles the centre is found', () => {
  const limb: LonLat = [90, 0];
  expectAt(centreFor(limb, [0.999, 0], [0, 0], true), limb, [0.999, 0]);
  const centre: LonLat = [10, 85];
  const place: Pair = [0.2, 0.1];
  const land = landAt(centre, place);
  const found = centreFor(land, place, centre, true)!;
  expect(found[0]).toBeCloseTo(10, 6);
  expect(found[1]).toBeCloseTo(85, 6);
  // At the pole itself, where longitude means nothing, a place on the middle line still works.
  expectAt(centreFor([0, 90], [0, 0.5], [0, 60], true), [0, 90], [0, 0.5]);
});

test('a place the land cannot be at gives null', () => {
  // Land at 80 degrees latitude cannot be half a radius to the side of the middle.
  expect(centreFor([0, 80], [0.5, 0], [0, 0], true)).toBeNull();
  // Nor can land on the equator be at the corner.
  expect(centreFor([0, 0], [0.9, 0.9], [0, 0], true)).toBeNull();
});

test('without latitude only the longitude is solved, and the latitude stays', () => {
  const land: LonLat = [30, 20];
  const c = centreFor(land, [0.3, 0.2], [5, 0], false)!;
  expect(c[1]).toBe(0);
  expect(Math.cos(land[1] * rad) * Math.sin((land[0] - c[0]) * rad)).toBeCloseTo(0.3, 6);
});

test('a drag across a pole never turns the globe by more than a small step at once, though no centre puts the land under the pointer', () => {
  // Pressing above the middle and dragging straight down, over the north pole (and the other way): from some centres the land cannot follow over the
  // pole with north kept up. The centre then stays where it was, rather than jumping to the far side of the pole, until the pointer
  // has come far enough that the land can follow from within a step. Before, it jumped 33 to 55 degrees at once.
  let moves = 0;
  for (const start of [50, 70, 80, 85]) {
    for (const [dx, down] of [0, 0.05, 0.2].flatMap((dx) => [[dx, 1], [dx, -1]] as const)) {
      let centre: LonLat = [0, start];
      const land = landAt(centre, [dx, 0.6 * down]);
      for (let i = 1; i <= 320; i++) {
        const place: Pair = [dx, (0.6 - (i * 1.5) / 320) * down];
        if (Math.hypot(...place) >= 1) break;
        const next = centreFor(land, place, centre, true);
        if (!next) continue;
        moves++;
        const hop = Math.acos(Math.min(1, depth(centre, [next[0], next[1]]))) / rad;
        expect(hop, `from latitude ${start}, ${dx} to the side, ${down > 0 ? 'down' : 'up'}, at ${place[1].toFixed(3)}`).toBeLessThanOrEqual(MAX_STEP);
        centre = next;
      }
    }
  }
  expect(moves).toBeGreaterThan(1000);
});

test('a centre far from the current one is not taken: there is no move of the pointer that small for which it is the answer', () => {
  const centre: LonLat = [10, 85];
  const place: Pair = [0.2, 0.1];
  const land = landAt(centre, place);
  expect(centreFor(land, place, [100, -20], true)).toBeNull();
});
