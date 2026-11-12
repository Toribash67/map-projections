import { geoArea, geoClipAntimeridian, geoClipCircle, geoClipRectangle, geoRotation } from 'd3-geo';
import type { GeoStream } from 'd3-geo';
import type { CompiledProjection, LonLat } from '../projections/types';
import { CLIP_SPIN, collector, cutGeometry, LOBE_PULL, mapPoints, OFF_EDGE, offLobeEdges, offSeamSide, type Path } from './cut';
import { densify, dot, SINGULAR_REACH, toVector, type Vector } from './densify';

const rad = Math.PI / 180;

// A segment reaching this far round in frame longitude (degrees) crosses the seam or runs over a pole.
const SEAM_JUMP = 179;
// Longest segment before the cut (degrees). A path farther than half this from a circle cannot cross it,
// and one farther than this from a singular point needs no finer steps.
const SEGMENT = 2;
const CIRCLE_MARGIN = (SEGMENT / 2 + 0.01) * rad;
const NEAR_SINGULAR = Math.cos((SINGULAR_REACH + SEGMENT) * rad);
// How close (degrees) a point has to be to a side of a clip rectangle to lie along it.
const ON_EDGE = 1e-9;
// A line narrower than this (degrees) may lie along a lobe's edge.
const THIN_LINE = 2e-9;
// d3's circle clip takes two points within 1e-6 radians for one. A ring with a vertex that close to
// its circle can come out walking the whole circle, which fills the map. So a vertex within this
// (degrees) of the circle is moved just inside it, well under 0.01 px on any of these maps.
const RIM_BAND = 2e-4;
// How far (steradians, per steradian of the shape plus one) a clip's result can read from its true area.
const AREA_SLACK = 2e-3;
const FULL_SPHERE = 4 * Math.PI;
// Close to the antipode, a ring goes round in steps of up to 0.1 radians as seen from it, which on a
// Lambert map read 1.7e-3 short of the curve, as a share of the area inside. A small polygon holding
// the antipode reads as the difference of two such rings, each nearly as large as the whole map.
const ROUND_ANTIPODE = 2e-3;

/** A path of this map's front: in frame coordinates, with no seam or cap anywhere inside it. */
export type FramePiece = { closed: boolean; rings: LonLat[][]; lobe: number | undefined };

type Rect = { x0: number; x1: number; y0: number; y1: number; lobe: number | undefined };
type Bounds = { x0: number; x1: number; y0: number; y1: number };

/** What the front of a map is in its own frame: one or more lon-lat rectangles, or all but a circle round the antipode. */
type Region = { rects: Rect[]; visible?: undefined } | { rects?: undefined; visible: number };

function regionOf(m: CompiledProjection): Region {
  const seam = m.def.seam;
  if (seam.kind === 'none') return { visible: 180 - m.caps[0]!.radius };
  const north = m.caps.find((cap) => cap.frameCenter[1] === 90)?.radius ?? 0;
  const south = m.caps.find((cap) => cap.frameCenter[1] === -90)?.radius ?? 0;
  const [yMin, yMax] = [-90 + south, 90 - north];
  if (seam.kind === 'antimeridian') return { rects: [{ x0: -180, x1: 180, y0: yMin, y1: yMax, lobe: undefined }] };
  // Pulled in, as in a full cut, so that a shape with round numbers cannot pass exactly through a corner,
  // where the clip reads what is inside. A line along an edge is moved inside by `offLobeEdges`.
  return {
    rects: seam.lobes.map((l) => ({
      x0: l.lonMin + LOBE_PULL,
      x1: l.lonMax - LOBE_PULL,
      y0: Math.max(l.latMin + LOBE_PULL, yMin),
      y1: Math.min(l.latMax - LOBE_PULL, yMax),
      lobe: l.id,
    })),
  };
}

/** A round part of the Earth: all within `radius` (radians) of `centre`. */
export type Cap = { centre: Vector; radius: number };

