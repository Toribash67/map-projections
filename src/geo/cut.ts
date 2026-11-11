import { geoArea, geoClipAntimeridian, geoClipCircle, geoInterpolate, geoRotation, geoStream } from 'd3-geo';
import type { GeoPermissibleObjects, GeoStream } from 'd3-geo';
import { geoClipPolygon } from 'd3-geo-polygon';
import type { CompiledProjection, ExcludedCap, Lobe, LonLat } from '../projections/types';
import { hasCells } from './capCells';
import { densify, toVector, type Vector } from './densify';

const rad = Math.PI / 180;
const TAU = 2 * Math.PI;

const SEAM_PULL = 1e-6; // radians
const SEAM_STEP = Math.PI / 6; // radians
// How far (degrees) a line's vertex keeps from a lobe's edge, beyond the edge's pull, unless it lies exactly on it.
const LOBE_BAND = 3e-6;
// A point this close (true degrees) to a seam lies on it, whichever side rounding has it.
const ON_SEAM = 1e-9;
// Each further lobed seam pulls in half as far, so that its edges stay clear of an earlier seam's
// when the two line up.
export const LOBE_PULL = 1e-6; // degrees
// How far (degrees) a point lying exactly on a lobe's edge is moved to one side of it. A clip takes anything within 1e-6 radians of
// its edge for on it, and cannot tell which side a path along its edge is on: this is clear of that, and a hundredth of a pixel.
export const OFF_EDGE = 2e-4;
// A lobe stops short of the pole. Any closer and its end edge is too short for the clip's
// arithmetic, and lies inside the turn that a seam makes round the pole. Each further lobed
// seam stops twice as far off, because two end edges at one distance cross over and over.
const LOBE_POLE_PULL = 2e-3; // degrees
// How near a lobe edge a frame point has to be to count as lying exactly on it.
const ON_LOBE_EDGE = 1e-9; // degrees
const LOBE_EDGE_STEP = 30; // degrees
// `geoClipCircle` reads what is inside from one point on its circle. Spinning the circle
// about its centre moves that point off the meridians and poles where earlier cuts lie.
// The spins are not round numbers, as it also mishandles a line along the clip's central
// meridian, and a round spin puts graticule lines there at ordinary centre longitudes.
// The first attempt suits nearly everything; the others are for a cut that comes out wrong.
// Seam order counts too: which seam crosses the others' narrow gaps decides what can go wrong.
// So does the pull: seams crossing at a very shallow angle run within d3's tolerance of each
// other for a long way, which only a wider gap gets clear of.
export const CLIP_SPIN = 37.30681;
const ATTEMPTS = [
  { spin: CLIP_SPIN, reverseSeams: false, pullScale: 1 },
  { spin: 61.71337, reverseSeams: true, pullScale: 1 },
  { spin: 13.93271, reverseSeams: false, pullScale: 1 },
  { spin: 83.12459, reverseSeams: true, pullScale: 1 },
  { spin: CLIP_SPIN, reverseSeams: false, pullScale: 8 },
  { spin: 61.71337, reverseSeams: true, pullScale: 8 },
];
// How far a cut's total area may drift from the input's, at the normal pull. Correct cuts lose
// at most 2.3e-4, with five seams, to the narrow gaps along them; wrong ones are off by a fair
// part of the sphere.
const AREA_TOLERANCE = 5e-4; // steradians
// A ring reading this close to 4π is a zero-width sliver turned inside out. No real ring can
// read so: the smallest cap leaves at least 9.6e-6 sr of the sphere uncovered.
const SLIVER_AREA = 1e-9; // steradians
// Above this latitude in a frame, longitude says nothing about which side of the seam a point is on.
const SEAM_CHECK_LAT = 89.9; // degrees
// Keeps a cap's edge off anything lying exactly on it: the meridian ±180, where Antarctica's
// ring has an edge, or another member's frame pole. There it also has to clear the turn a seam
// makes round the pole, or the ring crosses itself, as do a lobe's ends.
const CAP_PULL = 2.4e-3; // degrees
// How far past that turn, as a share of its radius, a cap's edge or a lobe's end has to stay.
const TURN_CLEARANCE = 1.2;

