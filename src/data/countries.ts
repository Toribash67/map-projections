import { feature, mesh } from 'topojson-client';
import countriesTopology from 'world-atlas/countries-110m.json';
import politicalColours from './politicalColours.json';

/** How many colours the political map has: enough for any map with a little to spare, as a simple way of choosing them needs. */
export const POLITICAL_COLOURS = 5;

type Topology = { objects: { countries: { geometries: { properties?: { name?: string } }[] } } };

// By country, as Natural Earth names it. See scripts/political-colours.mjs, which chooses them.
const COLOUR_OF: Record<string, number> = politicalColours;

/**
 * A colour for each country of a topology, as a number from 0, so that no two countries with a border between them have the same.
 * A country has the same colour at every scale of Natural Earth: the colours were chosen once for all three together, and are
 * looked up here. One that is not among them, which a newer Natural Earth could bring, takes the first colour.
 */
export function colourIndex(topology: unknown): number[] {
  return (topology as Topology).objects.countries.geometries.map((country) => COLOUR_OF[country.properties?.name ?? ''] ?? 0);
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
