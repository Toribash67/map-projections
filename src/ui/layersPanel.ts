import type { App } from '../app';
import { LAYER_NAMES, type GraticuleStep, type LayerId } from '../layers/layers';
import { hasStandardLines } from '../layers/standardLines';
import { PALETTES } from '../theme/palette';
import { currentScheme } from '../theme/scheme';
import { COLOUR_NAMES, resolvePalette, THEME_NAMES, type ColourKey, type ThemeId } from '../theme/themes';
import { el, isTyping } from './dom';
import { icon } from './icons';
import { popover } from './popover';
import { tip } from './tooltip';

const TIPS: Record<LayerId, string> = {
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

/** A colour as '#rrggbb', which is all a colour box can hold: an 'rgba(...)' colour without its opacity. */
function asHex(colour: string): string {
  if (colour.startsWith('#')) return colour.toLowerCase();
  const [r, g, b] = colour.match(/\d+(\.\d+)?/g)!.map(Number);
  return `#${[r!, g!, b!].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * The Layers button on the map, and the panel it opens: a box for each layer, how fine the graticule is, the theme, and the map's
 * colours, each of which can be set by hand over the theme's and reset to it. The key T turns the indicatrices on and off. The
 * button is put in `container`, with the panel beside it.
 */
export function createLayersPanel(app: App, container: HTMLElement): HTMLButtonElement {
  const button = el('button', 'map-button');
  button.type = 'button';
  button.setAttribute('aria-label', 'Layers and colours');
  button.append(icon('layers'));
  tip(button, 'Layers and colours');

  const panel = el('div', 'layers-panel');
  panel.id = 'layers-panel';
  panel.setAttribute('aria-label', 'Layers and colours');

  // Layers.
  const boxes = new Map<LayerId, { input: HTMLInputElement; label: HTMLLabelElement }>();
  const list = el('div', 'layer-list');
  const steps = el('span', 'graticule-steps');
  steps.setAttribute('role', 'radiogroup');
  steps.setAttribute('aria-label', 'Graticule spacing');
  const stepInputs = STEPS.map((step) => {
    const label = el('label', 'step');
    const input = el('input', '');
    input.type = 'radio';
    input.name = 'graticule-step';
    input.value = String(step);
    input.addEventListener('change', () => app.setGraticuleStep(step));
    label.append(input, document.createTextNode(`${step}°`));
    steps.append(label);
    return input;
  });
  for (const [id, name] of LAYER_NAMES) {
    const label = el('label', 'layer');
    const input = el('input', '');
    input.type = 'checkbox';
    input.addEventListener('change', () => app.setLayer(id, input.checked));
    label.append(input, document.createTextNode(name));
    tip(label, TIPS[id], id === 'tissot' ? 'T' : undefined);
    const row = el('div', 'layer-row');
    row.append(label);
    if (id === 'graticule') row.append(steps);
    list.append(row);
    boxes.set(id, { input, label });
  }

  // Theme and colours.
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
  const pickers = COLOUR_NAMES.map(([key, name]) => {
    const row = el('div', 'colour-row');
    const label = el('label', 'colour', name);
    const input = el('input', '');
    input.type = 'color';
    input.id = `colour-${key}`;
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

  panel.append(el('h2', 'panel-heading', 'Layers'), list, el('h2', 'panel-heading', 'Colours'), themeRow, colours, resetAll);
  container.append(button);
  popover(button, panel, 'below-right');

  window.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target) || e.key.toUpperCase() !== 'T') return;
    app.setTissot(!app.tissot);
    e.preventDefault();
  });

  // The colour a picker shows where none is set by hand: the theme's own.
  const themed = (key: ColourKey) => resolvePalette(app.theme, {}, currentScheme())[key] ?? PALETTES.light[key];

  function render(): void {
    const { on, graticuleStep } = app.layers;
    for (const [id, { input, label }] of boxes) {
      input.checked = on[id];
      if (id !== 'standard') continue;
      // A layer that this map cannot show stays as it was asked for, and says why it is not seen.
      input.disabled = !hasStandardLines(app.state.defId);
      label.setAttribute('aria-description', input.disabled ? NO_STANDARD : TIPS.standard);
      label.classList.toggle('disabled', input.disabled);
    }
    for (const input of stepInputs) {
      input.checked = Number(input.value) === graticuleStep;
      input.disabled = !on.graticule;
    }
    theme.value = app.theme;
    let any = false;
    for (const { key, input, reset } of pickers) {
      const own = app.overrides[key];
      // Not under the hand of someone choosing a colour.
      if (document.activeElement !== input) input.value = asHex(own ?? themed(key));
      reset.hidden = own === undefined;
      any ||= own !== undefined;
    }
    resetAll.hidden = !any;
  }
  app.subscribe(render);
  render();
  return button;
}
