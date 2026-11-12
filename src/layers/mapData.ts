import { bordersOf, politicalOf } from '../data/countries';
import { loadDetail, type Detail } from '../data/detail';
import { lakeEdgesOf, loadWater, waterNow } from '../data/water';
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
  if (lakes) [more.lakes, more.lakeEdges] = [lakes, lakeEdgesOf(lakes)];
  if (depth) more.depth = depth;
  watered.set(data, { has, data: more });
  return more;
}

/** Fetches the rivers, lakes and depths that the layers that are on need and that are not here yet. Null where there is nothing to wait for. */
export function loadWaterFor(on: LayerState['on'], level: Detail): Promise<void> | null {
  const missing = WATER.filter((kind) => on[kind] && !waterNow(kind, level));
  return missing.length === 0 ? null : Promise.all(missing.map((kind) => loadWater(kind, level))).then(() => {});
}
