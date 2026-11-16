import type { App } from '../app';
import type { Detail } from '../data/detail';
import { screenWidth, SIZE_PRESETS, type ExportOptions, type Snapshot } from '../export/render';
import { CORNERS, COVER_NAMES, COVERS, DETAIL_NAMES, LINE_WEIGHT, SMALLEST_NAME, TITLE_LENGTH, WORLD_NAMES, type Corner, type Cover, type PrintLayerId, type PrintLayers } from '../layers/layers';
import { el } from './dom';
import { icon } from './icons';
import { createColourControls, createMapLayerControls, tickRow, type Controls } from './layerControls';
import { tip } from './tooltip';

// What can be done to a name on the picture, which nothing on the picture says.
const BY_HAND = 'A name can be dragged to another place on the picture, or clicked and taken off with Delete';
const TIPS: Record<PrintLayerId, string> = {
  rivers: 'The larger rivers',
  lakes: 'The larger lakes',
  depth: 'The sea in four steps, darker where it is deeper: 200, 2000, 4000 and 6000 metres',
  ice: 'Glaciers and ice caps, and the shelves of ice round Antarctica',
  zones: 'The time zones: every other hour in a wash over land and sea, with the hours from UTC written in the Southern Ocean',
  dateLine: 'The International Date Line',
  provinces: 'The borders within countries, of states and provinces',
  plates: 'The boundaries of the tectonic plates',
  volcanoes: 'The volcanoes that have erupted in the last ten thousand years',
  quakes: 'Earthquakes of magnitude 7 and more since 1900, each a ring the larger for its magnitude',
  regionNames: `The names of mountain ranges, deserts and plains, where the countries' names leave room. ${BY_HAND}`,
  capitals: `The capital of each country, marked and named. ${BY_HAND}`,
  cities: `Cities, the most important first, for as long as there is room: the smaller a name may be, the more of them. ${BY_HAND}`,
  peaks: `Mountain peaks, each with its height in metres. ${BY_HAND}`,
  legend: 'A box that says what the colours and the marks of the picture mean. It is there only when there is something to say',
  countryNames: `The name of each country, fitted to its shape on this map. ${BY_HAND}`,
  seaNames: `The names of the oceans and the larger seas. ${BY_HAND}`,
  degrees: 'The latitude or longitude of each line of the graticule, written where it leaves the map',
  frame: 'A line round the picture, and more margin within it',
  titleBox: 'A box with a title, the name of the projection and its settings',
};
const LETTERING: [PrintLayerId, string][] = [['countryNames', 'Country names'], ['seaNames', 'Sea names'], ['regionNames', 'Ranges and deserts'], ['capitals', 'Capitals'], ['cities', 'Cities'], ['peaks', 'Peaks'], ['degrees', 'Degrees']];
const PLATE: [PrintLayerId, string][] = [['frame', 'Frame'], ['titleBox', 'Title box']];
const COVER_TIP = 'What the land is coloured by: as the map has it, by its height in six steps, by its biome, or by its climate after Köppen. A legend says which colour is which';
const CORNER_NAMES: Record<Corner, string> = { tl: 'Top left', tm: 'Top middle', tr: 'Top right', ml: 'Middle left', mm: 'Centre', mr: 'Middle right', bl: 'Bottom left', bm: 'Bottom middle', br: 'Bottom right' };
const SMALLEST = 'The smallest lettering a name may have, in pixels of the map as the window fits it. The smaller, the more countries are named: lettering too small to read at that size can be read in a large print';
const NO_GRATICULE = 'The graticule is off';

const DETAILS: [Detail, string, string][] = [
  ['110m', '1:110m', 'The coast as it is on the map: quick, and right for a small picture'],
  ['50m', '1:50m', 'A finer coast, for a picture larger than the screen'],
  ['10m', '1:10m', 'The finest coast, for print. It takes a while'],
];
// The widest picture that can be asked for, in pixels. Browsers stop somewhere short of this, and say so.
const MAX_WIDTH = 20000;
const MIN_WIDTH = 100;
// How long (ms) after the last key a width that is being typed is taken as meant.
const TYPED_AFTER = 500;

let groups = 0;

/** A row of radio buttons under a label: one of a few choices. */
function choice<T extends string>(label: string, options: [T, string, string?][], initial: T, onChange: () => void) {
  const row = el('div', 'export-row');
  row.setAttribute('role', 'radiogroup');
  row.setAttribute('aria-label', label);
  row.append(el('span', 'export-label', label));
  const name = `export-${groups++}`;
  const inputs = options.map(([value, text, hint]) => {
    const option = el('label', 'step');
    const input = el('input', '');
    input.type = 'radio';
    input.name = name;
    input.value = value;
    input.checked = value === initial;
    input.addEventListener('change', onChange);
    option.append(input, document.createTextNode(text));
    if (hint) tip(option, hint);
    row.append(option);
    return input;
  });
  return {
    el: row,
    get value(): T {
      return inputs.find((i) => i.checked)!.value as T;
    },
    set value(v: T) {
      for (const i of inputs) i.checked = i.value === v;
    },
    input: (v: T) => inputs.find((i) => i.value === v)!,
  };
}