/** Geometry made ready for cutting under any rotation: unit vectors, at most `SEGMENT` apart, x, y, z per point. `within` is a cap that holds all of it, or null where none is known to. */
type Prepared =
  | { kind: 'sphere' }
  /** With the polygon itself and its true area, for checking a clip and for a cut the long way. */
  | { kind: 'polygon'; rings: Float64Array[]; polygon: GeoJSON.Polygon; area: number; within: Cap | null; stretches: Stretches[] }
  | { kind: 'line'; path: Float64Array; within: Cap | null; stretches: Stretches };

/**
 * A path as stretches, each of points no farther than `SEGMENT` from its first, and each ending on the point the next begins on:
 * `starts` is where each begins, and then the path's last point. `slivers` is the area between each stretch and the straight
 * line across it.
 */
type Stretches = { starts: Uint32Array; slivers: Float64Array };

// By object, so a shape that changes has to be a new object.
const preparedCache = new WeakMap<object, Prepared[]>();

function vectors(path: LonLat[]): Float64Array {
  const dense = densify(path, []);
  const out = new Float64Array(3 * dense.length);
  dense.forEach((p, i) => out.set(toVector(p), 3 * i));
  return out;
}

/** The cap round the middle of a path's points that holds them all, or null for a path with no middle, as one right round the Earth. */
function capOf(path: Float64Array): Cap | null {
  const centre: Vector = [0, 0, 0];
  for (let i = 0; i < path.length; i++) centre[i % 3]! += path[i]!;
  const length = Math.hypot(...centre);
  if (length < 1e-6 * (path.length / 3)) return null;
  for (let k = 0; k < 3; k++) centre[k]! /= length;
  let least = 1;
  for (let i = 0; i < path.length; i += 3) least = Math.min(least, path[i]! * centre[0] + path[i + 1]! * centre[1] + path[i + 2]! * centre[2]);
  // Points at most `SEGMENT` apart have the line between them within half that of one of them.
  return { centre, radius: Math.acos(Math.max(-1, least)) + (SEGMENT / 2) * rad };
}

/**
 * The cap that holds a polygon: the one that holds its outer ring, if that is under half the Earth and so is the polygon. Then its
 * inside is the side of the ring within the cap, as the other side is more than half the Earth.
 */
function polygonCap(outer: Float64Array, area: number): Cap | null {
  const cap = area < FULL_SPHERE / 2 ? capOf(outer) : null;
  return cap && cap.radius < Math.PI / 2 ? cap : null;
}

/** Whether a part of the geometry may reach into the part of the Earth in view. */
const mayShow = (within: Cap | null, view: Cap | null): boolean =>
  !view || !within || within.radius + view.radius >= Math.PI || dot(within.centre, view.centre) >= Math.cos(within.radius + view.radius);

const COS_SEGMENT = Math.cos(SEGMENT * rad);

function stretchesOf(path: Float64Array): Stretches {
  const n = path.length / 3;
  const starts = [0];
  const slivers: number[] = [];
  let [first, sliver] = [0, 0];
  for (let i = 1; i < n; i++) {
    const [sx, sy, sz] = [path[3 * first]!, path[3 * first + 1]!, path[3 * first + 2]!];
    const [x, y, z] = [path[3 * i]!, path[3 * i + 1]!, path[3 * i + 2]!];
    if (i - 1 > first && sx * x + sy * y + sz * z < COS_SEGMENT) {
      starts.push(i - 1);
      slivers.push(Math.abs(sliver) / 2);
      [first, sliver] = [i - 1, 0];
      continue;
    }
    // The triangle from the stretch's first point to this segment, which is flat enough this close by.
    const [px, py, pz] = [path[3 * i - 3]!, path[3 * i - 2]!, path[3 * i - 1]!];
    sliver += sx * (py * z - pz * y) + sy * (pz * x - px * z) + sz * (px * y - py * x);
  }
  starts.push(n - 1);
  slivers.push(Math.abs(sliver) / 2);
  return { starts: Uint32Array.from(starts), slivers: Float64Array.from(slivers) };
}

