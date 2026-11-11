import { cutGeometry, type Piece } from '../geo/cut';
import { toVector, type Vector } from '../geo/densify';
import { cutFront } from '../geo/frontCut';
import type { CompiledProjection, ExcludedCap, LonLat } from '../projections/types';
import { lobeOf, projectFrame, type ScreenTransform } from '../screen/screen';
import { blendIndicatrix, indicatrixCentres, jacobian, type Mat2, type Member } from '../tissot/indicatrix';
import { boundaryFade } from '../tissot/pastCap';
import { isBehind, isSingular, restImages, type Cut } from '../tissot/rest';

const rad = Math.PI / 180;
const TAU = 2 * Math.PI;

// A segment that sweeps round a cap's centre by more than this (radians) gets points in between along the cap's edge.
const ARC_STEP = 10 * rad;
// Closer than this (radians) to a cap's centre, a point's direction from it is only rounding noise.
const NO_DIRECTION = 1e-12;

type Pair = [number, number];

export type ScenePiece = {
  closed: boolean;
  /** Screen positions at each end, as x, y pairs. `dst` is `src` itself where the two are the same. */
  src: Float32Array;
  dst: Float32Array;
  /** The point (not array) index where each ring or line begins; each one ends where the next begins. */
  ringStarts: Uint32Array;
  /** The share of the sources, by weight, that show it, and whether the target does (1 or 0). It is drawn at full strength if either is above zero. */
  alphaSrc: number;
  alphaDst: number;
  behind: boolean;
  /** Beyond what a map can show at one end or the other: past a clip cap, or behind a globe's limb. Its ocean is filled from cells. */
  out: boolean;
  /** Which members show it, a bit for each of the sources and then the target. A map at rest's own pieces leave it out: its one member shows them. */
  shownBy?: number;
};
export type SceneIndicatrix = {
  srcPos: Pair;
  dstPos: Pair;
  srcMat: Mat2;
  dstMat: Mat2;
  alphaSrc: number;
  alphaDst: number;
  /** As for a piece. */
  hidden?: number[];
  /** How much each weight in `hidden` hides it, 1 if not given: a map that shows it faded, near a boundary, hides the rest. See `alphaOf`. */
  fade?: number[];
  /** On the far side of a globe at some end: drawn with the far-side pieces, under the near side until the peel opens. */
  behind: boolean;
  /** The part drawn at each end, where it is cut at the edge of a lobe; null at an end where it is whole. See `Cut`. */
  cut?: { src: Cut | null; dst: Cut | null };
  /**
   * A copy that one member shows at rest (past a cap's edge, or across a seam), by its index among the sources and then the target. It
   * stays where that map has it, fades on that map's curve, and is cut to what that map shows. Others are cut to the whole outline.
   */
  clip?: number;
};
export type Scene = { layers: Record<string, ScenePiece[]>; indicatrices: SceneIndicatrix[] };

const dot = (a: Vector, b: Vector) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vector, b: Vector): Vector => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** An angle wrapped to [-π, π]: the way a straight segment sweeps round a point not on it. */
const wrapAngle = (a: number) => a - TAU * Math.round(a / TAU);

/** A clip cap with axes to read directions from its centre. Direction 0 is frame longitude 0 for a cap on a frame pole. */
type CapAxes = { centre: Vector; e1: Vector; e2: Vector; cosRadius: number; sinRadius: number };

function capAxes(cap: ExcludedCap): CapAxes {
  const centre = toVector(cap.frameCenter);
  const side = cross([0, 0, 1], centre);
  const length = Math.hypot(...side);
  const [e1, e2]: [Vector, Vector] = length > 1e-9 ? [[side[0] / length, side[1] / length, 0], cross(centre, [side[0] / length, side[1] / length, 0])] : [[1, 0, 0], [0, 1, 0]];
  return { centre, e1, e2, cosRadius: Math.cos(cap.radius * rad), sinRadius: Math.sin(cap.radius * rad) };
}