export type Piece = {
  /** A polygon's rings, or a single line. A ring repeats its first point at the end. */
  closed: boolean;
  /** Geographic, densified to at most 2° per segment, and finer close to a cap's centre. */
  coords: LonLat[][];
  /** Per member: outside its clip caps? */
  inside: boolean[];
  /** Per member: inside a 'behind' cap? */
  behind: boolean[];
  /** Per member: inside a clip cap big enough for cells of ocean (see `hasCells`)? Its ocean is filled from the cells. */
  celled: boolean[];
  /** Per member: the id of the lobe holding the piece. */
  lobes: (number | undefined)[];
};

/** Geometry on its way through the cuts, with what each cut so far said about it. */
type Part = {
  geom: GeoPermissibleObjects;
  inCap: Map<string, boolean>;
  lobe: Map<string, number>;
};

export type Path = { closed: boolean; coords: LonLat[][] };
type Clip = (sink: GeoStream) => GeoStream;
export type PointMap = (p: LonLat) => LonLat;
/** How far one seam's cut pulls its edges in: radians for `seamPull`, degrees for the rest. */
type Pulls = { seamPull: number; lobePull: number; polePull: number };
/** Into and out of the space a clip works in, both in degrees. */
type ClipFrame = { to: PointMap; from: PointMap };

/** Forwards everything but points. Clips swap their methods as they go, so each call looks up the current one. */
function forwarding(sink: GeoStream): Omit<GeoStream, 'point'> {
  return {
    lineStart: () => sink.lineStart(),
    lineEnd: () => sink.lineEnd(),
    polygonStart: () => sink.polygonStart(),
    polygonEnd: () => sink.polygonEnd(),
    sphere: () => sink.sphere?.(),
  };
}

/** Passes a stream on with every point moved by `f`. */
export function mapPoints(f: PointMap, sink: GeoStream): GeoStream {
  return {
    ...forwarding(sink),
    point(x, y) {
      const [a, b] = f([x, y]);
      sink.point(a, b);
    },
  };
}

/** Closes a ring's end on its start, as GeoJSON and `geoStream` want it; clips leave that to the reader. */
function closeRing(ring: LonLat[]): LonLat[] {
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (!first || !last || (first[0] === last[0] && first[1] === last[1])) return ring;
  return [...ring, first];
}

/**
 * A sink that gathers one path per polygon and per line, dropping points and
 * anything too short to draw. Polygon starts can nest: `geoClipPolygon` opens
 * its own inside the clip's when the subject surrounds the whole clip polygon.
 */
export function collector(out: Path[]): GeoStream {
  let depth = 0;
  let rings: LonLat[][] = [];
  let line: LonLat[] | null = null;
  return {
    point(x, y) {
      line?.push([x, y]);
    },
    lineStart() {
      line = [];
    },
    lineEnd() {
      if (depth > 0) {
        const ring = closeRing(line!);
        if (ring.length >= 4) rings.push(ring);
      } else if (line!.length >= 2) {
        out.push({ closed: false, coords: [line!] });
      }
      line = null;
    },
    polygonStart() {
      if (depth++ === 0) rings = [];
    },
    polygonEnd() {
      if (--depth === 0 && rings.length > 0) out.push({ closed: true, coords: rings });
    },
    sphere() {},
  };
}

function pathGeometry(path: Path): GeoPermissibleObjects {
  return path.closed
    ? { type: 'Polygon', coordinates: path.coords }
    : { type: 'LineString', coordinates: path.coords[0]! };
}

/** Runs a part through a clip that works in radians and returns what comes out, in degrees. */
function clipPaths(part: Part, frame: ClipFrame, clip: Clip): Path[] {
  const out: Path[] = [];
  const fromClip = mapPoints(([x, y]) => frame.from([x / rad, y / rad]), collector(out));
  const toClip = mapPoints(
    (p) => {
      const [x, y] = frame.to(p);
      return [x * rad, y * rad];
    },
    clip(fromClip),
  );
  geoStream(part.geom, toClip);
  return out;
}

