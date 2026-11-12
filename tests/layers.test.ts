import { geoLength } from 'd3-geo';
import { neighbors } from 'topojson-client';
import { describe, expect, test } from 'vitest';
import { COAST, GRATICULE, LAND } from '../src/data/land';
import { BORDERS, colourIndex, POLITICAL } from '../src/data/countries';
import { loadDetail } from '../src/data/detail';
import { lakeEdgesOf, loadWater } from '../src/data/water';
import { COARSE } from '../src/layers/layers';
import { loadWaterFor, withWater } from '../src/layers/mapData';
import politicalColours from '../src/data/politicalColours.json';
import { DEFAULT_LAYERS, DRAW_ORDER, sceneLayers, type LayerState } from '../src/layers/layers';
import { hasStandardLines, standardLines } from '../src/layers/standardLines';
import type { Scene, ScenePiece } from '../src/morph/scene';
import { compile, stateForStop } from '../src/projections/compile';
import type { CompiledProjection, LonLat, Orientation } from '../src/projections/types';
import { drawScene } from '../src/render/draw';
import { mapStyle } from '../src/render/style';
import { stopOf } from './stopOf';

const compiled = (id: string, orientation: Partial<Orientation> = {}, params: Record<string, number> = {}): CompiledProjection => {
  const state = stateForStop(stopOf(id));
  return compile({ ...state, params: { ...state.params, ...params }, orientation: { ...state.orientation, ...orientation } });
};
const with_ = (on: Partial<LayerState['on']>, rest: Partial<LayerState> = {}): LayerState => ({ ...DEFAULT_LAYERS, ...rest, on: { ...DEFAULT_LAYERS.on, ...on } });
const NONE: GeoJSON.GeometryCollection = { type: 'GeometryCollection', geometries: [] };

describe('countries', () => {
  const SCALES = ['110m', '50m', '10m'] as const;

  test.each(SCALES)('at %s every country has one of five colours, and no two with a border between them have the same', async (scale) => {
    const topology = (await loadDetail(scale)).topology as any;
    const colours = colourIndex(topology);
    const geometries = topology.objects.countries.geometries;
    expect(colours).toHaveLength(geometries.length);
    expect(Math.min(...colours)).toBe(0);
    expect(Math.max(...colours)).toBe(4);
    neighbors(geometries).forEach((near: number[], i: number) => {
      // A country in several pieces can come out as a neighbour of itself.
      for (const j of near) if (j !== i) expect(colours[j], `${geometries[i].properties?.name} and ${geometries[j].properties?.name}`).not.toBe(colours[i]);
    });
    // Each colour is used a fair amount: the map is not one colour with a few specks.
    for (let c = 0; c < 5; c++) expect(colours.filter((v) => v === c).length, `colour ${c}`).toBeGreaterThan(10);
  });

  test('a country has the same colour at every scale, and every country has one chosen for it', async () => {
    const byName = new Map<string, number>();
    for (const scale of SCALES) {
      const topology = (await loadDetail(scale)).topology as any;
      const colours = colourIndex(topology);
      topology.objects.countries.geometries.forEach((country: any, i: number) => {
        const name = country.properties.name as string;
        expect(politicalColours, name).toHaveProperty([name]);
        if (byName.has(name)) expect(colours[i], `${name} at ${scale}`).toBe(byName.get(name));
        byName.set(name, colours[i]!);
      });
    }
    expect(byName.size).toBeGreaterThan(240);
  });

  test('the political layers are the countries by colour, and together all of the land the countries have', () => {
    expect(POLITICAL).toHaveLength(5);
    for (const layer of POLITICAL) expect(layer.type).toBe('MultiPolygon');
    const polygons = POLITICAL.reduce((sum, layer) => sum + layer.coordinates.length, 0);
    expect(polygons).toBeGreaterThan(177);
  });

  test('the borders are the lines between countries only: no coast is among them', () => {
    expect(BORDERS.type).toBe('MultiLineString');
    expect(geoLength(BORDERS)).toBeGreaterThan(1);
    // Shorter than the coasts, which they would be longer than by far if the coasts were among them.
    expect(geoLength(BORDERS)).toBeLessThan(0.7 * geoLength(COAST as any));
  });
});

