import type { Detail } from './detail';

/** A sea or an ocean, for its name: Natural Earth's own, how important it is (0 the most), and the water it is the name of. */
export type Sea = { name: string; rank: number; ocean: boolean; geometry: GeoJSON.MultiPolygon };

/** The water that is not the sea's own outline: rivers, lakes, the sea by depth, and the seas by name. */
export interface Water {
  rivers: GeoJSON.MultiLineString;
  lakes: GeoJSON.MultiPolygon;
  /** All that is deeper than each of `DEPTHS`, the shallowest first: each lies within the one before it. */
  depth: GeoJSON.MultiPolygon[];
  seas: Sea[];
}
export type WaterKind = keyof Water;

/** The depths the sea is shaded by, in metres. */
export const DEPTHS = [200, 2000, 4000, 6000] as const;

// Natural Earth, reduced by scripts/natural-earth.mjs. Each file is a chunk of its own, fetched when first asked for and never at
// start-up. Rivers and lakes are at the three scales of the coast; the depths are coarse for the map as it moves and fine for a close
// look and for print; the seas are the same at every scale, as only their names are shown.
const files: Record<string, () => Promise<{ default: unknown }>> = {
  'rivers-110m': () => import('./ne/rivers-110m.json'),
  'rivers-50m': () => import('./ne/rivers-50m.json'),
  'rivers-10m': () => import('./ne/rivers-10m.json'),
  'lakes-110m': () => import('./ne/lakes-110m.json'),
  'lakes-50m': () => import('./ne/lakes-50m.json'),
  'lakes-10m': () => import('./ne/lakes-10m.json'),
  'depth-coarse': () => import('./ne/depth-coarse.json'),
  'depth-fine': () => import('./ne/depth-fine.json'),
  seas: () => import('./ne/seas.json'),
};

const fileOf = (kind: WaterKind, level: Detail): string => (kind === 'seas' ? 'seas' : kind === 'depth' ? (level === '110m' ? 'depth-coarse' : 'depth-fine') : `${kind}-${level}`);

const asked = new Map<string, Promise<unknown>>();
const arrived = new Map<string, unknown>();

/** Some of the water at a level of detail. Each file is fetched once, and gives the same objects every time, as the cuts keep what they prepare by object. */
export function loadWater<K extends WaterKind>(kind: K, level: Detail): Promise<Water[K]> {
  const file = fileOf(kind, level);
  let data = asked.get(file);
  if (!data) {
    data = files[file]!().then((module) => {
      arrived.set(file, module.default);
      return module.default;
    });
    asked.set(file, data);
    // A fetch that failed is not kept: the next asking tries again.
    data.catch(() => asked.delete(file));
  }
  return data as Promise<Water[K]>;
}

/** What has been fetched already, or null. */
export function waterNow<K extends WaterKind>(kind: K, level: Detail): Water[K] | null {
  return (arrived.get(fileOf(kind, level)) as Water[K] | undefined) ?? null;
}

const edges = new WeakMap<GeoJSON.MultiPolygon, GeoJSON.MultiLineString>();

/** The shores of some lakes as lines, which are stroked where the lakes themselves are filled. The same object for the same lakes. */
export function lakeEdgesOf(lakes: GeoJSON.MultiPolygon): GeoJSON.MultiLineString {
  let lines = edges.get(lakes);
  if (!lines) {
    lines = { type: 'MultiLineString', coordinates: lakes.coordinates.flat() };
    edges.set(lakes, lines);
  }
  return lines;
}
