import { describe, expect, test, vi } from 'vitest';

// A live cut that throws, for this file only: the map must still be drawn, from the full cut, for that frame.
const failing = vi.hoisted(() => ({ on: false }));
vi.mock('../src/geo/frontCut', async (original) => {
  const real = await original<typeof import('../src/geo/frontCut')>();
  return {
    ...real,
    cutFront: (...args: Parameters<typeof real.cutFront>) => {
      if (failing.on) throw new TypeError('a clip that found nothing to read');
      return real.cutFront(...args);
    },
  };
});

const { buildScene } = await import('../src/morph/scene');
const { drawScene } = await import('../src/render/draw');
const { mapStyle } = await import('../src/render/style');
const { filledArea, graticule, land, member, ocean } = await import('./sceneSupport');

/** A context that only counts what is filled and stroked. */
function countingContext() {
  const painted = { fill: 0, stroke: 0 };
  const noop = () => {};
  const ctx = new Proxy(
    { canvas: { width: 1000, height: 600 }, getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }), fill: () => void painted.fill++, stroke: () => void painted.stroke++ } as Record<string, unknown>,
    { get: (target, key) => (key in target ? target[key as string] : noop), set: () => true },
  );
  return { ctx: ctx as unknown as CanvasRenderingContext2D, painted };
}

describe('a live cut that throws', () => {
  test('falls back to the full cut for that frame: the scene has the same map, and the frame draws', () => {
    // Fresh geometry objects, so that nothing is cached from another cut.
    const layers = () => ({ ocean: { ...ocean }, land: { ...land }, graticule: { ...graticule } }) as Record<string, GeoJSON.GeoJsonObject>;
    const m = member('gnomonic', { lon: 30, lat: 20 });
    const normal = buildScene(layers(), [m], null, true);
    failing.on = true;
    try {
      const fallen = buildScene(layers(), [m], null, true);
      for (const name of ['ocean', 'land']) {
        const [a, b] = [filledArea(normal.layers[name]!, (p) => p.src), filledArea(fallen.layers[name]!, (p) => p.src)];
        expect(Math.abs(b - a) / Math.abs(a), name).toBeLessThan(0.01);
      }
      expect(fallen.layers.graticule!.length).toBeGreaterThan(0);
      const { ctx, painted } = countingContext();
      drawScene(ctx, fallen, 1, mapStyle('light'));
      expect(painted.fill).toBeGreaterThan(10);
      expect(painted.stroke).toBeGreaterThan(0);
    } finally {
      failing.on = false;
    }
  });
});
