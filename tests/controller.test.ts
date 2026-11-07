import { expect, test } from 'vitest';
import { MorphController } from '../src/morph/controller';
import { buildScene, type Scene } from '../src/morph/scene';
import { stops } from '../src/projections/catalog';
import { compile, stateForStop } from '../src/projections/compile';
import type { LonLat, Orientation, ProjectionState } from '../src/projections/types';
import { computeScreen, projectPoint, type Viewport } from '../src/screen/screen';
import type { Member } from '../src/tissot/indicatrix';

const VIEW: Viewport = { width: 1000, height: 600 };

function stateOf(id: string, orientation?: Partial<Orientation>): ProjectionState {
  const state = stateForStop(stops.find((s) => s.id === id)!);
  return { ...state, orientation: { ...state.orientation, ...orientation } };
}

function member(id: string, orientation?: Partial<Orientation>, view = VIEW): Member {
  const compiled = compile(stateOf(id, orientation));
  return { compiled, screen: computeScreen(compiled, view), weight: 1 };
}

function clock(start = 1000) {
  let time = start;
  return { now: () => time, advance: (ms: number) => void (time += ms) };
}

/** A controller at rest on `from`. */
function atRest(from: Member) {
  const c = clock();
  const controller = new MorphController(c.now);
  controller.jumpTo(from);
  return { controller, advance: c.advance };
}

const ease = (u: number) => (u < 0.5 ? 4 * u ** 3 : 1 - (-2 * u + 2) ** 3 / 2);

test('controller: t follows cubic ease-in-out over 1400 ms and tick returns false at the end', () => {
  const { controller, advance } = atRest(member('mercator'));
  const target = member('mollweide');
  controller.morphTo(target);
  expect(controller.isMorphing).toBe(true);
  expect(controller.t()).toBe(0);
  let elapsed = 0;
  for (const step of [100, 250, 300, 50, 400, 299]) {
    advance(step);
    elapsed += step;
    expect(controller.tick()).toBe(true);
    expect(controller.t()).toBeCloseTo(ease(elapsed / 1400), 10);
  }
  advance(1);
  expect(controller.tick()).toBe(false);
  expect(controller.isMorphing).toBe(false);
  expect(controller.target()).toBeNull();
  expect(controller.source().map((m) => m.compiled)).toEqual([target.compiled]);
  expect(controller.source()[0]!.weight).toBe(1);
  // A scene not yet rebuilt still shows the target end.
  expect(controller.t()).toBe(1);
  expect(controller.tick()).toBe(false);
});

test('a jump changes the map at once and needs no frames', () => {
  const { controller } = atRest(member('mercator'));
  expect(controller.isMorphing).toBe(false);
  expect(controller.tick()).toBe(false);
  const moved = member('mercator', { lon: 30 });
  controller.jumpTo(moved);
  expect(controller.isMorphing).toBe(false);
  expect(controller.source().map((m) => m.compiled)).toEqual([moved.compiled]);
  expect(controller.target()).toBeNull();
});

test('a jump mid-morph ends the morph', () => {
  const { controller, advance } = atRest(member('mercator'));
  controller.morphTo(member('mollweide'));
  advance(300);
  const moved = member('robinson');
  controller.jumpTo(moved);
  expect(controller.isMorphing).toBe(false);
  expect(controller.source().map((m) => m.compiled)).toEqual([moved.compiled]);
});

test('the first morphTo with nothing on screen just shows the map', () => {
  const c = clock();
  const controller = new MorphController(c.now);
  const first = member('globe');
  controller.morphTo(first);
  expect(controller.isMorphing).toBe(false);
  expect(controller.source().map((m) => m.compiled)).toEqual([first.compiled]);
});

