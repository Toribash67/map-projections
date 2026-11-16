import { geoGraticule } from 'd3-geo';
import { BORDERS, POLITICAL } from '../data/countries';
import { COAST, LAND } from '../data/land';
import { RIVER_WEIGHTS } from '../data/water';
import { HEIGHTS } from '../data/world';
import { BIOME_COLOURS, CLIMATE_COLOURS } from '../theme/classes';
import type { CompiledProjection, LonLat } from '../projections/types';
import type { Style } from '../render/style';
import { standardLines } from './standardLines';

/** The layers of the map as it is explored: what is drawn on every frame, and morphs with the map. */
export type MapLayerId = 'land' | 'coast' | 'graticule' | 'borders' | 'political' | 'tissot' | 'standard' | 'reference' | 'drawings';
/**
 * What only a picture for export has: the finer layers of land and sea, which are too heavy to move; the layers that say something
 * of the world, its ice, time zones, plates and the borders within countries; what is marked on it, cities, peaks, volcanoes and
 * earthquakes; and what is written and drawn over a map at rest, the names, the degrees, the legend, the frame and the title box.
 */
export type PrintLayerId =
  | 'rivers' | 'lakes' | 'depth' | 'ice'
  | 'zones' | 'dateLine' | 'plates' | 'provinces'
  | 'capitals' | 'cities' | 'peaks' | 'volcanoes' | 'quakes'
  | 'countryNames' | 'seaNames' | 'regionNames' | 'degrees'
  | 'legend' | 'frame' | 'titleBox';
/**
 * What the land of a picture is coloured by, where it is not as the map has it: how high it is, its biome, or its climate. One at
 * a time, as each is a colour for all the land; and each takes the place of the political colours.
 */
export type Cover = 'none' | 'height' | 'biomes' | 'climate';
export const COVERS: readonly Cover[] = ['none', 'height', 'biomes', 'climate'];
/** Everything a picture can show or hide. */
export type LayerId = MapLayerId | PrintLayerId;
export type GraticuleStep = 10 | 15 | 30;
/** A place in the picture, of nine: top, middle or bottom, and then left, middle or right. Most are corners, which it is named for. */
export type Corner = 'tl' | 'tm' | 'tr' | 'ml' | 'mm' | 'mr' | 'bl' | 'bm' | 'br';
/** As they lie in the picture, row by row. */
export const CORNERS: readonly Corner[] = ['tl', 'tm', 'tr', 'ml', 'mm', 'mr', 'bl', 'bm', 'br'];
/** The limits of the smallest lettering a name may have, in pixels of the screen, and how long a title may be. */
export const SMALLEST_NAME = { min: 1, max: 10 } as const;
export const TITLE_LENGTH = 80;
/** The limits of how heavy the lines of a picture may be, as so many times what they are on the map. */
export const LINE_WEIGHT = { min: 0.25, max: 3 } as const;

/** Which layers the map shows, how fine its graticule is and whether it lies under the land. */
export interface MapLayers {
  on: Record<MapLayerId, boolean>;
  graticuleStep: GraticuleStep;
  graticuleUnder: boolean;
}

/** What a picture for export has over the map's own layers: which of them, what its land is coloured by, how heavy its lines are, how small a name may be, what the title box says, and where it and the legend sit. */
export interface PrintLayers {
  on: Record<PrintLayerId, boolean>;
  cover: Cover;
  /** How many times as wide every line is as on the map: the coast, the borders, the rivers, the graticule and the rest. */
  lineWeight: number;
  smallestName: number;
  title: string;
  subtitle: string;
  corner: Corner;
  legendCorner: Corner;
}

/** All the layers of a picture: the map's and those of print together. */
export interface LayerState extends Omit<MapLayers, 'on'>, Omit<PrintLayers, 'on'> {
  on: Record<LayerId, boolean>;
}

export const DEFAULT_MAP_LAYERS: MapLayers = {
  on: { land: true, coast: true, graticule: true, borders: false, political: false, tissot: false, standard: false, reference: false, drawings: true },
  graticuleStep: 10,
  graticuleUnder: false,
};

export const DEFAULT_PRINT: PrintLayers = {
  on: {
    rivers: false, lakes: false, depth: false, ice: false,
    zones: false, dateLine: false, plates: false, provinces: false,
    capitals: false, cities: false, peaks: false, volcanoes: false, quakes: false,
    countryNames: false, seaNames: false, regionNames: false, degrees: false,
    // The legend is on, and is there only when the picture has something to explain.
    legend: true, frame: false, titleBox: false,
  },
  cover: 'none',
  lineWeight: 1,
  smallestName: 4,
  title: 'The World',
  subtitle: '',
  corner: 'tr',
  legendCorner: 'bl',
};

