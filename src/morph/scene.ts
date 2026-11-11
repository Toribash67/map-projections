import { cutGeometry, type Piece } from '../geo/cut';
import { capAxes, clipCaps, directionsOf, dot, edgePoint, positionOn, wrapAngle, type CapAxes } from '../geo/capEdge';
import { toVector } from '../geo/densify';
import { cutFront } from '../geo/frontCut';
import type { CompiledProjection, LonLat } from '../projections/types';
import { projectFrame, type ScreenTransform } from '../screen/screen';
import type { Viewport } from '../screen/screen';
import { INDICATRIX_RADIUS, indicatrixCentres, indicatrixRadius, type Mat2, type Member } from '../tissot/indicatrix';
import { isBehind, morphImages, restImages, type Cut, type MorphImage } from '../tissot/rest';

const rad = Math.PI / 180;

// A segment that sweeps round a cap's centre by more than this (radians) gets points in between along the cap's edge.
const ARC_STEP = 10 * rad;

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
};
/**
 * One part of an indicatrix: a disc under a matrix at a place, at each end, cut down to the part of the disc within every half-plane of
 * `cuts`. A map at rest draws a whole disc, or its two parts either side of a seam. In a morph the disc is split along the seams of every
 * map taking part, and each part goes from where the sources have that side of it to where the target has it.
 */
export type SceneIndicatrix = {
  srcPos: Pair;
  dstPos: Pair;
  srcMat: Mat2;
  dstMat: Mat2;
  /** How strong it is at each end, as the maps there show it at rest; between the two it goes evenly. A map that cannot show it gives it no strength of its own: it takes the other end's, and is flat there. */
  alphaSrc: number;
  alphaDst: number;
  /** On the far side of a globe at some end: drawn with the far-side pieces, under the near side until the peel opens. */
  behind: boolean;
  cuts: Cut[];
};
export type Scene = {
  layers: Record<string, ScenePiece[]>;
  indicatrices: SceneIndicatrix[];
  /** The radius (radians) of an undistorted indicatrix in this scene, where it is not the usual 5 degrees. */
  indicatrixRadius?: number;
};

/** Which indicatrices a scene has: how far apart (degrees), and the window they are wanted in, beyond which none is worked out. */
export type TissotOptions = { step: number; viewport?: Viewport };

// How far (CSS pixels) outside the window an indicatrix's centre can be and still reach into it, or come into it in a morph.
const VIEW_MARGIN = 200;

/** A ring seen from the clip cap holding it: each point in the frame, whether it is past the edge, and its direction from the centre. */
type CapView = { axes: CapAxes; frames: LonLat[]; inCap: boolean[]; directions: Float64Array };

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
  return { closed: piece.closed, src, dst, ringStarts, alphaSrc, alphaDst, behind, out };
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

// Two cuts facing each other this squarely (as the sum of their unit normals) are the two sides of one line.
const OPPOSED = 1e-9;

/** Whether cuts leave nothing of the disc: one that takes it all, or the two sides of one seam, which two maps share. */
function leavesNothing(cuts: Cut[]): boolean {
  for (let i = 0; i < cuts.length; i++) {
    const a = cuts[i]!;
    if (a[2] <= -1) return true;
    for (let j = i + 1; j < cuts.length; j++) {
      const b = cuts[j]!;
      if (Math.hypot(a[0] + b[0], a[1] + b[1]) < OPPOSED && a[2] + b[2] <= OPPOSED) return true;
    }
  }
  return false;
}

/**
 * One end of a part: the weighted mix of what each map there does with it. Its strength is that of the maps that have one, or null if
 * none has; its matrix is that of the maps that give it a shape, or null if none does.
 */
function mixImages(members: Member[], images: MorphImage[]): { pos: Pair; mat: Mat2 | null; alpha: number | null } {
  const pos: Pair = [0, 0];
  const mat: Mat2 = [0, 0, 0, 0];
  let [alpha, known, shaped] = [0, 0, 0];
  members.forEach((m, i) => {
    const image = images[i]!;
    pos[0] += m.weight * image.pos[0];
    pos[1] += m.weight * image.pos[1];
    if (image.mat) {
      for (let k = 0; k < 4; k++) mat[k]! += m.weight * image.mat[k]!;
      shaped += m.weight;
    }
    if (image.alpha !== null) {
      alpha += m.weight * image.alpha;
      known += m.weight;
    }
  });
  return { pos, mat: shaped > 0 ? (mat.map((v) => v / shaped) as Mat2) : null, alpha: known > 0 ? alpha / known : null };
}

