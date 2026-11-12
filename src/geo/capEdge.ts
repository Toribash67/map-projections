import type { CompiledProjection, ExcludedCap, LonLat } from '../projections/types';
import { lobeOf, projectFrame, type ScreenTransform } from '../screen/screen';
import { cross, dot, toVector, type Vector } from './densify';

const rad = Math.PI / 180;
const TAU = 2 * Math.PI;

// Closer than this (radians) to a cap's centre, a point's direction from it is only rounding noise.
const NO_DIRECTION = 1e-12;

type Pair = [number, number];

/** An angle wrapped to [-π, π]: the way a straight segment sweeps round a point not on it. */
export const wrapAngle = (a: number) => a - TAU * Math.round(a / TAU);

/** A clip cap with axes to read directions from its centre. Direction 0 is frame longitude 0 for a cap on a frame pole. */
export type CapAxes = { centre: Vector; e1: Vector; e2: Vector; cosRadius: number; sinRadius: number };

export function capAxes(cap: ExcludedCap): CapAxes {
  const centre = toVector(cap.frameCenter);
  const side = cross([0, 0, 1], centre);
  const length = Math.hypot(...side);
  const [e1, e2]: [Vector, Vector] = length > 1e-9 ? [[side[0] / length, side[1] / length, 0], cross(centre, [side[0] / length, side[1] / length, 0])] : [[1, 0, 0], [0, 1, 0]];
  return { centre, e1, e2, cosRadius: Math.cos(cap.radius * rad), sinRadius: Math.sin(cap.radius * rad) };
}

/** The frame point on a cap's edge in a given direction from its centre. */
export function edgePoint({ centre, e1, e2, cosRadius, sinRadius }: CapAxes, direction: number): LonLat {
  const [cos, sin] = [Math.cos(direction), Math.sin(direction)];
  const along = (i: 0 | 1 | 2) => centre[i] * cosRadius + (e1[i] * cos + e2[i] * sin) * sinRadius;
  return [Math.atan2(along(1), along(0)) / rad, Math.asin(Math.max(-1, Math.min(1, along(2)))) / rad];
}

export const clipCaps = (c: CompiledProjection) => c.caps.filter((cap) => cap.mode === 'clip');

/** Direction of each point from the cap's centre. A point on the centre takes that of the point before it, or after it. */
export function directionsOf(axes: CapAxes, vectors: Vector[]): Float64Array {
  const directions = new Float64Array(vectors.length).fill(NaN);
  vectors.forEach((v, i) => {
    const [a, b] = [dot(v, axes.e1), dot(v, axes.e2)];
    if (Math.hypot(a, b) > NO_DIRECTION) directions[i] = Math.atan2(b, a);
  });
  let known = directions.find((d) => !Number.isNaN(d)) ?? 0;
  for (let i = 0; i < directions.length; i++) {
    if (Number.isNaN(directions[i]!)) directions[i] = known;
    else known = directions[i]!;
  }
  return directions;
}

/**
 * Where a map puts a point in a morph: projected, or moved to the edge of the clip cap holding it. That is the map folded: all it
 * cannot show lies along its edges, where it has no area, which is how everything on it reaches or leaves the edge without a jump.
 */
export function positionOn(c: CompiledProjection, s: ScreenTransform, p: LonLat): Pair {
  const frame = c.toFrame(p);
  const v = toVector(frame);
  for (const cap of clipCaps(c)) {
    const axes = capAxes(cap);
    if (dot(v, axes.centre) <= axes.cosRadius) continue;
    const edge = edgePoint(axes, directionsOf(axes, [v])[0]!);
    return projectFrame(c, s, edge, lobeOf(c, edge));
  }
  return projectFrame(c, s, frame, lobeOf(c, frame));
}
