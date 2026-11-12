import { toVector, type Vector } from '../geo/densify';
import type { CompiledProjection } from '../projections/types';

const rad = Math.PI / 180;

/**
 * The surface a map is projected onto, as lines in space about the Earth, whose radius is 1: the wireframe of a cylinder, a cone, a
 * plane or an octahedron. `touch` is where it meets the globe: the lines of true scale. A perspective map has besides the point its
 * rays come from, if that is anywhere near, and a few of the rays.
 */
export type Surface = {
  kind: 'cylinder' | 'cone' | 'plane' | 'octahedron';
  lines: Vector[][];
  touch: Vector[][];
  eye?: Vector;
  rays?: [Vector, Vector][];
};

/** How far from the middle of the globe, in radii, a surface reaches at most: as much as the corner globe has room to show, from any side. */
export const REACH = 1.9;
// A cylinder reaches this far above and below the middle of the globe. A cone is cut off at REACH, so the point of a steep one is beyond it.
const HEIGHT = 1.3;
// How many straight lines run down a cylinder or a cone, and how many points a circle about its axis has.
const GENERATORS = 12;
const ROUND = 72;
// Points along a straight line, so that the part of it behind the globe can be told from the rest.
const ALONG = 24;
// Half the side of the plane of an azimuthal map, and how many lines it has each way.
const PLANE = 1.1;
const GRID = 4;
// How far (degrees) from the centre the rays of a perspective map meet the globe.
const RAY_AT = 30;

/** Carries a point of the map's own frame, given as right-handed x, y, z with z along the frame's pole, to the Earth. */
function fromFrame(c: CompiledProjection): (x: number, y: number, z: number) => Vector {
  const [ex, ey, ez] = [toVector(c.fromFrame([0, 0])), toVector(c.fromFrame([90, 0])), toVector(c.fromFrame([0, 90]))];
  return (x, y, z) => [x * ex[0] + y * ey[0] + z * ez[0], x * ex[1] + y * ey[1] + z * ez[1], x * ex[2] + y * ey[2] + z * ez[2]];
}

/** A circle about the frame's axis, of a radius and at a height. */
const ring = (at: ReturnType<typeof fromFrame>, radius: number, height: number): Vector[] =>
  Array.from({ length: ROUND + 1 }, (_, i) => at(radius * Math.cos((2 * Math.PI * i) / ROUND), radius * Math.sin((2 * Math.PI * i) / ROUND), height));

/** The parallel of the frame at a latitude, on the globe. */
const parallel = (at: ReturnType<typeof fromFrame>, lat: number): Vector[] => ring(at, Math.cos(lat * rad), Math.sin(lat * rad));

/** A straight line between two points, in steps. */
const straight = (a: Vector, b: Vector): Vector[] =>
  Array.from({ length: ALONG + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / ALONG, a[1] + ((b[1] - a[1]) * i) / ALONG, a[2] + ((b[2] - a[2]) * i) / ALONG]);

/**
 * A surface that is a straight line spun about the frame's axis: a cylinder or a cone. The line is given in a plane through the axis,
 * as its two ends, each a distance from the axis and a height. Circles at its ends, unless an end is on the axis, and lines down it.
 */
function spun(at: ReturnType<typeof fromFrame>, [r0, z0]: [number, number], [r1, z1]: [number, number]): Vector[][] {
  const lines: Vector[][] = [];
  for (const [r, z] of [[r0, z0], [r1, z1]] as const) if (r > 1e-6) lines.push(ring(at, r, z));
  for (let i = 0; i < GENERATORS; i++) {
    const [cos, sin] = [Math.cos((2 * Math.PI * i) / GENERATORS), Math.sin((2 * Math.PI * i) / GENERATORS)];
    lines.push(straight(at(r0 * cos, r0 * sin, z0), at(r1 * cos, r1 * sin, z1)));
  }
  return lines;
}

function cylinder(c: CompiledProjection): Surface {
  const at = fromFrame(c);
  // A cylindrical map with a standard parallel off the equator is on a narrower cylinder, which cuts the globe there.
  const lat = c.def.id === 'cylindrical' ? ({ ...c.def.defaultParams, ...c.state.params }.phi0 ?? 0) : 0;
  const radius = Math.cos(lat * rad);
  return { kind: 'cylinder', lines: spun(at, [radius, -HEIGHT], [radius, HEIGHT]), touch: lat === 0 ? [parallel(at, 0)] : [parallel(at, lat), parallel(at, -lat)] };
}

function cone(c: CompiledProjection): Surface {
  const at = fromFrame(c);
  const { p1, p2 } = { ...c.def.defaultParams, ...c.state.params } as { p1: number; p2: number };
  // In a plane through the axis, the globe is a circle and the cone a straight line: through the two standard parallels, or
  // touching the circle where they are one.
  const [r1, z1] = [Math.cos(p1 * rad), Math.sin(p1 * rad)];
  const [dr, dz] = p1 === p2 ? [-Math.sin(p1 * rad), Math.cos(p1 * rad)] : [Math.cos(p2 * rad) - r1, Math.sin(p2 * rad) - z1];
  // As much of the line as is within REACH of the middle of the globe: where (r1 + t dr)^2 + (z1 + t dz)^2 is REACH squared. The
  // point (r1, z1) is on the globe, well within it, so there is one such place each way along the line.
  const [a, b, k] = [dr * dr + dz * dz, 2 * (r1 * dr + z1 * dz), 1 - REACH * REACH];
  const root = Math.sqrt(b * b - 4 * a * k);
  let [from, to] = [(-b - root) / (2 * a), (-b + root) / (2 * a)];
  // And not past the axis, where the cone comes to a point.
  if (Math.abs(dr) > 1e-12) {
    const apex = -r1 / dr;
    if (dr > 0) from = Math.max(from, apex);
    else to = Math.min(to, apex);
  }
  const end = (t: number): [number, number] => [Math.max(0, r1 + t * dr), z1 + t * dz];
  return { kind: 'cone', lines: spun(at, end(from), end(to)), touch: p1 === p2 ? [parallel(at, p1)] : [parallel(at, p1), parallel(at, p2)] };
}

