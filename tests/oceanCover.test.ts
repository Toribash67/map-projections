import { geoDistance } from 'd3-geo';
import { expect, test } from 'vitest';
import { capOceanLayer } from '../src/geo/capCells';
import { buildScene, type ScenePiece } from '../src/morph/scene';
import { stops } from '../src/projections/catalog';
import type { LonLat, Orientation } from '../src/projections/types';
import { isCovered, projectPoint } from '../src/screen/screen';
import type { Member } from '../src/tissot/indicatrix';
import { member, ocean, rad, rng } from './sceneSupport';

/** Whether a point lies in a piece's rings (even-odd), with the piece placed as at one end of the morph. */
function holds(piece: ScenePiece, positions: Float32Array, [x, y]: [number, number]): boolean {
  let inside = false;
  const count = positions.length / 2;
  piece.ringStarts.forEach((start, r) => {
    const end = piece.ringStarts[r + 1] ?? count;
    for (let i = start, j = end - 1; i < end; j = i++) {
      const [xi, yi, xj, yj] = [positions[2 * i]!, positions[2 * i + 1]!, positions[2 * j]!, positions[2 * j + 1]!];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  });
  return inside;
}

/** The orientations to try: the default, an oblique one, and one near a pole, where a map's small cap is at the middle of the sphere's view. */
const ORIENTATIONS: Partial<Orientation>[] = [{}, { lon: 70, lat: 45 }, { lon: -40, lat: 80 }];

/** Whether a point is within two degrees of the edge of a cap of either map. Where a map ends on a limb, two degrees is a tenth of a pixel, and a sliver of float error there is not a hole. */
const nearEdge = (maps: Member[], p: LonLat) =>
  maps.some(({ compiled }) => compiled.caps.some((cap) => Math.abs(geoDistance(compiled.toFrame(p), cap.frameCenter) / rad - cap.radius) < 2));

/** Points on the sphere: seeded at random, and a ring round each pole, where the small caps are. */
function spherePoints(): LonLat[] {
  const r = rng(77);
  const points: LonLat[] = [];
  for (let i = 0; i < 700; i++) points.push([r() * 360 - 180, Math.asin(2 * r() - 1) / rad]);
  for (const lat of [88.5, 87, 85.5, -88.5, -87, -85.5]) for (let lon = -180; lon < 180; lon += 36) points.push([lon + 7, lat]);
  return points;
}

// Where a morph draws ocean: the pieces that are not out of a cap with cells, which are filled by the cells instead.
// Every point that a map shows at one end has to be in one or the other.
test('morph ocean: every point a map shows at either end is in a kept ocean piece or a cell, for every ordered pair', () => {
  const points = spherePoints();
  const missing: string[] = [];
  let pair = 0;
  for (const from of stops) {
    for (const to of stops) {
      if (from.id === to.id) continue;
      const orientation = ORIENTATIONS[pair++ % ORIENTATIONS.length]!;
      const source: Member[] = [member(from.id, orientation)];
      const target = member(to.id, orientation);
      const cells = capOceanLayer([...source, target]);
      const scene = buildScene({ ocean, ...(cells ? { capOcean: cells } : {}) }, source, target, false);
      const kept = scene.layers.ocean!.filter((piece) => !(cells && piece.out));
      const covering = [...kept, ...(scene.layers.capOcean ?? [])];
      for (const [end, m] of [['src', source[0]!], ['dst', target]] as const) {
        for (const p of points) {
          if (!isCovered(m.compiled, p) || nearEdge([...source, target], p)) continue;
          const [x, y] = projectPoint(m.compiled, m.screen, p);
          // A point on the edge between two pieces may fall between them in float32, so a hair either way counts.
          const probes: [number, number][] = [[x, y], [x + 0.03, y], [x - 0.03, y], [x, y + 0.03], [x, y - 0.03]];
          const found = covering.some((piece) => probes.some((q) => holds(piece, end === 'src' ? piece.src : piece.dst, q)));
          if (!found) missing.push(`${from.id}>${to.id} ${end} at [${p.map((v) => v.toFixed(2))}]`);
        }
      }
    }
  }
  expect(missing.slice(0, 12), `${missing.length} uncovered`).toEqual([]);
}, 300_000);
