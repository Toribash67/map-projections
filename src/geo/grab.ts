import type { LonLat } from '../projections/types';

type Pair = [number, number];
const rad = Math.PI / 180;

/**
 * A pointer moves the centre by a small step at a time, so a solution farther than this (degrees) from the current centre is not
 * the land following the pointer: it is the other side of a pole, where no centre with north up keeps the land under the pointer.
 */
export const MAX_STEP = 15;

const wrap = (a: number): number => ((((a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;

/**
 * The centre (longitude, latitude) that puts `land` at `place` on the globe, as fractions of its radius with north up. With
 * d the longitude of the land east of the centre, x = cos(lat) sin(d) fixes d up to a half turn (two ways), and
 * y = cos(lat0) sin(lat) - sin(lat0) cos(lat) cos(d), a cosine of lat0 plus a shift, fixes the latitude (two ways). Of the four,
 * only those that leave the land on the visible side are centres, and the nearest to `current` is taken. Null where there is
 * none: the land cannot be at that place from any centre. Null too where the nearest is more than `MAX_STEP` away, as when a drag
 * runs over a pole: the globe then stays where it was, rather than jumping, until the pointer comes back to where the land can follow.
 * With `latFree` false only longitude is solved.
 */
export function centreFor([lon, lat]: LonLat, [x, y]: Pair, current: LonLat, latFree: boolean): LonLat | null {
  const cosLat = Math.cos(lat * rad);
  if (!(Math.abs(x) <= cosLat)) return null;
  const across = Math.asin(x / cosLat);
  if (!latFree) return [lon - across / rad, current[1]];
  const sinLat = Math.sin(lat * rad);
  const [sinNow, cosNow] = [Math.sin(current[1] * rad), Math.cos(current[1] * rad)];
  let best: LonLat | null = null;
  let bestCloseness = -Infinity;
  for (const d of [across, Math.PI - across]) {
    const [a, b] = [sinLat, cosLat * Math.cos(d)];
    const radius = Math.hypot(a, b);
    if (!(Math.abs(y) <= radius)) continue;
    const [shift, spread] = [Math.atan2(b, a), Math.acos(y / radius)];
    for (const phi of [spread - shift, -spread - shift].map(wrap)) {
      if (Math.abs(phi) > Math.PI / 2) continue;
      // The land is on the visible side of this centre if its depth is not negative.
      if (Math.sin(phi) * sinLat + Math.cos(phi) * b < -1e-9) continue;
      const lon0 = lon - d / rad;
      // The cosine of the angle between this centre and the current one: the larger, the nearer.
      const closeness = Math.sin(phi) * sinNow + Math.cos(phi) * cosNow * Math.cos((lon0 - current[0]) * rad);
      if (closeness > bestCloseness) [best, bestCloseness] = [[lon0, phi / rad], closeness];
    }
  }
  return bestCloseness >= Math.cos(MAX_STEP * rad) ? best : null;
}
