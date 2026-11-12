import { describe, expect, test } from 'vitest';
import { LAND } from '../src/data/land';
import { DEFAULT_LAYERS, type LayerState } from '../src/layers/layers';
import { buildOverlay, buildPlateOnly, drawOverlay, lettersWanted, overlayWanted, type Overlay, type OverlayInput } from '../src/overlay/overlay';
import { pictureRect } from '../src/plate/plate';
import { mapStyle } from '../src/render/style';
import { FIT } from '../src/screen/view';
import { stopOf } from './stopOf';
import { member, VIEW } from './sceneSupport';

const style = mapStyle('light');
const measure = { label: (text: string) => 0.62 * text.length, plate: (text: string) => 0.6 * text.length };
const layers = (on: Partial<LayerState['on']>, rest: Partial<LayerState> = {}): LayerState => ({ ...DEFAULT_LAYERS, ...rest, on: { ...DEFAULT_LAYERS.on, ...on } });
const mercator = member('mercator');
const input = (state: LayerState): OverlayInput => ({ member: mercator, state: mercator.compiled.state, named: stopOf('mercator'), layers: state, picture: pictureRect(mercator.compiled, VIEW, FIT, 16), scale: 1 });
const built = (state: LayerState): Overlay => buildOverlay(input(state), measure, null, LAND);

type Op = { op: string; args: (string | number)[]; fill: string; stroke: string; font: string; width: number; at: number[] };
/** A context that writes down what is painted, with what, and where the origin and the turn were. */
function recording() {
  const ops: Op[] = [];
  let [x, y, turn] = [0, 0, 0];
  const saved: number[][] = [];
  const note = (op: string, args: (string | number)[]) => void ops.push({ op, args, fill: ctx.fillStyle, stroke: ctx.strokeStyle, font: ctx.font, width: ctx.lineWidth, at: [x, y, turn] });
  const ctx: any = {
    fillStyle: '', strokeStyle: '', font: '', lineWidth: 1, globalAlpha: 1, textAlign: '', textBaseline: '', lineJoin: '',
    save: () => void saved.push([x, y, turn]),
    restore: () => void ([x, y, turn] = saved.pop() as [number, number, number]),
    translate: (dx: number, dy: number) => void ([x, y] = [x + dx, y + dy]),
    rotate: (a: number) => void (turn += a),
    measureText: (text: string) => ({ width: 6 * text.length }),
    beginPath: () => {}, moveTo: () => {}, lineTo: () => {},
    fillText: (...args: (string | number)[]) => note('fillText', args),
    fillRect: (...args: number[]) => note('fillRect', args),
    strokeRect: (...args: number[]) => note('strokeRect', args),
    stroke: () => note('stroke', []),
  };
  return { ctx: ctx as CanvasRenderingContext2D, ops };
}

describe('what is over a map', () => {
  test('nothing by default; the frame and the box need no fitting, and names and degrees do', () => {
    expect(overlayWanted(DEFAULT_LAYERS)).toBe(false);
    expect(lettersWanted(DEFAULT_LAYERS)).toBe(false);
    for (const id of ['frame', 'titleBox'] as const) expect([overlayWanted(layers({ [id]: true })), lettersWanted(layers({ [id]: true }))]).toEqual([true, false]);
    for (const id of ['countryNames', 'seaNames', 'degrees'] as const) expect([overlayWanted(layers({ [id]: true })), lettersWanted(layers({ [id]: true }))]).toEqual([true, true]);
    // The degrees are the graticule's: with no graticule there are none.
    expect(overlayWanted(layers({ degrees: true, graticule: false }))).toBe(false);
    expect(built(DEFAULT_LAYERS)).toEqual({ labels: [], plate: expect.objectContaining({ frame: null, box: null }) });
  });

  test('each kind of lettering is there when it is on', () => {
    expect(built(layers({ countryNames: true })).labels.every((label) => label.kind === 'country')).toBe(true);
    expect(built(layers({ countryNames: true })).labels.length).toBeGreaterThan(8);
    const degrees = built(layers({ degrees: true })).labels;
    expect(degrees.length).toBeGreaterThan(8);
    expect(degrees.every((label) => label.kind === 'degree')).toBe(true);
    expect(built(layers({ degrees: true, graticule: false })).labels).toEqual([]);
    // Sea names wait for the seas.
    expect(built(layers({ seaNames: true })).labels).toEqual([]);
    const both = built(layers({ countryNames: true, degrees: true })).labels;
    expect(new Set(both.map((label) => label.kind))).toEqual(new Set(['country', 'degree']));
  });

  test('no name lies under the title box', () => {
    // A box over the middle of Russia: with a long title it is wide, and in the top right corner.
    const state = layers({ countryNames: true, titleBox: true }, { title: 'A very long title for the north of the map', corner: 'tr' });
    const { labels, plate } = built(state);
    const box = plate.box!;
    for (const label of labels) for (const [x, y] of label.discs) expect(x > box.x && x < box.x + box.width && y > box.y && y < box.y + box.height, label.text).toBe(false);
    expect(buildPlateOnly(input(state), measure)).toEqual({ labels: [], plate });
  });
});

