import { expect, test } from 'vitest';
import { parseDegrees, parseViewpoint } from '../src/ui/sidebar';
import { clampLat, clampTilt, normaliseLon, snapValue } from '../src/ui/slider';

test('snapValue snaps inside the tolerance and not outside', () => {
  const stops = [0, 30, 45];
  expect(snapValue(29, stops, 1.5)).toBe(30);
  expect(snapValue(31.5, stops, 1.5)).toBe(30);
  expect(snapValue(31.6, stops, 1.5)).toBe(31.6);
  expect(snapValue(44, stops, 1.5)).toBe(45);
  expect(snapValue(37, stops, 1.5)).toBe(37);
  // The nearer of two stops inside the tolerance wins.
  expect(snapValue(1, [0, 3], 2.5)).toBe(0);
  expect(snapValue(5, [], 1)).toBe(5);
});

test('normaliseLon wraps to [-180, 180), clampLat to ±90 and clampTilt to 0 to 90', () => {
  expect(normaliseLon(999)).toBe(-81);
  expect(normaliseLon(-190)).toBe(170);
  expect(normaliseLon(180)).toBe(-180);
  expect(normaliseLon(-180)).toBe(-180);
  expect(normaliseLon(40)).toBe(40);
  expect(clampLat(100)).toBe(90);
  expect(clampLat(-100)).toBe(-90);
  expect(clampLat(12)).toBe(12);
  expect(clampTilt(-5)).toBe(0);
  expect(clampTilt(95)).toBe(90);
  expect(clampTilt(45)).toBe(45);
});

test('typed degrees: a number with or without the degree sign, and nothing else', () => {
  expect(parseDegrees('45')).toBe(45);
  expect(parseDegrees('45\u00b0')).toBe(45);
  expect(parseDegrees(' -30.5 \u00b0 ')).toBe(-30.5);
  expect(parseDegrees('999')).toBe(999); // clamped by the slider, which knows its range
  expect(parseDegrees('')).toBeNull();
  expect(parseDegrees('   ')).toBeNull();
  expect(parseDegrees('abc')).toBeNull();
  expect(parseDegrees('12abc')).toBeNull();
  expect(parseDegrees('Infinity')).toBeNull();
});

test('typed viewpoint: a distance P in Earth radii, or inf, as the slider axis x = P / (1 + P)', () => {
  expect(parseViewpoint('0')).toBe(0);
  expect(parseViewpoint('1')).toBe(0.5);
  expect(parseViewpoint('3')).toBe(0.75);
  expect(parseViewpoint(' 1 ')).toBe(0.5);
  for (const raw of ['inf', 'INF', 'Infinity', '\u221e', ' \u221e ', '1e999']) expect(parseViewpoint(raw), raw).toBe(1);
  // A negative distance is the nearest one there is, as the degree sliders clamp.
  expect(parseViewpoint('-3')).toBe(0);
  expect(parseViewpoint('')).toBeNull();
  expect(parseViewpoint('abc')).toBeNull();
  expect(parseViewpoint('-inf')).toBeNull();
});
