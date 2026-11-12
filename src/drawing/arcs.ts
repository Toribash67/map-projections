import { cross, dot, toVector, type Vector } from '../geo/densify';
import type { LonLat } from '../projections/types';

const rad = Math.PI / 180;

// Two points this close (degrees) to antipodal have no one great circle through them to speak of: d3
// interpolates between them in steps of rounding noise, and the clips cannot place the arc.
const ANTIPODAL = 1e-3;
// How near (radians) two arcs have to come to meet. Touching counts.
const TOUCH = 1e-9;
// Two edges leaving a vertex within this angle (radians) of each other lie along one another.
const FOLDED = 1e-6;
// Great circles meeting at less than this angle (radians) are taken for one.
const SAME_CIRCLE = 1e-9;

const length = (a: Vector) => Math.hypot(a[0], a[1], a[2]);
const scale = (a: Vector, k: number): Vector => [a[0] * k, a[1] * k, a[2] * k];
const unit = (a: Vector) => scale(a, 1 / length(a));

const isAntipodal = (a: LonLat, b: LonLat) => Math.abs(dot(toVector(a), toVector(b)) + 1) < 1 - Math.cos(ANTIPODAL * rad);

/**
 * The path with a vertex added wherever an edge runs between antipodes, since such an edge has
 * no great circle of its own. The vertex is the north pole, so that the edge is the meridian
 * circle through both ends. A closed ring is returned without its first point repeated.
 *
 * Ends within `ANTIPODAL` (1e-3 degrees) of antipodal count as antipodes: such an edge takes this
 * route over the pole, not its own true arc, which may run anywhere round the sphere and which the
 * clips cannot place. Where either end is that near a pole, the pole would leave the other edge as
 * nearly antipodal again, and a point on the equator is used instead.
 */
export function withoutAntipodalEdges(points: LonLat[], closed = false): LonLat[] {
  const out: LonLat[] = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const a = points[i]!;
    out.push(a);
    const b = i + 1 < n ? points[i + 1]! : closed && n > 1 ? points[0]! : null;
    if (b && isAntipodal(a, b)) {
      // Between a pole and the other pole, a point on the equator will do.
      const polar = Math.max(Math.abs(a[1]), Math.abs(b[1])) > 90 - 2 * ANTIPODAL;
      out.push(polar ? [0, 0] : [a[0], 90]);
    }
  }
  return out;
}

/** Whether `x`, on the great circle of the arc a to b, lies on that arc. `normal` is the unit normal of the circle, a x b. */
function onArc(x: Vector, a: Vector, b: Vector, normal: Vector): boolean {
  return dot(cross(a, x), normal) >= -TOUCH && dot(cross(x, b), normal) >= -TOUCH;
}

/** Whether the minor arcs a-b and c-d have a point in common, an end included. */
function arcsMeet(a: Vector, b: Vector, c: Vector, d: Vector): boolean {
  const [nab, ncd] = [cross(a, b), cross(c, d)];
  const [lab, lcd] = [length(nab), length(ncd)];
  // An arc with no length has no direction. Merged points keep this out of reach.
  if (lab < TOUCH || lcd < TOUCH) return false;
  const [n1, n2] = [scale(nab, 1 / lab), scale(ncd, 1 / lcd)];
  const meeting = cross(n1, n2);
  const lm = length(meeting);
  if (lm < SAME_CIRCLE) return onArc(c, a, b, n1) || onArc(d, a, b, n1) || onArc(a, c, d, n2) || onArc(b, c, d, n2);
  const x = scale(meeting, 1 / lm);
  const away = scale(x, -1);
  return (onArc(x, a, b, n1) && onArc(x, c, d, n2)) || (onArc(away, a, b, n1) && onArc(away, c, d, n2));
}

/** Whether the edge q to r doubles back along the edge p to q. */
function foldsBack(p: Vector, q: Vector, r: Vector): boolean {
  const [tp, tr] = [cross(q, cross(p, q)), cross(q, cross(r, q))];
  const [lp, lr] = [length(tp), length(tr)];
  if (lp === 0 || lr === 0) return true;
  return dot(tp, tr) > 0 && length(cross(tp, tr)) / (lp * lr) < FOLDED;
}

/**
 * Whether great-circle edges join the points without crossing, touching or doubling back on one
 * another. Neighbouring edges meet at their shared vertex and nowhere else. A closed path also
 * joins its last point to its first.
 */
export function isSimple(points: LonLat[], closed: boolean): boolean {
  const path = withoutAntipodalEdges(points, closed);
  const v = path.map(toVector);
  const n = v.length;
  const edges = closed ? n : n - 1;
  for (let i = 0; i < edges; i++) {
    const [a, b] = [v[i]!, v[(i + 1) % n]!];
    for (let j = i + 1; j < edges; j++) {
      const [c, d] = [v[j]!, v[(j + 1) % n]!];
      const neighbours = j === i + 1 || (closed && i === 0 && j === edges - 1);
      if (!neighbours) {
        if (arcsMeet(a, b, c, d)) return false;
      } else if (j === i + 1 ? foldsBack(a, b, d) : foldsBack(b, a, c)) {
        return false;
      }
    }
  }
  return true;
}
