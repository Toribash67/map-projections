import type { App } from '../app';
import { getDef, POLAR_PARALLEL, stops } from '../projections/catalog';
import { matchStop } from '../projections/compile';
import { createProjectionList } from './projectionList';
import { el } from './dom';
import { createSlider, type SliderOptions } from './slider';

const CONIC_DEFS = ['conic-conformal', 'conic-equal-area'];
// The definitions whose parameters a family's sliders drive. The others in the family leave them off.
const FAMILY_DEFS: Record<string, string[]> = { azimuthal: ['perspective'], cylindrical: ['cylindrical'], conic: CONIC_DEFS };
const FAMILY_HINTS: Record<string, string> = {
  azimuthal: 'Choose Gnomonic, Stereographic or Orthographic to use this slider. The other two are not perspective views.',
};
const DEFAULT_HINT = 'Choose a projection in this family to use these sliders.';
const TISSOT_NOTE =
  'Each ellipse is what a tiny circle on the globe becomes on this map, enlarged so it can be seen. The circle tool draws real circles of fixed size, which can come out differently.';
const CUSTOM_NOTE = 'Between named projections. A valid map, but not an established one.';

/** The viewpoint slider's axis x is P / (1 + P): 0 is gnomonic, 0.5 stereographic and 1 orthographic. */
const distanceOf = (x: number): number => x / (1 - x);
const formatViewpoint = (x: number): string => (x >= 1 ? '\u221e' : String(Number(distanceOf(x).toPrecision(3))));
const viewpointText = (x: number): string => {
  const name = x < 0.001 ? ', gnomonic' : Math.abs(x - 0.5) < 0.001 ? ', stereographic' : x > 0.999 ? ', orthographic' : '';
  return `P = ${formatViewpoint(x)}${name}`;
};

/** Typed text for the viewpoint: a distance P in Earth radii, or inf. A negative distance is the nearest there is. */
export function parseViewpoint(raw: string): number | null {
  const text = raw.trim().toLowerCase();
  if (text === '\u221e' || text === 'inf' || text === 'infinity') return 1;
  const distance = text === '' ? NaN : Number(text);
  if (Number.isNaN(distance)) return null;
  return Math.max(0, distance) === Infinity ? 1 : Math.max(0, distance) / (1 + Math.max(0, distance));
}

const formatDegrees = (v: number): string => `${Math.round(v * 100) / 100}\u00b0`;
/** Typed text for an angle: a number, with or without the degree sign. */
export function parseDegrees(raw: string): number | null {
  const text = raw.replace('\u00b0', '').trim();
  return text === '' || !Number.isFinite(Number(text)) ? null : Number(text);
}