function plane(c: CompiledProjection): Surface {
  const at = fromFrame(c);
  // The frame's x axis runs through the map's centre: the plane is at x = 1, and y and z are east and north on it.
  const lines: Vector[][] = [];
  for (let i = 0; i < GRID; i++) {
    const offset = -PLANE + (2 * PLANE * i) / (GRID - 1);
    lines.push(straight(at(1, -PLANE, offset), at(1, PLANE, offset)), straight(at(1, offset, -PLANE), at(1, offset, PLANE)));
  }
  // It touches the globe at one point, shown as a small circle about it.
  const touch = [Array.from({ length: ROUND + 1 }, (_, i) => at(Math.cos(3 * rad), Math.sin(3 * rad) * Math.cos((2 * Math.PI * i) / ROUND), Math.sin(3 * rad) * Math.sin((2 * Math.PI * i) / ROUND)))];
  const surface: Surface = { kind: 'plane', lines, touch };
  if (c.def.id !== 'perspective') return surface;
  // A perspective map is drawn by rays from a point on the line through the middle of the globe and the map's centre, P radii from
  // the middle on the far side: the middle itself for gnomonic, the far side of the globe for stereographic.
  const x = { ...c.def.defaultParams, ...c.state.params }.x!;
  const P = x >= 1 ? Infinity : x / (1 - x);
  const on = [90, 210, 330].map((bearing) => [Math.cos(RAY_AT * rad), Math.sin(RAY_AT * rad) * Math.sin(bearing * rad), Math.sin(RAY_AT * rad) * Math.cos(bearing * rad)] as const);
  if (P === Infinity) {
    // From infinitely far the rays are parallel: each comes straight across to the plane.
    surface.rays = on.map(([, y, z]) => [at(-1.4, y, z), at(1, y, z)]);
    return surface;
  }
  surface.eye = at(-P, 0, 0);
  // From the eye through a point of the globe and on to the plane, where x is 1.
  surface.rays = on.map(([sx, sy, sz]) => {
    const reach = (1 + P) / (sx + P);
    return [surface.eye!, at(1, sy * reach, sz * reach)];
  });
  return surface;
}

function octahedron(c: CompiledProjection): Surface {
  const at = fromFrame(c);
  // Its faces touch the globe, so its corners are the square root of three out along the frame's axes.
  const d = Math.sqrt(3);
  const corners: Vector[] = [at(d, 0, 0), at(-d, 0, 0), at(0, d, 0), at(0, -d, 0), at(0, 0, d), at(0, 0, -d)];
  const lines: Vector[][] = [];
  corners.forEach((a, i) => {
    // Each corner is joined to every other but the one opposite it.
    for (let j = i + 1; j < corners.length; j++) if (j !== (i ^ 1)) lines.push(straight(a, corners[j]!));
  });
  return { kind: 'octahedron', lines, touch: [] };
}

/**
 * The surface this map is projected onto, in space about the Earth, set as the map is: about its centre and its own pole, so that it
 * turns as the map's centre and tilt do. Null for the globe, which is projected onto nothing, and for a map that is worked out by
 * formula and not by unrolling anything: the pseudocylindrical and compromise maps, Peirce's, and the double hemispheres.
 */
export function surfaceFor(c: CompiledProjection): Surface | null {
  if (c.def.id === 'butterfly') return octahedron(c);
  switch (c.def.family) {
    case 'cylindrical':
      return cylinder(c);
    case 'conic':
      return cone(c);
    case 'azimuthal':
      return plane(c);
    default:
      return null;
  }
}

/** Whether a point, as the camera sees it, is hidden by the globe: behind its face, or within it. */
const isHidden = ([x, y, z]: Vector): boolean => {
  const depth = 1 - x * x - y * y;
  return depth > 0 && z < Math.sqrt(depth);
};

/**
 * A line, in the camera's view (see `toView`), as runs that are in front of the globe and runs that it hides, each as places on the
 * page in radii with y up. A run begins at the point where the one before ended, so that drawn they join.
 */
export function visibleRuns(line: Vector[]): Run[] {
  const runs: Run[] = [];
  for (const point of line) {
    const hidden = isHidden(point);
    const xy: [number, number] = [point[0], point[1]];
    const current = runs.at(-1);
    if (current && current.hidden === hidden) current.points.push(xy);
    else runs.push({ points: current ? [current.points.at(-1)!, xy] : [xy], hidden });
  }
  return runs;
}

/** A stretch of a line that is all in front of the globe, or all hidden by it. */
export type Run = { points: [number, number][]; hidden: boolean };
