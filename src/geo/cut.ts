import { geoArea, geoClipAntimeridian, geoClipCircle, geoDistance, geoInterpolate, geoRotation, geoStream } from 'd3-geo';
import type { GeoPermissibleObjects, GeoStream } from 'd3-geo';
import { geoClipPolygon } from 'd3-geo-polygon';
import type { CompiledProjection, ExcludedCap, Lobe, LonLat } from '../projections/types';

const rad = Math.PI / 180;

const MAX_SEGMENT = 2; // degrees
const SEAM_PULL = 1e-6; // radians
const POLE_STEP = Math.PI / 3; // radians
const LOBE_PULL = 1e-6; // degrees
// A lobe stops short of the pole. Any closer and its end edge is too short for the clip's
// arithmetic, and lies inside the turn that a seam makes round the pole. Each further lobed
// seam stops twice as far off, because two end edges at one distance cross over and over.
const LOBE_POLE_PULL = 1e-3; // degrees
const LOBE_GAP = 2 * LOBE_PULL;
const LOBE_EDGE_STEP = 30; // degrees
// `geoClipCircle` reads what is inside from one point on its circle. Spinning the circle
// about its centre moves that point off the meridians and poles where earlier cuts lie.
// The first spin suits nearly everything; the others are for a cut whose area comes out wrong.
const CLIP_SPINS = [37.3, 61.7, 13.9, 83.1]; // degrees
// How far a cut's total area may drift from the input's. Correct cuts lose under 1e-4 to the
// narrow gaps along seams; wrong ones are off by a fair part of the sphere.
const AREA_TOLERANCE = 5e-4; // steradians
// Keeps a cap's edge off anything lying exactly on it: the meridian ±180, where Antarctica's
// ring has an edge, or another member's frame pole. There it has to clear the turn a seam
// makes round the pole, of radius `SEAM_PULL`, or the ring crosses itself.
const CAP_PULL = 2e-4; // degrees

