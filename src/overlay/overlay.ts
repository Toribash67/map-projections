import type { Sea } from '../data/water';
import type { World } from '../data/world';
import { buildDegrees } from '../labels/degrees';
import { n, paint } from '../export/svg';
import { faceOf, FONT_STACK, fontOf } from '../labels/font';
import { buildNames } from '../labels/names';
import type { Label, Mark, Measure } from '../labels/place';
import { buildHours, buildMarks, buildPoints } from '../labels/points';
import type { LayerState } from '../layers/layers';
import { legendSections, patchColour, sourcesOf, type Legend, type Sample } from '../plate/legend';
import { buildPlate, type Plate, type PlateMeasure, type Rect } from '../plate/plate';
import type { Params, ProjectionState } from '../projections/types';
import type { Style } from '../render/style';
import type { Member } from '../tissot/indicatrix';

/**
 * What is written and drawn over a map at rest: the names of countries, seas and regions, the degrees of the graticule and the
 * hours of the time zones, cities and peaks with their marks, the marks of volcanoes and earthquakes, the frame, the title box and
 * the legend. It is worked out from the map as it stands, and not cut and morphed like the layers under it.
 */
export type Overlay = { labels: Label[]; marks: Mark[]; plate: Plate };

/** The map an overlay is for: where it is drawn, what it is and is called, what is shown, the picture it is part of, and by how much that is larger than the screen. */
export type OverlayInput = {
  member: Member;
  state: ProjectionState;
  named: { name: string; params: Params };
  layers: LayerState;
  picture: Rect;
  scale: number;
};
export type OverlayMeasure = { label: Measure; plate: PlateMeasure };
/** What of the world's data the lettering and the marks are made from: each is left out, or null, until it has been fetched, and there is none of it until then. */
export type OverlayWorld = Partial<{ [K in 'regions' | 'cities' | 'peaks' | 'volcanoes' | 'quakes']: World[K] | null }>;

// The degrees belong to the graticule's lines: without the lines there are none.
const lettersDegrees = (on: LayerState['on']): boolean => on.degrees && on.graticule;
/** Whether it has lettering or marks that are fitted to the map, which takes a moment. */
export const lettersWanted = ({ on }: LayerState): boolean =>
  on.countryNames || on.seaNames || on.regionNames || lettersDegrees(on) || on.zones || on.capitals || on.cities || on.peaks || on.volcanoes || on.quakes;
/** Whether a map has anything over it at all: lettering, marks, a frame, a title box, a legend with something to say, or a word owed on whose its data is. */
export const overlayWanted = (layers: LayerState): boolean =>
  lettersWanted(layers) || layers.on.frame || layers.on.titleBox || (layers.on.legend && legendSections(layers).length > 0) || sourcesOf(layers).length > 1;

/** The frame, the title box and the legend alone, which need no fitting. */
export function buildPlateOnly({ state, named, layers, picture }: OverlayInput, measure: OverlayMeasure): Overlay {
  return { labels: [], marks: [], plate: buildPlate(state, named, layers, picture, measure.plate) };
}

/**
 * The lettering that is fitted to a map at rest: the names of countries, seas and regions; then the degrees and the hours of the
 * time zones, which keep clear of the names; then the cities and peaks, each where there is room left for it. `seas` is null until
 * they have been fetched, and `land` is what counts as land under a sea's name. The boxes are not looked at: see `overlayOf`.
 */
export function buildLetters({ member, layers, picture, scale }: OverlayInput, measure: OverlayMeasure, seas: Sea[] | null, land: GeoJSON.GeoJsonObject, world: OverlayWorld = {}): Label[] {
  const { on } = layers;
  const named = on.countryNames || on.seaNames || on.regionNames;
  const names = named ? buildNames(member, picture, { countries: on.countryNames, seas: on.seaNames, regions: on.regionNames, smallest: layers.smallestName, scale }, measure.label, seas, land, world.regions ?? null) : [];
  const degrees = lettersDegrees(on) ? buildDegrees(member, picture, layers.graticuleStep, scale, measure.label, names) : [];
  const hours = on.zones ? buildHours(member, picture, scale, measure.label, [...names, ...degrees]) : [];
  const lettered = [...names, ...degrees, ...hours];
  const points = on.capitals || on.cities || on.peaks ? buildPoints(member, picture, { capitals: on.capitals, cities: on.cities, peaks: on.peaks, smallest: layers.smallestName, scale }, measure.label, world.cities ?? null, world.peaks ?? null, lettered) : [];
  return [...lettered, ...points];
}

