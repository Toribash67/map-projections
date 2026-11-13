import type { App } from '../app';
import { CORNERS, LAYER_NAMES, SMALLEST_NAME, TITLE_LENGTH, type Corner, type GraticuleStep, type LayerId } from '../layers/layers';
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
  rivers: 'The larger rivers',
  lakes: 'The larger lakes',
  depth: 'The sea in four steps, darker where it is deeper: 200, 2000, 4000 and 6000 metres',
  countryNames: 'The name of each country, fitted to its shape on this map',
  seaNames: 'The names of the oceans and the larger seas',
  degrees: 'The latitude or longitude of each line, written where it leaves the map',
  frame: 'A line round the picture, and more margin within it',
  titleBox: 'A box with a title, the name of the projection and its settings',
  tissot: "Tissot's indicatrices: what a small circle on the globe becomes at each place on this map",
  standard: "The parallels where this map's scale is true",
  reference: 'The equator, the tropics and the polar circles',
  drawings: 'The shapes drawn on the map',
};
const NO_STANDARD = 'This map has no parallel where its scale is true everywhere along it';
const STEPS: GraticuleStep[] = [10, 15, 30];
// What is written and drawn over the map, in the order it is listed for choosing.
const NAME_LAYERS: [LayerId, string][] = [['countryNames', 'Country names'], ['seaNames', 'Sea names']];
const PLATE_LAYERS: [LayerId, string][] = [['frame', 'Frame'], ['titleBox', 'Title box']];
const CORNER_NAMES: Record<Corner, string> = { tl: 'Top left', tm: 'Top middle', tr: 'Top right', ml: 'Middle left', mm: 'Centre', mr: 'Middle right', bl: 'Bottom left', bm: 'Bottom middle', br: 'Bottom right' };
const UNDER = 'The graticule under the land: over the sea only';
const SMALLEST = 'The smallest lettering a name may have, in pixels of the screen. The smaller, the more countries are named; an export is the screen enlarged, so lettering too small to read here can be read in print';
const NO_GRATICULE = 'The graticule is off';

