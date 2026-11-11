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

type Vec = readonly [number, number, number];

/**
 * A seam or crease the map has next to a point: an arc of a great circle of the frame, as the unit normal of the circle on the
 * point's own side and a test of whether a point of the circle is on the arc, with how to reach the far side: the lobe there, and
 * the shift of longitude (degrees) that carries the point across the antimeridian to it.
 */
type Edge = { normal: Vec; holds(foot: Vec): boolean; lobe: number | undefined; shift: number };

const latOf = (v: Vec) => Math.atan2(v[2], Math.hypot(v[0], v[1])) / rad;

/** A side of a region along the meridian `lon`, from `latMin` to `latMax`, with the region to the east of it (`inside` 1) or the west (-1). */
function meridianEdge(lon: number, latMin: number, latMax: number, inside: 1 | -1, lobe: number | undefined, shift: number): Edge {
  const [cos, sin] = [Math.cos(lon * rad), Math.sin(lon * rad)];
  return {
    normal: [-inside * sin, inside * cos, 0],
    // The great circle of the meridian runs on as the opposite meridian, which is not the edge.
    holds: (foot) => foot[0] * cos + foot[1] * sin > 0 && latOf(foot) >= latMin && latOf(foot) <= latMax,
    lobe,
    shift,
  };
}

/** A side of a region along the equator, from `lonMin` to `lonMax`, with the region to the north of it (`inside` 1) or the south (-1). */
function equatorEdge(lonMin: number, lonMax: number, inside: 1 | -1, lobe: number): Edge {
  return {
    normal: [0, 0, inside],
    holds: (foot) => {
      const lon = Math.atan2(foot[1], foot[0]) / rad;
      return lon >= lonMin && lon <= lonMax;
    },
    lobe,
    shift: 0,
  };
}

/** The seams and creases that bound the part of the map that holds a frame point: the antimeridian, or the sides of its lobe. */
function edgesOf(c: CompiledProjection, frame: LonLat, lobe: number | undefined): Edge[] {
  const seam = c.def.seam;
  if (seam.kind === 'none') return [];
  if (seam.kind === 'antimeridian') {
    const east = frame[0] >= 0;
    return [meridianEdge(east ? 180 : -180, -90, 90, east ? -1 : 1, undefined, east ? -360 : 360)];
  }
  const own = seam.lobes.find((l) => l.id === lobe && frame[0] >= l.lonMin && frame[0] <= l.lonMax && frame[1] >= l.latMin && frame[1] <= l.latMax);
  if (!own) return [];
  const band = (l: Lobe) => l.latMin === own.latMin && l.latMax === own.latMax;
  const edges: Edge[] = [];
  for (const [lon, inside] of [[own.lonMin, 1], [own.lonMax, -1]] as const) {
    // Across the antimeridian the next lobe is at the other end of the map.
    const around = Math.abs(lon) === 180;
    const next = seam.lobes.find((l) => band(l) && (inside === 1 ? l.lonMax === (around ? 180 : lon) : l.lonMin === (around ? -180 : lon)));
    // The other rectangle of the lobe itself is across no seam: the map is one piece there.
    if (!next || next.id === own.id) continue;
    edges.push(meridianEdge(lon, own.latMin, own.latMax, inside, next.id, around ? 360 * inside : 0));
  }
  // Along the equator a lobe meets those of the other hemisphere. Where the map does not run smoothly on there, it is creased or
  // cut, and each lobe across it has its own stretch of the edge.
  if (!seam.smoothEquator) {
    const inside = own.latMin === 0 ? 1 : own.latMax === 0 ? -1 : null;
    if (inside !== null) {
      for (const across of seam.lobes) {
        const meets = (inside === 1 ? across.latMax === 0 : across.latMin === 0) && across.id !== own.id;
        const [from, to] = [Math.max(own.lonMin, across.lonMin), Math.min(own.lonMax, across.lonMax)];
        if (meets && to > from) edges.push(equatorEdge(from, to, inside, across.id));
      }
    }
  }
  return edges;
}

/**
 * Angle (degrees) from a frame point to a seam, where the nearest point of the seam's great circle lies on the seam itself; infinite
 * where it lies past an end of it. A seam ends at a pole of the frame or at the equator, and its great circle runs on from there as
 * a line that is no seam: a disc beside that part is whole, and cutting it along the circle would take half of it away.
 */
function distanceTo(frame: LonLat, edge: Edge): number {
  const v = toVector(frame);
  const n = edge.normal;
  const off = v[0] * n[0] + v[1] * n[1] + v[2] * n[2];
  const foot = [v[0] - off * n[0], v[1] - off * n[1], v[2] - off * n[2]] as const;
  return edge.holds(foot) ? Math.asin(Math.min(1, Math.abs(off))) / rad : Infinity;
}

