import type { Detail } from '../data/detail';
import { sceneLayers, type LayerState } from '../layers/layers';
import { loadMapData, loadWaterFor, withWater } from '../layers/mapData';
import { buildScene, type Scene } from '../morph/scene';
import { compile, matchStop } from '../projections/compile';
import type { ProjectionState } from '../projections/types';
import { drawScene } from '../render/draw';
import type { Style } from '../render/style';
import { paddingFor } from '../plate/plate';
import { computeScreen, mapSize, type ScreenTransform, type Viewport } from '../screen/screen';
import { applyView, type View } from '../screen/view';
import { indicatrixStep } from '../tissot/indicatrix';
import { LAND } from '../data/land';
import { loadWater, type Sea } from '../data/water';
import { canvasMeasure, fontFaceCss, loadFont } from '../labels/font';
import { buildOverlay, drawOverlay, overlayToSvg, overlayWanted, type Overlay, type OverlayMeasure } from '../overlay/overlay';
import type { Member } from '../tissot/indicatrix';
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
  /** The projection the map is called by: its name in the list, and its parameters there. */
  named: { name: string; params: ProjectionState['params'] };
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

/** An export worked out: its scene, its size, by how much it is larger than the screen, and the map as it is placed in it. */
export type Exported = { scene: Scene; size: Viewport; lineScale: number; member: Member };

/**
 * The scene, size and line scale for an export. Extent 'map' is the whole map, fitted, with the margin it has on screen; 'view' is
 * the window's own framing. Either way the picture is the screen's, enlarged: `lineScale` is by how much, so that lines drawn that
 * many times as wide look as they do on screen.
 */
export async function exportScene(snap: Snapshot, opts: ExportOptions): Promise<Exported> {
  const compiled = compile(snap.state);
  let lineScale: number;
  let size: Viewport;
  let screen: ScreenTransform;
  const padding = paddingFor(snap.layers);
  if (opts.extent === 'view') {
    lineScale = opts.width / snap.viewport.width;
    size = { width: opts.width, height: Math.round(snap.viewport.height * lineScale) };
    screen = scaled(applyView(computeScreen(compiled, snap.viewport, padding), snap.view, snap.viewport), lineScale);
  } else {
    // The map as the window fits it, in a frame of its own size and the margin round it.
    const fitted = mapSize(compiled, snap.viewport, padding);
    const frame = { width: fitted.width + 2 * padding, height: fitted.height + 2 * padding };
    lineScale = opts.width / frame.width;
    size = { width: opts.width, height: Math.round(frame.height * lineScale) };
    screen = scaled(computeScreen(compiled, frame, padding), lineScale);
  }
  // The rivers, lakes and depths of this level too, if they are shown.
  const [data] = await Promise.all([loadMapData(opts.detail), loadWaterFor(snap.layers.on, opts.detail)]);
  const layers = sceneLayers(snap.layers, [compiled], snap.drawings, withWater(data, opts.detail));
  // The indicatrices are those of the screen: as many, and as large beside the map.
  const zoom = opts.extent === 'view' ? snap.view.zoom : 1;
  const member: Member = { compiled, screen, weight: 1 };
  const scene = buildScene(layers, [member], null, snap.layers.on.tissot && { step: indicatrixStep(zoom), viewport: size, scale: lineScale });
  return { scene, size, lineScale, member };
}

/**
 * What is over an exported map: the names and degrees fitted to the map as the export has it, and the frame and title box of the
 * export's own picture. They are fitted afresh and not taken from the screen, so the picture of the whole map has the whole map's
 * names though the window is zoomed in; and they are the screen's, as much larger as the picture is.
 */
export function exportOverlay(snap: Snapshot, { size, lineScale, member }: Exported, measure: OverlayMeasure, seas: Sea[] | null, land: GeoJSON.GeoJsonObject): Overlay {
  return buildOverlay({ member, state: snap.state, named: snap.named, layers: snap.layers, picture: { x: 0, y: 0, ...size }, scale: lineScale }, measure, seas, land);
}

/** How wide, in pixels, an export is that is as the screen shows it, on a screen of a pixel ratio: lines and all the size they are there. */
export function screenWidth(snap: Snapshot, extent: ExportOptions['extent'], ratio: number): number {
  const padding = paddingFor(snap.layers);
  const width = extent === 'view' ? snap.viewport.width : mapSize(compile(snap.state), snap.viewport, padding).width + 2 * padding;
  return Math.round(width * ratio);
}

/** The colour behind the map, or null for none. */
const backgroundOf = (snap: Snapshot, opts: ExportOptions): string | null => (opts.background === 'transparent' ? null : snap.style.background);

/** The picture as PNG. A canvas past what the browser allows is made without complaint and then cannot be drawn on, so it is tried first. */
function toPng(scene: Scene, size: Viewport, lineScale: number, style: Style, background: string | null, overlay: Overlay | null): Promise<Blob> {
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
  if (overlay) drawOverlay(ctx, overlay, style);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new ExportTooLarge())), 'image/png'));
}

/** The map as a file: a PNG picture or an SVG drawing. Rejects with `ExportTooLarge` when the picture cannot be made at this size. */
export async function exportBlob(snap: Snapshot, opts: ExportOptions): Promise<Blob> {
  const exported = await exportScene(snap, opts);
  const { scene, size, lineScale } = exported;
  const background = backgroundOf(snap, opts);
  let overlay: Overlay | null = null;
  if (overlayWanted(snap.layers)) {
    // The typeface first, as the names are fitted by the widths of its letters; and the seas, if they are named. Either may fail
    // to come: the lettering is then in another typeface, or the seas go unnamed, and the map is exported all the same.
    const [seas] = await Promise.all([snap.layers.on.seaNames ? loadWater('seas', '110m').catch(() => null) : null, loadFont()]);
    overlay = exportOverlay(snap, exported, canvasMeasure(), seas, LAND);
  }
  if (opts.format === 'svg') {
    const over = overlay ? overlayToSvg(overlay, snap.style, await fontFaceCss()) : [];
    return new Blob([sceneToSvg(scene, snap.style, size, { background, lineScale }, over)], { type: 'image/svg+xml' });
  }
  return toPng(scene, size, lineScale, snap.style, background, overlay);
}

/** The name of the file: the projection as the list has it, or 'custom' where the map is none of them, and the width. */
export function exportName(snap: Snapshot, opts: ExportOptions): string {
  return `map-${matchStop(snap.state)?.id ?? 'custom'}-${opts.width}.${opts.format}`;
}
