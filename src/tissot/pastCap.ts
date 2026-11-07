import { geoDistance, geoInterpolate } from 'd3-geo';
import type { LonLat } from '../projections/types';
import { isClipped, projectPoint } from '../screen/screen';
import { INDICATRIX_RADIUS, singularValues, type Mat2, type Member } from './indicatrix';

const rad = Math.PI / 180;

/**
 * In a map at rest or being dragged, an indicatrix is computed this far (degrees) past a clip cap's edge, so that one whose centre has just
 * left the map still shows the part of it that is inside, and slides out of view. On gnomonic, whose scale grows as sec^2 of the angle from
 * the centre, 10 degrees past the edge at 68 is where an ellipse has left the map altogether, so nothing is cut off while it still shows.
 */
export const CAP_MARGIN = 10;
/**
 * Past a cap an indicatrix is dropped when its larger semi-axis is more than this many times the map's scale, in pixels per unit of its raw
 * projection. A cylindrical map's pole is at infinity and its scale there is beyond any bound; this stops those, and any other that blows up.
 */
const MAX_SEMI_AXIS = 2.5;
// Steps along the way from a cap's edge to a point past it, and how far (degrees) inside the edge the way is taken from.
const PATH_STEPS = 4;
const LEAD_IN = 1;
// A step shorter than this (pixels) has no direction worth reading.
const NO_STEP = 1e-6;

/** Whether `p` is in a clip cap of any member, which only a margin lets the map show. */
export const isPastCap = (members: Member[], p: LonLat): boolean => members.some((m) => isClipped(m.compiled, p));

/** Whether an indicatrix of this matrix is larger than `MAX_SEMI_AXIS` times the scale of the maps showing it (weighted by their shares). */
export function isHuge(mat: Mat2, members: Member[]): boolean {
  const total = members.reduce((sum, m) => sum + m.weight, 0);
  const scale = members.reduce((sum, m) => sum + m.weight * m.screen.k, 0) / total;
  return INDICATRIX_RADIUS * singularValues(mat)[0] > MAX_SEMI_AXIS * scale;
}

/**
 * Whether the map carries on outwards past the edge of the cap that holds `p`, as far as `p`. Gnomonic does, up to
 * 90 degrees from its centre; an orthographic map does not: past its limb it turns back over the near side, and there
 * an indicatrix would be a second copy of something the map already shows. Taken along the great circle from the
 * cap's centre through `p`: every step has to go on the way the one before went, from just inside the edge.
 */
export function continuesOutward(m: Member, p: LonLat): boolean {
  const { compiled: c, screen: s } = m;
  const frame = c.toFrame(p);
  let best: { centre: LonLat; radius: number; depth: number } | null = null;
  for (const cap of c.caps) {
    if (cap.mode !== 'clip') continue;
    const depth = cap.radius - geoDistance(frame, cap.frameCenter) / rad;
    if (depth > 0 && (!best || depth < best.depth)) best = { centre: cap.frameCenter, radius: cap.radius, depth };
  }
  // A point at a cap's centre has no direction from it.
  const distance = best ? best.radius - best.depth : 0;
  if (!best || !(distance > 1e-6)) return false;
  const along = geoInterpolate(best.centre, frame);
  const angles = [best.radius + LEAD_IN, ...Array.from({ length: PATH_STEPS + 1 }, (_, i) => best!.radius - (best!.depth * i) / PATH_STEPS)];
  const points = angles.map((angle) => projectPoint(c, s, c.fromFrame(along((angle * rad) / (distance * rad)) as LonLat)));
  let previous: [number, number] | null = null;
  for (let i = 1; i < points.length; i++) {
    const step: [number, number] = [points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]];
    if (!step.every(Number.isFinite)) return false;
    // A point a hair past the edge has hardly any way to go.
    if (Math.hypot(step[0], step[1]) < NO_STEP) continue;
    if (previous && step[0] * previous[0] + step[1] * previous[1] <= 0) return false;
    previous = step;
  }
  return true;
}
