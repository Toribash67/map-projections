// Fetches what the app draws that Natural Earth does not have, reduces it, and writes it to src/data/world. Run with
// `npm run world-data` to make the files again, or to reduce them another way. They are kept in the repo, so the app never asks
// anyone for anything. What Natural Earth does have is fetched by scripts/natural-earth.mjs.
//
// - The height of the land, from NOAA's ETOPO5: the Earth's surface every five minutes of arc. Public domain.
// - Biomes, from RESOLVE's Ecoregions 2017 (Dinerstein et al.). CC BY 4.0: a picture that shows them says so.
// - Climates, from Beck et al. 2018, "Present and future Köppen-Geiger climate classification maps at 1-km resolution". CC BY 4.0.
// - The boundaries of the tectonic plates, from Peter Bird's PB2002 as Hugo Ahlenius (Nordpil) published it. ODC Attribution.
// - Volcanoes, from NOAA's National Centers for Environmental Information, and earthquakes of magnitude 7 and more since 1900, from
//   the United States Geological Survey. Both public domain.
//
// Height, biomes and climates are not drawings where they come from but grids, or are turned into one here: a value for each cell
// of a sheet of longitude and latitude. Each is traced into polygons, the line running where the value crosses from one side to the
// other. They need not keep to the coast, as the app draws them within the land it has.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { contours } from 'd3-contour';
import { fromFile } from 'geotiff';
import { open } from 'shapefile';
import { kept, lines, polygons, write as writeTo } from './reduce.mjs';

const CACHE = new URL('../node_modules/.cache/world-data/', import.meta.url);
const OUT = new URL('../src/data/world/', import.meta.url);
const write = (name, value) => writeTo(OUT, name, value);

/** A file out of an archive that has been fetched, unpacked into a folder beside it: where it is on disk. */
function unpacked(archive, folder, name) {
  const to = new URL(`${folder}/`, CACHE);
  if (!existsSync(new URL(name, to))) execFileSync('unzip', ['-o', '-q', fileURLToPath(archive), name, '-d', fileURLToPath(to)]);
  return fileURLToPath(new URL(name, to));
}

/**
 * The parts of a grid where its values are `level` or more, as polygons on the sheet. The grid is `width` by `height` cells from the
 * north-west corner of the sheet, and `first` is where its first value is: at the corner of its cell (0) or in the middle of it (0.5).
 */
function traced(values, width, height, level, first, tolerance, least) {
  const [shape] = contours().size([width, height]).thresholds([level])(values);
  // The tracing puts a value in the middle of its cell, and closes a shape along the edge of the grid, which is the edge of the sheet.
  const lon = (x) => (x <= 0 ? -180 : x >= width ? 180 : Math.max(-180, Math.min(180, -180 + ((x - 0.5 + first) * 360) / width)));
  const lat = (y) => (y <= 0 ? 90 : y >= height ? -90 : Math.max(-90, Math.min(90, 90 - ((y - 0.5 + first) * 180) / height)));
  const onSheet = shape.coordinates.map((polygon) => polygon.map((ring) => ring.map(([x, y]) => [lon(x), lat(y)])));
  return polygons([{ geometry: { type: 'MultiPolygon', coordinates: onSheet } }], tolerance, least, 3);
}

/** A grid of classes as a grid for each class of how much of a cell and its neighbours is of that class, from 0 to 1: its edge is then rounded when traced at a half. */
function shareOf(classes, width, height, wanted) {
  let share = Float32Array.from(classes, (c) => (wanted(c) ? 1 : 0));
  // Twice the mean of a cell and its neighbours along a row, then down a column. The sheet goes round from its east edge to its west.
  for (let pass = 0; pass < 2; pass++) {
    const along = new Float32Array(share.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) along[y * width + x] = (share[y * width + ((x + width - 1) % width)] + share[y * width + x] + share[y * width + ((x + 1) % width)]) / 3;
    }
    share = new Float32Array(share.length);
    for (let y = 0; y < height; y++) {
      const [up, down] = [Math.max(0, y - 1), Math.min(height - 1, y + 1)];
      for (let x = 0; x < width; x++) share[y * width + x] = (along[up * width + x] + along[y * width + x] + along[down * width + x]) / 3;
    }
  }
  return share;
}

