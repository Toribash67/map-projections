import type { Page } from '@playwright/test';

/** A map as a stop, with any centre, tilt and parameters changed from the stop's own. */
export type MapSpec = { id: string; orientation?: { lon?: number; lat?: number; tilt?: number }; params?: Record<string, number> };

/**
 * Puts `window.__tissot` in the page: scenes built and drawn with the app's own modules, on a canvas of the
 * map's size that is not on screen, so that what Tissot adds to a frame can be measured without a frame of the app.
 * What it adds is the frame with indicatrices less the same frame without, channel by channel.
 */
export const installTissotHarness = (page: Page) =>
  page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const [{ buildScene }, { drawScene }, { mapStyle }, { compile, stateForStop }, { computeScreen }, { stops }, { LAND, COAST, GRATICULE }, { capOceanLayer }] = await Promise.all(
      ['/src/morph/scene.ts', '/src/render/draw.ts', '/src/render/style.ts', '/src/projections/compile.ts', '/src/screen/screen.ts', '/src/projections/catalog.ts', '/src/data/land.ts', '/src/geo/capCells.ts'].map(load),
    );
    const [width, height] = [1000, 600];
    const canvas = document.createElement('canvas');
    [canvas.width, canvas.height] = [width, height];
    const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true })!;
    const style = mapStyle('light');
    const ocean = { type: 'Sphere' };
    const member = (spec: any) => {
      const base = stateForStop(stops.find((s: any) => s.id === spec.id));
      const state = { ...base, params: { ...base.params, ...spec.params }, orientation: { ...base.orientation, ...spec.orientation } };
      const compiled = compile(state);
      return { compiled, screen: computeScreen(compiled, { width, height }), weight: 1 };
    };
    const image = (scene: any, t: number) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      drawScene(ctx, scene, t, style);
      return ctx.getImageData(0, 0, width, height).data;
    };
    /** What Tissot adds to the frame of `from` (morphing to `to`, at `t`), as signed channel differences. */
    const layer = (from: any, to: any, t: number): Int16Array => {
      const [source, target] = [member(from), to ? member(to) : null];
      const layers: Record<string, unknown> = { ocean, land: LAND, graticule: GRATICULE, coast: COAST };
      const cells = target ? capOceanLayer([source, target]) : null;
      if (cells) layers.capOcean = cells;
      const scene = buildScene(layers, [source], target, true);
      const on = image(scene, t);
      const off = image({ ...scene, indicatrices: [] }, t);
      const out = new Int16Array(width * height * 3);
      for (let i = 0, j = 0; i < on.length; i += 4, j += 3) {
        out[j] = on[i]! - off[i]!;
        out[j + 1] = on[i + 1]! - off[i + 1]!;
        out[j + 2] = on[i + 2]! - off[i + 2]!;
      }
      return out;
    };
    // Tiles of the frame, 100 pixels on a side: what Tissot adds in each, so that an ellipse that only moves changes them little.
    const TILE = 100;
    const tiles = (l: Int16Array): Float64Array => {
      const columns = width / TILE;
      const sums = new Float64Array(columns * (height / TILE));
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const j = 3 * (x + y * width);
          sums[Math.floor(x / TILE) + columns * Math.floor(y / TILE)]! += (Math.abs(l[j]!) + Math.abs(l[j + 1]!) + Math.abs(l[j + 2]!)) / 255;
        }
      }
      return sums;
    };
    const change = (a: Float64Array, b: Float64Array) => a.reduce((sum, v, i) => sum + Math.abs(v - b[i]!), 0);
    const total = (l: Int16Array) => l.reduce((sum, v) => sum + Math.abs(v), 0) / 255;
    const difference = (a: Int16Array, b: Int16Array) => a.reduce((sum, v, i) => sum + Math.abs(v - b[i]!), 0) / 255;
    const at = (spec: any, axis: string, value: number) => ({ ...spec, orientation: { ...spec.orientation, [axis]: value } });

    /** The frame of `from` without indicatrices, as channels. */
    const plain = (from: any) => {
      const scene = buildScene({ ocean, land: LAND, graticule: GRATICULE, coast: COAST }, [member(from)], null, true);
      return Int16Array.from(image({ ...scene, indicatrices: [] }, 1));
    };

    (window as any).__tissot = {
      /** How far apart two frames without indicatrices are, in the same units: what the map itself changes. */
      plainDifference: (a: any, b: any) => difference(plain(a), plain(b)),
      /** What Tissot adds, in all: the sum over pixels and channels of the change, over 255. */
      total: (from: any, to: any = null, t = 1) => total(layer(from, to, t)),
      /** How far apart what Tissot adds is in two frames, in the same units. */
      difference: (a: [any, any, number], b: [any, any, number]) => difference(layer(...a), layer(...b)),
      /** Where what Tissot adds differs between two frames: the box round the pixels that differ by more than 6 in all, and how many. */
      where: (a: [any, any, number], b: [any, any, number]) => {
        const [la, lb] = [layer(...a), layer(...b)];
        const box = { count: 0, x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
        for (let i = 0; i < width * height; i++) {
          const d = Math.abs(la[3 * i]! - lb[3 * i]!) + Math.abs(la[3 * i + 1]! - lb[3 * i + 1]!) + Math.abs(la[3 * i + 2]! - lb[3 * i + 2]!);
          if (d <= 6) continue;
          const [x, y] = [i % width, Math.floor(i / width)];
          box.count++;
          [box.x0, box.y0, box.x1, box.y1] = [Math.min(box.x0, x), Math.min(box.y0, y), Math.max(box.x1, x), Math.max(box.y1, y)];
        }
        return box;
      },
      /** What Tissot adds in each tile of the frame. */
      tiles: (from: any, to: any = null, t = 1) => [...tiles(layer(from, to, t))],
      /**
       * Moves one of a map's angles from `start` to `end` in steps of `step`, and finds the largest change in what Tissot adds
       * between neighbouring steps. A change, tile by tile, over a step that is more than `flag` is narrowed: the half of the step with
       * the larger change is kept, until the step is under `narrowest` degrees. Moving or growing ellipses change less and less as the
       * step shrinks; one that appears or vanishes at once does not, and is what is left at the end. What is left is measured pixel by
       * pixel, leaving out a change of one level in a channel, which is how a faint ellipse's colour rounds as its alpha moves at all.
       */
      sweep: (spec: any, axis: string, start: number, end: number, step: number, flag: number, narrowest: number) => {
        const sample = (v: number) => {
          const l = layer(at(spec, axis, v), null, 1);
          return { l, tiles: tiles(l) };
        };
        const beyondRounding = (a: Int16Array, b: Int16Array) => a.reduce((sum, v, i) => sum + Math.max(0, Math.abs(v - b[i]!) - 1), 0) / 255;
        let worst = { change: 0, from: start, to: start, coarse: 0 };
        let previous = sample(start);
        let samples = 1;
        for (let v = start + step; v <= end + 1e-9; v += step) {
          const next = sample(v);
          samples++;
          const coarse = change(previous.tiles, next.tiles);
          if (coarse > flag) {
            let [a, b, sa, sb, d] = [v - step, v, previous, next, coarse];
            while (b - a > narrowest && d > flag) {
              const m = (a + b) / 2;
              const sm = sample(m);
              samples++;
              const [left, right] = [change(sa.tiles, sm.tiles), change(sm.tiles, sb.tiles)];
              if (left >= right) [b, sb, d] = [m, sm, left];
              else [a, sa, d] = [m, sm, right];
            }
            const left = d > flag ? beyondRounding(sa.l, sb.l) : 0;
            if (left > worst.change) worst = { change: left, from: a, to: b, coarse };
          }
          previous = next;
        }
        return { ...worst, samples };
      },
    };
  });

