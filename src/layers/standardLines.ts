import { getDef } from '../projections/catalog';
import type { CompiledProjection, LonLat } from '../projections/types';

// Step (degrees of longitude) along a standard parallel. A parallel is not a great circle, so the steps are short.
const STEP = 2;
// The lines of the latest few maps are kept: a slider makes a new map each step, and a map at rest asks again each frame.
const KEPT = 8;

/** The latitudes (degrees, in the map's own frame) where its scale is true, or none. */
function standardLatitudes(c: CompiledProjection): number[] {
  const params = { ...c.def.defaultParams, ...c.state.params };
  if (c.def.family === 'conic') {
    const { p1, p2 } = params as { p1: number; p2: number };
    return p1 === p2 ? [p1] : [p1, p2];
  }
  if (c.def.id === 'cylindrical') return params.phi0 === 0 ? [0] : [params.phi0!, -params.phi0!];
  return [];
}

/** Whether the maps of a definition have standard lines to show. */
export const hasStandardLines = (defId: string): boolean => getDef(defId).family === 'conic' || defId === 'cylindrical';

const kept = new Map<string, GeoJSON.MultiLineString | null>();

/**
 * The parallels where a map's scale is true, as lines on the Earth: the two standard parallels of a conic, and for a cylindrical map
 * its standard parallel north and south, or the equator. They are parallels of the map's own frame, so on a tilted map they tilt
 * with it. Null where the map has none. The same map gives the very same object, as the cuts keep what they prepare by object.
 */
export function standardLines(c: CompiledProjection): GeoJSON.MultiLineString | null {
  const latitudes = standardLatitudes(c);
  if (latitudes.length === 0) return null;
  // The frame is what the map really uses: a conic's centre latitude counts for nothing.
  const key = JSON.stringify([c.def.id, latitudes, c.fromFrame([0, 0]), c.fromFrame([0, 90])]);
  let lines = kept.get(key);
  if (lines === undefined) {
    const coordinates = latitudes.map((lat) => {
      const line: LonLat[] = [];
      for (let lon = -180; lon <= 180; lon += STEP) line.push(c.fromFrame([lon, lat]));
      return line;
    });
    lines = { type: 'MultiLineString', coordinates };
    kept.set(key, lines);
    if (kept.size > KEPT) kept.delete(kept.keys().next().value!);
  }
  return lines;
}
