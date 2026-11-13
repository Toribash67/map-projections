import { formatDegrees, parseDegrees } from '../geo/angles';
import { CONIC_BAND, getDef, NEAREST_VIEW, POLAR_PARALLEL } from './catalog';
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

/** The globe's view distance, written in Earth radii. The slider's axis is one over it, so that infinitely far is at one end. */
const formatDistance = (d: number): string => (d <= 0 ? '\u221e' : `${Number((1 / d).toPrecision(2))}\u00d7`);
/** Typed text for the view distance: a number of radii, with or without a times sign, or inf. Nearer than the nearest is the nearest. */
function parseDistance(raw: string): number | null {
  const text = raw.trim().toLowerCase().replace(/[\u00d7x]\s*$/, '').trim();
  if (text === '\u221e' || text === 'inf' || text === 'infinity') return 0;
  const distance = text === '' ? NaN : Number(text);
  if (Number.isNaN(distance)) return null;
  return distance === Infinity ? 0 : 1 / Math.max(NEAREST_VIEW, distance);
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
/** A cut of a conic. Its range is the widest any cone allows: the map keeps a cut within what its own cone does. */
const conicCut = (key: string, label: string, tip: string, min: number, max: number): ParamControl => ({ key, label, tip, min, max, step: 0.5, ...degrees });
const conic = [
  conicParallel('p1', 'First parallel'),
  conicParallel('p2', 'Second parallel'),
  conicCut('south', 'Cut south of', 'The latitude south of which the map is cut off. Reset, it is where the cone cuts itself, and follows the parallels', -90, 90 - CONIC_BAND),
  conicCut('north', 'Cut north of', 'The latitude north of which the map is cut off. Reset, it is where the cone cuts itself, and follows the parallels', CONIC_BAND - 90, 90),
];

const CONTROLS: Record<string, ParamControl[]> = {
  globe: [
    {
      key: 'd',
      label: 'View distance',
      tip: "The eye's distance from the Earth's centre, in Earth radii. From nearer, less of the globe is in sight; 6.6 is a geostationary satellite's",
      min: 0,
      max: 1 / NEAREST_VIEW,
      step: 0.005,
      stops: [0, 1 / 6.6, 0.5],
      snap: 0.02,
      format: formatDistance,
      valueText: (d) => (d <= 0 ? 'infinitely far' : `${formatDistance(d).replace('\u00d7', '')} Earth radii`),
      parse: parseDistance,
    },
  ],
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
  bonne: [
    { key: 'phi1', label: 'Standard parallel', tip: "The parallel drawn at its true length and curvature. On the equator the map is sinusoidal; at the pole it is Werner's heart", min: 0, max: 90, step: 0.5, stops: [0, 45, 90], snap: 1.5, ...degrees },
  ],
  'conic-conformal': conic,
  'conic-equal-area': conic,
};

/** The sliders that a definition's parameters have, in the order they are shown. None for a definition with no parameters. */
export const controlsFor = (defId: string): ParamControl[] => CONTROLS[defId] ?? [];

/**
 * What the map on screen is called: the named projection it sits on, "Custom" between names, or, where a slider has reached a
 * limit at which the map is another projection (a conic become a cylinder, the viewpoint gone infinitely far), that projection.
 */
export function nameOf(state: ProjectionState): string {
  const match = matchStop(state);
  if (!match) return 'Custom';
  if (match.defId === state.defId) return match.name;
  return `${match.name} (${getDef(state.defId).family === 'conic' ? 'cone' : 'slider'} limit)`;
}