/** The frame point on a cap's edge in a given direction from its centre. */
function edgePoint({ centre, e1, e2, cosRadius, sinRadius }: CapAxes, direction: number): LonLat {
  const [cos, sin] = [Math.cos(direction), Math.sin(direction)];
  const along = (i: 0 | 1 | 2) => centre[i] * cosRadius + (e1[i] * cos + e2[i] * sin) * sinRadius;
  return [Math.atan2(along(1), along(0)) / rad, Math.asin(Math.max(-1, Math.min(1, along(2)))) / rad];
}

const clipCaps = (c: CompiledProjection) => c.caps.filter((cap) => cap.mode === 'clip');

/** A ring seen from the clip cap holding it: each point in the frame, whether it is past the edge, and its direction from the centre. */
type CapView = { axes: CapAxes; frames: LonLat[]; inCap: boolean[]; directions: Float64Array };

/** Direction of each point from the cap's centre. A point on the centre takes that of the point before it, or after it. */
function directionsOf(axes: CapAxes, vectors: Vector[]): Float64Array {
  const directions = new Float64Array(vectors.length).fill(NaN);
  vectors.forEach((v, i) => {
    const [a, b] = [dot(v, axes.e1), dot(v, axes.e2)];
    if (Math.hypot(a, b) > NO_DIRECTION) directions[i] = Math.atan2(b, a);
  });
  let known = directions.find((d) => !Number.isNaN(d)) ?? 0;
  for (let i = 0; i < directions.length; i++) {
    if (Number.isNaN(directions[i]!)) directions[i] = known;
    else known = directions[i]!;
  }
  return directions;
}

/** The clip cap that holds a piece, which lies wholly in one: the nearest to its first point, by distance past the edge. */
function capHolding(c: CompiledProjection, frame: LonLat): CapAxes {
  const v = toVector(frame);
  let best: CapAxes | null = null;
  let bestScore = -Infinity;
  for (const cap of clipCaps(c)) {
    const axes = capAxes(cap);
    const score = dot(v, axes.centre) - axes.cosRadius;
    if (score > bestScore) {
      best = axes;
      bestScore = score;
    }
  }
  return best!;
}

function viewFromCap(c: CompiledProjection, axes: CapAxes, ring: LonLat[]): CapView {
  const frames = ring.map((p) => c.toFrame(p));
  const vectors = frames.map(toVector);
  return { axes, frames, inCap: vectors.map((v) => dot(v, axes.centre) > axes.cosRadius), directions: directionsOf(axes, vectors) };
}

/**
 * Adds to `out` from `offset` a member's weighted positions for one ring. `steps` says how many
 * segments each input segment becomes. Off the map, a point sits on the cap's edge, so steps
 * follow that edge; elsewhere the extra points lie so close that a straight line will do.
 */
function placeRing({ compiled: c, screen: s, weight }: Member, lobe: number | undefined, ring: LonLat[], view: CapView | null, steps: Int32Array, out: Float64Array, offset: number) {
  const at = (i: number): Pair => {
    if (!view) return projectFrame(c, s, c.toFrame(ring[i]!), lobe);
    const frame = view.inCap[i] ? edgePoint(view.axes, view.directions[i]!) : view.frames[i]!;
    return projectFrame(c, s, frame, lobe);
  };
  let n = offset;
  const put = (p: Pair) => {
    out[n++]! += weight * p[0];
    out[n++]! += weight * p[1];
  };
  let previous = at(0);
  put(previous);
  for (let k = 1; k < ring.length; k++) {
    const point = at(k);
    const count = steps[k - 1]!;
    if (count > 1) {
      const sweep = view ? wrapAngle(view.directions[k]! - view.directions[k - 1]!) : 0;
      for (let j = 1; j < count; j++) {
        const f = j / count;
        if (view && Math.abs(sweep) > ARC_STEP) {
          put(projectFrame(c, s, edgePoint(view.axes, view.directions[k - 1]! + f * sweep), lobe));
        } else {
          put([previous[0] + f * (point[0] - previous[0]), previous[1] + f * (point[1] - previous[1])]);
        }
      }
    }
    put(point);
    previous = point;
  }
}

