import { DRAW_ORDER } from '../layers/layers';
import type { Scene, SceneIndicatrix, ScenePiece } from '../morph/scene';
import type { Style } from '../render/style';
import type { Viewport } from '../screen/screen';
import { INDICATRIX_RADIUS } from '../tissot/indicatrix';

/** A number as it is written: to two decimals, which is a hundredth of a pixel, with no zeros it does not need. */
export const n = (v: number): string => {
  const text = v.toFixed(2);
  const short = text.includes('.') ? text.replace(/\.?0+$/, '') : text;
  return short === '-0' ? '0' : short;
};

/** A colour as an attribute: one with an opacity of its own is written as the colour and the opacity, which every reader of SVG knows. */
export function paint(attribute: 'fill' | 'stroke', colour: string): string {
  const parts = colour.match(/^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/);
  return parts ? `${attribute}="rgb(${parts[1]},${parts[2]},${parts[3]})" ${attribute}-opacity="${n(Number(parts[4]))}"` : `${attribute}="${colour}"`;
}

const isOpaque = (colour: string) => !colour.startsWith('rgba(');

/** The rings or lines of a piece as path data, each ring backwards if `reverse`. */
function pathOf(piece: ScenePiece, reverse = false): string {
  const { src, ringStarts, closed } = piece;
  let d = '';
  for (let r = 0; r < ringStarts.length; r++) {
    const [start, end] = [ringStarts[r]!, r + 1 < ringStarts.length ? ringStarts[r + 1]! : src.length / 2];
    for (let k = start; k < end; k++) {
      const i = reverse ? start + end - 1 - k : k;
      d += `${k === start ? 'M' : 'L'}${n(src[2 * i]!)} ${n(src[2 * i + 1]!)}`;
    }
    if (closed) d += 'Z';
  }
  return d;
}

/** A piece's signed area on screen. */
function signedArea({ src, ringStarts }: ScenePiece): number {
  let total = 0;
  for (let r = 0; r < ringStarts.length; r++) {
    const [start, end] = [ringStarts[r]!, r + 1 < ringStarts.length ? ringStarts[r + 1]! : src.length / 2];
    for (let i = start; i < end; i++) {
      const j = i + 1 < end ? i + 1 : start;
      total += src[2 * i]! * src[2 * j + 1]! - src[2 * j]! * src[2 * i + 1]!;
    }
  }
  return total / 2;
}

/** Whether the map at rest shows a piece. On the canvas a line that no source shows has no width at the start of a morph, which is where rest is. */
const shown = (piece: ScenePiece) => piece.alphaSrc > 0;

// How many sides the polygon has that stands for the disc of an indicatrix that is cut.
const SIDES = 72;

/** The part of the unit disc within every cut, as a polygon. */
function cutDisc(cuts: SceneIndicatrix['cuts']): [number, number][] {
  let ring: [number, number][] = Array.from({ length: SIDES }, (_, i) => [Math.cos((2 * Math.PI * i) / SIDES), Math.sin((2 * Math.PI * i) / SIDES)]);
  for (const [mx, my, c] of cuts) {
    // What is left of the polygon where m . x <= c, corner by corner, with a new corner wherever an edge crosses the cut.
    const kept: [number, number][] = [];
    ring.forEach((a, i) => {
      const b = ring[(i + 1) % ring.length]!;
      const [da, db] = [mx * a[0] + my * a[1] - c, mx * b[0] + my * b[1] - c];
      if (da <= 0) kept.push(a);
      if (da <= 0 !== db <= 0) kept.push([a[0] + ((b[0] - a[0]) * da) / (da - db), a[1] + ((b[1] - a[1]) * da) / (da - db)]);
    });
    ring = kept;
  }
  return ring;
}

