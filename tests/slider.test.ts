import { expect, test } from 'vitest';
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
