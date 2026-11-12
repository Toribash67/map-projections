/** A place on screen, in CSS pixels. */
export type Pair = [number, number];

/**
 * How a name is fitted. `thin`: a slice of the shape takes lettering if it is at least this share of the thickest. `fill`: the height
 * of a letter as a share of the room across. `minGap` and `maxGap`: the least and most space between letters, in letter heights.
 * `spread`: the share of the curve the name is spaced out to take, as far as `maxGap` allows. `maxSize`: the tallest a letter may be.
 */
export type FitOptions = { thin: number; fill: number; minGap: number; maxGap: number; spread: number; maxSize: number };
/** A country: capitals that fill their country. */
export const COUNTRY_FIT: FitOptions = { thin: 0.5, fill: 0.42, minGap: 0.12, maxGap: 1.1, spread: 0.72, maxSize: 30 };
/** A sea: smaller in its room, and spaced wider. */
export const SEA_FIT: FitOptions = { thin: 0.45, fill: 0.2, minGap: 0.3, maxGap: 2.2, spread: 0.6, maxSize: 26 };

/**
 * A name fitted to a shape: how tall its letters are, the space between them in letter heights, and the curve its middle line runs
 * along, in the direction it reads, with the curve's length. The name is set about the middle of the curve.
 */
export type Fit = { size: number; gap: number; curve: Pair[]; length: number };

// How many directions a name is tried in, half a turn between them, and how many slices are taken across the shape in each.
const DIRECTIONS = 18;
const SLICES = 28;
// The most a curve bends: how far its middle is from the line between its ends, as a share of half its run.
const MAX_BEND = 0.35;
// The share of the run of slices the curve takes, about its middle: a name does not run to the very edge.
const INSET = 0.84;
// How many pieces the curve is made of.
const PIECES = 24;
// How much a level name is preferred: an upright one must be this much taller to be chosen.
const LEVEL = 0.22;
// A name that strays outside its shape is made this much smaller, and tried again, down to this share of its first size.
const TIGHTER = 0.85;
const TIGHTEST = 0.4;
// The most a curve may lean from the direction it is fitted along: the tangent of 30 degrees.
const MAX_SLOPE = 0.58;
// Directions that score within this share of the best are as good as each other.
const SAME = 0.97;
// Steeper than this (radians from level), a name reads upward.
const UPRIGHT = (80 * Math.PI) / 180;

function ringArea(ring: Pair[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [a, b] = [ring[i]!, ring[(i + 1) % ring.length]!];
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return sum / 2;
}

/** The area of a shape. Its holes wind the other way from its outer rings, so they take away from it. */
export function polygonArea(rings: Pair[][]): number {
  return Math.abs(rings.reduce((sum, ring) => sum + ringArea(ring), 0));
}

/** Whether a point is in a shape: within an odd number of its rings. */
export function contains(rings: Pair[][], [x, y]: Pair): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [a, b] = [ring[i]!, ring[j]!];
      if (a[1] > y !== b[1] > y && x < a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0])) inside = !inside;
    }
  }
  return inside;
}

/** A shape cut to a window: each ring by each side in turn. A ring with nothing left in the window is dropped. */
export function clipToRect(rings: Pair[][], rect: { x: number; y: number; width: number; height: number }): Pair[][] {
  // Each side as: is a point within it, and where does an edge cross it.
  const sides: [(p: Pair) => boolean, (a: Pair, b: Pair) => Pair][] = [
    [(p) => p[0] >= rect.x, (a, b) => [rect.x, a[1] + ((rect.x - a[0]) / (b[0] - a[0])) * (b[1] - a[1])]],
    [(p) => p[0] <= rect.x + rect.width, (a, b) => [rect.x + rect.width, a[1] + ((rect.x + rect.width - a[0]) / (b[0] - a[0])) * (b[1] - a[1])]],
    [(p) => p[1] >= rect.y, (a, b) => [a[0] + ((rect.y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]), rect.y]],
    [(p) => p[1] <= rect.y + rect.height, (a, b) => [a[0] + ((rect.y + rect.height - a[1]) / (b[1] - a[1])) * (b[0] - a[0]), rect.y + rect.height]],
  ];
  const out: Pair[][] = [];
  for (const ring of rings) {
    let points = ring;
    for (const [within, crossing] of sides) {
      const kept: Pair[] = [];
      points.forEach((a, i) => {
        const b = points[(i + 1) % points.length]!;
        if (within(a)) kept.push(a);
        if (within(a) !== within(b)) kept.push(crossing(a, b));
      });
      points = kept;
      if (points.length === 0) break;
    }
    if (points.length >= 3) out.push(points);
  }
  return out;
}

