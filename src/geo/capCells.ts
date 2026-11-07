import { geoDistance } from 'd3-geo';
import type { CompiledProjection, ExcludedCap, LonLat } from '../projections/types';
import type { Member } from '../tissot/indicatrix';

const rad = Math.PI / 180;
// A cap smaller than this (degrees of radius), such as the patch at a pole that Mercator leaves out, is too small to fold over visibly, and its cells would cost more than they are worth.
const MIN_RADIUS = 10;

/** Whether a cap is big enough for cells of ocean. What a smaller one leaves out is filled by the ordinary ocean. */
export const hasCells = (cap: ExcludedCap): boolean => cap.radius >= MIN_RADIUS;

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
  const big = c.caps.filter(hasCells);
  const geometries = (['behind', 'clip'] as const).flatMap((mode) => {
    const caps = big.filter((cap) => cap.mode === mode);
    return caps.length > 0 ? cellsTouching(c, caps, steps[mode]) : [];
  });
  return { type: 'GeometryCollection', geometries };
}

// Side of a cell of ocean beyond a map's coverage, in degrees, by kind of cap. Smaller cells fold less within themselves, and cost more
// to cut and to draw. A globe's far side folds over itself and needs 10; what a clip cap leaves out needs less care, and 15 costs half as much as 10.
const CAP_CELL = { behind: 10, clip: 15 } as const;

/**
 * The cells of ocean for a morph, as one layer, or null when no map in it has a cap that wants them. What a map
 * cannot show is only seen in a morph, where it folds over as it moves to its place on the other map.
 */
export function capOceanLayer(members: Member[]): GeoJSON.GeometryCollection | null {
  const capped = members.map((m) => capCells(m.compiled, CAP_CELL)).filter((cells) => cells.geometries.length > 0);
  return capped.length > 0 ? { type: 'GeometryCollection', geometries: capped.flatMap((cells) => cells.geometries) } : null;
}