/** Probes: one very short line per place, so that each survives any cut as one line. */
function probes(): Record<string, GeoJSON.GeoJsonObject> {
  const layers: Record<string, GeoJSON.GeoJsonObject> = {};
  for (let lon = -170; lon < 180; lon += 40) {
    for (const lat of [-50, -20, 15, 45]) {
      const line: GeoJSON.LineString = { type: 'LineString', coordinates: [[lon + 0.37, lat + 0.21], [lon + 0.38, lat + 0.21]] };
      layers[`${lon},${lat}`] = line;
    }
  }
  return layers;
}

const mix = (a: number, b: number, t: number) => (1 - t) * a + t * b;

function expectUnmoved(before: Scene, after: Scene, tBefore: number, label: string) {
  for (const name of Object.keys(before.layers)) {
    const piece = before.layers[name]![0];
    if (!piece) continue;
    const twin = after.layers[name]![0]!;
    expect(twin, `${label}, probe ${name}`).toBeDefined();
    const gap = Math.hypot(mix(piece.src[0]!, piece.dst[0]!, tBefore) - twin.src[0]!, mix(piece.src[1]!, piece.dst[1]!, tBefore) - twin.src[1]!);
    expect(gap, `${label}, probe ${name}`).toBeLessThan(1);
  }
  // An indicatrix hidden at both ends of the old morph may appear in the new one, at alpha 0, so go by what was there.
  for (const m of before.indicatrices) {
    const [x, y] = [mix(m.srcPos[0], m.dstPos[0], tBefore), mix(m.srcPos[1], m.dstPos[1], tBefore)];
    const gap = Math.min(...after.indicatrices.map((a) => Math.hypot(a.srcPos[0] - x, a.srcPos[1] - y)));
    expect(gap, `${label}, indicatrix at ${x}, ${y}`).toBeLessThan(1);
  }
}

test('redirect: positions just after morphTo during a morph equal positions just before, within 1 px', () => {
  const routes: [string, string, string][] = [
    ['mercator', 'mollweide', 'robinson'],
    ['globe', 'goode', 'transverse-mercator'],
    ['mollweide', 'gnomonic', 'albers'],
    ['albers', 'orthographic', 'goode'],
  ];
  for (const [a, b, c] of routes) {
    // Far enough into the morph that no weight is dropped: the weights then carry over exactly.
    for (const elapsed of [250, 700, 1100, 1350]) {
      const { controller, advance } = atRest(member(a));
      controller.morphTo(member(b));
      advance(elapsed);
      const t = controller.t();
      const before = buildScene(probes(), controller.source(), controller.target(), true);
      controller.morphTo(member(c));
      const after = buildScene(probes(), controller.source(), controller.target(), true);
      expectUnmoved(before, after, t, `${a} to ${b} to ${c} at ${elapsed} ms`);
      expect(controller.t()).toBe(0);
    }
  }
}, 30_000);

test('redirect: a singular indicatrix keeps its alpha', () => {
  // The globe's limb is singular, so these fade in on the way out. A redirect must not make them pop.
  const { controller, advance } = atRest(member('globe'));
  controller.morphTo(member('mercator'));
  advance(700);
  const t = controller.t();
  const before = buildScene({}, controller.source(), controller.target(), true);
  controller.morphTo(member('mollweide'));
  const after = buildScene({}, controller.source(), controller.target(), true);
  expect(before.indicatrices.some((m) => m.alphaSrc === 0 && m.alphaDst === 1)).toBe(true);
  const alphaAt = (m: Scene['indicatrices'][number], at: number) => (1 - at) * m.alphaSrc + at * m.alphaDst;
  const byPosition = new Map(after.indicatrices.map((m) => [m.srcPos.map((v) => v.toFixed(1)).join(), m]));
  let compared = 0;
  for (const m of before.indicatrices) {
    const pos = [(1 - t) * m.srcPos[0] + t * m.dstPos[0], (1 - t) * m.srcPos[1] + t * m.dstPos[1]];
    const twin = byPosition.get(pos.map((v) => v.toFixed(1)).join());
    if (!twin) continue;
    compared++;
    expect(Math.abs(alphaAt(twin, 0) - alphaAt(m, t))).toBeLessThan(1e-9);
  }
  expect(compared).toBeGreaterThan(30);
});

