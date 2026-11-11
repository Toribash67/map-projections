import type { Lobe, ProjectionDef, RawFn } from './types';

const rad = Math.PI / 180;

/**
 * The western and the eastern half of the frame, each known by the longitude of its middle, in degrees. Each is in two rectangles,
 * north and south of the equator, with no seam between them: a rectangle that is a whole hemisphere is bounded by one great circle,
 * and the clips cannot tell its inside from its outside, which are the same size.
 */
const lobes: Lobe[] = [-90, 90].flatMap((id) => {
  const [lonMin, lonMax] = id < 0 ? [-180, 0] : [0, 180];
  return [
    { id, lonMin, lonMax, latMin: 0, latMax: 90 },
    { id, lonMin, lonMax, latMin: -90, latMax: 0 },
  ];
});

/**
 * A map of the world as two hemispheres side by side, each drawn by `hemisphere` about its own middle: a raw projection that puts
 * the half of the sphere within a quarter turn of its centre in a disc. The two discs touch at the frame's origin, which is the
 * middle of the map, where the frame's prime meridian is the rim of both; its antimeridian is the outer rim of each.
 *
 * The centre is 20 degrees west by default, which splits the world into the Old and the New, as atlases have long done.
 */
export function hemispheresDef(id: string, hemisphere: RawFn): ProjectionDef {
  const radius = hemisphere(Math.PI / 2, 0)[0];
  const raw: RawFn = (lambda, phi, lobe = lambda < 0 ? -90 : 90) => {
    const [x, y] = hemisphere(lambda - lobe * rad, phi);
    return [x + Math.sign(lobe) * radius, y];
  };
  return {
    id,
    family: 'hemispheres',
    defaultParams: {},
    defaultOrientation: { lon: -20, lat: 0, tilt: 0 },
    tiltEnabled: true,
    latEnabled: true,
    raw: () => raw,
    // The poles are points on the rims, where the two discs' edges and the seam all meet.
    caps: () => [
      { frameCenter: [0, 90], radius: 0.1, mode: 'clip' },
      { frameCenter: [0, -90], radius: 0.1, mode: 'clip' },
    ],
    seam: { kind: 'lobes', lobes, smoothEquator: true },
  };
}
