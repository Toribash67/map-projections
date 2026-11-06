import { expect, test } from 'vitest';
import { fromFrame, toFrame } from '../src/geo/orientation';
import type { LonLat, Orientation } from '../src/projections/types';

function wrapLon(d: number): number {
  return ((((d + 180) % 360) + 360) % 360) - 180;
}

function expectLonLat(actual: LonLat, expected: LonLat, eps = 1e-9) {
  expect(Math.abs(wrapLon(actual[0] - expected[0]))).toBeLessThan(eps);
  expect(Math.abs(actual[1] - expected[1])).toBeLessThan(eps);
}

const orientations: Orientation[] = [
  { lon: 0, lat: 0, tilt: 0 },
  { lon: 40, lat: 20, tilt: 30 },
  { lon: -120, lat: -55, tilt: 90 },
  { lon: 10, lat: 0, tilt: 0 },
  { lon: 179, lat: 70, tilt: 45 },
];
const points: LonLat[] = [[0, 0], [12, 34], [-170, -60], [100, 45], [-45, 80], [179.5, -10]];

test('frame round trip', () => {
  for (const o of orientations) {
    for (const p of points) {
      expectLonLat(fromFrame(o, toFrame(o, p)), p);
    }
  }
});

test('centre maps to frame origin', () => {
  expectLonLat(toFrame({ lon: 40, lat: 20, tilt: 30 }, [40, 20]), [0, 0]);
  expectLonLat(toFrame({ lon: -120, lat: -55, tilt: 90 }, [-120, -55]), [0, 0]);
});

test('tilt turns the frame about the centre, so the centre stays put and others move', () => {
  const flat = toFrame({ lon: 0, lat: 0, tilt: 0 }, [0, 30]);
  const tilted = toFrame({ lon: 0, lat: 0, tilt: 90 }, [0, 30]);
  expect(Math.hypot(flat[0] - tilted[0], flat[1] - tilted[1])).toBeGreaterThan(10);
});