/** The sidebar: projection list with its family sliders, the Tissot toggle and the projection's note. */
export function createSidebar(app: App, root: HTMLElement): void {
  const list = createProjectionList(stops, (stop) => app.select(stop));
  const note = document.createElement('section');
  note.className = 'note';
  note.id = 'note';
  const noteTitle = document.createElement('h3');
  const noteText = document.createElement('p');
  note.append(noteTitle, noteText);

  // A slider drives one parameter of the definitions it applies to, and is off for the others.
  const bound: { set(state: App['state']): void }[] = [];
  const bind = (family: string, key: string, fallback: () => number, opts: Omit<SliderOptions, 'value' | 'defaultValue' | 'onInput'> & { defaultValue?: SliderOptions['defaultValue'] }) => {
    const slider = createSlider({
      ...opts,
      value: fallback(),
      defaultValue: opts.defaultValue ?? fallback,
      onInput: (v) => {
        app.setLive({ params: { ...app.state.params, [key]: v } });
        // A change during a morph is ignored, and the slider shows the map again.
        sync();
      },
    });
    list.slotFor(family).append(slider.el);
    bound.push({
      set(state) {
        const active = FAMILY_DEFS[family]!.includes(state.defId);
        slider.setEnabled(active);
        slider.set(active ? (state.params[key] ?? getDef(state.defId).defaultParams[key]!) : fallback());
      },
    });
  };

  bind('azimuthal', 'x', () => 0.5, {
    label: 'Viewpoint',
    min: 0,
    max: 1,
    step: 0.005,
    stops: [0, 0.5, 1],
    snap: 0.02,
    format: formatViewpoint,
    valueText: viewpointText,
    parse: parseViewpoint,
  });
  bind('cylindrical', 'phi0', () => 0, {
    label: 'Standard parallel',
    min: 0,
    max: 80,
    step: 0.5,
    stops: [0, 30, 45],
    snap: 1.5,
    format: formatDegrees,
    parse: parseDegrees,
  });
  bind('cylindrical', 'spacing', () => 1, {
    label: 'Vertical spacing',
    min: 0,
    max: 2,
    step: 0.01,
    stops: [0, 1, 2],
    snap: 0.04,
  });

  // The conic's two parallels reset to those of whichever conic is on the map.
  const conicDefault = (key: 'p1' | 'p2') => () => getDef(CONIC_DEFS.includes(app.state.defId) ? app.state.defId : 'conic-equal-area').defaultParams[key]!;
  for (const [key, label] of [['p1', 'First parallel'], ['p2', 'Second parallel']] as const) {
    bind('conic', key, () => getDef('conic-equal-area').defaultParams[key]!, {
      label,
      min: -POLAR_PARALLEL,
      max: POLAR_PARALLEL,
      step: 0.1,
      stops: [-POLAR_PARALLEL, 0, POLAR_PARALLEL],
      snap: 1,
      defaultValue: conicDefault(key),
      format: formatDegrees,
      parse: parseDegrees,
    });
  }

  const kind = document.createElement('div');
  kind.className = 'kind';
  kind.setAttribute('role', 'radiogroup');
  kind.setAttribute('aria-label', 'Preserves');
  const kindLabel = document.createElement('span');
  kindLabel.textContent = 'Preserves';
  kind.append(kindLabel);
  const radios = CONIC_DEFS.map((defId) => {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'conic-kind';
    input.value = defId;
    input.addEventListener('change', () => {
      app.setLive({ defId });
      sync();
    });
    label.append(input, document.createTextNode(defId === 'conic-conformal' ? 'Conformal' : 'Equal-area'));
    kind.append(label);
    return input;
  });
  list.slotFor('conic').append(kind);

  // A family whose sliders are off says why, in the slot where they are.
  const hints = Object.keys(FAMILY_DEFS).map((family) => {
    const slot = list.slotFor(family);
    const hint = el('p', 'hint', FAMILY_HINTS[family] ?? DEFAULT_HINT);
    hint.id = `hint-${family}`;
    slot.setAttribute('role', 'group');
    slot.setAttribute('aria-label', `${family[0]!.toUpperCase()}${family.slice(1)} sliders`);
    slot.prepend(hint);
    return { family, slot, hint };
  });
  bound.push({
    set(state) {
      const active = CONIC_DEFS.includes(state.defId);
      for (const radio of radios) {
        radio.disabled = !active;
        radio.checked = active && radio.value === state.defId;
      }
    },
  });

  const tissot = document.createElement('section');
  tissot.className = 'tissot';
  const toggle = document.createElement('label');
  toggle.className = 'toggle';
  const check = document.createElement('input');
  check.type = 'checkbox';
  check.addEventListener('change', () => app.setTissot(check.checked));
  toggle.append(check, document.createTextNode('Tissot indicatrices'));
  const tissotNote = document.createElement('p');
  tissotNote.id = 'tissot-note';
  tissotNote.className = 'hint';
  tissotNote.textContent = TISSOT_NOTE;
  tissot.append(toggle, tissotNote);

  const title = document.createElement('h1');
  title.textContent = 'Map projections';
  root.append(title, list.el, note, tissot);

  function sync(): void {
    const { state } = app;
    const match = matchStop(state);
    const reachedFromConic = match !== null && match.defId !== state.defId;
    list.update({ family: getDef(state.defId).family, match, reachedFromConic });
    for (const b of bound) b.set(state);
    for (const { family, slot, hint } of hints) {
      const active = FAMILY_DEFS[family]!.includes(state.defId);
      hint.hidden = active;
      if (active) slot.removeAttribute('aria-describedby');
      else slot.setAttribute('aria-describedby', hint.id);
    }
    check.checked = app.tissot;
    noteTitle.textContent = match ? (reachedFromConic ? `${match.name}, reached from the conic sliders` : match.name) : 'Custom';
    noteText.textContent = match?.note ?? CUSTOM_NOTE;
  }
  app.subscribe(sync);
  sync();
}
