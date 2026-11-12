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

// Nearer the equator, the central meridian or a pole than this (radians), Van der Grinten's formulas divide nought by nought, and the plain ones for those lines are used.
const ON_AXIS = 1e-6;

/**
 * Van der Grinten's projection: the world in a circle, every meridian and parallel an arc of a circle. As d3 has it within the world,
 * and unlike d3's it runs on past the antimeridian as the same smooth map, where d3's folds back on itself: an indicatrix by the
 * seam is drawn in two parts, and the part across the seam is where the map would carry on to.
 */
export const vanDerGrintenRaw: RawFn = (lambda, phi) => {
  if (Math.abs(phi) < ON_AXIS) return [lambda, 0];
  const sinTheta = Math.abs(phi / (Math.PI / 2));
  const theta = Math.asin(Math.min(1, sinTheta));
  if (Math.abs(lambda) < ON_AXIS || Math.abs(Math.abs(phi) - Math.PI / 2) < ON_AXIS) return [0, Math.sign(phi) * Math.PI * Math.tan(theta / 2)];
  const cosTheta = Math.cos(theta);
  // Signed: nought on the antimeridian and negative beyond it. Its sign is what d3 drops.
  const l = Math.abs(lambda);
  const A = (Math.PI / l - l / Math.PI) / 2;
  const A2 = A * A;
  const G = cosTheta / (sinTheta + cosTheta - 1);
  const P = G * (2 / sinTheta - 1);
  const P2 = P * P;
  const [P2A2, GP2, Q] = [P2 + A2, G - P2, A2 + G];
  return [
    (Math.sign(lambda) * Math.PI * (A * GP2 + Math.sqrt(Math.max(0, A2 * GP2 * GP2 - P2A2 * (G * G - P2))))) / P2A2,
    (Math.sign(phi) * Math.PI * (P * Q - A * Math.sqrt(Math.max(0, (A2 + 1) * P2A2 - Q * Q)))) / P2A2,
  ];
};
