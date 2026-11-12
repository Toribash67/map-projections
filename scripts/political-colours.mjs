// Works out the colour of each country on the political map and writes it to src/data/politicalColours.json. Run with
// `npm run colours` when the countries of world-atlas change.
//
// A country has one colour whatever the scale it is drawn at. So the colours are chosen once, for the countries of all three
// scales together: two countries count as neighbours if they share a border at any scale, and no two neighbours have the same.
// Each country in turn, those with most neighbours first, takes the colour least used so far among those its neighbours have not
// taken: the least used, so that the colours come out evenly spread.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { neighbors } from 'topojson-client';

const COLOURS = 5;
const require = createRequire(import.meta.url);
const near = new Map();
for (const scale of ['110m', '50m', '10m']) {
  const geometries = JSON.parse(readFileSync(require.resolve(`world-atlas/countries-${scale}.json`), 'utf8')).objects.countries.geometries;
  const names = geometries.map((g) => g.properties.name);
  if (new Set(names).size !== names.length) throw new Error(`Two countries at ${scale} have one name`);
  neighbors(geometries).forEach((list, i) => {
    const mine = near.get(names[i]) ?? near.set(names[i], new Set()).get(names[i]);
    // A country in several pieces can come out as a neighbour of itself, which says nothing.
    for (const j of list) if (j !== i) mine.add(names[j]);
  });
}

const order = [...near.keys()].sort((a, b) => near.get(b).size - near.get(a).size || (a < b ? -1 : 1));
const colours = {};
const used = new Array(COLOURS).fill(0);
for (const name of order) {
  const taken = new Set([...near.get(name)].map((other) => colours[other]));
  let best = -1;
  for (let c = 0; c < COLOURS; c++) if (!taken.has(c) && (best < 0 || used[c] < used[best])) best = c;
  if (best < 0) throw new Error(`No colour is left for ${name}`);
  colours[name] = best;
  used[best]++;
}

const sorted = Object.fromEntries(Object.keys(colours).sort().map((name) => [name, colours[name]]));
writeFileSync(new URL('../src/data/politicalColours.json', import.meta.url), `${JSON.stringify(sorted, null, 2)}\n`);
console.log(`${order.length} countries, by colour: ${used.join(', ')}`);