/** A cut piece as positions at both ends, for a morph. Null when neither end can show it. */
function morphPiece(piece: Piece, source: Member[], target: Member | null): ScenePiece | null {
  const members = target ? [...source, target] : source;
  const shownBy = (i: number) => piece.inside[i]! || piece.behind[i]!;
  const alphaSrc = source.reduce((sum, m, i) => (shownBy(i) ? sum + m.weight : sum), 0);
  const alphaDst = target ? (shownBy(source.length) ? 1 : 0) : alphaSrc;
  const behind = piece.behind.some(Boolean);
  // Cells stand in for the ocean of a piece past a cap big enough to have them; a smaller cap's piece is ordinary ocean.
  const out = behind || piece.celled.some(Boolean);
  if (alphaSrc <= 0 && alphaDst <= 0) return null;
  if (!target && behind) return null;
  const shown = members.reduce((bits, _, i) => (shownBy(i) ? bits | (1 << i) : bits), 0);

  const axes = members.map((m, i) => (piece.inside[i] ? null : capHolding(m.compiled, m.compiled.toFrame(piece.coords[0]![0]!))));
  const views = piece.coords.map((ring) => members.map((m, i) => (axes[i] ? viewFromCap(m.compiled, axes[i]!, ring) : null)));
  const steps = piece.coords.map((ring, r) => {
    const counts = new Int32Array(Math.max(0, ring.length - 1)).fill(1);
    for (const view of views[r]!) {
      if (!view) continue;
      for (let k = 1; k < ring.length; k++) {
        const sweep = Math.abs(wrapAngle(view.directions[k]! - view.directions[k - 1]!));
        if (sweep > ARC_STEP) counts[k - 1] = Math.max(counts[k - 1]!, Math.ceil(sweep / ARC_STEP));
      }
    }
    return counts;
  });

  const ringStarts = new Uint32Array(piece.coords.length);
  let total = 0;
  piece.coords.forEach((ring, r) => {
    ringStarts[r] = total;
    total += ring.length > 0 ? 1 + steps[r]!.reduce((sum, count) => sum + count, 0) : 0;
  });
  const fill = (end: Member[], first: number): Float32Array => {
    const out = new Float64Array(2 * total);
    end.forEach((m, e) => {
      const i = first + e;
      piece.coords.forEach((ring, r) => placeRing(m, piece.lobes[i], ring, views[r]![i]!, steps[r]!, out, 2 * ringStarts[r]!));
    });
    return new Float32Array(out);
  };
  const src = fill(source, 0);
  const dst = target ? fill([{ ...target, weight: 1 }], source.length) : src;
  return { closed: piece.closed, src, dst, ringStarts, alphaSrc, alphaDst, behind, out, shownBy: shown };
}

/** What a live build cut from a geometry, and the map it cut it for. */
type LiveCut = { compiled: CompiledProjection; screen: ScreenTransform; weight: number; pieces: ScenePiece[] };
// By geometry object. A preview changes the drawings every pointer move and nothing else, so the layers
// that did not change are not cut again, nor are the shapes in a collection that did not change.
const liveCache = new WeakMap<object, LiveCut>();

function cutLive(geom: GeoJSON.GeoJsonObject, m: Member): ScenePiece[] {
  const { compiled: c, screen: s } = m;
  return cutFront(geom, c).map((piece) => {
    const ringStarts = new Uint32Array(piece.rings.length);
    let total = 0;
    piece.rings.forEach((ring, r) => {
      ringStarts[r] = total;
      total += ring.length;
    });
    const src = new Float32Array(2 * total);
    let n = 0;
    for (const ring of piece.rings) {
      for (const point of ring) {
        const [x, y] = projectFrame(c, s, point, piece.lobe);
        src[n++] = x;
        src[n++] = y;
      }
    }
    return { closed: piece.closed, src, dst: src, ringStarts, alphaSrc: m.weight, alphaDst: m.weight, behind: false, out: false };
  });
}

/**
 * What the full cut gives for one member at rest: the slower way, for a geometry the live cut could not cut. It throws only where a
 * clip of d3's meets a case it cannot read, and a frame must still be drawn.
 */