test('redirect: at most 4 source members, weights sum to 1', () => {
  const { controller, advance } = atRest(member('mercator'));
  for (const id of ['mollweide', 'robinson', 'goode', 'albers', 'gnomonic', 'globe', 'hammer', 'sinusoidal']) {
    controller.morphTo(member(id));
    advance(600);
    const source = controller.source();
    expect(source.length).toBeLessThanOrEqual(4);
    expect(source.reduce((sum, m) => sum + m.weight, 0)).toBeCloseTo(1, 12);
    for (const m of source) expect(m.weight).toBeGreaterThanOrEqual(0.01);
  }
});

test('redirect: weights are (1-t) sources + t target, and restart at t = 0', () => {
  const { controller, advance } = atRest(member('mercator'));
  controller.morphTo(member('mollweide'));
  advance(700);
  const t = controller.t();
  expect(t).toBeCloseTo(0.5, 10);
  const next = member('robinson');
  controller.morphTo(next);
  expect(controller.source().map((m) => [m.compiled.def.id, m.weight])).toEqual([
    ['cylindrical', 1 - t],
    ['mollweide', t],
  ]);
  expect(controller.target()!.compiled).toBe(next.compiled);
  expect(controller.target()!.weight).toBe(1);
  expect(controller.t()).toBe(0);
});

test('redirect: a weight under 0.01 is dropped', () => {
  const { controller, advance } = atRest(member('mercator'));
  controller.morphTo(member('mollweide'));
  advance(50); // eased t is about 1.8e-4
  controller.morphTo(member('robinson'));
  expect(controller.source().map((m) => m.compiled.def.id)).toEqual(['cylindrical']);
  expect(controller.source()[0]!.weight).toBe(1);
});

test('redirect: only the 4 largest weights are kept', () => {
  const { controller, advance } = atRest(member('mercator'));
  controller.morphTo(member('mollweide'));
  advance(800); // past halfway, so Mercator weighs less than Mollweide from here on
  for (const id of ['robinson', 'goode']) {
    controller.morphTo(member(id));
    advance(700);
  }
  expect(controller.source().length).toBe(3);
  controller.morphTo(member('albers'));
  advance(700);
  expect(controller.source().length).toBe(4);
  controller.morphTo(member('hammer'));
  const ids = controller.source().map((m) => m.compiled.def.id);
  expect(ids).not.toContain('cylindrical');
  expect(ids).toEqual(['mollweide', 'robinson', 'goode', 'conic-equal-area']);
  expect(controller.source().reduce((sum, m) => sum + m.weight, 0)).toBeCloseTo(1, 12);
});

test('redirect: a member met twice counts once', () => {
  const { controller, advance } = atRest(member('mercator'));
  controller.morphTo(member('mollweide'));
  advance(700);
  controller.morphTo(member('mercator'));
  advance(700);
  // Mercator as a source and as the target are one map.
  controller.morphTo(member('robinson'));
  const source = controller.source();
  expect(source.map((m) => m.compiled.def.id)).toEqual(['cylindrical', 'mollweide']);
  expect(source[0]!.weight).toBeCloseTo(0.75, 10);
  expect(source[1]!.weight).toBeCloseTo(0.25, 10);
});

test('morphTo the current state is a no-op: no morph starts', () => {
  const { controller } = atRest(member('mercator', { lon: 20 }));
  controller.morphTo(member('mercator', { lon: 20 }));
  expect(controller.isMorphing).toBe(false);
  expect(controller.tick()).toBe(false);
});

test('morphTo the current state ignores angles the projection does not use', () => {
  const { controller } = atRest(member('albers'));
  const state = stateOf('albers');
  const compiled = compile({ ...state, orientation: { ...state.orientation, lat: 30, tilt: 40 } });
  controller.morphTo({ compiled, screen: computeScreen(compiled, VIEW), weight: 1 });
  expect(controller.isMorphing).toBe(false);
});

