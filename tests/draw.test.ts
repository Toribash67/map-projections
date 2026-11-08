import { expect, test } from 'vitest';
import type { Scene, SceneIndicatrix, ScenePiece } from '../src/morph/scene';
import { alphaOf, drawScene } from '../src/render/draw';
import { mapStyle } from '../src/render/style';
import { INDICATRIX_RADIUS } from '../src/tissot/indicatrix';

// The tests run in light mode, as the browser is told to, unless one says otherwise.
const LIGHT_STYLE = mapStyle('light');

type Op = { op: string; args: number[]; style?: string; alpha: number; transform: number[]; path: number[][] };

/** A context that writes down what is painted, with what, and through which transform each path point went. */
function recordingContext(base = [2, 0, 0, 2, 0, 0]) {
  const ops: Op[] = [];
  let path: number[][] = [];
  let transform = [...base];
  const saved: number[][] = [];
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
    save: () => void saved.push([...transform]),
    restore: () => void (transform = saved.pop()!),
    clip: () => void ops.push({ op: 'clip', args: [], alpha: ctx.globalAlpha, transform: [...transform], path: [...path] }),
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
  return { closed: true, src: new Float32Array(from), dst: new Float32Array(to), ringStarts: new Uint32Array([0]), alphaSrc: 1, alphaDst: 1, behind: false, out: false, ...options };
}

const square = (x: number) => [x, 0, x + 10, 0, x + 10, 10, x, 10];
const emptyLayers = () => ({ ocean: [], land: [], graticule: [], coast: [], drawings: [] });

function indicatrix(options: Partial<SceneIndicatrix> = {}): SceneIndicatrix {
  return { srcPos: [10, 20], dstPos: [30, 60], srcMat: [100, 0, 0, 100], dstMat: [300, 40, -20, 100], alphaSrc: 1, alphaDst: 1, behind: false, ...options };
}

/** An ocean that holds every indicatrix of these tests, so that its outline clips none of them. */
const bigOcean = () => piece([-1000, -1000, 1000, -1000, 1000, 1000, -1000, 1000], [-1000, -1000, 1000, -1000, 1000, 1000, -1000, 1000]);

const painted = (ops: Op[]) => ops.filter((o) => o.op === 'fill' || o.op === 'stroke');

test('draw: pieces are positioned at the blend of their two ends', () => {
  const { ctx, ops } = recordingContext();
  const scene: Scene = { layers: { ...emptyLayers(), land: [piece(square(0), square(100))] }, indicatrices: [] };
  drawScene(ctx, scene, 0.25, LIGHT_STYLE);
  const fill = painted(ops).find((o) => o.op === 'fill')!;
  expect(fill.path).toEqual([[25, 0], [35, 0], [35, 10], [25, 10]]);
  expect(fill.style).toBe(LIGHT_STYLE.land);
});

test('draw: a piece is drawn at the blend of its alphas, and not at all at alpha 0', () => {
  const { ctx, ops } = recordingContext();
  const fading = piece(square(0), square(0), { alphaSrc: 1, alphaDst: 0 });
  const gone = piece(square(50), square(50), { alphaSrc: 0, alphaDst: 0 });
  const arriving = piece(square(100), square(100), { alphaSrc: 0, alphaDst: 1 });
  drawScene(ctx, { layers: { ...emptyLayers(), land: [fading, gone, arriving] }, indicatrices: [] }, 0, LIGHT_STYLE);
  const land = painted(ops).filter((o) => o.op === 'fill' && o.style === LIGHT_STYLE.land);
  // At t = 0 only the first shows.
  expect(land.map((o) => o.path[0]![0])).toEqual([0]);
  expect(land[0]!.alpha).toBe(1);

  const later = recordingContext();
  drawScene(later.ctx, { layers: { ...emptyLayers(), land: [fading, gone, arriving] }, indicatrices: [] }, 0.25, LIGHT_STYLE);
  const shown = painted(later.ops).filter((o) => o.op === 'fill' && o.style === LIGHT_STYLE.land);
  expect(shown.map((o) => [o.path[0]![0], o.alpha])).toEqual([[0, alphaOf({ alphaSrc: 1, alphaDst: 0 }, 0.25)], [100, alphaOf({ alphaSrc: 0, alphaDst: 1 }, 0.25)]]);
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
  drawScene(ctx, scene, 0.5, LIGHT_STYLE);
  const { ocean, land, graticule, coast, accent } = LIGHT_STYLE;
  const colours = painted(ops).map((o) => o.style).filter((s, i, all) => s !== all[i - 1]);
  expect(colours).toEqual([ocean, land, graticule, coast, accent, ocean, land, graticule, coast, accent]);
});