/** The marks that have no name: the volcanoes and the earthquakes. */
export function buildOverlayMarks({ member, layers, picture, scale }: OverlayInput, world: OverlayWorld = {}): Mark[] {
  const { on } = layers;
  return on.volcanoes || on.quakes ? buildMarks(member, picture, scale, on.volcanoes ? (world.volcanoes ?? null) : null, on.quakes ? (world.quakes ?? null) : null) : [];
}

/**
 * Lettering, marks and a plate together: a name, a number or a mark that the title box or the legend would lie over is left out.
 * The lettering takes a moment to fit and the plate none, so that when only the plate changes, as while a title is typed, the same
 * lettering is put under the new one.
 */
export function overlayOf(letters: Label[], plate: Plate, marks: Mark[] = []): Overlay {
  const boxes = [plate.box, plate.legend].filter((box): box is NonNullable<typeof box> => box !== null);
  if (boxes.length === 0) return { labels: letters, marks, plate };
  const under = (x: number, y: number, r: number) => boxes.some((box) => x + r > box.x && x - r < box.x + box.width && y + r > box.y && y - r < box.y + box.height);
  return { labels: letters.filter((label) => !label.discs.some(([x, y, r]) => under(x, y, r))), marks: marks.filter(({ x, y, r }) => !under(x, y, r)), plate };
}

/** Everything over a map at rest. */
export function buildOverlay(input: OverlayInput, measure: OverlayMeasure, seas: Sea[] | null, land: GeoJSON.GeoJsonObject, world: OverlayWorld = {}): Overlay {
  return overlayOf(buildLetters(input, measure, seas, land, world), buildPlateOnly(input, measure).plate, buildOverlayMarks(input, world));
}

/** The colour a kind of label is lettered in: the degrees and the hours in the page's ink, like the frame; the seas in their own; the rest in the names'. */
export const labelColour = (kind: Label['kind'], style: Style): string => (kind === 'sea' ? style.seaLabels : kind === 'degree' || kind === 'zone' ? style.ink : style.labels);

/** The colour of a mark: a place of people or a peak in the names' colour, and what is of the plates in theirs. */
const markColour = (kind: Mark['kind'], style: Style): string => (kind === 'volcano' || kind === 'quake' ? style.plates : style.labels);

/** A triangle about a point, its foot `r` below and its head `r` above, as its three corners. */
const triangle = ({ x, y, r }: Mark): [number, number][] => [[x, y - r], [x + 0.95 * r, y + 0.75 * r], [x - 0.95 * r, y + 0.75 * r]];
// A capital is a ring with a dot in it, and an earthquake a ring: how wide the ring's line is, and how large the dot, in radii.
const RING = 0.34;
const CORE = 0.42;
const QUAKE_LINE = 0.16;

/** Draws a mark on the canvas. */
function drawMark(ctx: CanvasRenderingContext2D, mark: Mark, style: Style): void {
  const { kind, x, y, r } = mark;
  const colour = markColour(kind, style);
  ctx.fillStyle = colour;
  ctx.strokeStyle = colour;
  const disc = (radius: number) => {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, 2 * Math.PI);
  };
  if (kind === 'peak' || kind === 'volcano') {
    ctx.beginPath();
    triangle(mark).forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
    ctx.closePath();
    ctx.fill();
  } else if (kind === 'city') {
    disc(r);
    ctx.fill();
  } else if (kind === 'capital') {
    ctx.fillStyle = style.box;
    disc(r);
    ctx.fill();
    ctx.lineWidth = RING * r;
    disc(r - (RING * r) / 2);
    ctx.stroke();
    ctx.fillStyle = colour;
    disc(CORE * r);
    ctx.fill();
  } else {
    ctx.fillStyle = style.accentFill;
    disc(r);
    ctx.fill();
    ctx.lineWidth = Math.max(QUAKE_LINE * r, 0.2);
    ctx.stroke();
  }
}