describe('drawing what is over a map', () => {
  test('each letter of a name is drawn at its place and turn, in the colour of its kind', () => {
    const overlay: Overlay = {
      labels: [
        { kind: 'country', text: 'AB', size: 12, glyphs: [{ ch: 'A', x: 10, y: 20, angle: 0 }, { ch: 'B', x: 30, y: 25, angle: 0.5 }], discs: [] },
        { kind: 'sea', text: 'c', size: 9, glyphs: [{ ch: 'c', x: 50, y: 60, angle: 0 }], discs: [] },
        { kind: 'degree', text: '0°', size: 9, glyphs: [{ ch: '0', x: 70, y: 80, angle: 0 }], discs: [] },
      ],
      plate: { frame: null, frameWidth: 1, hairline: 1, box: null },
    };
    const { ctx, ops } = recording();
    drawOverlay(ctx, overlay, style);
    expect(ops.map((o) => [o.op, o.args[0], o.fill])).toEqual([['fillText', 'A', style.labels], ['fillText', 'B', style.labels], ['fillText', 'c', style.seaLabels], ['fillText', '0', style.ink]]);
    expect(ops[0]).toMatchObject({ args: ['A', 10, 20], at: [0, 0, 0] });
    expect(ops[1]).toMatchObject({ args: ['B', 0, 0], at: [30, 25, 0.5] });
    expect(ops[0]!.font).toMatch(/^500 12px Jost/);
    expect(ops[2]!.font).toMatch(/^italic 400 9px Jost/);
    // The turn of one letter is not left on for the next.
    expect(ops[2]!.at).toEqual([0, 0, 0]);
  });

  test('the frame is a line in the page\'s ink, and the box is the page\'s colour with its lines lettered about its middle', () => {
    const { plate } = built(layers({ frame: true, titleBox: true }));
    const { ctx, ops } = recording();
    drawOverlay(ctx, { labels: [], plate }, style);
    const [frame, fill, edge] = ops;
    expect(frame).toMatchObject({ op: 'strokeRect', stroke: style.ink, width: plate.frameWidth, args: [plate.frame!.x, plate.frame!.y, plate.frame!.width, plate.frame!.height] });
    expect(fill).toMatchObject({ op: 'fillRect', fill: style.background, args: [plate.box!.x, plate.box!.y, plate.box!.width, plate.box!.height] });
    expect(edge).toMatchObject({ op: 'strokeRect', stroke: style.ink, width: plate.hairline });
    expect(ops.some((o) => o.op === 'stroke')).toBe(true);
    const letters = ops.filter((o) => o.op === 'fillText');
    expect(letters.map((o) => o.args[0]).join('')).toBe(plate.box!.lines.map((line) => line.text).join(''));
    expect(letters.every((o) => o.fill === style.ink)).toBe(true);
    // The title: its letters are 6 wide here with the line's space between, and their middle is the box's.
    const title = plate.box!.lines[0]!;
    const xs = letters.slice(0, title.text.length).map((o) => o.args[1] as number);
    expect((xs[0]! + xs.at(-1)! + 6) / 2).toBeCloseTo(plate.box!.x + plate.box!.width / 2, 6);
    expect(xs[1]! - xs[0]!).toBeCloseTo(6 + title.gap, 6);
    expect(letters[0]!.font).toMatch(/^700 /);
  });
});