function safeLive(geom: GeoJSON.GeoJsonObject, m: Member): ScenePiece[] {
  try {
    return cutLive(geom, m);
  } catch {
    return cutGeometry(geom, [m.compiled]).flatMap((piece) => morphPiece(piece, [m], null) ?? []);
  }
}

/** A map at rest or being dragged: one member, and only what it shows. */
function livePieces(geom: GeoJSON.GeoJsonObject, m: Member): ScenePiece[] {
  const cached = liveCache.get(geom);
  if (cached && cached.compiled === m.compiled && cached.screen === m.screen && cached.weight === m.weight) return cached.pieces;
  const pieces = geom.type === 'GeometryCollection' ? (geom as GeoJSON.GeometryCollection).geometries.flatMap((part) => livePieces(part, m)) : safeLive(geom, m);
  liveCache.set(geom, { compiled: m.compiled, screen: m.screen, weight: m.weight, pieces });
  return pieces;
}

/** Where a member puts a point: projected, or moved to the edge of the clip cap holding it. */
function positionOn({ compiled: c, screen: s }: Member, p: LonLat): Pair {
  const frame = c.toFrame(p);
  const v = toVector(frame);
  for (const cap of clipCaps(c)) {
    const axes = capAxes(cap);
    if (dot(v, axes.centre) <= axes.cosRadius) continue;
    const edge = edgePoint(axes, directionsOf(axes, [v])[0]!);
    return projectFrame(c, s, edge, lobeOf(c, edge));
  }
  return projectFrame(c, s, frame, lobeOf(c, frame));
}

/**
 * One end of an indicatrix: the blended matrix, and how far it shows. A member that has it in a clip cap, or for which it is singular,
 * adds no alpha; one that has it near a clip cap's edge adds the share `boundaryFade` gives, and hides the rest of its weight, so that the
 * end looks as that map does at rest. A globe's far side counts as shown, like far-side land. Its matrix still counts if it has one,
 * so an ellipse flat on a globe's limb widens as it fades in, and a redirect cannot make it pop.
 */
function indicatrixEnd(members: Member[], p: LonLat): { mat: Mat2; alpha: number; hidden: number[]; fade: number[] } | null {
  const blend = blendIndicatrix(members, p);
  if (!blend) return null;
  if (isSingular(blend.mat)) return { mat: blend.mat, alpha: 0, hidden: members.map((m) => m.weight), fade: members.map(() => 1) };
  let alpha = 0;
  const [hidden, fade]: [number[], number[]] = [[], []];
  for (const m of members) {
    const mat = jacobian(m.compiled, m.screen, p);
    const shown = mat && !isSingular(mat) ? boundaryFade(m, p, mat) : 0;
    alpha += m.weight * shown;
    if (shown < 1) {
      hidden.push(m.weight);
      fade.push(1 - shown);
    }
  }
  return { mat: blend.mat, alpha, hidden, fade };
}

/** An indicatrix follows the land beneath it, through a cap's edge like everything else. Only its alpha and matrix depend on what can show it. */
function blendedPosition(members: Member[], p: LonLat): Pair {
  const pos: Pair = [0, 0];
  for (const m of members) {
    const [x, y] = positionOn(m, p);
    pos[0] += m.weight * x;
    pos[1] += m.weight * y;
  }
  return pos;
}

/** The cut of an indicatrix at one end, from those of the members there: their weighted mix, or null where it is whole. */
function blendCut(members: Member[], cuts: (Cut | undefined)[]): Cut | null {
  if (!cuts.some(Boolean)) return null;
  const [mx, my, total] = members.reduce(([x, y, c], m, i) => [x + m.weight * (cuts[i]?.[0] ?? 0), y + m.weight * (cuts[i]?.[1] ?? 0), c + m.weight * Math.min(1, cuts[i]?.[2] ?? 1)], [0, 0, 0]);
  const length = Math.hypot(mx, my);
  return length > 0 && total < 1 ? [mx / length, my / length, total] : null;
}

/**
 * The indicatrices at `p`. A map at rest shows what `restImages` gives. A morph moves the indicatrix from its place on the sources to
 * its place on the target, and fades it on `alphaOf`'s curves; each map's copies besides (past a cap's edge, or across a seam) stay
 * where that map has them, at the alpha it shows them with, and fade on its curve: so the first and last frames are the maps at rest.
 */