/** A line of the legend, as its colour, its width in hairlines and its dashes in hairlines. */
const legendLine = (line: Extract<Sample, { line: string }>['line'], style: Style): { colour: string; width: number; dash: number[] } =>
  line === 'plates' ? { colour: style.plates, width: 2.2, dash: [] } : line === 'provinces' ? { colour: style.borders, width: 1, dash: [4, 3] } : { colour: style.reference, width: 1.6, dash: [2, 4] };

/** The mark a row of the legend shows, in the middle of the row's sample. */
const sampleMark = (kind: Mark['kind'], box: Rect): Mark => ({ kind, x: box.x + box.width / 2, y: box.y + box.height / 2, r: box.height * (kind === 'quake' ? 0.62 : 0.5) });

function drawLegend(ctx: CanvasRenderingContext2D, legend: Legend, hairline: number, style: Style): void {
  ctx.fillStyle = style.box;
  ctx.fillRect(legend.x, legend.y, legend.width, legend.height);
  ctx.lineJoin = 'miter';
  ctx.strokeStyle = style.ink;
  ctx.lineWidth = hairline;
  ctx.strokeRect(legend.x, legend.y, legend.width, legend.height);
  for (const { sample, box } of legend.samples) {
    if ('patch' in sample) {
      ctx.fillStyle = patchColour(style, sample);
      ctx.fillRect(box.x, box.y, box.width, box.height);
      ctx.strokeStyle = style.ink;
      ctx.lineWidth = hairline / 2;
      ctx.strokeRect(box.x, box.y, box.width, box.height);
    } else if ('mark' in sample) drawMark(ctx, sampleMark(sample.mark, box), style);
    else {
      const { colour, width, dash } = legendLine(sample.line, style);
      ctx.strokeStyle = colour;
      ctx.lineWidth = width * hairline;
      ctx.setLineDash?.(dash.map((v) => v * hairline));
      ctx.beginPath();
      ctx.moveTo(box.x, box.y + box.height / 2);
      ctx.lineTo(box.x + box.width, box.y + box.height / 2);
      ctx.stroke();
      ctx.setLineDash?.([]);
    }
  }
  ctx.lineJoin = 'round';
  ctx.fillStyle = style.ink;
  for (const text of legend.texts) {
    ctx.font = fontOf(text.weight, 'normal', text.size);
    ctx.fillText(text.text, text.x, text.y);
  }
}

/** A line of a box: letter by letter, with the line's own space between them, about its middle. */
function drawLine(ctx: CanvasRenderingContext2D, line: NonNullable<Plate['credit']>): void {
  ctx.font = fontOf(line.weight, 'normal', line.size);
  const widths = [...line.text].map((ch) => ctx.measureText(ch).width);
  let at = line.x - (widths.reduce((sum, w) => sum + w, 0) + line.gap * (widths.length - 1)) / 2;
  [...line.text].forEach((ch, i) => {
    ctx.fillText(ch, at, line.y);
    at += widths[i]! + line.gap;
  });
}

/**
 * Draws an overlay on the canvas, over the scene. The context's transform maps the overlay's own pixels to the canvas, and is left
 * as it was found. Each letter is drawn at its own place and turn, as the canvas cannot set text along a curve.
 */
