import type { Detail } from './detail';

/** A region of the land with a name and no border, for its name: a mountain range, a desert, or an upland or plain. */
export type Region = { name: string; rank: number; kind: 'range' | 'desert' | 'upland'; geometry: GeoJSON.MultiPolygon };
/** A class of land, as a biome or a climate is, with the land that is of it. */
export type LandClass = { name: string; code?: string; geometry: GeoJSON.MultiPolygon };
/** A city: its name, longitude, latitude, rank (0 the most important) and whether it is a country's capital (1) or not (0). */
export type City = [name: string, lon: number, lat: number, rank: number, capital: 0 | 1];
/** A peak: its name, longitude, latitude, height in metres and rank. */
export type Peak = [name: string, lon: number, lat: number, metres: number, rank: number];

/**
 * What a picture can show besides the coast, the countries and the water: of the land, how high it is, its biomes, its climates and
 * its ice; of the Earth under it, the plates, the volcanoes and the earthquakes; and of people, the time zones, the date line, the
 * borders within countries, and cities. With the regions and peaks that are named.
 */
export interface World {
  /** All that is higher than each of `HEIGHTS`, the lowest first: each lies within the one before it. */
  height: GeoJSON.MultiPolygon[];
  biomes: LandClass[];
  climate: LandClass[];
  ice: GeoJSON.MultiPolygon;
  /** The time zones: those an odd number of hours from Greenwich, those not a whole number, and the borders between zones. */
  zones: { odd: GeoJSON.MultiPolygon; part: GeoJSON.MultiPolygon; lines: GeoJSON.MultiLineString };
  dateline: GeoJSON.MultiLineString;
  plates: GeoJSON.MultiLineString;
  provinces: GeoJSON.MultiLineString;
  /** The most important first. */
  cities: City[];
  regions: Region[];
  peaks: Peak[];
  /** Where each volcano is. */
  volcanoes: [lon: number, lat: number][];
  /** Earthquakes of magnitude 7 and more since 1900, the greatest first: where each was, and its magnitude. */
  quakes: [lon: number, lat: number, magnitude: number][];
}
export type WorldKind = keyof World;

/** The heights the land is shaded by, in metres. */
export const HEIGHTS = [200, 500, 1000, 2000, 3000, 4500] as const;

// Reduced by scripts/natural-earth.mjs (src/data/ne) and scripts/world-data.mjs (src/data/world), which say where each is from.
// Each file is a chunk of its own, fetched when first asked for and never at start-up. The ice and the borders within countries
// are at the three scales of the coast; the heights are coarse for a picture from the map's own coast and fine for a finer one; the
// rest are the same at every scale.
const files: Record<string, () => Promise<{ default: unknown }>> = {
  'height-coarse': () => import('./world/height-coarse.json'),
  'height-fine': () => import('./world/height-fine.json'),
  biomes: () => import('./world/biomes.json'),
  climate: () => import('./world/climate.json'),
  'ice-110m': () => import('./ne/ice-110m.json'),
  'ice-50m': () => import('./ne/ice-50m.json'),
  'ice-10m': () => import('./ne/ice-10m.json'),
  zones: () => import('./ne/zones.json'),
  dateline: () => import('./ne/dateline.json'),
  plates: () => import('./world/plates.json'),
  'provinces-110m': () => import('./ne/provinces-110m.json'),
  'provinces-50m': () => import('./ne/provinces-50m.json'),
  'provinces-10m': () => import('./ne/provinces-10m.json'),
  cities: () => import('./ne/cities.json'),
  regions: () => import('./ne/regions.json'),
  peaks: () => import('./ne/peaks.json'),
  volcanoes: () => import('./world/volcanoes.json'),
  quakes: () => import('./world/quakes.json'),
};

const fileOf = (kind: WorldKind, level: Detail): string => (kind === 'ice' || kind === 'provinces' ? `${kind}-${level}` : kind === 'height' ? (level === '110m' ? 'height-coarse' : 'height-fine') : kind);

const asked = new Map<string, Promise<unknown>>();
const arrived = new Map<string, unknown>();

/** Some of it at a level of detail. Each file is fetched once, and gives the same objects every time, as the cuts keep what they prepare by object. */
export function loadWorld<K extends WorldKind>(kind: K, level: Detail): Promise<World[K]> {
  const file = fileOf(kind, level);
  let data = asked.get(file);
  if (!data) {
    data = files[file]!().then((module) => {
      arrived.set(file, module.default);
      return module.default;
    });
    asked.set(file, data);
    // A fetch that failed is not kept: the next asking tries again.
    data.catch(() => asked.delete(file));
  }
  return data as Promise<World[K]>;
}

/** What has been fetched already, or null. */
export function worldNow<K extends WorldKind>(kind: K, level: Detail): World[K] | null {
  return (arrived.get(fileOf(kind, level)) as World[K] | undefined) ?? null;
}
