import { geoDistance, geoInterpolate } from 'd3-geo';
import type { ExcludedCap, LonLat } from '../projections/types';
import { projectPoint } from '../screen/screen';
import { jacobian, singularValues, type Mat2, type Member } from './indicatrix';

const rad = Math.PI / 180;

/**
 * An indicatrix fades out over this many degrees at the edge of a clip cap, by how far its centre is from the edge, so that none
 * appears or vanishes at once as the map turns. A large cap, such as gnomonic's, leaves the map finite past its edge, and there the
 * band lies past the edge: an indicatrix whose centre has just left the map still shows its inside part, faintly, and slides out
 * of view. A small one is a pole the map cannot reach, such as Mercator's 5 degrees or the 0.1 degree caps of the world maps, where
 * indicatrices blow up as they near it: there the band lies inside the map, and the cap's edge is where they have faded out.
 */
export const FADE_BAND = 10;
// A cap up to this radius (degrees) has all of the band inside the map, one from LARGE_CAP all of it past the edge, and one between
// a share of each, so a conic whose parameters move a cap through the range changes its indicatrices smoothly too.
const SMALL_CAP = 5;
const LARGE_CAP = 15;
/**
 * Past the edge an indicatrix also fades as it grows, from as large as at the edge to this many times that, so that one
 * on a map whose scale runs to infinity a little past its edge (the viewpoints between gnomonic and stereographic) is gone before
 * it is huge.
 */
const GROWTH = 4;
// Steps along the way from a cap's edge to a point past it, and how far (degrees) inside the edge the way is taken from.
const PATH_STEPS = 4;
const LEAD_IN = 1;
// A step shorter than this (pixels) has no direction worth reading.
const NO_STEP = 1e-6;

const ramp = (v: number, from: number, to: number) => Math.min(1, Math.max(0, (v - from) / (to - from)));
/** 0 up to 0, 1 from 1, and smooth in between, with no kink at either end. */
const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** How far (degrees) past a clip cap's edge indicatrices are computed: none for a small cap, `FADE_BAND` for a large one. */
export const capMargin = (cap: ExcludedCap): number => (cap.mode === 'clip' && !cap.regular ? FADE_BAND * ramp(cap.radius, SMALL_CAP, LARGE_CAP) : 0);

/**
 * The alpha of an indicatrix at `p` on a map at rest, for how near it is to the map's clip caps: 1 away from them, falling smoothly
 * to 0 across each cap's band (see `FADE_BAND`), and 0 beyond. `mat` is its matrix, computed with `capMargin`. A globe's far side
 * is not a clip cap and does not fade here.
 */
export function boundaryFade(m: Member, p: LonLat, mat: Mat2): number {
  const frame = m.compiled.toFrame(p);
  let fade = 1;
  for (const cap of m.compiled.caps) {
    // By a regular cap the map is as it is anywhere: nothing fades there.
    if (cap.mode !== 'clip' || cap.regular) continue;
    const margin = capMargin(cap);
    const distance = geoDistance(frame, cap.frameCenter) / rad;
    // How far the centre is outside the cap, on the map; negative past its edge.
    const outside = distance - cap.radius;
    fade *= smooth((outside + margin) / FADE_BAND);
    if (outside < 0 && fade > 0) fade *= pastEdge(m, cap, frame, distance, mat);
    if (!(fade > 0)) return 0;
  }
  return fade;
}

/** The share of an indicatrix past a cap's edge that its size and the map's shape there leave: see `GROWTH` and `continuesOutward`. */
function pastEdge(m: Member, cap: ExcludedCap, frame: LonLat, distance: number, mat: Mat2): number {
  const { compiled: c, screen: s } = m;
  const along = geoInterpolate(cap.frameCenter, frame);
  const rim = jacobian(c, s, c.fromFrame(along(cap.radius / distance) as LonLat), { margin: capMargin });
  if (!rim || !continuesOutward(m, cap, frame, distance)) return 0;
  const growth = singularValues(mat)[0] / singularValues(rim)[0];
  return Number.isFinite(growth) ? 1 - smooth((growth - 1) / (GROWTH - 1)) : 0;
}

/**
 * Whether the map carries on outwards past the edge of a cap, as far as the frame point `frame`, `distance` degrees from the cap's
 * centre. Gnomonic does, up to 90 degrees from its centre; an orthographic map does not: past its limb it turns back over the near
 * side, and there an indicatrix would be a second copy of something the map already shows. Taken along the great circle from the
 * cap's centre through the point: every step has to go on the way the one before went, from just inside the edge.
 */
function continuesOutward({ compiled: c, screen: s }: Member, cap: ExcludedCap, frame: LonLat, distance: number): boolean {
  const depth = cap.radius - distance;
  // A point at a cap's centre has no direction from it.
  if (!(distance > 1e-6)) return false;
  const along = geoInterpolate(cap.frameCenter, frame);
  const angles = [cap.radius + LEAD_IN, ...Array.from({ length: PATH_STEPS + 1 }, (_, i) => cap.radius - (depth * i) / PATH_STEPS)];
  const points = angles.map((angle) => projectPoint(c, s, c.fromFrame(along(angle / distance) as LonLat)));
  let previous: [number, number] | null = null;
  for (let i = 1; i < points.length; i++) {
    const step: [number, number] = [points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]];
    if (!step.every(Number.isFinite)) return false;
    // A point a hair past the edge has hardly any way to go.
    if (Math.hypot(step[0], step[1]) < NO_STEP) continue;
    if (previous && step[0] * previous[0] + step[1] * previous[1] <= 0) return false;
    previous = step;
  }
  return true;
}
