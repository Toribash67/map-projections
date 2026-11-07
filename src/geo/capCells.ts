import { geoDistance } from 'd3-geo';
import type { CompiledProjection, ExcludedCap, LonLat } from '../projections/types';

const rad = Math.PI / 180;
// A cap smaller than this (degrees of radius), such as the patch at a pole that Mercator leaves out, is too small to fold over visibly, and its cells would cost more than they are worth.
const MIN_RADIUS = 10;

/** Cells `step` degrees on a side, in a map's frame, that touch any of `caps`. */
function cellsTouching(c: CompiledProjection, caps: ExcludedCap[], step: number): GeoJSON.Polygon[] {
  const cells: GeoJSON.Polygon[] = [];
  const reaches = (cell: LonLat[]) => caps.some((cap) => cell.some((p) => geoDistance(p, cap.frameCenter) / rad < cap.radius - 1e-9));
  for (let west = -180; west < 180 - 1e-9; west += step) {
    const east = Math.min(180, west + step);
    for (let south = -90; south < 90 - 1e-9; south += step) {
      const north = Math.min(90, south + step);
      // North, east, south and back: clockwise in longitude and latitude, so the small side is inside.
      // At a pole the two corners there are one point.
      const corners: LonLat[] = [[west, south], [west, north]];
      if (north < 90) corners.push([east, north]);
      if (south > -90) corners.push([east, south]);
      corners.push([west, south]);
      if (!reaches([...corners, [(west + east) / 2, (south + north) / 2]])) continue;
      cells.push({ type: 'Polygon', coordinates: [corners.map((p) => c.fromFrame(p))] });
    }
  }
  return cells;
}

/**
 * Cells that cover what a map cannot show: the far hemisphere of a globe, the far side of a gnomonic
 * map. During a morph that part folds over as it moves to its place on the other map, and one outline
 * cannot fill a folded sheet. Each small cell still covers its own patch, so the cells together do. A cell
 * that reaches past the cap is cut at its edge with everything else, and only its part within the cap is
 * used. `steps` gives the side of a cell, in degrees, for each kind of cap: a globe's cap folds over on
 * itself and wants small cells, a clip cap's much less. A map with no cap of any size has no cells.
 */
export function capCells(c: CompiledProjection, steps: Record<ExcludedCap['mode'], number>): GeoJSON.GeometryCollection {
  const big = c.caps.filter((cap) => cap.radius >= MIN_RADIUS);
  const geometries = (['behind', 'clip'] as const).flatMap((mode) => {
    const caps = big.filter((cap) => cap.mode === mode);
    return caps.length > 0 ? cellsTouching(c, caps, steps[mode]) : [];
  });
  return { type: 'GeometryCollection', geometries };
}
