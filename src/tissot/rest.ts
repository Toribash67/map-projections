import { geoDistance } from 'd3-geo';
import { capAxes, clipCaps, directionsOf, edgePoint, positionOn } from '../geo/capEdge';
import { hasCells } from '../geo/capCells';
import { toVector } from '../geo/densify';
import type { CompiledProjection, ExcludedCap, Lobe, LonLat } from '../projections/types';
import { destination, isClipped, lobeOf, projectFrame, projectPoint, type Margin } from '../screen/screen';
import { INDICATRIX_RADIUS, jacobian, singularValues, type Mat2, type Member } from './indicatrix';
import { boundaryFade, capMargin } from './pastCap';

const rad = Math.PI / 180;

type Pair = [number, number];

// An ellipse whose smaller axis is under this share of its larger one is singular, and not shown.
// On a globe that is within 0.06 degrees of the limb. The numeric derivative on the limb itself gives 5e-5.
const SINGULAR_RATIO = 1e-3;
// A point this close (degrees) to the edge of a 'behind' cap lies on the limb, whichever way rounding has it.
const ON_LIMB = 1e-9;
/**
 * An indicatrix this near (degrees) a seam or the edge of a lobe gets a copy on the far side of it, which the outline cuts down to
 * the part that crossed. An ellipse is 5 degrees across its middle on the sphere; a map's shear can carry its outline a little further.
 */
const MIRROR_REACH = 12;
// The step (radians of true distance) for the derivative of a map folded onto its edge, and how many times farther one side may reach than the other before it has crossed a seam.
const FOLD_STEP = 1e-4;
const FOLD_JUMP = 10;
/**
 * Near the centre of a cap the edge is all round a point, so a small step there swings right round the edge, and the derivative of the
 * folded map grows without limit: the small circle there is not flattened to a short line but spread round the whole edge, which no
 * matrix says. The derivative is taken no nearer the centre than this (degrees), along the point's own direction from it.
 */
const FOLD_CLEAR = 20;

export const isSingular = (m: Mat2): boolean => {
  const [big, small] = singularValues(m);
  return !(small > SINGULAR_RATIO * big);
};

/** Past a globe's limb. On the limb itself an ellipse is singular, and fades in on top of what the peel opens. */
export function isBehind({ compiled: c }: Member, p: LonLat): boolean {
  const frame = c.toFrame(p);
  return c.caps.some((cap) => cap.mode === 'behind' && geoDistance(frame, cap.frameCenter) / rad < cap.radius - ON_LIMB);
}

/**
 * Part of an indicatrix: the half-plane m . x <= c of its unit disc, in its own east and north, as [m east, m north, c]. An indicatrix
 * by a seam is cut there, and its copy on the far side is the other part, so that between them they are the one disc.
 */
export type Cut = [number, number, number];

/**
 * How an indicatrix looks on a map at rest. `own` is the one at its centre's place on the map; the others are what a map at rest shows
 * besides: one whose centre is past a clip cap's edge (see `FADE_BAND`), and one on the far side of a seam or lobe edge. `alpha` is its
 * share of full strength, before the member's weight. `cuts` bound the part of the disc that is drawn.
 */
export type RestImage = { pos: Pair; mat: Mat2; alpha: number; own: boolean; cuts: Cut[] };

/**
 * What one map does with an indicatrix in a morph: as at rest, but there is always something. Where the map cannot show it, or shows
 * it with no area (on a globe's limb), `alpha` is null: it has no strength of its own there, and takes that of the morph's other end.
 * In the small cap round a point the map cannot reach, such as a pole, there is no shape for it either, and `mat` is null: it has the
 * shape the other maps give it, and no strength, as at rest an indicatrix has none at the edge of such a cap.
 */
export type MorphImage = { pos: Pair; mat: Mat2 | null; alpha: number | null; own: boolean; cuts: Cut[] };

const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const finite = (q: Pair) => Number.isFinite(q[0]) && Number.isFinite(q[1]);

/** A seam the map has next to a point: frame longitude `lon` from `latMin` to `latMax`, and how to reach the far side of it. */
type Edge = { lon: number; latMin: number; latMax: number; lobe: number | undefined; shift: number; inside: 1 | -1 };

/** The seams that bound the part of the map that holds a frame point: the antimeridian, or the sides of its lobe. */
function edgesOf(c: CompiledProjection, frame: LonLat, lobe: number | undefined): Edge[] {
  const seam = c.def.seam;
  if (seam.kind === 'none') return [];
  if (seam.kind === 'antimeridian') {
    const east = frame[0] >= 0;
    return [{ lon: east ? 180 : -180, latMin: -90, latMax: 90, lobe: undefined, shift: east ? -360 : 360, inside: east ? -1 : 1 }];
  }
  const own = seam.lobes.find((l) => l.centralLon === lobe && frame[0] >= l.lonMin && frame[0] <= l.lonMax && frame[1] >= l.latMin && frame[1] <= l.latMax);
  if (!own) return [];
  const band = (l: Lobe) => l.latMin === own.latMin && l.latMax === own.latMax;
  const edges: Edge[] = [];
  for (const [lon, inside] of [[own.lonMin, 1], [own.lonMax, -1]] as const) {
    // Across the antimeridian the next lobe is at the other end of the map.
    const around = Math.abs(lon) === 180;
    const next = seam.lobes.find((l) => band(l) && (inside === 1 ? l.lonMax === (around ? 180 : lon) : l.lonMin === (around ? -180 : lon)));
    if (!next) continue;
    edges.push({ lon, latMin: own.latMin, latMax: own.latMax, lobe: next.centralLon, shift: around ? 360 * inside : 0, inside });
  }
  return edges;
}