/** The layers of a picture: the map's, with those of print. */
export const pictureLayers = (map: MapLayers, print: PrintLayers): LayerState => ({ ...map, ...print, on: { ...map.on, ...print.on } });

export const DEFAULT_LAYERS: LayerState = pictureLayers(DEFAULT_MAP_LAYERS, DEFAULT_PRINT);

/** The layers of the map itself in the order they are listed for choosing, with what each is called. */
export const LAYER_NAMES: [MapLayerId, string][] = [
  ['land', 'Land'],
  ['coast', 'Coastline'],
  ['graticule', 'Graticule'],
  ['borders', 'Country borders'],
  ['political', 'Political colours'],
  ['tissot', 'Tissot indicatrices'],
  ['standard', 'Standard lines'],
  ['reference', 'Reference circles'],
  ['drawings', 'Drawings'],
];

/** The land, coast and countries a map is drawn from: the coarse ones the app starts with, or finer ones fetched for a close look or an export. */
export interface MapData {
  land: GeoJSON.GeoJsonObject;
  coast: GeoJSON.GeoJsonObject;
  borders: GeoJSON.GeoJsonObject;
  political: GeoJSON.GeoJsonObject[];
  /** Rivers by how heavy they are drawn, lakes, and the sea by depth: each is there once it has been fetched. See `withWater`. */
  rivers?: GeoJSON.GeoJsonObject[];
  lakes?: GeoJSON.GeoJsonObject;
  depth?: GeoJSON.GeoJsonObject[];
  /** What else a picture can show, each there once it has been fetched: see `withPictureData`. */
  height?: GeoJSON.GeoJsonObject[];
  biomes?: GeoJSON.GeoJsonObject[];
  climate?: GeoJSON.GeoJsonObject[];
  ice?: GeoJSON.GeoJsonObject;
  zones?: { odd: GeoJSON.GeoJsonObject; part: GeoJSON.GeoJsonObject; lines: GeoJSON.GeoJsonObject };
  dateline?: GeoJSON.GeoJsonObject;
  plates?: GeoJSON.GeoJsonObject;
  provinces?: GeoJSON.GeoJsonObject;
}

export const COARSE: MapData = { land: LAND, coast: COAST, borders: BORDERS, political: POLITICAL };

const OCEAN = { type: 'Sphere' } as unknown as GeoJSON.GeoJsonObject;

// The latitude of the tropics, which is the tilt of the Earth's axis; the polar circles are as far from the poles.
const TROPIC = 23.44;

const parallel = (lat: number): LonLat[] => {
  const line: LonLat[] = [];
  for (let lon = -180; lon <= 180; lon += 2) line.push([lon, lat]);
  return line;
};
/** The equator, the tropics and the polar circles. */
const REFERENCE: GeoJSON.MultiLineString = { type: 'MultiLineString', coordinates: [0, TROPIC, -TROPIC, 90 - TROPIC, TROPIC - 90].map(parallel) };

const graticules = new Map<GraticuleStep, GeoJSON.GeoJsonObject>();
/** Meridians and parallels every `step` degrees, the same object each time. */
function graticule(step: GraticuleStep): GeoJSON.GeoJsonObject {
  let lines = graticules.get(step);
  if (!lines) {
    // Every meridian runs to the last parallel short of the pole, and each ninetieth on to the pole itself, as d3's own ten degree graticule has it.
    lines = geoGraticule().stepMinor([step, step]).extentMinor([[-180, -90 + step - 1e-6], [180, 90 - step + 1e-6]])() as GeoJSON.GeoJsonObject;
    graticules.set(step, lines);
  }
  return lines;
}

/** The finer layers of land and sea in the order they are listed for choosing, with what each is called. */
export const DETAIL_NAMES: [PrintLayerId, string][] = [
  ['rivers', 'Rivers'],
  ['lakes', 'Lakes'],
  ['depth', 'Sea depth'],
  ['ice', 'Ice'],
];
/** The layers that say something of the world, likewise. */
export const WORLD_NAMES: [PrintLayerId, string][] = [
  ['zones', 'Time zones'],
  ['dateLine', 'Date line'],
  ['provinces', 'States and provinces'],
  ['plates', 'Tectonic plates'],
  ['volcanoes', 'Volcanoes'],
  ['quakes', 'Earthquakes'],
];
/** What the land can be coloured by, with what each is called. */
export const COVER_NAMES: Record<Cover, string> = { none: 'As on the map', height: 'Height', biomes: 'Biomes', climate: 'Climates' };

