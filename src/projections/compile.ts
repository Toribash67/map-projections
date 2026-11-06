import { fromFrame, toFrame } from '../geo/orientation';
import { getDef, stops } from './catalog';
import type { CompiledProjection, Orientation, ProjectionState, Stop } from './types';

const TOLERANCE = 0.01;

/** The orientation the projection really uses: disabled controls count as zero. */
function effectiveOrientation(state: ProjectionState, tiltEnabled: boolean, latEnabled: boolean): Orientation {
  const o = state.orientation;
  return { lon: o.lon, lat: latEnabled ? o.lat : 0, tilt: tiltEnabled ? o.tilt : 0 };
}

export function compile(state: ProjectionState): CompiledProjection {
  const def = getDef(state.defId);
  const params = { ...def.defaultParams, ...state.params };
  const o = effectiveOrientation(state, def.tiltEnabled, def.latEnabled);
  return {
    def,
    state,
    raw: def.raw(params),
    caps: def.caps(params),
    toFrame: (p) => toFrame(o, p),
    fromFrame: (p) => fromFrame(o, p),
  };
}

/**
 * The state for choosing `stop`, given the state it is reached from.
 * The centre carries over, except into or out of a conic, which use their own
 * default. A tilt set by hand carries over where the destination allows tilt,
 * `stop.tilt` overrides it, and leaving Transverse Mercator resets it to 0.
 */
export function stateForStop(stop: Stop, from?: ProjectionState): ProjectionState {
  const def = getDef(stop.defId);
  const params = { ...def.defaultParams, ...stop.params };
  const base = def.defaultOrientation;

  let { lon, lat } = base;
  let tilt = 0;
  if (from) {
    const conic = def.family === 'conic' || getDef(from.defId).family === 'conic';
    if (!conic) ({ lon, lat } = from.orientation);
    const leavingTransverse = matchStop(from)?.id === 'transverse-mercator';
    if (def.tiltEnabled && !leavingTransverse) tilt = from.orientation.tilt;
  }
  if (stop.tilt !== undefined) tilt = stop.tilt;
  if (!def.tiltEnabled) tilt = 0;

  return { defId: def.id, params, orientation: { lon, lat, tilt } };
}

/** The named stop that `state` sits on, with params and tilt within 0.01, or null. */
export function matchStop(state: ProjectionState): Stop | null {
  const def = getDef(state.defId);
  for (const stop of stops) {
    if (stop.defId !== state.defId) continue;
    const skipped = stop.ignoreParams ?? [];
    const paramsMatch = Object.keys(def.defaultParams).every((key) => {
      if (skipped.includes(key)) return true;
      const have = state.params[key] ?? def.defaultParams[key]!;
      const want = stop.params[key] ?? def.defaultParams[key]!;
      return Math.abs(have - want) <= TOLERANCE;
    });
    if (!paramsMatch) continue;
    if (def.tiltEnabled && Math.abs(state.orientation.tilt - (stop.tilt ?? 0)) > TOLERANCE) continue;
    return stop;
  }
  return null;
}