describe('standard lines', () => {
  const frameLats = (c: CompiledProjection) => standardLines(c)!.coordinates.map((line) => line.map((p) => c.toFrame(p as LonLat)[1]));

  test('a conic has its two standard parallels, in its own frame', () => {
    const albers = compiled('albers');
    const lines = frameLats(albers);
    expect(lines).toHaveLength(2);
    for (const lat of lines[0]!) expect(lat).toBeCloseTo(29.5, 6);
    for (const lat of lines[1]!) expect(lat).toBeCloseTo(45.5, 6);
    // All the way round, in short steps.
    expect(lines[0]!.length).toBeGreaterThan(100);
    // One parallel where the two are the same.
    expect(frameLats(compiled('albers', {}, { p1: 40, p2: 40 }))).toHaveLength(1);
  });

  test('a cylindrical map has the parallel of true scale north and south, or the equator alone, and they tilt with the map', () => {
    const behrmann = frameLats(compiled('behrmann'));
    expect(behrmann.map((line) => Math.round(line[0]!))).toEqual([30, -30]);
    expect(frameLats(compiled('mercator')).map((line) => Math.round(line[0]!))).toEqual([0]);
    const tilted = compiled('gall-peters', { lon: 20, lat: 10, tilt: 40 });
    for (const line of frameLats(tilted)) for (const lat of line) expect(Math.abs(lat)).toBeCloseTo(45, 6);
    // On the Earth they are no longer parallels of latitude.
    const onEarth = standardLines(tilted)!.coordinates[0]!.map((p) => p[1]!);
    expect(Math.max(...onEarth) - Math.min(...onEarth)).toBeGreaterThan(20);
  });

  test('a map with none has none, and the same map gives the same lines, the very object', () => {
    for (const id of ['mollweide', 'globe', 'stereographic', 'goode', 'peirce', 'miller']) {
      expect(standardLines(compiled(id)), id).toBeNull();
      expect(hasStandardLines(stopOf(id).defId), id).toBe(false);
    }
    for (const id of ['albers', 'lambert-conformal', 'mercator', 'behrmann']) expect(hasStandardLines(stopOf(id).defId), id).toBe(true);
    expect(standardLines(compiled('albers'))).toBe(standardLines(compiled('albers')));
    expect(standardLines(compiled('albers', { lon: 30 }))).not.toBe(standardLines(compiled('albers')));
    expect(standardLines(compiled('albers', {}, { p1: 20 }))).not.toBe(standardLines(compiled('albers')));
  });
});

