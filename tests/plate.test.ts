import { describe, expect, test } from 'vitest';
import { DEFAULT_LAYERS, type Corner, type LayerState } from '../src/layers/layers';
import { buildPlate, FRAME_MARGIN, paddingFor, pictureRect, settingsLine, type Plate, type Rect } from '../src/plate/plate';
import { compile, stateForStop } from '../src/projections/compile';
import { computeScreen, mapSize, PADDING } from '../src/screen/screen';
import { FIT } from '../src/screen/view';
import { stopOf } from './stopOf';
import { VIEW } from './sceneSupport';

const measure = (text: string) => 0.6 * text.length;
const layers = (on: Partial<LayerState['on']>, rest: Partial<LayerState> = {}): LayerState => ({ ...DEFAULT_LAYERS, ...rest, on: { ...DEFAULT_LAYERS.on, ...on } });
const bonne = stateForStop(stopOf('bonne'));
const PICTURE: Rect = { x: 100, y: 50, width: 1000, height: 1000 };
const inside = (inner: Rect, outer: Rect) => inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
const plate = (on: Partial<LayerState['on']>, rest: Partial<LayerState> = {}, picture = PICTURE): Plate => buildPlate(bonne, stopOf('bonne'), layers(on, rest), picture, measure);
const widthOf = (line: { text: string; size: number; gap: number }) => line.size * measure(line.text) + line.gap * (line.text.length - 1);

describe('the margin and the picture', () => {
  test('a frame has more margin round the map, and the fit can be given any margin', () => {
    expect(paddingFor(DEFAULT_LAYERS)).toBe(PADDING);
    expect(paddingFor(layers({ frame: true }))).toBe(PADDING + FRAME_MARGIN);
    const c = compile(stateForStop(stopOf('equirectangular')));
    expect(computeScreen(c, VIEW)).toEqual(computeScreen(c, VIEW, PADDING));
    const [plain, wide] = [mapSize(c, VIEW), mapSize(c, VIEW, 40)];
    expect(plain.width).toBeCloseTo(VIEW.width - 2 * PADDING, 6);
    expect(wide.width).toBeCloseTo(VIEW.width - 80, 6);
    // Twice as wide as tall, but for a sliver at each pole.
    expect(wide.height).toBeCloseTo(wide.width / 2, -1);
  });

  test('the picture is the map and its margin at the fit, in the middle of the window, and the window when zoomed in', () => {
    const c = compile(stateForStop(stopOf('equirectangular')));
    const picture = pictureRect(c, VIEW, FIT, 40);
    expect(picture.width).toBeCloseTo(VIEW.width, 6);
    expect(picture.height).toBeCloseTo(mapSize(c, VIEW, 40).height + 80, 6);
    expect(picture.x).toBeCloseTo(0, 6);
    expect(picture.y).toBeCloseTo((VIEW.height - picture.height) / 2, 6);
    expect(pictureRect(c, VIEW, { zoom: 3, panX: 10, panY: 0 }, 40)).toEqual({ x: 0, y: 0, ...VIEW });
  });
});

describe('the settings of a projection in a line', () => {
  test('its centre, and whatever is not as the projection has it by default', () => {
    expect(settingsLine(bonne)).toBe('Centre 0°');
    expect(settingsLine({ ...bonne, orientation: { lon: 10, lat: 0, tilt: 0 }, params: { ...bonne.params, phi1: 30 } })).toBe('Centre 10°E · Standard parallel 30°');
    expect(settingsLine({ ...bonne, orientation: { lon: -122.5, lat: 0, tilt: 0 } })).toBe('Centre 122.5°W');
    const globe = stateForStop(stopOf('globe'));
    expect(settingsLine({ ...globe, orientation: { lon: 20, lat: -35, tilt: 15 } })).toMatch(/^Centre 20°E 35°S/);
    // A tilt is said where the map can be tilted, and not where it cannot.
    const mercator = stateForStop(stopOf('mercator'));
    expect(settingsLine({ ...mercator, orientation: { lon: 0, lat: 0, tilt: 15 } }, stopOf('mercator').params)).toBe('Centre 0° · Tilt 15°');
    // Mercator is one setting of a cylinder; another setting of it is said.
    expect(settingsLine({ ...mercator, params: { ...mercator.params, spacing: 0.5 } }, stopOf('mercator').params)).toBe('Centre 0° · Vertical spacing 0.5');
    expect(settingsLine({ ...globe, orientation: { lon: 0, lat: 0, tilt: 15 } })).not.toContain('Tilt');
  });
});