test('morphTo the current target mid-morph keeps it running', () => {
  const { controller, advance } = atRest(member('mercator'));
  controller.morphTo(member('mollweide'));
  advance(500);
  const t = controller.t();
  controller.morphTo(member('mollweide'));
  expect(controller.t()).toBe(t);
  expect(controller.source().length).toBe(1);
});

test('morphTo back to the source straight away ends the morph', () => {
  const { controller, advance } = atRest(member('mercator'));
  controller.morphTo(member('mollweide'));
  advance(10);
  controller.morphTo(member('mercator'));
  expect(controller.isMorphing).toBe(false);
  expect(controller.source().map((m) => m.compiled.def.id)).toEqual(['cylindrical']);
});

test('morphTo after the time is up but before a tick starts from the old target', () => {
  const { controller, advance } = atRest(member('mercator'));
  controller.morphTo(member('mollweide'));
  advance(2000);
  controller.morphTo(member('robinson'));
  expect(controller.source().map((m) => m.compiled.def.id)).toEqual(['mollweide']);
  expect(controller.t()).toBe(0);
});

test('ten morphTo calls in 100 ms settle exactly on the last target', () => {
  const { controller, advance } = atRest(member('mercator'));
  const ids = ['mollweide', 'robinson', 'goode', 'albers', 'gnomonic', 'globe', 'hammer', 'sinusoidal', 'winkel-tripel', 'equal-earth'];
  for (const id of ids) {
    controller.morphTo(member(id));
    advance(10);
    controller.tick();
  }
  expect(controller.source().length).toBeLessThanOrEqual(4);
  advance(1400);
  expect(controller.tick()).toBe(false);
  const last = member('equal-earth');
  expect(controller.source().length).toBe(1);
  expect(controller.source()[0]!.compiled.state).toEqual(last.compiled.state);
  expect(controller.source()[0]!.screen).toEqual(last.screen);
  expect(controller.target()).toBeNull();
});

test('resize mid-morph keeps t and refits both ends', () => {
  const { controller, advance } = atRest(member('mercator'));
  controller.morphTo(member('mollweide'));
  advance(300);
  controller.morphTo(member('robinson'));
  advance(500);
  const t = controller.t();
  const weights = controller.source().map((m) => m.weight);
  const view = { width: 500, height: 800 };
  controller.resize((m) => ({ ...m, screen: computeScreen(m.compiled, view) }));
  expect(controller.t()).toBe(t);
  expect(controller.isMorphing).toBe(true);
  expect(controller.source().map((m) => m.weight)).toEqual(weights);
  for (const m of [...controller.source(), controller.target()!]) {
    expect(m.screen).toEqual(computeScreen(m.compiled, view));
  }
  // And the timing runs on as before.
  advance(1400 - 500);
  expect(controller.tick()).toBe(false);
  const p: LonLat = [10, 20];
  const end = controller.source()[0]!;
  expect(projectPoint(end.compiled, end.screen, p)).toEqual(projectPoint(end.compiled, computeScreen(end.compiled, view), p));
});

test('resize keeps each member\'s weight whatever the function returns', () => {
  const { controller, advance } = atRest(member('mercator'));
  controller.morphTo(member('mollweide'));
  advance(700);
  controller.morphTo(member('robinson'));
  const weights = controller.source().map((m) => m.weight);
  controller.resize((m) => ({ compiled: m.compiled, screen: m.screen, weight: 1 }));
  expect(controller.source().map((m) => m.weight)).toEqual(weights);
  expect(controller.target()!.weight).toBe(1);
});

test('resize at rest refits the map', () => {
  const { controller } = atRest(member('mercator'));
  const view = { width: 400, height: 400 };
  controller.resize((m) => ({ ...m, screen: computeScreen(m.compiled, view) }));
  expect(controller.source()[0]!.screen).toEqual(computeScreen(controller.source()[0]!.compiled, view));
  expect(controller.isMorphing).toBe(false);
});
