import { fromFrame, toFrame } from '../geo/orientation';
import { coneConstant, getDef, POLAR_PARALLEL, stops } from './catalog';
import type { CompiledProjection, LonLat, Orientation, ProjectionState, Stop } from './types';

const TOLERANCE = 0.01;
// A cone this close to a cylinder is drawn as one, to within a fraction of a percent.
const CYLINDER_TOLERANCE = 5e-4;

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

/** What `stateForStop` needs to know that the states alone do not say. */
export interface SwitchMemory {
  /** The centre from before the conic being left, restored on leaving it. */
  centreBeforeConic?: LonLat;
  /** Whether the tilt was last set by hand rather than by choosing a stop that brings its own. */
  tiltByHand?: boolean;
}

/**
 * The state for choosing `stop`, given the state it is reached from.
 * The centre carries over, except that a conic arrived at from a non-conic uses its own
 * default, leaving a conic restores the centre from before it, and a conic to a conic keeps
 * the longitude. A tilt set by hand carries over where both ends allow tilt. The tilt that
 * a stop brings (Transverse Mercator's 90) does not, and Mercator is Transverse Mercator
 * turned back, so it takes tilt 0.
 */
export function stateForStop(stop: Stop, from?: ProjectionState, memory: SwitchMemory = {}): ProjectionState {
  const def = getDef(stop.defId);
  const params = { ...def.defaultParams, ...stop.params };
  const base = def.defaultOrientation;

  let { lon, lat } = base;
  let tilt = 0;
  if (from) {
    const fromDef = getDef(from.defId);
    const [toConic, fromConic] = [def.family === 'conic', fromDef.family === 'conic'];
    if (toConic && fromConic) lon = from.orientation.lon;
    else if (fromConic) [lon, lat] = memory.centreBeforeConic ?? [lon, lat];
    else if (!toConic) ({ lon, lat } = from.orientation);

    // The tilt that counts is the one the source really uses.
    const matched = matchStop(from);
    const brought = matched?.tilt !== undefined && !memory.tiltByHand;
    const turnedBack = matched?.id === 'transverse-mercator' && stop.id === 'mercator';
    if (def.tiltEnabled && fromDef.tiltEnabled && !brought && !turnedBack) tilt = from.orientation.tilt;
  }
  if (stop.tilt !== undefined) tilt = stop.tilt;
  if (!def.tiltEnabled) tilt = 0;

  return { defId: def.id, params, orientation: { lon, lat, tilt } };
}

const stopById = (id: string): Stop => stops.find((s) => s.id === id)!;

// The viewpoint this close to infinitely far (on the slider's axis, where 1 is infinity) is the orthographic view, which is the globe.
const GLOBE_FROM = 0.999;

/**
 * The named projection that a conic becomes at a limit of its sliders, or null. A cone with
 * n = 0 is a cylinder: Mercator if conformal, the cylindrical equal-area stop at the same
 * standard parallel if equal-area. Both parallels at the same pole make a disc: polar
 * stereographic or polar Lambert azimuthal equal-area.
 */
function conicLimit(state: ProjectionState): Stop | null {
  const def = getDef(state.defId);
  const { p1, p2 } = { ...def.defaultParams, ...state.params } as { p1: number; p2: number };
  const conformal = def.id === 'conic-conformal';
  if (Math.abs(coneConstant(def.id, p1, p2)) <= CYLINDER_TOLERANCE) {
    if (conformal) return stopById('mercator');
    return stops.find((s) => s.defId === 'cylindrical' && s.params.spacing === 2 && Math.abs(s.params.phi0! - Math.abs(p1)) <= TOLERANCE) ?? null;
  }
  if (p1 * p2 > 0 && Math.min(Math.abs(p1), Math.abs(p2)) >= POLAR_PARALLEL - TOLERANCE) {
    return stopById(conformal ? 'stereographic' : 'lambert-azimuthal');
  }
  return null;
}

/**
 * The named stop that `state` sits on, with params within 0.01, or null. Tilt and centre are an
 * aspect, not another projection, so a tilted Mollweide is Mollweide. The one exception is a stop
 * that brings its own tilt: Mercator at tilt 90 (within 0.01) is Transverse Mercator. A conic
 * that has reached a limit of its sliders sits on the stop it becomes, which belongs to
 * another definition, and so does the perspective view from infinitely far, which is the globe.
 */
export function matchStop(state: ProjectionState): Stop | null {
  const def = getDef(state.defId);
  const matching = stops.filter((stop) => {
    if (stop.defId !== state.defId) return false;
    const skipped = stop.ignoreParams ?? [];
    return Object.keys(def.defaultParams).every((key) => {
      if (skipped.includes(key)) return true;
      const have = state.params[key] ?? def.defaultParams[key]!;
      const want = stop.params[key] ?? def.defaultParams[key]!;
      return Math.abs(have - want) <= TOLERANCE;
    });
  });
  const tilt = def.tiltEnabled ? state.orientation.tilt : 0;
  const aspect = matching.find((stop) => stop.tilt !== undefined && Math.abs(tilt - stop.tilt) <= TOLERANCE);
  const plain = matching.find((stop) => stop.tilt === undefined);
  return aspect ?? plain ?? limitStop(state);
}

/**
 * The named projection that a map has become at a limit of its sliders, which belongs to another definition, or null. A conic becomes
 * a cylinder or a disc; the perspective view from infinitely far is the globe.
 */
function limitStop(state: ProjectionState): Stop | null {
  const def = getDef(state.defId);
  if (def.family === 'conic') return conicLimit(state);
  if (def.id === 'perspective' && (state.params.x ?? def.defaultParams.x!) >= GLOBE_FROM) return stopById('globe');
  return null;
}