export const tissotTotal = (page: Page, from: MapSpec, to: MapSpec | null = null, t = 1): Promise<number> =>
  page.evaluate(([from, to, t]) => (window as any).__tissot.total(from, to, t), [from, to, t] as const);

export const tissotDifference = (page: Page, a: [MapSpec, MapSpec | null, number], b: [MapSpec, MapSpec | null, number]): Promise<number> =>
  page.evaluate(([a, b]) => (window as any).__tissot.difference(a, b), [a, b] as const);

export const tissotTiles = (page: Page, from: MapSpec): Promise<number[]> => page.evaluate((from) => (window as any).__tissot.tiles(from), from);

export type Sweep = { change: number; from: number; to: number; coarse: number; samples: number };

export const tissotSweep = (page: Page, spec: MapSpec, axis: 'lon' | 'lat' | 'tilt', start: number, end: number, step: number, flag: number, narrowest: number): Promise<Sweep> =>
  page.evaluate(([spec, axis, start, end, step, flag, narrowest]) => (window as any).__tissot.sweep(spec, axis, start, end, step, flag, narrowest), [spec, axis, start, end, step, flag, narrowest] as const);

export const plainDifference = (page: Page, a: MapSpec, b: MapSpec): Promise<number> =>
  page.evaluate(([a, b]) => (window as any).__tissot.plainDifference(a, b), [a, b] as const);