/** The part of an indicatrix at `p`, of `radius` radians, on its own side of a seam, as a `Cut` in its east and north. Null where the seam's circle has no direction from it. */
function cutAt(c: CompiledProjection, p: LonLat, edge: Edge, radius: number): Cut | null {
  // The normal of the seam's circle, on the indicatrix's own side, carried from the frame to the Earth as a point is.
  const [nx, ny, nz] = edge.normal;
  const n = toVector(c.fromFrame([Math.atan2(ny, nx) / rad, Math.asin(Math.max(-1, Math.min(1, nz))) / rad]));
  const [lon, lat] = [p[0] * rad, p[1] * rad];
  const centre = toVector(p);
  const east = [-Math.sin(lon), Math.cos(lon), 0];
  const north = [-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat)];
  const dot = (a: readonly number[]) => a[0]! * n[0] + a[1]! * n[1] + a[2]! * n[2];
  const [ne, nn, np] = [dot(east), dot(north), dot(centre)];
  const q = Math.hypot(ne, nn);
  if (!(q > 1e-9)) return null;
  // A point at x (in units of the indicatrix's radius) east and north of the centre is on its own side where n . point > 0.
  return [-ne / q, -nn / q, np / (radius * q)];
}

/** The lobe that holds a frame point, as a rectangle of the seam, or undefined. */
const rectangleAt = (lobes: Lobe[], [lon, lat]: LonLat) => lobes.find((l) => lon >= l.lonMin && lon <= l.lonMax && lat >= l.latMin && lat <= l.latMax);

// How far (degrees) past each of two edges a point is put, to find the lobe that lies across both from a corner.
const PAST_CORNER = 0.5;

/**
 * Adds to an image at `frame` its copies across the seams near it, each cut to its side of the seam, and cuts the image to its own.
 * By a corner where two seams meet, as at a pole of an interrupted map or at a corner of a polyhedral one, there is a part across
 * each of the two and one more, across both, in the lobe that lies diagonally over the corner.
 */
function acrossSeams(c: CompiledProjection, s: Member['screen'], p: LonLat, frame: LonLat, lobe: number | undefined, image: MorphImage, margin: Margin, radius: number): MorphImage[] {
  // As far as an indicatrix of this radius can reach across a seam: see `MIRROR_REACH`.
  const reach = (MIRROR_REACH * radius) / INDICATRIX_RADIUS;
  const copies: { copy: MorphImage; own: Cut | null; edge: Edge }[] = [];
  const continued = (lon: number, onLobe: number | undefined): MorphImage | null => {
    const pos = projectFrame(c, s, [lon, frame[1]], onLobe);
    const mat = jacobian(c, s, p, { margin, continued: { near: lon, lobe: onLobe } });
    // The same alpha as the indicatrix itself: they are parts of one disc, and change places as it crosses.
    return mat && finite(pos) ? { pos, mat, alpha: image.alpha, own: false, cuts: [] } : null;
  };
  for (const edge of edgesOf(c, frame, lobe)) {
    if (distanceTo(frame, edge) >= reach) continue;
    // The two parts are the two sides of one chord, so between them they are the disc once, wherever the seam crosses it. Where it
    // does not cross the disc at all there is no part across it.
    const cut = cutAt(c, p, edge, radius);
    if (cut && cut[2] >= 1) continue;
    const copy = continued(frame[0] + edge.shift, edge.lobe);
    if (!copy) continue;
    if (cut) copy.cuts.push([-cut[0], -cut[1], -cut[2]]);
    copies.push({ copy, own: cut, edge });
  }
  const extra: MorphImage[] = [];
  const seam = c.def.seam;
  if (seam.kind === 'lobes') {
    for (let i = 0; i < copies.length; i++) {
      for (let j = i + 1; j < copies.length; j++) {
        const [a, b] = [copies[i]!, copies[j]!];
        if (!a.own || !b.own) continue;
        // The lobe over the corner: where a point is that lies just past both edges.
        const [na, nb] = [a.edge.normal, b.edge.normal];
        const v = toVector(frame);
        const beyond = (n: Vec) => v[0] * n[0] + v[1] * n[1] + v[2] * n[2] + Math.sin(PAST_CORNER * rad);
        const past = v.map((x, k) => x - beyond(na) * na[k]! - beyond(nb) * nb[k]!) as [number, number, number];
        const length = Math.hypot(...past);
        const over = rectangleAt(seam.lobes, [Math.atan2(past[1], past[0]) / rad, Math.asin(Math.max(-1, Math.min(1, past[2] / length))) / rad]);
        if (!over || over.id === lobe || over.id === a.edge.lobe || over.id === b.edge.lobe) continue;
        const diagonal = continued(frame[0] + a.edge.shift + b.edge.shift, over.id);
        if (diagonal) extra.push({ ...diagonal, cuts: [[-a.own[0], -a.own[1], -a.own[2]], [-b.own[0], -b.own[1], -b.own[2]]] });
      }
    }
  }
  // Where two seams are near, a copy across one is on the image's own side of the other.
  for (const { copy, own } of copies) {
    for (const other of copies) if (other.own && other.own !== own) copy.cuts.push(other.own);
  }
  for (const { own } of copies) if (own) image.cuts.push(own);
  return [image, ...copies.map(({ copy }) => copy), ...extra];
}

/** The clip cap that holds a frame point, if any. */
function capHolding(c: CompiledProjection, frame: LonLat): ExcludedCap | undefined {
  return clipCaps(c).find((cap) => !cap.regular && geoDistance(frame, cap.frameCenter) / rad < cap.radius);
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
