import type { Scene, SceneIndicatrix, ScenePiece } from '../morph/scene';
import type { Cut } from '../tissot/rest';
import { INDICATRIX_RADIUS } from '../tissot/indicatrix';
import type { Style } from './style';

/** How far a weight `w` of the maps that cannot show something hides it: slow to start, so what arrives or leaves is faint for long. */
const hiding = (w: number) => 1 - (1 - w) ** 3;

/**
 * How visible a piece or indicatrix is at morph progress `t`. What every map shows keeps its alpha. Whatever
 * some map cannot show is hidden by that map's weight, which is (1 - t) times its weight at the start for a
 * source and t for the target, through `hiding`: it arrives as t^3 and leaves as (1 - t)^3, so while it is
 * folded onto an edge, at the start or the end, it is faint. A weight of zero hides nothing and each map hides on its
 * own, so a morph redirected under way starts at the alpha it had, whatever the redirect.
 *
 * A map can also show something only in part, as an indicatrix near the edge of its coverage: then `fade` says how much
 * of each weight in `hidden` hides it, and the target hides by `1 - alphaDst`. The ends are still what the maps show at rest.
 */
export function alphaOf(a: { alphaSrc: number; alphaDst: number; hidden?: readonly number[]; fade?: readonly number[] }, t: number): number {
  if (!a.fade && a.alphaSrc === a.alphaDst) return a.alphaSrc;
  let alpha = 1 - (1 - a.alphaDst) * hiding(t);
  const hidden = a.hidden ?? [1 - a.alphaSrc];
  for (let k = 0; k < hidden.length; k++) alpha -= (a.fade?.[k] ?? 1) * hiding((1 - t) * hidden[k]!);
  return Math.max(0, Math.min(1, alpha));
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
 * Fills each piece on its own, so that pieces cannot cancel each other out under the
 * non-zero rule where they overlap mid-morph. `outline`, if given, is a stroke in the same colour.
 */
function fillPieces(ctx: CanvasRenderingContext2D, pieces: ScenePiece[], behind: boolean, t: number, colour: string, outline: number | null, skipOut = false): void {
  ctx.fillStyle = colour;
  ctx.strokeStyle = colour;
  if (outline !== null) ctx.lineWidth = outline;
  for (const piece of pieces) {
    if (piece.behind !== behind || !piece.closed || (skipOut && piece.out)) continue;
    const alpha = alphaOf(piece, t);
    if (alpha <= 0) continue;
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.beginPath();
    trace(ctx, piece, t);
    ctx.fill();
    if (outline !== null) ctx.stroke();
  }
}

/**
 * Fills cells that may be folded over, as one path for each run of cells at the same alpha. A cell
 * that comes out wound the other way on screen is traced backwards, so every cell winds the same
 * way: where folded cells overlap their windings add up instead of cancelling, and there is no
 * hairline between neighbours, as they are filled together.
 */
function fillCells(ctx: CanvasRenderingContext2D, cells: ScenePiece[], behind: boolean, t: number, colour: string): void {
  ctx.fillStyle = colour;
  let current = -1;
  for (const cell of cells) {
    if (cell.behind !== behind || !cell.closed) continue;
    const alpha = Math.min(1, alphaOf(cell, t));
    if (alpha <= 0) continue;
    if (alpha !== current) {
      if (current > 0) ctx.fill();
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      current = alpha;
    }
    trace(ctx, cell, t, signedArea(cell, t) < 0);
  }
  if (current > 0) ctx.fill();
}

/** Strokes the lines among `pieces`, one path for each run of pieces at the same alpha. */
function strokePieces(ctx: CanvasRenderingContext2D, pieces: ScenePiece[], behind: boolean, t: number, colour: string, width: number): void {
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  let current = -1;
  for (const piece of pieces) {
    if (piece.behind !== behind || piece.closed) continue;
    const alpha = Math.min(1, alphaOf(piece, t));
    if (alpha <= 0) continue;
    if (alpha !== current) {
      if (current > 0) ctx.stroke();
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      current = alpha;
    }
    trace(ctx, piece, t);
  }
  if (current > 0) ctx.stroke();
}

/** The part of an indicatrix drawn at `t`, as a `Cut` between its ends, or null where it is whole. */
function cutAt(m: SceneIndicatrix, t: number): Cut | null {
  if (!m.cut) return null;
  const { src, dst } = m.cut;
  // An end where it is whole is a cut at the edge of the disc, in the other end's direction.
  const a: Cut = src ?? [dst![0], dst![1], 1];
  const b: Cut = dst ?? [a[0], a[1], 1];
  const [x, y] = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
  const length = Math.hypot(x, y);
  const c = a[2] + t * (b[2] - a[2]);
  return length > 0 && c < 1 ? [x / length, y / length, c] : null;
}

/**
 * Each ellipse is the unit circle under its blended matrix times the shared radius, put
 * on screen through the context's own transform. The outline is stroked with that transform
 * back, so its width is not stretched with the ellipse. One cut at a lobe's edge is the part of the disc on
 * its side of the chord, filled to the chord, and its outline is the arc alone, as where the map's outline cuts it.
 */
function drawIndicatrices(ctx: CanvasRenderingContext2D, indicatrices: SceneIndicatrix[], t: number, style: Style, base: DOMMatrix): void {
  ctx.fillStyle = style.accentFill;
  ctx.strokeStyle = style.accent;
  ctx.lineWidth = style.indicatrixWidth;
  const r = INDICATRIX_RADIUS;
  for (const m of indicatrices) {
    const alpha = alphaOf(m, t);
    if (alpha <= 0) continue;
    const cut = cutAt(m, t);
    if (cut && cut[2] <= -1) continue;
    const u = 1 - t;
    // Mat2 is [[east x, north x], [east y, north y]]; a canvas transform takes (a, b) as the image of x and (c, d) of y.
    const east = [r * (u * m.srcMat[0] + t * m.dstMat[0]), r * (u * m.srcMat[2] + t * m.dstMat[2])] as const;
    const north = [r * (u * m.srcMat[1] + t * m.dstMat[1]), r * (u * m.srcMat[3] + t * m.dstMat[3])] as const;
    const x = u * m.srcPos[0] + t * m.dstPos[0];
    const y = u * m.srcPos[1] + t * m.dstPos[1];
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.beginPath();
    ctx.setTransform(
      base.a * east[0] + base.c * east[1],
      base.b * east[0] + base.d * east[1],
      base.a * north[0] + base.c * north[1],
      base.b * north[0] + base.d * north[1],
      base.a * x + base.c * y + base.e,
      base.b * x + base.d * y + base.f,
    );
    if (cut) {
      // The arc of the disc where m . x <= c: away from m, from the chord's one end to its other.
      const [towards, half] = [Math.atan2(cut[1], cut[0]), Math.acos(cut[2])];
      ctx.moveTo(Math.cos(towards + half), Math.sin(towards + half));
      ctx.arc(0, 0, 1, towards + half, towards + 2 * Math.PI - half);
    } else {
      ctx.moveTo(1, 0);
      ctx.arc(0, 0, 1, 0, 2 * Math.PI);
    }
    ctx.setTransform(base);
    ctx.fill();
    ctx.stroke();
  }
}

const shownBy = (piece: ScenePiece, member: number) => (((piece.shownBy ?? 1) >> member) & 1) === 1;

/** The pieces of the outline at `t`: ocean that is filled as pieces, and the cells that stand in for the rest. */
function* outlinePieces(scene: Scene, t: number): Generator<ScenePiece> {
  const cells = scene.layers.capOcean;
  for (const piece of scene.layers.ocean ?? []) {
    if (piece.closed && !(cells !== undefined && piece.out) && alphaOf(piece, t) > 0) yield piece;
  }
  for (const cell of cells ?? []) if (cell.closed && alphaOf(cell, t) > 0) yield cell;
}

/** The clip for what `member` shows, or undefined where that is the whole outline, so that the two are one clip. */
function clipKey(scene: Scene, t: number, member: number | undefined): number | undefined {
  if (member === undefined) return undefined;
  for (const piece of outlinePieces(scene, t)) if (!shownBy(piece, member)) return member;
  return undefined;
}

/** What a frame works out once and uses in both groups: for each clip, its path where the canvas has paths to keep. */
type Frame = { t: number; outlines: Map<number | undefined, Path2D> };

/**
 * Clips to the outline of the map: the ocean the frame fills, wherever it is not faded out, in front and behind, so that an
 * indicatrix across a globe's limb is cut at the same place at the end of a morph as at rest. A piece of ocean that cells
 * stand in for is left out and the cells are in, wound the same way, as for filling them, so folded cells do not cancel one another.
 * With `member`, only what that member shows (its index among the sources and then the target). The outline is the same for both
 * groups, so where the canvas can keep a path it is traced once a frame.
 */
function clipToOutline(ctx: CanvasRenderingContext2D, scene: Scene, frame: Frame, member: number | undefined): void {
  const kept = frame.outlines.get(member);
  if (kept) return ctx.clip(kept);
  const path: CanvasPath = typeof Path2D === 'function' ? new Path2D() : ctx;
  ctx.beginPath();
  for (const piece of outlinePieces(scene, frame.t)) {
    if (member === undefined || shownBy(piece, member)) trace(path, piece, frame.t, signedArea(piece, frame.t) < 0);
  }
  if (path === ctx) return ctx.clip();
  frame.outlines.set(member, path as Path2D);
  ctx.clip(path as Path2D);
}

function drawGroup(ctx: CanvasRenderingContext2D, scene: Scene, behind: boolean, frame: Frame, style: Style, base: DOMMatrix): void {
  const { t } = frame;
  const layer = (name: string) => scene.layers[name] ?? [];
  // What a map cannot show folds over in a morph, so where its ocean comes as cells it is filled from those.
  const cells = scene.layers.capOcean;
  if (cells) fillCells(ctx, cells, behind, t, style.ocean);
  fillPieces(ctx, layer('ocean'), behind, t, style.ocean, style.seamWidth, cells !== undefined);
  fillPieces(ctx, layer('land'), behind, t, style.land, style.seamWidth);
  strokePieces(ctx, layer('graticule'), behind, t, style.graticule, style.graticuleWidth);
  strokePieces(ctx, layer('coast'), behind, t, style.coast, style.coastWidth);
  // A drawn polygon's own outline comes in its line pieces, so its fill is not outlined along a seam.
  fillPieces(ctx, layer('drawings'), behind, t, style.accentFill, null);
  strokePieces(ctx, layer('drawings'), behind, t, style.accent, style.drawingWidth);
  // An ellipse is cut by the map's edge like the coast: the part past the outline is not drawn, at rest or in a morph.
  // A copy that one map shows is cut to what that map shows.
  const shown = scene.indicatrices.filter((m) => m.behind === behind && alphaOf(m, t) > 0);
  const keys = new Map<number | undefined, number | undefined>();
  const keyOf = (m: SceneIndicatrix) => {
    if (!keys.has(m.clip)) keys.set(m.clip, clipKey(scene, t, m.clip));
    return keys.get(m.clip);
  };
  for (const clip of new Set(shown.map(keyOf))) {
    ctx.save();
    clipToOutline(ctx, scene, frame, clip);
    drawIndicatrices(ctx, shown.filter((m) => keyOf(m) === clip), t, style, base);
    ctx.restore();
  }
}

/**
 * Paints a scene at morph progress `t` over the whole canvas. The context's transform maps
 * CSS pixels to the canvas, and is left as it was found. The far side of a globe is painted
 * first, so the near side covers it until the peel opens.
 */
export function drawScene(ctx: CanvasRenderingContext2D, scene: Scene, t: number, style: Style): void {
  const base = ctx.getTransform();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = style.background;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.setTransform(base);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const frame: Frame = { t, outlines: new Map() };
  drawGroup(ctx, scene, true, frame, style, base);
  drawGroup(ctx, scene, false, frame, style, base);
  ctx.globalAlpha = 1;
}