/**
 * A path with each stretch that lies outside the view drawn straight across, from its first point to its last, and how much area
 * that moved, and whether any of it was left as it was. What shows in the view is as it was: a stretch and the line across it are both
 * within `SEGMENT` of its first point, so neither comes into the view, and nothing in the view changes sides of the path. The
 * path is still in steps of `SEGMENT` at most.
 */
function seenFrom(path: Float64Array, { starts, slivers }: Stretches, view: Cap): { path: Float64Array; moved: number; shown: boolean } {
  const reach = view.radius + SEGMENT * rad;
  const near = reach >= Math.PI ? -Infinity : Math.cos(reach);
  const [vx, vy, vz] = view.centre;
  const out = new Float64Array(path.length);
  let [n, moved, shown] = [0, 0, false];
  for (let k = 0; k + 1 < starts.length; k++) {
    const from = 3 * starts[k]!;
    if (path[from]! * vx + path[from + 1]! * vy + path[from + 2]! * vz >= near) {
      const part = path.subarray(from, 3 * starts[k + 1]!);
      out.set(part, n);
      n += part.length;
      shown = true;
    } else {
      out.set(path.subarray(from, from + 3), n);
      n += 3;
      moved += slivers[k]!;
    }
  }
  out.set(path.subarray(path.length - 3), n);
  return { path: out.subarray(0, n + 3), moved, shown };
}

/** A polygon needs a ring with an inside, and a line two points, or a full cut draws nothing of them either. */
function preparePolygon(coordinates: LonLat[][], out: Prepared[]): void {
  const rings = coordinates.filter((ring) => ring.length >= 4);
  if (rings.length === 0 || rings[0] !== coordinates[0]) return;
  const polygon: GeoJSON.Polygon = { type: 'Polygon', coordinates: rings };
  const [turned, area] = [rings.map(vectors), geoArea(polygon)];
  out.push({ kind: 'polygon', rings: turned, polygon, area, within: polygonCap(turned[0]!, area), stretches: turned.map(stretchesOf) });
}

function prepareLine(path: LonLat[], out: Prepared[]): void {
  if (path.length < 2) return;
  const points = vectors(path);
  out.push({ kind: 'line', path: points, within: capOf(points), stretches: stretchesOf(points) });
}

function prepareInto(geom: any, out: Prepared[]): void {
  switch (geom?.type) {
    case 'Sphere':
      out.push({ kind: 'sphere' });
      break;
    case 'FeatureCollection':
      for (const feature of geom.features) prepareInto(feature, out);
      break;
    case 'Feature':
      prepareInto(geom.geometry, out);
      break;
    case 'GeometryCollection':
      for (const part of geom.geometries) prepareInto(part, out);
      break;
    case 'MultiPolygon':
      for (const rings of geom.coordinates) preparePolygon(rings, out);
      break;
    case 'Polygon':
      preparePolygon(geom.coordinates, out);
      break;
    case 'MultiLineString':
      for (const path of geom.coordinates) prepareLine(path, out);
      break;
    case 'LineString':
      prepareLine(geom.coordinates, out);
      break;
  }
}

function prepared(geom: GeoJSON.GeoJsonObject): Prepared[] {
  let cached = preparedCache.get(geom);
  if (!cached) {
    cached = [];
    prepareInto(geom, cached);
    preparedCache.set(geom, cached);
  }
  return cached;
}

type PolygonItem = Extract<Prepared, { kind: 'polygon' }>;

/** Earth to frame as a matrix, so that turning a point takes no trigonometry. */
function frameMatrix(m: CompiledProjection): [Vector, Vector, Vector] {
  return [toVector(m.toFrame([0, 0])), toVector(m.toFrame([90, 0])), toVector(m.toFrame([0, 90]))];
}

