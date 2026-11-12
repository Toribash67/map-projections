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
    if (i > 0) out.push(...between(path[i - 1]!, point, singular));
    out.push(point);
  });
  return out;
}

/**
 * The points added between two ends of a segment, in order from `from`. They are the same whichever end the segment is given from:
 * two pieces that share an edge, as neighbouring cells do, go along it opposite ways, and have to meet all along it, not only at its ends.
 * So the walk always starts at the end nearer a singular point, and at the western end if they are as near.
 */
function between(from: LonLat, to: LonLat, singular: Vector[]): LonLat[] {
  const length = geoDistance(from, to) / rad;
  const [nearFrom, nearTo] = [distanceToNearest(from, singular), distanceToNearest(to, singular)];
  if (!(length > stepAt(Math.min(nearFrom, nearTo)))) return [];
  const backwards = nearTo < nearFrom || (nearTo === nearFrom && (to[0] < from[0] || (to[0] === from[0] && to[1] < from[1])));
  const [start, end, near] = backwards ? [to, from, nearTo] : [from, to, nearFrom];
  const along = geoInterpolate(start, end);
  const added: LonLat[] = [];
  if (stepAt(near - length) >= MAX_SEGMENT) {
    const steps = Math.ceil(length / MAX_SEGMENT);
    for (let s = 1; s < steps; s++) added.push(along(s / steps));
  } else {
    for (let walked = stepAt(near); walked < length; ) {
      const next = along(walked / length);
      added.push(next);
      walked += stepAt(distanceToNearest(next, singular));
    }
  }
  return backwards ? added.reverse() : added;
}

export const dot = (a: Vector, b: Vector): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vector, b: Vector): Vector => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
