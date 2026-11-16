import type { Detail } from '../data/detail';
import { pictureLayers, sceneLayers, type LayerState, type MapLayers, type PrintLayers } from '../layers/layers';
import { loadMapData, loadPictureData, withPictureData } from '../layers/mapData';
import { buildScene, type Scene } from '../morph/scene';
import { compile, matchStop } from '../projections/compile';
import type { CompiledProjection, ProjectionState } from '../projections/types';
import { drawScene } from '../render/draw';
import type { Style } from '../render/style';
import { paddingFor } from '../plate/plate';
import { computeScreen, mapSize, type ScreenTransform, type Viewport } from '../screen/screen';
import { applyView, type View } from '../screen/view';
import { indicatrixStep } from '../tissot/indicatrix';
import { LAND } from '../data/land';
import { loadWater, type Sea } from '../data/water';
import { worldNow } from '../data/world';
import { canvasMeasure, fontFaceCss, loadFont } from '../labels/font';
import { buildOverlay, drawOverlay, overlayToSvg, overlayWanted, type Overlay, type OverlayMeasure, type OverlayWorld } from '../overlay/overlay';
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

/** A map as everything a picture of it needs, taken at one moment: the map the app shows, with the layers the picture is to have. */
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

/** What the app shows now: a snapshot with the map's own layers and none of print's. */
export type MapSnapshot = Omit<Snapshot, 'layers'> & { layers: MapLayers };

/** The picture of a map as the app shows it, with what print adds to it. */
export const pictureOf = (map: MapSnapshot, print: PrintLayers): Snapshot => ({ ...map, layers: pictureLayers(map.layers, print) });

/** The canvas could not be made, or could not be drawn on: it is larger than this browser allows. */
export class ExportTooLarge extends Error {
  constructor() {
    super('The picture is too large for this browser to make');
    this.name = 'ExportTooLarge';
  }
}

const scaled = (s: ScreenTransform, by: number): ScreenTransform => ({ ...s, k: s.k * by, tx: s.tx * by, ty: s.ty * by });

/** Where an export puts the map: its size, by how much it is larger than the screen, the map as it is placed in it, and how far it is zoomed in. */
export type Placed = { size: Viewport; lineScale: number; member: Member; zoom: number };
/** An export worked out: its scene, and where the map is placed in it. */
export type Exported = Placed & { scene: Scene };

/**
 * The size and line scale of an export, and the map in it. Extent 'map' is the whole map, fitted, with the margin it has on screen;
 * 'view' is the window's own framing. Either way the picture is the screen's, enlarged: `lineScale` is by how much, so that lines
 * drawn that many times as wide look as they do on screen.
 */
export function placeExport(snap: Snapshot, opts: Pick<ExportOptions, 'extent' | 'width'>): Placed {
  const compiled: CompiledProjection = compile(snap.state);
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
  return { size, lineScale, member: { compiled, screen, weight: 1 }, zoom: opts.extent === 'view' ? snap.view.zoom : 1 };
}

/**
 * The scene of an export, from a coast as fine as asked for. `placed` is where the map goes in it, if that has been worked out
 * already: the cut keeps what it has cut by the map it cut it for, so a picture that is built again on the same placing cuts only
 * the layers that are new to it.
 */
export async function exportScene(snap: Snapshot, opts: ExportOptions, placed: Placed = placeExport(snap, opts)): Promise<Exported> {
  const { size, lineScale, member, zoom } = placed;
  // With whatever else of this level the picture shows: its water, and what colours and marks its land.
  const [data] = await Promise.all([loadMapData(opts.detail), loadPictureData(snap.layers, opts.detail)]);
  const layers = sceneLayers(snap.layers, [member.compiled], snap.drawings, withPictureData(data, opts.detail));
  // The indicatrices are those of the screen: as many, and as large beside the map.
  const scene = buildScene(layers, [member], null, snap.layers.on.tissot && { step: indicatrixStep(zoom), viewport: size, scale: lineScale });
  return { ...placed, scene };
}

