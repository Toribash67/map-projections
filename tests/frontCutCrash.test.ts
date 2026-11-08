import { expect, test } from 'vitest';
import { COAST, GRATICULE, LAND } from '../src/data/land';
import { cutFront } from '../src/geo/frontCut';
import { buildScene } from '../src/morph/scene';
import { stops } from '../src/projections/catalog';
import { memberOf, member, ocean } from './sceneSupport';

// Every map with no seam: the globe and the azimuthals, with two viewpoints between gnomonic and stereographic and between stereographic
// and orthographic. At whole-degree centres, a graticule line or a coastline vertex can sit exactly on the rim of what the map shows.
const maps = [
  ...stops.filter((s) => s.family === 'globe' || s.family === 'azimuthal').map((s) => ({ label: s.id, at: (lon: number, lat: number) => member(s.id, { lon, lat }) })),
  ...[0.25, 0.75].map((x) => ({
    label: `perspective x ${x}`,
    at: (lon: number, lat: number) => {
      const base = member('gnomonic', { lon, lat });
      return memberOf({ ...base.compiled.state, params: { x } });
    },
  })),
];
const layers = { land: LAND, graticule: GRATICULE, ocean, coast: COAST };

const finite = (rings: [number, number][][]) => rings.every((ring) => ring.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)));

test('the live cut never throws or gives a number that is not finite, at any whole-degree centre of a map with no seam', () => {
  const failures: string[] = [];
  for (const map of maps) {
    for (const lat of [-80, -45, 0, 45, 80]) {
      for (let lon = -180; lon <= 180; lon++) {
        const m = map.at(lon, lat);
        for (const [name, geom] of Object.entries(layers)) {
          try {
            if (!cutFront(geom, m.compiled).every((piece) => finite(piece.rings))) failures.push(`${map.label} (${lon}, ${lat}) ${name}: not finite`);
          } catch (e) {
            failures.push(`${map.label} (${lon}, ${lat}) ${name}: ${(e as Error).message}`);
          }
        }
        try {
          const scene = buildScene(layers, [m], null, false);
          for (const pieces of Object.values(scene.layers)) for (const piece of pieces) if (!piece.src.every(Number.isFinite)) failures.push(`${map.label} (${lon}, ${lat}) scene: not finite`);
        } catch (e) {
          failures.push(`${map.label} (${lon}, ${lat}) scene: ${(e as Error).message}`);
        }
      }
    }
  }
  expect(failures.slice(0, 20), `${failures.length} failures`).toEqual([]);
}, 900_000);
