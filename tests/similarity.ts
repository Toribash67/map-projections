export type Pair = readonly [number, number];

/**
 * How well `a` becomes `b` by turning, scaling and moving it (a similarity), point for point.
 * `error` is the worst distance left over as a fraction of the extent of `b`, `scale` the factor
 * that takes the size of `a` to that of `b`.
 */
export function similarity(a: Pair[], b: Pair[]): { error: number; scale: number } {
  const mean = (pts: Pair[]) => [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length] as const;
  const [ma, mb] = [mean(a), mean(b)];
  // The best similarity as a complex multiplier c: (x, y) -> c * (x, y).
  let [re, im, norm] = [0, 0, 0];
  a.forEach((p, i) => {
    const [x, y, u, v] = [p[0] - ma[0], p[1] - ma[1], b[i]![0] - mb[0], b[i]![1] - mb[1]];
    re += x * u + y * v;
    im += x * v - y * u;
    norm += x * x + y * y;
  });
  const [cr, ci] = [re / norm, im / norm];
  let worst = 0;
  a.forEach((p, i) => {
    const [x, y] = [p[0] - ma[0], p[1] - ma[1]];
    worst = Math.max(worst, Math.hypot(cr * x - ci * y - (b[i]![0] - mb[0]), ci * x + cr * y - (b[i]![1] - mb[1])));
  });
  const [xs, ys] = [b.map((p) => p[0]), b.map((p) => p[1])];
  const extent = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  return { error: worst / extent, scale: Math.hypot(cr, ci) };
}