/**
 * Spreads the classes of a grid into the cells beside them that have none, `cells` cells far. The classes stop at the coast of
 * whoever made the grid, which is not the app's coast; spread a little way out to sea they reach the app's coast wherever it is, and
 * the app draws no more of them than is on its land.
 */
function spread(classes, width, height, cells) {
  let now = classes;
  for (let step = 0; step < cells; step++) {
    const next = Uint8Array.from(now);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (now[y * width + x] !== 0) continue;
        const beside = [now[y * width + ((x + 1) % width)], now[y * width + ((x + width - 1) % width)], y > 0 ? now[(y - 1) * width + x] : 0, y < height - 1 ? now[(y + 1) * width + x] : 0];
        next[y * width + x] = beside.find((c) => c !== 0) ?? 0;
      }
    }
    now = next;
  }
  return now;
}

/** Each class of a grid of classes as polygons: `groups` says which of the grid's classes each is made of. */
function tracedClasses(classes, width, height, groups, tolerance, least) {
  const wide = spread(classes, width, height, 5);
  return groups.map((members) => traced(shareOf(wide, width, height, (c) => members.includes(c)), width, height, 0.5, 0.5, tolerance, least));
}

// The height of the land: all that is higher than each of these, in metres. ETOPO5 is 4320 by 2160 whole numbers of metres, two
// bytes each with the high byte first, from the pole southward and from Greenwich eastward, each at the corner of its cell.
{
  const HEIGHTS = [200, 500, 1000, 2000, 3000, 4500];
  const [width, height] = [4320, 2160];
  const raw = readFileSync(await kept('https://www.ngdc.noaa.gov/mgg/global/relief/ETOPO5/TOPO/ETOPO5/ETOPO5.DAT', CACHE));
  const metres = new Float32Array(width * height);
  // From the date line eastward, as the sheet is.
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) metres[y * width + ((x + width / 2) % width)] = raw.readInt16BE(2 * (y * width + x));
  // Reduced twice, as the depths of the sea are: coarsely for a picture from the map's own coast, and less so for a finer one.
  for (const [name, tolerance, least] of [['coarse', 0.2, 1], ['fine', 0.05, 0.03]]) {
    write(`height-${name}`, HEIGHTS.map((level) => traced(metres, width, height, level, 0, tolerance, least)));
  }
}

// Climates: Köppen and Geiger's classes, of which Beck's grid has thirty, five minutes of arc to a cell. They are drawn as their
// thirteen kinds, which leaves out how hot the summer is: a legend of thirty would fill the picture.
{
  const CLIMATES = [
    ['Af', 'Tropical rainforest', [1]],
    ['Am', 'Tropical monsoon', [2]],
    ['Aw', 'Tropical savanna', [3]],
    ['BW', 'Desert', [4, 5]],
    ['BS', 'Steppe', [6, 7]],
    ['Cs', 'Temperate, dry summer', [8, 9, 10]],
    ['Cw', 'Temperate, dry winter', [11, 12, 13]],
    ['Cf', 'Temperate, no dry season', [14, 15, 16]],
    ['Ds', 'Continental, dry summer', [17, 18, 19, 20]],
    ['Dw', 'Continental, dry winter', [21, 22, 23, 24]],
    ['Df', 'Continental, no dry season', [25, 26, 27, 28]],
    ['ET', 'Tundra', [29]],
    ['EF', 'Ice cap', [30]],
  ];
  const archive = await kept('https://ndownloader.figshare.com/files/12407516', CACHE, 'Beck_KG_V1.zip');
  const image = await (await fromFile(unpacked(archive, 'kg', 'Beck_KG_V1_present_0p083.tif'))).getImage();
  const [classes] = await image.readRasters();
  const shapes = tracedClasses(Uint8Array.from(classes), image.getWidth(), image.getHeight(), CLIMATES.map(([, , members]) => members), 0.04, 0.02);
  write('climate', CLIMATES.map(([code, name], i) => ({ code, name, geometry: shapes[i] })));
}

