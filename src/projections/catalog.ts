import {
  geoAzimuthalEqualAreaRaw,
  geoAzimuthalEquidistantRaw,
  geoConicConformalRaw,
  geoConicEqualAreaRaw,
  geoEqualEarthRaw,
  geoNaturalEarth1Raw,
  geoStereographicRaw,
} from 'd3-geo';
import {
  geoBonneRaw,
  geoEckert4Raw,
  geoHammerRaw,
  geoMillerRaw,
  geoMollweideRaw,
  geoNicolosiRaw,
  geoRobinsonRaw,
  geoVanDerGrintenRaw,
  geoWinkel3Raw,
} from 'd3-geo-projection';
import { hemispheresDef } from './hemispheres';
import { peirceCorners, peirceLobes, peirceRaw } from './peirce';
import { cylindricalRaw, goodeRaw, nearPerspectiveRaw, perspectiveRaw } from './raws';
import type { ExcludedCap, Lobe, Orientation, Params, Preserves, ProjectionDef, Seam, Stop } from './types';

const rad = Math.PI / 180;

const origin: Orientation = { lon: 0, lat: 0, tilt: 0 };
const conicOrigin: Orientation = { lon: 10, lat: 0, tilt: 0 };

const NORTH_POLE: [number, number] = [0, 90];
const SOUTH_POLE: [number, number] = [0, -90];
const ANTIPODE: [number, number] = [180, 0];

const cap = (frameCenter: [number, number], radius: number, mode: ExcludedCap['mode'] = 'clip'): ExcludedCap => ({
  frameCenter,
  radius,
  mode,
});

const bothPoles = (radius: number): ExcludedCap[] => [cap(NORTH_POLE, radius), cap(SOUTH_POLE, radius)];

/** Distance from the centre, as P Earth radii. x = 1 is Infinity (orthographic). */
const viewpoint = (x: number): number => (x >= 1 ? Infinity : x / (1 - x));

// How far a perspective view may reach: its radius, over its scale at the centre, at the edge of
// stereographic's 165 degrees. Wider would shrink the middle of the fitted map further.
const PERSPECTIVE_REACH = 2 * Math.tan(82.5 * rad);

/**
 * Largest angle from the centre, in degrees, that a perspective view shows: 68 for gnomonic, 165
 * for stereographic and 90 for orthographic. A view from inside the globe (P < 1) runs to
 * infinity where cos c = -P, so it stops where its radius (P + 1) sin c / (P + cos c) reaches
 * PERSPECTIVE_REACH if that comes before 68 + 97P. A view from outside folds back over itself where
 * cos c = -1/P, 90 + asin(1/P) degrees out, so it stops five sixths of the way from 90 to there.
 */
function perspectiveLimit(P: number): number {
  if (P < 1) {
    // The angle where the radius reaches PERSPECTIVE_REACH: (P + 1) sin c - R cos c = R P.
    const R = PERSPECTIVE_REACH;
    const reach = Math.atan2(R, P + 1) + Math.asin((R * P) / Math.hypot(P + 1, R));
    return Math.min(68 + 97 * P, reach / rad);
  }
  return 90 + (75 * Math.asin(1 / P)) / (Math.PI / 2);
}

/** Cone constant of the equal-area conic. */
const equalAreaN = (p1: number, p2: number): number => (Math.sin(p1 * rad) + Math.sin(p2 * rad)) / 2;

/** Cone constant of the conformal conic, as d3 computes it. */
function conformalN(p1: number, p2: number): number {
  const y0 = p1 * rad;
  const y1 = p2 * rad;
  if (y0 === y1) return Math.sin(y0);
  const tany = (y: number) => Math.tan(Math.PI / 4 + y / 2);
  return Math.log(Math.cos(y0) / Math.cos(y1)) / Math.log(tany(y1) / tany(y0));
}

/** The cone constant of a conic definition at standard parallels `p1` and `p2`: 0 is a cylinder, 1 a disc. */
export const coneConstant = (defId: string, p1: number, p2: number): number =>
  defId === 'conic-conformal' ? conformalN(p1, p2) : equalAreaN(p1, p2);

