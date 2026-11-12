import { afterEach, describe, expect, test, vi } from 'vitest';
import { ExportTooLarge, exportBlob, exportName, exportScene, SIZE_PRESETS, type ExportOptions, type Snapshot } from '../src/export/render';
import { DEFAULT_LAYERS, sceneLayers } from '../src/layers/layers';
import { buildScene, type ScenePiece } from '../src/morph/scene';
import { compile, stateForStop } from '../src/projections/compile';
import { mapStyle } from '../src/render/style';
import { computeScreen } from '../src/screen/screen';
import { applyView, FIT, type View } from '../src/screen/view';
import { LAND } from '../src/data/land';
import { exportOverlay } from '../src/export/render';
import { stopOf } from './stopOf';

const VIEWPORT = { width: 1000, height: 600 };
const NO_DRAWINGS: GeoJSON.GeometryCollection = { type: 'GeometryCollection', geometries: [] };
const snapshotOf = (id: string, view: View = FIT): Snapshot => ({ state: stateForStop(stopOf(id)), named: stopOf(id), layers: DEFAULT_LAYERS, style: mapStyle('light'), drawings: NO_DRAWINGS, view, viewport: VIEWPORT });
const OPTIONS: ExportOptions = { format: 'png', extent: 'map', width: 2000, detail: '110m', background: 'screen' };

/** The box round the shown pieces of a layer. */
function boxOf(pieces: ScenePiece[]) {
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const { src } of pieces.filter((p) => p.alphaSrc > 0)) {
    for (let i = 0; i < src.length; i += 2) {
      [minX, maxX] = [Math.min(minX, src[i]!), Math.max(maxX, src[i]!)];
      [minY, maxY] = [Math.min(minY, src[i + 1]!), Math.max(maxY, src[i + 1]!)];
    }
  }
  return { minX, minY, maxX, maxY };
}

afterEach(() => vi.unstubAllGlobals());