/** The space where `centre` (a frame point) sits at [0, 0], the only place `geoClipCircle` can clip around. */
function aroundCentre(m: CompiledProjection, centre: LonLat, spin: number): ClipFrame {
  const turn = geoRotation([-centre[0], -centre[1], spin]);
  return { to: (p) => turn(m.toFrame(p)), from: (p) => m.fromFrame(turn.invert(p)) };
}

/** Splits a part into the side outside the cap and the side inside it. */
function splitAtCap(part: Part, m: CompiledProjection, cap: ExcludedCap, key: string, spin: number, pull: number): Part[] {
  const [lon, lat] = cap.frameCenter;
  const radius = cap.radius + pull;
  const child = (inCap: boolean) => (path: Path): Part => ({
    ...part,
    geom: pathGeometry(path),
    inCap: new Map(part.inCap).set(key, inCap),
  });
  const kept = clipPaths(part, aroundCentre(m, [lon + 180, -lat], spin), geoClipCircle((180 - radius) * rad));
  const capped = clipPaths(part, aroundCentre(m, cap.frameCenter, spin), geoClipCircle(radius * rad));
  return [...kept.map(child(false)), ...capped.map(child(true))];
}

/** Whether two points lie along one edge of the frame: one side of the seam, or one pole. */
const alongFrameEdge = (a: LonLat, b: LonLat) =>
  (a[0] === b[0] && Math.abs(a[0]) === Math.PI) || (a[1] === b[1] && Math.abs(a[1]) === Math.PI / 2);

/** Moves a point a true distance of `pull` off the antimeridian and the poles; in longitude that grows toward the poles. */
function pullOffSeam([lambda, phi]: LonLat, pull: number): LonLat {
  const latLimit = Math.PI / 2 - pull;
  const pulledPhi = Math.max(-latLimit, Math.min(latLimit, phi));
  const lonLimit = Math.PI - pull / Math.cos(pulledPhi);
  return [Math.max(-lonLimit, Math.min(lonLimit, lambda)), pulledPhi];
}

/**
 * How far (true radians) a line lying on a seam is set off it: beyond the farthest that the seams'
 * pulls, doubling from seam to seam, and d3's own shift can carry a point. No more than that, as
 * a map tears any distance apart close to a cap's centre, and a line may run by one on another map.
 */
const seamGap = (seams: number) => 1.5 * SEAM_PULL * 2 ** Math.max(1, seams);

const isOnSeam = (p: LonLat) => (180 - Math.abs(p[0])) * Math.cos(p[1] * rad) < ON_SEAM;

/**
 * Sends a path lying exactly on a seam to one fixed side of it, given the path in the frame. Left to
 * themselves its points take either side by rounding, so the line would hop across the whole map
 * between one cut and the next. A run along the seam goes to the west side; a lone point on it, such
 * as a line's end, goes with its neighbours, or is left if the line crosses there. Returns `frame`
 * itself when there is nothing to move.
 */
export function offSeamSide(frame: LonLat[], seams = 1): LonLat[] {
  const onSeam = (p: LonLat | undefined) => p !== undefined && isOnSeam(p);
  // A step from the seam's own meridian to the opposite one runs through a pole and then along the seam.
  const goesWest = (neighbour: LonLat) => neighbour[0] < ON_SEAM;
  let moved: LonLat[] | null = null;
  const move = (i: number, west: boolean) => {
    const [lambda, phi] = pullOffSeam([(west ? -180 : 180) * rad, frame[i]![1] * rad], seamGap(seams));
    (moved ??= [...frame])[i] = [lambda / rad, phi / rad];
  };
  frame.forEach((point, i) => {
    if (!onSeam(point)) return;
    const [before, after] = [frame[i - 1], frame[i + 1]];
    if (onSeam(before) || onSeam(after)) move(i, true);
    // At a pole a point lies on the seam only in name, and has no need to go anywhere.
    else if (Math.abs(point[1]) > SEAM_CHECK_LAT) return;
    else if (before && after) {
      if (goesWest(before) === goesWest(after)) move(i, goesWest(before));
    } else if (before || after) move(i, goesWest(before ?? after!));
  });
  return moved ?? frame;
}