describe('the layers of a scene', () => {
  const mollweide = compiled('mollweide');

  test('by default: sea, land, graticule, coast and drawings', () => {
    const layers = sceneLayers(DEFAULT_LAYERS, [mollweide], NONE);
    expect(Object.keys(layers).sort()).toEqual(['coast', 'drawings', 'graticule', 'land', 'ocean']);
    expect(layers.land).toBe(LAND);
    expect(layers.coast).toBe(COAST);
    expect(layers.drawings).toBe(NONE);
    expect(DEFAULT_LAYERS.on).toEqual({ land: true, coast: true, graticule: true, borders: false, political: false, rivers: false, lakes: false, depth: false, tissot: false, standard: false, reference: false, drawings: true, countryNames: false, seaNames: false, degrees: false, frame: false, titleBox: false });
    expect(DEFAULT_LAYERS.graticuleStep).toBe(10);
    expect(DEFAULT_LAYERS).toMatchObject({ graticuleUnder: false, smallestName: 4, title: 'The World', subtitle: '', corner: 'tr' });
  });

  test('a layer turned off is not there, and the same layers give the very same objects, for the cuts to keep what they have prepared', () => {
    const off = sceneLayers(with_({ land: false, coast: false, graticule: false, drawings: false }), [mollweide], NONE);
    expect(Object.keys(off)).toEqual(['ocean']);
    const [a, b] = [sceneLayers(with_({ borders: true, reference: true }), [mollweide], NONE), sceneLayers(with_({ borders: true, reference: true }), [mollweide], NONE)];
    for (const name of Object.keys(a)) expect(a[name], name).toBe(b[name]);
    expect(a.borders).toBe(BORDERS);
  });

  test('the political colours take the land\'s place', () => {
    const layers = sceneLayers(with_({ political: true }), [mollweide], NONE);
    expect(Object.keys(layers).filter((name) => name.startsWith('political')).sort()).toEqual(['political0', 'political1', 'political2', 'political3', 'political4']);
    expect(layers.land).toBeUndefined();
    expect(layers.political2).toBe(POLITICAL[2]);
  });

  test('the graticule is as fine as asked', () => {
    const count = (step: 10 | 15 | 30) => (sceneLayers(with_({}, { graticuleStep: step }), [mollweide], NONE).graticule as GeoJSON.MultiLineString).coordinates.length;
    expect(count(10)).toBeGreaterThan(count(15));
    expect(count(15)).toBeGreaterThan(count(30));
    expect(sceneLayers(with_({}, { graticuleStep: 30 }), [mollweide], NONE).graticule).toBe(sceneLayers(with_({}, { graticuleStep: 30 }), [mollweide], NONE).graticule);
    // At ten degrees it is d3's own: only each ninetieth meridian runs to the poles, where all of them would crowd together.
    const ten = sceneLayers(DEFAULT_LAYERS, [mollweide], NONE).graticule as GeoJSON.MultiLineString;
    expect(ten.coordinates).toEqual((GRATICULE as GeoJSON.MultiLineString).coordinates);
    for (const step of [15, 30] as const) {
      const lines = (sceneLayers(with_({}, { graticuleStep: step }), [mollweide], NONE).graticule as GeoJSON.MultiLineString).coordinates;
      const toPole = lines.filter((line) => Math.abs(line.at(-1)![1]!) > 89.9 || Math.abs(line[0]![1]!) > 89.9);
      expect(toPole, `${step}`).toHaveLength(4);
    }
  });

  test('rivers, lakes and depths are there once they have been fetched, and not before', async () => {
    const on = with_({ rivers: true, lakes: true, depth: true });
    // Nothing has been fetched: the map is drawn without them, from the very data it had.
    expect(withWater(COARSE, '110m')).toBe(COARSE);
    expect(Object.keys(sceneLayers(on, [mollweide], NONE, withWater(COARSE, '110m'))).sort()).toEqual(['coast', 'drawings', 'graticule', 'land', 'ocean']);
    // All that is asked for is already there for a map with none of them on.
    expect(loadWaterFor(DEFAULT_LAYERS.on, '110m')).toBeNull();
    await loadWaterFor(on.on, '110m');
    expect(loadWaterFor(on.on, '110m')).toBeNull();
    const data = withWater(COARSE, '110m');
    expect(withWater(COARSE, '110m')).toBe(data);
    expect(data.land).toBe(LAND);
    const layers = sceneLayers(on, [mollweide], NONE, data);
    expect(layers.rivers).toBe(await loadWater('rivers', '110m'));
    expect(layers.lakes).toBe(await loadWater('lakes', '110m'));
    expect(layers.lakeEdges).toBe(lakeEdgesOf(await loadWater('lakes', '110m')));
    const depth = await loadWater('depth', '110m');
    expect([layers.depth0, layers.depth1, layers.depth2, layers.depth3]).toEqual(depth);
    // Off, they are not there though the data is.
    expect(Object.keys(sceneLayers(DEFAULT_LAYERS, [mollweide], NONE, data)).sort()).toEqual(['coast', 'drawings', 'graticule', 'land', 'ocean']);
    expect(Object.keys(sceneLayers(with_({ lakes: true }), [mollweide], NONE, data)).sort()).toEqual(['coast', 'drawings', 'graticule', 'lakeEdges', 'lakes', 'land', 'ocean']);
  });

  test('the graticule can lie under the land, as a layer of another name', () => {
    const under = sceneLayers(with_({}, { graticuleUnder: true }), [mollweide], NONE);
    expect(under.graticule).toBeUndefined();
    expect(under.graticuleUnder).toBe(sceneLayers(DEFAULT_LAYERS, [mollweide], NONE).graticule);
    expect(sceneLayers(with_({ graticule: false }, { graticuleUnder: true }), [mollweide], NONE).graticuleUnder).toBeUndefined();
  });

  test('the reference circles are the equator, the tropics and the polar circles', () => {
    const reference = sceneLayers(with_({ reference: true }), [mollweide], NONE).reference as GeoJSON.MultiLineString;
    expect(reference.coordinates.map((line) => +line[0]![1]!.toFixed(2))).toEqual([0, 23.44, -23.44, 66.56, -66.56]);
  });

  test('standard lines: the map\'s own at rest; in a morph the lines of the maps left and of the map arrived at, apart', () => {
    const [albers, mercator] = [compiled('albers'), compiled('mercator')];
    const on = with_({ standard: true });
    expect(sceneLayers(on, [albers], NONE).standard).toBe(standardLines(albers));
    expect(sceneLayers(on, [mollweide], NONE).standard).toBeUndefined();
    // The last map given is the one the morph is going to.
    const morph = sceneLayers(on, [albers, mercator], NONE);
    expect(morph.standard).toBeUndefined();
    expect(morph.standardOut).toBe(standardLines(albers));
    expect(morph.standardIn).toBe(standardLines(mercator));
    const leaving = sceneLayers(on, [albers, mollweide], NONE);
    expect(leaving.standardOut).toBe(standardLines(albers));
    expect(leaving.standardIn).toBeUndefined();
    // Off, there are none.
    expect(Object.keys(sceneLayers(DEFAULT_LAYERS, [albers, mercator], NONE)).some((name) => name.startsWith('standard'))).toBe(false);
  });
});

