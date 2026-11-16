import { DRAW_ORDER } from '../layers/layers';
import type { Scene, SceneIndicatrix, ScenePiece } from '../morph/scene';
import type { Cut } from '../tissot/rest';
import { INDICATRIX_RADIUS } from '../tissot/indicatrix';
import type { Style } from './style';

/** Whether any map of the morph shows a piece. One that some map shows is drawn at full strength throughout: what a map cannot show is folded onto its edge, where it has no area, so nothing needs to fade. */
const shows = (piece: ScenePiece): boolean => piece.alphaSrc > 0 || piece.alphaDst > 0;

// The share of a morph, at the end where a line is folded onto a map's edge, over which it thins away to nothing.
const FOLD = 0.05;

/**
 * How wide a line is stroked at `t`, of its full `width`. A line that the target cannot show ends the morph folded onto the target's
 * edge, and one that no source shows begins it so: drawn there it would trace the edge for the frames next to rest, and vanish when the
 * map settles. So over the last twentieth of the way it thins to nothing. A fill needs none of this, as folded it has no area.
 */
function widthAt(piece: ScenePiece, t: number, width: number): number {
  if (piece.alphaDst === 0) width *= Math.min(1, (1 - t) / FOLD);
  if (piece.alphaSrc === 0) width *= Math.min(1, t / FOLD);
  return width;
}

const ringEnd = (piece: ScenePiece, r: number) => (r + 1 < piece.ringStarts.length ? piece.ringStarts[r + 1]! : piece.src.length / 2);