test('draw: a polygon of a drawing is filled and not outlined, so a cut edge along a seam does not show', () => {
  const { ctx, ops } = recordingContext();
  const polygon = piece(square(0), square(0));
  const line = piece(square(50), square(50), { closed: false });
  drawScene(ctx, { layers: { ...emptyLayers(), drawings: [polygon, line] }, indicatrices: [] }, 0.5, LIGHT_STYLE);
  const drawn = painted(ops);
  expect(drawn.map((o) => [o.op, o.style, o.path[0]![0]])).toEqual([
    ['fill', LIGHT_STYLE.accentFill, 0],
    ['stroke', LIGHT_STYLE.accent, 50],
  ]);
});

test('draw: an indicatrix is the blended matrix times the shared radius, through the device scale', () => {
  const { ctx, ops, transform } = recordingContext();
  drawScene(ctx, { layers: { ...emptyLayers(), ocean: [bigOcean()] }, indicatrices: [indicatrix()] }, 0.5, LIGHT_STYLE);
  const arc = ops.find((o) => o.op === 'arc')!;
  expect(arc.args.slice(0, 3)).toEqual([0, 0, 1]);
  const r = INDICATRIX_RADIUS;
  // Device x = 2 (m00 east + m01 north + x), device y = 2 (m10 east + m11 north + y), at (1-t) src + t dst.
  const expected = [2 * r * 200, 2 * r * -10, 2 * r * 20, 2 * r * 100, 40, 80];
  arc.transform.forEach((value, i) => expect(value).toBeCloseTo(expected[i]!, 9));
  // The line is stroked with the plain transform back, or its width would be distorted with the ellipse.
  expect(transform()).toEqual([2, 0, 0, 2, 0, 0]);
  const stroke = painted(ops).filter((o) => o.op === 'stroke').at(-1)!;
  expect(stroke.transform).toEqual([2, 0, 0, 2, 0, 0]);
  expect(stroke.style).toBe(LIGHT_STYLE.accent);
});

test('draw: a far-side indicatrix goes under the near ocean; others on top of everything', () => {
  const { ctx, ops } = recordingContext();
  const near = indicatrix({ srcPos: [1, 1], dstPos: [1, 1] });
  const far = indicatrix({ srcPos: [2, 2], dstPos: [2, 2], behind: true });
  const scene: Scene = { layers: { ...emptyLayers(), ocean: [piece(square(0), square(0))] }, indicatrices: [near, far] };
  drawScene(ctx, scene, 0.5, LIGHT_STYLE);
  const order = ops
    .filter((o) => o.op === 'arc' || (o.op === 'fill' && o.style === LIGHT_STYLE.ocean))
    .map((o) => (o.op === 'arc' ? o.transform[4] : 'ocean'));
  expect(order).toEqual([4, 'ocean', 2]);
});

test('draw: an indicatrix at alpha 0 is skipped, and a fading one uses its eased alpha', () => {
  const { ctx, ops } = recordingContext();
  const scene: Scene = {
    layers: { ...emptyLayers(), ocean: [bigOcean()] },
    indicatrices: [indicatrix({ alphaSrc: 0, alphaDst: 0 }), indicatrix({ alphaSrc: 1, alphaDst: 0 })],
  };
  drawScene(ctx, scene, 0.25, LIGHT_STYLE);
  const arcs = ops.filter((o) => o.op === 'arc');
  expect(arcs.length).toBe(1);
  expect(arcs[0]!.alpha).toBe(alphaOf({ alphaSrc: 1, alphaDst: 0 }, 0.25));
});

