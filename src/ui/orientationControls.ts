import type { App } from '../app';
import { clampLat, normaliseLon } from '../geo/angles';
import { getDef } from '../projections/catalog';
import { stateForStop } from '../projections/compile';
import type { Orientation, ProjectionState } from '../projections/types';
import { el } from './dom';
import { clampTilt, createSlider, formatDegrees, parseDegrees } from './slider';

const TILT_OFF = 'Tilt is off here: on the globe and the azimuthal maps it would only spin the page.';
const CONIC_OFF = 'Latitude and tilt are off: a cone keeps its axis on the pole, so a conic only moves sideways.';

/** Typed longitude wraps round the globe, so 999 is -81. */
const parseLongitude = (raw: string): number | null => {
  const v = parseDegrees(raw);
  return v === null ? null : normaliseLon(v);
};

/**
 * Centre longitude, centre latitude and tilt, each with a slider, a number and a reset, and a
 * reset for all three. They change the centre with tilt held; dragging the map is in mapPointer.
 */
export function createOrientationControls(app: App): { el: HTMLElement; set(state: ProjectionState): void } {
  const root = el('section', 'orientation');
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', 'Centre and tilt');
  const heading = el('div', 'orientation-head');
  const resetAll = el('button', 'reset-all', 'Reset all');
  resetAll.type = 'button';
  resetAll.title = 'Reset centre and tilt';
  heading.append(el('h2', '', 'Centre and tilt'), resetAll);
  const hint = el('p', 'hint');
  hint.id = 'orientation-hint';

  // The projection last chosen from the list, not the stop the map is highlighted as: Mercator tilted to 90 resets to 0.
  const defaults = () => stateForStop(app.selected).orientation;
  const change = (patch: Partial<Orientation>) => {
    app.setLive({ orientation: { ...app.state.orientation, ...patch } });
    // A change during a morph is ignored, and the controls show the map again.
    set(app.state);
  };
  const common = { step: 1, format: formatDegrees, parse: parseDegrees, value: 0 };
  const lon = createSlider({ ...common, label: 'Longitude', min: -180, max: 180, parse: parseLongitude, defaultValue: () => defaults().lon, onInput: (v) => change({ lon: v }) });
  const lat = createSlider({ ...common, label: 'Latitude', min: -90, max: 90, defaultValue: () => defaults().lat, onInput: (v) => change({ lat: clampLat(v) }) });
  const tilt = createSlider({
    ...common,
    label: 'Tilt',
    min: 0,
    max: 90,
    stops: [0, 90],
    snap: 2,
    defaultValue: () => defaults().tilt,
    onInput: (v) => change({ tilt: clampTilt(v) }),
  });
  resetAll.addEventListener('click', () => change({ ...defaults() }));
  root.append(heading, lon.el, lat.el, tilt.el, hint);

  function set(state: ProjectionState): void {
    const def = getDef(state.defId);
    const o = state.orientation;
    // A control that is off shows what the map uses, which is zero.
    lon.set(o.lon);
    lat.set(def.latEnabled ? o.lat : 0);
    tilt.set(def.tiltEnabled ? o.tilt : 0);
    lat.setEnabled(def.latEnabled);
    tilt.setEnabled(def.tiltEnabled);
    hint.textContent = !def.latEnabled ? CONIC_OFF : !def.tiltEnabled ? TILT_OFF : '';
    hint.hidden = def.latEnabled && def.tiltEnabled;
    if (hint.hidden) root.removeAttribute('aria-describedby');
    else root.setAttribute('aria-describedby', hint.id);
  }
  return { el: root, set };
}