/** The nearest the eye comes to the globe, in Earth radii from its centre. */
export const NEAREST_VIEW = 1.1;

/** The parallels of a conic stop at the pole, which the conic sliders reach but do not pass. */
export const POLAR_PARALLEL = 89.9;

/** 0 up to `from`, 1 from `to`, linear between. */
const ramp = (v: number, from: number, to: number): number => Math.min(1, Math.max(0, (v - from) / (to - from)));
const mix = (a: number, b: number, w: number): number => a * (1 - w) + b * w;

// Where a cone has become close enough to a cylinder, or to a disc, that its caps are those of the projection it is becoming.
const CYLINDER_BELOW = 0.2;
const DISC_ABOVE = 0.9;

/**
 * Apex pole and far pole of a cone, with the radii they are given at cone constant `n`. A cone
 * with n = 0 is a cylinder; the north pole is called the apex.
 */
function conicCaps(n: number, apexRadius: number, farRadius: number): ExcludedCap[] {
  const [apex, far] = n >= 0 ? [NORTH_POLE, SOUTH_POLE] : [SOUTH_POLE, NORTH_POLE];
  return [cap(apex, apexRadius), cap(far, farRadius)];
}

/**
 * Caps of the conformal conic. At the limits of its sliders they are Mercator's, which cuts both
 * poles, and polar stereographic's, which cuts a cap round the antipode of its centre.
 */
function conformalCaps(p1: number, p2: number): ExcludedCap[] {
  const n = conformalN(p1, p2);
  const a = Math.abs(n);
  return conicCaps(n, mix(5, 0.1, ramp(a, 0, CYLINDER_BELOW)), mix(5 + 55 * a, 15, ramp(a, DISC_ABOVE, 1)));
}

/** Caps of the equal-area conic. Cylindrical equal-area and polar Lambert azimuthal cut next to nothing. */
function equalAreaCaps(p1: number, p2: number): ExcludedCap[] {
  const n = equalAreaN(p1, p2);
  return conicCaps(n, 0.1, mix(0.1 + 25 * Math.abs(n), 0.1, ramp(Math.abs(n), DISC_ABOVE, 1)));
}

const antimeridian: Seam = { kind: 'antimeridian' };
const noSeam: Seam = { kind: 'none' };

// Each lobe is known by its central longitude, in degrees.
const goodeLobes: Lobe[] = [
  // south
  { id: -160, lonMin: -180, lonMax: -100, latMin: -90, latMax: 0 },
  { id: -60, lonMin: -100, lonMax: -20, latMin: -90, latMax: 0 },
  { id: 20, lonMin: -20, lonMax: 80, latMin: -90, latMax: 0 },
  { id: 140, lonMin: 80, lonMax: 180, latMin: -90, latMax: 0 },
  // north
  { id: -100, lonMin: -180, lonMax: -40, latMin: 0, latMax: 90 },
  { id: 30, lonMin: -40, lonMax: 180, latMin: 0, latMax: 90 },
];

/** A whole-sphere projection with fixed raw, centred on the frame origin and with both poles clipped. */
function plain(id: string, family: string, raw: ProjectionDef['raw'], seam: Seam = antimeridian): ProjectionDef {
  return {
    id,
    family,
    defaultParams: {},
    defaultOrientation: origin,
    tiltEnabled: true,
    latEnabled: true,
    raw,
    caps: () => bothPoles(0.1),
    seam,
  };
}

