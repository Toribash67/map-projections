import { geoGraticule } from 'd3-geo';
import { BORDERS, POLITICAL } from '../data/countries';
import { COAST, LAND } from '../data/land';
import type { CompiledProjection, LonLat } from '../projections/types';
import type { Style } from '../render/style';
import { standardLines } from './standardLines';

/** What can be shown or hidden: the layers of the map itself, and then what is written and drawn over a map at rest, the names, the degrees, the frame and the title box. */
export type LayerId =
  | 'land' | 'coast' | 'graticule' | 'borders' | 'political' | 'rivers' | 'lakes' | 'depth' | 'tissot' | 'standard' | 'reference' | 'drawings'
  | 'countryNames' | 'seaNames' | 'degrees' | 'frame' | 'titleBox';
export type GraticuleStep = 10 | 15 | 30;
/** A corner of the picture: top or bottom, left or right. */
export type Corner = 'tl' | 'tr' | 'bl' | 'br';
export const CORNERS: readonly Corner[] = ['tl', 'tr', 'bl', 'br'];
/** The limits of the smallest lettering a name may have, in pixels of the screen, and how long a title may be. */
export const SMALLEST_NAME = { min: 1, max: 10 } as const;
export const TITLE_LENGTH = 80;

/** Which layers the map shows, how fine its graticule is and whether it lies under the land, how small a name may be, and what the title box says and where it sits. */
export interface LayerState {
  on: Record<LayerId, boolean>;
  graticuleStep: GraticuleStep;
  graticuleUnder: boolean;
  smallestName: number;
  title: string;
  subtitle: string;
  corner: Corner;
}

export const DEFAULT_LAYERS: LayerState = {
  on: {
    land: true, coast: true, graticule: true, borders: false, political: false, rivers: false, lakes: false, depth: false, tissot: false, standard: false, reference: false, drawings: true,
    countryNames: false, seaNames: false, degrees: false, frame: false, titleBox: false,
  },
  graticuleStep: 10,
  graticuleUnder: false,
  smallestName: 4,
  title: 'The World',
  subtitle: '',
  corner: 'tr',
};

/** The layers of the map itself in the order they are listed for choosing, with what each is called. */
export const LAYER_NAMES: [LayerId, string][] = [
  ['land', 'Land'],
  ['coast', 'Coastline'],
  ['graticule', 'Graticule'],
  ['borders', 'Country borders'],
  ['political', 'Political colours'],
  ['rivers', 'Rivers'],
  ['lakes', 'Lakes'],
  ['depth', 'Sea depth'],
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
  /** Rivers, lakes with their shores as lines, and the sea by depth: each is there once it has been fetched. See `withWater`. */
  rivers?: GeoJSON.GeoJsonObject;
  lakes?: GeoJSON.GeoJsonObject;
  lakeEdges?: GeoJSON.GeoJsonObject;
  depth?: GeoJSON.GeoJsonObject[];
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

/**
 * The geometry a scene is cut from, by layer, for the layers that are on. `maps` are the maps on screen: one at rest, and in a morph
 * the maps it comes from followed by the map it goes to. The objects are the same from call to call unless what they hold has
 * changed, as the cuts keep what they prepare by object.
 *
 * Standard lines belong to one map, so a morph has two sets: those of the maps it leaves, which thin away, and those of the map it
 * goes to, which grow. The indicatrices are not geometry and are not here: the scene makes them if `on.tissot` says so.
 */
export function sceneLayers(state: LayerState, maps: CompiledProjection[], drawings: GeoJSON.GeoJsonObject, data: MapData = COARSE): Record<string, GeoJSON.GeoJsonObject> {
  const { on } = state;
  const layers: Record<string, GeoJSON.GeoJsonObject> = { ocean: OCEAN };
  if (on.depth) data.depth?.forEach((deeper, i) => (layers[`depth${i}`] = deeper));
  if (on.political) data.political.forEach((countries, i) => (layers[`political${i}`] = countries));
  else if (on.land) layers.land = data.land;
  if (on.rivers && data.rivers) layers.rivers = data.rivers;
  if (on.lakes && data.lakes && data.lakeEdges) {
    layers.lakes = data.lakes;
    layers.lakeEdges = data.lakeEdges;
  }
  // The same lines under another name, which is painted before the land.
  if (on.graticule) layers[state.graticuleUnder ? 'graticuleUnder' : 'graticule'] = graticule(state.graticuleStep);
  if (on.reference) layers.reference = REFERENCE;
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
  /** A stroke round each fill in the fill's own colour, which hides the hairline where two pieces meet at a seam. */
  seam?: boolean;
  stroke?: ColourOf;
  width?: WidthOf;
  dash?: number[];
  /** A line that belongs to one end of a morph: its width goes with the morph, out to nothing or in from it. */
  taper?: 'out' | 'in';
}

const political = (i: number): Painted => ({ layer: `political${i}`, fill: (s) => s.political[i]!, seam: true });
const depth = (i: number): Painted => ({ layer: `depth${i}`, fill: (s) => s.depth[i]!, seam: true });
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
  ...[0, 1, 2, 3, 4].map(political),
  // A river that runs through a lake is covered by it. A lake is the sea's colour, with its shore in the rivers'.
  { layer: 'rivers', stroke: (s) => s.rivers, width: (s) => s.riversWidth },
  { layer: 'lakes', fill: (s) => s.ocean, seam: true },
  { layer: 'lakeEdges', stroke: (s) => s.rivers, width: (s) => s.lakeEdgeWidth },
  { layer: 'graticule', stroke: (s) => s.graticule, width: (s) => s.graticuleWidth },
  { layer: 'reference', stroke: (s) => s.reference, width: (s) => s.referenceWidth, dash: [5, 4] },
  { layer: 'borders', stroke: (s) => s.borders, width: (s) => s.bordersWidth },
  { layer: 'coast', stroke: (s) => s.coast, width: (s) => s.coastWidth },
  standard('standardOut', 'out'),
  standard('standardIn', 'in'),
  standard('standard'),
  // A drawn polygon's own outline comes in its line pieces, so its fill is not outlined along a seam.
  { layer: 'drawings', fill: (s) => s.accentFill, stroke: (s) => s.accent, width: (s) => s.drawingWidth },
];
