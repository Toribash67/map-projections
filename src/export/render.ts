import type { Detail } from '../data/detail';
import { sceneLayers, type LayerState } from '../layers/layers';
import { loadMapData } from '../layers/mapData';
import { buildScene, type Scene } from '../morph/scene';
import { compile, matchStop } from '../projections/compile';
import type { ProjectionState } from '../projections/types';
import { drawScene } from '../render/draw';
import type { Style } from '../render/style';
import { computeScreen, mapSize, PADDING, type ScreenTransform, type Viewport } from '../screen/screen';
import { applyView, type View } from '../screen/view';
import { indicatrixStep } from '../tissot/indicatrix';
import { sceneToSvg } from './svg';

/** What to export: a picture in pixels or a drawing, of the whole map or of what the window shows, how wide in pixels, and from how fine a coast. */
export interface ExportOptions {
  format: 'png' | 'svg';
  extent: 'map' | 'view';
  width: number;
  detail: Detail;
  background: 'screen' | 'transparent';
}

/** Sizes to choose from, by the width in pixels: the window's own, a 4K screen, and paper at 300 dots to the inch, on its side. */
export const SIZE_PRESETS: { id: string; label: string; width: number | 'screen' }[] = [
  { id: 'screen', label: 'Screen', width: 'screen' },
  { id: '4k', label: '4K', width: 3840 },
  { id: 'a3', label: 'A3 at 300 dpi', width: 4961 },
  { id: 'a1', label: 'A1 at 300 dpi', width: 9933 },
];

/** What the app shows now, as everything an export needs, taken at one moment. */
export interface Snapshot {
  state: ProjectionState;
  layers: LayerState;
  style: Style;
  drawings: GeoJSON.GeometryCollection;
  view: View;
  viewport: Viewport;
}

/** The canvas could not be made, or could not be drawn on: it is larger than this browser allows. */
export class ExportTooLarge extends Error {
  constructor() {
    super('The picture is too large for this browser to make');
    this.name = 'ExportTooLarge';
  }
}

const scaled = (s: ScreenTransform, by: number): ScreenTransform => ({ ...s, k: s.k * by, tx: s.tx * by, ty: s.ty * by });

/**
 * The scene, size and line scale for an export. Extent 'map' is the whole map, fitted, with the margin it has on screen; 'view' is
 * the window's own framing. Either way the picture is the screen's, enlarged: `lineScale` is by how much, so that lines drawn that
 * many times as wide look as they do on screen.
 */
export async function exportScene(snap: Snapshot, opts: ExportOptions): Promise<{ scene: Scene; size: Viewport; lineScale: number }> {
  const compiled = compile(snap.state);
  let lineScale: number;
  let size: Viewport;
  let screen: ScreenTransform;
  if (opts.extent === 'view') {
    lineScale = opts.width / snap.viewport.width;
    size = { width: opts.width, height: Math.round(snap.viewport.height * lineScale) };
    screen = scaled(applyView(computeScreen(compiled, snap.viewport), snap.view, snap.viewport), lineScale);
  } else {
    // The map as the window fits it, in a frame of its own size and the margin round it.
    const fitted = mapSize(compiled, snap.viewport);
    const frame = { width: fitted.width + 2 * PADDING, height: fitted.height + 2 * PADDING };
    lineScale = opts.width / frame.width;
    size = { width: opts.width, height: Math.round(frame.height * lineScale) };
    screen = scaled(computeScreen(compiled, frame), lineScale);
  }
  const data = await loadMapData(opts.detail);
  const layers = sceneLayers(snap.layers, [compiled], snap.drawings, data);
  // The indicatrices are those of the screen: as many, and as large beside the map.
  const zoom = opts.extent === 'view' ? snap.view.zoom : 1;
  const scene = buildScene(layers, [{ compiled, screen, weight: 1 }], null, snap.layers.on.tissot && { step: indicatrixStep(zoom), viewport: size });
  return { scene, size, lineScale };
}

/** How wide, in pixels, an export is that is as the screen shows it, on a screen of a pixel ratio: lines and all the size they are there. */
export function screenWidth(snap: Snapshot, extent: ExportOptions['extent'], ratio: number): number {
  const width = extent === 'view' ? snap.viewport.width : mapSize(compile(snap.state), snap.viewport).width + 2 * PADDING;
  return Math.round(width * ratio);
}

/** The colour behind the map, or null for none. */
const backgroundOf = (snap: Snapshot, opts: ExportOptions): string | null => (opts.background === 'transparent' ? null : snap.style.background);

/** The picture as PNG. A canvas past what the browser allows is made without complaint and then cannot be drawn on, so it is tried first. */
function toPng(scene: Scene, size: Viewport, lineScale: number, style: Style, background: string | null): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new ExportTooLarge();
  // The far corner, painted and read back: on a canvas that could not be made it stays empty, or cannot be read.
  try {
    ctx.fillRect(size.width - 1, size.height - 1, 1, 1);
    if (ctx.getImageData(size.width - 1, size.height - 1, 1, 1).data[3] === 0) throw new ExportTooLarge();
    ctx.clearRect(0, 0, size.width, size.height);
  } catch {
    throw new ExportTooLarge();
  }
  drawScene(ctx, scene, 0, style, { lineScale, background });
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new ExportTooLarge())), 'image/png'));
}

/** The map as a file: a PNG picture or an SVG drawing. Rejects with `ExportTooLarge` when the picture cannot be made at this size. */
export async function exportBlob(snap: Snapshot, opts: ExportOptions): Promise<Blob> {
  const { scene, size, lineScale } = await exportScene(snap, opts);
  const background = backgroundOf(snap, opts);
  if (opts.format === 'svg') return new Blob([sceneToSvg(scene, snap.style, size, { background, lineScale })], { type: 'image/svg+xml' });
  return toPng(scene, size, lineScale, snap.style, background);
}

/** The name of the file: the projection as the list has it, or 'custom' where the map is none of them, and the width. */
export function exportName(snap: Snapshot, opts: ExportOptions): string {
  return `map-${matchStop(snap.state)?.id ?? 'custom'}-${opts.width}.${opts.format}`;
}
