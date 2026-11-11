import type { CompiledProjection, LonLat } from '../projections/types';
import { destination, isClipped, lobeOf, projectFrame, projectPoint, type Margin, type ScreenTransform } from '../screen/screen';

const rad = Math.PI / 180;

/**
 * A 2x2 matrix [a, b, c, d] meaning [[a, b], [c, d]], row-major. Applied to a
 * displacement (east, north) in radians of true distance on the sphere, it gives
 * the displacement on screen in pixels (x right, y down).
 */
export type Mat2 = [number, number, number, number];
export type Member = { compiled: CompiledProjection; screen: ScreenTransform; weight: number };

/** The radius of an undistorted indicatrix: 5 degrees of true distance, in radians. */
export const INDICATRIX_RADIUS = 5 * rad;

const STEP = 1e-4; // radians of true distance
const JUMP = 10; // a side this many times farther than the other has crossed a seam
const EAST = 90;
const NORTH = 0;

type Pair = [number, number];

const finite = (q: Pair) => Number.isFinite(q[0]) && Number.isFinite(q[1]);

/**
 * The screen derivative at `p` along a great circle leaving at bearing
 * `azimuth` (degrees), per radian of true distance. Central difference, or one
 * side only where the other is off the map or has jumped across a seam.
 */
function derivative(c: CompiledProjection, place: (q: LonLat) => Pair, p: LonLat, centre: Pair, azimuth: number, margin: Margin): Pair | null {
  const side = (sign: number): Pair | null => {
    const q = destination(p, (sign * STEP) / rad, azimuth);
    if (isClipped(c, q, margin)) return null;
    const at = place(q);
    return finite(at) ? at : null;
  };
  const plus = side(1);
  const minus = side(-1);
  if (!plus && !minus) return null;
  const forward = (): Pair => [(plus![0] - centre[0]) / STEP, (plus![1] - centre[1]) / STEP];
  const backward = (): Pair => [(centre[0] - minus![0]) / STEP, (centre[1] - minus![1]) / STEP];
  if (!plus) return backward();
  if (!minus) return forward();
  const reachPlus = Math.hypot(plus[0] - centre[0], plus[1] - centre[1]);
  const reachMinus = Math.hypot(minus[0] - centre[0], minus[1] - centre[1]);
  if (reachPlus > JUMP * reachMinus) return backward();
  if (reachMinus > JUMP * reachPlus) return forward();
  return [(plus[0] - minus[0]) / (2 * STEP), (plus[1] - minus[1]) / (2 * STEP)];
}

/** Where the map would put a point carried on past a seam: frame longitudes taken within 180 degrees of `near`, on the lobe `lobe`. */
export type Continued = { near: number; lobe: number | undefined };

const unwrap = (lon: number, near: number) => lon + 360 * Math.round((near - lon) / 360);

/**
 * The Jacobian of the map at `p`, in pixels per radian of true distance, with
 * columns for east and north (any basis at a pole: east and north of the
 * longitude given). Null where `p` is off the map or the numbers are not finite.
 * The far side of a globe is on the map, with the same orthographic derivative
 * as the near side, as a morph away from a globe needs it to be exact there too.
 * An interrupted map is held to the lobe that holds `p`.
 *
 * With `margin` (degrees, or a function of the cap), the map is taken to cover that far past the edge of a clip cap, where the
 * projection is finite: a point there has its derivative, one-sided at the new edge as at any other. The
 * rest of the map is unchanged. It is for an indicatrix whose centre has just left the map, and still
 * shows its inside part.
 *
 * With `continued`, the map is carried on across a seam, as the copy of an indicatrix on the far side of the seam needs it.
 */
export function jacobian(c: CompiledProjection, s: ScreenTransform, p: LonLat, { margin = 0, continued }: { margin?: Margin; continued?: Continued } = {}): Mat2 | null {
  if (isClipped(c, p, margin)) return null;
  let place: (q: LonLat) => Pair;
  if (continued) {
    place = (q) => {
      const frame = c.toFrame(q);
      return projectFrame(c, s, [unwrap(frame[0], continued.near), frame[1]], continued.lobe);
    };
  } else {
    const lobe = lobeOf(c, c.toFrame(p));
    place = (q) => projectPoint(c, s, q, lobe);
  }
  const centre = place(p);
  if (!finite(centre)) return null;
  const east = derivative(c, place, p, centre, EAST, margin);
  const north = derivative(c, place, p, centre, NORTH, margin);
  if (!east || !north) return null;
  return [east[0], north[0], east[1], north[1]];
}

/** The axes of the ellipse a matrix makes of a unit circle: its singular values, largest first. */
export function singularValues([a, b, c, d]: Mat2): [number, number] {
  const p = a * a + c * c;
  const r = b * b + d * d;
  const q = a * b + c * d;
  const mid = (p + r) / 2;
  const spread = Math.hypot((p - r) / 2, q);
  return [Math.sqrt(mid + spread), Math.sqrt(Math.max(0, mid - spread))];
}

/** The spacing of indicatrices, in degrees, on a map zoomed this many times: closer as it is zoomed in, so that several are always in view. */
export const indicatrixStep = (zoom: number): 30 | 15 | 10 | 5 => (zoom < 2 ? 30 : zoom < 4 ? 15 : zoom < 8 ? 10 : 5);

/** The radius (radians) of an undistorted indicatrix at a spacing: a sixth of it, which is 5 degrees at 30. */
export const indicatrixRadius = (step: number): number => (step / 6) * rad;

/** Where indicatrices sit: every `step` degrees of longitude and of latitude, 30 if not given, with each pole once. */
export function indicatrixCentres(step = 30): LonLat[] {
  const centres: LonLat[] = [];
  for (let lat = -90 + step; lat < 90 - step / 2; lat += step) {
    for (let lon = -180; lon < 180; lon += step) centres.push([lon, lat]);
  }
  centres.push([0, 90], [0, -90]);
  return centres;
}