/** One path turned into the frame: its points, finer near a singular point, and what a cut needs to know of it. */
type Turned = {
  points: LonLat[];
  /** Least and greatest cosine of the angle from the frame's centre. */
  minCos: number;
  maxCos: number;
  /** Twice its signed area on a stereographic map of the frame: negative if it goes clockwise round its inside. Good only clear of the antipode. */
  stereoArea: number;
};

function turn(path: Float64Array, [a, b, c]: [Vector, Vector, Vector], singular: Vector[]): Turned {
  const n = path.length / 3;
  const points = new Array<LonLat>(n);
  let near: boolean[] | null = null;
  let minCos = Infinity;
  let maxCos = -Infinity;
  let stereoArea = 0;
  let previousX = 0;
  let previousY = 0;
  for (let i = 0; i < n; i++) {
    const ex = path[3 * i]!;
    const ey = path[3 * i + 1]!;
    const ez = path[3 * i + 2]!;
    const x = ex * a[0] + ey * b[0] + ez * c[0];
    const y = ex * a[1] + ey * b[1] + ez * c[1];
    const z = ex * a[2] + ey * b[2] + ez * c[2];
    points[i] = [Math.atan2(y, x) / rad, Math.asin(z > 1 ? 1 : z < -1 ? -1 : z) / rad];
    if (x < minCos) minCos = x;
    if (x > maxCos) maxCos = x;
    const planeX = y / (1 + x);
    const planeY = z / (1 + x);
    if (i > 0) stereoArea += previousX * planeY - planeX * previousY;
    previousX = planeX;
    previousY = planeY;
    for (const s of singular) {
      if (x * s[0] + y * s[1] + z * s[2] > NEAR_SINGULAR) {
        (near ??= [])[i] = true;
        break;
      }
    }
  }
  return { points: near ? refined(points, near, singular) : points, minCos, maxCos, stereoArea };
}

/** Adds the finer steps near singular points, leaving segments far from them as they are. */
function refined(points: LonLat[], near: boolean[], singular: Vector[]): LonLat[] {
  const out: LonLat[] = [points[0]!];
  for (let i = 1; i < points.length; i++) {
    if (near[i - 1] || near[i]) {
      const dense = densify([points[i - 1]!, points[i]!], singular);
      for (let k = 1; k < dense.length; k++) out.push(dense[k]!);
    } else {
      out.push(points[i]!);
    }
  }
  return out;
}

function boundsOf(paths: LonLat[][]): Bounds {
  const b = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
  for (const path of paths) {
    for (const [x, y] of path) {
      if (x < b.x0) b.x0 = x;
      if (x > b.x1) b.x1 = x;
      if (y < b.y0) b.y0 = y;
      if (y > b.y1) b.y1 = y;
    }
  }
  return b;
}

const overlaps = (a: Bounds, b: Bounds) => a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;
const within = (a: Bounds, b: Bounds) => a.x0 >= b.x0 && a.x1 <= b.x1 && a.y0 >= b.y0 && a.y1 <= b.y1;

function crossesSeam(path: LonLat[]): boolean {
  for (let i = 1; i < path.length; i++) {
    if (Math.abs(path[i]![0] - path[i - 1]![0]) > SEAM_JUMP) return true;
  }
  return false;
}

/** Twice the signed area in the plane of longitude and latitude: negative if clockwise, which is how d3 marks a ring's inside. */
function planeArea(ring: LonLat[]): number {
  let total = 0;
  for (let i = 1; i < ring.length; i++) total += ring[i - 1]![0] * ring[i]![1] - ring[i]![0] * ring[i - 1]![1];
  return total;
}

/** Streams paths into a clip, as `geoStream` does: a closed ring's repeated last point is left out. */
function run(clip: GeoStream, paths: LonLat[][], closed: boolean, f: (p: LonLat) => LonLat = (p) => p): void {
  if (closed) clip.polygonStart();
  for (const path of paths) {
    clip.lineStart();
    const n = closed ? path.length - 1 : path.length;
    for (let i = 0; i < n; i++) {
      const [x, y] = f(path[i]!);
      clip.point(x, y);
    }
    clip.lineEnd();
  }
  if (closed) clip.polygonEnd();
}