describe('the scene of an export', () => {
  test('the whole map, at a width: as high as the fitted map with its margin is, and the map the margin from each side', async () => {
    const snap = snapshotOf('mollweide');
    const onScreen = boxOf(buildScene(sceneLayers(snap.layers, [compile(snap.state)], NO_DRAWINGS), [{ compiled: compile(snap.state), screen: computeScreen(compile(snap.state), VIEWPORT), weight: 1 }], null, false).layers.ocean!);
    const [mapWidth, mapHeight] = [onScreen.maxX - onScreen.minX, onScreen.maxY - onScreen.minY];
    const { scene, size, lineScale } = await exportScene(snap, OPTIONS);
    expect(size.width).toBe(2000);
    expect(Math.abs(size.height - (2000 * (mapHeight + 32)) / (mapWidth + 32))).toBeLessThanOrEqual(1);
    // Lines are as much wider as the map is.
    expect(lineScale).toBeCloseTo(2000 / (mapWidth + 32), 1);
    const box = boxOf(scene.layers.ocean!);
    expect(box.minX).toBeCloseTo(16 * lineScale, 0);
    expect(size.width - box.maxX).toBeCloseTo(16 * lineScale, 0);
    expect(box.minY).toBeCloseTo(16 * lineScale, 0);
    expect(size.height - box.maxY).toBeCloseTo(16 * lineScale, 0);
  });

  test('the whole map is the same whatever the window is zoomed to', async () => {
    const [fit, zoomed] = [await exportScene(snapshotOf('robinson'), OPTIONS), await exportScene(snapshotOf('robinson', { zoom: 4, panX: 120, panY: -40 }), OPTIONS)];
    expect(zoomed.size).toEqual(fit.size);
    expect(boxOf(zoomed.scene.layers.ocean!)).toEqual(boxOf(fit.scene.layers.ocean!));
  });

  test('the view, at twice the window\'s width: every point is at twice its place on screen', async () => {
    const view = { zoom: 3, panX: 150, panY: -60 };
    const snap = snapshotOf('mercator', view);
    const compiled = compile(snap.state);
    const screen = applyView(computeScreen(compiled, VIEWPORT), view, VIEWPORT);
    const onScreen = buildScene(sceneLayers(snap.layers, [compiled], NO_DRAWINGS), [{ compiled, screen, weight: 1 }], null, false);
    const { scene, size, lineScale } = await exportScene(snap, { ...OPTIONS, extent: 'view' });
    expect(size).toEqual({ width: 2000, height: 1200 });
    expect(lineScale).toBe(2);
    for (const layer of ['ocean', 'graticule']) {
      const [twice, once] = [scene.layers[layer]!, onScreen.layers[layer]!];
      expect(twice.length).toBe(once.length);
      twice.forEach((piece, i) => {
        expect(piece.src.length).toBe(once[i]!.src.length);
        for (let k = 0; k < piece.src.length; k++) expect(Math.abs(piece.src[k]! - 2 * once[i]!.src[k]!)).toBeLessThan(0.01);
      });
    }
  });

  test('the indicatrices are the screen\'s: as many, and as large beside the map', async () => {
    const snap = { ...snapshotOf('mollweide'), layers: { ...DEFAULT_LAYERS, on: { ...DEFAULT_LAYERS.on, tissot: true } } };
    const [once, twice] = [await exportScene(snap, { ...OPTIONS, extent: 'view', width: 1000 }), await exportScene(snap, { ...OPTIONS, extent: 'view', width: 2000 })];
    expect(once.scene.indicatrices.length).toBeGreaterThan(20);
    expect(twice.scene.indicatrices.length).toBe(once.scene.indicatrices.length);
    expect(twice.scene.indicatrices[5]!.srcMat[0]).toBeCloseTo(2 * once.scene.indicatrices[5]!.srcMat[0], 3);
  });

  test('a large picture of a zoomed view has every indicatrix the window has, those reaching in from its edge too', async () => {
    const snap = { ...snapshotOf('mercator', { zoom: 4, panX: 0, panY: 900 }), layers: { ...DEFAULT_LAYERS, on: { ...DEFAULT_LAYERS.on, tissot: true } } };
    const [once, large] = [await exportScene(snap, { ...OPTIONS, extent: 'view', width: 1000 }), await exportScene(snap, { ...OPTIONS, extent: 'view', width: 9933 })];
    expect(once.scene.indicatrices.length).toBeGreaterThan(20);
    expect(large.scene.indicatrices.length).toBe(once.scene.indicatrices.length);
  });

  test('a finer coast is fetched for the export, and has more to it', async () => {
    const [coarse, fine] = [await exportScene(snapshotOf('mollweide'), OPTIONS), await exportScene(snapshotOf('mollweide'), { ...OPTIONS, detail: '50m' })];
    const points = (pieces: ScenePiece[]) => pieces.reduce((n, p) => n + p.src.length, 0);
    expect(points(fine.scene.layers.land!)).toBeGreaterThan(2 * points(coarse.scene.layers.land!));
  });
});

describe('the name of an export', () => {
  test('the projection as the list has it, the width and the format', () => {
    expect(exportName(snapshotOf('mercator'), { ...OPTIONS, width: 3840 })).toBe('map-mercator-3840.png');
    expect(exportName(snapshotOf('mollweide'), { ...OPTIONS, format: 'svg', width: 1200 })).toBe('map-mollweide-1200.svg');
  });

  test('a map that is none of the list\'s is custom', () => {
    const snap = snapshotOf('albers');
    snap.state = { ...snap.state, params: { ...snap.state.params, p1: 7.5 } };
    expect(exportName(snap, OPTIONS)).toBe('map-custom-2000.png');
  });

  test('the sizes on offer are the screen, 4K, and A3 and A1 at 300 dots to the inch', () => {
    expect(SIZE_PRESETS.map((p) => p.width)).toEqual(['screen', 3840, 4961, 9933]);
  });
});

