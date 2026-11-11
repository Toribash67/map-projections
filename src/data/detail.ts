import { feature, mesh } from 'topojson-client';

/** How fine the coastlines and countries are: Natural Earth at 1:110m, 1:50m or 1:10m. */
export type Detail = '110m' | '50m' | '10m';

export interface DetailData {
  land: GeoJSON.GeoJsonObject;
  coast: GeoJSON.GeoJsonObject;
  countries: GeoJSON.FeatureCollection;
  /** The countries' topology, which says which of them share a border. */
  topology: unknown;
}

// The files are large, a megabyte and several, so each is its own chunk, fetched when first asked for and never at start-up.
const files: Record<Detail, () => Promise<[{ default: unknown }, { default: unknown }]>> = {
  '110m': () => Promise.all([import('world-atlas/land-110m.json'), import('world-atlas/countries-110m.json')]),
  '50m': () => Promise.all([import('world-atlas/land-50m.json'), import('world-atlas/countries-50m.json')]),
  '10m': () => Promise.all([import('world-atlas/land-10m.json'), import('world-atlas/countries-10m.json')]),
};

const loaded = new Map<Detail, Promise<DetailData>>();

/** The land, coast and countries at a level of detail. Each level is fetched once, and gives the same objects every time, as the cuts keep what they prepare by object. */
export function loadDetail(level: Detail): Promise<DetailData> {
  let data = loaded.get(level);
  if (!data) {
    data = files[level]().then(([landModule, countriesModule]) => {
      const [land, countries] = [landModule.default as any, countriesModule.default as any];
      return {
        land: feature(land, land.objects.land) as unknown as GeoJSON.GeoJsonObject,
        coast: mesh(land, land.objects.land) as GeoJSON.GeoJsonObject,
        countries: feature(countries, countries.objects.countries) as unknown as GeoJSON.FeatureCollection,
        topology: countries,
      };
    });
    loaded.set(level, data);
  }
  return data;
}