/** The place a distance along a curve from its start, and the way the curve runs there (radians, clockwise from rightward on screen). Past an end it goes on straight. */
export function along(curve: Pair[], distance: number): { p: Pair; angle: number } {
  let left = distance;
  for (let i = 1; i < curve.length; i++) {
    const [a, b] = [curve[i - 1]!, curve[i]!];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length === 0) continue;
    if (left <= length || i === curve.length - 1) return { p: [a[0] + ((b[0] - a[0]) * left) / length, a[1] + ((b[1] - a[1]) * left) / length], angle: Math.atan2(b[1] - a[1], b[0] - a[0]) };
    left -= length;
  }
  return { p: curve[0] ?? [0, 0], angle: 0 };
}

/** How much of its curve a name takes: its letters and the spaces between them. `advance` is its width at a height of one with no space added. */
export const textLength = (fit: Pick<Fit, 'size' | 'gap'>, advance: number, count: number): number => fit.size * (advance + (count - 1) * fit.gap);

/** The same name with letters `by` times as tall, on the same curve with the same spacing: it takes that much less of the curve. */
export const shrink = (fit: Fit, by: number): Fit => ({ ...fit, size: fit.size * by });

/** The determinant of a 3 by 3 matrix, row by row. */
const det = (m: number[]): number => m[0]! * (m[4]! * m[8]! - m[5]! * m[7]!) - m[1]! * (m[3]! * m[8]! - m[5]! * m[6]!) + m[2]! * (m[3]! * m[7]! - m[4]! * m[6]!);

/** A fit, and how far its curve leans from the direction it was fitted along. */
type Sloped = Fit & { slope: number };

/** A name fitted along one direction (`theta`, radians), before its size is limited: its curve, and the room it has. */
function fitAlong(rings: Pair[][], theta: number, advance: number, count: number, opts: FitOptions): Sloped | null {
  // The shape turned so that the direction is along u, with v across it.
  const [c, s] = [Math.cos(theta), Math.sin(theta)];
  const turned = rings.map((ring) => ring.map(([x, y]): Pair => [x * c + y * s, -x * s + y * c]));
  let [u0, u1] = [Infinity, -Infinity];
  for (const ring of turned) for (const [u] of ring) [u0, u1] = [Math.min(u0, u), Math.max(u1, u)];
  if (!(u1 > u0)) return null;

  // Across each slice, the widest stretch that is inside the shape: its middle and its thickness.
  const slices: { u: number; mid: number; thick: number }[] = [];
  for (let i = 0; i < SLICES; i++) {
    const u = u0 + ((i + 0.5) / SLICES) * (u1 - u0);
    const crossings: number[] = [];
    for (const ring of turned) {
      for (let j = 0; j < ring.length; j++) {
        const [a, b] = [ring[j]!, ring[(j + 1) % ring.length]!];
        if (a[0] <= u !== b[0] <= u) crossings.push(a[1] + ((u - a[0]) / (b[0] - a[0])) * (b[1] - a[1]));
      }
    }
    crossings.sort((a, b) => a - b);
    let [mid, thick] = [0, 0];
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      if (crossings[k + 1]! - crossings[k]! > thick) [mid, thick] = [(crossings[k]! + crossings[k + 1]!) / 2, crossings[k + 1]! - crossings[k]!];
    }
    slices.push({ u, mid, thick });
  }

  // The longest run of slices thick enough to letter: against the thickest slice, and against the middling one, which serves a shape
  // with a short thick part and a long thin one. Whichever gives the taller letters.
  const thicknesses = slices.map((slice) => slice.thick).filter((thick) => thick > 0).sort((p, q) => p - q);
  if (thicknesses.length === 0) return null;
  const fits = [thicknesses.at(-1)!, thicknesses[thicknesses.length >> 1]!].map((measure) => fitRun(slices, opts.thin * measure, c, s, advance, count, opts));
  return fits.reduce((best, fit) => (fit && (!best || fit.size > best.size) ? fit : best), null);
}