test('draw: the background fills the whole store whatever the transform', () => {
  const { ctx, ops, transform } = recordingContext([3, 0, 0, 3, 0, 0]);
  drawScene(ctx, { layers: emptyLayers(), indicatrices: [] }, 1, LIGHT_STYLE);
  const rect = ops.find((o) => o.op === 'fillRect')!;
  expect(rect.style).toBe(LIGHT_STYLE.background);
  expect(rect.transform).toEqual([1, 0, 0, 1, 0, 0]);
  expect(rect.args).toEqual([0, 0, 2000, 1200]);
  expect(transform()).toEqual([3, 0, 0, 3, 0, 0]);
});

test('draw: ocean cells beyond a globe\'s limb are filled as one path, each wound the same way, in place of the far-side ocean pieces', () => {
  const { ctx, ops } = recordingContext();
  // The second cell is wound the other way round on screen, as a folded cell comes out.
  const clockwise = piece(square(0), square(0), { behind: true, out: true });
  const reversed = piece([20, 0, 20, 10, 30, 10, 30, 0], [20, 0, 20, 10, 30, 10, 30, 0], { behind: true, out: true });
  const farSphere = piece(square(100), square(100), { behind: true, out: true });
  const nearSphere = piece(square(200), square(200));
  const scene: Scene = { layers: { ...emptyLayers(), ocean: [farSphere, nearSphere], capOcean: [clockwise, reversed] }, indicatrices: [] };
  drawScene(ctx, scene, 0.5, LIGHT_STYLE);
  const oceanFills = ops.filter((o) => o.op === 'fill' && o.style === LIGHT_STYLE.ocean);
  // One fill for both cells, then the near ocean; the far Sphere piece is not filled.
  expect(oceanFills.map((o) => o.path[0]![0])).toEqual([0, 200]);
  const cells = oceanFills[0]!.path;
  const area = (ring: number[][]) => ring.reduce((sum, [x, y], i) => sum + x! * ring[(i + 1) % ring.length]![1]! - ring[(i + 1) % ring.length]![0]! * y!, 0) / 2;
  expect(Math.sign(area(cells.slice(0, 4)))).toBe(Math.sign(area(cells.slice(4, 8))));
});

const at = (alphaSrc: number, alphaDst: number, t: number, hidden?: number[]) => alphaOf({ alphaSrc, alphaDst, hidden }, t);

test('alphaOf: the ends are what the maps there show, and it is continuous and monotone between', () => {
  for (const [a, b] of [[0, 1], [1, 0]] as [number, number][]) {
    expect(at(a, b, 0)).toBeCloseTo(a, 12);
    expect(at(a, b, 1)).toBeCloseTo(b, 12);
    let last = a;
    for (let k = 1; k <= 1000; k++) {
      const v = at(a, b, k / 1000);
      // A step of 0.001 in t moves it by at most 0.01.
      expect(Math.abs(v - last)).toBeLessThan(0.01);
      expect(b > a ? v >= last : v <= last).toBe(true);
      last = v;
    }
  }
});

test('alphaOf: what every map shows is blended linearly, and what arrives or leaves is fainter than that', () => {
  for (const t of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
    expect(at(1, 1, t)).toBe(1);
    expect(at(0.4, 0.4, t)).toBe(0.4);
  }
  for (const t of [0.1, 0.25, 0.5, 0.75, 0.9]) {
    expect(at(0, 1, t)).toBeCloseTo(t ** 3, 12);
    expect(at(1, 0, t)).toBeCloseTo((1 - t) ** 3, 12);
  }
});