/**
 * What is over an exported map: the names and degrees fitted to the map as the export has it, and the frame and title box of the
 * export's own picture. They are fitted afresh and not taken from the screen, so the picture of the whole map has the whole map's
 * names though the window is zoomed in; and they are the screen's, as much larger as the picture is.
 */
export function exportOverlay(snap: Snapshot, { size, lineScale, member }: Placed, measure: OverlayMeasure, seas: Sea[] | null, land: GeoJSON.GeoJsonObject, world: OverlayWorld = {}): Overlay {
  return buildOverlay({ member, state: snap.state, named: snap.named, layers: snap.layers, picture: { x: 0, y: 0, ...size }, scale: lineScale }, measure, seas, land, world);
}

/** How wide, in pixels, an export is that is as the screen shows it, on a screen of a pixel ratio: lines and all the size they are there. */
export function screenWidth(snap: Snapshot | MapSnapshot, extent: ExportOptions['extent'], ratio: number): number {
  const padding = paddingFor(snap.layers);
  const width = extent === 'view' ? snap.viewport.width : mapSize(compile(snap.state), snap.viewport, padding).width + 2 * padding;
  return Math.round(width * ratio);
}

/**
 * How fine the lines of a picture are for the coast it is drawn from, of what they are on the map. A line can show no bend smaller
 * than itself: a coast with ten times the detail under a line of the same width is a blot wherever the coast is intricate. So the
 * finer the coast, the finer the lines, and the map's own coast has the map's own lines.
 */
export const DETAIL_LINES: Record<Detail, number> = { '110m': 1, '50m': 0.75, '10m': 0.5 };

/** How many times as wide as on the map every line of a picture is: as the picture is larger, by the detail it has, and by the weight chosen for it. */
export const lineScaleOf = (snap: Snapshot, opts: ExportOptions, { lineScale }: Placed): number => lineScale * DETAIL_LINES[opts.detail] * snap.layers.lineWeight;

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

/** A picture that has been worked out, as a file: a PNG picture or an SVG drawing. Rejects with `ExportTooLarge` when it cannot be made at this size. */
export async function blobOf(snap: Snapshot, opts: ExportOptions, exported: Exported, overlay: Overlay | null): Promise<Blob> {
  const { scene, size } = exported;
  const background = backgroundOf(snap, opts);
  const lineScale = lineScaleOf(snap, opts, exported);
  if (opts.format === 'svg') {
    const over = overlay ? overlayToSvg(overlay, snap.style, await fontFaceCss()) : [];
    return new Blob([sceneToSvg(scene, snap.style, size, { background, lineScale }, over)], { type: 'image/svg+xml' });
  }
  return toPng(scene, size, lineScale, snap.style, background, overlay);
}

/** The map as a file, worked out from nothing. Rejects with `ExportTooLarge` when the picture cannot be made at this size. */
export async function exportBlob(snap: Snapshot, opts: ExportOptions): Promise<Blob> {
  const exported = await exportScene(snap, opts);
  let overlay: Overlay | null = null;
  if (overlayWanted(snap.layers)) {
    // The typeface first, as the names are fitted by the widths of its letters; and the seas, if they are named. Either may fail
    // to come: the lettering is then in another typeface, or the seas go unnamed, and the map is exported all the same.
    const [seas] = await Promise.all([snap.layers.on.seaNames ? loadWater('seas', '110m').catch(() => null) : null, loadFont()]);
    const now = <K extends keyof OverlayWorld>(kind: K) => worldNow(kind, opts.detail);
    overlay = exportOverlay(snap, exported, canvasMeasure(), seas, LAND, { regions: now('regions'), cities: now('cities'), peaks: now('peaks'), volcanoes: now('volcanoes'), quakes: now('quakes') });
  }
  return blobOf(snap, opts, exported, overlay);
}

/** The name of the file: the projection as the list has it, or 'custom' where the map is none of them, and the width. */
export function exportName(snap: Snapshot, opts: ExportOptions): string {
  return `map-${matchStop(snap.state)?.id ?? 'custom'}-${opts.width}.${opts.format}`;
}
