import type { Sea } from '../data/water';
import { buildDegrees } from '../labels/degrees';
import { n, paint } from '../export/svg';
import { faceOf, FONT_STACK, fontOf } from '../labels/font';
import { buildNames } from '../labels/names';
import type { Label, Measure } from '../labels/place';
import type { LayerState } from '../layers/layers';
import { buildPlate, type Plate, type PlateMeasure, type Rect } from '../plate/plate';
import type { Params, ProjectionState } from '../projections/types';
import type { Style } from '../render/style';
import type { Member } from '../tissot/indicatrix';

/**
 * What is written and drawn over a map at rest: the names of countries and seas, the degrees of the graticule, the frame and the
 * title box. It is worked out from the map as it stands, and not cut and morphed like the layers under it: while the map moves the
 * lettering is not drawn, and it is worked out afresh when the map has come to rest.
 */
export type Overlay = { labels: Label[]; plate: Plate };

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

/** Whether a map has anything over it at all. */
export const overlayWanted = ({ on }: LayerState): boolean => on.countryNames || on.seaNames || lettersDegrees(on) || on.frame || on.titleBox;
/** Whether it has lettering that is fitted to the map, which takes a moment and waits for the map to rest. */
export const lettersWanted = ({ on }: LayerState): boolean => on.countryNames || on.seaNames || lettersDegrees(on);
// The degrees belong to the graticule's lines: without the lines there are none.
const lettersDegrees = (on: LayerState['on']): boolean => on.degrees && on.graticule;

/** The frame and the title box alone, which need no fitting: what is drawn over a map that is moving. */
export function buildPlateOnly({ state, named, layers, picture }: OverlayInput, measure: OverlayMeasure): Overlay {
  return { labels: [], plate: buildPlate(state, named, layers, picture, measure.plate) };
}

/**
 * The lettering that is fitted to a map at rest: the names, and then the degrees, which keep clear of the names. `seas` is null
 * until they have been fetched, and `land` is what counts as land under a sea's name. The title box is not looked at: see `overlayOf`.
 */
export function buildLetters({ member, layers, picture, scale }: OverlayInput, measure: OverlayMeasure, seas: Sea[] | null, land: GeoJSON.GeoJsonObject): Label[] {
  const { on } = layers;
  const names = on.countryNames || on.seaNames ? buildNames(member, picture, { countries: on.countryNames, seas: on.seaNames, smallest: layers.smallestName, scale }, measure.label, seas, land) : [];
  const degrees = lettersDegrees(on) ? buildDegrees(member, picture, layers.graticuleStep, scale, measure.label, names) : [];
  return [...names, ...degrees];
}

/**
 * Lettering and a plate together: a name or a number the title box would lie over is left out. The lettering takes a moment to fit
 * and the plate none, so that when only the plate changes, as while a title is typed, the same lettering is put under the new one.
 */
export function overlayOf(letters: Label[], plate: Plate): Overlay {
  const { box } = plate;
  if (!box) return { labels: letters, plate };
  return { labels: letters.filter((label) => !label.discs.some(([x, y, r]) => x + r > box.x && x - r < box.x + box.width && y + r > box.y && y - r < box.y + box.height)), plate };
}

/** Everything over a map at rest. */
export function buildOverlay(input: OverlayInput, measure: OverlayMeasure, seas: Sea[] | null, land: GeoJSON.GeoJsonObject): Overlay {
  return overlayOf(buildLetters(input, measure, seas, land), buildPlateOnly(input, measure).plate);
}

/** The colour a kind of label is lettered in: the degrees in the page's ink, like the frame. */
export const labelColour = (kind: Label['kind'], style: Style): string => (kind === 'country' ? style.labels : kind === 'sea' ? style.seaLabels : style.ink);

/**
 * Draws an overlay on the canvas, over the scene. The context's transform maps the overlay's own pixels to the canvas, and is left
 * as it was found. Each letter is drawn at its own place and turn, as the canvas cannot set text along a curve.
 */
export function drawOverlay(ctx: CanvasRenderingContext2D, { labels, plate }: Overlay, style: Style): void {
  ctx.globalAlpha = 1;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  for (const label of labels) {
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
  if (plate.box) {
    const { x, y, width, height, lines, rule } = plate.box;
    ctx.fillStyle = style.background;
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
    for (const line of lines) {
      ctx.font = fontOf(line.weight, 'normal', line.size);
      // Letter by letter, with the line's own space between them, about its middle.
      const widths = [...line.text].map((ch) => ctx.measureText(ch).width);
      let at = line.x - (widths.reduce((sum, w) => sum + w, 0) + line.gap * (widths.length - 1)) / 2;
      [...line.text].forEach((ch, i) => {
        ctx.fillText(ch, at, line.y);
        at += widths[i]! + line.gap;
      });
    }
  }
}

/** Text as it is written between tags, or in an attribute. */
const escaped = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const GROUPS: [Label['kind'], string][] = [['country', 'names'], ['sea', 'sea-names'], ['degree', 'degrees']];

/**
 * An overlay as the parts of an SVG drawing, to go on top of the map's own (see `sceneToSvg`): a group for the names of countries,
 * one for the seas', one for the degrees, and one for the frame and the title box. Each name is one text, so it can be found and
 * edited, with a place and a turn for every letter, so it is set as the canvas sets it. `fontCss` is the typeface as style rules,
 * for the drawing to carry with it; empty, the drawing asks for the typeface by name and takes what it is given.
 */
export function overlayToSvg({ labels, plate }: Overlay, style: Style, fontCss: string): string[] {
  const out: string[] = [];
  const family = `font-family="${escaped(FONT_STACK)}"`;
  for (const [kind, id] of GROUPS) {
    const ofKind = labels.filter((label) => label.kind === kind);
    if (ofKind.length === 0) continue;
    const { weight, style: slope } = faceOf(kind);
    out.push(`<g id="${id}" ${family} font-weight="${weight}"${slope === 'italic' ? ' font-style="italic"' : ''} ${paint('fill', labelColour(kind, style))}>`);
    for (const label of ofKind) {
      // A place for every character, the spaces too: a space has the place of the letter after it.
      const places: typeof label.glyphs = [];
      let g = 0;
      for (const ch of label.text) places.push(label.glyphs[ch === ' ' ? g : g++] ?? label.glyphs.at(-1)!);
      const list = (of: (glyph: (typeof places)[number]) => number) => places.map((glyph) => n(of(glyph))).join(' ');
      out.push(`<text font-size="${n(label.size)}" x="${list((p) => p.x)}" y="${list((p) => p.y)}" rotate="${list((p) => (p.angle * 180) / Math.PI)}">${escaped(label.text)}</text>`);
    }
    out.push('</g>');
  }
  if (plate.frame || plate.box) {
    out.push(`<g id="plate" ${family} text-anchor="middle" stroke-linejoin="miter" stroke-linecap="butt">`);
    const rect = (r: { x: number; y: number; width: number; height: number }) => `x="${n(r.x)}" y="${n(r.y)}" width="${n(r.width)}" height="${n(r.height)}"`;
    if (plate.frame) out.push(`<rect ${rect(plate.frame)} fill="none" ${paint('stroke', style.ink)} stroke-width="${n(plate.frameWidth)}"/>`);
    if (plate.box) {
      const { lines, rule } = plate.box;
      out.push(`<rect ${rect(plate.box)} ${paint('fill', style.background)} ${paint('stroke', style.ink)} stroke-width="${n(plate.hairline)}"/>`);
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