/** The indicatrices of a map at rest: a circle under its matrix each, or where a seam cuts one, what is left of it as a path. */
function indicatrices(scene: Scene): string[] {
  const r = scene.indicatrixRadius ?? INDICATRIX_RADIUS;
  const out: string[] = [];
  // The far side first, as on the canvas, though at rest nothing is there.
  for (const m of [...scene.indicatrices].sort((a, b) => Number(b.behind) - Number(a.behind))) {
    const alpha = Math.min(1, m.alphaSrc);
    if (alpha <= 0 || m.cuts.some((cut) => cut[2] <= -1)) continue;
    // Mat2 is [[east x, north x], [east y, north y]]; an SVG matrix takes (a, b) as the image of x and (c, d) of y.
    const [a, b, c, d] = [r * m.srcMat[0], r * m.srcMat[2], r * m.srcMat[1], r * m.srcMat[3]];
    const [x, y] = m.srcPos;
    const opacity = alpha < 1 ? ` opacity="${n(alpha)}"` : '';
    if (m.cuts.length === 0) {
      out.push(`<circle r="1" transform="matrix(${[a, b, c, d, x, y].map(n).join(' ')})"${opacity}/>`);
      continue;
    }
    const ring = cutDisc(m.cuts);
    if (ring.length < 3) continue;
    out.push(`<path d="${ring.map(([u, v], i) => `${i === 0 ? 'M' : 'L'}${n(a * u + c * v + x)} ${n(b * u + d * v + y)}`).join('')}Z"${opacity}/>`);
  }
  return out;
}

/**
 * A scene at rest as a standalone SVG document, in the window's own pixels: a group for each layer that has anything in it, in the
 * order the canvas paints them (`DRAW_ORDER`), and the indicatrices last, cut by the map's outline. Coordinates are to two decimals.
 * `background` null leaves the page clear. Every line is `lineScale` times as wide as on screen, and its dashes as long.
 *
 * It follows `drawScene` at the start of a morph, which is rest: fills of a solid colour are one path to a layer, with a hairline
 * round it in its own colour where the canvas has one, to hide the seams; fills that are see-through are a path each, so that two
 * that overlap are both seen, as on the canvas.
 *
 * `over` is what goes on top of it all, already written: the names, the degrees, the frame and the title box. See `overlayToSvg`.
 */
export function sceneToSvg(scene: Scene, style: Style, size: Viewport, opts: { background: string | null; lineScale: number }, over: string[] = []): string {
  const { width, height } = size;
  const k = opts.lineScale;
  const out: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" width="${n(width)}" height="${n(height)}" viewBox="0 0 ${n(width)} ${n(height)}" stroke-linejoin="round" stroke-linecap="round">`];
  if (opts.background !== null) out.push(`<rect width="${n(width)}" height="${n(height)}" ${paint('fill', opts.background)}/>`);

  // The far side of a globe is painted first on the canvas. At rest it is not shown, and what is shown of it would come first here too.
  const piecesOf = (layer: string) => (scene.layers[layer] ?? []).filter(shown).sort((a, b) => Number(b.behind) - Number(a.behind));

  for (const { layer, fill, seam, stroke, width: lineWidth, dash, taper } of DRAW_ORDER) {
    // A line on its way in has no width yet.
    if (taper === 'in') continue;
    const pieces = piecesOf(layer);
    const [fills, lines] = [fill ? pieces.filter((p) => p.closed) : [], stroke && lineWidth ? pieces.filter((p) => !p.closed) : []];
    if (fills.length === 0 && lines.length === 0) continue;
    out.push(`<g id="${layer}">`);
    if (fill && fills.length > 0) {
      const colour = fill(style);
      const hairline = seam ? ` ${paint('stroke', colour)} stroke-width="${n(style.seamWidth * k)}"` : '';
      const attributes = `fill-rule="nonzero" ${paint('fill', colour)}${hairline}`;
      if (isOpaque(colour)) out.push(`<path ${attributes} d="${fills.map((p) => pathOf(p)).join('')}"/>`);
      else for (const p of fills) out.push(`<path ${attributes} d="${pathOf(p)}"/>`);
    }
    if (stroke && lineWidth && lines.length > 0) {
      const dashes = dash ? ` stroke-dasharray="${dash.map((v) => n(v * k)).join(' ')}"` : '';
      out.push(`<path fill="none" ${paint('stroke', stroke(style))} stroke-width="${n(lineWidth(style) * k)}"${dashes} d="${lines.map((p) => pathOf(p)).join('')}"/>`);
    }
    out.push('</g>');
  }

  const ellipses = indicatrices(scene);
  if (ellipses.length > 0) {
    // An ellipse is cut by the map's edge like the coast. The pieces of the sea are wound the same way, so that none cancels another.
    const outline = piecesOf('ocean').filter((p) => p.closed);
    out.push(`<clipPath id="outline"><path d="${outline.map((p) => pathOf(p, signedArea(p) < 0)).join('')}"/></clipPath>`);
    out.push(`<g id="tissot" clip-path="url(#outline)" ${paint('fill', style.indicatrix)}>`, ...ellipses, '</g>');
  }
  out.push(...over, '</svg>');
  return out.join('\n');
}
