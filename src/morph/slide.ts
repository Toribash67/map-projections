import { geoInterpolate } from 'd3-geo';
import { normaliseLon } from '../geo/angles';
import { getDef } from '../projections/catalog';
import type { Orientation, Params, ProjectionState } from '../projections/types';
import { DURATION, easeInOutCubic } from './controller';

/** Whether one state can turn into the other through real maps: both are the same formula, with other numbers in it. */
export const canSlide = (a: ProjectionState, b: ProjectionState): boolean => a.defId === b.defId;

const mix = (a: number, b: number, u: number): number => a + (b - a) * u;

function paramsBetween(a: ProjectionState, b: ProjectionState, u: number): Params {
  const defaults = getDef(a.defId).defaultParams;
  const out: Params = {};
  for (const key of new Set([...Object.keys(defaults), ...Object.keys(a.params), ...Object.keys(b.params)])) {
    out[key] = mix(a.params[key] ?? defaults[key]!, b.params[key] ?? defaults[key]!, u);
  }
  return out;
}

/**
 * The centre goes along the great circle between the two, which is the shorter way. A map with no centre latitude of its own, a
 * conic, only turns about its axis: its longitude goes the shorter way round and the latitude it does not use goes straight.
 */
function orientationBetween(a: Orientation, b: Orientation, latEnabled: boolean, u: number): Orientation {
  const tilt = mix(a.tilt, b.tilt, u);
  if (!latEnabled) return { lon: normaliseLon(a.lon + normaliseLon(b.lon - a.lon) * u), lat: mix(a.lat, b.lat, u), tilt };
  const [lon, lat] = geoInterpolate([a.lon, a.lat], [b.lon, b.lat])(u);
  return { lon: normaliseLon(lon), lat, tilt };
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
    orientation: orientationBetween(a.orientation, b.orientation, getDef(a.defId).latEnabled, u),
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