describe('a picture the browser cannot make', () => {
  const stubCanvas = (canvas: object) => vi.stubGlobal('document', { createElement: () => canvas });

  test('with no context to draw on, the export is refused as too large', async () => {
    stubCanvas({ getContext: () => null });
    await expect(exportBlob(snapshotOf('mollweide'), OPTIONS)).rejects.toBeInstanceOf(ExportTooLarge);
  });

  test('with a canvas that takes no paint, the export is refused as too large', async () => {
    const ctx = { fillRect: () => {}, clearRect: () => {}, getImageData: () => ({ data: new Uint8ClampedArray(4) }) };
    stubCanvas({ getContext: () => ctx });
    await expect(exportBlob(snapshotOf('mollweide'), OPTIONS)).rejects.toBeInstanceOf(ExportTooLarge);
  });

  test('with a canvas that gives no file, the export is refused as too large', async () => {
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (_, key) => (key === 'getImageData' ? () => ({ data: new Uint8ClampedArray([0, 0, 0, 255]) }) : key === 'getTransform' ? () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) : key === 'canvas' ? { width: 2000, height: 1000 } : () => {}),
      set: () => true,
    });
    stubCanvas({ getContext: () => ctx, toBlob: (done: (blob: Blob | null) => void) => done(null) });
    await expect(exportBlob(snapshotOf('mollweide'), OPTIONS)).rejects.toBeInstanceOf(ExportTooLarge);
  });

  test('an SVG needs no canvas, and is a drawing of the size asked for', async () => {
    stubCanvas({ getContext: () => null });
    const blob = await exportBlob(snapshotOf('mollweide'), { ...OPTIONS, format: 'svg', background: 'transparent' });
    expect(blob.type).toBe('image/svg+xml');
    const text = await blob.text();
    expect(text).toContain('width="2000"');
    expect(text).not.toContain('<rect');
  });
});

describe('what is over an exported map', () => {
  const measure = { label: (text: string) => 0.62 * text.length, plate: (text: string) => 0.6 * text.length };
  const withNames = (id: string, view: View = FIT): Snapshot => ({ ...snapshotOf(id, view), layers: { ...DEFAULT_LAYERS, on: { ...DEFAULT_LAYERS.on, countryNames: true, frame: true, titleBox: true } } });

  test('in a picture twice as wide, the same names twice as large, and a frame and a box twice as large', async () => {
    const snap = withNames('mercator');
    const [small, large] = await Promise.all([1000, 2000].map(async (width) => exportOverlay(snap, await exportScene(snap, { ...OPTIONS, width }), measure, null, LAND)));
    expect(large!.labels.map((label) => label.text)).toEqual(small!.labels.map((label) => label.text));
    expect(small!.labels.length).toBeGreaterThan(8);
    large!.labels.forEach((label, i) => expect(label.size / small!.labels[i]!.size, label.text).toBeCloseTo(2, 1));
    expect(large!.plate.frame!.width / small!.plate.frame!.width).toBeCloseTo(2, 1);
    expect(large!.plate.box!.lines[0]!.size / small!.plate.box!.lines[0]!.size).toBeCloseTo(2, 1);
  });

  test('the frame is just inside the whole picture, and the map has the frame\'s margin round it', async () => {
    const snap = withNames('mollweide');
    const exported = await exportScene(snap, OPTIONS);
    const { plate } = exportOverlay(snap, exported, measure, null, LAND);
    const { frame } = plate;
    expect(frame!.x).toBeGreaterThan(0);
    expect(frame!.x + frame!.width).toBeLessThan(exported.size.width);
    expect(frame!.y + frame!.height).toBeLessThan(exported.size.height);
    const box = boxOf(exported.scene.layers.ocean!);
    expect(box.minX).toBeCloseTo(40 * exported.lineScale, 0);
    expect(box.minX).toBeGreaterThan(frame!.x + 20 * exported.lineScale);
  });

  test('the names of a view are the view\'s: zoomed in on Europe, its countries are named in the picture', async () => {
    const snap = withNames('mercator', { zoom: 4, panX: -150, panY: 520 });
    const exported = await exportScene(snap, { ...OPTIONS, extent: 'view' });
    const names = exportOverlay(snap, exported, measure, null, LAND).labels.map((label) => label.text);
    for (const name of ['FRANCE', 'GERMANY', 'POLAND']) expect(names).toContain(name);
    expect(names).not.toContain('BRAZIL');
  });

  test('with nothing over the map there is nothing over the export', async () => {
    const snap = snapshotOf('mercator');
    expect(exportOverlay(snap, await exportScene(snap, OPTIONS), measure, null, LAND)).toEqual({ labels: [], plate: expect.objectContaining({ frame: null, box: null }) });
  });
});