const ringsIn = (out: Path[]) => out.flatMap((path) => path.coords);

/** Cuts paths at the frame's antimeridian. Longitudes run from -180 to 180 with no jump afterward. */
function cutAtSeam(paths: LonLat[][], closed: boolean): LonLat[][] {
  const out: Path[] = [];
  const clip = geoClipAntimeridian(mapPoints(([x, y]) => [x / rad, y / rad], collector(out)));
  run(clip, paths, closed, ([x, y]) => [x * rad, y * rad]);
  return ringsIn(out);
}

/** Clips paths to a rectangle. This clip goes by what the rings wind round in the plane, so paths must have been cut at the seam. */
function cutToRect(paths: LonLat[][], closed: boolean, r: Rect): LonLat[][] {
  const out: Path[] = [];
  run(geoClipRectangle(r.x0, r.y0, r.x1, r.y1)(collector(out)), paths, closed);
  const rings = ringsIn(out);
  return closed ? rings.map((ring) => (isBareRect(ring, r) ? [...ring].reverse() : ring)) : rings;
}

/**
 * The rectangle itself, uncut, as this clip writes it for a shape covering it all. It comes out
 * anticlockwise here, the way a hole runs, so a hole inside it would be filled over.
 */
const isBareRect = (ring: LonLat[], r: Rect) =>
  ring.length === 5 && planeArea(ring) > 0 && ring.every(([x, y]) => (x === r.x0 || x === r.x1) && (y === r.y0 || y === r.y1));

/**
 * Adds points along a rectangle's sides, which clips leave as one long straight step. In the frame
 * those sides are meridians and parallels, so the points are even steps of the longitude or latitude.
 */
function alongSides(ring: LonLat[], r: Rect): LonLat[] {
  const out: LonLat[] = [];
  const onSide = (a: number, b: number, side: number) => Math.abs(a - side) < ON_EDGE && Math.abs(b - side) < ON_EDGE;
  ring.forEach((point, i) => {
    if (i > 0) {
      const previous = ring[i - 1]!;
      const [dx, dy] = [point[0] - previous[0], point[1] - previous[1]];
      const steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / SEGMENT);
      const runs =
        onSide(previous[0], point[0], r.x0) || onSide(previous[0], point[0], r.x1) || onSide(previous[1], point[1], r.y0) || onSide(previous[1], point[1], r.y1);
      if (runs) for (let s = 1; s < steps; s++) out.push([previous[0] + (dx * s) / steps, previous[1] + (dy * s) / steps]);
    }
    out.push(point);
  });
  return out;
}

/**
 * The net under a clip. What a clip leaves of a polygon is all the polygon has inside the map, so its
 * true area can't exceed either's, can't fall short by more than the map leaves out, and can't read
 * negative, and there must be something if the polygon has a point well inside the map. A wrong clip goes
 * round the wrong side, or walks a whole boundary, which shows here even where the area on the
 * sphere would wrap round to the right number.
 */
function isPlausible(pieces: FramePiece[], polygonArea: number, regionArea: number, showsSome: boolean, areaOf: (ring: LonLat[]) => number, extraSlack = 0): boolean {
  const slack = AREA_SLACK * (1 + polygonArea) + extraSlack;
  let total = 0;
  for (const piece of pieces) {
    let area = 0;
    for (const ring of piece.rings) area += areaOf(ring);
    if (area < -slack) return false;
    total += area;
  }
  if (showsSome && pieces.length === 0) return false;
  return total <= Math.min(polygonArea, regionArea) + slack && total >= polygonArea - (FULL_SPHERE - regionArea) - slack;
}

