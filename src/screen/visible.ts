import { dot, toVector, type Vector } from '../geo/densify';
import type { Cap } from '../geo/frontCut';
import type { CompiledProjection } from '../projections/types';
import { screenToLonLat, type ScreenTransform, type Viewport } from './screen';

// The window is looked through at this many places each way.
const GRID = 8;
// How far (CSS pixels) outside the window something can be and still be seen in it, as a thick line is.
const OVERSCAN = 8;
// Next to the edge of a map the Earth can go by much faster than between the places looked at: at a globe's limb, as the square
// root of the distance to it, which makes the last stretch up to 2.4 times the one before. So with an edge in view the cap is let out this many times as far.
const EDGE_SLACK = 3;

const angle = (a: Vector, b: Vector): number => Math.acos(Math.min(1, Math.max(-1, dot(a, b))));

let last: { compiled: CompiledProjection; screen: ScreenTransform; viewport: Viewport; cap: Cap | null } | null = null;

/**
 * A part of the Earth that holds everything a map shows in a window, or null where that cannot be told. The window is looked
 * through at a grid of places, and the cap is the one round them all, let out by as far as two neighbours on the grid are apart,
 * which is as far as the Earth between them can reach. A seam between two neighbours puts them far apart, and so lets the cap
 * out too, as far as the whole Earth. The same map, screen and window give the same object, as the cuts are kept by it.
 */
export function visibleCap(c: CompiledProjection, s: ScreenTransform, viewport: Viewport): Cap | null {
  if (last && last.compiled === c && last.screen === s && last.viewport === viewport) return last.cap;
  const cap = findCap(c, s, viewport);
  last = { compiled: c, screen: s, viewport, cap };
  return cap;
}

function findCap(c: CompiledProjection, s: ScreenTransform, { width, height }: Viewport): Cap | null {
  const seen: (Vector | null)[] = [];
  for (let j = 0; j <= GRID; j++) {
    for (let i = 0; i <= GRID; i++) {
      const p = screenToLonLat(c, s, [-OVERSCAN + (i * (width + 2 * OVERSCAN)) / GRID, -OVERSCAN + (j * (height + 2 * OVERSCAN)) / GRID]);
      seen.push(p && toVector(p));
    }
  }
  const found = seen.filter((v): v is Vector => v !== null);
  if (found.length < 2) return null;
  const centre: Vector = [0, 0, 0];
  for (const v of found) for (let k = 0; k < 3; k++) centre[k]! += v[k]!;
  const length = Math.hypot(...centre);
  if (length < 1e-6) return null;
  for (let k = 0; k < 3; k++) centre[k]! /= length;

  let reach = 0;
  let apart = 0;
  const side = GRID + 1;
  seen.forEach((v, n) => {
    if (!v) return;
    reach = Math.max(reach, angle(v, centre));
    const [i, j] = [n % side, Math.floor(n / side)];
    // Each pair of neighbours once: along, down, and both ways across.
    for (const [di, dj] of [[1, 0], [0, 1], [1, 1], [-1, 1]] as const) {
      const other = i + di >= 0 && i + di < side && j + dj < side ? seen[n + di + dj * side] : null;
      if (other) apart = Math.max(apart, angle(v, other));
    }
  });
  return { centre, radius: Math.min(Math.PI, reach + apart * (found.length < seen.length ? EDGE_SLACK : 1)) };
}
