import { describe, expect, test } from 'vitest';
import { along, clipToRect, contains, COUNTRY_FIT, fitLabel, polygonArea, shrink, textLength, type Fit, type Pair } from '../src/labels/fit';

const rect = (x: number, y: number, w: number, h: number): Pair[] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
// Five letters of 0.62 of their height each.
const [ADVANCE, COUNT] = [3.1, 5];
const fitted = (rings: Pair[][]): Fit => {
  const fit = fitLabel(rings, ADVANCE, COUNT, COUNTRY_FIT);
  expect(fit).not.toBeNull();
  return fit!;
};
/** Points over the lettering: along the part of the curve the text takes, on its middle line and half a letter's height either side. */
function lettering(fit: Fit): Pair[] {
  const length = textLength(fit, ADVANCE, COUNT);
  const out: Pair[] = [];
  for (let i = 0; i <= 10; i++) {
    const { p, angle } = along(fit.curve, fit.length / 2 - length / 2 + (i / 10) * length);
    for (const across of [-0.5, 0, 0.5]) out.push([p[0] - Math.sin(angle) * across * fit.size, p[1] + Math.cos(angle) * across * fit.size]);
  }
  return out;
}

describe('a name fitted to a shape', () => {
  test('in a long box it runs level through the middle, left to right, as tall as the box has room for', () => {
    const fit = fitted([rect(10, 10, 200, 40)]);
    for (const [, y] of fit.curve) expect(y).toBeGreaterThan(29);
    for (const [, y] of fit.curve) expect(y).toBeLessThan(31);
    expect(fit.curve[0]![0]).toBeLessThan(fit.curve.at(-1)![0]);
    expect(fit.size).toBeGreaterThan(12);
    expect(fit.size).toBeLessThan(17);
    // Spaced out along the box, but not past the limit.
    expect(fit.gap).toBeGreaterThan(COUNTRY_FIT.minGap);
    expect(fit.gap).toBeLessThanOrEqual(COUNTRY_FIT.maxGap);
    expect(textLength(fit, ADVANCE, COUNT)).toBeLessThanOrEqual(fit.length + 1e-6);
  });

  test('in a tall box it runs up the middle, reading upward', () => {
    const fit = fitted([rect(10, 10, 40, 200)]);
    for (const [x] of fit.curve) expect(Math.abs(x - 30)).toBeLessThan(1);
    expect(fit.curve[0]![1]).toBeGreaterThan(fit.curve.at(-1)![1]);
    expect(fit.size).toBeGreaterThan(12);
  });

  test('a letter is no taller than the ceiling, however much room there is', () => {
    expect(fitted([rect(0, 0, 2000, 900)]).size).toBe(COUNTRY_FIT.maxSize);
  });

  test('along a bent shape it bends with it, and the lettering stays inside', () => {
    // A band a quarter of the way round a circle, like a smile.
    const band: Pair[] = [];
    for (let a = 45; a <= 135; a += 3) band.push([300 + 200 * Math.cos((a * Math.PI) / 180), 100 + 200 * Math.sin((a * Math.PI) / 180)]);
    for (let a = 135; a >= 45; a -= 3) band.push([300 + 150 * Math.cos((a * Math.PI) / 180), 100 + 150 * Math.sin((a * Math.PI) / 180)]);
    const fit = fitted([band]);
    const [first, middle, last] = [fit.curve[0]!, fit.curve[12]!, fit.curve.at(-1)!];
    // The middle hangs below the ends, as the band's does (y grows downward).
    expect(middle[1]).toBeGreaterThan((first[1] + last[1]) / 2 + 5);
    for (const p of lettering(fit)) expect(contains([band], p), `${p}`).toBe(true);
    expect(fit.size).toBeGreaterThan(10);
  });

  test('in an L it takes the longer arm', () => {
    const shape: Pair[] = [[0, 0], [30, 0], [30, 80], [240, 80], [240, 110], [0, 110]];
    const fit = fitted([shape]);
    for (const p of lettering(fit)) expect(contains([shape], p), `${p}`).toBe(true);
    for (const [, y] of fit.curve) expect(y).toBeGreaterThan(80);
  });

  test('it does not letter across a hole', () => {
    const rings = [rect(0, 0, 120, 120), rect(40, 40, 40, 40).reverse()];
    const fit = fitted(rings);
    for (const p of lettering(fit)) expect(contains(rings, p), `${p}`).toBe(true);
    expect(fit.size).toBeGreaterThan(5);
  });

  test('in a speck its letters are specks, and in nothing there is no name', () => {
    expect(fitted([rect(0, 0, 3, 3)]).size).toBeLessThan(2);
    expect(fitLabel([[[0, 0], [1, 0]]], ADVANCE, COUNT, COUNTRY_FIT)).toBeNull();
    expect(fitLabel([], ADVANCE, COUNT, COUNTRY_FIT)).toBeNull();
  });

  test('a longer name in the same shape has smaller letters or less space between them, never more of either', () => {
    const short = fitted([rect(0, 0, 100, 60)]);
    const long = fitLabel([rect(0, 0, 100, 60)], 0.62 * 24, 24, COUNTRY_FIT)!;
    expect(long.size).toBeLessThan(short.size);
    expect(long.gap).toBeLessThanOrEqual(short.gap);
  });

  test('made smaller it keeps its curve and its spacing, so it takes less of the curve', () => {
    const fit = fitted([rect(10, 10, 200, 40)]);
    const smaller = shrink(fit, 0.8);
    expect(smaller.curve).toBe(fit.curve);
    expect(smaller.size).toBeCloseTo(0.8 * fit.size, 9);
    expect(textLength(smaller, ADVANCE, COUNT)).toBeCloseTo(0.8 * textLength(fit, ADVANCE, COUNT), 9);
  });
});

