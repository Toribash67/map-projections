import type { ScreenTransform, Viewport } from './screen';

/**
 * How the fitted map is looked at: enlarged `zoom` times about the middle of the viewport, then moved by the pan, in CSS pixels. It
 * sits on top of the fit, so everything that works from a `ScreenTransform` (drawing, finding the land under the pointer, dragging,
 * the indicatrices) works zoomed with no change of its own.
 */
export type View = { zoom: number; panX: number; panY: number };

export const FIT: View = { zoom: 1, panX: 0, panY: 0 };
export const MAX_ZOOM = 32;

type Pair = [number, number];

const clamp = (v: number, limit: number): number => Math.min(limit, Math.max(-limit, v));

/**
 * A view within its limits: zoom from the fit to `MAX_ZOOM`, and the pan no farther than keeps the zoomed frame, the viewport's own
 * rectangle enlarged with the map, over the whole window. So the map cannot be moved out of sight, and at the fit it does not move.
 */
export function clampView(view: View, v: Viewport): View {
  const zoom = Math.min(MAX_ZOOM, Math.max(1, view.zoom));
  if (zoom === 1) return FIT;
  // `+ 0` so that a pan of nothing is never minus nothing.
  return { zoom, panX: clamp(view.panX, ((zoom - 1) * v.width) / 2) + 0, panY: clamp(view.panY, ((zoom - 1) * v.height) / 2) + 0 };
}

/** The fit, zoomed about the middle of the viewport and then moved by the pan. */
export function applyView(fit: ScreenTransform, view: View, v: Viewport): ScreenTransform {
  if (view.zoom === 1 && view.panX === 0 && view.panY === 0) return fit;
  const [cx, cy] = [v.width / 2, v.height / 2];
  return { ...fit, k: fit.k * view.zoom, tx: cx + view.zoom * (fit.tx - cx) + view.panX, ty: cy + view.zoom * (fit.ty - cy) + view.panY };
}

/** Zooms by `factor`, keeping what is under the screen point `at` where it is, as far as the limits of the view allow. */
export function zoomAbout(view: View, v: Viewport, at: Pair, factor: number): View {
  const zoom = Math.min(MAX_ZOOM, Math.max(1, view.zoom * factor));
  const by = zoom / view.zoom;
  const [dx, dy] = [at[0] - v.width / 2, at[1] - v.height / 2];
  return clampView({ zoom, panX: dx - by * (dx - view.panX), panY: dy - by * (dy - view.panY) }, v);
}

export function panBy(view: View, v: Viewport, dx: number, dy: number): View {
  return clampView({ zoom: view.zoom, panX: view.panX + dx, panY: view.panY + dy }, v);
}