// Biomes: the fourteen of the ecoregions' map, which is a drawing of eight hundred regions far finer than the app can use. It is
// painted onto a grid, a twentieth of a degree to a cell, by the biome of each region, and the grid is traced like the others.
{
  const [width, height] = [7200, 3600];
  const archive = await kept('https://storage.googleapis.com/teow2016/Ecoregions2017.zip', CACHE);
  const [shp, dbf] = ['Ecoregions2017.shp', 'Ecoregions2017.dbf'].map((name) => unpacked(archive, 'eco', name));
  const classes = new Uint8Array(width * height);
  const names = [];
  const source = await open(shp, dbf);
  for (let record = await source.read(); !record.done; record = await source.read()) {
    const { properties, geometry } = record.value;
    // Rock and ice are no biome: the land is left its own colour there.
    if (properties.BIOME_NAME === 'N/A') continue;
    names[properties.BIOME_NUM] = properties.BIOME_NAME;
    const rings = (geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates).flat();
    // Where each row of cells, through the cells' middles, crosses the region's edge: between one crossing and the next it is inside.
    const crossings = new Map();
    for (const ring of rings) {
      for (let i = 0; i + 1 < ring.length; i++) {
        const [[ax, ay], [bx, by]] = [ring[i], ring[i + 1]].map(([lon, lat]) => [((lon + 180) / 360) * width, ((90 - lat) / 180) * height]);
        if (ay === by) continue;
        const [top, bottom] = [Math.min(ay, by), Math.max(ay, by)];
        for (let row = Math.max(0, Math.ceil(top - 0.5)); row <= Math.min(height - 1, Math.ceil(bottom - 0.5) - 1); row++) {
          const x = ax + ((row + 0.5 - ay) * (bx - ax)) / (by - ay);
          if (!crossings.has(row)) crossings.set(row, []);
          crossings.get(row).push(x);
        }
      }
    }
    for (const [row, xs] of crossings) {
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        for (let x = Math.max(0, Math.ceil(xs[k] - 0.5)); x <= Math.min(width - 1, Math.ceil(xs[k + 1] - 0.5) - 1); x++) classes[row * width + x] = properties.BIOME_NUM;
      }
    }
  }
  const numbers = names.map((_, number) => number).filter((number) => names[number]);
  const shapes = tracedClasses(classes, width, height, numbers.map((number) => [number]), 0.03, 0.01);
  write('biomes', numbers.map((number, i) => ({ name: names[number], geometry: shapes[i] })));
}

// The boundaries of the tectonic plates.
write('plates', lines(JSON.parse(readFileSync(await kept('https://raw.githubusercontent.com/fraxen/tectonicplates/master/GeoJSON/PB2002_boundaries.json', CACHE), 'utf8')).features, 0.02, 3));

const place = (lon, lat) => [Math.round(lon * 100) / 100, Math.round(lat * 100) / 100];

// Volcanoes that have erupted in the last ten thousand years or so: where each is.
{
  const found = [];
  for (let page = 1, pages = 1; page <= pages; page++) {
    const file = await kept(`https://www.ngdc.noaa.gov/hazel/hazard-service/api/v1/volcanolocs?itemsPerPage=200&page=${page}`, CACHE, `volcanoes-${page}.json`);
    const { items, totalPages } = JSON.parse(readFileSync(file, 'utf8'));
    pages = totalPages;
    found.push(...items);
  }
  const volcanoes = found.filter((v) => Number.isFinite(v.latitude) && Number.isFinite(v.longitude)).sort((a, b) => a.id - b.id);
  write('volcanoes', volcanoes.map((v) => place(v.longitude, v.latitude)));
}

// Earthquakes of magnitude 7 and more from 1900 to the end of 2025, the greatest first: where each was, and its magnitude.
{
  const file = await kept('https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=1900-01-01&endtime=2026-01-01&minmagnitude=7&eventtype=earthquake', CACHE, 'earthquakes.json');
  const quakes = JSON.parse(readFileSync(file, 'utf8')).features.sort((a, b) => b.properties.mag - a.properties.mag || a.properties.time - b.properties.time);
  write('quakes', quakes.map((q) => [...place(q.geometry.coordinates[0], q.geometry.coordinates[1]), Math.round(q.properties.mag * 10) / 10]));
}
