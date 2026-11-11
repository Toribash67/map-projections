import { geoRotation } from 'd3-geo';
import { geoGuyouRaw } from 'd3-geo-projection';
import type { Lobe, RawFn } from './types';

const rad = Math.PI / 180;

type Pair = [number, number];

/**
 * The lobes of Peirce's quincuncial map. The frame's north pole is the middle of the map and the northern hemisphere is one lobe,
 * in several rectangles with no seam between them (a rectangle that is a whole hemisphere cannot be clipped to). The southern hemisphere
 * is cut along four meridians, from the south pole to the equator at longitudes ±45 and ±135, into four lobes, each known by a number
 * and folded out from one side of the square that the equator makes. The fourth wraps the antimeridian, and so is two rectangles.
 */
export const peirceLobes: Lobe[] = [0, -90].flatMap((latMin) => {
  // Both hemispheres in the same rectangles of longitude, so that the corners of the equator's square are corners of rectangles too.
  const quadrants = [[-135, -45], [-45, 45], [45, 135], [135, 180], [-180, -135]] as const;
  return quadrants.map(([lonMin, lonMax], i) => ({ id: latMin === 0 ? 0 : Math.min(i, 3) + 1, lonMin, lonMax, latMin, latMax: latMin + 90 }));
});

/** The four corners of the equator's square, in the frame: there the map is not conformal, and so steep that a path by them needs finer steps. */
export const peirceCorners: [number, number][] = [[-135, 0], [-45, 0], [45, 0], [135, 0]];

// How far north of the equator (radians) a point on it is taken to be.
const ON_RIM = 1e-12;

// Turns the frame so that its north pole is where Guyou's formula has the middle of its square, as d3's own quincuncial map does.
const toGuyou = geoRotation([-90, -90, 45]);

/**
 * The northern hemisphere, conformally, in a square standing on a corner, with the pole in the middle: Guyou's map of a hemisphere,
 * about the pole. The square's corners, where the map is not conformal, are on the equator at longitudes ±45 and ±135.
 */
function north(lambda: number, phi: number): Pair {
  // The equator is the rim of Guyou's hemisphere, where its formula has two answers and rounding picks one: a point on it is taken a hair north.
  const [l, p] = toGuyou([lambda / rad + 45, Math.max(phi, ON_RIM) / rad]);
  const [x, y] = geoGuyouRaw(l * rad, p * rad);
  return [(x - y) * Math.SQRT1_2, (x + y) * Math.SQRT1_2];
}

/** The southern lobe that holds a longitude (radians). */
const southLobe = (lambda: number): number => {
  const lon = lambda / rad;
  return lon >= -135 && lon < -45 ? 1 : lon >= -45 && lon < 45 ? 2 : lon >= 45 && lon < 135 ? 3 : 4;
};

// The middle of each southern lobe's side of the equator's square, by the lobe's number: the nearest point of that side to the pole.
const SIDES: Pair[] = [-90, 0, 90, 180].map((lon) => north(lon * rad, 0));

/** A point mirrored in a side of the equator's square, which is how the map carries on across it: a conformal map runs on across a straight edge as its own mirror image. */
function mirrored([x, y]: Pair, lobe: number): Pair {
  const [mx, my] = SIDES[lobe - 1]!;
  const length = Math.hypot(mx, my);
  const [ux, uy] = [mx / length, my / length];
  const over = 2 * (x * ux + y * uy - length);
  return [x - over * ux, y - over * uy];
}

/** The map of a point of either hemisphere as the northern lobe has it: its own in the north, and south of the equator carried on into the lobe below. */
const whole = (lambda: number, phi: number): Pair => (phi >= 0 ? north(lambda, phi) : mirrored(north(lambda, -phi), southLobe(lambda)));

/**
 * Peirce's quincuncial projection: the world, conformally, in a square, with the north pole in the middle, the equator a square
 * standing on its corner within it, and the south pole at all four corners. `lobe` is the lobe to draw the point on (see
 * `peirceLobes`), the one that holds it if none is given. A lobe's formula carries on beyond the lobe, across the equator and past
 * a seam alike, which is what a derivative at its edge and an indicatrix across it need.
 */
export const peirceRaw: RawFn = (lambda, phi, lobe = phi >= 0 ? 0 : southLobe(lambda)) =>
  lobe === 0 ? whole(lambda, phi) : mirrored(whole(lambda, -phi), lobe);