function buildIndicatrices(p: LonLat, source: Member[], target: Member | null): SceneIndicatrix[] {
  if (!target) {
    return source.flatMap((m) =>
      restImages(m, p).map((image): SceneIndicatrix => {
        const alpha = image.alpha * m.weight;
        const cut = image.cut ? { cut: { src: image.cut, dst: image.cut } } : {};
        return { srcPos: image.pos, dstPos: image.pos, srcMat: image.mat, dstMat: image.mat, alphaSrc: alpha, alphaDst: alpha, behind: false, ...cut };
      }),
    );
  }
  const members = [...source, target];
  const behind = members.some((m) => isBehind(m, p));
  const images = members.map((m) => restImages({ ...m, weight: 1 }, p));
  const out: SceneIndicatrix[] = [];
  const start = indicatrixEnd(source, p);
  const end = indicatrixEnd([{ ...target, weight: 1 }], p);
  const [alphaSrc, alphaDst] = [start?.alpha ?? 0, end?.alpha ?? 0];
  if (alphaSrc > 0 || alphaDst > 0) {
    const ownCut = (i: number) => images[i]!.find((image) => image.own)?.cut;
    const [srcCut, dstCut] = [blendCut(source, source.map((_, i) => ownCut(i))), ownCut(source.length) ?? null];
    out.push({
      srcPos: blendedPosition(source, p),
      dstPos: positionOn(target, p),
      // An end that cannot show it at all keeps the other end's shape while it fades.
      srcMat: (start ?? end)!.mat,
      dstMat: (end ?? start)!.mat,
      alphaSrc,
      alphaDst,
      hidden: start ? start.hidden : source.map((m) => m.weight),
      fade: start ? start.fade : source.map(() => 1),
      behind,
      ...(srcCut || dstCut ? { cut: { src: srcCut, dst: dstCut } } : {}),
    });
  }
  members.forEach((m, i) => {
    const isTarget = i === source.length;
    for (const image of images[i]!) {
      if (image.own) continue;
      out.push({
        srcPos: image.pos,
        dstPos: image.pos,
        srcMat: image.mat,
        dstMat: image.mat,
        alphaSrc: isTarget ? 0 : m.weight * image.alpha,
        alphaDst: isTarget ? image.alpha : 0,
        // Every map but this one does not show it; this one shows it at its alpha.
        hidden: source.map((x) => x.weight),
        fade: source.map((_, j) => (j === i ? 1 - image.alpha : 1)),
        behind,
        clip: i,
        ...(image.cut ? { cut: { src: image.cut, dst: image.cut } } : {}),
      });
    }
  });
  return out;
}

/**
 * Everything a morph between `source` and `target` draws, as a position per point at each
 * end, so that a frame is only a linear blend. With no target this is a map at rest or being
 * dragged, rebuilt per frame, by a much cheaper cut. That cut keeps what it can reuse by geometry
 * object, including the parts of a geometry collection, so a shape that changes has to be passed as
 * a new object, never mutated in place.
 */
export function buildScene(layers: Record<string, GeoJSON.GeoJsonObject>, source: Member[], target: Member | null, withTissot: boolean): Scene {
  const compiled = (target ? [...source, target] : source).map((m) => m.compiled);
  const scene: Scene = { layers: {}, indicatrices: [] };
  for (const [name, geom] of Object.entries(layers)) {
    const pieces =
      !target && source.length === 1
        ? livePieces(geom, source[0]!)
        : cutGeometry(geom, compiled).flatMap((piece) => morphPiece(piece, source, target) ?? []);
    // Cells of ocean are only for what some map cannot show; the rest of them are drawn by the ocean itself.
    scene.layers[name] = name === 'capOcean' ? pieces.filter((piece) => piece.out) : pieces;
  }
  if (withTissot) {
    for (const p of indicatrixCentres()) scene.indicatrices.push(...buildIndicatrices(p, source, target));
  }
  return scene;
}
