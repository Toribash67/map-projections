import { expect, test } from 'vitest';
import type { ScreenTransform, Viewport } from '../src/screen/screen';
import { applyView, clampView, FIT, MAX_ZOOM, panBy, zoomAbout, type View } from '../src/screen/view';

const V: Viewport = { width: 1000, height: 600 };
const fit: ScreenTransform = { k: 150, tx: 500, ty: 300, cos: Math.cos(0.3), sin: Math.sin(0.3) };
/** Where a transform puts a raw point, as `projectFrame` does. */
const place = (s: ScreenTransform, [x, y]: [number, number]): [number, number] => [s.tx + s.k * (s.cos * x - s.sin * y), s.ty - s.k * (s.sin * x + s.cos * y)];
const raw: [number, number] = [0.7, -0.4];

test('the fit under no view is the fit', () => {
  expect(applyView(fit, FIT, V)).toEqual(fit);
  expect(FIT).toEqual({ zoom: 1, panX: 0, panY: 0 });
});

test('a view zooms about the middle of the viewport and then moves by its pan', () => {
  const s = applyView(fit, { zoom: 2, panX: 30, panY: -10 }, V);
  const [before, after] = [place(fit, raw), place(s, raw)];
  expect(after[0]).toBeCloseTo(500 + 2 * (before[0] - 500) + 30, 9);
  expect(after[1]).toBeCloseTo(300 + 2 * (before[1] - 300) - 10, 9);
  // The turn that keeps north up is the fit's own.
  expect([s.cos, s.sin]).toEqual([fit.cos, fit.sin]);
});

test('zooming about a point keeps what is under it where it is', () => {
  let view: View = FIT;
  const at: [number, number] = [640, 210];
  for (const factor of [1.5, 2, 0.8, 3]) {
    // The raw point under `at` before, by undoing the view.
    const s0 = applyView(fit, view, V);
    const next = zoomAbout(view, V, at, factor);
    const s1 = applyView(fit, next, V);
    const under = (s: ScreenTransform): [number, number] => {
      const [u, w] = [(at[0] - s.tx) / s.k, (s.ty - at[1]) / s.k];
      return [s.cos * u + s.sin * w, -s.sin * u + s.cos * w];
    };
    expect(under(s1)[0]).toBeCloseTo(under(s0)[0], 9);
    expect(under(s1)[1]).toBeCloseTo(under(s0)[1], 9);
    expect(next.zoom).toBeCloseTo(view.zoom * factor, 9);
    view = next;
  }
});

test('zoom is held between the fit and the most there is, and at the fit there is no pan', () => {
  expect(zoomAbout(FIT, V, [100, 100], 0.5)).toEqual(FIT);
  const far = zoomAbout({ zoom: 20, panX: 0, panY: 0 }, V, [500, 300], 10);
  expect(far.zoom).toBe(MAX_ZOOM);
  expect(MAX_ZOOM).toBe(32);
  // Zooming out to the fit from a corner ends with the map in the middle again.
  const corner = zoomAbout(FIT, V, [0, 0], 4);
  expect(corner.panX).toBeGreaterThan(0);
  expect(zoomAbout(corner, V, [900, 500], 0.1)).toEqual(FIT);
});

test('the pan is limited so that the zoomed frame always covers the window', () => {
  const view = panBy({ zoom: 3, panX: 0, panY: 0 }, V, 5000, -5000);
  expect(view).toEqual({ zoom: 3, panX: 1000, panY: -600 });
  expect(clampView({ zoom: 2, panX: -900, panY: 100 }, V)).toEqual({ zoom: 2, panX: -500, panY: 100 });
  expect(panBy({ zoom: 3, panX: 0, panY: 0 }, V, 12, 7)).toEqual({ zoom: 3, panX: 12, panY: 7 });
  // A smaller window brings a view at its old limit inside the new one.
  expect(clampView({ zoom: 3, panX: 1000, panY: 600 }, { width: 400, height: 300 })).toEqual({ zoom: 3, panX: 400, panY: 300 });
  expect(clampView({ zoom: 0.4, panX: 3, panY: 3 }, V)).toEqual(FIT);
});