/** The lines of a geometry after `f`, and the rest of it as it was. */
function withLines(geom: any, f: (path: LonLat[]) => LonLat[]): any {
  switch (geom?.type) {
    case 'FeatureCollection':
      return { ...geom, features: geom.features.map((feature: unknown) => withLines(feature, f)) };
    case 'Feature':
      return { ...geom, geometry: withLines(geom.geometry, f) };
    case 'GeometryCollection':
      return { ...geom, geometries: geom.geometries.map((part: unknown) => withLines(part, f)) };
    case 'MultiLineString':
      return { ...geom, coordinates: geom.coordinates.map(f) };
    case 'LineString':
      return { ...geom, coordinates: f(geom.coordinates) };
    default:
      return geom;
  }
}

/**
 * Moves a vertex off the band where a lobe's edge is pulled in, given the path in the frame. There
 * the polygon clip can lose the rest of the line, or misplace the vertex by 0.005 degrees. The
 * graticule has vertices right there: d3 ends its long meridians 1e-6 degrees off the equator.
 */
function offLobeBands(frame: LonLat[], lobes: Lobe[]): LonLat[] {
  const lats = [...new Set(lobes.flatMap((l) => [l.latMin, l.latMax]))];
  let moved: LonLat[] | null = null;
  frame.forEach(([lon, lat], i) => {
    for (const edge of lats) {
      const away = lat - edge;
      if (away !== 0 && Math.abs(away) < LOBE_BAND) (moved ??= [...frame])[i] = [lon, edge + Math.sign(away) * LOBE_BAND];
    }
  });
  return moved ?? frame;
}

/**
 * Sets each line clear of every member's seam, one frame at a time, before any cut: on one fixed
 * side of a seam it lies along, and clear of a lobe's edge.
 */
function linesOffSeams(geom: GeoJSON.GeoJsonObject, members: CompiledProjection[]): GeoJSON.GeoJsonObject {
  const seamed = members.filter((m) => m.def.seam.kind !== 'none');
  const seams = new Set(seamed.filter((m) => m.def.seam.kind === 'antimeridian').map(seamKey)).size;
  return withLines(geom, (path) =>
    seamed.reduce((current, m) => {
      const seam = m.def.seam;
      const frame = current.map((p) => m.toFrame(p));
      const moved = seam.kind === 'lobes' ? offLobeBands(offSeamSide(frame, seams), seam.lobes) : offSeamSide(frame, seams);
      return moved === frame ? current : current.map((p, i) => (moved[i] === frame[i] ? p : m.fromFrame(moved[i]!)));
    }, path),
  );
}

/**
 * Pulls what `geoClipAntimeridian` emits off the seam, so numeric rotation cannot
 * flip a point to the other side. A later clip takes points closer than 1e-6
 * radians for one point: where it crosses the seam's two sides that close together
 * it joins rings across the seam, which keeps the spherical area and ruins the
 * map. So the sides stay a true distance apart at every latitude. Steps along the
 * frame's edge are kept short, because the pull varies along it and because a later
 * clip cannot place a segment across a pole, so a ring that d3 runs through a pole
 * goes round it instead. `pull` shrinks from seam to seam, so that moving a point
 * on this seam can never carry it across an earlier one, however close or shallowly
 * the two meet.
 */
