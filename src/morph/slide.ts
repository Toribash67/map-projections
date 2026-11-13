import { normaliseLon } from '../geo/angles';
import { getDef } from '../projections/catalog';
import { paramOf } from '../projections/compile';
import type { Orientation, Params, ProjectionState } from '../projections/types';
import { DURATION, easeInOutCubic } from './controller';

/** Whether one state can turn into the other through real maps: both are the same formula, with other numbers in it. */
export const canSlide = (a: ProjectionState, b: ProjectionState): boolean => a.defId === b.defId;

const mix = (a: number, b: number, u: number): number => a + (b - a) * u;

/**
 * A parameter that a map makes for itself, and that either end was given, goes from the one value to the other, each end's own
 * where it was not given one. Where neither was given it, the map in between makes its own.
 */
function paramsBetween(a: ProjectionState, b: ProjectionState, u: number): Params {
  const out: Params = {};
  for (const key of new Set([...Object.keys(getDef(a.defId).defaultParams), ...Object.keys(a.params), ...Object.keys(b.params)])) {
    if (a.params[key] === undefined && b.params[key] === undefined && getDef(a.defId).defaultParams[key] === undefined) continue;
    out[key] = mix(paramOf(a, key), paramOf(b, key), u);
  }
  return out;
}

/**
 * The centre's longitude goes the shorter way round, and its latitude and the tilt go straight, as the three sliders would take
 * them. Not along the great circle between the two centres: that is not one path between places half the world apart, and where
 * it passes over a pole the map, which keeps north up, would turn half round in a frame.
 */
function orientationBetween(a: Orientation, b: Orientation, u: number): Orientation {
  return { lon: normaliseLon(a.lon + normaliseLon(b.lon - a.lon) * u), lat: mix(a.lat, b.lat, u), tilt: mix(a.tilt, b.tilt, u) };
}

/**
 * The state a share `u` of the way from `a` to `b`, which are of one definition: a real map of that definition, as a slider at that
 * place would give. The ends are `a` and `b` themselves.
 */
export function interpolateState(a: ProjectionState, b: ProjectionState, u: number): ProjectionState {
  if (u <= 0) return a;
  if (u >= 1) return b;
  return {
    defId: a.defId,
    params: paramsBetween(a, b, u),
    orientation: orientationBetween(a.orientation, b.orientation, u),
  };
}

/** A slide under way: where it is at a time, eased and as long as a morph, so the two feel alike. */
export class Slide {
  constructor(
    private readonly from: ProjectionState,
    readonly to: ProjectionState,
    private readonly startedAt: number,
  ) {}

  /** The state at `now`, and whether the slide is over. At the end the state is `to` itself. */
  at(now: number): { state: ProjectionState; done: boolean } {
    const progress = Math.min(1, Math.max(0, (now - this.startedAt) / DURATION));
    return { state: interpolateState(this.from, this.to, easeInOutCubic(progress)), done: progress >= 1 };
  }
}
