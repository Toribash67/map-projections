import type { App } from '../app';
import { clampLat, formatDegrees, normaliseLon, parseDegrees } from '../geo/angles';
import { getDef } from '../projections/catalog';
import { stateForStop } from '../projections/compile';
import { controlsFor, nameOf } from '../projections/controls';
import type { Orientation, ProjectionState } from '../projections/types';
import { el } from './dom';
import { clampTilt, createSlider, type Slider, type SliderOptions } from './slider';
import { tip } from './tooltip';

const CONIC_KINDS: [string, string][] = [['conic-conformal', 'Conformal'], ['conic-equal-area', 'Equal-area']];

/** Typed longitude wraps round the globe, so 999 is -81. */
const parseLongitude = (raw: string): number | null => {
  const v = parseDegrees(raw);
  return v === null ? null : normaliseLon(v);
};

/**
 * The sliders of the map on screen and no others: its definition's own parameters, its centre, and its tilt where it has one, each
 * with a number box and a reset, and a reset for all of them. A slider dragged changes the map at once; a reset or a typed value moves
 * it there. A control that does not apply to the map is not there at all. The heading names the map.
 */
export function createParameters(app: App): HTMLElement {
  const root = el('section', 'parameters');
  root.id = 'parameters';
  root.setAttribute('aria-labelledby', 'map-name');
  const heading = el('h2', 'map-name');
  heading.id = 'map-name';
  const resetAll = el('button', 'reset-all', 'Reset all');
  resetAll.type = 'button';
  tip(resetAll, "Return to the chosen projection's own parameters, centre and tilt");
  const head = el('div', 'parameters-head');
  head.append(heading, resetAll);
  const body = el('div', 'parameters-body');
  root.append(head, body);

  // What the resets return to: the projection last chosen from the list, in the definition that is on the map. Where a switch has
  // changed the definition since, as between the two conics, the definition's own.
  const defaults = (): ProjectionState => {
    const chosen = stateForStop(app.selected);
    if (chosen.defId === app.state.defId) return chosen;
    const def = getDef(app.state.defId);
    return { defId: def.id, params: { ...def.defaultParams }, orientation: chosen.orientation };
  };
  const defaultParam = (key: string) => defaults().params[key] ?? getDef(app.state.defId).defaultParams[key]!;

  // Each slider, and how it reads its value from a state. Rebuilt when the set of controls changes.
  let bound: { slider: Slider; read(state: ProjectionState): number }[] = [];
  let radios: HTMLInputElement[] = [];
  let built = '';

  const add = (options: Omit<SliderOptions, 'value' | 'onInput' | 'onSet'>, read: (state: ProjectionState) => number, patch: (v: number) => Partial<ProjectionState>) => {
    const slider = createSlider({
      ...options,
      value: read(app.state),
      onInput: (v) => {
        app.setLive(patch(v));
        // A change during a morph is ignored, and the slider shows the map again.
        sync();
      },
      onSet: (v) => {
        app.setAnimated(patch(v));
        sync();
      },
    });
    body.append(slider.el);
    bound.push({ slider, read });
  };
  const orientation = (patch: Partial<Orientation>): Partial<ProjectionState> => ({ orientation: { ...app.state.orientation, ...patch } });
  const angle = { step: 1, format: formatDegrees, parse: parseDegrees };

  function build(): void {
    const def = getDef(app.state.defId);
    body.replaceChildren();
    bound = [];
    radios = [];
    for (const control of controlsFor(def.id)) {
      const { key } = control;
      add({ ...control, defaultValue: () => defaultParam(key) }, (state) => state.params[key] ?? getDef(state.defId).defaultParams[key]!, (v) => ({ params: { ...app.state.params, [key]: v } }));
    }
    if (def.family === 'conic') body.append(kindSwitch());
    add({ ...angle, label: 'Longitude', tip: "The longitude of the map's centre", min: -180, max: 180, parse: parseLongitude, defaultValue: () => defaults().orientation.lon }, (state) => state.orientation.lon, (v) => orientation({ lon: v }));
    if (def.latEnabled) {
      add({ ...angle, label: 'Latitude', tip: "The latitude of the map's centre", min: -90, max: 90, defaultValue: () => defaults().orientation.lat }, (state) => state.orientation.lat, (v) => orientation({ lat: clampLat(v) }));
    }
    if (def.tiltEnabled) {
      add(
        { ...angle, label: 'Tilt', tip: 'Turns the globe about the centre of the map before it is projected. At 90° the map is transverse', min: 0, max: 90, stops: [0, 90], snap: 2, defaultValue: () => defaults().orientation.tilt },
        (state) => state.orientation.tilt,
        (v) => orientation({ tilt: clampTilt(v) }),
      );
    }
  }

  /** Conformal or equal-area, for a conic: two formulas, so choosing the other is a morph. */
  function kindSwitch(): HTMLElement {
    const kind = el('div', 'kind');
    kind.setAttribute('role', 'radiogroup');
    kind.setAttribute('aria-label', 'Preserves');
    kind.append(el('span', 'kind-label', 'Preserves'));
    for (const [defId, name] of CONIC_KINDS) {
      const label = el('label', 'kind-option');
      const input = el('input', '');
      input.type = 'radio';
      input.name = 'conic-kind';
      input.value = defId;
      input.addEventListener('change', () => {
        app.setAnimated({ defId });
        sync();
      });
      label.append(input, document.createTextNode(name));
      kind.append(label);
      radios.push(input);
    }
    return kind;
  }

  function sync(): void {
    const { state } = app;
    const def = getDef(state.defId);
    const signature = `${def.id}/${def.latEnabled}/${def.tiltEnabled}`;
    if (signature !== built) {
      built = signature;
      build();
    }
    heading.textContent = nameOf(state);
    for (const { slider, read } of bound) slider.set(read(state));
    for (const radio of radios) radio.checked = radio.value === state.defId;
  }

  resetAll.addEventListener('click', () => {
    const { params, orientation: o } = defaults();
    app.setAnimated({ params, orientation: o });
    sync();
  });
  app.subscribe(sync);
  sync();
  return root;
}
