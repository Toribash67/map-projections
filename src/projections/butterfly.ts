import type { Lobe, RawFn } from './types';

const rad = Math.PI / 180;

type Vec = [number, number, number];

/**
 * The eight octants of the globe, each a face of an octahedron: 1 to 4 round the northern hemisphere from longitude -180, and 5 to 8
 * below them in the south.
 */
export const butterflyLobes: Lobe[] = [0, -90].flatMap((latMin, row) =>
  [-180, -90, 0, 90].map((lonMin, i) => ({ id: 4 * row + i + 1, lonMin, lonMax: lonMin + 90, latMin, latMax: latMin + 90 })),
);

// A face's centre is this far from the equator, where the face touches the globe.
const CENTRE_LAT = Math.asin(1 / Math.sqrt(3));
// From a face's centre to its corner at the pole, and to the middle of its side on the equator, on the face.
const TO_POLE = Math.SQRT2;
const TO_EQUATOR = Math.SQRT1_2;

/**
 * Where each northern face lies about the pole, as the direction (degrees, anticlockwise from the right) of its middle. The faces
 * are 60 degrees wide there. Two to the right, joined along the frame's prime meridian, and two to the left, joined along its
 * antimeridian: the wings. Between the wings, above the pole and below it, are gaps of 60 degrees, along the meridians 90 degrees
 * east and west.
 */
const DIRECTIONS = [210, -30, 30, 150];

type Face = { centre: Vec; east: Vec; north: Vec; cos: number; sin: number; drop: number };

const FACES: Face[] = butterflyLobes.map((lobe, i) => {
  const [lon, lat] = [(lobe.lonMin + 45) * rad, lobe.latMin === 0 ? CENTRE_LAT : -CENTRE_LAT];
  // A face is turned about the pole from pointing down the page, which is where its own north-up drawing has the equator.
  const turn = (DIRECTIONS[i % 4]! + 90) * rad;
  return {
    centre: [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)],
    east: [-Math.sin(lon), Math.cos(lon), 0],
    north: [-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat)],
    cos: Math.cos(turn),
    sin: Math.sin(turn),
    // A southern face is unfolded about its side on the equator: drawn north-up, it lies straight below its northern face.
    drop: TO_POLE + (lobe.latMin === 0 ? 0 : 2 * TO_EQUATOR),
  };
});

// A point this near a quarter turn from a face's centre, or beyond, is not on the face's plane at all: it is taken no farther.
const HORIZON = 1e-6;

/** The face that holds a point (radians). */
function faceOf(lambda: number, phi: number): number {
  const turns = (lambda / rad + 180) / 90;
  const quadrant = Math.min(3, Math.max(0, Math.floor(turns - 4 * Math.floor(turns / 4))));
  return quadrant + 1 + (phi < 0 ? 4 : 0);
}

/**
 * Cahill's butterfly, in its gnomonic form: the globe as the eight faces of an octahedron, each the gnomonic projection of its
 * octant about the face's own middle, so that a great circle is a straight line within a face. The octahedron is unfolded flat with
 * the north pole in the middle: the northern faces as two wings to the right and the left, and each southern face hinged to its
 * northern one along the equator. `lobe` is the face to draw the point on (see `butterflyLobes`), the one that holds it if none is
 * given. A face's projection carries on beyond the face, which is what a derivative at its edge and an indicatrix across it need.
 */
export const butterflyRaw: RawFn = (lambda, phi, lobe = faceOf(lambda, phi)) => {
  const face = FACES[lobe - 1]!;
  const cosPhi = Math.cos(phi);
  const p: Vec = [cosPhi * Math.cos(lambda), cosPhi * Math.sin(lambda), Math.sin(phi)];
  const dot = (v: Vec) => p[0] * v[0] + p[1] * v[1] + p[2] * v[2];
  const depth = Math.max(HORIZON, dot(face.centre));
  // On the face's plane, east and north of its middle; then about the pole, which is north of the middle by the face's `drop`.
  const [u, v] = [dot(face.east) / depth, dot(face.north) / depth - face.drop];
  return [face.cos * u - face.sin * v, face.sin * u + face.cos * v];
};
