import type { Vector } from '../geo/densify';
import type { LonLat } from '../projections/types';

const rad = Math.PI / 180;

/** Where the corner globe is looked at from: the place on the Earth that faces the viewer, with north up. */
export type Camera = { lon: number; lat: number };

/** Europe and Africa a little from above, where most maps have their centre in view. */
export const DEFAULT_CAMERA: Camera = { lon: 10, lat: 25 };

// The camera goes no nearer a pole than this (degrees): over the pole, north would no longer be up.
const MAX_LAT = 85;

/** The directions, on the Earth, that are right, up and towards the viewer for a camera. */
function axes({ lon, lat }: Camera): [Vector, Vector, Vector] {
  const [l, p] = [lon * rad, lat * rad];
  return [
    [-Math.sin(l), Math.cos(l), 0],
    [-Math.sin(p) * Math.cos(l), -Math.sin(p) * Math.sin(l), Math.cos(p)],
    [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)],
  ];
}

/** A point of space about the Earth as the camera sees it: x to the right, y up, z towards the viewer, in Earth radii. */
export function toView(camera: Camera, v: Vector): Vector {
  const [right, up, near] = axes(camera);
  const dot = (a: Vector) => v[0] * a[0] + v[1] * a[1] + v[2] * a[2];
  return [dot(right), dot(up), dot(near)];
}

/** The camera after a drag of the globe by `dx`, `dy` pixels, on a globe `radiusPx` pixels in radius: the globe turns with the pointer. */
export function orbit(camera: Camera, dxPx: number, dyPx: number, radiusPx: number): Camera {
  const lon = camera.lon - dxPx / radiusPx / rad;
  const lat = Math.min(MAX_LAT, Math.max(-MAX_LAT, camera.lat + dyPx / radiusPx / rad));
  return { lon: ((((lon + 180) % 360) + 360) % 360) - 180, lat };
}

/** The place of the Earth at a point of the globe's face, in radii from its middle with y up, or null off the globe. */
export function pick(camera: Camera, x: number, y: number): LonLat | null {
  const depth = 1 - x * x - y * y;
  if (!(depth >= 0)) return null;
  const [right, up, near] = axes(camera);
  const z = Math.sqrt(depth);
  const v = [0, 1, 2].map((i) => x * right[i]! + y * up[i]! + z * near[i]!);
  return [Math.atan2(v[1]!, v[0]!) / rad, Math.asin(Math.max(-1, Math.min(1, v[2]!))) / rad];
}
