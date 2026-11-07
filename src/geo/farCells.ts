import type { CompiledProjection, LonLat } from '../projections/types';

/**
 * The far hemisphere of a map with a 'behind' cap, as a grid of cells `step` degrees on a side
 * in its frame, from frame longitude 90 to 270. During a morph that hemisphere folds over, as a
 * mirrored far side turns into a plain one, and one outline cannot fill a folded sheet. Each small
 * cell still covers its own patch, so the cells together do.
 */
export function farSideCells(c: CompiledProjection, step: number): GeoJSON.GeometryCollection {
  const geometries: GeoJSON.Polygon[] = [];
  for (let west = 90; west < 270 - 1e-9; west += step) {
    const east = Math.min(270, west + step);
    for (let south = -90; south < 90 - 1e-9; south += step) {
      const north = Math.min(90, south + step);
      // North, east, south and back: clockwise in longitude and latitude, so the small side is inside.
      // At a pole the two corners there are one point.
      const corners: LonLat[] = [[west, south], [west, north]];
      if (north < 90) corners.push([east, north]);
      if (south > -90) corners.push([east, south]);
      corners.push([west, south]);
      geometries.push({ type: 'Polygon', coordinates: [corners.map((p) => c.fromFrame(p))] });
    }
  }
  return { type: 'GeometryCollection', geometries };
}
