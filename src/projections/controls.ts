import { formatDegrees, parseDegrees } from '../geo/angles';
import { POLAR_PARALLEL } from './catalog';
import { matchStop } from './compile';
import type { ProjectionState } from './types';

/** A slider that drives one parameter of a projection: its range, the values it snaps to, and how its value is written and read. */
export interface ParamControl {
  key: string;
  label: string;
  /** What the parameter is, in a sentence. */
  tip: string;
  min: number;
  max: number;
  step: number;
  /** Values the slider snaps to, and shows a tick at. */
  stops?: number[];
  snap?: number;
  format?(v: number): string;
  parse?(raw: string): number | null;
  /** What a screen reader says for a value, if the number alone is not enough. */
  valueText?(v: number): string;
}

/** The viewpoint slider's axis x is P / (1 + P): 0 is gnomonic, 0.5 stereographic and 1 orthographic. */
const distanceOf = (x: number): number => x / (1 - x);
const formatViewpoint = (x: number): string => (x >= 1 ? '∞' : String(Number(distanceOf(x).toPrecision(3))));
const viewpointText = (x: number): string => {
  const name = x < 0.001 ? ', gnomonic' : Math.abs(x - 0.5) < 0.001 ? ', stereographic' : x > 0.999 ? ', orthographic' : '';
  return `P = ${formatViewpoint(x)}${name}`;
};

/** Typed text for the viewpoint: a distance P in Earth radii, or inf. A negative distance is the nearest there is. */
export function parseViewpoint(raw: string): number | null {
  const text = raw.trim().toLowerCase();
  if (text === '∞' || text === 'inf' || text === 'infinity') return 1;
  const distance = text === '' ? NaN : Number(text);
  if (Number.isNaN(distance)) return null;
  return Math.max(0, distance) === Infinity ? 1 : Math.max(0, distance) / (1 + Math.max(0, distance));
}

const degrees = { format: formatDegrees, parse: parseDegrees };

const conicParallel = (key: string, label: string): ParamControl => ({
  key,
  label,
  tip: 'A parallel where the cone meets the globe and the scale is true. Both at the equator make a cylinder; both at a pole, a disc',
  min: -POLAR_PARALLEL,
  max: POLAR_PARALLEL,
  step: 0.1,
  stops: [-POLAR_PARALLEL, 0, POLAR_PARALLEL],
  snap: 1,
  ...degrees,
});
const conic = [conicParallel('p1', 'First parallel'), conicParallel('p2', 'Second parallel')];

const CONTROLS: Record<string, ParamControl[]> = {
  perspective: [
    {
      key: 'x',
      label: 'Viewpoint',
      tip: 'Where the rays come from, in Earth radii from the centre: 0 is gnomonic, 1 stereographic, ∞ orthographic',
      min: 0,
      max: 1,
      step: 0.005,
      stops: [0, 0.5, 1],
      snap: 0.02,
      format: formatViewpoint,
      valueText: viewpointText,
      parse: parseViewpoint,
    },
  ],
  cylindrical: [
    { key: 'phi0', label: 'Standard parallel', tip: 'The parallel, north and south, where the scale is true', min: 0, max: 80, step: 0.5, stops: [0, 30, 45], snap: 1.5, ...degrees },
    { key: 'spacing', label: 'Vertical spacing', tip: 'How the parallels are spaced: 0 as Mercator, 1 evenly, 2 for equal areas', min: 0, max: 2, step: 0.01, stops: [0, 1, 2], snap: 0.04 },
  ],
  'conic-conformal': conic,
  'conic-equal-area': conic,
};

/** The sliders that a definition's parameters have, in the order they are shown. None for a definition with no parameters. */
export const controlsFor = (defId: string): ParamControl[] => CONTROLS[defId] ?? [];

/**
 * What the map on screen is called: the named projection it sits on, "Custom" between names, or, for a conic whose sliders have
 * reached a limit, the projection it has become there.
 */
export function nameOf(state: ProjectionState): string {
  const match = matchStop(state);
  if (!match) return 'Custom';
  return match.defId === state.defId ? match.name : `${match.name} (cone limit)`;
}