describe('the frame and the title box', () => {
  test('with neither there is nothing', () => {
    expect(plate({})).toMatchObject({ frame: null, box: null });
  });

  test('the frame lies just inside the picture', () => {
    const { frame, frameWidth } = plate({ frame: true });
    expect(frame).toEqual({ x: 106, y: 56, width: 988, height: 988 });
    expect(frameWidth).toBeCloseTo(1.6, 9);
    expect(plate({ frame: true }).box).toBeNull();
  });

  test.each(['tl', 'tr', 'bl', 'br'] as Corner[])('the box sits in the %s corner, inside the frame, with all its lines inside it', (corner) => {
    const { frame, box } = plate({ frame: true, titleBox: true }, { corner });
    expect(inside(box!, frame!)).toBe(true);
    const [left, top] = [box!.x - PICTURE.x, box!.y - PICTURE.y];
    const [right, bottom] = [PICTURE.width - left - box!.width, PICTURE.height - top - box!.height];
    expect(corner[1] === 'l' ? left : right).toBeCloseTo(20, 6);
    expect(corner[0] === 't' ? top : bottom).toBeCloseTo(20, 6);
    for (const line of box!.lines) {
      expect(line.x).toBeCloseTo(box!.x + box!.width / 2, 6);
      expect(line.y).toBeGreaterThan(box!.y + line.size * 0.5);
      expect(line.y).toBeLessThan(box!.y + box!.height);
      expect(widthOf(line)).toBeLessThanOrEqual(box!.width - 1);
    }
    expect(box!.rule!.y).toBeGreaterThan(box!.lines[0]!.y);
  });

  test('it says the title, the projection and its settings, and where the map is from, top to bottom', () => {
    const { box } = plate({ titleBox: true }, { title: 'The World', subtitle: 'for the hall' });
    expect(box!.lines.map((line) => line.text)).toEqual(['THE WORLD', 'FOR THE HALL', 'BONNE PROJECTION', 'Centre 0°', 'Made with Natural Earth']);
    expect(box!.lines.map((line) => line.weight)).toEqual([700, 500, 500, 400, 400]);
    const ys = box!.lines.map((line) => line.y);
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
    expect(box!.lines[0]!.size).toBeGreaterThan(2 * box!.lines[1]!.size);
    // The rule is between what was typed and what is filled in.
    expect(box!.rule!.y).toBeGreaterThan(ys[1]!);
    expect(box!.rule!.y).toBeLessThan(ys[2]! - box!.lines[2]!.size * 0.7);
  });

  test('a title or a subtitle left empty has no line, and the box is that much shorter', () => {
    const both = plate({ titleBox: true }, { subtitle: 'a subtitle' }).box!;
    const one = plate({ titleBox: true }, { subtitle: '  ' }).box!;
    const none = plate({ titleBox: true }, { title: '', subtitle: '' }).box!;
    expect(one.lines.map((line) => line.text)).toEqual(['THE WORLD', 'BONNE PROJECTION', 'Centre 0°', 'Made with Natural Earth']);
    expect(none.lines.map((line) => line.text)).toEqual(['BONNE PROJECTION', 'Centre 0°', 'Made with Natural Earth']);
    expect(one.height).toBeLessThan(both.height);
    expect(none.height).toBeLessThan(one.height);
    expect(none.rule).toBeNull();
  });

  test('a title too long for the box is lettered smaller, and the box is never more than 0.45 of the picture', () => {
    const { box } = plate({ titleBox: true }, { title: 'x'.repeat(80), subtitle: 'y'.repeat(80) });
    expect(box!.width).toBeLessThanOrEqual(0.45 * PICTURE.width + 1e-6);
    for (const line of box!.lines) expect(widthOf(line), line.text).toBeLessThanOrEqual(box!.width - 1);
    expect(box!.lines[0]!.size).toBeLessThan(plate({ titleBox: true }).box!.lines[0]!.size);
    expect(inside(box!, PICTURE)).toBe(true);
  });

  test('in a picture twice the size everything is twice the size', () => {
    const small = plate({ frame: true, titleBox: true });
    const large = plate({ frame: true, titleBox: true }, {}, { x: 200, y: 100, width: 2000, height: 2000 });
    expect(large.frameWidth).toBeCloseTo(2 * small.frameWidth, 9);
    expect(large.box!.width).toBeCloseTo(2 * small.box!.width, 6);
    large.box!.lines.forEach((line, i) => expect(line.size).toBeCloseTo(2 * small.box!.lines[i]!.size, 6));
  });
});
