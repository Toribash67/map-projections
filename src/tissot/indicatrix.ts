import type { CompiledProjection, LonLat } from '../projections/types';
import { destination, isCovered, lobeOf, projectPoint, type ScreenTransform } from '../screen/screen';

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
function derivative(c: CompiledProjection, s: ScreenTransform, p: LonLat, lobe: number | undefined, centre: Pair, azimuth: number): Pair | null {
  const side = (sign: number): Pair | null => {
    const q = destination(p, (sign * STEP) / rad, azimuth);
    if (!isCovered(c, q)) return null;
    const at = projectPoint(c, s, q, lobe);
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

/**
 * The Jacobian of the map at `p`, in pixels per radian of true distance, with
 * columns for east and north (any basis at a pole: east and north of the
 * longitude given). Null where `p` is off the map or the numbers are not finite.
 * An interrupted map is held to the lobe that holds `p`.
 */
export function jacobian(c: CompiledProjection, s: ScreenTransform, p: LonLat): Mat2 | null {
  if (!isCovered(c, p)) return null;
  const lobe = lobeOf(c, c.toFrame(p));
  const centre = projectPoint(c, s, p, lobe);
  if (!finite(centre)) return null;
  const east = derivative(c, s, p, lobe, centre, EAST);
  const north = derivative(c, s, p, lobe, centre, NORTH);
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

/** Where indicatrices sit: every 30 degrees of longitude and, from -60 to 60, of latitude, plus both poles. */
export function indicatrixCentres(): LonLat[] {
  const centres: LonLat[] = [];
  for (let lat = -60; lat <= 60; lat += 30) {
    for (let lon = -180; lon < 180; lon += 30) centres.push([lon, lat]);
  }
  centres.push([0, 90], [0, -90]);
  return centres;
}

/**
 * The position and matrix of an indicatrix on a map that is a weighted mix of
 * members. A member that cannot show `p` is left out and the rest are
 * renormalised; null when none can.
 */
export function blendIndicatrix(members: Member[], p: LonLat): { pos: Pair; mat: Mat2 } | null {
  let total = 0;
  const shown: { weight: number; pos: Pair; mat: Mat2 }[] = [];
  for (const { compiled, screen, weight } of members) {
    const mat = jacobian(compiled, screen, p);
    if (!mat) continue;
    shown.push({ weight, pos: projectPoint(compiled, screen, p), mat });
    total += weight;
  }
  if (!(total > 0)) return null;
  const pos: Pair = [0, 0];
  const mat: Mat2 = [0, 0, 0, 0];
  for (const m of shown) {
    const w = m.weight / total;
    pos[0] += w * m.pos[0];
    pos[1] += w * m.pos[1];
    for (let k = 0; k < 4; k++) mat[k]! += w * m.mat[k]!;
  }
  return { pos, mat };
}