const defList: ProjectionDef[] = [
  {
    id: 'globe',
    family: 'globe',
    // One over the eye's distance from the Earth's centre, in Earth radii: 0 is infinitely far, which is the orthographic globe.
    defaultParams: { d: 0 },
    defaultOrientation: origin,
    tiltEnabled: false,
    latEnabled: true,
    raw: (p) => nearPerspectiveRaw(p.d! > 0 ? 1 / p.d! : Infinity),
    // The far side is all that is beyond the limb, which from nearer than infinity is more than a hemisphere.
    caps: (p) => [cap(ANTIPODE, 180 - Math.acos(Math.min(1, Math.max(0, p.d!))) / rad, 'behind')],
    seam: noSeam,
  },
  {
    id: 'perspective',
    family: 'azimuthal',
    defaultParams: { x: 0.5 },
    defaultOrientation: origin,
    tiltEnabled: false,
    latEnabled: true,
    raw: (p) => perspectiveRaw(viewpoint(p.x!)),
    caps: (p) => [cap(ANTIPODE, 180 - perspectiveLimit(viewpoint(p.x!)))],
    seam: noSeam,
  },
  ...(
    [
      ['azimuthal-equidistant', geoAzimuthalEquidistantRaw],
      ['lambert-azimuthal', geoAzimuthalEqualAreaRaw],
    ] as const
  ).map(
    ([id, raw]): ProjectionDef => ({
      id,
      family: 'azimuthal',
      defaultParams: {},
      defaultOrientation: origin,
      tiltEnabled: false,
      latEnabled: true,
      raw: () => raw,
      caps: () => [cap(ANTIPODE, 0.1)],
      seam: noSeam,
    }),
  ),
  {
    id: 'cylindrical',
    family: 'cylindrical',
    defaultParams: { phi0: 0, spacing: 1 },
    defaultOrientation: origin,
    tiltEnabled: true,
    latEnabled: true,
    raw: (p) => cylindricalRaw(p.phi0! * rad, p.spacing!),
    caps: (p) => bothPoles(p.spacing! < 1 ? 5 * (1 - p.spacing!) + 0.1 * p.spacing! : 0.1),
    seam: antimeridian,
  },
  {
    id: 'conic-conformal',
    family: 'conic',
    defaultParams: { p1: 33, p2: 45 },
    defaultOrientation: conicOrigin,
    tiltEnabled: false,
    latEnabled: false,
    raw: (p) => geoConicConformalRaw(p.p1! * rad, p.p2! * rad),
    caps: (p) => conformalCaps(p.p1!, p.p2!),
    seam: antimeridian,
  },
  {
    id: 'conic-equal-area',
    family: 'conic',
    defaultParams: { p1: 29.5, p2: 45.5 },
    defaultOrientation: conicOrigin,
    tiltEnabled: false,
    latEnabled: false,
    raw: (p) => geoConicEqualAreaRaw(p.p1! * rad, p.p2! * rad),
    caps: (p) => equalAreaCaps(p.p1!, p.p2!),
    seam: antimeridian,
  },
  // A cylindrical map with a spacing of its own, which the cylindrical sliders do not reach.
  plain('miller', 'cylindrical', () => geoMillerRaw),
  plain('robinson', 'compromise', () => geoRobinsonRaw),
  plain('winkel3', 'compromise', () => geoWinkel3Raw),
  plain('natural-earth', 'compromise', () => geoNaturalEarth1Raw),
  plain('van-der-grinten', 'compromise', () => geoVanDerGrintenRaw),
  plain('equal-earth', 'equal-area', () => geoEqualEarthRaw),
  plain('mollweide', 'equal-area', () => geoMollweideRaw),
  // Bonne's equal-area pseudoconic, by its standard parallel: on the equator it is the sinusoidal projection, at the pole Werner's heart.
  { ...plain('bonne', 'equal-area', (p) => geoBonneRaw(p.phi1! * rad)), defaultParams: { phi1: 45 } },
  plain('eckert4', 'equal-area', () => geoEckert4Raw),
  plain('hammer', 'equal-area', () => geoHammerRaw(2)),
  plain('goode', 'polyhedral', () => goodeRaw, { kind: 'lobes', lobes: goodeLobes, smoothEquator: true }),
  {
    id: 'peirce',
    family: 'polyhedral',
    defaultParams: {},
    // The meridian 45 degrees west of the centre runs straight down from the pole: 20 degrees west, as Peirce had it, which puts the
    // four corners of the equator, where the map is not conformal, in the oceans.
    defaultOrientation: { lon: 25, lat: 0, tilt: 0 },
    tiltEnabled: true,
    latEnabled: true,
    // North at the frame's origin, which is the middle of a side of the equator's square, points along a diagonal of the map: the
    // map is drawn with its sides upright, not with that diagonal.
    turn: 45,
    raw: () => peirceRaw,
    // The north pole is the middle of the map, and an ordinary point of it.
    caps: () => [cap(SOUTH_POLE, 0.1)],
    singular: peirceCorners,
    seam: { kind: 'lobes', lobes: peirceLobes, smoothEquator: true },
  },
  hemispheresDef('hemispheres-nicolosi', geoNicolosiRaw),
  hemispheresDef('hemispheres-stereographic', geoStereographicRaw),
  hemispheresDef('hemispheres-equal-area', geoAzimuthalEqualAreaRaw),
];

