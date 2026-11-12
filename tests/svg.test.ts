import { describe, expect, test } from 'vitest';
import { shapeToGeoJSON, type Shape } from '../src/drawing/model';
import { sceneToSvg } from '../src/export/svg';
import { LAND } from '../src/data/land';
import { buildOverlay, overlayToSvg } from '../src/overlay/overlay';
import { stopOf } from './stopOf';
import { DEFAULT_LAYERS, DRAW_ORDER, sceneLayers } from '../src/layers/layers';
import { buildScene } from '../src/morph/scene';
import { mapStyle } from '../src/render/style';
import { member, ringsOf, VIEW } from './sceneSupport';

const STYLE = mapStyle('light');

const SHAPES: Shape[] = [
  { kind: 'line', points: [[-40, -30], [40, 30]] },
  { kind: 'circle', center: [100, 20], radiusDeg: 15 },
];

const EVERY = Object.fromEntries(Object.keys(DEFAULT_LAYERS.on).map((layer) => [layer, true])) as typeof DEFAULT_LAYERS.on;

/** A map at rest as the app builds it, with every layer on unless told which. The political map stands in for the land where it is on. */
function sceneOf(id: string, on = EVERY) {
  const m = member(id);
  const drawings: GeoJSON.GeometryCollection = { type: 'GeometryCollection', geometries: SHAPES.map(shapeToGeoJSON) };
  return buildScene(sceneLayers({ ...DEFAULT_LAYERS, on }, [m.compiled], drawings), [m], null, { step: 30 });
}

const scene = sceneOf('mollweide');
const svg = sceneToSvg(scene, STYLE, VIEW, { background: STYLE.background, lineScale: 1 });