export function drawOverlay(ctx: CanvasRenderingContext2D, { labels, marks, plate }: Overlay, style: Style): void {
  ctx.globalAlpha = 1;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  for (const mark of marks) drawMark(ctx, mark, style);
  for (const label of labels) {
    if (label.mark) drawMark(ctx, label.mark, style);
    const { weight, style: slope } = faceOf(label.kind);
    ctx.font = fontOf(weight, slope, label.size);
    ctx.fillStyle = labelColour(label.kind, style);
    for (const { ch, x, y, angle } of label.glyphs) {
      if (angle === 0) {
        ctx.fillText(ch, x, y);
        continue;
      }
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.fillText(ch, 0, 0);
      ctx.restore();
    }
  }
  if (plate.frame) {
    const { x, y, width, height } = plate.frame;
    ctx.lineJoin = 'miter';
    ctx.strokeStyle = style.ink;
    ctx.lineWidth = plate.frameWidth;
    ctx.strokeRect(x, y, width, height);
    ctx.lineJoin = 'round';
  }
  if (plate.legend) drawLegend(ctx, plate.legend, plate.hairline, style);
  if (plate.box) {
    const { x, y, width, height, lines, rule } = plate.box;
    ctx.fillStyle = style.box;
    ctx.fillRect(x, y, width, height);
    ctx.lineJoin = 'miter';
    ctx.strokeStyle = style.ink;
    ctx.lineWidth = plate.hairline;
    ctx.strokeRect(x, y, width, height);
    ctx.lineJoin = 'round';
    if (rule) {
      ctx.beginPath();
      ctx.moveTo(rule.x1, rule.y);
      ctx.lineTo(rule.x2, rule.y);
      ctx.stroke();
    }
    ctx.fillStyle = style.ink;
    for (const line of lines) drawLine(ctx, line);
  }
  if (plate.credit) {
    ctx.fillStyle = style.ink;
    drawLine(ctx, plate.credit);
  }
}

/** Text as it is written between tags, or in an attribute. */
const escaped = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const GROUPS: [Label['kind'], string][] = [['country', 'names'], ['sea', 'sea-names'], ['region', 'region-names'], ['degree', 'degrees'], ['zone', 'hours'], ['capital', 'capitals'], ['city', 'cities'], ['peak', 'peaks']];

/** A mark as the parts of an SVG drawing. */
function markToSvg(mark: Mark, style: Style): string {
  const { kind, x, y, r } = mark;
  const colour = markColour(kind, style);
  const at = `cx="${n(x)}" cy="${n(y)}"`;
  if (kind === 'peak' || kind === 'volcano') return `<path d="${triangle(mark).map(([px, py], i) => `${i === 0 ? 'M' : 'L'}${n(px)} ${n(py)}`).join('')}Z" ${paint('fill', colour)}/>`;
  if (kind === 'city') return `<circle ${at} r="${n(r)}" ${paint('fill', colour)}/>`;
  if (kind === 'capital') return `<circle ${at} r="${n(r - (RING * r) / 2)}" ${paint('fill', style.box)} ${paint('stroke', colour)} stroke-width="${n(RING * r)}"/><circle ${at} r="${n(CORE * r)}" ${paint('fill', colour)}/>`;
  return `<circle ${at} r="${n(r)}" ${paint('fill', style.accentFill)} ${paint('stroke', colour)} stroke-width="${n(Math.max(QUAKE_LINE * r, 0.2))}"/>`;
}

/**
 * An overlay as the parts of an SVG drawing, to go on top of the map's own (see `sceneToSvg`): a group for the names of countries,
 * one for the seas', one for the degrees, and one for the frame and the title box. Each name is one text, so it can be found and
 * edited, with a place and a turn for every letter, so it is set as the canvas sets it. `fontCss` is the typeface as style rules,
 * for the drawing to carry with it; empty, the drawing asks for the typeface by name and takes what it is given.
 */