/** A ring's true area, clockwise positive, read in the lon-lat frame as a cylindrical equal-area map, on which rectangles stay put. */
function cylinderArea(ring: LonLat[]): number {
  let total = 0;
  let previousX = ring[0]![0] * rad;
  let previousY = Math.sin(ring[0]![1] * rad);
  for (let i = 1; i < ring.length; i++) {
    const x = ring[i]![0] * rad;
    const y = Math.sin(ring[i]![1] * rad);
    total += x * previousY - previousX * y;
    previousX = x;
    previousY = y;
  }
  return total / 2;
}

/** The same on a Lambert azimuthal map of the frame, on which the rim of a seamless map is a circle. */
function azimuthalArea(ring: LonLat[]): number {
  let total = 0;
  let previousX = 0;
  let previousY = 0;
  ring.forEach(([lon, lat], i) => {
    const cosLat = Math.cos(lat * rad);
    const k = Math.sqrt(2 / (1 + cosLat * Math.cos(lon * rad)));
    const x = k * cosLat * Math.sin(lon * rad);
    const y = k * Math.sin(lat * rad);
    if (i > 0) total += x * previousY - previousX * y;
    previousX = x;
    previousY = y;
  });
  return total / 2;
}

/** A polygon cut the long way, for when a clip here has gone wrong. */
function fullCut(polygon: GeoJSON.Polygon, m: CompiledProjection): FramePiece[] {
  return cutGeometry(polygon, [m])
    .filter((piece) => piece.inside[0] && !piece.behind[0])
    .map((piece) => ({ closed: piece.closed, rings: piece.coords.map((ring) => ring.map((p) => m.toFrame(p))), lobe: piece.lobes[0] }));
}

/** `moved` is how much area the rings may have gained or lost on the way here, by being drawn straight across where they are out of view. */
function polygonInRects(rings: Turned[], rects: Rect[], item: PolygonItem, m: CompiledProjection, out: FramePiece[], moved = 0): void {
  const points = rings.map((ring) => ring.points);
  // A ring going round its inside, clear of the seam, has that inside in the plane as well. Anything else is d3's to sort out.
  const plain = !points.some(crossesSeam) && planeArea(points[0]!) < 0;
  const planar = plain ? points : cutAtSeam(points, true);
  const bounds = planar.length > 0 ? boundsOf(planar) : null;
  const pieces: FramePiece[] = [];
  let clipped = !plain;
  for (const rect of bounds ? rects : []) {
    if (!overlaps(bounds!, rect)) continue;
    const whole = within(bounds!, rect);
    if (!whole) clipped = true;
    const kept = whole ? planar : cutToRect(planar, true, rect);
    if (kept.length === 0) continue;
    pieces.push({ closed: true, rings: plain && whole ? kept : kept.map((ring) => alongSides(ring, rect)), lobe: rect.lobe });
  }
  // Clear of a rectangle's sides by more than any segment, so the polygon must show there.
  const inRect = ([x, y]: LonLat) => rects.some((r) => x > r.x0 + SEGMENT && x < r.x1 - SEGMENT && y > r.y0 + SEGMENT && y < r.y1 - SEGMENT);
  if (clipped && !isPlausible(pieces, item.area, rectsArea(rects), points[0]!.some(inRect), cylinderArea, moved)) out.push(...fullCut(item.polygon, m));
  else out.push(...pieces);
}

const rectsArea = (rects: Rect[]) => rects.reduce((sum, r) => sum + (r.x1 - r.x0) * rad * (Math.sin(r.y1 * rad) - Math.sin(r.y0 * rad)), 0);

function lineInRects(line: Turned, rects: Rect[], offEdges: ((p: LonLat) => LonLat) | null, out: FramePiece[]): void {
  let path = offSeamSide(line.points);
  if (offEdges) {
    // A line along a lobe's edge goes to one side of it, as in a full cut.
    if (isThin(path)) path = path.map(offEdges);
  }
  for (const part of crossesSeam(path) ? cutAtSeam([path], false) : [path]) {
    const bounds = boundsOf([part]);
    const home = rects.find((rect) => within(bounds, rect));
    if (home) {
      out.push({ closed: false, rings: [part], lobe: home.lobe });
      continue;
    }
    for (const rect of rects) {
      if (!overlaps(bounds, rect)) continue;
      for (const kept of cutToRect([part], false, rect)) out.push({ closed: false, rings: [kept], lobe: rect.lobe });
    }
  }
}

