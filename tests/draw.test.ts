import { expect, test } from 'vitest';
import type { Scene, SceneIndicatrix, ScenePiece } from '../src/morph/scene';
import { drawScene, MAP_STYLE } from '../src/render/draw';
import { INDICATRIX_RADIUS } from '../src/tissot/indicatrix';

type Op = { op: string; args: number[]; style?: string; alpha: number; transform: number[]; path: number[][] };

/** A context that writes down what is painted, with what, and through which transform each path point went. */
function recordingContext(base = [2, 0, 0, 2, 0, 0]) {
  const ops: Op[] = [];
  let path: number[][] = [];
  let transform = [...base];
  const ctx = {
    canvas: { width: 2000, height: 1200 },
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    lineJoin: 'miter',
    lineCap: 'butt',
    getTransform: () => ({ a: transform[0], b: transform[1], c: transform[2], d: transform[3], e: transform[4], f: transform[5] }),
    setTransform: (...m: any[]) => void (transform = typeof m[0] === 'object' ? [m[0].a, m[0].b, m[0].c, m[0].d, m[0].e, m[0].f] : m),
    beginPath: () => void (path = []),
    closePath: () => {},
    moveTo: (x: number, y: number) => void path.push([x, y]),
    lineTo: (x: number, y: number) => void path.push([x, y]),
    arc: (...args: number[]) => {
      const m = transform;
      const at = (x: number, y: number) => [m[0]! * x + m[2]! * y + m[4]!, m[1]! * x + m[3]! * y + m[5]!];
      path.push(at(1, 0), at(0, 1), at(0, 0));
      ops.push({ op: 'arc', args, alpha: ctx.globalAlpha, transform: [...transform], path: [] });
    },
    fillRect: (...args: number[]) => void ops.push({ op: 'fillRect', args, style: ctx.fillStyle, alpha: ctx.globalAlpha, transform: [...transform], path: [] }),
    fill: () => void ops.push({ op: 'fill', args: [], style: ctx.fillStyle, alpha: ctx.globalAlpha, transform: [...transform], path: [...path] }),
    stroke: () => void ops.push({ op: 'stroke', args: [], style: ctx.strokeStyle, alpha: ctx.globalAlpha, transform: [...transform], path: [...path] }),
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, ops, transform: () => transform };
}

function piece(from: number[], to: number[], options: Partial<ScenePiece> = {}): ScenePiece {
  return { closed: true, src: new Float32Array(from), dst: new Float32Array(to), ringStarts: new Uint32Array([0]), alphaSrc: 1, alphaDst: 1, behind: false, ...options };
}

const square = (x: number) => [x, 0, x + 10, 0, x + 10, 10, x, 10];
const emptyLayers = () => ({ ocean: [], land: [], graticule: [], coast: [], drawings: [] });

function indicatrix(options: Partial<SceneIndicatrix> = {}): SceneIndicatrix {
  return { srcPos: [10, 20], dstPos: [30, 60], srcMat: [100, 0, 0, 100], dstMat: [300, 40, -20, 100], alphaSrc: 1, alphaDst: 1, behind: false, ...options };
}

const painted = (ops: Op[]) => ops.filter((o) => o.op === 'fill' || o.op === 'stroke');

test('draw: pieces are positioned at the blend of their two ends', () => {
  const { ctx, ops } = recordingContext();
  const scene: Scene = { layers: { ...emptyLayers(), land: [piece(square(0), square(100))] }, indicatrices: [] };
  drawScene(ctx, scene, 0.25, MAP_STYLE);
  const fill = painted(ops).find((o) => o.op === 'fill')!;
  expect(fill.path).toEqual([[25, 0], [35, 0], [35, 10], [25, 10]]);
  expect(fill.style).toBe(MAP_STYLE.land);
});