/** The tags of a document in order: its name, whether it opens, closes, or does both, and its text. */
const tagsOf = (text: string) => [...text.matchAll(/<(\/?)([a-zA-Z]+)((?:\s+[a-zA-Z:-]+="[^"<>]*")*)\s*(\/?)>/g)].map((m) => ({ name: m[2]!, closes: m[1] === '/', empty: m[4] === '/', attributes: m[3]!, text: m[0] }));

/** The inside of the group with an id. */
const groupOf = (text: string, id: string) => text.match(new RegExp(`<g id="${id}"[^>]*>([\\s\\S]*?)</g>`))?.[1];

describe('a map at rest as SVG', () => {
  test('it is one well-formed document: every tag is closed in turn, and nothing is left between them', () => {
    const tags = tagsOf(svg);
    const open: string[] = [];
    for (const tag of tags) {
      if (tag.empty) continue;
      if (tag.closes) expect(open.pop()).toBe(tag.name);
      else open.push(tag.name);
    }
    expect(open).toEqual([]);
    expect(tags[0]!.name).toBe('svg');
    expect(tags.at(-1)).toMatchObject({ name: 'svg', closes: true });
    // All of it is tags: there is no stray text, and no tag the pattern could not read.
    expect(svg.replace(/<(\/?)([a-zA-Z]+)((?:\s+[a-zA-Z:-]+="[^"<>]*")*)\s*(\/?)>/g, '').trim()).toBe('');
    expect(tags[0]!.attributes).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  test('its size is the window\'s', () => {
    expect(svg).toContain(`viewBox="0 0 ${VIEW.width} ${VIEW.height}"`);
    expect(svg).toContain(`width="${VIEW.width}"`);
    expect(svg).toContain(`height="${VIEW.height}"`);
  });

  test('a group for each layer, in the order they are painted, and the indicatrices last', () => {
    const ids = [...svg.matchAll(/<g id="([^"]+)"/g)].map((m) => m[1]!);
    const painted = DRAW_ORDER.map((p) => p.layer).filter((layer) => ids.includes(layer));
    expect(ids).toEqual([...painted, 'tissot']);
    for (const layer of ['ocean', 'political0', 'political4', 'graticule', 'reference', 'borders', 'coast', 'drawings']) expect(ids).toContain(layer);
    // Mollweide has no parallel of true scale, and at rest no line is on its way in or out.
    expect(ids).not.toContain('standardIn');
  });

  test('the land has a subpath for each ring of the scene\'s land', () => {
    const plain = sceneOf('mollweide', DEFAULT_LAYERS.on);
    const land = groupOf(sceneToSvg(plain, STYLE, VIEW, { background: null, lineScale: 1 }), 'land')!;
    const rings = plain.layers.land!.reduce((n, piece) => n + ringsOf(piece).length, 0);
    expect(rings).toBeGreaterThan(100);
    expect(land.match(/M/g)).toHaveLength(rings);
    expect(land).toContain('fill-rule="nonzero"');
  });

  test('no number has more than two decimals', () => {
    expect(svg).not.toMatch(/\.\d{3}/);
    expect(svg).not.toMatch(/NaN|Infinity|e-\d/);
  });

  test('a background is a rectangle over it all, and none leaves it clear', () => {
    expect(svg).toContain(`<rect width="${VIEW.width}" height="${VIEW.height}" fill="${STYLE.background}"/>`);
    const clear = sceneToSvg(scene, STYLE, VIEW, { background: null, lineScale: 1 });
    expect(clear).not.toContain('<rect');
    expect(clear.length).toBeLessThan(svg.length);
  });

  test('a colour that is see-through is written as a colour and an opacity', () => {
    expect(svg).not.toMatch(/rgba\(/);
    expect(groupOf(svg, 'tissot')).toBeDefined();
    expect(svg).toMatch(/<g id="tissot" clip-path="url\(#outline\)" fill="rgb\(\d+,\d+,\d+\)" fill-opacity="0?\.\d+"/);
    expect(svg).toContain('<clipPath id="outline">');
  });

  test('an indicatrix is a circle under its matrix, and one cut at a seam is the part of it that is left', () => {
    const whole = groupOf(svg, 'tissot')!.match(/<circle r="1" transform="matrix\([^)]+\)"/g)!;
    const cut = scene.indicatrices.filter((m) => m.alphaSrc > 0 && m.cuts.length > 0 && m.cuts.every((c) => c[2] > -1));
    expect(whole).toHaveLength(scene.indicatrices.filter((m) => m.alphaSrc > 0 && m.cuts.length === 0).length);
    expect(cut.length).toBeGreaterThan(0);
    expect(groupOf(svg, 'tissot')!.match(/<path /g)).toHaveLength(cut.length);
  });

  test('lines are as wide as on screen times the line scale, dashes with them', () => {
    const doubled = sceneToSvg(scene, STYLE, VIEW, { background: null, lineScale: 2 });
    expect(svg).toMatch(new RegExp(`<g id="coast">\\s*<path[^>]* stroke-width="${STYLE.coastWidth}"`));
    expect(doubled).toMatch(new RegExp(`<g id="coast">\\s*<path[^>]* stroke-width="${2 * STYLE.coastWidth}"`));
    expect(svg).toMatch(/<g id="reference">\s*<path[^>]* stroke-dasharray="5 4"/);
    expect(doubled).toMatch(/<g id="reference">\s*<path[^>]* stroke-dasharray="10 8"/);
  });

  test('what a map does not show is not in it: the far side of the globe', () => {
    const scene = sceneOf('globe', DEFAULT_LAYERS.on);
    const globe = sceneToSvg(scene, STYLE, VIEW, { background: null, lineScale: 1 });
    const shown = scene.layers.land!.filter((p) => p.alphaSrc > 0);
    expect(groupOf(globe, 'land')!.match(/M/g)).toHaveLength(shown.reduce((n, piece) => n + ringsOf(piece).length, 0));
    // Nothing of it is outside the globe's disc, which is as high as the window less its margins.
    const xs = [...groupOf(globe, 'land')!.matchAll(/[ML](-?[\d.]+) /g)].map((m) => Number(m[1]));
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(VIEW.height);
  });
});

describe('what is over a map, as SVG', () => {
  const measure = { label: (text: string) => 0.62 * text.length, plate: (text: string) => 0.6 * text.length };
  const on = { ...DEFAULT_LAYERS.on, countryNames: true, degrees: true, frame: true, titleBox: true };
  const m = member('mercator');
  const overlay = buildOverlay({ member: m, state: m.compiled.state, named: stopOf('mercator'), layers: { ...DEFAULT_LAYERS, on, subtitle: 'Fish & <chips>' }, picture: { x: 0, y: 0, ...VIEW }, scale: 1 }, measure, null, LAND);
  const parts = overlayToSvg(overlay, STYLE, '@font-face{font-family:Jost}');
  const text = parts.join('\n');

  test('with nothing over the map there is nothing, and a drawing without it is as it always was', () => {
    expect(overlayToSvg({ labels: [], plate: { frame: null, frameWidth: 1, hairline: 1, box: null } }, STYLE, 'x')).toEqual([]);
    expect(sceneToSvg(scene, STYLE, VIEW, { background: STYLE.background, lineScale: 1 }, [])).toBe(svg);
  });

  test('the parts go in before the drawing ends, and it is still well formed', () => {
    const whole = sceneToSvg(scene, STYLE, VIEW, { background: null, lineScale: 1 }, parts);
    expect(whole.endsWith(`${parts.at(-1)}\n</svg>`)).toBe(true);
    const open: string[] = [];
    for (const tag of tagsOf(whole)) {
      if (tag.empty) continue;
      if (tag.closes) expect(open.pop()).toBe(tag.name);
      else open.push(tag.name);
    }
    expect(open).toEqual([]);
  });

  test('each name is one text with a place and a turn for every letter, in a group of its kind and colour', () => {
    const names = groupOf(text, 'names')!;
    expect(text).toContain(`<g id="names" font-family="Jost, &quot;Avenir Next&quot;, Futura, &quot;Century Gothic&quot;, sans-serif" font-weight="500" fill="${STYLE.labels}">`);
    const brazil = names.match(/<text font-size="([\d.]+)" x="([^"]+)" y="([^"]+)" rotate="([^"]+)">BRAZIL<\/text>/)!;
    expect(brazil).not.toBeNull();
    const label = overlay.labels.find((one) => one.text === 'BRAZIL')!;
    expect(Number(brazil[1])).toBeCloseTo(label.size, 1);
    expect(brazil[2]!.split(' ').map(Number)).toEqual(label.glyphs.map((g) => expect.closeTo(g.x, 1)));
    expect(brazil[3]!.split(' ').map(Number)).toEqual(label.glyphs.map((g) => expect.closeTo(g.y, 1)));
    expect(brazil[4]!.split(' ').map(Number)).toEqual(label.glyphs.map((g) => expect.closeTo((g.angle * 180) / Math.PI, 1)));
    // A name of two words has a place for its space too, so that the letters after it are not one out.
    const two = overlay.labels.find((one) => one.kind === 'country' && one.text.includes(' '))!;
    const found = names.match(new RegExp(`x="([^"]+)" y="[^"]+" rotate="[^"]+">${two.text}<`))!;
    expect(found[1]!.split(' ')).toHaveLength(two.text.length);
    expect(groupOf(text, 'degrees')).toContain('°N</text>');
    expect(text).toContain(`<g id="degrees" font-family`);
    expect(groupOf(text, 'sea-names')).toBeUndefined();
  });

  test('the frame, the box and its lines are there, the typeface with them, and what was typed cannot break the drawing', () => {
    const plate = groupOf(text, 'plate')!;
    expect(parts[0]).toBe('<style>@font-face{font-family:Jost}</style>');
    const { frame, box } = overlay.plate;
    const rect = plate.match(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" fill="none" stroke="(#[0-9a-f]+)"/)!;
    expect(rect.slice(1, 5).map(Number)).toEqual([frame!.x, frame!.y, frame!.width, frame!.height].map((v) => expect.closeTo(v, 1)));
    expect(rect[5]).toBe(STYLE.ink);
    expect(plate).toContain(`fill="${STYLE.background}" stroke="${STYLE.ink}"`);
    expect(plate).toMatch(/<text x="[\d.]+" y="[\d.]+" font-size="[\d.]+" font-weight="700" letter-spacing="[\d.]+">THE WORLD<\/text>/);
    expect(plate).toContain('>FISH &amp; &lt;CHIPS&gt;</text>');
    expect(plate).toContain('>MERCATOR PROJECTION</text>');
    expect(plate).toContain('<line ');
    expect(box!.lines).toHaveLength(5);
    // With no typeface to carry, there is no style.
    expect(overlayToSvg(overlay, STYLE, '')[0]).not.toContain('<style>');
  });
});
