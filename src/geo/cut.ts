import { geoArea, geoClipAntimeridian, geoClipCircle, geoDistance, geoInterpolate, geoRotation, geoStream } from 'd3-geo';
import type { GeoPermissibleObjects, GeoStream } from 'd3-geo';
import { geoClipPolygon } from 'd3-geo-polygon';
import type { CompiledProjection, ExcludedCap, Lobe, LonLat } from '../projections/types';

const rad = Math.PI / 180;
const TAU = 2 * Math.PI;

const MAX_SEGMENT = 2; // degrees
const MIN_SEGMENT = 0.01; // degrees
// A step near a singular point spans at most this many radians as seen from it.
const SINGULAR_STEP = 0.1;
const SEAM_PULL = 1e-6; // radians
const SEAM_STEP = Math.PI / 6; // radians
// Each further lobed seam pulls in half as far, so that its edges stay clear of an earlier seam's
// when the two line up.
const LOBE_PULL = 1e-6; // degrees
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
const ATTEMPTS = [
  { spin: 37.30681, reverseSeams: false },
  { spin: 61.71337, reverseSeams: true },
  { spin: 13.93271, reverseSeams: false },
  { spin: 83.12459, reverseSeams: true },
];
// How far a cut's total area may drift from the input's. Correct cuts lose at most 2.3e-4, with
// five seams, to the narrow gaps along them; wrong ones are off by a fair part of the sphere.
const AREA_TOLERANCE = 5e-4; // steradians
// A ring reading this close to 4π is a zero-width sliver turned inside out. No real ring can
// read so: the smallest cap leaves at least 9.6e-6 sr of the sphere uncovered.
const SLIVER_AREA = 1e-9; // steradians
// Above this latitude in a frame, longitude says nothing about which side of the seam a point is on.
const SEAM_CHECK_LAT = 89.9; // degrees
// Keeps a cap's edge off anything lying exactly on it: the meridian ±180, where Antarctica's
// ring has an edge, or another member's frame pole. There it has to clear the turn a seam
// makes round the pole, of radius up to 31 x `SEAM_PULL` with five seams, or the ring crosses itself.
const CAP_PULL = 2.4e-3; // degrees

export type Piece = {
  /** A polygon's rings, or a single line. A ring repeats its first point at the end. */
  closed: boolean;
  /** Geographic, densified to at most 2° per segment, and finer close to a cap's centre. */
  coords: LonLat[][];
  /** Per member: outside its clip caps? */
  inside: boolean[];
  /** Per member: inside a 'behind' cap? */
  behind: boolean[];
  /** Per member: the central longitude (degrees) of the lobe holding the piece. */
  lobes: (number | undefined)[];
};

/** Geometry on its way through the cuts, with what each cut so far said about it. */
type Part = {
  geom: GeoPermissibleObjects;
  inCap: Map<string, boolean>;
  lobe: Map<string, number>;
};

type Path = { closed: boolean; coords: LonLat[][] };
type Clip = (sink: GeoStream) => GeoStream;
type PointMap = (p: LonLat) => LonLat;
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
function mapPoints(f: PointMap, sink: GeoStream): GeoStream {
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
function collector(out: Path[]): GeoStream {
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
function splitAtCap(part: Part, m: CompiledProjection, cap: ExcludedCap, key: string, spin: number): Part[] {
  const [lon, lat] = cap.frameCenter;
  const radius = cap.radius + CAP_PULL;
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
  return { type: 'Polygon', coordinates: [closeRing([...northEdge, ...southEdge])] };
}

/**
 * Moves a frame point lying exactly on a lobe edge out of the gap between lobes,
 * always to the same side. A line running along an edge, as the equator and some
 * meridians do at the default orientation, would otherwise lie in no lobe and be
 * lost. Only points exactly on it: an earlier seam's edges lie close by, and must
 * stay on their own side.
 */
function offLobeEdges(lobes: Lobe[], gap: number): PointMap {
  const off = (value: number, edges: number[], top: number) => {
    const edge = edges.find((e) => Math.abs(value - e) <= ON_LOBE_EDGE);
    if (edge === undefined) return value;
    return edge === top ? edge - gap : edge + gap;
  };
  const lons = lobes.flatMap((l) => [l.lonMin, l.lonMax]);
  const lats = lobes.flatMap((l) => [l.latMin, l.latMax]);
  return ([lon, lat]) => [off(lon, lons, 180), off(lat, lats, 90)];
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
      const off = offLobeEdges(seam.lobes, 2 * pulls.lobePull);
      const lobeFrame: ClipFrame = { to: (p) => off(m.toFrame(p)), from: m.fromFrame };
      return seam.lobes.flatMap((lobe) =>
        clipPaths(part, lobeFrame, geoClipPolygon(lobePolygon(lobe, pulls))).map((path) => ({
          ...child(path),
          lobe: new Map(part.lobe).set(key, lobe.centralLon),
        })),
      );
    }
  }
}

/** Where a member's frame lands, as two probe points; that pins down a rotation. */
const frameKey = (m: CompiledProjection) => [m.toFrame([0, 0]), m.toFrame([90, 0])];
/** Two caps with the same key are the same circle on the sphere, whichever members and modes they belong to. */
function capKey(m: CompiledProjection, cap: ExcludedCap): string {
  const centre = toVector(m.fromFrame(cap.frameCenter));
  return JSON.stringify([centre.map((v) => +v.toFixed(9)), +cap.radius.toFixed(9)]);
}
const seamKey = (m: CompiledProjection) => JSON.stringify([frameKey(m), m.def.seam]);

type Vector = [number, number, number];

function toVector([lon, lat]: LonLat): Vector {
  const cosLat = Math.cos(lat * rad);
  return [cosLat * Math.cos(lon * rad), cosLat * Math.sin(lon * rad), Math.sin(lat * rad)];
}

