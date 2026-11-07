import type { Scene, SceneIndicatrix, ScenePiece } from '../morph/scene';
import { INDICATRIX_RADIUS } from '../tissot/indicatrix';

/** Colours, and line widths in CSS pixels. */
export type Style = {
  background: string;
  ocean: string;
  land: string;
  graticule: string;
  coast: string;
  accent: string;
  accentFill: string;
  seamWidth: number;
  graticuleWidth: number;
  coastWidth: number;
  drawingWidth: number;
  indicatrixWidth: number;
};

/** A quiet base map, so that drawings and indicatrices stand out in the accent. */
export const MAP_STYLE: Style = {
  background: '#eceae4',
  ocean: '#d3dfe5',
  land: '#f7f5ef',
  graticule: 'rgba(62, 84, 98, 0.16)',
  coast: '#97a3a9',
  accent: '#d9472b',
  accentFill: 'rgba(217, 71, 43, 0.16)',
  // Fills of neighbouring pieces meet at a seam; a stroke this wide in their own colour hides the hairline between them.
  seamWidth: 0.5,
  graticuleWidth: 0.75,
  coastWidth: 0.6,
  drawingWidth: 2,
  indicatrixWidth: 1.25,
};

const alphaOf = (a: { alphaSrc: number; alphaDst: number }, t: number) => (1 - t) * a.alphaSrc + t * a.alphaDst;

/** Adds a piece's rings, at the blend of its two ends, to the current path. */
function trace(ctx: CanvasRenderingContext2D, piece: ScenePiece, t: number): void {
  const { src, dst, ringStarts, closed } = piece;
  const count = src.length / 2;
  const blended = src !== dst && t !== 0;
  for (let r = 0; r < ringStarts.length; r++) {
    const end = r + 1 < ringStarts.length ? ringStarts[r + 1]! : count;
    for (let i = ringStarts[r]!; i < end; i++) {
      let x = src[2 * i]!;
      let y = src[2 * i + 1]!;
      if (blended) {
        x += t * (dst[2 * i]! - x);
        y += t * (dst[2 * i + 1]! - y);
      }
      if (i === ringStarts[r]) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    if (closed) ctx.closePath();
  }
}

/**
 * Fills each piece on its own, so that pieces cannot cancel each other out under the
 * non-zero rule where they overlap mid-morph. `outline`, if given, is a stroke in the same colour.
 */
function fillPieces(ctx: CanvasRenderingContext2D, pieces: ScenePiece[], behind: boolean, t: number, colour: string, outline: number | null): void {
  ctx.fillStyle = colour;
  ctx.strokeStyle = colour;
  if (outline !== null) ctx.lineWidth = outline;
  for (const piece of pieces) {
    if (piece.behind !== behind || !piece.closed) continue;
    const alpha = alphaOf(piece, t);
    if (alpha <= 0) continue;
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.beginPath();
    trace(ctx, piece, t);
    ctx.fill();
    if (outline !== null) ctx.stroke();
  }
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

/**
 * Each ellipse is the unit circle under its blended matrix times the shared radius, put
 * on screen through the context's own transform. The outline is stroked with that transform
 * back, so its width is not stretched with the ellipse.
 */
function drawIndicatrices(ctx: CanvasRenderingContext2D, indicatrices: SceneIndicatrix[], behind: boolean, t: number, style: Style, base: DOMMatrix): void {
  ctx.fillStyle = style.accentFill;
  ctx.strokeStyle = style.accent;
  ctx.lineWidth = style.indicatrixWidth;
  const r = INDICATRIX_RADIUS;
  for (const m of indicatrices) {
    if (m.behind !== behind) continue;
    const alpha = alphaOf(m, t);
    if (alpha <= 0) continue;
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
    ctx.moveTo(1, 0);
    ctx.arc(0, 0, 1, 0, 2 * Math.PI);
    ctx.setTransform(base);
    ctx.fill();
    ctx.stroke();
  }
}

function drawGroup(ctx: CanvasRenderingContext2D, scene: Scene, behind: boolean, t: number, style: Style, base: DOMMatrix): void {
  const layer = (name: string) => scene.layers[name] ?? [];
  fillPieces(ctx, layer('ocean'), behind, t, style.ocean, style.seamWidth);
  fillPieces(ctx, layer('land'), behind, t, style.land, style.seamWidth);
  strokePieces(ctx, layer('graticule'), behind, t, style.graticule, style.graticuleWidth);
  strokePieces(ctx, layer('coast'), behind, t, style.coast, style.coastWidth);
  // A drawn polygon's own outline comes in its line pieces, so its fill is not outlined along a seam.
  fillPieces(ctx, layer('drawings'), behind, t, style.accentFill, null);
  strokePieces(ctx, layer('drawings'), behind, t, style.accent, style.drawingWidth);
  drawIndicatrices(ctx, scene.indicatrices, behind, t, style, base);
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
  drawGroup(ctx, scene, true, t, style, base);
  drawGroup(ctx, scene, false, t, style, base);
  ctx.globalAlpha = 1;
}