test('alphaOf: a morph redirected under way starts at the alpha it had, however its sources are mixed', () => {
  // A piece that the first source (weight 0.6 at the start) cannot show, the second (0.4) can, and so can the target.
  const before = (t: number) => at(0.4, 1, t, [0.6]);
  for (const t of [0.1, 0.35, 0.6, 0.9]) {
    // Redirected at t: the sources are now the two of them at (1 - t) times their weights, and the old target at t, and
    // a piece that the old first source cannot show has the same hidden weight, (1 - t) 0.6.
    const after = at(0.4 * (1 - t) + t, 1, 0, [(1 - t) * 0.6]);
    expect(after).toBeCloseTo(before(t), 12);
  }
  // A piece that only the old target cannot show: after a redirect at t its weight t hides it, as before.
  for (const t of [0.2, 0.5, 0.8]) expect(at(1 - t, 1, 0, [t])).toBeCloseTo(at(1, 0, t), 12);
});

test('alphaOf: a map that shows something faded hides the rest of its weight, and the ends are what the maps show at rest', () => {
  const fading = (alphaSrc: number, alphaDst: number, fade: number) => ({ alphaSrc, alphaDst, hidden: [1], fade: [fade] });
  // Shown at 0.3 by the source and 0.8 by the target.
  expect(alphaOf(fading(0.3, 0.8, 0.7), 0)).toBeCloseTo(0.3, 12);
  expect(alphaOf(fading(0.3, 0.8, 0.7), 1)).toBeCloseTo(0.8, 12);
  // A copy that only the source shows, at 0.6: it starts at 0.6 and is gone at the end, falling all the way.
  let last = alphaOf(fading(0.6, 0, 0.4), 0);
  expect(last).toBeCloseTo(0.6, 12);
  for (let t = 0.01; t <= 1; t += 0.01) {
    const alpha = alphaOf(fading(0.6, 0, 0.4), t);
    expect(alpha).toBeLessThanOrEqual(last);
    last = alpha;
  }
  expect(last).toBe(0);
  // A redirect at t: the old source at (1 - t) with the same fade, the old target at t hiding 1 - 0.8 of it.
  for (const t of [0.2, 0.5, 0.9]) {
    const after = alphaOf({ alphaSrc: 0, alphaDst: 1, hidden: [1 - t, t], fade: [0.7, 0.2] }, 0);
    expect(after).toBeCloseTo(alphaOf(fading(0.3, 0.8, 0.7), t), 12);
  }
});

test('draw: cells of ocean beyond a map\'s coverage replace the ocean pieces that lie beyond it, wherever the cap is', () => {
  const { ctx, ops } = recordingContext();
  // Out of coverage at one end but not behind a globe's limb: a clip cap's far side.
  const out = piece(square(100), square(100), { alphaSrc: 0, alphaDst: 1, out: true });
  const covered = piece(square(200), square(200));
  const cell = piece(square(0), square(0), { alphaSrc: 0, alphaDst: 1, out: true });
  const scene: Scene = { layers: { ...emptyLayers(), ocean: [out, covered], capOcean: [cell] }, indicatrices: [] };
  drawScene(ctx, scene, 0.5, LIGHT_STYLE);
  const oceanFills = ops.filter((o) => o.op === 'fill' && o.style === LIGHT_STYLE.ocean);
  expect(oceanFills.map((o) => o.path[0]![0])).toEqual([0, 200]);
  expect(oceanFills[0]!.alpha).toBe(alphaOf({ alphaSrc: 0, alphaDst: 1 }, 0.5));
});

// Indicatrices are clipped to the outline of the map, which is its ocean: the pieces of ocean shown now, or the cells that stand in for them.
const clipsOf = (ops: Op[]) => ops.filter((o) => o.op === 'clip');
const firstOf = (ops: Op[], op: string) => ops.findIndex((o) => o.op === op);