/** A name along the longest run of slices at least `least` thick, in the direction whose cosine and sine are `c` and `s`. */
function fitRun(slices: { u: number; mid: number; thick: number }[], least: number, c: number, s: number, advance: number, count: number, opts: FitOptions): Sloped | null {
  let [from, to] = [0, -1];
  for (let i = 0; i < SLICES; ) {
    if (slices[i]!.thick < least || slices[i]!.thick === 0) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < SLICES && slices[j + 1]!.thick >= least) j++;
    if (j - i > to - from) [from, to] = [i, j];
    i = j + 1;
  }
  const run = slices.slice(from, to + 1);
  if (run.length < 4) return null;

  // A parabola through the middles of the run, by least squares: v = a + b t + c t^2, with t from -1 to 1 over the run.
  const [middle, half] = [(run[0]!.u + run.at(-1)!.u) / 2, (run.at(-1)!.u - run[0]!.u) / 2];
  let [s0, s1, s2, s3, s4, t0, t1, t2] = [0, 0, 0, 0, 0, 0, 0, 0];
  for (const slice of run) {
    const t = (slice.u - middle) / half;
    s0 += 1; s1 += t; s2 += t * t; s3 += t ** 3; s4 += t ** 4;
    t0 += slice.mid; t1 += slice.mid * t; t2 += slice.mid * t * t;
  }
  const d = det([s0, s1, s2, s1, s2, s3, s2, s3, s4]);
  let a = det([t0, s1, s2, t1, s2, s3, t2, s3, s4]) / d;
  const b = det([s0, t0, s2, s1, t1, s3, s2, t2, s4]) / d;
  const bend = det([s0, s1, t0, s1, s2, t1, s2, s3, t2]) / d;
  // A name is an arc and never a hook. What is taken off the bend is put back as height, so the curve stays about the middles.
  const curved = Math.max(-MAX_BEND * half, Math.min(MAX_BEND * half, bend));
  a += (bend - curved) / 3;
  const v = (t: number) => a + b * t + curved * t * t;

  const curve: Pair[] = [];
  let length = 0;
  for (let i = 0; i <= PIECES; i++) {
    const t = (-1 + (2 * i) / PIECES) * INSET;
    const [u, across] = [middle + half * t, v(t)];
    curve.push([u * c - across * s, u * s + across * c]);
    if (i > 0) length += Math.hypot(curve[i]![0] - curve[i - 1]![0], curve[i]![1] - curve[i - 1]![1]);
  }
  // The room across: the thinnest slice under the curve, less how far the curve is from that slice's middle. A slice is taken across
  // the direction and not across the curve, so where the curve slopes the room across it is that much less.
  let room = Infinity;
  for (const slice of run) {
    const t = (slice.u - middle) / half;
    if (Math.abs(t) > INSET) continue;
    const slope = (b + 2 * curved * t) / half;
    room = Math.min(room, (slice.thick - 2 * Math.abs(slice.mid - v(t))) / Math.hypot(1, slope));
  }
  const size = Math.min(opts.fill * room, length / (advance + (count - 1) * opts.minGap));
  if (!(size > 0)) return null;
  return { size, gap: 0, curve, length, slope: Math.abs(b) / half };
}

