// Fetches the rivers, lakes, sea areas and sea depths of Natural Earth, reduces them, and writes them to src/data/ne. Run with
// `npm run natural-earth` when Natural Earth changes, or to reduce them another way. The files it writes are kept in the repo, so
// the app never asks Natural Earth for anything.
//
// Natural Earth draws on a flat sheet of longitude and latitude, and the app on a sphere. Two things follow. A polygon is wound the
// way the app's cut reads it: its outer ring clockwise with north up, its holes the other way. And a long straight edge, as along
// the foot of the sheet, is given points along it, since the app takes the line between two points for a great arc.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';

const SOURCE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson';
const CACHE = new URL('../node_modules/.cache/natural-earth/', import.meta.url);
const OUT = new URL('../src/data/ne/', import.meta.url);
// The longest edge left as it is, in degrees.
const LONGEST = 4;

async function fetched(name) {
  mkdirSync(CACHE, { recursive: true });
  const file = new URL(`${name}.geojson`, CACHE);
  if (!existsSync(file)) {
    const response = await fetch(`${SOURCE}/${name}.geojson`);
    if (!response.ok) throw new Error(`${name}: ${response.status}`);
    writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  }
  return JSON.parse(readFileSync(file, 'utf8')).features;
}

/** Douglas and Peucker's reduction of a line: the points farther than `tolerance` degrees from the line through those kept. */
function reduce(points, tolerance) {
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
function filled(points) {
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
function sheetArea(ring) {
  let sum = 0;
  for (let i = 0; i + 1 < ring.length; i++) sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return sum / 2;
}

const rounded = (points, places) => {
  const by = 10 ** places;
  const out = [];
  for (const [x, y] of points) {
    const p = [Math.round(x * by) / by, Math.round(y * by) / by];
    if (out.length === 0 || out.at(-1)[0] !== p[0] || out.at(-1)[1] !== p[1]) out.push(p);
  }
  return out;
};

/** A ring reduced, or null if what is left is smaller than `least` square degrees or no ring at all. */
function ringOf(ring, tolerance, least, places, clockwise) {
  let points = rounded(filled(reduce(ring, tolerance)), places);
  if (points.length < 4) return null;
  const area = sheetArea(points);
  if (Math.abs(area) < least) return null;
  if (area < 0 !== clockwise) points = points.reverse();
  return points;
}

const polygonsOf = (geometry) => (geometry?.type === 'Polygon' ? [geometry.coordinates] : geometry?.type === 'MultiPolygon' ? geometry.coordinates : []);
const linesOf = (geometry) => (geometry?.type === 'LineString' ? [geometry.coordinates] : geometry?.type === 'MultiLineString' ? geometry.coordinates : []);

/** The polygons of some features as one MultiPolygon, reduced and wound for the app. */
function polygons(features, tolerance, least, places) {
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

function lines(features, tolerance, places) {
  const coordinates = [];
  for (const feature of features) {
    for (const line of linesOf(feature.geometry)) {
      const points = rounded(filled(reduce(line, tolerance)), places);
      if (points.length >= 2) coordinates.push(points);
    }
  }
  return { type: 'MultiLineString', coordinates };
}

function write(name, value) {
  mkdirSync(OUT, { recursive: true });
  const file = new URL(`${name}.json`, OUT);
  writeFileSync(file, JSON.stringify(value));
  console.log(`${name}: ${Math.round(statSync(file).size / 1024)} kB`);
}

// Rivers and lakes, at the three scales of the coast.
const SCALES = [
  ['110m', 0.02, 3],
  ['50m', 0.01, 3],
  ['10m', 0.01, 3],
];
for (const [scale, tolerance, places] of SCALES) {
  // The rivers of the finest scale are many more points than its lakes, and bear more reducing.
  write(`rivers-${scale}`, lines(await fetched(`ne_${scale}_rivers_lake_centerlines`), scale === '10m' ? 1.6 * tolerance : tolerance, places));
  write(`lakes-${scale}`, polygons(await fetched(`ne_${scale}_lakes`), tolerance, tolerance * tolerance, places));
}

// The sea by depth: all that is deeper than each of these, in metres. Natural Earth has it at one scale, far finer than a screen
// can show, so it is reduced twice: coarsely for the map as it moves, and less so for a close look and for print.
const DEPTHS = [
  [200, 'K'],
  [2000, 'I'],
  [4000, 'G'],
  [6000, 'E'],
];
for (const [name, tolerance, least] of [['coarse', 0.35, 2], ['fine', 0.06, 0.05]]) {
  const steps = [];
  for (const [depth, letter] of DEPTHS) steps.push(polygons(await fetched(`ne_10m_bathymetry_${letter}_${depth}`), tolerance, least, 3));
  write(`depth-${name}`, steps);
}

// The oceans and seas, for their names: the most important first.
const seas = (await fetched('ne_50m_geography_marine_polys'))
  .filter((f) => f.properties.name)
  .map((f) => ({ name: f.properties.name, rank: f.properties.scalerank, ocean: f.properties.featurecla === 'ocean', geometry: polygons([f], 0.1, 0.02, 2) }))
  .filter((sea) => sea.geometry.coordinates.length > 0)
  .sort((a, b) => Number(b.ocean) - Number(a.ocean) || a.rank - b.rank || (a.name < b.name ? -1 : 1));
write('seas', seas);
