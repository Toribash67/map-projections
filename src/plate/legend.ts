import { DEPTHS } from '../data/water';
import { HEIGHTS } from '../data/world';
import type { Mark } from '../labels/place';
import type { LayerState } from '../layers/layers';
import type { Style } from '../render/style';
import { BIOME_NAMES, CLIMATE_NAMES } from '../theme/classes';

type Rect = { x: number; y: number; width: number; height: number };

/** What a row of the legend shows beside its words: a patch of a colour of the map, a mark, or a line. */
export type Sample = { patch: 'land' | 'ocean' | 'ice' | 'height' | 'depth' | 'biomes' | 'climate'; index?: number } | { mark: Mark['kind'] } | { line: 'plates' | 'provinces' | 'dateLine' };
export type LegendRow = { text: string; sample: Sample };
/** A part of the legend: what it is of, in a word, and its rows. One with no word is the marks and lines, which need none. */
export type LegendSection = { title: string; rows: LegendRow[] };

const metres = (from: number | null, to: number | null): string => (from === null ? `under ${to} m` : to === null ? `over ${from} m` : `${from} – ${to} m`);

/**
 * What the legend of a picture says: a part for whatever colours its land, one for the depths of the sea, and one for the marks
 * and lines that are not plain from the map itself. Nothing where the picture shows none of them.
 */
export function legendSections({ on, cover }: LayerState): LegendSection[] {
  const sections: LegendSection[] = [];
  if (cover === 'height') {
    // The highest first, as it is on the land.
    const rows = HEIGHTS.map((from, i): LegendRow => ({ text: metres(from, HEIGHTS[i + 1] ?? null), sample: { patch: 'height', index: i } })).reverse();
    sections.push({ title: 'Height', rows: [...rows, { text: metres(null, HEIGHTS[0]), sample: { patch: 'land' } }] });
  }
  if (cover === 'biomes') sections.push({ title: 'Biomes', rows: BIOME_NAMES.map((text, index) => ({ text, sample: { patch: 'biomes', index } })) });
  if (cover === 'climate') sections.push({ title: 'Climates', rows: CLIMATE_NAMES.map((text, index) => ({ text, sample: { patch: 'climate', index } })) });
  if (on.depth) {
    const rows = DEPTHS.map((from, i): LegendRow => ({ text: metres(from, DEPTHS[i + 1] ?? null), sample: { patch: 'depth', index: i } }));
    sections.push({ title: 'Sea depth', rows: [{ text: metres(null, DEPTHS[0]), sample: { patch: 'ocean' } }, ...rows] });
  }
  const rest: LegendRow[] = [];
  if (on.ice) rest.push({ text: 'Ice', sample: { patch: 'ice' } });
  if (on.capitals || on.cities) rest.push({ text: 'Capital', sample: { mark: 'capital' } });
  if (on.cities) rest.push({ text: 'City', sample: { mark: 'city' } });
  if (on.peaks) rest.push({ text: 'Peak, with its height in metres', sample: { mark: 'peak' } });
  if (on.provinces) rest.push({ text: 'State or province', sample: { line: 'provinces' } });
  if (on.dateLine) rest.push({ text: 'Date line', sample: { line: 'dateLine' } });
  if (on.plates) rest.push({ text: 'Plate boundary', sample: { line: 'plates' } });
  if (on.volcanoes) rest.push({ text: 'Volcano', sample: { mark: 'volcano' } });
  if (on.quakes) rest.push({ text: 'Earthquake, magnitude 7 or more since 1900', sample: { mark: 'quake' } });
  if (rest.length > 0) sections.push({ title: '', rows: rest });
  return sections;
}

/**
 * Whose data a picture is made of, Natural Earth's first: the coast and the countries are always its. Two of the others ask to be
 * named wherever their data is shown, and say so with their licence.
 */
export function sourcesOf({ on, cover }: LayerState): string[] {
  const sources = ['Natural Earth'];
  if (cover === 'height') sources.push('NOAA ETOPO5');
  if (cover === 'biomes') sources.push('RESOLVE Ecoregions 2017 (CC BY 4.0)');
  if (cover === 'climate') sources.push('Beck et al. 2018 (CC BY 4.0)');
  if (on.plates) sources.push('P. Bird and H. Ahlenius, Nordpil (ODC-By)');
  if (on.volcanoes) sources.push('NOAA NCEI');
  if (on.quakes) sources.push('USGS');
  return sources;
}

/** The colour of a patch of the legend, which is the map's own for what the patch is of. */
export function patchColour(style: Style, { patch, index = 0 }: Extract<Sample, { patch: string }>): string {
  return patch === 'land' ? style.land : patch === 'ocean' ? style.ocean : patch === 'ice' ? style.ice : style[patch][index]!;
}

/** Words of the legend: set from their left end on a baseline. */
export type LegendText = { text: string; size: number; weight: 400 | 500; x: number; y: number };
/** The legend as it is drawn: its box, its words, and for each row what it shows, in the place it is shown in. */
export type Legend = Rect & { texts: LegendText[]; samples: { sample: Sample; box: Rect }[] };

// In units of a thousandth of the picture's size, as the title box is.
const PAD = { x: 12, y: 11 };
const ROW = 10.5;
const TEXT = 7;
const TITLE = 6.6;
const SAMPLE = { width: 13, height: 6.5, gap: 6 };
const BETWEEN = 7;
// The share of a letter's height that is above its baseline, about.
const ASCENT = 0.74;

/**
 * The legend laid out, with its top left corner at the origin: `place` it where it goes. `u` is the unit, and `measure` the width
 * of text at a letter height of one. `foot` are lines under it all, as for whose the data is.
 */
export function layoutLegend(sections: LegendSection[], foot: string[], u: number, measure: (text: string, weight: number) => number): Legend {
  const texts: LegendText[] = [];
  const samples: Legend['samples'] = [];
  let y = PAD.y * u;
  let widest = 0;
  const left = PAD.x * u;
  const say = (text: string, size: number, weight: 400 | 500, x: number, height: number) => {
    texts.push({ text, size: size * u, weight, x, y: y + (height * u - size * u) / 2 + ASCENT * size * u });
    widest = Math.max(widest, x - left + measure(text, weight) * size * u);
    y += height * u;
  };
  sections.forEach((section, i) => {
    if (i > 0) y += BETWEEN * u;
    if (section.title) say(section.title.toUpperCase(), TITLE, 500, left, ROW);
    for (const row of section.rows) {
      samples.push({ sample: row.sample, box: { x: left, y: y + ((ROW - SAMPLE.height) / 2) * u, width: SAMPLE.width * u, height: SAMPLE.height * u } });
      say(row.text, TEXT, 400, left + (SAMPLE.width + SAMPLE.gap) * u, ROW);
    }
  });
  if (foot.length > 0) {
    if (sections.length > 0) y += BETWEEN * u;
    for (const line of foot) say(line, TITLE * 0.9, 400, left, ROW * 0.85);
  }
  return { x: 0, y: 0, width: widest + 2 * PAD.x * u, height: y + PAD.y * u, texts, samples };
}

/** A legend moved to where its top left corner is to be. */
export function placeLegend(legend: Legend, x: number, y: number): Legend {
  const [dx, dy] = [x - legend.x, y - legend.y];
  return {
    ...legend,
    x,
    y,
    texts: legend.texts.map((text) => ({ ...text, x: text.x + dx, y: text.y + dy })),
    samples: legend.samples.map(({ sample, box }) => ({ sample, box: { ...box, x: box.x + dx, y: box.y + dy } })),
  };
}