/**
 * The indicatrices at `p`. A map at rest shows what `restImages` gives. In a morph the map on screen is the weighted mix of the maps
 * taking part, piece by piece, so the image of the small circle at `p` is the circle split along every one of their seams that crosses
 * it, each part carried by the mix of what each map does with that side: one part for every choice of a side on each map. The matrix of
 * a part is then the true derivative of the map on screen, at every moment, and at the ends the parts add up to what the maps at rest draw.
 */
export function buildIndicatrices(p: LonLat, source: Member[], target: Member | null, radius = INDICATRIX_RADIUS): SceneIndicatrix[] {
  if (!target) {
    return source.flatMap((m) =>
      restImages(m, p, radius).map((image): SceneIndicatrix => {
        const alpha = image.alpha * m.weight;
        return { srcPos: image.pos, dstPos: image.pos, srcMat: image.mat, dstMat: image.mat, alphaSrc: alpha, alphaDst: alpha, behind: false, cuts: image.cuts };
      }),
    );
  }
  const members = [...source, target];
  const behind = members.some((m) => isBehind(m, p));
  const sides = members.map((m) => morphImages(m, p, radius));
  if (sides.some((images) => images.length === 0)) return [];
  const out: SceneIndicatrix[] = [];
  const chosen: MorphImage[] = [];
  const choose = (i: number): void => {
    if (i < members.length) {
      for (const image of sides[i]!) {
        chosen[i] = image;
        choose(i + 1);
      }
      return;
    }
    const cuts = chosen.flatMap((image) => image.cuts);
    if (leavesNothing(cuts)) return;
    const start = mixImages(source, chosen);
    const end = chosen[source.length]!;
    // An end that gives it no shape keeps the other end's.
    const [srcMat, dstMat] = [start.mat ?? end.mat, end.mat ?? start.mat];
    if (!srcMat || !dstMat) return;
    // An end where no map shows it takes the strength of the other; where neither does, there is nothing to draw.
    const [alphaSrc, alphaDst] = [start.alpha ?? end.alpha, end.alpha ?? start.alpha];
    if (alphaSrc === null || alphaDst === null || (alphaSrc <= 0 && alphaDst <= 0)) return;
    out.push({ srcPos: start.pos, dstPos: end.pos, srcMat, dstMat, alphaSrc, alphaDst, behind, cuts });
  };
  choose(0);
  return out;
}

/** Whether some map of the scene puts a point in or near the window: a cheap look before working out its indicatrix. */
function nearView(p: LonLat, source: Member[], target: Member | null, v: Viewport): boolean {
  // Generous, as a copy across a seam is elsewhere on the map: the whole of the map's width in a seamed map, so only those are let through unseen.
  const reach = 2 * VIEW_MARGIN;
  for (const m of target ? [...source, target] : source) {
    if (m.compiled.def.seam.kind !== 'none') return true;
    const [x, y] = positionOn(m.compiled, m.screen, p);
    if (x > -reach && y > -reach && x < v.width + reach && y < v.height + reach) return true;
  }
  return false;
}

/**
 * Everything a morph between `source` and `target` draws, as a position per point at each
 * end, so that a frame is only a linear blend. With no target this is a map at rest or being
 * dragged, rebuilt per frame, by a much cheaper cut. That cut keeps what it can reuse by geometry
 * object, including the parts of a geometry collection, so a shape that changes has to be passed as
 * a new object, never mutated in place.
 */
export function buildScene(layers: Record<string, GeoJSON.GeoJsonObject>, source: Member[], target: Member | null, tissot: boolean | TissotOptions): Scene {
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
  if (tissot) {
    const { step, viewport } = tissot === true ? { step: 30, viewport: undefined } : tissot;
    const radius = indicatrixRadius(step);
    scene.indicatrixRadius = radius;
    // Zoomed in there are many more of them, nearly all out of sight: one is kept if it is in or near the window at either end.
    const inView = ({ srcPos, dstPos }: SceneIndicatrix) =>
      !viewport || [srcPos, dstPos].some(([x, y]) => x > -VIEW_MARGIN && y > -VIEW_MARGIN && x < viewport.width + VIEW_MARGIN && y < viewport.height + VIEW_MARGIN);
    for (const p of indicatrixCentres(step)) {
      if (viewport && !nearView(p, source, target, viewport)) continue;
      for (const part of buildIndicatrices(p, source, target, radius)) if (inView(part)) scene.indicatrices.push(part);
    }
  }
  return scene;
}