test('draw: a piece is drawn at the blend of its alphas, and not at all at alpha 0', () => {
  const { ctx, ops } = recordingContext();
  const fading = piece(square(0), square(0), { alphaSrc: 1, alphaDst: 0 });
  const gone = piece(square(50), square(50), { alphaSrc: 0, alphaDst: 0 });
  const arriving = piece(square(100), square(100), { alphaSrc: 0, alphaDst: 1 });
  drawScene(ctx, { layers: { ...emptyLayers(), land: [fading, gone, arriving] }, indicatrices: [] }, 0, MAP_STYLE);
  const land = painted(ops).filter((o) => o.op === 'fill' && o.style === MAP_STYLE.land);
  // At t = 0 only the first shows.
  expect(land.map((o) => o.path[0]![0])).toEqual([0]);
  expect(land[0]!.alpha).toBe(1);

  const later = recordingContext();
  drawScene(later.ctx, { layers: { ...emptyLayers(), land: [fading, gone, arriving] }, indicatrices: [] }, 0.25, MAP_STYLE);
  const shown = painted(later.ops).filter((o) => o.op === 'fill' && o.style === MAP_STYLE.land);
  expect(shown.map((o) => [o.path[0]![0], o.alpha])).toEqual([[0, 0.75], [100, 0.25]]);
  // Whatever is painted later is not left at a fading piece's alpha.
  expect(later.ctx.globalAlpha).toBe(1);
});

test('draw: each group paints ocean, land, graticule, coast, drawings, in order, behind group first', () => {
  const { ctx, ops } = recordingContext();
  const open = { closed: false };
  const groups = (behind: boolean) => ({
    ocean: piece(square(0), square(0), { behind }),
    land: piece(square(0), square(0), { behind }),
    graticule: piece(square(0), square(0), { ...open, behind }),
    coast: piece(square(0), square(0), { ...open, behind }),
    drawing: piece(square(0), square(0), { ...open, behind }),
  });
  const [front, behind] = [groups(false), groups(true)];
  const scene: Scene = {
    layers: {
      ocean: [front.ocean, behind.ocean],
      land: [front.land, behind.land],
      graticule: [front.graticule, behind.graticule],
      coast: [front.coast, behind.coast],
      drawings: [front.drawing, behind.drawing],
    },
    indicatrices: [],
  };
  drawScene(ctx, scene, 0.5, MAP_STYLE);
  const { ocean, land, graticule, coast, accent } = MAP_STYLE;
  const colours = painted(ops).map((o) => o.style).filter((s, i, all) => s !== all[i - 1]);
  expect(colours).toEqual([ocean, land, graticule, coast, accent, ocean, land, graticule, coast, accent]);
});

test('draw: a polygon of a drawing is filled and not outlined, so a cut edge along a seam does not show', () => {
  const { ctx, ops } = recordingContext();
  const polygon = piece(square(0), square(0));
  const line = piece(square(50), square(50), { closed: false });
  drawScene(ctx, { layers: { ...emptyLayers(), drawings: [polygon, line] }, indicatrices: [] }, 0.5, MAP_STYLE);
  const drawn = painted(ops);
  expect(drawn.map((o) => [o.op, o.style, o.path[0]![0]])).toEqual([
    ['fill', MAP_STYLE.accentFill, 0],
    ['stroke', MAP_STYLE.accent, 50],
  ]);
});

test('draw: an indicatrix is the blended matrix times the shared radius, through the device scale', () => {
  const { ctx, ops, transform } = recordingContext();
  drawScene(ctx, { layers: emptyLayers(), indicatrices: [indicatrix()] }, 0.5, MAP_STYLE);
  const arc = ops.find((o) => o.op === 'arc')!;
  expect(arc.args.slice(0, 3)).toEqual([0, 0, 1]);
  const r = INDICATRIX_RADIUS;
  // Device x = 2 (m00 east + m01 north + x), device y = 2 (m10 east + m11 north + y), at (1-t) src + t dst.
  const expected = [2 * r * 200, 2 * r * -10, 2 * r * 20, 2 * r * 100, 40, 80];
  arc.transform.forEach((value, i) => expect(value).toBeCloseTo(expected[i]!, 9));
  // The line is stroked with the plain transform back, or its width would be distorted with the ellipse.
  expect(transform()).toEqual([2, 0, 0, 2, 0, 0]);
  const stroke = painted(ops).find((o) => o.op === 'stroke')!;
  expect(stroke.transform).toEqual([2, 0, 0, 2, 0, 0]);
  expect(stroke.style).toBe(MAP_STYLE.accent);
});

