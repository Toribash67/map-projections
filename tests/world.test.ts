import { geoArea } from 'd3-geo';
import { describe, expect, test } from 'vitest';
import { LAND } from '../src/data/land';
import { HEIGHTS, loadWorld, worldNow } from '../src/data/world';
import { editLabels, withMove } from '../src/labels/move';
import type { Label } from '../src/labels/place';
import { buildHours, buildMarks, buildPoints, hoursText, Taken } from '../src/labels/points';
import { COARSE, DEFAULT_LAYERS, DRAW_ORDER, sceneLayers, type LayerState } from '../src/layers/layers';
import { loadPictureData, withPictureData, worldNeeds } from '../src/layers/mapData';
import { buildLetters, buildOverlay, lettersWanted, overlayToSvg, overlayWanted, type OverlayInput } from '../src/overlay/overlay';
import { layoutLegend, legendSections, patchColour, sourcesOf } from '../src/plate/legend';
import { buildPlate } from '../src/plate/plate';
import type { Scene, ScenePiece } from '../src/morph/scene';
import { drawScene } from '../src/render/draw';
import { mapStyle, styleOf } from '../src/render/style';
import { BIOME_COLOURS, BIOME_NAMES, CLIMATE_COLOURS, CLIMATE_NAMES } from '../src/theme/classes';
import { resolvePalette } from '../src/theme/themes';
import { sceneToSvg } from '../src/export/svg';
import { buildScene } from '../src/morph/scene';
import { stopOf } from './stopOf';
import { member, VIEW } from './sceneSupport';

const style = mapStyle('light');
const layers = (on: Partial<LayerState['on']>, rest: Partial<LayerState> = {}): LayerState => ({ ...DEFAULT_LAYERS, ...rest, on: { ...DEFAULT_LAYERS.on, ...on } });
const measure = { label: (text: string) => 0.55 * [...text].length, plate: (text: string) => 0.55 * [...text].length };
const robinson = member('robinson');
const PICTURE = { x: 0, y: 0, ...VIEW };
const input = (state: LayerState, scale = 1): OverlayInput => ({ member: robinson, state: robinson.compiled.state, named: stopOf('robinson'), layers: state, picture: PICTURE, scale });
const half = 2 * Math.PI;
const areaOf = (polygon: GeoJSON.Position[][]) => geoArea({ type: 'Polygon', coordinates: polygon });
// Each file as text, read when asked for.
const texts = import.meta.glob<string>(['../src/data/ne/*.json', '../src/data/world/*.json', '../src/data/world.ts'], { query: '?raw', import: 'default' });
const kB = async (path: string) => (await texts[`../src/data/${path}.json`]!()).length / 1024;