/** Angle in degrees from a point to the nearest of `singular`, or Infinity if there are none. */
function distanceToNearest(point: LonLat, singular: Vector[]): number {
  if (singular.length === 0) return Infinity;
  const v = toVector(point);
  let closest = -1;
  for (const s of singular) closest = Math.max(closest, v[0] * s[0] + v[1] * s[1] + v[2] * s[2]);
  return Math.acos(Math.min(1, closest)) / rad;
}

/** The longest step (degrees) to take from a point this far from the nearest singular point. */
const stepAt = (distance: number) =>
  Math.min(MAX_SEGMENT, Math.max(MIN_SEGMENT, distance * SINGULAR_STEP));

/**
 * Adds great-circle points so that no segment is longer than `MAX_SEGMENT`, and
 * shorter near a singular point. Any map tears or fans out round a cap's centre:
 * a segment passing close by subtends a wide angle there, so its ends land far
 * apart on the map, however short it is on the sphere.
 */
function densify(path: LonLat[], singular: Vector[]): LonLat[] {
  const out: LonLat[] = [];
  path.forEach((point, i) => {
    if (i > 0) {
      const previous = path[i - 1]!;
      const length = geoDistance(previous, point) / rad;
      const near = distanceToNearest(previous, singular);
      if (length > stepAt(near)) {
        const along = geoInterpolate(previous, point);
        if (stepAt(near - length) >= MAX_SEGMENT) {
          const steps = Math.ceil(length / MAX_SEGMENT);
          for (let s = 1; s < steps; s++) out.push(along(s / steps));
        } else {
          for (let walked = stepAt(near); walked < length; ) {
            const next = along(walked / length);
            out.push(next);
            walked += stepAt(distanceToNearest(next, singular));
          }
        }
      }
    }
    out.push(point);
  });
  return out;
}

function toPieces(part: Part, members: CompiledProjection[], singular: Vector[]): Piece[] {
  const inCapOfMode = (m: CompiledProjection, mode: ExcludedCap['mode']) =>
    m.caps.some((cap) => cap.mode === mode && part.inCap.get(capKey(m, cap)));
  const inside = members.map((m) => !inCapOfMode(m, 'clip'));
  const behind = members.map((m) => inCapOfMode(m, 'behind'));
  const lobes = members.map((m) => part.lobe.get(seamKey(m)));
  const paths: Path[] = [];
  geoStream(part.geom, collector(paths));
  return paths.map((path) => ({
    closed: path.closed,
    coords: path.coords.map((coords) => densify(coords, singular)),
    inside,
    behind,
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
  { spin, reverseSeams }: (typeof ATTEMPTS)[number],
): Part[] {
  let parts: Part[] = [{ geom: geom as GeoPermissibleObjects, inCap: new Map(), lobe: new Map() }];
  const done = new Set<string>();
  const cutOnce = (key: string, cut: (part: Part) => Part[]) => {
    if (done.has(key)) return false;
    done.add(key);
    parts = parts.flatMap(cut);
    return true;
  };
  // Circles first: a clip around a circle stumbles over narrow gaps left by a seam.
  for (const m of members) {
    for (const cap of m.caps) {
      const key = capKey(m, cap);
      cutOnce(key, (part) => splitAtCap(part, m, cap, key, spin));
    }
  }
  // Lobes last: `geoClipAntimeridian` reads what is inside from the frame's south pole,
  // which can lie in a gap between lobes.
  const isLobed = (m: CompiledProjection) => (m.def.seam.kind === 'lobes' ? 1 : 0);
  const ordered = reverseSeams ? [...members].reverse() : members;
  let seamsLeft = new Set(members.filter((m) => m.def.seam.kind === 'antimeridian').map(seamKey)).size;
  let lobedCuts = 0;
  for (const m of [...ordered].sort((a, b) => isLobed(a) - isLobed(b))) {
    const key = seamKey(m);
    const pulls: Pulls = {
      // 1, 3, 7, 15, 31 x `SEAM_PULL`, ending at 1. Each exceeds all that later seams can move a
      // point: their pulls, plus the `SEAM_PULL` that d3 itself shifts a point crossing a seam.
      seamPull: SEAM_PULL * (2 ** Math.max(1, seamsLeft) - 1),
      lobePull: LOBE_PULL / 2 ** lobedCuts,
      polePull: LOBE_POLE_PULL * 2 ** lobedCuts,
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
export function cutGeometry(geom: GeoJSON.GeoJsonObject, members: CompiledProjection[]): Piece[] {
  const expected = geoArea(geom as GeoPermissibleObjects);
  const seams = new Set(members.filter((m) => m.def.seam.kind !== 'none').map(seamKey));
  const seamed = seams.size > 1 ? members.filter((m) => m.def.seam.kind !== 'none') : [];
  let best: Part[] = [];
  let bestError = Infinity;
  for (const attempt of ATTEMPTS) {
    const parts = withoutSlivers(cutParts(geom, members, attempt));
    let error = Math.abs(parts.reduce((sum, part) => sum + geoArea(part.geom), 0) - expected);
    // A step across a seam ranks below any cut free of one, and above a cut with the wrong area.
    if (error <= AREA_TOLERANCE && seamed.some((m) => crossesSeam(parts, m))) error += AREA_TOLERANCE * 2;
    if (error < bestError) {
      best = parts;
      bestError = error;
    }
    if (bestError <= AREA_TOLERANCE) break;
  }
  // Every singular point of a map in this catalog is the centre of one of its caps.
  const singular = members.flatMap((m) => m.caps.map((cap) => toVector(m.fromFrame(cap.frameCenter))));
  return best.flatMap((part) => toPieces(part, members, singular));
}
