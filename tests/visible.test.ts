import { describe, expect, test } from 'vitest';
import { buildScene, type ScenePiece } from '../src/morph/scene';
import { stops } from '../src/projections/catalog';
import { compile, stateForStop } from '../src/projections/compile';
import { loadMapData } from '../src/layers/mapData';
import { computeScreen } from '../src/screen/screen';
import { applyView, clampView } from '../src/screen/view';
import { visibleCap } from '../src/screen/visible';
import { graticule, rng, VIEW } from './sceneSupport';

type Pair = [number, number];

/** The lines that reach into the window, each as its numbers, in an order of their own. */
function linesInWindow(pieces: ScenePiece[]): string[] {
  const inside = (x: number, y: number) => x >= 0 && x <= VIEW.width && y >= 0 && y <= VIEW.height;
  const out: string[] = [];
  for (const { src, ringStarts } of pieces) {
    ringStarts.forEach((start, r) => {
      const end = r + 1 < ringStarts.length ? ringStarts[r + 1]! : src.length / 2;
      for (let i = start + 1; i < end; i++) {
        const [x0, y0, x1, y1] = [src[2 * i - 2]!, src[2 * i - 1]!, src[2 * i]!, src[2 * i + 1]!];
        if (inside(x0, y0) || inside(x1, y1)) out.push(`${x0},${y0},${x1},${y1}`);
      }
    });
  }
  return out.sort();
}

/** How many times the fills go round each of some places in the window: what a fill shows there. */
function windings(pieces: ScenePiece[], places: Pair[]): number[] {
  const rings: { points: Float32Array; x0: number; x1: number; y0: number; y1: number }[] = [];
  for (const { src, ringStarts, closed } of pieces) {
    if (!closed) continue;
    ringStarts.forEach((start, r) => {
      const points = src.subarray(2 * start, r + 1 < ringStarts.length ? 2 * ringStarts[r + 1]! : src.length);
      let [x0, x1, y0, y1] = [Infinity, -Infinity, Infinity, -Infinity];
      for (let i = 0; i < points.length; i += 2) {
        x0 = Math.min(x0, points[i]!);
        x1 = Math.max(x1, points[i]!);
        y0 = Math.min(y0, points[i + 1]!);
        y1 = Math.max(y1, points[i + 1]!);
      }
      rings.push({ points, x0, x1, y0, y1 });
    });
  }
  return places.map(([x, y]) => {
    let winding = 0;
    for (const ring of rings) {
      if (x < ring.x0 || x > ring.x1 || y < ring.y0 || y > ring.y1) continue;
      const p = ring.points;
      for (let i = 2; i < p.length; i += 2) {
        const [ax, ay, bx, by] = [p[i - 2]!, p[i - 1]!, p[i]!, p[i + 1]!];
        if (ay <= y !== by <= y && (bx - ax) * (y - ay) - (x - ax) * (by - ay) > 0 === by > ay) winding += by > ay ? 1 : -1;
      }
    }
    return winding;
  });
}

describe('a map looked at closely is cut only where it is seen', () => {
  test('and shows in the window all that the whole map shows there', async () => {
    const { land, coast, borders } = await loadMapData('50m');
    const layers = { land, coast, borders, graticule };
    const random = rng(7);
    let [culled, whole, caps] = [0, 0, 0];
    for (const stop of stops) {
      for (let n = 0; n < 6; n++) {
        const base = stateForStop(stop);
        const state = { ...base, orientation: { lon: 360 * random() - 180, lat: 120 * random() - 60, tilt: base.orientation.tilt } };
        const compiled = compile(state);
        const zoom = [3, 5, 12, 32][n % 4]!;
        const reach = ((zoom - 1) / 2) * (2 * random() - 1);
        const view = clampView({ zoom, panX: reach * VIEW.width, panY: ((zoom - 1) / 2) * (2 * random() - 1) * VIEW.height }, VIEW);
        const m = { compiled, screen: applyView(computeScreen(compiled, VIEW), view, VIEW), weight: 1 };
        const all = buildScene(layers, [m], null, false);
        const cap = visibleCap(m.compiled, m.screen, VIEW);
        if (!cap) continue;
        caps++;
        const seen = buildScene(layers, [m], null, false, cap);
        const places = Array.from({ length: 150 }, (): Pair => [VIEW.width * random(), VIEW.height * random()]);
        const points = (pieces: ScenePiece[]) => pieces.reduce((sum, piece) => sum + piece.src.length / 2, 0);
        for (const name of Object.keys(layers)) {
          const which = `${stop.id} ${JSON.stringify(state.orientation)} ${JSON.stringify(view)} ${name}`;
          if (name === 'land') expect(windings(seen.layers[name]!, places), which).toEqual(windings(all.layers[name]!, places));
          else expect(linesInWindow(seen.layers[name]!), which).toEqual(linesInWindow(all.layers[name]!));
          culled += points(seen.layers[name]!);
          whole += points(all.layers[name]!);
        }
      }
    }
    // And it is worth it: most windows have a cap, and most of the map is left out, though many of these windows are at the edge of a map or off it.
    expect(caps).toBeGreaterThan(0.8 * 6 * stops.length);
    expect(culled).toBeLessThan(0.5 * whole);
  }, 120_000);

  test('the same map in the same window has the same cap', () => {
    const compiled = compile(stateForStop(stops.find((s) => s.id === 'mercator')!));
    const screen = applyView(computeScreen(compiled, VIEW), { zoom: 4, panX: 0, panY: 0 }, VIEW);
    const cap = visibleCap(compiled, screen, VIEW);
    expect(cap).not.toBeNull();
    expect(visibleCap(compiled, screen, VIEW)).toBe(cap);
  });
});