/** A colour as '#rrggbb', which is all a colour box can hold: an 'rgba(...)' colour without its opacity. */
function asHex(colour: string): string {
  if (colour.startsWith('#')) return colour.toLowerCase();
  const [r, g, b] = colour.match(/\d+(\.\d+)?/g)!.map(Number);
  return `#${[r!, g!, b!].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * The Layers button on the map, and the panel it opens: a box for each layer, how fine the graticule is, the names and how small they
 * may be, the frame and the title box with what the box says, the theme, and the map's colours, each of which can be set by hand over
 * the theme's and reset to it. The key T turns the indicatrices on and off. The
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
  /** A row with a box that shows or hides a layer. */
  const layerRow = (id: LayerId, name: string, className = 'layer-row'): HTMLDivElement => {
    const label = el('label', 'layer');
    const input = el('input', '');
    input.type = 'checkbox';
    input.addEventListener('change', () => app.setLayer(id, input.checked));
    label.append(input, document.createTextNode(name));
    tip(label, TIPS[id], id === 'tissot' ? 'T' : undefined);
    const row = el('div', className);
    row.append(label);
    boxes.set(id, { input, label });
    return row;
  };
  // What goes with the graticule, under it: its degrees, and whether it lies under the land.
  const under = el('input', '');
  under.type = 'checkbox';
  under.addEventListener('change', () => app.setLayerOptions({ graticuleUnder: under.checked }));
  const underLabel = el('label', 'layer');
  underLabel.append(under, document.createTextNode('Under the land'));
  tip(underLabel, UNDER);
  const underRow = el('div', 'layer-row sub');
  underRow.append(underLabel);
  for (const [id, name] of LAYER_NAMES) {
    const row = layerRow(id, name);
    if (id === 'graticule') row.append(steps);
    list.append(row);
    if (id === 'graticule') list.append(layerRow('degrees', 'Degrees', 'layer-row sub'), underRow);
  }

  // Names.
  const names = el('div', 'layer-list');
  for (const [id, name] of NAME_LAYERS) names.append(layerRow(id, name));
  const smallestRow = el('label', 'option-row', 'Smallest name');
  const smallest = el('input', 'smallest');
  smallest.type = 'range';
  smallest.min = String(SMALLEST_NAME.min);
  smallest.max = String(SMALLEST_NAME.max);
  smallest.step = '0.5';
  smallest.setAttribute('aria-label', 'Smallest name');
  const smallestValue = el('output', 'option-value');
  smallest.addEventListener('input', () => app.setLayerOptions({ smallestName: Number(smallest.value) }));
  smallestRow.append(smallest, smallestValue);
  tip(smallestRow, SMALLEST);
  names.append(smallestRow);

  // The plate: the frame, and the title box with what it says and where it sits.
  const plate = el('div', 'layer-list');
  for (const [id, name] of PLATE_LAYERS) plate.append(layerRow(id, name));
  const textRow = (name: string, key: 'title' | 'subtitle', hint: string) => {
    const row = el('label', 'option-row', name);
    const input = el('input', 'plate-text');
    input.type = 'text';
    input.maxLength = TITLE_LENGTH;
    input.spellcheck = false;
    input.addEventListener('input', () => app.setLayerOptions({ [key]: input.value }));
    row.append(input);
    tip(row, hint);
    plate.append(row);
    return input;
  };
  const title = textRow('Title', 'title', 'The title in the box, lettered in capitals. Left empty, the box has none');
  const subtitle = textRow('Subtitle', 'subtitle', 'A line under the title. Left empty, the box has none');
  // Where the box sits: a small picture of the picture, with a place to press for each of the nine.
  const placeRow = el('div', 'option-row', 'Place');
  tip(placeRow, 'Where in the picture the title box sits. It does not keep clear of the map: choose a place the map leaves empty');
  const places = el('span', 'places');
  places.setAttribute('role', 'radiogroup');
  places.setAttribute('aria-label', 'Place');
  const placeInputs = CORNERS.map((id) => {
    const input = el('input', 'place');
    input.type = 'radio';
    input.name = 'title-place';
    input.value = id;
    input.setAttribute('aria-label', CORNER_NAMES[id]);
    tip(input, CORNER_NAMES[id]);
    input.addEventListener('change', () => app.setLayerOptions({ corner: id }));
    places.append(input);
    return input;
  });
  placeRow.append(places);
  plate.append(placeRow);

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

  panel.append(el('h2', 'panel-heading', 'Layers'), list, el('h2', 'panel-heading', 'Names'), names, el('h2', 'panel-heading', 'Plate'), plate, el('h2', 'panel-heading', 'Colours'), themeRow, colours, resetAll);
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
      if (id === 'degrees') {
        // The degrees are the graticule's: without it there are none.
        input.disabled = !on.graticule;
        label.setAttribute('aria-description', input.disabled ? NO_GRATICULE : TIPS.degrees);
        label.classList.toggle('disabled', input.disabled);
      }
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
    under.checked = app.layers.graticuleUnder;
    under.disabled = !on.graticule;
    underLabel.classList.toggle('disabled', under.disabled);
    smallest.disabled = !on.countryNames && !on.seaNames;
    smallest.value = String(app.layers.smallestName);
    smallestValue.textContent = `${app.layers.smallestName} px`;
    smallest.setAttribute('aria-valuetext', `${app.layers.smallestName} pixels`);
    smallestRow.classList.toggle('disabled', smallest.disabled);
    // Not under the hand of someone typing.
    if (document.activeElement !== title) title.value = app.layers.title;
    if (document.activeElement !== subtitle) subtitle.value = app.layers.subtitle;
    for (const control of [title, subtitle]) {
      control.disabled = !on.titleBox;
      control.parentElement!.classList.toggle('disabled', control.disabled);
    }
    for (const input of placeInputs) {
      input.checked = input.value === app.layers.corner;
      input.disabled = !on.titleBox;
    }
    placeRow.classList.toggle('disabled', !on.titleBox);
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
