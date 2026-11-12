import { expect, test } from 'vitest';
import { DURATION } from '../src/morph/controller';
import { canSlide, interpolateState, Slide } from '../src/morph/slide';
import { stops } from '../src/projections/catalog';
import { stateForStop } from '../src/projections/compile';
import type { ProjectionState } from '../src/projections/types';

const stateOf = (id: string): ProjectionState => stateForStop(stops.find((s) => s.id === id)!);
const mercator = stateOf('mercator');
const transverse = stateOf('transverse-mercator');

test('tilt slides between Mercator and Transverse Mercator', () => {
  expect(interpolateState(mercator, transverse, 0.5).orientation.tilt).toBeCloseTo(45);
});

test('parameters slide', () => {
  const between = interpolateState(stateOf('lambert-cylindrical'), stateOf('gall-peters'), 0.5);
  expect(between.params.phi0).toBeCloseTo(22.5);
  expect(between.params.spacing).toBeCloseTo(2);
});

test('the centre takes the shorter way round', () => {
  const at = (lon: number): ProjectionState => ({ ...mercator, orientation: { lon, lat: 0, tilt: 0 } });
  expect(Math.abs(interpolateState(at(170), at(-170), 0.5).orientation.lon)).toBeCloseTo(180);
});

test('the centre moves evenly between places on opposite meridians, and never jumps: its longitude the shorter way, its latitude straight', () => {
  const at = (lon: number, lat: number): ProjectionState => ({ ...mercator, orientation: { lon, lat, tilt: 0 } });
  // Half a turn apart on the equator there is no one great circle between the two, and none is asked for.
  for (const u of [0.001, 0.01, 0.1, 0.25, 0.5, 0.9]) {
    const { lon, lat } = interpolateState(at(0, 0), at(180, 0), u).orientation;
    expect(Math.abs(lon), `u ${u}`).toBeCloseTo(180 * u, 6);
    expect(lat, `u ${u}`).toBeCloseTo(0, 6);
  }
  // Nor does it go over the pole, where the map would turn half round in a frame.
  for (const u of [0.1, 0.5, 0.9]) expect(interpolateState(at(0, 40), at(180, 40), u).orientation.lat).toBeCloseTo(40, 6);
  const between = interpolateState(at(30, 10), at(-150, -10), 0.25).orientation;
  expect(Math.abs(Math.abs(between.lon - 30) - 45)).toBeLessThan(1e-6);
  expect(between.lat).toBeCloseTo(5, 6);
});

test('a conic, which has no centre latitude, slides its longitude the shorter way', () => {
  const albers = stateOf('albers');
  const at = (lon: number): ProjectionState => ({ ...albers, orientation: { ...albers.orientation, lon } });
  const between = interpolateState(at(160), at(-160), 0.25);
  expect(between.orientation.lon).toBeCloseTo(170);
});

test('a slide ends on the target itself, and starts on the source', () => {
  expect(interpolateState(mercator, transverse, 1)).toBe(transverse);
  expect(interpolateState(mercator, transverse, 0)).toBe(mercator);
});

test('only states of one definition slide', () => {
  expect(canSlide(mercator, transverse)).toBe(true);
  expect(canSlide(mercator, stateOf('mollweide'))).toBe(false);
  expect(canSlide(stateOf('albers'), stateOf('lambert-conformal'))).toBe(false);
});

test('a slide is eased and timed like a morph', () => {
  const slide = new Slide(mercator, transverse, 1000);
  expect(slide.at(1000 + DURATION / 2).state.orientation.tilt).toBeCloseTo(45);
  expect(slide.at(1000 + DURATION / 4).state.orientation.tilt).toBeLessThan(22.5);
  expect(slide.at(1000 + DURATION / 4).done).toBe(false);
  expect(slide.at(1000 + DURATION)).toEqual({ state: transverse, done: true });
  expect(slide.at(1000 + DURATION).state).toBe(transverse);
});
