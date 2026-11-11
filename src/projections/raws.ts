import { geoHomolosineRaw } from 'd3-geo-projection';
import type { RawFn } from './types';

/**
 * Perspective azimuthal projection seen from distance `P` Earth radii from the
 * centre, on a frame whose centre is [0, 0]. P = 0 is gnomonic, 1 is
 * stereographic and Infinity is orthographic. Radius is (P + 1) sin c / (P + cos c),
 * with c the angle from the centre.
 */
export function perspectiveRaw(P: number): RawFn {
  return (lambda, phi) => {
    const cosPhi = Math.cos(phi);
    // r / sin c, which stays finite at the centre where sin c is zero.
    const k = P === Infinity ? 1 : (P + 1) / (P + cosPhi * Math.cos(lambda));
    return [k * cosPhi * Math.sin(lambda), k * Math.sin(phi)];
  };
}

/**
 * The globe as seen from `D` Earth radii from its centre, on a frame whose centre is [0, 0], with scale 1 at the centre. From
 * infinitely far it is orthographic. From nearer, less than a hemisphere is in sight: the limb is where cos c = 1 / D, and what lies
 * beyond it, the far side, falls inside the limb, as on the orthographic globe, where the near side covers it.
 */
export function nearPerspectiveRaw(D: number): RawFn {
  return (lambda, phi) => {
    const cosPhi = Math.cos(phi);
    const k = D === Infinity ? 1 : (D - 1) / (D - cosPhi * Math.cos(lambda));
    return [k * cosPhi * Math.sin(lambda), k * Math.sin(phi)];
  };
}

function mercatorY(phi: number): number {
  return Math.log(Math.tan(Math.PI / 4 + phi / 2));
}

/**
 * Cylindrical projection with standard parallel `phi0` (radians). `spacing`
 * moves the vertical spacing through Mercator (0), equirectangular (1) and
 * equal-area (2), interpolating linearly in between.
 */
export function cylindricalRaw(phi0: number, spacing: number): RawFn {
  const cosPhi0 = Math.cos(phi0);
  const s = Math.min(2, Math.max(0, spacing));
  // Weights of the three stops. Zero weights are skipped so that the Mercator
  // term, which is infinite at the poles, cannot turn 0 * Infinity into NaN.
  const wMercator = Math.max(0, 1 - s);
  const wPlain = 1 - Math.abs(s - 1);
  const wEqualArea = Math.max(0, s - 1);
  return (lambda, phi) => {
    let y = 0;
    if (wMercator > 0) y += wMercator * mercatorY(phi) * cosPhi0;
    if (wPlain > 0) y += wPlain * phi;
    if (wEqualArea > 0) y += wEqualArea * (Math.sin(phi) / cosPhi0);
    return [lambda * cosPhi0, y];
  };
}

const rad = Math.PI / 180;

/**
 * One lobe of interrupted Goode homolosine. `lobe` is the lobe's id, which is its central
 * longitude in degrees; without it the projection is centred on longitude 0.
 */
export const goodeRaw: RawFn = (lambda, phi, lobe = 0) => {
  const centre = lobe * rad;
  const [x, y] = geoHomolosineRaw(lambda - centre, phi);
  return [x + centre, y];
};