/**
 * The geometry a scene is cut from, by layer, for the layers that are on. `maps` are the maps on screen: one at rest, and in a morph
 * the maps it comes from followed by the map it goes to. The objects are the same from call to call unless what they hold has
 * changed, as the cuts keep what they prepare by object.
 *
 * Standard lines belong to one map, so a morph has two sets: those of the maps it leaves, which thin away, and those of the map it
 * goes to, which grow. The indicatrices are not geometry and are not here: the scene makes them if `on.tissot` says so.
 *
 * The map as it is explored has only its own layers; a picture for export has the rest too. Where its land is coloured by its
 * height, its biomes or its climates, the land itself is under them whatever the map shows, and the political colours are not there.
 */
export function sceneLayers(state: MapLayers | LayerState, maps: CompiledProjection[], drawings: GeoJSON.GeoJsonObject, data: MapData = COARSE): Record<string, GeoJSON.GeoJsonObject> {
  const on: MapLayers['on'] & Partial<PrintLayers['on']> = state.on;
  const layers: Record<string, GeoJSON.GeoJsonObject> = { ocean: OCEAN };
  if (on.depth) data.depth?.forEach((deeper, i) => (layers[`depth${i}`] = deeper));
  const cover = 'cover' in state ? state.cover : 'none';
  if (cover !== 'none') {
    layers.land = data.land;
    data[cover]?.forEach((of, i) => (layers[`${cover}${i}`] = of));
  } else if (on.political) data.political.forEach((countries, i) => (layers[`political${i}`] = countries));
  else if (on.land) layers.land = data.land;
  if (on.ice && data.ice) layers.ice = data.ice;
  if (on.rivers) data.rivers?.forEach((stretches, i) => (layers[`rivers${i}`] = stretches));
  if (on.lakes && data.lakes) layers.lakes = data.lakes;
  // The same lines under another name, which is painted before the land.
  if (on.graticule) layers[state.graticuleUnder ? 'graticuleUnder' : 'graticule'] = graticule(state.graticuleStep);
  if (on.zones && data.zones) [layers.zonesOdd, layers.zonesPart, layers.zoneLines] = [data.zones.odd, data.zones.part, data.zones.lines];
  if (on.reference) layers.reference = REFERENCE;
  if (on.dateLine && data.dateline) layers.dateLine = data.dateline;
  if (on.provinces && data.provinces) layers.provinces = data.provinces;
  if (on.plates && data.plates) layers.plates = data.plates;
  if (on.borders) layers.borders = data.borders;
  if (on.coast) layers.coast = data.coast;
  if (on.standard) {
    const put = (name: string, lines: (GeoJSON.MultiLineString | null)[]) => {
      const found = lines.filter((l): l is GeoJSON.MultiLineString => l !== null);
      if (found.length === 1) layers[name] = found[0]!;
      else if (found.length > 1) layers[name] = { type: 'GeometryCollection', geometries: found } as GeoJSON.GeometryCollection;
    };
    if (maps.length === 1) put('standard', [standardLines(maps[0]!)]);
    else {
      put('standardOut', maps.slice(0, -1).map(standardLines));
      put('standardIn', [standardLines(maps.at(-1)!)]);
    }
  }
  if (on.drawings) layers.drawings = drawings;
  return layers;
}

type ColourOf = (style: Style) => string;
type WidthOf = (style: Style) => number;

/** How a layer of a scene is painted: its closed pieces filled, its lines stroked, or both. */
export interface Painted {
  layer: string;
  fill?: ColourOf;
  /**
   * Its closed pieces lie edge to edge, as the two halves of a continent do at a seam, and are one shape: they are filled as one,
   * which leaves no hairline between them and puts nothing outside their outline. See `fillWhole`.
   */
  seam?: boolean;
  /** The layers of the scene whose pieces it paints, where they are not the one layer it is named for. */
  from?: string[];
  /**
   * A fill that is drawn only within the closed pieces of another layer, as what colours the land is drawn only within the land:
   * its own edge need not keep to the coast, as it is the coast that cuts it.
   */
  within?: string;
  /** Painted only for a map that is still: not in a morph, and not while the map is dragged. It costs a frame its time, and nothing that moves is looked at so closely. */
  rest?: boolean;
  stroke?: ColourOf;
  width?: WidthOf;
  dash?: number[];
  /** A line that belongs to one end of a morph: its width goes with the morph, out to nothing or in from it. */
  taper?: 'out' | 'in';
}