describe('the data of the world', () => {
  test('the land by height is six steps, each within the one before it and wound as the cut reads it', async () => {
    for (const level of ['110m', '50m'] as const) {
      const height = await loadWorld('height', level);
      expect(height).toHaveLength(HEIGHTS.length);
      const areas = height.map((step) => step.coordinates.reduce((sum, polygon) => sum + areaOf(polygon), 0));
      // Wound the other way a plateau would be all the Earth but the plateau.
      for (const step of height) for (const polygon of step.coordinates) expect(areaOf(polygon), level).toBeLessThan(half);
      for (let i = 1; i < areas.length; i++) expect(areas[i]!, `${level} step ${i}`).toBeLessThan(areas[i - 1]!);
      // About a tenth of the Earth is land over 1000 m, and Tibet and the Andes are what is over 4500 m.
      expect(areas[2]! / (4 * Math.PI)).toBeGreaterThan(0.05);
      expect(areas[2]! / (4 * Math.PI)).toBeLessThan(0.12);
      expect(areas[5]! / (4 * Math.PI)).toBeLessThan(0.006);
    }
    expect(await loadWorld('height', '10m')).toBe(await loadWorld('height', '50m'));
    expect(worldNow('height', '110m')).not.toBe(worldNow('height', '50m'));
  });

  test('the biomes and the climates are a shape to a class, as many as there are colours and names for', async () => {
    const [biomes, climate] = [await loadWorld('biomes', '110m'), await loadWorld('climate', '110m')];
    expect([biomes.length, BIOME_COLOURS.length, BIOME_NAMES.length]).toEqual([14, 14, 14]);
    expect([climate.length, CLIMATE_COLOURS.length, CLIMATE_NAMES.length]).toEqual([13, 13, 13]);
    // The legend's own short names are in the data's order.
    expect(biomes.map((biome) => biome.name)[5]).toBe('Boreal Forests/Taiga');
    expect(BIOME_NAMES[5]).toBe('Taiga');
    expect(biomes.at(-1)!.name).toBe('Mangroves');
    expect(climate.map((kind) => kind.code)).toEqual(CLIMATE_NAMES.map((name) => name.split(' ')[0]));
    for (const { name, geometry } of [...biomes, ...climate]) {
      expect(geometry.coordinates.length, name).toBeGreaterThan(0);
      for (const polygon of geometry.coordinates) expect(areaOf(polygon), name).toBeLessThan(half);
    }
    // The deserts are the largest biome, and the Sahara is desert in both.
    const sizes = biomes.map((biome) => geoArea(biome.geometry));
    expect(sizes.indexOf(Math.max(...sizes))).toBe(12);
  });

  test('ice, time zones, lines and places are what they say', async () => {
    for (const level of ['110m', '50m', '10m'] as const) {
      const ice = await loadWorld('ice', level);
      for (const polygon of ice.coordinates) expect(areaOf(polygon), level).toBeLessThan(half);
      // Greenland and Antarctica: about a thirtieth of the Earth.
      expect(geoArea(ice) / (4 * Math.PI)).toBeGreaterThan(0.02);
      expect((await loadWorld('provinces', level)).coordinates.length).toBeGreaterThan(40);
    }
    const zones = await loadWorld('zones', '110m');
    for (const part of [zones.odd, zones.part]) for (const polygon of part.coordinates) expect(areaOf(polygon)).toBeLessThan(half);
    // Every other hour is about half the Earth, and the zones of a half or a quarter hour are few: India, Iran, the middle of Australia.
    expect(geoArea(zones.odd) / (4 * Math.PI)).toBeGreaterThan(0.35);
    expect(geoArea(zones.odd) / (4 * Math.PI)).toBeLessThan(0.6);
    expect(geoArea(zones.part) / (4 * Math.PI)).toBeLessThan(0.06);
    expect(zones.lines.coordinates.length).toBeGreaterThan(20);
    expect((await loadWorld('dateline', '110m')).coordinates.flat().every(([lon]) => Math.abs(lon!) >= 150)).toBe(true);
    expect((await loadWorld('plates', '110m')).coordinates.length).toBeGreaterThan(100);
    const cities = await loadWorld('cities', '110m');
    // The most important first, and every capital among them.
    expect(cities.map((city) => city[3])).toEqual(cities.map((city) => city[3]).sort((a, b) => a - b));
    expect(cities.filter((city) => city[4] === 1).length).toBeGreaterThan(190);
    expect(cities.find((city) => city[0] === 'Stockholm')).toMatchObject(['Stockholm', expect.closeTo(18.1, 0), expect.closeTo(59.3, 0), expect.any(Number), 1]);
    const peaks = await loadWorld('peaks', '110m');
    expect(Math.max(...peaks.map((peak) => peak[3]))).toBeGreaterThan(8800);
    expect((await loadWorld('regions', '110m')).map((region) => region.name)).toEqual(expect.arrayContaining(['SAHARA', 'HIMALAYAS']));
    expect((await loadWorld('volcanoes', '110m')).length).toBeGreaterThan(1000);
    const quakes = await loadWorld('quakes', '110m');
    expect(quakes[0]![2]).toBe(9.5);
    expect(quakes.every((quake) => quake[2] >= 7)).toBe(true);
  });

  test('no file is more than two megabytes, and what the map starts with has none of them', async () => {
    for (const name of ['world/height-coarse', 'world/height-fine', 'world/biomes', 'world/climate', 'world/plates', 'world/volcanoes', 'world/quakes', 'ne/zones', 'ne/cities', 'ne/regions', 'ne/peaks', 'ne/dateline', ...['110m', '50m', '10m'].flatMap((level) => [`ne/ice-${level}`, `ne/provinces-${level}`])]) {
      expect(await kB(name), name).toBeLessThan(2048);
    }
    expect(await kB('world/height-coarse')).toBeLessThan(400);
    // They are fetched when asked for: nothing but the two loaders names them.
    const loader = await texts['../src/data/world.ts']!();
    expect(loader.match(/import\('\.\/(world|ne)\//g)).toHaveLength(18);
  });
});

describe('what a picture is cut from', () => {
  test('a picture needs what its layers are drawn and lettered from, and nothing else', () => {
    expect(worldNeeds(DEFAULT_LAYERS)).toEqual([]);
    expect(worldNeeds(layers({ ice: true, capitals: true, cities: true, quakes: true }, { cover: 'biomes' })).sort()).toEqual(['biomes', 'cities', 'ice', 'quakes']);
    expect(worldNeeds(layers({ regionNames: true, peaks: true, zones: true, dateLine: true, plates: true, provinces: true, volcanoes: true }, { cover: 'height' })).sort()).toEqual(['dateline', 'height', 'peaks', 'plates', 'provinces', 'regions', 'volcanoes', 'zones']);
  });

  test('what colours the land takes the place of the political colours, with the land under it whatever the map shows', async () => {
    const mollweide = robinson.compiled;
    const NONE: GeoJSON.GeometryCollection = { type: 'GeometryCollection', geometries: [] };
    const wanted = layers({ political: true, land: false, ice: true, zones: true, dateLine: true, plates: true, provinces: true }, { cover: 'height' });
    await loadPictureData(wanted, '110m');
    const data = withPictureData(COARSE, '110m');
    expect(withPictureData(COARSE, '110m')).toBe(data);
    const cut = sceneLayers(wanted, [mollweide], NONE, data);
    expect(Object.keys(cut).filter((name) => /political/.test(name))).toEqual([]);
    expect(cut.land).toBe(LAND);
    expect([0, 1, 2, 3, 4, 5].map((i) => cut[`height${i}`])).toEqual(await loadWorld('height', '110m'));
    expect(Object.keys(cut)).toEqual(expect.arrayContaining(['ice', 'zonesOdd', 'zonesPart', 'zoneLines', 'dateLine', 'plates', 'provinces']));
    // The biomes and climates likewise, a layer to a class, the same objects every time.
    for (const cover of ['biomes', 'climate'] as const) {
      await loadPictureData(layers({}, { cover }), '110m');
      const names = Object.keys(sceneLayers(layers({}, { cover }), [mollweide], NONE, withPictureData(COARSE, '110m'))).filter((name) => name.startsWith(cover));
      expect(names).toHaveLength(cover === 'biomes' ? 14 : 13);
      expect(withPictureData(COARSE, '110m')[cover]).toBe(withPictureData(COARSE, '110m')[cover]);
    }
    // As the map has it, there is none of it, though the data is here.
    expect(Object.keys(sceneLayers(DEFAULT_LAYERS, [mollweide], NONE, withPictureData(COARSE, '110m'))).sort()).toEqual(['coast', 'drawings', 'graticule', 'land', 'ocean']);
  });

  test('what colours the land is drawn within the land, on the canvas and in a drawing', () => {
    const ops: { op: string; style: string }[] = [];
    const ctx = {
      canvas: { width: 100, height: 100 }, fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1, lineJoin: '', lineCap: '',
      getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }), setTransform() {}, setLineDash() {},
      save: () => void ops.push({ op: 'save', style: '' }), restore: () => void ops.push({ op: 'restore', style: '' }), clip: () => void ops.push({ op: 'clip', style: '' }),
      beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, fillRect() {},
      fill: () => void ops.push({ op: 'fill', style: ctx.fillStyle }), stroke: () => void ops.push({ op: 'stroke', style: ctx.strokeStyle }),
    };
    const square = new Float32Array([0, 0, 10, 0, 10, 10, 0, 10]);
    const piece = (closed = true): ScenePiece => ({ closed, src: square, dst: square, ringStarts: new Uint32Array([0]), alphaSrc: 1, alphaDst: 1, behind: false, out: false });
    const scene = (names: string[]): Scene => ({ layers: Object.fromEntries(names.map((name) => [name, [piece(name !== 'coast')]])), indicatrices: [] });
    drawScene(ctx as unknown as CanvasRenderingContext2D, scene(['ocean', 'land', 'height0', 'height3', 'ice', 'coast']), 0, style);
    // One clip to the land for all the steps, which is let go before the ice.
    expect(ops.map((o) => (o.op === 'fill' || o.op === 'stroke' ? `${o.op} ${o.style}` : o.op))).toEqual([
      `fill ${style.ocean}`, `fill ${style.land}`, 'save', 'clip', `fill ${style.height[0]}`, `fill ${style.height[3]}`, 'restore', `fill ${style.ice}`, `stroke ${style.coast}`,
    ]);
    // With no land there is nothing to be within, and none of it.
    ops.length = 0;
    drawScene(ctx as unknown as CanvasRenderingContext2D, scene(['ocean', 'biomes2', 'ice']), 0, style);
    expect(ops.map((o) => o.style)).toEqual([style.ocean, style.ice]);

    const m = member('mollweide');
    const real = buildScene({ ocean: { type: 'Sphere' } as never, land: LAND, climate4: worldNow('climate', '110m')![4]!.geometry }, [m], null, false);
    const svg = sceneToSvg(real, style, VIEW, { background: null, lineScale: 1 });
    expect(svg).toContain('<clipPath id="within-land"><use href="#land-shape"/></clipPath>');
    expect(svg).toMatch(new RegExp(`<g id="climate4" clip-path="url\\(#within-land\\)">\\s*<path fill-rule="nonzero" fill="${style.climate[4]}"`));
    expect(DRAW_ORDER.filter((entry) => entry.within).every((entry) => entry.within === 'land' && /^(height|biomes|climate)\d+$/.test(entry.layer))).toBe(true);
  });

  test('the land by height is mixed evenly from the land to its highest in every theme, and the title box is the page unless it has a colour', () => {
    for (const theme of ['light', 'dark', 'atlas', 'blueprint', 'print', 'poster', 'parchment', 'slate', 'moss'] as const) {
      const palette = resolvePalette(theme, {}, 'light');
      const made = styleOf(palette);
      expect(made.height, theme).toHaveLength(6);
      expect(made.height.at(-1), theme).toBe(palette.high);
      expect(new Set([palette.land, ...made.height]).size, theme).toBe(7);
      expect(made.box, theme).toBe(palette.paper);
    }
    expect(styleOf(resolvePalette('atlas', { box: '#ffeecc' }, 'light')).box).toBe('#ffeecc');
  });
});

describe('the legend, and whose the data is', () => {
  test('it says what colours the land, the depths, and the marks and lines, and nothing of a plain map', () => {
    expect(legendSections(DEFAULT_LAYERS)).toEqual([]);
    const height = legendSections(layers({ depth: true, ice: true }, { cover: 'height' }));
    expect(height.map((section) => section.title)).toEqual(['Height', 'Sea depth', '']);
    expect(height[0]!.rows.map((row) => row.text)).toEqual(['over 4500 m', '3000 – 4500 m', '2000 – 3000 m', '1000 – 2000 m', '500 – 1000 m', '200 – 500 m', 'under 200 m']);
    expect(height[1]!.rows.map((row) => row.text)).toEqual(['under 200 m', '200 – 2000 m', '2000 – 4000 m', '4000 – 6000 m', 'over 6000 m']);
    // Each patch is the map's own colour.
    expect(height[0]!.rows.map((row) => patchColour(style, row.sample as never))).toEqual([...[...style.height].reverse(), style.land]);
    expect(patchColour(style, height[2]!.rows[0]!.sample as never)).toBe(style.ice);
    expect(legendSections(layers({}, { cover: 'biomes' }))[0]!.rows.map((row) => row.text)).toEqual(BIOME_NAMES);
    expect(legendSections(layers({}, { cover: 'climate' }))[0]!.rows).toHaveLength(13);
    const marks = legendSections(layers({ cities: true, peaks: true, plates: true, volcanoes: true, quakes: true, provinces: true, dateLine: true }));
    expect(marks).toHaveLength(1);
    expect(marks[0]!.rows.map((row) => Object.values(row.sample)[0])).toEqual(['capital', 'city', 'peak', 'provinces', 'dateLine', 'plates', 'volcano', 'quake']);
  });

  test('Natural Earth is always a source, and the others where their data is shown', () => {
    expect(sourcesOf(DEFAULT_LAYERS)).toEqual(['Natural Earth']);
    expect(sourcesOf(layers({ rivers: true, ice: true, cities: true, zones: true }))).toEqual(['Natural Earth']);
    expect(sourcesOf(layers({ plates: true, volcanoes: true, quakes: true }, { cover: 'biomes' }))).toEqual(['Natural Earth', 'RESOLVE Ecoregions 2017 (CC BY 4.0)', 'P. Bird and H. Ahlenius, Nordpil (ODC-By)', 'NOAA NCEI', 'USGS']);
    expect(sourcesOf(layers({}, { cover: 'climate' }))[1]).toBe('Beck et al. 2018 (CC BY 4.0)');
    expect(sourcesOf(layers({}, { cover: 'height' }))[1]).toBe('NOAA ETOPO5');
  });

  test('the legend is as wide as its widest row, in the place chosen, and beside the title box where the two would meet', () => {
    const state = robinson.compiled.state;
    const plate = (state_: LayerState) => buildPlate(state, stopOf('robinson'), state_, PICTURE, measure.plate);
    const alone = plate(layers({}, { cover: 'biomes', legendCorner: 'bl' })).legend!;
    expect(alone.samples).toHaveLength(14);
    // With no title box to say it, the legend says whose the biomes are.
    expect(alone.texts.at(-1)!.text).toBe('Data: RESOLVE Ecoregions 2017 (CC BY 4.0)');
    expect(alone.x).toBeLessThan(40);
    expect(alone.y + alone.height).toBeGreaterThan(VIEW.height - 40);
    for (const text of alone.texts) expect(text.x + measure.plate(text.text) * text.size).toBeLessThanOrEqual(alone.x + alone.width);
    for (const { box } of alone.samples) expect(box.x >= alone.x && box.y >= alone.y && box.y + box.height <= alone.y + alone.height).toBe(true);
    expect(plate(layers({}, { cover: 'biomes', legendCorner: 'tr' })).legend!.x).toBeGreaterThan(VIEW.width / 2);

    // With the title box, the box says it, and the legend does not.
    const both = plate(layers({ titleBox: true }, { cover: 'biomes', corner: 'tr', legendCorner: 'tr' }));
    expect(both.box!.lines.at(-1)!.text).toBe('Data: Natural Earth, RESOLVE Ecoregions 2017 (CC BY 4.0)');
    expect(both.legend!.texts.some((text) => text.text.startsWith('Data'))).toBe(false);
    expect(both.legend!.y).toBeGreaterThan(both.box!.y + both.box!.height);
    const low = plate(layers({ titleBox: true }, { cover: 'height', corner: 'br', legendCorner: 'br' }));
    expect(low.legend!.y + low.legend!.height).toBeLessThan(low.box!.y);
    // Natural Earth alone is said as it always was.
    expect(plate(layers({ titleBox: true })).box!.lines.at(-1)!.text).toBe('Made with Natural Earth');

    // Turned off, there is none; and what is owed is then said in a line at the foot of the picture.
    const off = plate(layers({ legend: false }, { cover: 'climate' }));
    expect(off.legend).toBeNull();
    expect(off.credit).toMatchObject({ text: 'Data: Natural Earth, Beck et al. 2018 (CC BY 4.0)' });
    expect(off.credit!.y).toBeGreaterThan(VIEW.height - 20);
    expect(plate(layers({ legend: false, rivers: true })).credit).toBeNull();
    expect(overlayWanted(layers({}, { cover: 'climate' }))).toBe(true);
    expect(lettersWanted(layers({}, { cover: 'climate' }))).toBe(false);
    expect(layoutLegend([], [], 1, measure.plate).samples).toEqual([]);
  });
});

describe('places, marks and hours', () => {
  const texts = (labels: Label[], kind: Label['kind']) => labels.filter((label) => label.kind === kind).map((label) => label.text);

  test('capitals and cities are marked and named, the most important first, more of them the smaller a name may be', async () => {
    const [cities, peaks] = [await loadWorld('cities', '110m'), await loadWorld('peaks', '110m')];
    const built = (on: { capitals?: boolean; cities?: boolean; peaks?: boolean }, smallest: number, scale = 1) =>
      buildPoints(robinson, PICTURE, { capitals: false, cities: false, peaks: false, ...on, smallest, scale }, measure.label, cities, peaks, []);
    const capitals = built({ capitals: true }, 4);
    expect(texts(capitals, 'capital')).toEqual(expect.arrayContaining(['Tokyo', 'Moscow', 'Cairo']));
    expect(texts(capitals, 'city')).toEqual([]);
    const some = built({ cities: true }, 4);
    // Cities come with the capitals among them.
    expect(texts(some, 'capital').length).toBeGreaterThan(20);
    expect(texts(some, 'city')).toEqual(expect.arrayContaining(['New York', 'Shanghai']));
    const more = built({ cities: true }, 2);
    expect(more.length).toBeGreaterThan(some.length * 1.5);
    // No two touch, and each has its mark where the city is, covered with its name.
    const taken = new Taken(40);
    for (const label of more) {
      expect(taken.touches(label), label.text).toBe(false);
      taken.add(label);
      expect(label.mark).toBeDefined();
      expect(label.discs.at(-1)!.slice(0, 2)).toEqual([label.mark!.x, label.mark!.y]);
    }
    // A picture twice as large has the same places, twice as large.
    const large = buildPoints({ ...robinson, screen: { ...robinson.screen, k: robinson.screen.k * 2, tx: robinson.screen.tx * 2, ty: robinson.screen.ty * 2 } }, { x: 0, y: 0, width: VIEW.width * 2, height: VIEW.height * 2 }, { capitals: true, cities: false, peaks: false, smallest: 4, scale: 2 }, measure.label, cities, peaks, []);
    expect(texts(large, 'capital')).toEqual(texts(capitals, 'capital'));
    expect(large[0]!.size).toBeCloseTo(2 * capitals[0]!.size, 6);
    // Peaks have their height after their name.
    expect(texts(built({ peaks: true }, 2), 'peak').some((text) => /^Mount Everest 88\d\d$/.test(text))).toBe(true);
    // And until the lists have come there are none.
    expect(buildPoints(robinson, PICTURE, { capitals: true, cities: true, peaks: true, smallest: 1, scale: 1 }, measure.label, null, null, [])).toEqual([]);
  });

  test('a name that is moved leaves its mark where the place is', async () => {
    const [label] = buildPoints(robinson, PICTURE, { capitals: true, cities: false, peaks: false, smallest: 4, scale: 1 }, measure.label, await loadWorld('cities', '110m'), null, []);
    const moved = editLabels([label!], withMove({ moved: {}, removed: [] }, `capital:${label!.text}`, [0.05, 0.02]), 1000)[0]!.label;
    expect(moved.glyphs[0]!.x).toBeCloseTo(label!.glyphs[0]!.x + 50, 6);
    expect(moved.mark).toEqual(label!.mark);
    expect(moved.discs.at(-1)).toEqual(label!.discs.at(-1));
    expect(moved.discs[0]![0]).toBeCloseTo(label!.discs[0]![0] + 50, 6);
  });

  test('volcanoes and earthquakes are marks with no name, an earthquake the larger for its magnitude', async () => {
    const [volcanoes, quakes] = [await loadWorld('volcanoes', '110m'), await loadWorld('quakes', '110m')];
    const marks = buildMarks(robinson, PICTURE, 1, volcanoes, quakes);
    expect(marks.filter((mark) => mark.kind === 'volcano').length).toBeGreaterThan(1000);
    const rings = marks.filter((mark) => mark.kind === 'quake');
    expect(rings.length).toBe(quakes.length);
    // The greatest is drawn last of them, over the rest.
    expect(rings.at(-1)!.r).toBe(Math.max(...rings.map((ring) => ring.r)));
    expect(rings.at(-1)!.r).toBeGreaterThan(3 * rings[0]!.r);
    expect(buildMarks(robinson, PICTURE, 3, volcanoes, null)[0]!.r).toBeCloseTo(3 * marks.find((mark) => mark.kind === 'volcano')!.r, 6);
    expect(buildMarks(robinson, PICTURE, 1, null, null)).toEqual([]);
  });

  test('the hours of the time zones are written along the Southern Ocean, from UTC', () => {
    expect([0, 1, -5, 12, -11].map(hoursText)).toEqual(['UTC', '+1', '−5', '±12', '−11']);
    const hours = buildHours(robinson, PICTURE, 1, measure.label, []);
    expect(hours.map((label) => label.text)).toEqual(['−11', '−10', '−9', '−8', '−7', '−6', '−5', '−4', '−3', '−2', '−1', 'UTC', '+1', '+2', '+3', '+4', '+5', '+6', '+7', '+8', '+9', '+10', '+11', '±12']);
    const xs = hours.map((label) => label.glyphs[0]!.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(new Set(hours.map((label) => Math.round(label.glyphs[0]!.y))).size).toBe(1);
    // One that would lie on lettering already there is left out.
    expect(buildHours(robinson, PICTURE, 1, measure.label, [hours[11]!]).map((label) => label.text)).not.toContain('UTC');
  });

  test('everything over a picture: the lettering in its order, the marks, and the boxes over both, in a drawing too', async () => {
    const state = layers({ countryNames: true, regionNames: true, capitals: true, peaks: true, zones: true, volcanoes: true, quakes: true, titleBox: true }, { cover: 'height', smallestName: 2 });
    await loadPictureData(state, '110m');
    const world = { regions: worldNow('regions', '110m'), cities: worldNow('cities', '110m'), peaks: worldNow('peaks', '110m'), volcanoes: worldNow('volcanoes', '110m'), quakes: worldNow('quakes', '110m') };
    const letters = buildLetters(input(state), measure, null, LAND, world);
    const kinds = [...new Set(letters.map((label) => label.kind))];
    expect(kinds).toEqual(['country', 'region', 'zone', 'capital', 'peak']);
    // Until the data has come, there are the countries and the hours, which need none.
    expect([...new Set(buildLetters(input(state), measure, null, LAND).map((label) => label.kind))]).toEqual(['country', 'zone']);
    const overlay = buildOverlay(input(state), measure, null, LAND, world);
    const { box, legend } = overlay.plate;
    expect(box && legend).toBeTruthy();
    // Nothing lies under either box.
    for (const b of [box!, legend!]) {
      for (const mark of overlay.marks) expect(mark.x + mark.r > b.x && mark.x - mark.r < b.x + b.width && mark.y + mark.r > b.y && mark.y - mark.r < b.y + b.height).toBe(false);
      for (const label of overlay.labels) for (const [x, y] of label.discs) expect(x > b.x && x < b.x + b.width && y > b.y && y < b.y + b.height, label.text).toBe(false);
    }
    const svg = overlayToSvg(overlay, style, '').join('\n');
    for (const id of ['earthquakes', 'volcanoes', 'names', 'region-names', 'hours', 'capitals', 'peaks', 'legend', 'plate']) expect(svg, id).toContain(`<g id="${id}"`);
    expect(svg.indexOf('<g id="earthquakes"')).toBeLessThan(svg.indexOf('<g id="names"'));
    expect(svg).toContain('>over 4500 m</text>');
    expect(svg).toContain(`fill="${style.height[5]}"`);
    // A capital is a ring with a dot in it, in the names' colour.
    expect(svg).toMatch(new RegExp(`<g id="capitals"[^>]*>\\s*<circle [^>]* stroke="${style.labels}"[^>]*/><circle `));
  });
});