function offSeam(sink: GeoStream, pull: number): GeoStream {
  const emit = (p: LonLat) => {
    const [lambda, phi] = pullOffSeam(p, pull);
    sink.point(lambda, phi);
  };
  let previous: LonLat | null = null;
  return {
    ...forwarding(sink),
    point(lambda, phi) {
      const next: LonLat = [lambda, phi];
      if (previous && alongFrameEdge(previous, next)) {
        const [dLambda, dPhi] = [lambda - previous[0], phi - previous[1]];
        const steps = Math.ceil(Math.max(Math.abs(dLambda), Math.abs(dPhi)) / SEAM_STEP);
        for (let i = 1; i < steps; i++) emit([previous[0] + (dLambda * i) / steps, previous[1] + (dPhi * i) / steps]);
      }
      emit(next);
      previous = next;
    },
    lineStart() {
      previous = null;
      sink.lineStart();
    },
  };
}

/** Clockwise, in frame degrees, with the edges pulled in so that neighbouring lobes never share a point. */
function lobePolygon(lobe: Lobe, { lobePull, polePull }: Pulls): GeoJSON.Polygon {
  const west = lobe.lonMin + lobePull;
  const east = lobe.lonMax - lobePull;
  const south = lobe.latMin === -90 ? -90 + polePull : lobe.latMin + lobePull;
  const north = lobe.latMax === 90 ? 90 - polePull : lobe.latMax - lobePull;
  // Parallels are not great circles, and a lobe's can be wider than a half turn.
  const steps = Math.ceil((east - west) / LOBE_EDGE_STEP);
  const northEdge: LonLat[] = [];
  const southEdge: LonLat[] = [];
  for (let i = 0; i <= steps; i++) {
    northEdge.push([west + ((east - west) * i) / steps, north]);
    southEdge.push([east - ((east - west) * i) / steps, south]);
  }
  // A clip reads what is inside from the ring's first point. A corner will not do: at the frame's
  // antipode four lobes' corners meet, and any seam sharing that antipode passes right by them.
  const start: LonLat = [west, (south + north) / 2];
  return { type: 'Polygon', coordinates: [closeRing([start, ...northEdge, ...southEdge])] };
}

/**
 * Moves a frame point lying exactly on a lobe edge out of the gap between lobes,
 * always to the same side. A line running along an edge, as the equator and some
 * meridians do at the default orientation, would otherwise lie in no lobe and be
 * lost. Only points exactly on it: an earlier seam's edges lie close by, and must
 * stay on their own side.
 */
export function offLobeEdges(lobes: Lobe[], gap: number): PointMap {
  // `scale` is the true length of a degree of the value there: near a pole a longitude is rounding noise many times the size it has at the equator.
  const off = (value: number, edges: number[], top: number, scale: number) => {
    const edge = edges.find((e) => Math.abs(value - e) * scale <= ON_LOBE_EDGE);
    if (edge === undefined) return value;
    return edge === top ? edge - gap : edge + gap;
  };
  const lons = [...new Set(lobes.flatMap((l) => [l.lonMin, l.lonMax]))];
  const lats = [...new Set(lobes.flatMap((l) => [l.latMin, l.latMax]))];
  return ([lon, lat]) => [off(lon, lons, 180, Math.cos(lat * rad)), off(lat, lats, 90, 1)];
}