const POLITICAL_LAYERS = [0, 1, 2, 3, 4].map((i) => `political${i}`);
const political = (i: number): Painted => ({ layer: `political${i}`, fill: (s) => s.political[i]!, seam: true });
const river = (i: number): Painted => ({ layer: `rivers${i}`, stroke: (s) => s.rivers, width: (s) => s.riversWidth * RIVER_WEIGHTS[i]! });
const depth = (i: number): Painted => ({ layer: `depth${i}`, fill: (s) => s.depth[i]!, seam: true });
/** A class of the land, of those that colour it: drawn within the land, whose coast is finer than its own. */
const cover = (layer: string, fill: ColourOf): Painted => ({ layer, fill, seam: true, within: 'land' });
const standard = (layer: string, taper?: Painted['taper']): Painted => ({ layer, stroke: (s) => s.standard, width: (s) => s.standardWidth, taper });

/**
 * What is painted, bottom to top. The canvas and an exported drawing both follow it. The sea comes first and has ways of its own
 * (see `drawGroup`); the indicatrices come last, after all of these.
 */
export const DRAW_ORDER: Painted[] = [
  { layer: 'ocean', fill: (s) => s.ocean, seam: true },
  // Each depth lies within the one before it, so painted in turn they are steps.
  ...[0, 1, 2, 3].map(depth),
  { layer: 'graticuleUnder', stroke: (s) => s.graticule, width: (s) => s.graticuleWidth },
  { layer: 'land', fill: (s) => s.land, seam: true },
  // Two countries of different colours meet edge to edge, and where each half covers a pixel a little of what is under them shows
  // through. So all the countries are first filled as one shape in the land's colour: what shows through is land, not sea.
  { layer: 'countries', from: POLITICAL_LAYERS, fill: (s) => s.land, seam: true, rest: true },
  ...[0, 1, 2, 3, 4].map(political),
  // What colours the land in place of them: each height lies within the one before it, and the biomes and climates lie side by side.
  ...HEIGHTS.map((_, i) => cover(`height${i}`, (s) => s.height[i]!)),
  ...BIOME_COLOURS.map((_, i) => cover(`biomes${i}`, (s) => s.biomes[i]!)),
  ...CLIMATE_COLOURS.map((_, i) => cover(`climate${i}`, (s) => s.climate[i]!)),
  { layer: 'ice', fill: (s) => s.ice, seam: true },
  // A river that runs through a lake is covered by it. A lake is the sea's colour and has no shore drawn: it is its own outline.
  ...RIVER_WEIGHTS.map((_, i) => river(i)),
  { layer: 'lakes', fill: (s) => s.ocean, seam: true },
  { layer: 'graticule', stroke: (s) => s.graticule, width: (s) => s.graticuleWidth },
  // The time zones are a wash over land and sea alike: every other hour, and more strongly the zones that are not a whole hour.
  { layer: 'zonesOdd', fill: (s) => s.zone, seam: true },
  { layer: 'zonesPart', fill: (s) => s.zonePart, seam: true },
  { layer: 'zoneLines', stroke: (s) => s.zoneLine, width: (s) => s.zoneWidth },
  { layer: 'reference', stroke: (s) => s.reference, width: (s) => s.referenceWidth, dash: [5, 4] },
  { layer: 'dateLine', stroke: (s) => s.reference, width: (s) => s.referenceWidth, dash: [1.5, 3] },
  { layer: 'provinces', stroke: (s) => s.borders, width: (s) => s.provincesWidth, dash: [3, 2] },
  { layer: 'borders', stroke: (s) => s.borders, width: (s) => s.bordersWidth },
  { layer: 'coast', stroke: (s) => s.coast, width: (s) => s.coastWidth },
  { layer: 'plates', stroke: (s) => s.plates, width: (s) => s.platesWidth },
  standard('standardOut', 'out'),
  standard('standardIn', 'in'),
  standard('standard'),
  // A drawn polygon's own outline comes in its line pieces, so its fill is not outlined along a seam.
  { layer: 'drawings', fill: (s) => s.accentFill, stroke: (s) => s.accent, width: (s) => s.drawingWidth },
];