test('draw: an indicatrix is clipped to the ocean pieces of both groups, and the clip is set before it and undone after', () => {
  const { ctx, ops, transform } = recordingContext();
  const near = piece(square(0), square(0));
  const far = piece(square(100), square(100), { behind: true });
  const scene: Scene = { layers: { ...emptyLayers(), ocean: [near, far] }, indicatrices: [indicatrix({ srcPos: [1, 1], dstPos: [1, 1] })] };
  drawScene(ctx, scene, 0.5, LIGHT_STYLE);
  const clips = clipsOf(ops);
  expect(clips).toHaveLength(1);
  // The near ocean and the far: an ellipse across a globe's limb is cut where the map ends, not where the two sides meet.
  expect(clips[0]!.path).toEqual([[0, 0], [10, 0], [10, 10], [0, 10], [100, 0], [110, 0], [110, 10], [100, 10]]);
  expect(clips[0]!.transform).toEqual([2, 0, 0, 2, 0, 0]);
  expect(firstOf(ops, 'clip')).toBeLessThan(firstOf(ops, 'arc'));
  expect(transform()).toEqual([2, 0, 0, 2, 0, 0]);
});

test('draw: a far-side indicatrix is drawn with the far side, and clipped to the whole outline too', () => {
  const { ctx, ops } = recordingContext();
  const near = piece(square(0), square(0));
  const far = piece(square(100), square(100), { behind: true });
  const scene: Scene = { layers: { ...emptyLayers(), ocean: [near, far] }, indicatrices: [indicatrix({ srcPos: [101, 101], dstPos: [101, 101], behind: true })] };
  drawScene(ctx, scene, 0.5, LIGHT_STYLE);
  expect(clipsOf(ops).map((o) => o.path.length)).toEqual([8]);
  // Before the near ocean is filled.
  expect(firstOf(ops, 'arc')).toBeLessThan(ops.findIndex((o) => o.op === 'fill' && o.path[0]![0] === 0));
});

test('draw: a copy that one map shows is clipped to what that map shows, and the others to the whole outline', () => {
  const { ctx, ops } = recordingContext();
  // Shown by the source (bit 0) only, by the target (bit 1) only, and by both.
  const source = piece(square(0), square(0), { shownBy: 1 });
  const target = piece(square(100), square(100), { shownBy: 2 });
  const both = piece(square(200), square(200), { shownBy: 3 });
  const scene: Scene = {
    layers: { ...emptyLayers(), ocean: [source, target, both] },
    indicatrices: [indicatrix(), indicatrix({ clip: 0, alphaSrc: 1, alphaDst: 0 }), indicatrix({ clip: 1, alphaSrc: 0, alphaDst: 1 })],
  };
  drawScene(ctx, scene, 0.5, LIGHT_STYLE);
  const starts = clipsOf(ops).map((o) => o.path.filter((_, i) => i % 4 === 0).map((point) => point[0]));
  expect(starts).toEqual([[0, 100, 200], [0, 200], [100, 200]]);
  expect(ops.filter((o) => o.op === 'arc')).toHaveLength(3);
});

/** Records the arguments of every arc a context draws. */
function arcsOf(ctx: CanvasRenderingContext2D): number[][] {
  const recorded: number[][] = [];
  const arc = (ctx as any).arc;
  (ctx as any).arc = (...args: number[]) => {
    recorded.push(args);
    arc(...args);
  };
  return recorded;
}

test('draw: an indicatrix cut at a lobe edge is the part of the disc on its side of the chord, filled to the chord, its outline the arc alone', () => {
  const { ctx, ops } = recordingContext();
  const arcs = arcsOf(ctx);
  // Keeps m . x <= c for m east and c = 0.5: the west part, from 60 degrees round to 300.
  const cut = indicatrix({ cut: { src: [1, 0, 0.5], dst: [1, 0, 0.5] } });
  drawScene(ctx, { layers: { ...emptyLayers(), ocean: [bigOcean()] }, indicatrices: [cut] }, 0.5, LIGHT_STYLE);
  expect(arcs[0]!.slice(0, 3)).toEqual([0, 0, 1]);
  expect(arcs[0]![3]).toBeCloseTo(Math.PI / 3, 12);
  expect(arcs[0]![4]).toBeCloseTo((5 * Math.PI) / 3, 12);
  expect(ops.filter((o) => o.op === 'fill' && o.style === LIGHT_STYLE.accentFill)).toHaveLength(1);
});