/** The space between letters that spreads a name over its share of the curve, within the limits. */
function gapFor(fit: Fit, advance: number, count: number, opts: FitOptions): number {
  if (count < 2) return 0;
  const wanted = (fit.length * opts.spread - advance * fit.size) / ((count - 1) * fit.size);
  const most = (fit.length - advance * fit.size) / ((count - 1) * fit.size);
  return Math.max(opts.minGap, Math.min(opts.maxGap, wanted, most));
}

/** Whether the lettering lies in the shape: its middle line and the lines half a letter's height either side of it, along the part of the curve the name takes. */
function within(rings: Pair[][], fit: Fit, advance: number, count: number): boolean {
  const taken = textLength(fit, advance, count);
  const start = (fit.length - taken) / 2;
  for (let i = 0; i <= 12; i++) {
    const { p, angle } = along(fit.curve, start + (i / 12) * taken);
    for (const across of [-0.5, 0, 0.5]) {
      if (!contains(rings, [p[0] - Math.sin(angle) * across * fit.size, p[1] + Math.cos(angle) * across * fit.size])) return false;
    }
  }
  return true;
}

/**
 * Fits a name to a shape on screen: the rings of one piece of a map, outer rings and holes in any order. `advance` is the name's width at a letter
 * height of one with no space added between letters, and `count` how many letters it has.
 *
 * The shape is tried at a spread of directions. At each it is sliced across, and the name is set along a gentle curve through the
 * middles of the longest run of slices thick enough to letter, as tall as the thinnest of them and the curve's length allow. The
 * direction that gives the tallest letters wins, with a lean towards level lettering. The name is then spaced out along the curve.
 * It reads left to right, or upward where it is nearly upright. Null where the shape has no room for a name at all.
 */
export function fitLabel(rings: Pair[][], advance: number, count: number, opts: FitOptions): Fit | null {
  if (!rings.some((ring) => ring.length >= 3) || count < 1) return null;
  const tried: { fit: Sloped; score: number }[] = [];
  for (let k = 0; k < DIRECTIONS; k++) {
    const theta = (k * Math.PI) / DIRECTIONS - Math.PI / 2;
    const fit = fitAlong(rings, theta, advance, count, opts);
    // A curve that leans far from the direction it was fitted along is measured badly, as its room is then to the sides and not
    // across the slices; another direction is nearer to it.
    if (!fit || fit.slope > MAX_SLOPE) continue;
    const [start, end] = [fit.curve[0]!, fit.curve.at(-1)!];
    const lean = Math.abs(Math.sin(Math.atan2(end[1] - start[1], end[0] - start[0])));
    tried.push({ fit, score: Math.min(fit.size, opts.maxSize) * (1 - LEVEL * lean) });
  }
  // The best first. Among directions as good as each other, the one the curve runs straightest along: that is the way the shape lies.
  const best = Math.max(0, ...tried.map((one) => one.score));
  const close = (one: { score: number }) => one.score >= SAME * best;
  tried.sort((p, q) => Number(close(q)) - Number(close(p)) || (close(p) && close(q) ? p.fit.slope - q.fit.slope : q.score - p.score));
  // The best direction whose lettering stays in the shape, made smaller if it must be.
  for (const { fit: { slope: _, ...found } } of tried) {
    let fit: Fit = { ...found, size: Math.min(found.size, opts.maxSize) };
    fit.gap = gapFor(fit, advance, count, opts);
    const first = fit.size;
    while (!within(rings, fit, advance, count)) {
      if (fit.size * TIGHTER < TIGHTEST * first) break;
      fit = shrink(fit, TIGHTER);
    }
    if (!within(rings, fit, advance, count)) continue;
    const [start, end] = [fit.curve[0]!, fit.curve.at(-1)!];
    const [dx, dy] = [end[0] - start[0], end[1] - start[1]];
    const backwards = Math.abs(Math.atan2(dy, Math.abs(dx))) > UPRIGHT ? dy > 0 : dx < 0;
    return backwards ? { ...fit, curve: [...fit.curve].reverse() } : fit;
  }
  return null;
}