/** A group of controls under a heading, which folds away. */
function group(name: string, open: boolean, ...content: HTMLElement[]): HTMLDetailsElement {
  const details = el('details', 'group');
  details.open = open;
  details.append(el('summary', 'panel-heading', name), ...content);
  return details;
}

/** What the side of the export view works on, and tells of. */
export interface ExportHost {
  /** What the picture has over the map's own layers. */
  readonly print: PrintLayers;
  setPrintLayer(id: PrintLayerId, on: boolean): void;
  setPrint(patch: Partial<Omit<PrintLayers, 'on'>>): void;
  /** Whether any name has been moved or taken off by hand, and puts them all back. */
  readonly namesEdited: boolean;
  resetNames(): void;
  /** A choice about the file has changed. */
  changed(): void;
  /** Saves the picture as a file. */
  save(): void;
  /** Goes back to the map. */
  close(): void;
}

export interface ExportSide {
  el: HTMLElement;
  /** Shows everything as it is now. `busy` is while a file is being made. */
  render(busy: boolean): void;
  /** The choices made about the file, for the picture of a map. */
  choices(snap: Snapshot): ExportOptions;
  /** Says that something went wrong, or with null that nothing has. */
  notice(text: string | null): void;
}

/**
 * The side of the export view, where the sidebar is while the map is explored: everything a picture can have, and the file it is
 * saved as. From the top: the way back to the map; the map's own layers, which are the map's still and change it too; the finer
 * layers of land and sea; the lettering; the frame and the title box; and the colours. All of that scrolls. Under it, always in
 * view, is the file: a picture (PNG) or a drawing (SVG) of the whole map or of what the window showed, at a size, from a coast as
 * fine as wanted, on the page's colour or on nothing.
 */
