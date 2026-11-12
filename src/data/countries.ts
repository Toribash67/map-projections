import { feature, mesh, neighbors } from 'topojson-client';
import countriesTopology from 'world-atlas/countries-110m.json';

/** How many colours the political map has: enough for any map with a little to spare, as a simple way of choosing them needs. */
export const POLITICAL_COLOURS = 5;

type Topology = { objects: { countries: { geometries: unknown[] } } };

/**
 * A colour for each country of a topology, as a number from 0, so that no two countries with a border between them have the same.
 * Each country in turn, those with most neighbours first, takes the colour least used so far among those its neighbours have not
 * taken: the least used, so that the colours come out evenly spread.
 */
export function colourIndex(topology: unknown): number[] {
  const geometries = (topology as Topology).objects.countries.geometries;
  const near = neighbors(geometries as any) as number[][];
  const colours = new Array<number>(geometries.length).fill(-1);
  const used = new Array<number>(POLITICAL_COLOURS).fill(0);
  const order = geometries.map((_, i) => i).sort((a, b) => near[b]!.length - near[a]!.length || a - b);
  for (const i of order) {
    // A country in several pieces can come out as a neighbour of itself, which says nothing.
    const taken = new Set(near[i]!.filter((j) => j !== i).map((j) => colours[j]!));
    let best = -1;
    for (let c = 0; c < POLITICAL_COLOURS; c++) {
      if (!taken.has(c) && (best < 0 || used[c]! < used[best]!)) best = c;
    }
    // With every colour taken round it, which five colours and this order do not come to on the Earth, it shares the least used.
    if (best < 0) best = used.indexOf(Math.min(...used));
    colours[i] = best;
    used[best]!++;
  }
  return colours;
}

/** The lines between countries, and not the coasts: each border once. */
export function bordersOf(topology: unknown): GeoJSON.MultiLineString {
  const t = topology as any;
  return mesh(t, t.objects.countries, (a: unknown, b: unknown) => a !== b) as GeoJSON.MultiLineString;
}

/** The countries of a topology by colour: for each colour, all the countries of that colour as one geometry, which is cut as one. */
export function politicalOf(topology: unknown): GeoJSON.MultiPolygon[] {
  const t = topology as any;
  const colours = colourIndex(topology);
  const layers: GeoJSON.MultiPolygon[] = Array.from({ length: POLITICAL_COLOURS }, () => ({ type: 'MultiPolygon', coordinates: [] }));
  (feature(t, t.objects.countries) as unknown as GeoJSON.FeatureCollection).features.forEach((country, i) => {
    const g = country.geometry;
    const polygons = g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : [];
    layers[colours[i]!]!.coordinates.push(...polygons);
  });
  return layers;
}

// Natural Earth countries at 1:110m. Each is one object for the whole session: cut geometry is cached by object.
export const BORDERS = bordersOf(countriesTopology);
export const POLITICAL = politicalOf(countriesTopology);
