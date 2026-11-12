import type { Sea } from '../data/water';
import { buildDegrees } from '../labels/degrees';
import { faceOf, fontOf } from '../labels/font';
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
 * Everything over a map at rest. `seas` is null until they have been fetched, and `land` is what counts as land under a sea's name.
 * A name the title box would lie over is left out.
 */
export function buildOverlay(input: OverlayInput, measure: OverlayMeasure, seas: Sea[] | null, land: GeoJSON.GeoJsonObject): Overlay {
  const { member, layers, picture, scale } = input;
  const { on } = layers;
  const { plate } = buildPlateOnly(input, measure);
  const { box } = plate;
  const clear = (label: Label) => !box || !label.discs.some(([x, y, r]) => x + r > box.x && x - r < box.x + box.width && y + r > box.y && y - r < box.y + box.height);
  const names = on.countryNames || on.seaNames ? buildNames(member, picture, { countries: on.countryNames, seas: on.seaNames, smallest: layers.smallestName, scale }, measure.label, seas, land).filter(clear) : [];
  const degrees = lettersDegrees(on) ? buildDegrees(member, picture, layers.graticuleStep, scale, measure.label, names).filter(clear) : [];
  return { labels: [...names, ...degrees], plate };
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