/**
 * Angle (degrees) from a frame point to a seam, where the nearest point of the seam's meridian lies on the seam itself; infinite where
 * it lies past an end of it. A seam ends at a pole of the frame or at the equator, and its great circle runs on from there as a
 * meridian that is no seam: a disc beside that part is whole, and cutting it along the circle would take half of it away.
 */
function distanceTo(frame: LonLat, edge: Edge): number {
  const v = toVector(frame);
  const n = [-Math.sin(edge.lon * rad), Math.cos(edge.lon * rad), 0] as const;
  const off = v[0] * n[0] + v[1] * n[1];
  const foot = [v[0] - off * n[0], v[1] - off * n[1], v[2]] as const;
  const footLat = Math.atan2(foot[2], Math.hypot(foot[0], foot[1])) / rad;
  const onEdge = foot[0] * Math.cos(edge.lon * rad) + foot[1] * Math.sin(edge.lon * rad) > 0;
  return onEdge && footLat >= edge.latMin && footLat <= edge.latMax ? Math.asin(Math.min(1, Math.abs(off))) / rad : Infinity;
}

/** The part of an indicatrix at `p`, of `radius` radians, on its own side of a seam, as a `Cut` in its east and north. Null at a frame pole. */
function cutAt(c: CompiledProjection, p: LonLat, edge: Edge, radius: number): Cut | null {
  const n = toVector(c.fromFrame([edge.lon + 90, 0]));
  const [lon, lat] = [p[0] * rad, p[1] * rad];
  const centre = toVector(p);
  const east = [-Math.sin(lon), Math.cos(lon), 0];
  const north = [-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat)];
  const dot = (a: readonly number[]) => a[0]! * n[0] + a[1]! * n[1] + a[2]! * n[2];
  const [ne, nn, np] = [dot(east), dot(north), dot(centre)];
  const q = Math.hypot(ne, nn);
  if (!(q > 1e-9)) return null;
  // A point at x (in units of the indicatrix's radius) east and north of the centre is on the lobe's side where inside * (n . point) > 0.
  return [(-edge.inside * ne) / q, (-edge.inside * nn) / q, (edge.inside * np) / (radius * q)];
}

/** Adds to an image at `frame` its copies across the seams near it, each cut to its side of the seam, and cuts the image to its own. */
function acrossSeams(c: CompiledProjection, s: Member['screen'], p: LonLat, frame: LonLat, lobe: number | undefined, image: MorphImage, margin: Margin, radius: number): MorphImage[] {
  // As far as an indicatrix of this radius can reach across a seam: see `MIRROR_REACH`.
  const reach = (MIRROR_REACH * radius) / INDICATRIX_RADIUS;
  const copies: { copy: MorphImage; own: Cut | null }[] = [];
  for (const edge of edgesOf(c, frame, lobe)) {
    if (distanceTo(frame, edge) >= reach) continue;
    const far: LonLat = [frame[0] + edge.shift, frame[1]];
    const farPos = projectFrame(c, s, far, edge.lobe);
    const farMat = jacobian(c, s, p, { margin, continued: { near: far[0], lobe: edge.lobe } });
    if (!farMat || !finite(farPos)) continue;
    // The same alpha as the indicatrix itself: they are parts of one disc, and change places as it crosses.
    const copy: MorphImage = { pos: farPos, mat: farMat, alpha: image.alpha, own: false, cuts: [] };
    // The two parts are the two sides of one chord, so between them they are the disc once, wherever the seam crosses it.
    const cut = cutAt(c, p, edge, radius);
    let own: Cut | null = null;
    if (cut) {
      if (cut[2] < 1) own = cut;
      copy.cuts.push([-cut[0], -cut[1], -cut[2]]);
    }
    copies.push({ copy, own });
  }
  // Where two seams are near, at a lobe's corner, a copy across one is on the image's own side of the other.
  for (const { copy, own } of copies) {
    for (const other of copies) if (other.own && other.own !== own) copy.cuts.push(other.own);
  }
  for (const { own } of copies) if (own) image.cuts.push(own);
  return [image, ...copies.map(({ copy }) => copy)];
}

/** The clip cap that holds a frame point, if any. */
function capHolding(c: CompiledProjection, frame: LonLat): ExcludedCap | undefined {
  return clipCaps(c).find((cap) => geoDistance(frame, cap.frameCenter) / rad < cap.radius);
}