export function createExportSide(app: App, host: ExportHost): ExportSide {
  const root = el('div', 'export-side');

  const back = el('button', 'back');
  back.type = 'button';
  back.append(icon('back'), document.createTextNode('Back to the map'));
  tip(back, 'Back to the map, to choose another projection or change this one', 'Esc');
  back.addEventListener('click', () => host.close());
  const head = el('div', 'export-head');
  head.append(el('h1', '', 'Export'), back);

  const boxes = new Map<PrintLayerId, ReturnType<typeof tickRow>>();
  const boxRow = (id: PrintLayerId, name: string): HTMLElement => {
    const box = tickRow(name, TIPS[id], (on) => host.setPrintLayer(id, on));
    boxes.set(id, box);
    return box.row;
  };

  // The map's own layers, as the Layers panel has them.
  const layers = createMapLayerControls(app);

  // Land and sea: what the land is coloured by, and the finer layers.
  const detailList = el('div', 'layer-list');
  const coverRow = el('label', 'option-row', 'Land colours');
  const cover = el('select', 'theme');
  cover.setAttribute('aria-label', 'Land colours');
  for (const id of COVERS) {
    const option = el('option', '', COVER_NAMES[id]);
    option.value = id;
    cover.append(option);
  }
  cover.addEventListener('change', () => host.setPrint({ cover: cover.value as Cover }));
  coverRow.append(cover);
  tip(coverRow, COVER_TIP);
  detailList.append(coverRow);
  for (const [id, name] of DETAIL_NAMES) detailList.append(boxRow(id, name));

  // How heavy the lines are.
  const weightRow = el('label', 'option-row', 'Line weight');
  const weight = el('input', 'smallest');
  weight.type = 'range';
  weight.min = String(LINE_WEIGHT.min);
  weight.max = String(LINE_WEIGHT.max);
  weight.step = '0.25';
  weight.setAttribute('aria-label', 'Line weight');
  const weightValue = el('output', 'option-value');
  weight.addEventListener('input', () => host.setPrint({ lineWeight: Number(weight.value) }));
  weightRow.append(weight, weightValue);
  tip(weightRow, 'How heavy every line of the picture is, as so many times what it is on the map: the coast, the borders, the rivers and the graticule');
  detailList.append(weightRow);

  // The world: what is drawn over the land and the sea to say something of them.
  const worldList = el('div', 'layer-list');
  for (const [id, name] of WORLD_NAMES) worldList.append(boxRow(id, name));

  // Lettering.
  const lettering = el('div', 'layer-list');
  for (const [id, name] of LETTERING) lettering.append(boxRow(id, name));
  const smallestRow = el('label', 'option-row', 'Smallest name');
  const smallest = el('input', 'smallest');
  smallest.type = 'range';
  smallest.min = String(SMALLEST_NAME.min);
  smallest.max = String(SMALLEST_NAME.max);
  smallest.step = '0.5';
  smallest.setAttribute('aria-label', 'Smallest name');
  const smallestValue = el('output', 'option-value');
  smallest.addEventListener('input', () => host.setPrint({ smallestName: Number(smallest.value) }));
  smallestRow.append(smallest, smallestValue);
  tip(smallestRow, SMALLEST);
  const putBack = el('button', 'reset-all', 'Put the names back');
  putBack.type = 'button';
  tip(putBack, 'Return every name that was moved or taken off to where it was fitted');
  putBack.addEventListener('click', () => host.resetNames());
  lettering.append(smallestRow, putBack);

  // The plate: the frame, and the title box with what it says and where it sits.
  const plate = el('div', 'layer-list');
  for (const [id, name] of PLATE) plate.append(boxRow(id, name));
  const textRow = (name: string, key: 'title' | 'subtitle', hint: string) => {
    const row = el('label', 'option-row', name);
    const input = el('input', 'plate-text');
    input.type = 'text';
    input.maxLength = TITLE_LENGTH;
    input.spellcheck = false;
    input.addEventListener('input', () => host.setPrint({ [key]: input.value }));
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
  /** A place to press for each of the nine. */
  const placeInputsIn = (into: HTMLElement, name: string, set: (corner: Corner) => void) =>
    CORNERS.map((id) => {
      const input = el('input', 'place');
      input.type = 'radio';
      input.name = name;
      input.value = id;
      input.setAttribute('aria-label', CORNER_NAMES[id]);
      tip(input, CORNER_NAMES[id]);
      input.addEventListener('change', () => set(id));
      into.append(input);
      return input;
    });
  const placeInputs = placeInputsIn(places, 'title-place', (corner) => host.setPrint({ corner }));
  placeRow.append(places);
  plate.append(placeRow);
  // The legend, and where it sits.
  plate.append(boxRow('legend', 'Legend'));
  const legendRow = el('div', 'option-row', 'Legend place');
  tip(legendRow, 'Where in the picture the legend sits. Where that is where the title box is, it sits next to it');
  const legendPlaces = el('span', 'places');
  legendPlaces.setAttribute('role', 'radiogroup');
  legendPlaces.setAttribute('aria-label', 'Legend place');
  const legendInputs = placeInputsIn(legendPlaces, 'legend-place', (legendCorner) => host.setPrint({ legendCorner }));
  legendRow.append(legendPlaces);
  plate.append(legendRow);

  const colours = createColourControls(app);
  const shared: Controls[] = [layers, colours];

  // The file.
  const changed = () => host.changed();
  const format = choice<ExportOptions['format']>('Format', [['png', 'PNG', 'A picture, in pixels'], ['svg', 'SVG', 'A drawing, sharp at any size, that can be edited']], 'png', changed);
  const extent = choice<ExportOptions['extent']>('Extent', [['map', 'Whole map'], ['view', 'Zoomed view', 'What the window showed of the map, where it was zoomed in']], 'map', changed);
  const background = choice<ExportOptions['background']>('Background', [['screen', 'Filled', 'The colour of the page behind the map'], ['transparent', 'Transparent', 'Nothing behind the map']], 'screen', changed);

  const sizeRow = el('div', 'export-row');
  sizeRow.append(el('span', 'export-label', 'Size'));
  const preset = el('select', 'theme');
  preset.setAttribute('aria-label', 'Size');
  for (const { id, label } of [...SIZE_PRESETS, { id: 'custom', label: 'Custom' }]) {
    const option = el('option', '', label);
    option.value = id;
    preset.append(option);
  }
  const width = el('input', 'export-width');
  width.type = 'number';
  width.min = String(MIN_WIDTH);
  width.max = String(MAX_WIDTH);
  width.step = '1';
  width.setAttribute('aria-label', 'Width in pixels');
  tip(width, 'The width of the picture, in pixels');
  sizeRow.append(preset, width, el('span', 'export-unit', 'px'));
  preset.addEventListener('change', changed);
  // A width typed in is no preset's, and is taken as meant when the typing stops.
  let typing = 0;
  width.addEventListener('input', () => {
    preset.value = 'custom';
    window.clearTimeout(typing);
    typing = window.setTimeout(changed, TYPED_AFTER);
  });
  width.addEventListener('change', () => {
    window.clearTimeout(typing);
    changed();
  });

  const detailRow = el('div', 'export-row');
  detailRow.append(el('span', 'export-label', 'Detail'));
  const detail = el('select', 'theme');
  detail.setAttribute('aria-label', 'Detail');
  for (const [value, label, hint] of DETAILS) {
    const option = el('option', '', label);
    option.value = value;
    option.title = hint;
    detail.append(option);
  }
  detail.value = '50m';
  tip(detail, 'How fine the coast, the borders, the rivers and the lakes are: Natural Earth at three scales. The finer the coast, the finer the lines it is drawn with');
  detail.addEventListener('change', changed);
  detailRow.append(detail);

  const go = el('button', 'export-go', 'Export');
  go.type = 'button';
  tip(go, 'Save the picture as it is shown');
  go.addEventListener('click', () => host.save());
  const notice = el('p', 'export-notice');
  notice.setAttribute('role', 'alert');
  notice.hidden = true;

  const body = el('div', 'export-body');
  body.append(
    group('Map', true, layers.el),
    group('Land, sea and lines', true, detailList),
    group('World', true, worldList),
    group('Lettering', true, lettering),
    group('Plate', true, plate),
    group('Colours', false, colours.el),
  );
  const file = el('div', 'export-file');
  file.setAttribute('role', 'group');
  file.setAttribute('aria-label', 'File');
  file.append(el('h2', 'panel-heading', 'File'), format.el, extent.el, sizeRow, detailRow, background.el, go, notice);
  root.append(head, body, file);

  /** The width asked for: the preset's, or the one typed, kept within what can be asked. */
  const widthNow = (): number => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(Number(width.value) || MIN_WIDTH)));

  function choices(snap: Snapshot): ExportOptions {
    // At the fit the view is the whole map: there is no other extent to choose.
    const zoomed = snap.view.zoom > 1;
    extent.el.hidden = !zoomed;
    if (!zoomed) extent.value = 'map';
    const chosen = SIZE_PRESETS.find((p) => p.id === preset.value);
    if (chosen) width.value = String(chosen.width === 'screen' ? screenWidth(snap, extent.value, window.devicePixelRatio || 1) : chosen.width);
    return {
      format: format.value,
      extent: extent.value,
      // A drawing has no pixels: it is as wide as the map on screen, and can be made any size afterwards.
      width: format.value === 'svg' ? screenWidth(snap, extent.value, 1) : widthNow(),
      detail: detail.value as Detail,
      background: background.value,
    };
  }

  function render(busy: boolean): void {
    const { print } = host;
    const graticule = app.layers.on.graticule;
    for (const [id, { input, disable }] of boxes) {
      input.checked = print.on[id];
      // The degrees are the graticule's: without it there are none.
      if (id === 'degrees') disable(graticule ? null : NO_GRATICULE);
    }
    weight.value = String(print.lineWeight);
    weightValue.textContent = `× ${print.lineWeight}`;
    weight.setAttribute('aria-valuetext', `${print.lineWeight} times`);
    cover.value = print.cover;
    const named = print.on.countryNames || print.on.seaNames || print.on.regionNames || print.on.capitals || print.on.cities || print.on.peaks;
    smallest.disabled = !named;
    smallest.value = String(print.smallestName);
    smallestValue.textContent = `${print.smallestName} px`;
    smallest.setAttribute('aria-valuetext', `${print.smallestName} pixels`);
    smallestRow.classList.toggle('disabled', !named);
    putBack.hidden = !host.namesEdited;
    // Not under the hand of someone typing.
    if (document.activeElement !== title) title.value = print.title;
    if (document.activeElement !== subtitle) subtitle.value = print.subtitle;
    for (const control of [title, subtitle]) {
      control.disabled = !print.on.titleBox;
      control.parentElement!.classList.toggle('disabled', control.disabled);
    }
    for (const input of placeInputs) {
      input.checked = input.value === print.corner;
      input.disabled = !print.on.titleBox;
    }
    placeRow.classList.toggle('disabled', !print.on.titleBox);
    for (const input of legendInputs) {
      input.checked = input.value === print.legendCorner;
      input.disabled = !print.on.legend;
    }
    legendRow.classList.toggle('disabled', !print.on.legend);
    for (const controls of shared) controls.render();
    sizeRow.hidden = format.value === 'svg';
    go.setAttribute('aria-disabled', String(busy));
    go.classList.toggle('busy', busy);
    go.textContent = busy ? 'Exporting…' : 'Export';
  }

  return {
    el: root,
    render,
    choices,
    notice(text) {
      notice.textContent = text ?? '';
      notice.hidden = text === null;
    },
  };
}