/** Whether a path runs along one meridian or one parallel, to within `THIN_LINE` true degrees: near a pole a longitude is all rounding. */
function isThin(path: LonLat[]): boolean {
  const [lon0, lat0] = path[Math.floor(path.length / 2)]!;
  return path.every(([lon, lat]) => Math.abs(lon - lon0) * Math.cos(lat * rad) < THIN_LINE) || path.every(([, lat]) => Math.abs(lat - lat0) < THIN_LINE);
}

/** Clips paths to the circle `visible` degrees round the frame's centre. */
function cutToCircle(paths: LonLat[][], closed: boolean, visible: number): LonLat[][] {
  const spin = geoRotation([0, 0, CLIP_SPIN]);
  const out: Path[] = [];
  const clip = geoClipCircle(visible * rad)(
    mapPoints(([x, y]) => spin.invert([x / rad, y / rad]) as LonLat, collector(out)),
  );
  run(clip, paths, closed, (p) => {
    const [x, y] = spin(p);
    return [x * rad, y * rad];
  });
  return ringsIn(out);
}

/** A ring or path with any vertex by the circle moved just inside it (`side` -1) or just outside (1), along its bearing from the centre. */
function clearOfRim(ring: LonLat[], visible: number, side: -1 | 1 = -1): LonLat[] {
  const [low, high] = [Math.cos((visible + RIM_BAND) * rad), Math.cos((visible - RIM_BAND) * rad)];
  const moved = (visible + side * RIM_BAND) * rad;
  let out: LonLat[] | null = null;
  ring.forEach(([lon, lat], i) => {
    const cosLat = Math.cos(lat * rad);
    const cosine = cosLat * Math.cos(lon * rad);
    if (cosine <= low || cosine >= high) return;
    const bearing = Math.atan2(cosLat * Math.sin(lon * rad), Math.sin(lat * rad));
    (out ??= [...ring])[i] = pointAtBearing(moved, bearing);
  });
  return out ?? ring;
}

/** The frame point at `distance` radians from the frame's centre, at compass bearing `bearing`. */
function pointAtBearing(distance: number, bearing: number): LonLat {
  const sine = Math.sin(distance);
  return [Math.atan2(sine * Math.sin(bearing), Math.cos(distance)) / rad, Math.asin(sine * Math.cos(bearing)) / rad];
}

function polygonInCircle(rings: Turned[], visible: number, item: PolygonItem, m: CompiledProjection, out: FramePiece[], moved = 0): void {
  const clear = Math.cos(visible * rad - CIRCLE_MARGIN);
  const points = rings.map((ring) => ring.points);
  if (rings[0]!.stereoArea < 0 && rings.every((ring) => ring.minCos > clear)) {
    out.push({ closed: true, rings: points, lobe: undefined });
    return;
  }
  const kept = cutToCircle(points.map((ring) => clearOfRim(ring, visible)), true, visible);
  const pieces: FramePiece[] = kept.length > 0 ? [{ closed: true, rings: kept, lobe: undefined }] : [];
  const regionArea = 2 * Math.PI * (1 - Math.cos(visible * rad));
  const showsSome = rings[0]!.maxCos > clear;
  if (isPlausible(pieces, item.area, regionArea, showsSome, azimuthalArea, ROUND_ANTIPODE * regionArea + moved)) out.push(...pieces);
  else out.push(...fullCut(item.polygon, m));
}