/** Splits a part along the member's seam. */
function cutSeam(part: Part, m: CompiledProjection, key: string, pulls: Pulls): Part[] {
  const frame: ClipFrame = { to: m.toFrame, from: m.fromFrame };
  const child = (path: Path): Part => ({ ...part, geom: pathGeometry(path) });
  const seam = m.def.seam;
  switch (seam.kind) {
    case 'none':
      return [part];
    case 'antimeridian':
      return clipPaths(part, frame, (sink) => geoClipAntimeridian(offSeam(sink, pulls.seamPull))).map(child);
    case 'lobes': {
      const off = offLobeEdges(seam.lobes, OFF_EDGE);
      const lobeFrame: ClipFrame = { to: (p) => off(m.toFrame(p)), from: m.fromFrame };
      let cut = seam.lobes.map((lobe) => ({ lobe, paths: clipPaths(part, lobeFrame, geoClipPolygon(lobePolygon(lobe, pulls))) }));
      // The polygon clip reads whether a line starts inside from the line's first point, and can read it wrong: it then gives the
      // parts of the line outside the lobe in place of those inside. A line found outside its lobe says so, and the lines are cut
      // again, in the plain way, lobe by lobe.
      const strays = cut.some(({ lobe, paths }) => paths.some((path) => !path.closed && path.coords[0]!.some((p) => !inLobe(lobeFrame.to(p), lobe, pulls, STRAY))));
      if (strays) {
        const lines: Path[] = [];
        geoStream(part.geom, collector(lines));
        const open = lines.filter((path) => !path.closed).map((path) => densify(path.coords[0]!, []).map(lobeFrame.to));
        cut = cut.map(({ lobe, paths }) => ({
          lobe,
          paths: [
            ...paths.filter((path) => path.closed),
            ...open.flatMap((line) => lineInLobe(line, lobe, pulls)).map((line): Path => ({ closed: false, coords: [line.map(lobeFrame.from)] })),
          ],
        }));
      }
      return cut.flatMap(({ lobe, paths }) => paths.map((path) => ({ ...child(path), lobe: new Map(part.lobe).set(key, lobe.id) })));
    }
  }
}

// A point of a line this far (degrees) outside its lobe has not been cut to the lobe at all.
const STRAY = 1e-3;
// How many times the step from a point inside a lobe to the next one outside is halved to find where the line leaves.
const HALVINGS = 40;

/** Whether a frame point is within a lobe's rectangle, as `lobePolygon` pulls it in, or no more than `slack` degrees outside. */
function inLobe([lon, lat]: LonLat, lobe: Lobe, { lobePull, polePull }: Pulls, slack = 0): boolean {
  const south = lobe.latMin === -90 ? -90 + polePull : lobe.latMin + lobePull;
  const north = lobe.latMax === 90 ? 90 - polePull : lobe.latMax - lobePull;
  if (lat < south - slack || lat > north + slack) return false;
  // Right by a pole a longitude says nothing.
  if (Math.abs(lat) > 89.9) return true;
  return lon >= lobe.lonMin + lobePull - slack / Math.cos(lat * rad) && lon <= lobe.lonMax - lobePull + slack / Math.cos(lat * rad);
}

/**
 * The parts of a line, given in the frame with steps of two degrees at most, that lie in a lobe: cut in the plain way, by walking the
 * line and finding where it enters and leaves by halving the step across the edge. Slower than a clip and no cleverer, and so not
 * wrong: it is what a clip's answer is put right with.
 */
function lineInLobe(line: LonLat[], lobe: Lobe, pulls: Pulls): LonLat[][] {
  const inside = (p: LonLat) => inLobe(p, lobe, pulls);
  /** The point nearest `outer` that is still in the lobe, on the way from `inner`, which is. */
  const edgeBetween = (inner: LonLat, outer: LonLat): LonLat => {
    const along = geoInterpolate(inner, outer);
    let [low, high] = [0, 1];
    for (let i = 0; i < HALVINGS; i++) {
      const middle = (low + high) / 2;
      if (inside(along(middle) as LonLat)) low = middle;
      else high = middle;
    }
    return low === 0 ? inner : (along(low) as LonLat);
  };
  const out: LonLat[][] = [];
  let current: LonLat[] | null = null;
  line.forEach((point, i) => {
    const previous = line[i - 1];
    if (inside(point)) {
      if (!current) {
        current = previous ? [edgeBetween(point, previous)] : [];
        out.push(current);
      }
      current.push(point);
    } else if (current) {
      current.push(edgeBetween(previous!, point));
      current = null;
    }
  });
  return out.filter((path) => path.length >= 2);
}

/** Where a member's frame lands, as two probe points; that pins down a rotation. */
const frameKey = (m: CompiledProjection) => [m.toFrame([0, 0]), m.toFrame([90, 0])];
/**
 * Two caps with the same key are one circle on the sphere, whichever members and modes they
 * belong to. Each component of the centre's unit vector is rounded to 1e-5, so two centres with one
 * key can be up to the diagonal of that bin apart, 1.7e-5 radians or about 110 m: circles closer
 * than that cross at too shallow an angle for the clips, and a flag that far off a cap's edge
 * makes no difference on a map.
 */
