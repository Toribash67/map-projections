import { bordersOf, politicalOf } from '../data/countries';
import { loadDetail, type Detail } from '../data/detail';
import { loadWater, waterNow } from '../data/water';
import { loadWorld, worldNow, type LandClass, type WorldKind } from '../data/world';
import { COARSE, type LayerState, type MapData } from './layers';

const loaded = new Map<Detail, Promise<MapData>>();

/**
 * The land, coast and countries a map is drawn from, at a level of detail: the coarse ones the app starts with, or finer ones that
 * are fetched. Each level gives the same objects every time. The countries of a finer level are worked out only when a layer of
 * them is first asked for, as that takes a while.
 */
export function loadMapData(level: Detail): Promise<MapData> {
  if (level === '110m') return Promise.resolve(COARSE);
  let data = loaded.get(level);
  if (!data) {
    data = loadDetail(level).then(({ land, coast, topology }) => {
      let countries: Pick<MapData, 'borders' | 'political'> | null = null;
      const fromTopology = () => (countries ??= { borders: bordersOf(topology), political: politicalOf(topology) });
      return {
        land,
        coast,
        get borders() {
          return fromTopology().borders;
        },
        get political() {
          return fromTopology().political;
        },
      };
    });
    loaded.set(level, data);
    // A fetch that failed is not kept: the next asking tries again.
    data.catch(() => loaded.delete(level));
  }
  return data;
}

const WATER = ['rivers', 'lakes', 'depth'] as const;
const watered = new WeakMap<MapData, { has: string; data: MapData }>();

/**
 * Map data with what has been fetched of the rivers, lakes and depths of its level. The same object every time until more of them
 * arrive, and the data it was given where none has. What it was given is behind it and not copied, so the countries of a finer
 * level are still worked out only when asked for.
 */
export function withWater(data: MapData, level: Detail): MapData {
  const [rivers, lakes, depth] = [waterNow('rivers', level), waterNow('lakes', level), waterNow('depth', level)];
  const has = `${rivers ? 'r' : ''}${lakes ? 'l' : ''}${depth ? 'd' : ''}`;
  if (has === '') return data;
  const kept = watered.get(data);
  if (kept?.has === has) return kept.data;
  const more: MapData = Object.create(data);
  if (rivers) more.rivers = rivers;
  if (lakes) more.lakes = lakes;
  if (depth) more.depth = depth;
  watered.set(data, { has, data: more });
  return more;
}

/** Fetches the rivers, lakes and depths that the layers that are on need and that are not here yet. Null where there is nothing to wait for. */
export function loadWaterFor(on: LayerState['on'], level: Detail): Promise<void> | null {
  const missing = WATER.filter((kind) => on[kind] && !waterNow(kind, level));
  return missing.length === 0 ? null : Promise.all(missing.map((kind) => loadWater(kind, level))).then(() => {});
}

/** What of the world's data each layer of a picture is drawn or lettered from. */
const NEEDS: [keyof LayerState['on'], WorldKind][] = [
  ['ice', 'ice'],
  ['zones', 'zones'],
  ['dateLine', 'dateline'],
  ['plates', 'plates'],
  ['provinces', 'provinces'],
  ['capitals', 'cities'],
  ['cities', 'cities'],
  ['regionNames', 'regions'],
  ['peaks', 'peaks'],
  ['volcanoes', 'volcanoes'],
  ['quakes', 'quakes'],
];

/** The kinds of the world's data that a picture with these layers needs. */
export function worldNeeds(layers: LayerState): WorldKind[] {
  const kinds = new Set<WorldKind>(NEEDS.filter(([id]) => layers.on[id]).map(([, kind]) => kind));
  if (layers.cover !== 'none') kinds.add(layers.cover);
  return [...kinds];
}

/** Fetches everything a picture with these layers is drawn from, at a level of detail, that is not here yet: the water and the rest. */
export function loadPictureData(layers: LayerState, level: Detail): Promise<void> {
  const missing = worldNeeds(layers).filter((kind) => !worldNow(kind, level));
  return Promise.all([loadWaterFor(layers.on, level), ...missing.map((kind) => loadWorld(kind, level))]).then(() => {});
}

const shapes = new WeakMap<LandClass[], GeoJSON.MultiPolygon[]>();
/** The land of each class, the same list every time for the same classes. */
function shapesOf(classes: LandClass[]): GeoJSON.MultiPolygon[] {
  let list = shapes.get(classes);
  if (!list) shapes.set(classes, (list = classes.map((one) => one.geometry)));
  return list;
}

const pictured = new WeakMap<MapData, { has: string; data: MapData }>();

/**
 * Map data with everything that has been fetched for a picture at its level: the water, and the heights, biomes, climates, ice,
 * time zones, date line, plates and borders within countries. The same object every time until more arrives.
 */
export function withPictureData(data: MapData, level: Detail): MapData {
  const watered = withWater(data, level);
  const [height, biomes, climate, ice] = [worldNow('height', level), worldNow('biomes', level), worldNow('climate', level), worldNow('ice', level)];
  const [zones, dateline, plates, provinces] = [worldNow('zones', level), worldNow('dateline', level), worldNow('plates', level), worldNow('provinces', level)];
  const has = [height, biomes, climate, ice, zones, dateline, plates, provinces].map((one) => (one ? '1' : '0')).join('');
  if (!has.includes('1')) return watered;
  const kept = pictured.get(watered);
  if (kept?.has === has) return kept.data;
  const more: MapData = Object.create(watered);
  if (height) more.height = height;
  if (biomes) more.biomes = shapesOf(biomes);
  if (climate) more.climate = shapesOf(climate);
  if (ice) more.ice = ice;
  if (zones) more.zones = zones;
  if (dateline) more.dateline = dateline;
  if (plates) more.plates = plates;
  if (provinces) more.provinces = provinces;
  pictured.set(watered, { has, data: more });
  return more;
}
