import { geoDistance, geoInterpolate } from 'd3-geo';
import type { CompiledProjection, LonLat } from '../projections/types';
import { isCovered, projectPoint, screenToLonLat, type ScreenTransform } from '../screen/screen';

const rad = Math.PI / 180;

type Pair = [number, number];

// How many steps a path begins with, before it is refined.
const STEPS = 32;
// No two neighbouring points of a path are farther apart than this on the Earth (degrees): the path is joined by great-circle arcs,
// which are then too short to stray from it.
const MAX_STEP = 1;
// How far (pixels) the middle of the arc between two neighbouring points may be from the middle of the line between them on the map.
const MAX_STRAY = 0.1;
// A path is never made of more points than this, however a map stretches it.
const MAX_POINTS = 2048;
// Two places closer than this on the map (pixels) have no line between them worth following.
const NO_LENGTH = 0.5;

/** A place on the map with the place on the Earth it shows. */
type Sample = { xy: Pair; p: LonLat };

/**
 * Adds points between neighbours that are too far apart, or whose joining arc strays from the map between them, until none are.
 * `between` is the place on the map half way from one to the next: along a line, or round a circle. Null if the map shows nothing there.
 */
function refine(c: CompiledProjection, s: ScreenTransform, samples: Sample[], between: (a: Sample, b: Sample, i: number) => Pair): Sample[] | null {
  let current = samples;
  // Each pass halves every step that needs it, so a dozen passes take a step down four thousandfold.
  for (let pass = 0; pass < 12 && current.length < MAX_POINTS; pass++) {
    const next: Sample[] = [current[0]!];
    let added = false;
    for (let i = 1; i < current.length; i++) {
      const [a, b] = [current[i - 1]!, current[i]!];
      const xy = between(a, b, i);
      const arcMiddle = projectPoint(c, s, geoInterpolate(a.p, b.p)(0.5) as LonLat);
      const strays = Math.hypot(arcMiddle[0] - xy[0], arcMiddle[1] - xy[1]) > MAX_STRAY;
      if (geoDistance(a.p, b.p) / rad > MAX_STEP || strays) {
        const p = screenToLonLat(c, s, xy);
        if (!p) return null;
        next.push({ xy, p });
        added = true;
      }
      next.push(b);
    }
    current = next;
    if (!added) break;
  }
  return current;
}

/**
 * The path on the Earth that is a straight line on this map from `a` to `b`: the places under the line, close enough together that,
 * joined by great-circle arcs as a drawn line is, they stay within a tenth of a pixel of it. Its ends are `a` and `b` themselves.
 * Null if the line leaves the map on the way, as across a gap of an interrupted map, or if the map does not show an end.
 */
export function straightPath(c: CompiledProjection, s: ScreenTransform, a: LonLat, b: LonLat): LonLat[] | null {
  if (!isCovered(c, a) || !isCovered(c, b)) return null;
  const [from, to] = [projectPoint(c, s, a), projectPoint(c, s, b)];
  if (![...from, ...to].every(Number.isFinite)) return null;
  if (Math.hypot(to[0] - from[0], to[1] - from[1]) < NO_LENGTH) return [a, b];
  const samples: Sample[] = [];
  for (let i = 0; i <= STEPS; i++) {
    const xy: Pair = [from[0] + ((to[0] - from[0]) * i) / STEPS, from[1] + ((to[1] - from[1]) * i) / STEPS];
    const p = i === 0 ? a : i === STEPS ? b : screenToLonLat(c, s, xy);
    if (!p) return null;
    samples.push({ xy, p });
  }
  const fine = refine(c, s, samples, (x, y) => [(x.xy[0] + y.xy[0]) / 2, (x.xy[1] + y.xy[1]) / 2]);
  return fine ? fine.map((sample) => sample.p) : null;
}

/**
 * The ring on the Earth that is a circle on this map, centred on `centre` and through `edge`, as a closed ring that goes clockwise
 * on the map, which is clockwise on the Earth seen from outside: the way a ring goes round its inside. Null if the circle leaves the
 * map, or has no size.
 */
export function circlePath(c: CompiledProjection, s: ScreenTransform, centre: LonLat, edge: LonLat): LonLat[] | null {
  if (!isCovered(c, centre) || !isCovered(c, edge)) return null;
  const [middle, through] = [projectPoint(c, s, centre), projectPoint(c, s, edge)];
  const radius = Math.hypot(through[0] - middle[0], through[1] - middle[1]);
  if (!(radius >= NO_LENGTH)) return null;
  const start = Math.atan2(through[1] - middle[1], through[0] - middle[0]);
  // With y down the page, a growing angle goes clockwise.
  const at = (angle: number): Pair => [middle[0] + radius * Math.cos(angle), middle[1] + radius * Math.sin(angle)];
  const steps = 2 * STEPS;
  const angles: number[] = [];
  const samples: Sample[] = [];
  for (let i = 0; i <= steps; i++) {
    const angle = start + (2 * Math.PI * i) / steps;
    const xy = at(angle);
    const p = screenToLonLat(c, s, xy);
    if (!p) return null;
    samples.push({ xy, p });
    angles.push(angle);
  }
  // Round the circle, half way between two of its points is at the angle half way between theirs.
  const angleOf = (sample: Sample) => Math.atan2(sample.xy[1] - middle[1], sample.xy[0] - middle[0]);
  const fine = refine(c, s, samples, (x, y, i) => {
    const [from, to] = [angleOf(x), angleOf(y)];
    // The last step comes back round to where the first began.
    const span = (((to - from) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) || (i > 0 ? 2 * Math.PI / steps : 0);
    return at(from + span / 2);
  });
  if (!fine) return null;
  const ring = fine.map((sample) => sample.p);
  ring[ring.length - 1] = ring[0]!;
  return ring;
}

/** Twice the area a polygon of map places goes round, positive if it goes clockwise with y down the page. */
function turning(points: Pair[]): number {
  let total = 0;
  points.forEach(([x, y], i) => {
    const [nx, ny] = points[(i + 1) % points.length]!;
    total += x * ny - nx * y;
  });
  return total;
}

/**
 * The closed ring on the Earth whose sides are straight lines on this map between the corners given, in the order that goes round its
 * inside, whichever way the corners came. Null if a side leaves the map, or there are fewer than three corners.
 */
export function straightRing(c: CompiledProjection, s: ScreenTransform, vertices: LonLat[]): LonLat[] | null {
  if (vertices.length < 3) return null;
  const clockwise = turning(vertices.map((p) => projectPoint(c, s, p))) > 0;
  const corners = clockwise ? vertices : [...vertices].reverse();
  const ring: LonLat[] = [];
  for (let i = 0; i < corners.length; i++) {
    const side = straightPath(c, s, corners[i]!, corners[(i + 1) % corners.length]!);
    if (!side) return null;
    ring.push(...side.slice(0, -1));
  }
  ring.push(ring[0]!);
  return ring;
}