/**
 * The derivative of a map with what it cannot show folded onto the edge of the cap that holds it: a point past the edge is put on
 * the edge, in its own direction from the cap's centre, so the derivative has rank one, along the edge. An indicatrix there is flat.
 * It is what the pieces of a morph do at that end, so mixed with the other end's it is the true derivative of the map on screen. A
 * side whose step has crossed a seam of the edge is left out, as in `jacobian`. See `FOLD_CLEAR` for a point near the cap's centre.
 */
export function foldedJacobian({ compiled: c, screen: s }: Member, p: LonLat): Mat2 {
  const frame = c.toFrame(p);
  const cap = capHolding(c, frame);
  let from = p;
  if (cap && geoDistance(frame, cap.frameCenter) / rad < FOLD_CLEAR) {
    // The point in the same direction from the centre, farther out: it folds to the same place on the edge.
    const axes = capAxes({ ...cap, radius: Math.min(FOLD_CLEAR, cap.radius) });
    from = c.fromFrame(edgePoint(axes, directionsOf(axes, [toVector(frame)])[0]!));
  }
  const centre = positionOn(c, s, from);
  const along = (azimuth: number): Pair => {
    const at = (sign: number): Pair => positionOn(c, s, destination(from, (sign * FOLD_STEP) / rad, azimuth));
    const [plus, minus] = [at(1), at(-1)];
    const forward: Pair = [(plus[0] - centre[0]) / FOLD_STEP, (plus[1] - centre[1]) / FOLD_STEP];
    const backward: Pair = [(centre[0] - minus[0]) / FOLD_STEP, (centre[1] - minus[1]) / FOLD_STEP];
    const [reachPlus, reachMinus] = [Math.hypot(...forward), Math.hypot(...backward)];
    if (!finite(plus) || reachPlus > FOLD_JUMP * reachMinus) return finite(minus) ? backward : [0, 0];
    if (!finite(minus) || reachMinus > FOLD_JUMP * reachPlus) return forward;
    return [(plus[0] - minus[0]) / (2 * FOLD_STEP), (plus[1] - minus[1]) / (2 * FOLD_STEP)];
  };
  const [east, north] = [along(90), along(0)];
  return [east[0], north[0], east[1], north[1]];
}

/**
 * What a map does with an indicatrix it cannot show: on the edge of the cap that holds it. Past a cap big enough to fold over (see
 * `hasCells`) it is the map folded there, flat, and takes the other end's strength. In a small cap, or where the map has no finite
 * derivative for some other reason, it has no shape of its own and no strength. None at all where the edge has no finite place.
 */
function unshown(m: Member, p: LonLat): MorphImage[] {
  const pos = positionOn(m.compiled, m.screen, p);
  if (!finite(pos)) return [];
  const cap = capHolding(m.compiled, m.compiled.toFrame(p));
  if (cap && hasCells(cap)) {
    const mat = foldedJacobian(m, p);
    if (mat.every(Number.isFinite)) return [{ pos, mat, alpha: null, own: true, cuts: [] }];
  }
  return [{ pos, mat: null, alpha: 0, own: true, cuts: [] }];
}

/**
 * What a map does with the indicatrix at `p` in a morph: every side of every seam near it, as at rest, each with the cuts that bound
 * its side. Where the map shows it at rest, this is what it shows. The far side of a globe counts as shown, like far-side land, with
 * the same derivative as the near side. Where the map cannot show it, it is the map folded onto its edge there.
 */
export function morphImages(m: Member, p: LonLat, radius = INDICATRIX_RADIUS): MorphImage[] {
  const { compiled: c, screen: s } = m;
  if (isBehind(m, p)) {
    const [pos, mat] = [projectPoint(c, s, p), jacobian(c, s, p)];
    return mat && finite(pos) ? [{ pos, mat, alpha: isSingular(mat) ? null : 1, own: true, cuts: [] }] : [];
  }
  // Its own place is where the map covers it and has a derivative there. Exactly on a cap's edge it has none (both sides along the edge
  // are just past it), and it is drawn as one just past the edge is, so it does not vanish there.
  const covered = isClipped(c, p) ? null : jacobian(c, s, p);
  const own = covered !== null;
  const margin = own ? 0 : capMargin;
  const mat = covered ?? jacobian(c, s, p, { margin });
  const frame = c.toFrame(p);
  const lobe = lobeOf(c, frame);
  const pos = projectFrame(c, s, frame, lobe);
  if (!mat || !finite(pos)) return unshown(m, p);
  // Flat, as on a globe's limb, it has no strength of its own; nor has one that the map does not show at all.
  const alpha = isSingular(mat) ? null : boundaryFade(m, p, mat);
  if (!own && !(alpha !== null && alpha > 0)) return unshown(m, p);
  return acrossSeams(c, s, p, frame, lobe, { pos, mat, alpha, own, cuts: [] }, margin, radius);
}

/**
 * What a map at rest shows of the indicatrix at `p`: its own place, if any, and the copies. None on a globe's far side, which a map at
 * rest does not show, and none where it is flat or has faded out.
 */
export function restImages(m: Member, p: LonLat, radius = INDICATRIX_RADIUS): RestImage[] {
  if (isBehind(m, p)) return [];
  return morphImages(m, p, radius).filter((image): image is RestImage => image.mat !== null && image.alpha !== null && image.alpha > 0);
}
