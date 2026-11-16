// Fetches what the app draws of Natural Earth beyond the coast and the countries (rivers, lakes, the depths and names of the sea, ice,
// time zones, the borders within countries, cities, the regions of the land and its peaks), reduces them, and writes them to src/data/ne. Run with
// `npm run natural-earth` when Natural Earth changes, or to reduce them another way. The files it writes are kept in the repo, so
// the app never asks Natural Earth for anything.
// What it shares with scripts/world-data.mjs, which fetches what Natural Earth does not have, is in scripts/reduce.mjs.
import { readFileSync } from 'node:fs';
import { merge, mesh } from 'topojson-client';
import { topology } from 'topojson-server';
import { presimplify, simplify } from 'topojson-simplify';
import { kept, lines, polygons, write as writeTo } from './reduce.mjs';

const SOURCE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson';
const CACHE = new URL('../node_modules/.cache/natural-earth/', import.meta.url);
const OUT = new URL('../src/data/ne/', import.meta.url);

const fetched = async (name) => JSON.parse(readFileSync(await kept(`${SOURCE}/${name}.geojson`, CACHE), 'utf8')).features;
const write = (name, value) => writeTo(OUT, name, value);

// How heavy Natural Earth draws a stretch of river, from 0.15 for a headwater to 2 for the foot of the Amazon, as the classes the
// app draws: all that is no heavier than each of these, and the rest. A river with no weight given is a middling one.
const RIVER_CLASSES = [0.2, 0.3, 0.6];
const UNWEIGHED = 0.5;

/** Rivers by how heavy they are drawn, the lightest first: a river comes in stretches, each heavier than the one upstream of it. */
function rivers(features, tolerance, places) {
  const classes = [...RIVER_CLASSES, Infinity].map(() => []);
  for (const feature of features) classes[RIVER_CLASSES.filter((most) => (feature.properties.strokeweig ?? UNWEIGHED) > most).length].push(feature);
  return classes.map((stretches) => lines(stretches, tolerance, places));
}

// Rivers and lakes, at the three scales of the coast. At the two finer scales Natural Earth has the rivers in stretches with a weight
// each, so that they grow from source to mouth; at the coarsest there are only the great rivers, whole.
const SCALES = [
  ['110m', 0.02, 3, 'ne_110m_rivers_lake_centerlines'],
  ['50m', 0.01, 3, 'ne_50m_rivers_lake_centerlines_scale_rank'],
  ['10m', 0.01, 3, 'ne_10m_rivers_lake_centerlines_scale_rank'],
];
for (const [scale, tolerance, places, riverFile] of SCALES) {
  // The rivers of the finest scale are many more points than its lakes, and bear more reducing.
  write(`rivers-${scale}`, rivers(await fetched(riverFile), scale === '10m' ? 1.6 * tolerance : tolerance, places));
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

// Ice: the glaciers and ice caps, and at the finer scales the shelves of ice that lie on the sea round Antarctica.
for (const [scale, tolerance, places] of SCALES) {
  const shelves = scale === '110m' ? [] : await fetched(`ne_${scale}_antarctic_ice_shelves_polys`);
  // The glaciers of the finest scale are many small ones, and bear more reducing.
  const fine = scale === '10m' ? 1.6 * tolerance : tolerance;
  write(`ice-${scale}`, polygons([...(await fetched(`ne_${scale}_glaciated_areas`)), ...shelves], fine, fine * fine, places));
}

// The borders within countries, of states and provinces. At the coarsest scale Natural Earth has those of the United States alone,
// and at the middle one those of the largest countries.
for (const [scale, tolerance] of [['110m', 0.02], ['50m', 0.01], ['10m', 0.045]]) {
  write(`provinces-${scale}`, lines(await fetched(`ne_${scale}_admin_1_states_provinces_lines`), tolerance, 3));
}

// The date line.
write('dateline', lines((await fetched('ne_10m_geographic_lines')).filter((f) => f.properties.name === 'International Date Line'), 0.01, 3));

// The time zones. Two zones share their border, which is reduced once for them both, through a topology: reduced each alone, the
// two would part and overlap along it. The zones an hour apart are tinted turn and turn about, so those of the odd hours are
// one shape, and those not a whole number of hours from Greenwich another; the borders are the lines between two different zones.
{
  const zones = (await fetched('ne_10m_time_zones')).map((f) => ({ type: 'Feature', properties: { zone: f.properties.zone }, geometry: f.geometry }));
  const whole = simplify(presimplify(topology({ zones: { type: 'FeatureCollection', features: zones } }, 1e5)), 0.0006);
  const { geometries } = whole.objects.zones;
  const tint = (pick) => polygons([{ geometry: merge(whole, geometries.filter((g) => pick(g.properties.zone))) }], 0, 0.002, 3);
  const borders = mesh(whole, whole.objects.zones, (a, b) => a !== b && a.properties.zone !== b.properties.zone);
  write('zones', {
    odd: tint((zone) => Number.isInteger(zone) && Math.abs(zone) % 2 === 1),
    part: tint((zone) => !Number.isInteger(zone)),
    lines: lines([{ geometry: borders }], 0, 3),
  });
}

// Cities, the most important first: the capitals of countries, and the towns Natural Earth ranks as worth a place on a map of the
// world or of a continent. Each is its name, where it is, its rank (0 the most important) and whether it is a country's capital.
{
  const places = (await fetched('ne_10m_populated_places_simple'))
    .map((f) => f.properties)
    .filter((p) => p.name && !/station/i.test(p.featurecla) && (p.adm0cap === 1 || p.scalerank <= 7))
    .sort((a, b) => a.scalerank - b.scalerank || b.adm0cap - a.adm0cap || b.pop_max - a.pop_max || (a.name < b.name ? -1 : 1));
  write('cities', places.map((p) => [p.name, Math.round(p.longitude * 1000) / 1000, Math.round(p.latitude * 1000) / 1000, p.scalerank, p.adm0cap === 1 ? 1 : 0]));
}

// The regions of the land that have a name and no border: mountain ranges, deserts, and plateaus, basins and plains. For their
// names, as the seas are, so the most important first.
{
  const KINDS = { 'Range/mtn': 'range', Desert: 'desert', Plateau: 'upland', Basin: 'upland', Plain: 'upland', Lowland: 'upland', Tundra: 'upland' };
  const regions = (await fetched('ne_10m_geography_regions_polys'))
    .filter((f) => KINDS[f.properties.FEATURECLA] && f.properties.NAME)
    .map((f) => ({ name: f.properties.NAME, rank: f.properties.SCALERANK, kind: KINDS[f.properties.FEATURECLA], geometry: polygons([f], 0.1, 0.02, 2) }))
    .filter((region) => region.geometry.coordinates.length > 0)
    .sort((a, b) => a.rank - b.rank || (a.name < b.name ? -1 : 1));
  write('regions', regions);
}

// Peaks: each its name, where it is, how high in metres, and its rank.
{
  const peaks = (await fetched('ne_10m_geography_regions_elevation_points'))
    .map((f) => f.properties)
    .filter((p) => p.featurecla === 'mountain' && p.name && p.elevation > 0)
    .sort((a, b) => a.scalerank - b.scalerank || b.elevation - a.elevation);
  write('peaks', peaks.map((p) => [p.name, Math.round(p.long_x * 1000) / 1000, Math.round(p.lat_y * 1000) / 1000, Math.round(p.elevation), p.scalerank]));
}
