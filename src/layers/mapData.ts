import { bordersOf, politicalOf } from '../data/countries';
import { loadDetail, type Detail } from '../data/detail';
import { COARSE, type MapData } from './layers';

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
  }
  return data;
}