export type Piece = {
  /** A polygon's rings, or a single line. A ring repeats its first point at the end. */
  closed: boolean;
  /** Geographic, densified to at most 2° per segment. */
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

/**
 * Pulls what `geoClipAntimeridian` emits off the seam and the poles, so numeric
 * rotation cannot flip a point to the other side. A later clip cannot place a
 * segment across a pole, so a ring that d3 runs through a pole goes round it in
 * short steps instead.
 */
function offSeam(sink: GeoStream): GeoStream {
  const lonLimit = Math.PI - SEAM_PULL;
  const latLimit = Math.PI / 2 - SEAM_PULL;
  let previous: LonLat | null = null;
  return {
    ...forwarding(sink),
    point(x, y) {
      const lambda = Math.max(-lonLimit, Math.min(lonLimit, x));
      const phi = Math.max(-latLimit, Math.min(latLimit, y));
      if (previous && Math.abs(phi) === latLimit && previous[1] === phi) {
        const steps = Math.ceil(Math.abs(lambda - previous[0]) / POLE_STEP);
        for (let i = 1; i < steps; i++) sink.point(previous[0] + ((lambda - previous[0]) * i) / steps, phi);
      }
      sink.point(lambda, phi);
      previous = [lambda, phi];
    },
    lineStart() {
      previous = null;
      sink.lineStart();
    },
  };
}

/** Clockwise, in frame degrees, with the edges pulled in so that neighbouring lobes never share a point. */
function lobePolygon(lobe: Lobe, polePull: number): GeoJSON.Polygon {
  const west = lobe.lonMin + LOBE_PULL;
  const east = lobe.lonMax - LOBE_PULL;
  const south = lobe.latMin === -90 ? -90 + polePull : lobe.latMin + LOBE_PULL;
  const north = lobe.latMax === 90 ? 90 - polePull : lobe.latMax - LOBE_PULL;
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
 * Moves a frame point out of the gap between lobes, always to the same side. A
 * line running along a lobe edge, as the equator and some meridians do at the
 * default orientation, would otherwise lie in no lobe and be lost.
 */
function offLobeEdges(lobes: Lobe[]): PointMap {
  const off = (value: number, edges: number[], top: number) => {
    const edge = edges.find((e) => Math.abs(value - e) <= LOBE_GAP);
    if (edge === undefined) return value;
    return edge === top ? edge - LOBE_GAP : edge + LOBE_GAP;
  };
  const lons = lobes.flatMap((l) => [l.lonMin, l.lonMax]);
  const lats = lobes.flatMap((l) => [l.latMin, l.latMax]);
  return ([lon, lat]) => [off(lon, lons, 180), off(lat, lats, 90)];
}

/** Splits a part along the member's seam. */
function cutSeam(part: Part, m: CompiledProjection, key: string, polePull: number): Part[] {
  const frame: ClipFrame = { to: m.toFrame, from: m.fromFrame };
  const child = (path: Path): Part => ({ ...part, geom: pathGeometry(path) });
  const seam = m.def.seam;
  switch (seam.kind) {
    case 'none':
      return [part];
    case 'antimeridian':
      return clipPaths(part, frame, (sink) => geoClipAntimeridian(offSeam(sink))).map(child);
    case 'lobes': {
      const off = offLobeEdges(seam.lobes);
      const lobeFrame: ClipFrame = { to: (p) => off(m.toFrame(p)), from: m.fromFrame };
      return seam.lobes.flatMap((lobe) =>
        clipPaths(part, lobeFrame, geoClipPolygon(lobePolygon(lobe, polePull))).map((path) => ({
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
  const [lon, lat] = m.fromFrame(cap.frameCenter);
  const cosLat = Math.cos(lat * rad);
  const centre = [cosLat * Math.cos(lon * rad), cosLat * Math.sin(lon * rad), Math.sin(lat * rad)];
  return JSON.stringify([centre.map((v) => +v.toFixed(9)), +cap.radius.toFixed(9)]);
}
const seamKey = (m: CompiledProjection) => JSON.stringify([frameKey(m), m.def.seam]);

/** Adds great-circle points so that no segment is longer than `MAX_SEGMENT`. */
function densify(path: LonLat[]): LonLat[] {
  const out: LonLat[] = [];
  path.forEach((point, i) => {
    if (i > 0) {
      const previous = path[i - 1]!;
      const steps = Math.ceil(geoDistance(previous, point) / rad / MAX_SEGMENT);
      if (steps > 1) {
        const along = geoInterpolate(previous, point);
        for (let s = 1; s < steps; s++) out.push(along(s / steps));
      }
    }
    out.push(point);
  });
  return out;
}

function toPieces(part: Part, members: CompiledProjection[]): Piece[] {
  const inCapOfMode = (m: CompiledProjection, mode: ExcludedCap['mode']) =>
    m.caps.some((cap) => cap.mode === mode && part.inCap.get(capKey(m, cap)));
  const inside = members.map((m) => !inCapOfMode(m, 'clip'));
  const behind = members.map((m) => inCapOfMode(m, 'behind'));
  const lobes = members.map((m) => part.lobe.get(seamKey(m)));
  const paths: Path[] = [];
  geoStream(part.geom, collector(paths));
  return paths.map((path) => ({ closed: path.closed, coords: path.coords.map(densify), inside, behind, lobes }));
}

/**
 * One attempt at the cuts. A circle or seam that several members share is cut
 * only once: clipping again along an existing edge is numerically unstable.
 */
function cutParts(geom: GeoJSON.GeoJsonObject, members: CompiledProjection[], spin: number): Part[] {
  let parts: Part[] = [{ geom: geom as GeoPermissibleObjects, inCap: new Map(), lobe: new Map() }];
  const done = new Set<string>();
  const cutOnce = (key: string, cut: (part: Part) => Part[]) => {
    if (done.has(key)) return;
    done.add(key);
    parts = parts.flatMap(cut);
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
  const lobesLast = (m: CompiledProjection) => (m.def.seam.kind === 'lobes' ? 1 : 0);
  let polePull = LOBE_POLE_PULL;
  for (const m of [...members].sort((a, b) => lobesLast(a) - lobesLast(b))) {
    const key = seamKey(m);
    cutOnce(key, (part) => cutSeam(part, m, key, polePull));
    if (lobesLast(m)) polePull *= 2;
  }
  return parts;
}

/**
 * Splits geometry on the sphere at the caps and seams of every member, so that
 * each piece lies wholly on one side of each of them. The clips can misjudge
 * which side is inside when cuts line up exactly, which shows in the total area,
 * so a cut that loses or gains area is redone at another spin and the closest
 * attempt returned. Lines have no area and always pass at the first attempt.
 */
export function cutGeometry(geom: GeoJSON.GeoJsonObject, members: CompiledProjection[]): Piece[] {
  const expected = geoArea(geom as GeoPermissibleObjects);
  let best: Part[] = [];
  let bestError = Infinity;
  for (const spin of CLIP_SPINS) {
    const parts = cutParts(geom, members, spin);
    const error = Math.abs(parts.reduce((sum, part) => sum + geoArea(part.geom), 0) - expected);
    if (error < bestError) {
      best = parts;
      bestError = error;
    }
    if (bestError <= AREA_TOLERANCE) break;
  }
  return best.flatMap((part) => toPieces(part, members));
}