export function overlayToSvg({ labels, marks, plate }: Overlay, style: Style, fontCss: string): string[] {
  const out: string[] = [];
  const family = `font-family="${escaped(FONT_STACK)}"`;
  for (const [kind, id] of [['quake', 'earthquakes'], ['volcano', 'volcanoes']] as const) {
    const ofKind = marks.filter((mark) => mark.kind === kind);
    if (ofKind.length > 0) out.push(`<g id="${id}">`, ...ofKind.map((mark) => markToSvg(mark, style)), '</g>');
  }
  for (const [kind, id] of GROUPS) {
    const ofKind = labels.filter((label) => label.kind === kind);
    if (ofKind.length === 0) continue;
    const { weight, style: slope } = faceOf(kind);
    out.push(`<g id="${id}" ${family} font-weight="${weight}"${slope === 'italic' ? ' font-style="italic"' : ''} ${paint('fill', labelColour(kind, style))}>`);
    for (const label of ofKind) {
      if (label.mark) out.push(markToSvg(label.mark, style));
      // A place for every character, the spaces too: a space has the place of the letter after it.
      const places: typeof label.glyphs = [];
      let g = 0;
      for (const ch of label.text) places.push(label.glyphs[ch === ' ' ? g : g++] ?? label.glyphs.at(-1)!);
      const list = (of: (glyph: (typeof places)[number]) => number) => places.map((glyph) => n(of(glyph))).join(' ');
      out.push(`<text font-size="${n(label.size)}" x="${list((p) => p.x)}" y="${list((p) => p.y)}" rotate="${list((p) => (p.angle * 180) / Math.PI)}">${escaped(label.text)}</text>`);
    }
    out.push('</g>');
  }
  if (plate.legend) {
    const { legend, hairline } = plate;
    const rect = (r: Rect) => `x="${n(r.x)}" y="${n(r.y)}" width="${n(r.width)}" height="${n(r.height)}"`;
    out.push(`<g id="legend" ${family} stroke-linejoin="miter" stroke-linecap="butt">`);
    out.push(`<rect ${rect(legend)} ${paint('fill', style.box)} ${paint('stroke', style.ink)} stroke-width="${n(hairline)}"/>`);
    for (const { sample, box } of legend.samples) {
      if ('patch' in sample) out.push(`<rect ${rect(box)} ${paint('fill', patchColour(style, sample))} ${paint('stroke', style.ink)} stroke-width="${n(hairline / 2)}"/>`);
      else if ('mark' in sample) out.push(markToSvg(sampleMark(sample.mark, box), style));
      else {
        const { colour, width, dash } = legendLine(sample.line, style);
        const dashes = dash.length > 0 ? ` stroke-dasharray="${dash.map((v) => n(v * hairline)).join(' ')}"` : '';
        out.push(`<line x1="${n(box.x)}" x2="${n(box.x + box.width)}" y1="${n(box.y + box.height / 2)}" y2="${n(box.y + box.height / 2)}" ${paint('stroke', colour)} stroke-width="${n(width * hairline)}"${dashes}/>`);
      }
    }
    out.push(`<g ${paint('fill', style.ink)}>`);
    for (const text of legend.texts) out.push(`<text x="${n(text.x)}" y="${n(text.y)}" font-size="${n(text.size)}" font-weight="${text.weight}" xml:space="preserve">${escaped(text.text)}</text>`);
    out.push('</g>', '</g>');
  }
  if (plate.credit) {
    const line = plate.credit;
    out.push(`<text id="credit" ${family} text-anchor="middle" x="${n(line.x + line.gap / 2)}" y="${n(line.y)}" font-size="${n(line.size)}" font-weight="${line.weight}" letter-spacing="${n(line.gap)}" ${paint('fill', style.ink)}>${escaped(line.text)}</text>`);
  }
  if (plate.frame || plate.box) {
    out.push(`<g id="plate" ${family} text-anchor="middle" stroke-linejoin="miter" stroke-linecap="butt">`);
    const rect = (r: { x: number; y: number; width: number; height: number }) => `x="${n(r.x)}" y="${n(r.y)}" width="${n(r.width)}" height="${n(r.height)}"`;
    if (plate.frame) out.push(`<rect ${rect(plate.frame)} fill="none" ${paint('stroke', style.ink)} stroke-width="${n(plate.frameWidth)}"/>`);
    if (plate.box) {
      const { lines, rule } = plate.box;
      out.push(`<rect ${rect(plate.box)} ${paint('fill', style.box)} ${paint('stroke', style.ink)} stroke-width="${n(plate.hairline)}"/>`);
      if (rule) out.push(`<line x1="${n(rule.x1)}" x2="${n(rule.x2)}" y1="${n(rule.y)}" y2="${n(rule.y)}" ${paint('stroke', style.ink)} stroke-width="${n(plate.hairline)}"/>`);
      out.push(`<g ${paint('fill', style.ink)}>`);
      // The space between letters comes after the last one too, which would set the line half a space to the left of its middle.
      for (const line of lines) out.push(`<text x="${n(line.x + line.gap / 2)}" y="${n(line.y)}" font-size="${n(line.size)}" font-weight="${line.weight}" letter-spacing="${n(line.gap)}">${escaped(line.text)}</text>`);
      out.push('</g>');
    }
    out.push('</g>');
  }
  if (out.length > 0 && fontCss) out.unshift(`<style>${fontCss}</style>`);
  return out;
}