function capKey(m: CompiledProjection, cap: ExcludedCap): string {
  const centre = toVector(m.fromFrame(cap.frameCenter));
  return JSON.stringify([centre.map((v) => +v.toFixed(5)), +cap.radius.toFixed(3)]);
}
const seamKey = (m: CompiledProjection) => JSON.stringify([frameKey(m), m.def.seam]);

function toPieces(part: Part, members: CompiledProjection[], singular: Vector[]): Piece[] {
  const inCapOfMode = (m: CompiledProjection, mode: ExcludedCap['mode'], wanted = (_: ExcludedCap) => true) =>
    m.caps.some((cap) => cap.mode === mode && wanted(cap) && part.inCap.get(capKey(m, cap)));
  const inside = members.map((m) => !inCapOfMode(m, 'clip'));
  const behind = members.map((m) => inCapOfMode(m, 'behind'));
  const celled = members.map((m) => inCapOfMode(m, 'clip', hasCells));
  const lobes = members.map((m) => part.lobe.get(seamKey(m)));
  const paths: Path[] = [];
  geoStream(part.geom, collector(paths));
  return paths.map((path) => ({
    closed: path.closed,
    coords: path.coords.map((coords) => densify(coords, singular)),
    inside,
    behind,
    celled,
    lobes,
  }));
}

/**
 * One attempt at the cuts. A circle or seam that several members share is cut
 * only once: clipping again along an existing edge is numerically unstable.
 */
function cutParts(
  geom: GeoJSON.GeoJsonObject,
  members: CompiledProjection[],
  { spin, reverseSeams, pullScale }: (typeof ATTEMPTS)[number],
): Part[] {
  let parts: Part[] = [{ geom: geom as GeoPermissibleObjects, inCap: new Map(), lobe: new Map() }];
  const done = new Set<string>();
  const cutOnce = (key: string, cut: (part: Part) => Part[]) => {
    if (done.has(key)) return false;
    done.add(key);
    parts = parts.flatMap(cut);
    return true;
  };
  let seamsLeft = new Set(members.filter((m) => m.def.seam.kind === 'antimeridian').map(seamKey)).size;
  // 1, 3, 7, 15, 31 x the base pull, ending at 1. Each exceeds all that later seams can move a
  // point: their pulls, plus the `SEAM_PULL` that d3 itself shifts a point crossing a seam.
  const seamPullFor = (left: number) => SEAM_PULL * pullScale * (2 ** Math.max(1, left) - 1);
  const turnClearance = (TURN_CLEARANCE * seamPullFor(seamsLeft)) / rad;
  // Circles first: a clip around a circle stumbles over narrow gaps left by a seam.
  const capPull = Math.max(CAP_PULL, turnClearance);
  for (const m of members) {
    for (const cap of m.caps) {
      const key = capKey(m, cap);
      cutOnce(key, (part) => splitAtCap(part, m, cap, key, spin, capPull));
    }
  }
  // Lobes last: `geoClipAntimeridian` reads what is inside from the frame's south pole,
  // which can lie in a gap between lobes.
  const isLobed = (m: CompiledProjection) => (m.def.seam.kind === 'lobes' ? 1 : 0);
  const ordered = reverseSeams ? [...members].reverse() : members;
  let lobedCuts = 0;
  for (const m of [...ordered].sort((a, b) => isLobed(a) - isLobed(b))) {
    const key = seamKey(m);
    const pulls: Pulls = {
      seamPull: seamPullFor(seamsLeft),
      lobePull: LOBE_PULL / 2 ** lobedCuts,
      polePull: Math.max(LOBE_POLE_PULL, turnClearance) * 2 ** lobedCuts,
    };
    if (!cutOnce(key, (part) => cutSeam(part, m, key, pulls))) continue;
    if (m.def.seam.kind === 'antimeridian') seamsLeft--;
    lobedCuts += isLobed(m);
  }
  return parts;
}