const defsById = new Map(defList.map((d) => [d.id, d]));

export function getDef(id: string): ProjectionDef {
  const def = defsById.get(id);
  if (!def) throw new Error(`Unknown projection definition: ${id}`);
  return def;
}

const stop = (
  id: string,
  name: string,
  family: string,
  defId: string,
  params: Params,
  preserves: Preserves,
  note: string,
  extra: Pick<Stop, 'tilt' | 'ignoreParams'> = {},
): Stop => ({ id, name, family, note, preserves, defId, params, ...extra });

export const stops: Stop[] = [
  stop('globe', 'Globe', 'globe', 'globe', {}, 'none', 'Keeps every shape, area and distance true at once, but shows only one hemisphere at a time, and less from close by.', { ignoreParams: ['d'] }),

  stop('gnomonic', 'Gnomonic', 'azimuthal', 'perspective', { x: 0 }, 'none', 'Keeps every straight line a great circle, the shortest route, but stretches shapes and areas ever more toward the edge and cannot show a full hemisphere.'),
  stop('stereographic', 'Stereographic', 'azimuthal', 'perspective', { x: 0.5 }, 'conformal', 'Keeps angles and small shapes true and turns circles into circles, but inflates areas away from the centre.'),
  stop('azimuthal-equidistant', 'Azimuthal equidistant', 'azimuthal', 'azimuthal-equidistant', {}, 'equidistant', 'Keeps distances and directions true from the centre, but distorts shapes and areas far from it.'),
  stop('lambert-azimuthal', 'Lambert azimuthal equal-area', 'azimuthal', 'lambert-azimuthal', {}, 'equal-area', 'Keeps areas true and directions from the centre right, but bends shapes toward the edge.'),

  stop('mercator', 'Mercator', 'cylindrical', 'cylindrical', { phi0: 0, spacing: 0 }, 'conformal', 'Keeps angles and local shapes true, so it suits navigation, but inflates areas toward the poles.', { ignoreParams: ['phi0'] }),
  stop('transverse-mercator', 'Transverse Mercator', 'cylindrical', 'cylindrical', { phi0: 0, spacing: 0 }, 'conformal', 'Mercator turned a quarter turn, so it keeps angles and shapes true along a meridian, but inflates areas away from it.', { tilt: 90, ignoreParams: ['phi0'] }),
  stop('equirectangular', 'Equirectangular', 'cylindrical', 'cylindrical', { phi0: 0, spacing: 1 }, 'equidistant', 'Plots longitude and latitude as a plain grid, which is simple to use, but stretches shapes and areas away from the equator.'),
  stop('lambert-cylindrical', 'Lambert cylindrical equal-area', 'cylindrical', 'cylindrical', { phi0: 0, spacing: 2 }, 'equal-area', 'Keeps areas true, but stretches shapes badly near the poles.'),
  stop('behrmann', 'Behrmann', 'cylindrical', 'cylindrical', { phi0: 30, spacing: 2 }, 'equal-area', 'Keeps areas true with less shape distortion at mid-latitudes than Lambert, but squashes the tropics.'),
  stop('gall-peters', 'Gall-Peters', 'cylindrical', 'cylindrical', { phi0: 45, spacing: 2 }, 'equal-area', 'Keeps areas true, but stretches the tropics tall and squashes the high latitudes wide.'),
  stop('miller', 'Miller', 'cylindrical', 'miller', {}, 'compromise', 'Looks like Mercator with the poles brought within reach, so it shows the whole world, but keeps neither angles nor areas true.'),

  stop('albers', 'Albers', 'conic', 'conic-equal-area', { p1: 29.5, p2: 45.5 }, 'equal-area', 'Keeps areas true with little shape distortion between its two standard parallels, but distorts shapes farther away.'),
  stop('lambert-conformal', 'Lambert conformal conic', 'conic', 'conic-conformal', { p1: 33, p2: 45 }, 'conformal', 'Keeps angles and local shapes true, so it suits flight charts, but inflates areas away from its standard parallels.'),

  stop('robinson', 'Robinson', 'compromise', 'robinson', {}, 'compromise', 'Trades small distortions of shape, area and distance against each other to look right, but preserves none of them exactly.'),
  stop('winkel-tripel', 'Winkel Tripel', 'compromise', 'winkel3', {}, 'compromise', 'Balances distortion of area, direction and distance across the whole world, but keeps none of them exactly.'),
  stop('natural-earth', 'Natural Earth', 'compromise', 'natural-earth', {}, 'compromise', 'Drawn by eye to look right on a small world map, with rounded corners and gentle distortion everywhere, but keeps nothing exactly.'),
  stop('van-der-grinten', 'Van der Grinten', 'compromise', 'van-der-grinten', {}, 'compromise', 'Shows the whole world in a circle, with little distortion near the equator, but inflates the polar regions enormously.'),

  stop('equal-earth', 'Equal Earth', 'equal-area', 'equal-earth', {}, 'equal-area', 'Keeps areas true with a pleasing shape, but distorts shapes toward the poles and edges; the UN General Assembly\'s non-binding September 2026 "Correct the Map" resolution encouraged its use.'),
  stop('mollweide', 'Mollweide', 'equal-area', 'mollweide', {}, 'equal-area', 'Keeps areas true in a single ellipse, but squashes shapes near the poles and the edges.'),
  stop('sinusoidal', 'Sinusoidal', 'equal-area', 'bonne', { phi1: 0 }, 'equal-area', 'Keeps areas true and distances along parallels, but shears shapes badly toward the edges.'),
  stop('bonne', 'Bonne', 'equal-area', 'bonne', { phi1: 45 }, 'equal-area', 'Keeps areas true, and shapes along its standard parallel and its central meridian, but shears them toward the sides of its heart.'),
  stop('werner', 'Werner', 'equal-area', 'bonne', { phi1: 90 }, 'equal-area', 'Keeps areas true in a heart with the pole at its cleft, and distances from the pole, but shears shapes badly away from the central meridian.'),
  stop('eckert4', 'Eckert IV', 'equal-area', 'eckert4', {}, 'equal-area', 'Keeps areas true between rounded sides, with each pole a line half the length of the equator, but stretches the tropics tall.'),
  stop('hammer', 'Hammer', 'equal-area', 'hammer', {}, 'equal-area', 'Keeps areas true in a smooth ellipse, but bends shapes toward the edges.'),

  stop('goode', 'Goode homolosine', 'polyhedral', 'goode', {}, 'equal-area', 'Keeps areas true with little shape distortion on land, but cuts the oceans into separate lobes.'),
  stop('peirce', 'Peirce quincuncial', 'polyhedral', 'peirce', {}, 'conformal', 'Keeps angles and small shapes true over the whole world in a square that tiles the plane, but for four points on the equator, and cuts the southern oceans to do it.'),

  stop('nicolosi', 'Nicolosi globular', 'hemispheres', 'hemispheres-nicolosi', {}, 'compromise', 'Draws each hemisphere in a circle, with every meridian and parallel an arc of a circle, as atlases long did, but keeps nothing exactly.'),
  stop('stereographic-hemispheres', 'Stereographic hemispheres', 'hemispheres', 'hemispheres-stereographic', {}, 'conformal', 'Keeps angles and small shapes true in two circles, one for each hemisphere, but inflates areas toward their rims.'),
  stop('equal-area-hemispheres', 'Equal-area hemispheres', 'hemispheres', 'hemispheres-equal-area', {}, 'equal-area', 'Keeps areas true in two circles, one for each hemisphere, but squeezes shapes toward their rims.'),
];
