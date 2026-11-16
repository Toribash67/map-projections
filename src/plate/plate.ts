import type { LayerState, MapLayers } from '../layers/layers';
import { getDef } from '../projections/catalog';
import { controlsFor } from '../projections/controls';
import type { Params, ProjectionState } from '../projections/types';
import { PADDING } from '../screen/screen';
import { layoutLegend, legendSections, placeLegend, sourcesOf, type Legend } from './legend';

export type Rect = { x: number; y: number; width: number; height: number };

/** How much more margin (px) the map has round it when the picture has a frame, so that the frame does not crowd it. */
export const FRAME_MARGIN = 24;
/** The margin round the fitted map: the map's own, and more where the picture has a frame. */
export const paddingFor = (layers: LayerState | MapLayers): number => PADDING + ('frame' in layers.on && layers.on.frame ? FRAME_MARGIN : 0);

/** A line of the title box: set about `x`, on the baseline `y`, with `gap` pixels added between its letters. */
export type PlateLine = { text: string; size: number; weight: 400 | 500 | 700; gap: number; x: number; y: number };
/**
 * The frame round the picture, the title box in a place in it, and the legend in another, any of which may be absent. `hairline`
 * is the width of the boxes' edges and of the title box's rule. `credit` is a line at the foot of the picture that says whose the
 * data is, where that has to be said and there is neither box to say it in.
 */
export type Plate = {
  frame: Rect | null;
  frameWidth: number;
  hairline: number;
  box: (Rect & { lines: PlateLine[]; rule: { x1: number; x2: number; y: number } | null }) | null;
  legend: Legend | null;
  credit: PlateLine | null;
};
/** The width of some text at a letter height of one, in a weight of the typeface. */
export type PlateMeasure = (text: string, weight: number) => number;

const degrees = (value: number, positive: string, negative: string): string => {
  const size = Math.round(Math.abs(value) * 100) / 100;
  return size === 0 ? '0°' : `${size}°${value > 0 ? positive : negative}`;
};

/**
 * How a map is set, in a line: its centre, its tilt if it has one, and each parameter that is not as the projection has it by
 * default. The latitude of the centre is left out on the equator, where most maps are centred. `defaults` are the parameters of the
 * named projection the map is called by, where they are not the definition's own: Mercator is one setting of a cylinder with a
 * parameter, and that setting is not said of it.
 */
export function settingsLine(state: ProjectionState, defaults: Params = {}): string {
  const def = getDef(state.defId);
  const usual = { ...def.defaultParams, ...defaults };
  const { lon, lat, tilt } = state.orientation;
  const parts = [`Centre ${degrees(lon, 'E', 'W')}${def.latEnabled && lat !== 0 ? ` ${degrees(lat, 'N', 'S')}` : ''}`];
  if (def.tiltEnabled && tilt !== 0) parts.push(`Tilt ${Math.round(tilt * 100) / 100}°`);
  for (const control of controlsFor(state.defId)) {
    const value = state.params[control.key] ?? usual[control.key];
    if (value === undefined || value === usual[control.key]) continue;
    parts.push(`${control.label} ${control.format ? control.format(value) : Math.round(value * 100) / 100}`);
  }
  return parts.join(' · ');
}

// Everything below is in units of a thousandth of the picture's size (the mean of its sides), so the plate is the same on any picture.
const FRAME_INSET = 6;
const FRAME_WIDTH = 1.6;
const HAIRLINE = 0.7;
// The box: how far inside the frame's line it sits, the room round its lines, and how narrow and how wide it may be.
const BOX_INSET = 14;
const BOX_PAD = { x: 18, y: 15 };
const BOX_MIN = 190;
const BOX_MAX = 0.45;
// The share of a letter's height that is above its baseline, about.
const ASCENT = 0.74;

type Draft = { text: string; size: number; weight: PlateLine['weight']; gap: number; after: number; rule?: boolean };

/**
 * The frame and the title box of a picture. The box says, from the top: the title and subtitle that were typed, in capitals, a rule,
 * the projection's name, its settings in a line, and where the map's data is from. A title or subtitle left empty has no line. The
 * box is as wide as its widest line, within limits; a line too wide for the widest box is lettered smaller.
 *
 * `named` is the projection the map is called by: its name as the list has it, and its parameters there. `measure` gives the width
 * of text in the plate's typeface.
 */