/** The polygon rings or the line that a cut part holds. */
function pathsOf(geom: GeoPermissibleObjects): LonLat[][] {
  if (geom.type === 'Polygon') return (geom as GeoJSON.Polygon).coordinates as LonLat[][];
  if (geom.type === 'LineString') return [(geom as GeoJSON.LineString).coordinates as LonLat[]];
  return [];
}

/** Drops the zero-width rings that read as nearly the whole sphere. */
function withoutSlivers(parts: Part[]): Part[] {
  return parts.flatMap((part) => {
    if (part.geom.type !== 'Polygon') return [part];
    const rings = pathsOf(part.geom);
    const coordinates = rings.filter((ring) => 2 * TAU - geoArea({ type: 'Polygon', coordinates: [ring] }) > SLIVER_AREA);
    if (coordinates.length === rings.length) return [part];
    return coordinates.length > 0 ? [{ ...part, geom: { type: 'Polygon', coordinates } as GeoPermissibleObjects }] : [];
  });
}

/** Whether a part steps across the frame's antimeridian, which every seam includes. That leaves the area right and the map wrong. */
function crossesSeam(parts: Part[], m: CompiledProjection): boolean {
  for (const { geom } of parts) {
    for (const path of pathsOf(geom)) {
      let previous: LonLat | null = null;
      for (const point of path) {
        const next = m.toFrame(point);
        if (previous && Math.abs(next[0] - previous[0]) > 180) {
          if (Math.abs(next[1]) <= SEAM_CHECK_LAT && Math.abs(previous[1]) <= SEAM_CHECK_LAT) return true;
        }
        previous = next;
      }
    }
  }
  return false;
}

/**
 * Splits geometry on the sphere at the caps and seams of every member, so that
 * each piece lies wholly on one side of each of them. The clips can go wrong when
 * cuts line up exactly. That shows as a total area off the input's, or, once two
 * seams have been cut, as a piece stepping across a seam, so such a cut is redone
 * another way and the best attempt returned. One seam needs no such check: it is
 * the last clip, and nothing can undo it.
 */
export function cutGeometry(input: GeoJSON.GeoJsonObject, members: CompiledProjection[]): Piece[] {
  // The parts of a collection are cut one by one. A cut is judged, and redone, as a whole: taken together, one way would go wrong
  // for one cell of a layer and another way for another, and no way would be right for them all.
  if (input.type === 'GeometryCollection') return (input as GeoJSON.GeometryCollection).geometries.flatMap((part) => cutGeometry(part, members));
  const geom = linesOffSeams(input, members);
  const expected = geoArea(geom as GeoPermissibleObjects);
  const seams = new Set(members.filter((m) => m.def.seam.kind !== 'none').map(seamKey));
  const seamed = seams.size > 1 ? members.filter((m) => m.def.seam.kind !== 'none') : [];
  let best: Part[] = [];
  let bestScore = Infinity;
  for (const attempt of ATTEMPTS) {
    const parts = withoutSlivers(cutParts(geom, members, attempt));
    // Wider gaps lose more area, so a wider pull is allowed to. A score up to 1 is a good cut.
    const tolerance = AREA_TOLERANCE * attempt.pullScale;
    let score = Math.abs(parts.reduce((sum, part) => sum + geoArea(part.geom), 0) - expected) / tolerance;
    // A step across a seam ranks below any cut free of one, and above a cut with the wrong area.
    if (score <= 1 && seamed.some((m) => crossesSeam(parts, m))) score += 2;
    if (score < bestScore) {
      best = parts;
      bestScore = score;
    }
    if (bestScore <= 1) break;
  }
  // A map is singular at the centre of each of its caps, and wherever else its definition says.
  const singular = members.flatMap((m) => [...m.caps.map((cap) => cap.frameCenter), ...(m.def.singular ?? [])].map((p) => toVector(m.fromFrame(p))));
  return best.flatMap((part) => toPieces(part, members, singular));
}
