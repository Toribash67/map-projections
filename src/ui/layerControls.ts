import type { App } from '../app';
import { LAYER_NAMES, type GraticuleStep, type MapLayerId } from '../layers/layers';
import { hasStandardLines } from '../layers/standardLines';
import { PALETTES } from '../theme/palette';
import { currentScheme } from '../theme/scheme';
import { COLOUR_NAMES, resolvePalette, THEME_NAMES, type ColourKey, type ThemeId } from '../theme/themes';
import { el } from './dom';
import { icon } from './icons';
import { tip } from './tooltip';

const TIPS: Record<MapLayerId, string> = {
  land: 'The land, filled',
  coast: 'The coastlines',
  graticule: 'Meridians and parallels',
  borders: 'The borders between countries',
  political: 'Each country in one of five colours, no two neighbours alike',
  tissot: "Tissot's indicatrices: what a small circle on the globe becomes at each place on this map",
  standard: "The parallels where this map's scale is true",
  reference: 'The equator, the tropics and the polar circles',
  drawings: 'The shapes drawn on the map',
};
const NO_STANDARD = 'This map has no parallel where its scale is true everywhere along it';
const STEPS: GraticuleStep[] = [10, 15, 30];
const UNDER = 'The graticule under the land: over the sea only';

/** Controls that are built once and then kept up with what they show. */
export interface Controls {
  el: HTMLElement;
  render(): void;
}

// The same controls are on the page more than once, and each set of radio buttons and each label needs a name of its own.
let sets = 0;

/** A row with a box to tick: its name, and a tip that says what it is. */
export function tickRow(name: string, hint: string, onChange: (on: boolean) => void, className = 'layer-row', shortcut?: string) {
  const label = el('label', 'layer');
  const input = el('input', '');
  input.type = 'checkbox';
  input.addEventListener('change', () => onChange(input.checked));
  label.append(input, document.createTextNode(name));
  tip(label, hint, shortcut);
  const row = el('div', className);
  row.append(label);
  /** Sets it out of use, with why in place of what it is; null puts it back in use. */
  const disable = (why: string | null) => {
    input.disabled = why !== null;
    label.setAttribute('aria-description', why ?? hint);
    label.classList.toggle('disabled', input.disabled);
  };
  return { row, input, label, disable };
}

/** A box for each layer of the map itself, with how fine the graticule is and whether it lies under the land. */
export function createMapLayerControls(app: App): Controls {
  const set = sets++;
  const list = el('div', 'layer-list');
  const steps = el('span', 'graticule-steps');
  steps.setAttribute('role', 'radiogroup');
  steps.setAttribute('aria-label', 'Graticule spacing');
  const stepInputs = STEPS.map((step) => {
    const label = el('label', 'step');
    const input = el('input', '');
    input.type = 'radio';
    input.name = `graticule-step-${set}`;
    input.value = String(step);
    input.addEventListener('change', () => app.setGraticuleStep(step));
    label.append(input, document.createTextNode(`${step}°`));
    steps.append(label);
    return input;
  });
  const under = tickRow('Under the land', UNDER, (on) => app.setLayerOptions({ graticuleUnder: on }), 'layer-row sub');
  const boxes = LAYER_NAMES.map(([id, name]) => {
    const box = tickRow(name, TIPS[id], (on) => app.setLayer(id, on), 'layer-row', id === 'tissot' ? 'T' : undefined);
    list.append(box.row);
    if (id === 'graticule') {
      box.row.append(steps);
      list.append(under.row);
    }
    return { id, ...box };
  });

  function render(): void {
    const { on, graticuleStep, graticuleUnder } = app.layers;
    for (const { id, input, disable } of boxes) {
      input.checked = on[id];
      // A layer that this map cannot show stays as it was asked for, and says why it is not seen.
      if (id === 'standard') disable(hasStandardLines(app.state.defId) ? null : NO_STANDARD);
    }
    for (const input of stepInputs) {
      input.checked = Number(input.value) === graticuleStep;
      input.disabled = !on.graticule;
    }
    under.input.checked = graticuleUnder;
    under.input.disabled = !on.graticule;
    under.label.classList.toggle('disabled', !on.graticule);
  }
  return { el: list, render };
}

/** A colour as '#rrggbb', which is all a colour box can hold: an 'rgba(...)' colour without its opacity. */
function asHex(colour: string): string {
  if (colour.startsWith('#')) return colour.toLowerCase();
  const [r, g, b] = colour.match(/\d+(\.\d+)?/g)!.map(Number);
  return `#${[r!, g!, b!].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

/** The theme, and those of the map's colours that `has` says, each of which can be set by hand over the theme's and reset to it. */
export function createColourControls(app: App, has: (key: ColourKey) => boolean = () => true): Controls {
  const set = sets++;
  const root = el('div', 'colours');
  const themeRow = el('label', 'theme-row', 'Theme');
  const theme = el('select', 'theme');
  theme.setAttribute('aria-label', 'Theme');
  for (const [id, name] of Object.entries(THEME_NAMES)) {
    const option = el('option', '', name);
    option.value = id;
    theme.append(option);
  }
  theme.addEventListener('change', () => app.setTheme(theme.value as ThemeId));
  themeRow.append(theme);

  const colours = el('div', 'colour-list');
  const shown = COLOUR_NAMES.filter(([key]) => has(key));
  const pickers = shown.map(([key, name]) => {
    const row = el('div', 'colour-row');
    const label = el('label', 'colour', name);
    const input = el('input', '');
    input.type = 'color';
    input.id = `colour-${key}-${set}`;
    label.htmlFor = input.id;
    input.addEventListener('input', () => app.setOverride(key, input.value));
    const reset = el('button', 'slider-reset');
    reset.type = 'button';
    reset.setAttribute('aria-label', `Reset ${name.toLowerCase()}`);
    reset.append(icon('reset'));
    tip(reset, `Return the ${name.toLowerCase()} to the theme's colour`);
    reset.addEventListener('click', () => app.setOverride(key, null));
    row.append(label, input, reset);
    colours.append(row);
    return { key, input, reset };
  });
  const resetAll = el('button', 'reset-all', 'Reset colours');
  resetAll.type = 'button';
  tip(resetAll, "Return every colour to the theme's");
  resetAll.addEventListener('click', () => {
    for (const [key] of COLOUR_NAMES) app.setOverride(key, null);
  });
  root.append(themeRow, colours, resetAll);

  // The colour a picker shows where none is set by hand: the theme's own.
  // The title box has the page's colour until it is given one.
  const themed = (key: ColourKey): string => {
    const palette = resolvePalette(app.theme, {}, currentScheme());
    return palette[key] ?? (key === 'box' ? palette.paper : PALETTES.light[key]!);
  };

  function render(): void {
    theme.value = app.theme;
    for (const { key, input, reset } of pickers) {
      const own = app.overrides[key];
      // Not under the hand of someone choosing a colour.
      if (document.activeElement !== input) input.value = asHex(own ?? themed(key));
      reset.hidden = own === undefined;
    }
    // Every colour set by hand, those not listed here too, as the button returns them all.
    resetAll.hidden = Object.keys(app.overrides).length === 0;
  }
  return { el: root, render };
}