function lineInCircle(line: Turned, visible: number, out: FramePiece[]): void {
  if (line.maxCos < Math.cos(visible * rad + CIRCLE_MARGIN)) return;
  // A line can touch the circle, as a meridian does that passes exactly `visible` degrees from the centre. A vertex on the rim is then
  // read as inside, and d3's clip looks for where the line crosses the circle, finds nothing, and throws. So a vertex on the rim is moved
  // just outside it first: a line that only touches the circle, or runs along it as a globe's limb meridian does, is not shown, as the full
  // cut has it, and one that crosses there crosses a hair further on.
  const paths = line.minCos > Math.cos(visible * rad - CIRCLE_MARGIN) ? [line.points] : cutToCircle([clearOfRim(line.points, visible, 1)], false, visible);
  for (const path of paths) out.push({ closed: false, rings: [path], lobe: undefined });
}

/** The whole front of the map, which is what the sphere comes to. */
function regionPieces(region: Region, out: FramePiece[]): void {
  if (region.rects) {
    for (const r of region.rects) {
      const corners: LonLat[] = [[r.x0, r.y0], [r.x0, r.y1], [r.x1, r.y1], [r.x1, r.y0], [r.x0, r.y0]];
      out.push({ closed: true, rings: [alongSides(corners, r)], lobe: r.lobe });
    }
    return;
  }
  const ring: LonLat[] = [];
  // Clockwise, seen from outside, round the frame's centre.
  for (let bearing = 0; bearing <= 360; bearing += SEGMENT) ring.push(pointAtBearing(region.visible * rad, bearing * rad));
  out.push({ closed: true, rings: [ring], lobe: undefined });
}

/**
 * The cut for one member when only what it shows is wanted: a map at rest, or being dragged, which
 * has to fit in a frame. Unlike `cutGeometry` it needs no way back to the Earth, so everything stays
 * in the frame, where the seams and caps are straight lines. A path clear of them, which is most of
 * them, is not clipped at all, and those that are go through one clip each. A clip has no second
 * attempt here, so a polygon's result is checked, and on a wrong reading it is cut the long way.
 *
 * With `view`, a part of the Earth that holds all the window shows, whatever lies wholly outside it is left out uncut, and a path
 * that runs out of it is drawn straight across where it does. Zoomed in that is nearly everything, which is what lets a coast many
 * times finer be cut in the time of a frame.
 */
export function cutFront(geom: GeoJSON.GeoJsonObject, m: CompiledProjection, view: Cap | null = null): FramePiece[] {
  const region = regionOf(m);
  const matrix = frameMatrix(m);
  const singular = [...m.caps.map((cap) => cap.frameCenter), ...(m.def.singular ?? [])].map(toVector);
  const seam = m.def.seam;
  const offEdges = seam.kind === 'lobes' ? offLobeEdges(seam.lobes, OFF_EDGE) : null;
  const out: FramePiece[] = [];
  for (const item of prepared(geom)) {
    if (item.kind === 'sphere') {
      regionPieces(region, out);
      continue;
    }
    if (!mayShow(item.within, view)) continue;
    if (item.kind === 'polygon') {
      let [paths, moved] = [item.rings, 0];
      if (view) {
        // A ring wholly out of view still has the view on one side of it or the other, so it is kept, drawn straight across, unless
        // that leaves it no inside. Without its outer ring a polygon is nothing.
        const seen = item.rings.map((ring, r) => seenFrom(ring, item.stretches[r]!, view));
        if (seen[0]!.path.length < 12) continue;
        paths = seen.filter((ring) => ring.path.length >= 12).map((ring) => ring.path);
        moved = seen.reduce((sum, ring) => sum + ring.moved, 0);
      }
      const rings = paths.map((ring) => turn(ring, matrix, singular));
      if (region.rects) polygonInRects(rings, region.rects, item, m, out, moved);
      else polygonInCircle(rings, region.visible, item, m, out, moved);
      continue;
    }
    const seen = view ? seenFrom(item.path, item.stretches, view) : null;
    if (seen && !seen.shown) continue;
    const line = turn(seen ? seen.path : item.path, matrix, singular);
    if (region.rects) lineInRects(line, region.rects, offEdges, out);
    else lineInCircle(line, region.visible, out);
  }
  return out;
}
