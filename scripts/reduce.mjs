// What the scripts that fetch the world's data share: fetching a file once and keeping it, reducing lines and polygons, and
// writing what comes of it into the repo.
//
// The sources draw on a flat sheet of longitude and latitude, and the app on a sphere. Two things follow. A polygon is wound the
// way the app's cut reads it: its outer ring clockwise with north up, its holes the other way. And a long straight edge, as along
// the foot of the sheet, is given points along it, since the app takes the line between two points for a great arc.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';

// The longest edge left as it is, in degrees.
const LONGEST = 4;

/** A file from the web, fetched once and kept in `cache`: where it is on disk. */
export async function kept(url, cache, name = url.split('/').at(-1)) {
  mkdirSync(cache, { recursive: true });
  const file = new URL(name, cache);
  if (!existsSync(file)) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${name}: ${response.status}`);
    writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  }
  return file;
}

/** Douglas and Peucker's reduction of a line: the points farther than `tolerance` degrees from the line through those kept. */
export function reduce(points, tolerance) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [a, b] = stack.pop();
    const [ax, ay] = points[a];
    const [dx, dy] = [points[b][0] - ax, points[b][1] - ay];
    const length = Math.hypot(dx, dy);
    let [worst, at] = [0, -1];
    for (let i = a + 1; i < b; i++) {
      const [px, py] = [points[i][0] - ax, points[i][1] - ay];
      const d = length === 0 ? Math.hypot(px, py) : Math.abs(px * dy - py * dx) / length;
      if (d > worst) [worst, at] = [d, i];
    }
    if (worst > tolerance) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** Points along every edge longer than `LONGEST` degrees. */
export function filled(points) {
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]];
    const steps = Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])) / LONGEST);
    for (let k = 1; k < steps; k++) out.push([a[0] + ((b[0] - a[0]) * k) / steps, a[1] + ((b[1] - a[1]) * k) / steps]);
    out.push(b);
  }
  return out;
}

/** The area of a ring on the sheet, in square degrees: above zero if it runs anticlockwise with north up. */
export function sheetArea(ring) {
  let sum = 0;
  for (let i = 0; i + 1 < ring.length; i++) sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return sum / 2;
}

export const rounded = (points, places) => {
  const by = 10 ** places;
  const out = [];
  for (const [x, y] of points) {
    const p = [Math.round(x * by) / by, Math.round(y * by) / by];
    if (out.length === 0 || out.at(-1)[0] !== p[0] || out.at(-1)[1] !== p[1]) out.push(p);
  }
  return out;
};

/** A ring reduced, or null if what is left is smaller than `least` square degrees or no ring at all. */
export function ringOf(ring, tolerance, least, places, clockwise) {
  let points = rounded(filled(reduce(ring, tolerance)), places);
  if (points.length < 4) return null;
  const area = sheetArea(points);
  if (Math.abs(area) < least) return null;
  if (area < 0 !== clockwise) points = points.reverse();
  return points;
}

export const polygonsOf = (geometry) => (geometry?.type === 'Polygon' ? [geometry.coordinates] : geometry?.type === 'MultiPolygon' ? geometry.coordinates : []);
export const linesOf = (geometry) => (geometry?.type === 'LineString' ? [geometry.coordinates] : geometry?.type === 'MultiLineString' ? geometry.coordinates : []);

/** The polygons of some features as one MultiPolygon, reduced and wound for the app. */
export function polygons(features, tolerance, least, places) {
  const coordinates = [];
  for (const feature of features) {
    for (const polygon of polygonsOf(feature.geometry)) {
      const outer = ringOf(polygon[0], tolerance, least, places, true);
      if (!outer) continue;
      const holes = polygon.slice(1).map((hole) => ringOf(hole, tolerance, least, places, false));
      coordinates.push([outer, ...holes.filter(Boolean)]);
    }
  }
  return { type: 'MultiPolygon', coordinates };
}

export function lines(features, tolerance, places) {
  const coordinates = [];
  for (const feature of features) {
    for (const line of linesOf(feature.geometry)) {
      const points = rounded(filled(reduce(line, tolerance)), places);
      if (points.length >= 2) coordinates.push(points);
    }
  }
  return { type: 'MultiLineString', coordinates };
}

/** Writes a value as JSON into a folder of the repo, and says how large it came out. */
export function write(out, name, value) {
  mkdirSync(out, { recursive: true });
  const file = new URL(`${name}.json`, out);
  writeFileSync(file, JSON.stringify(value));
  console.log(`${name}: ${Math.round(statSync(file).size / 1024)} kB`);
}