describe('drawing the layers', () => {
  const style = mapStyle('light');
  type Op = { op: 'fill' | 'stroke'; style: string; width: number; dash: number[] };
  function recording() {
    const ops: Op[] = [];
    let dash: number[] = [];
    const ctx: any = {
      canvas: { width: 100, height: 100 }, fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1, lineJoin: '', lineCap: '',
      getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }), setTransform: () => {}, save: () => {}, restore: () => {}, clip: () => {},
      beginPath: () => {}, closePath: () => {}, moveTo: () => {}, lineTo: () => {}, arc: () => {}, fillRect: () => {},
      setLineDash: (d: number[]) => void (dash = d),
      fill: () => void ops.push({ op: 'fill', style: ctx.fillStyle, width: 0, dash: [] }),
      stroke: () => void ops.push({ op: 'stroke', style: ctx.strokeStyle, width: ctx.lineWidth, dash: [...dash] }),
    };
    return { ctx: ctx as CanvasRenderingContext2D, ops };
  }
  const piece = (closed: boolean): ScenePiece => ({ closed, src: new Float32Array([0, 0, 10, 0, 10, 10]), dst: new Float32Array([0, 0, 10, 0, 10, 10]), ringStarts: new Uint32Array([0]), alphaSrc: 1, alphaDst: 1, behind: false, out: false });
  const sceneOf = (names: string[]): Scene => ({ layers: Object.fromEntries(names.map((name) => [name, [piece(!/graticule|reference|borders|coast|standard|rivers|lakeEdges/.test(name))]])), indicatrices: [] });

  test('the sea deepens in its four colours under the land, rivers run under the lakes, and a lake is the sea\'s colour with a shore', () => {
    const { ctx, ops } = recording();
    drawScene(ctx, sceneOf(['ocean', 'depth0', 'depth1', 'depth2', 'depth3', 'graticuleUnder', 'land', 'rivers', 'lakes', 'lakeEdges', 'coast']), 1, style);
    const colours = ops.map((o) => o.style).filter((s, i, all) => s !== all[i - 1]);
    expect(colours).toEqual([style.ocean, ...style.depth, style.graticule, style.land, style.rivers, style.ocean, style.rivers, style.coast]);
    const strokes = ops.filter((o) => o.op === 'stroke' && o.style === style.rivers).map((o) => o.width);
    expect(strokes).toEqual([style.riversWidth, style.lakeEdgeWidth]);
  });

  test('bottom to top: sea, land or the political colours, graticule, reference circles, borders, coast, standard lines, drawings', () => {
    expect(DRAW_ORDER.map((entry) => entry.layer)).toEqual(['ocean', 'depth0', 'depth1', 'depth2', 'depth3', 'graticuleUnder', 'land', 'political0', 'political1', 'political2', 'political3', 'political4', 'rivers', 'lakes', 'lakeEdges', 'graticule', 'reference', 'borders', 'coast', 'standardOut', 'standardIn', 'standard', 'drawings']);
    const { ctx, ops } = recording();
    drawScene(ctx, sceneOf(['ocean', 'political0', 'political3', 'graticule', 'reference', 'borders', 'coast', 'standard', 'drawings']), 1, style);
    const colours = ops.map((o) => o.style).filter((s, i, all) => s !== all[i - 1]);
    expect(colours).toEqual([style.ocean, style.political[0], style.political[3], style.graticule, style.reference, style.borders, style.coast, style.standard, style.accentFill]);
    // The reference circles are dashed, and nothing after them is.
    expect(ops.find((o) => o.style === style.reference)!.dash.length).toBeGreaterThan(0);
    expect(ops.find((o) => o.style === style.borders)!.dash).toEqual([]);
    expect(ops.find((o) => o.style === style.coast)!.dash).toEqual([]);
  });

  test('in a morph the standard lines of the map left thin away as those of the map arrived at grow', () => {
    const widths = (t: number) => {
      const { ctx, ops } = recording();
      drawScene(ctx, sceneOf(['ocean', 'standardOut', 'standardIn']), t, style);
      return ops.filter((o) => o.style === style.standard).map((o) => o.width);
    };
    expect(widths(0.25)).toEqual([0.75 * style.standardWidth, 0.25 * style.standardWidth]);
    expect(widths(0.5)).toEqual([0.5 * style.standardWidth, 0.5 * style.standardWidth]);
    // At the ends only one of them is drawn at all.
    expect(widths(0)).toEqual([style.standardWidth]);
    expect(widths(1)).toEqual([style.standardWidth]);
  });
});
