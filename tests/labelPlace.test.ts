import { describe, expect, test } from 'vitest';
import type { Fit, Pair } from '../src/labels/fit';
import { advanceOf, setAlong, setLevel, touches, type Measure } from '../src/labels/place';

// Every letter 0.6 of its height wide.
const measure: Measure = (text) => 0.6 * text.length;
const level = (y: number, from = 0, to = 200): Fit => ({ size: 10, gap: 0.5, curve: [[from, y], [(from + to) / 2, y], [to, y]], length: to - from });

describe('a name set along its curve', () => {
  test('its width with no space added is the sum of its letters', () => {
    expect(advanceOf('CHAD', 'country', measure)).toBeCloseTo(2.4, 9);
  });

  test('the letters stand in order about the middle of the curve, on a baseline below its middle line', () => {
    const label = setAlong('CHAD', 'country', level(50), measure);
    expect(label.glyphs.map((g) => g.ch)).toEqual(['C', 'H', 'A', 'D']);
    // Four letters of 6 and three spaces of 5: 39 in all, from 80.5 to 119.5.
    expect(label.glyphs.map((g) => g.x)).toEqual([80.5, 91.5, 102.5, 113.5].map((x) => expect.closeTo(x, 6)));
    for (const g of label.glyphs) {
      expect(g.y).toBeCloseTo(53.6, 6);
      expect(g.angle).toBeCloseTo(0, 9);
    }
    expect(label).toMatchObject({ kind: 'country', text: 'CHAD', size: 10 });
  });

  test('a space takes its room and is no letter', () => {
    const label = setAlong('A B', 'sea', level(0), measure);
    expect(label.glyphs.map((g) => g.ch)).toEqual(['A', 'B']);
    expect(label.glyphs[1]!.x - label.glyphs[0]!.x).toBeCloseTo(2 * (6 + 5), 6);
  });

  test('on a curve that climbs, each letter is turned to it', () => {
    const fit: Fit = { size: 10, gap: 0.2, curve: [[0, 100], [100, 0]], length: Math.hypot(100, 100) };
    const label = setAlong('RUSSIA', 'country', fit, measure);
    for (const g of label.glyphs) expect(g.angle).toBeCloseTo(-Math.PI / 4, 9);
    expect(label.glyphs[0]!.x).toBeLessThan(label.glyphs.at(-1)!.x);
    expect(label.glyphs[0]!.y).toBeGreaterThan(label.glyphs.at(-1)!.y);
  });

  test('level text is set about a point', () => {
    const label = setLevel('30°N', 'degree', [100, 50], 10, measure);
    expect(label.glyphs[0]!.x).toBeCloseTo(100 - 12, 6);
    expect(label.glyphs.at(-1)!.x).toBeCloseTo(100 + 6, 6);
    for (const g of label.glyphs) expect([g.y, g.angle]).toEqual([expect.closeTo(53.6, 6), 0]);
  });
});

describe('names that touch', () => {
  test('two on one line touch, two well apart do not, and a name does not touch itself alone', () => {
    const a = setAlong('CHAD', 'country', level(50), measure);
    expect(touches(a, [])).toBe(false);
    expect(touches(a, [setAlong('MALI', 'country', level(55), measure)])).toBe(true);
    expect(touches(a, [setAlong('MALI', 'country', level(150), measure)])).toBe(false);
    // Side by side on the same line with a letter's height between them: apart.
    expect(touches(setAlong('CHAD', 'country', level(50, 0, 100), measure), [setAlong('MALI', 'country', level(50, 110, 210), measure)])).toBe(false);
    expect(touches(setAlong('CHAD', 'country', level(50, 0, 100), measure), [setAlong('MALI', 'country', level(50, 30, 130), measure)])).toBe(true);
  });

  test('what a name covers is about its letters and no more', () => {
    const label = setAlong('CHAD', 'country', level(50), measure);
    const xs = label.discs.map(([x]) => x);
    expect(Math.min(...xs)).toBeGreaterThan(75);
    expect(Math.max(...xs)).toBeLessThan(125);
    for (const [, y, r] of label.discs) expect([y, r]).toEqual([expect.closeTo(50, 6), expect.closeTo(6, 6)]);
  });
});