export function buildPlate(state: ProjectionState, named: { name: string; params: Params }, layers: LayerState, picture: Rect, measure: PlateMeasure): Plate {
  const u = Math.sqrt(picture.width * picture.height) / 1000;
  const plate: Plate = { frame: null, frameWidth: FRAME_WIDTH * u, hairline: HAIRLINE * u, box: null, legend: null, credit: null };
  if (layers.on.frame) {
    const inset = FRAME_INSET * u;
    plate.frame = { x: picture.x + inset, y: picture.y + inset, width: picture.width - 2 * inset, height: picture.height - 2 * inset };
  }
  const edge = (FRAME_INSET + BOX_INSET) * u;
  /** Where a box of a size goes for a place of the nine: against a side, or half way between two. */
  const placed = ([down, across]: string, width: number, height: number): [number, number] => [
    across === 'l' ? picture.x + edge : across === 'm' ? picture.x + (picture.width - width) / 2 : picture.x + picture.width - edge - width,
    down === 't' ? picture.y + edge : down === 'm' ? picture.y + (picture.height - height) / 2 : picture.y + picture.height - edge - height,
  ];
  // Whose the data is: Natural Earth's alone is said by the title box in its own words, and where there are others they are listed.
  const sources = sourcesOf(layers);
  const credit = sources.length > 1 ? `Data: ${sources.join(', ')}` : 'Made with Natural Earth';
  if (layers.on.titleBox) plate.box = titleBox(state, named, layers, picture, measure, u, credit, placed);

  // The legend, where the picture has anything to explain. It says whose the data is if the title box is not there to.
  const sections = layers.on.legend ? legendSections(layers) : [];
  const owed = sources.length > 1 && !plate.box;
  if (sections.length > 0) {
    const legend = layoutLegend(sections, owed ? sources.slice(1).map((source, i) => (i === 0 ? `Data: ${source}` : source)) : [], u, measure);
    let [x, y] = placed(layers.legendCorner, legend.width, legend.height);
    const { box } = plate;
    // Where the two boxes would lie on one another, the legend moves under the title box, or over it where that is lower down.
    if (box && x < box.x + box.width && x + legend.width > box.x && y < box.y + box.height && y + legend.height > box.y) {
      const gap = BOX_INSET * u * 0.6;
      y = layers.legendCorner[0] === 'b' ? box.y - gap - legend.height : box.y + box.height + gap;
    }
    plate.legend = placeLegend(legend, x, y);
  } else if (owed) {
    // With neither box, a line at the foot of the picture.
    const size = 6.5 * u;
    plate.credit = { text: credit, size, weight: 400, gap: 0.4 * u, x: picture.x + picture.width / 2, y: picture.y + picture.height - (FRAME_INSET + 5) * u };
  }
  return plate;
}

/** The title box. See `buildPlate`. */
function titleBox(
  state: ProjectionState,
  named: { name: string; params: Params },
  layers: LayerState,
  picture: Rect,
  measure: PlateMeasure,
  u: number,
  credit: string,
  placed: (corner: string, width: number, height: number) => [number, number],
): NonNullable<Plate['box']> {

  const [title, subtitle] = [layers.title.trim().toUpperCase(), layers.subtitle.trim().toUpperCase()];
  const drafts: Draft[] = [];
  if (title) drafts.push({ text: title, size: 26, weight: 700, gap: 4, after: subtitle ? 8 : 12 });
  if (subtitle) drafts.push({ text: subtitle, size: 9, weight: 500, gap: 2.2, after: 12 });
  if (drafts.length > 0) drafts.at(-1)!.rule = true;
  drafts.push({ text: `${named.name.toUpperCase()} PROJECTION`, size: 9.5, weight: 500, gap: 2.2, after: 7 });
  drafts.push({ text: settingsLine(state, named.params), size: 8, weight: 400, gap: 0.5, after: 6 });
  drafts.push({ text: credit, size: 7.5, weight: 400, gap: 0.5, after: 0 });

  const widthOf = (d: Draft) => (d.size * measure(d.text, d.weight) + d.gap * ([...d.text].length - 1)) * u;
  const most = BOX_MAX * picture.width - 2 * BOX_PAD.x * u;
  for (const draft of drafts) {
    // Lettered smaller, spacing and all, until it fits the widest box there can be.
    const over = widthOf(draft) / most;
    if (over > 1) [draft.size, draft.gap] = [draft.size / over, draft.gap / over];
  }
  const inner = Math.min(most, Math.max(BOX_MIN * u - 2 * BOX_PAD.x * u, ...drafts.map(widthOf)));
  const width = inner + 2 * BOX_PAD.x * u;
  const height = (2 * BOX_PAD.y + drafts.reduce((sum, d) => sum + d.size + d.after, 0) + (drafts.some((d) => d.rule) ? 12 : 0)) * u;
  const [x, y] = placed(layers.corner, width, height);

  const lines: PlateLine[] = [];
  let rule: NonNullable<Plate['box']>['rule'] = null;
  let top = y + BOX_PAD.y * u;
  for (const draft of drafts) {
    lines.push({ text: draft.text, size: draft.size * u, weight: draft.weight, gap: draft.gap * u, x: x + width / 2, y: top + ASCENT * draft.size * u });
    top += (draft.size + draft.after) * u;
    if (draft.rule) {
      rule = { x1: x + BOX_PAD.x * u, x2: x + width - BOX_PAD.x * u, y: top };
      top += 12 * u;
    }
  }
  return { x, y, width, height, lines, rule };
}