/** Adds a piece's rings, at the blend of its two ends, to the current path, each ring backwards if `reverse`. */
function trace(ctx: CanvasPath, piece: ScenePiece, t: number, reverse = false): void {
  const { src, dst, ringStarts, closed } = piece;
  const blended = src !== dst && t !== 0;
  for (let r = 0; r < ringStarts.length; r++) {
    const [start, end] = [ringStarts[r]!, ringEnd(piece, r)];
    for (let k = start; k < end; k++) {
      const i = reverse ? start + end - 1 - k : k;
      let x = src[2 * i]!;
      let y = src[2 * i + 1]!;
      if (blended) {
        x += t * (dst[2 * i]! - x);
        y += t * (dst[2 * i + 1]! - y);
      }
      if (k === start) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    if (closed) ctx.closePath();
  }
}

/** A piece's signed area on screen at the blend of its two ends. */
function signedArea(piece: ScenePiece, t: number): number {
  const { src, dst, ringStarts } = piece;
  let total = 0;
  for (let r = 0; r < ringStarts.length; r++) {
    const [start, end] = [ringStarts[r]!, ringEnd(piece, r)];
    for (let i = start; i < end; i++) {
      const j = i + 1 < end ? i + 1 : start;
      const [ax, ay] = [src[2 * i]! + t * (dst[2 * i]! - src[2 * i]!), src[2 * i + 1]! + t * (dst[2 * i + 1]! - src[2 * i + 1]!)];
      const [bx, by] = [src[2 * j]! + t * (dst[2 * j]! - src[2 * j]!), src[2 * j + 1]! + t * (dst[2 * j + 1]! - src[2 * j + 1]!)];
      total += ax * by - bx * ay;
    }
  }
  return total / 2;
}

/**
 * Fills each piece on its own, so that two that overlap are both seen: for a fill that is see-through, as a drawn shape's is.
 */
function fillPieces(ctx: CanvasRenderingContext2D, pieces: ScenePiece[], behind: boolean, t: number, colour: string): void {
  ctx.fillStyle = colour;
  ctx.globalAlpha = 1;
  for (const piece of pieces) {
    if (piece.behind !== behind || !piece.closed || !shows(piece)) continue;
    ctx.beginPath();
    trace(ctx, piece, t);
    ctx.fill();
  }
}

/** Whether a piece is the same at both ends: it is of a map at rest, and not of a morph. */
const still = (piece: ScenePiece): boolean => piece.src === piece.dst;

/**
 * Fills pieces that lie edge to edge as one path, with no outline. Pieces that meet, as where a seam cuts a continent in two, are
 * then one shape with no hairline between them, and the shape is exactly its outline: nothing is added round it, so a lake or an
 * island is no larger than it is, however closely it is looked at.
 *
 * In a morph pieces fold over one another, and under the non-zero rule two that are wound opposite ways would cancel where they
 * overlap. So a piece that comes out wound the other way on screen is traced backwards, as a folded cell is: every piece winds the
 * same way and their windings add up. A map at rest has no folds, and its pieces are traced as they are.
 */
function fillWhole(ctx: CanvasRenderingContext2D, pieces: ScenePiece[], behind: boolean, t: number, colour: string, skipOut = false): void {
  ctx.fillStyle = colour;
  ctx.globalAlpha = 1;
  let any = false;
  for (const piece of pieces) {
    if (piece.behind !== behind || !piece.closed || (skipOut && piece.out) || !shows(piece)) continue;
    if (!any) ctx.beginPath();
    any = true;
    trace(ctx, piece, t, !still(piece) && signedArea(piece, t) < 0);
  }
  if (any) ctx.fill();
}

/**
 * Clips to the closed pieces of a layer, wound as `fillWhole` winds them, and says whether there were any: if so the context was
 * saved first, and is to be restored.
 */
function clipWithin(ctx: CanvasRenderingContext2D, pieces: ScenePiece[], behind: boolean, t: number): boolean {
  let any = false;
  for (const piece of pieces) {
    if (piece.behind !== behind || !piece.closed || !shows(piece)) continue;
    if (!any) {
      ctx.save();
      ctx.beginPath();
    }
    any = true;
    trace(ctx, piece, t, !still(piece) && signedArea(piece, t) < 0);
  }
  if (any) ctx.clip();
  return any;
}

/**
 * Fills cells that may be folded over, as one path. A cell
 * that comes out wound the other way on screen is traced backwards, so every cell winds the same
 * way: where folded cells overlap their windings add up instead of cancelling, and there is no
 * hairline between neighbours, as they are filled together.
 */
function fillCells(ctx: CanvasRenderingContext2D, cells: ScenePiece[], behind: boolean, t: number, colour: string): void {
  ctx.fillStyle = colour;
  ctx.globalAlpha = 1;
  let any = false;
  for (const cell of cells) {
    if (cell.behind !== behind || !cell.closed || !shows(cell)) continue;
    if (!any) ctx.beginPath();
    any = true;
    trace(ctx, cell, t, signedArea(cell, t) < 0);
  }
  if (any) ctx.fill();
}

/**
 * Strokes the lines among `pieces`, one path for each run of pieces of the same width. `share` is the share of its width a line has
 * for the morph's sake, where it belongs to one end of it.
 */
function strokePieces(ctx: CanvasRenderingContext2D, pieces: ScenePiece[], behind: boolean, t: number, colour: string, width: number, share = 1): void {
  ctx.strokeStyle = colour;
  ctx.globalAlpha = 1;
  let current = -1;
  for (const piece of pieces) {
    if (piece.behind !== behind || piece.closed || !shows(piece)) continue;
    const w = widthAt(piece, t, width) * share;
    if (w <= 0) continue;
    if (w !== current) {
      if (current > 0) ctx.stroke();
      ctx.lineWidth = w;
      ctx.beginPath();
      current = w;
    }
    trace(ctx, piece, t);
  }
  if (current > 0) ctx.stroke();
}

// Half the side of the square that stands for a half-plane, in radii of the disc it cuts: anything well over one.
const FAR = 4;

/** Adds the half-plane m . x <= c, as far as a unit disc can reach, to the current path. */
function traceHalfPlane(ctx: CanvasPath, [mx, my, c]: Cut): void {
  const corners = [[c, FAR], [c, -FAR], [c - 2 * FAR, -FAR], [c - 2 * FAR, FAR]] as const;
  // Along m and across it.
  corners.forEach(([along, across], i) => {
    const [x, y] = [along * mx - across * my, along * my + across * mx];
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
}

/**
 * Each indicatrix is the unit circle under its blended matrix times the shared radius, put on screen through the context's own
 * transform, and filled: a translucent ellipse with no outline. One with cuts is the part of the disc within every one of them: with
 * one cut, the disc on its side of the chord; with more, the disc clipped by each in turn. Its strength goes evenly between its ends.
 */
function drawIndicatrices(ctx: CanvasRenderingContext2D, indicatrices: SceneIndicatrix[], r: number, t: number, style: Style, base: DOMMatrix): void {
  ctx.fillStyle = style.indicatrix;
  for (const m of indicatrices) {
    const alpha = indicatrixAlpha(m, t);
    if (alpha <= 0 || m.cuts.some((cut) => cut[2] <= -1)) continue;
    const u = 1 - t;
    // Mat2 is [[east x, north x], [east y, north y]]; a canvas transform takes (a, b) as the image of x and (c, d) of y.
    const east = [r * (u * m.srcMat[0] + t * m.dstMat[0]), r * (u * m.srcMat[2] + t * m.dstMat[2])] as const;
    const north = [r * (u * m.srcMat[1] + t * m.dstMat[1]), r * (u * m.srcMat[3] + t * m.dstMat[3])] as const;
    const x = u * m.srcPos[0] + t * m.dstPos[0];
    const y = u * m.srcPos[1] + t * m.dstPos[1];
    const onDisc = () =>
      ctx.setTransform(
        base.a * east[0] + base.c * east[1],
        base.b * east[0] + base.d * east[1],
        base.a * north[0] + base.c * north[1],
        base.b * north[0] + base.d * north[1],
        base.a * x + base.c * y + base.e,
        base.b * x + base.d * y + base.f,
      );
    ctx.globalAlpha = Math.min(1, alpha);
    const several = m.cuts.length > 1;
    if (several) {
      ctx.save();
      for (const cut of m.cuts) {
        onDisc();
        ctx.beginPath();
        traceHalfPlane(ctx, cut);
        ctx.clip();
      }
    }
    onDisc();
    ctx.beginPath();
    const [cut] = m.cuts;
    if (cut && !several) {
      // The arc of the disc where m . x <= c: away from m, from the chord's one end to its other. Filling closes it along the chord.
      const [towards, half] = [Math.atan2(cut[1], cut[0]), Math.acos(Math.max(-1, Math.min(1, cut[2])))];
      ctx.moveTo(Math.cos(towards + half), Math.sin(towards + half));
      ctx.arc(0, 0, 1, towards + half, towards + 2 * Math.PI - half);
    } else {
      ctx.moveTo(1, 0);
      ctx.arc(0, 0, 1, 0, 2 * Math.PI);
    }
    ctx.setTransform(base);
    ctx.fill();
    if (several) {
      ctx.restore();
      ctx.fillStyle = style.indicatrix;
    }
  }
}

/** How strong an indicatrix is at `t`: evenly from what the maps at one end show of it to what the map at the other does. */
const indicatrixAlpha = (m: SceneIndicatrix, t: number): number => m.alphaSrc + t * (m.alphaDst - m.alphaSrc);

/** The pieces of the outline: ocean that is filled as pieces, and the cells that stand in for the rest. */
function* outlinePieces(scene: Scene): Generator<ScenePiece> {
  const cells = scene.layers.capOcean;
  for (const piece of scene.layers.ocean ?? []) {
    if (piece.closed && !(cells !== undefined && piece.out) && shows(piece)) yield piece;
  }
  for (const cell of cells ?? []) if (cell.closed && shows(cell)) yield cell;
}

/**
 * Clips to the outline of the map: the ocean the frame fills, in front and behind, so that an indicatrix across a globe's limb is cut
 * at the same place at the end of a morph as at rest. A piece of ocean that cells stand in for is left out and the cells are in, wound
 * the same way, as for filling them, so folded cells do not cancel one another. The outline is the same for both groups, so where the
 * canvas can keep a path it is traced once a frame.
 */
function clipToOutline(ctx: CanvasRenderingContext2D, scene: Scene, frame: Frame): void {
  if (frame.outline) return ctx.clip(frame.outline);
  const path: CanvasPath = typeof Path2D === 'function' ? new Path2D() : ctx;
  ctx.beginPath();
  for (const piece of outlinePieces(scene)) trace(path, piece, frame.t, signedArea(piece, frame.t) < 0);
  if (path === ctx) return ctx.clip();
  frame.outline = path as Path2D;
  ctx.clip(frame.outline);
}

/** What a frame works out once and uses in both groups: the outline, where the canvas has paths to keep. Dashes are `dashScale` times as long as on screen. */
type Frame = { t: number; dashScale: number; quick: boolean; outline?: Path2D };

function drawGroup(ctx: CanvasRenderingContext2D, scene: Scene, behind: boolean, frame: Frame, style: Style, base: DOMMatrix): void {
  const { t } = frame;
  // What a map cannot show folds over in a morph, so where its ocean comes as cells it is filled from those.
  const cells = scene.layers.capOcean;
  if (cells) fillCells(ctx, cells, behind, t, style.ocean);
  // The layer that what is being painted is kept within, by a clip that is on until something is painted that is not.
  let inside: string | null = null;
  const leave = () => {
    if (inside !== null) ctx.restore();
    inside = null;
  };
  for (const { layer, from, fill, seam, rest, within, stroke, width, dash, taper } of DRAW_ORDER) {
    const pieces = from ? from.flatMap((name) => scene.layers[name] ?? []) : scene.layers[layer];
    if (!pieces || pieces.length === 0) continue;
    if ((within ?? null) !== inside) {
      leave();
      // With none of what it is kept within, there is none of it.
      if (within && !clipWithin(ctx, scene.layers[within] ?? [], behind, t)) continue;
      inside = within ?? null;
    }
    if (fill) {
      if (rest && (frame.quick || !pieces.every(still))) continue;
      // Pieces that lie edge to edge are one shape, and filled as one.
      if (seam) fillWhole(ctx, pieces, behind, t, fill(style), layer === 'ocean' && cells !== undefined);
      else fillPieces(ctx, pieces, behind, t, fill(style));
    }
    if (stroke && width) {
      // A context without dashes, as a test's may be, draws the line whole.
      if (dash) ctx.setLineDash?.(frame.dashScale === 1 ? dash : dash.map((v) => v * frame.dashScale));
      strokePieces(ctx, pieces, behind, t, stroke(style), width(style), taper === 'out' ? 1 - t : taper === 'in' ? t : 1);
      if (dash) ctx.setLineDash?.([]);
    }
  }
  leave();
  // An ellipse is cut by the map's edge like the coast: the part past the outline is not drawn, at rest or in a morph.
  const shown = scene.indicatrices.filter((m) => m.behind === behind && indicatrixAlpha(m, t) > 0);
  if (shown.length > 0) {
    ctx.save();
    clipToOutline(ctx, scene, frame);
    drawIndicatrices(ctx, shown, scene.indicatrixRadius ?? INDICATRIX_RADIUS, t, style, base);
    ctx.restore();
  }
}

/** The widths of a style, each `by` times as wide. */
function widened(style: Style, by: number): Style {
  if (by === 1) return style;
  // Every width of the style, which are its numbers.
  return Object.fromEntries(Object.entries(style).map(([key, value]) => [key, typeof value === 'number' ? value * by : value])) as Style;
}

/**
 * Paints a scene at morph progress `t` over the whole canvas. The context's transform maps
 * CSS pixels to the canvas, and is left as it was found. The far side of a globe is painted
 * first, so the near side covers it until the peel opens.
 *
 * For a picture larger than the screen, `lineScale` is how many times as wide every line is, and its dashes as long, so that they
 * look as they do on screen. A `background` of null leaves the canvas clear behind the map, where the style's own is the default.
 * With `over`, the canvas is left as it is and the scene painted on what it has. With `quick`, what is only worth painting for a
 * map that is still is left out: the map is on its way somewhere, and the frame after this one will paint over it.
 */
export function drawScene(ctx: CanvasRenderingContext2D, scene: Scene, t: number, style: Style, { lineScale = 1, background, over = false, quick = false }: { lineScale?: number; background?: string | null; over?: boolean; quick?: boolean } = {}): void {
  const base = ctx.getTransform();
  ctx.globalAlpha = 1;
  if (!over) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (background === null) ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    else {
      ctx.fillStyle = background ?? style.background;
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    }
    ctx.setTransform(base);
  }
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const frame: Frame = { t, dashScale: lineScale, quick };
  const widths = widened(style, lineScale);
  drawGroup(ctx, scene, true, frame, widths, base);
  drawGroup(ctx, scene, false, frame, widths, base);
  ctx.globalAlpha = 1;
}
