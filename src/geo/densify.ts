import { geoDistance, geoInterpolate } from 'd3-geo';
import type { LonLat } from '../projections/types';

const rad = Math.PI / 180;

const MAX_SEGMENT = 2; // degrees
const MIN_SEGMENT = 0.01; // degrees
// A step near a singular point spans at most this many radians as seen from it.
const SINGULAR_STEP = 0.1;

/** Farther than this (degrees) from every singular point, a path needs only the `MAX_SEGMENT` steps. */
export const SINGULAR_REACH = MAX_SEGMENT / SINGULAR_STEP;

export type Vector = [number, number, number];

export function toVector([lon, lat]: LonLat): Vector {
  const cosLat = Math.cos(lat * rad);
  return [cosLat * Math.cos(lon * rad), cosLat * Math.sin(lon * rad), Math.sin(lat * rad)];
}

/** Angle in degrees from a point to the nearest of `singular`, or Infinity if there are none. */
function distanceToNearest(point: LonLat, singular: Vector[]): number {
  if (singular.length === 0) return Infinity;
  const v = toVector(point);
  let closest = -1;
  for (const s of singular) closest = Math.max(closest, v[0] * s[0] + v[1] * s[1] + v[2] * s[2]);
  return Math.acos(Math.min(1, closest)) / rad;
}

/** The longest step (degrees) to take from a point this far from the nearest singular point. */
const stepAt = (distance: number) => Math.min(MAX_SEGMENT, Math.max(MIN_SEGMENT, distance * SINGULAR_STEP));

/**
 * Adds great-circle points so that no segment is longer than `MAX_SEGMENT`, and
 * shorter near a singular point. Any map tears or fans out round a cap's centre:
 * a segment passing close by subtends a wide angle there, so its ends land far
 * apart on the map, however short it is on the sphere.
 */
export function densify(path: LonLat[], singular: Vector[]): LonLat[] {
  const out: LonLat[] = [];
  path.forEach((point, i) => {
    if (i > 0) {
      const previous = path[i - 1]!;
      const length = geoDistance(previous, point) / rad;
      const near = distanceToNearest(previous, singular);
      if (length > stepAt(near)) {
        const along = geoInterpolate(previous, point);
        if (stepAt(near - length) >= MAX_SEGMENT) {
          const steps = Math.ceil(length / MAX_SEGMENT);
          for (let s = 1; s < steps; s++) out.push(along(s / steps));
        } else {
          for (let walked = stepAt(near); walked < length; ) {
            const next = along(walked / length);
            out.push(next);
            walked += stepAt(distanceToNearest(next, singular));
          }
        }
      }
    }
    out.push(point);
  });
  return out;
}