describe('shapes on screen', () => {
  test('the area of a shape is its outer ring less its holes, whichever way they wind', () => {
    expect(polygonArea([rect(0, 0, 10, 10)])).toBe(100);
    expect(polygonArea([rect(0, 0, 10, 10).reverse(), rect(2, 2, 4, 4)])).toBe(84);
    expect(polygonArea([])).toBe(0);
  });

  test('a point is in a shape if it is in its outer ring and in no hole', () => {
    const rings = [rect(0, 0, 10, 10), rect(4, 4, 2, 2)];
    expect(contains(rings, [1, 1])).toBe(true);
    expect(contains(rings, [5, 5])).toBe(false);
    expect(contains(rings, [11, 5])).toBe(false);
  });

  test('a shape is cut to a window: what is outside is gone, and what was wholly outside leaves nothing', () => {
    const window = { x: 0, y: 0, width: 100, height: 100 };
    expect(polygonArea(clipToRect([rect(50, 20, 100, 40)], window))).toBeCloseTo(50 * 40, 6);
    expect(polygonArea(clipToRect([rect(10, 10, 20, 20)], window))).toBe(400);
    expect(clipToRect([rect(200, 200, 20, 20)], window)).toEqual([]);
    // A hole is cut with its shape.
    expect(polygonArea(clipToRect([rect(-50, 0, 100, 100), rect(-10, 40, 20, 20)], window))).toBeCloseTo(50 * 100 - 10 * 20, 6);
  });

  test('a place along a curve, and the way the curve runs there', () => {
    const curve: Pair[] = [[0, 0], [10, 0], [10, 10]];
    expect(along(curve, 5)).toEqual({ p: [5, 0], angle: 0 });
    expect(along(curve, 15).p).toEqual([10, 5]);
    expect(along(curve, 15).angle).toBeCloseTo(Math.PI / 2, 9);
    // Past either end, it goes on straight.
    expect(along(curve, -2).p).toEqual([-2, 0]);
    expect(along(curve, 22).p).toEqual([10, 12]);
  });
});
