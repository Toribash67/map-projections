import { geoDistance } from 'd3-geo';
import { toVector } from '../geo/densify';
import type { CompiledProjection, Lobe, LonLat } from '../projections/types';
import { isClipped, lobeOf, projectFrame } from '../screen/screen';
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
/**
 * A cut at a lobe's edge is only needed near the equator, where the lobes meet and the gap between them is narrower than an
 * ellipse: from CUT_FROM degrees of frame latitude it eases off, and from CUT_TO there is none. Farther out the gap, which is past the
 * outline, takes off the part across the edge, and a cut there could only do harm near the pole, where the edge's great circle runs on
 * as another meridian.
 */
const [CUT_FROM, CUT_TO] = [20, 40];

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
 * at the edge of a lobe of an interrupted map is cut there, and its copy in the next lobe is the other half, so that neither is drawn
 * twice where the lobes meet at the equator and the gap between them is narrow.
 */
export type Cut = [number, number, number];

/**
 * How an indicatrix looks on a map at rest. `own` is the one at its centre's place on the map, which a morph moves; the others are
 * copies a map at rest shows besides: one whose centre is past a clip cap's edge (see `FADE_BAND`), and one on the far side of a
 * seam or lobe edge. `alpha` is its share of full strength, before the member's weight.
 */
export type RestImage = { pos: Pair; mat: Mat2; alpha: number; own: boolean; cut?: Cut };

const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const finite = (q: Pair) => Number.isFinite(q[0]) && Number.isFinite(q[1]);

/** A seam the map has next to a point: frame longitude `lon` from `latMin` to `latMax`, and how to reach the far side of it. */
type Edge = { lon: number; latMin: number; latMax: number; lobe: number | undefined; shift: number; between: boolean; inside: 1 | -1 };

/** The seams that bound the part of the map that holds a frame point: the antimeridian, or the sides of its lobe. */
function edgesOf(c: CompiledProjection, frame: LonLat, lobe: number | undefined): Edge[] {
  const seam = c.def.seam;
  if (seam.kind === 'none') return [];
  if (seam.kind === 'antimeridian') {
    const east = frame[0] >= 0;
    return [{ lon: east ? 180 : -180, latMin: -90, latMax: 90, lobe: undefined, shift: east ? -360 : 360, between: false, inside: east ? -1 : 1 }];
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
    edges.push({ lon, latMin: own.latMin, latMax: own.latMax, lobe: next.centralLon, shift: around ? 360 * inside : 0, between: !around, inside });
  }
  return edges;
}

/** Angle (degrees) from a frame point to an edge: to the meridian where the nearest point of it is within the edge, else to an end. */
function distanceTo(frame: LonLat, edge: Edge): number {
  const v = toVector(frame);
  const n = [-Math.sin(edge.lon * rad), Math.cos(edge.lon * rad), 0] as const;
  const off = v[0] * n[0] + v[1] * n[1];
  const foot = [v[0] - off * n[0], v[1] - off * n[1], v[2]] as const;
  const footLat = Math.atan2(foot[2], Math.hypot(foot[0], foot[1])) / rad;
  // The great circle of the meridian runs on as the opposite meridian, which is not the edge.
  const onEdge = foot[0] * Math.cos(edge.lon * rad) + foot[1] * Math.sin(edge.lon * rad) > 0;
  if (onEdge && footLat >= edge.latMin && footLat <= edge.latMax) return Math.asin(Math.min(1, Math.abs(off))) / rad;
  return Math.min(geoDistance(frame, [edge.lon, edge.latMin]), geoDistance(frame, [edge.lon, edge.latMax])) / rad;
}

/** The half of an indicatrix at `p` on its own side of a lobe edge, as a `Cut` in its east and north. Null at a frame pole. */
function cutAt(c: CompiledProjection, p: LonLat, edge: Edge): Cut | null {
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
  return [(-edge.inside * ne) / q, (-edge.inside * nn) / q, (edge.inside * np) / (INDICATRIX_RADIUS * q)];
}

/**
 * What a map at rest shows of the indicatrix at `p`: its own place, if any, and the copies. None on a globe's far side, which a map at
 * rest does not show.
 */
export function restImages(m: Member, p: LonLat): RestImage[] {
  const { compiled: c, screen: s } = m;
  if (isBehind(m, p)) return [];
  // Its own place is where the map covers it and has a derivative there, as a morph has it. Exactly on a cap's edge it has none (both
  // sides along the edge are just past it), and it is drawn as one just past the edge is, so it does not vanish there.
  const covered = isClipped(c, p) ? null : jacobian(c, s, p);
  const own = covered !== null;
  const margin = own ? 0 : capMargin;
  const mat = covered ?? jacobian(c, s, p, { margin });
  if (!mat || isSingular(mat)) return [];
  const alpha = boundaryFade(m, p, mat);
  if (!(alpha > 0)) return [];
  const frame = c.toFrame(p);
  const lobe = lobeOf(c, frame);
  const pos = projectFrame(c, s, frame, lobe);
  if (!finite(pos)) return [];
  const image: RestImage = { pos, mat, alpha, own };
  const images = [image];
  for (const edge of edgesOf(c, frame, lobe)) {
    if (distanceTo(frame, edge) >= MIRROR_REACH) continue;
    const far: LonLat = [frame[0] + edge.shift, frame[1]];
    const farPos = projectFrame(c, s, far, edge.lobe);
    const farMat = jacobian(c, s, p, { margin, continued: { near: far[0], lobe: edge.lobe } });
    if (!farMat || !finite(farPos)) continue;
    // The same alpha as the indicatrix itself: on the seam each is half of it, and they change places as it crosses.
    const copy: RestImage = { pos: farPos, mat: farMat, alpha, own: false };
    const cut = edge.between ? cutAt(c, p, edge) : null;
    const strength = 1 - smooth((Math.abs(frame[1]) - CUT_FROM) / (CUT_TO - CUT_FROM));
    if (cut && strength > 0) {
      // Eased off by moving the chord out to the edge of the disc, the same for both, so that they still match as they change places.
      const eased = (v: number) => 1 - strength * (1 - v);
      if (cut[2] < 1) image.cut = [cut[0], cut[1], eased(cut[2])];
      if (-cut[2] < 1) copy.cut = [-cut[0], -cut[1], eased(-cut[2])];
    }
    images.push(copy);
  }
  return images;
}