test('draw: a cut at one end only opens out to the whole disc at the other', () => {
  const { ctx } = recordingContext();
  const arcs = arcsOf(ctx);
  for (const t of [0, 0.5, 1]) {
    drawScene(ctx, { layers: { ...emptyLayers(), ocean: [bigOcean()] }, indicatrices: [indicatrix({ cut: { src: [1, 0, 0], dst: null } })] }, t, LIGHT_STYLE);
  }
  // At t = 0 half the disc, at 0.5 the chord is half way to the edge, and at 1 the whole disc.
  expect(arcs[0]![3]).toBeCloseTo(Math.PI / 2, 12);
  expect(arcs[1]![3]).toBeCloseTo(Math.acos(0.5), 12);
  expect(arcs[2]!.slice(3, 5)).toEqual([0, 2 * Math.PI]);
});

test('draw: the clip is the outline as the frame draws it at t: blended, without what is not shown, with cells in place of pieces beyond a cap', () => {
  const { ctx, ops } = recordingContext();
  const moving = piece(square(0), square(100));
  const gone = piece(square(500), square(500), { alphaSrc: 0, alphaDst: 0 });
  const out = piece(square(700), square(700), { out: true });
  const cell = piece(square(300), square(300), { out: true });
  const scene: Scene = { layers: { ...emptyLayers(), ocean: [moving, gone, out], capOcean: [cell] }, indicatrices: [indicatrix()] };
  drawScene(ctx, scene, 0.5, LIGHT_STYLE);
  const xs = clipsOf(ops)[0]!.path.map((point) => point[0]);
  // The blended piece (x 50 to 60) and the cell (300 to 310); not the piece at alpha 0, nor the one that a cell stands in for.
  expect(xs.filter((x, i) => i % 4 === 0)).toEqual([50, 300]);
});

test('draw: a piece of the outline that is fading is in the clip, so an indicatrix on it is not cut away while the map still shows', () => {
  const { ctx, ops } = recordingContext();
  const arriving = piece(square(0), square(0), { alphaSrc: 0, alphaDst: 1 });
  drawScene(ctx, { layers: { ...emptyLayers(), ocean: [arriving] }, indicatrices: [indicatrix({ alphaSrc: 0, alphaDst: 1 })] }, 0.25, LIGHT_STYLE);
  expect(clipsOf(ops)).toHaveLength(1);
  const arc = ops.find((o) => o.op === 'arc')!;
  expect(arc.alpha).toBe(alphaOf({ alphaSrc: 0, alphaDst: 1 }, 0.25));
});

test('draw: the cells of a clip are wound the same way, so folded cells that overlap do not cancel', () => {
  const { ctx, ops } = recordingContext();
  const a = piece(square(0), square(0), { out: true });
  const reversed = piece([20, 0, 20, 10, 30, 10, 30, 0], [20, 0, 20, 10, 30, 10, 30, 0], { out: true });
  drawScene(ctx, { layers: { ...emptyLayers(), capOcean: [a, reversed] }, indicatrices: [indicatrix()] }, 0.5, LIGHT_STYLE);
  const path = clipsOf(ops)[0]!.path;
  const area = (ring: number[][]) => ring.reduce((sum, [x, y], i) => sum + x! * ring[(i + 1) % ring.length]![1]! - ring[(i + 1) % ring.length]![0]! * y!, 0) / 2;
  expect(Math.sign(area(path.slice(0, 4)))).toBe(Math.sign(area(path.slice(4, 8))));
});

test('draw: nothing is clipped when no indicatrix is drawn, so a map without Tissot pays nothing', () => {
  const { ctx, ops } = recordingContext();
  drawScene(ctx, { layers: { ...emptyLayers(), ocean: [piece(square(0), square(0))] }, indicatrices: [indicatrix({ alphaSrc: 0, alphaDst: 0 })] }, 0.5, LIGHT_STYLE);
  expect(clipsOf(ops)).toHaveLength(0);
  expect(ops.some((o) => o.op === 'arc')).toBe(false);
});