test('draw: a far-side indicatrix goes under the near ocean; others on top of everything', () => {
  const { ctx, ops } = recordingContext();
  const near = indicatrix({ srcPos: [1, 1], dstPos: [1, 1] });
  const far = indicatrix({ srcPos: [2, 2], dstPos: [2, 2], behind: true });
  const scene: Scene = { layers: { ...emptyLayers(), ocean: [piece(square(0), square(0))] }, indicatrices: [near, far] };
  drawScene(ctx, scene, 0.5, MAP_STYLE);
  const order = ops
    .filter((o) => o.op === 'arc' || (o.op === 'fill' && o.style === MAP_STYLE.ocean))
    .map((o) => (o.op === 'arc' ? o.transform[4] : 'ocean'));
  expect(order).toEqual([4, 'ocean', 2]);
});

test('draw: an indicatrix at alpha 0 is skipped, and a fading one uses its blended alpha', () => {
  const { ctx, ops } = recordingContext();
  const scene: Scene = {
    layers: emptyLayers(),
    indicatrices: [indicatrix({ alphaSrc: 0, alphaDst: 0 }), indicatrix({ alphaSrc: 1, alphaDst: 0 })],
  };
  drawScene(ctx, scene, 0.25, MAP_STYLE);
  const arcs = ops.filter((o) => o.op === 'arc');
  expect(arcs.length).toBe(1);
  expect(arcs[0]!.alpha).toBe(0.75);
});

test('draw: the background fills the whole store whatever the transform', () => {
  const { ctx, ops, transform } = recordingContext([3, 0, 0, 3, 0, 0]);
  drawScene(ctx, { layers: emptyLayers(), indicatrices: [] }, 1, MAP_STYLE);
  const rect = ops.find((o) => o.op === 'fillRect')!;
  expect(rect.style).toBe(MAP_STYLE.background);
  expect(rect.transform).toEqual([1, 0, 0, 1, 0, 0]);
  expect(rect.args).toEqual([0, 0, 2000, 1200]);
  expect(transform()).toEqual([3, 0, 0, 3, 0, 0]);
});

test('draw: far-side ocean cells are filled as one path, each wound the same way, in place of the far-side ocean pieces', () => {
  const { ctx, ops } = recordingContext();
  // The second cell is wound the other way round on screen, as a folded cell comes out.
  const clockwise = piece(square(0), square(0), { behind: true });
  const reversed = piece([20, 0, 20, 10, 30, 10, 30, 0], [20, 0, 20, 10, 30, 10, 30, 0], { behind: true });
  const farSphere = piece(square(100), square(100), { behind: true });
  const nearSphere = piece(square(200), square(200));
  const scene: Scene = { layers: { ...emptyLayers(), ocean: [farSphere, nearSphere], farOcean: [clockwise, reversed] }, indicatrices: [] };
  drawScene(ctx, scene, 0.5, MAP_STYLE);
  const oceanFills = ops.filter((o) => o.op === 'fill' && o.style === MAP_STYLE.ocean);
  // One fill for both cells, then the near ocean; the far Sphere piece is not filled.
  expect(oceanFills.map((o) => o.path[0]![0])).toEqual([0, 200]);
  const cells = oceanFills[0]!.path;
  const area = (ring: number[][]) => ring.reduce((sum, [x, y], i) => sum + x! * ring[(i + 1) % ring.length]![1]! - ring[(i + 1) % ring.length]![0]! * y!, 0) / 2;
  expect(Math.sign(area(cells.slice(0, 4)))).toBe(Math.sign(area(cells.slice(4, 8))));
});
