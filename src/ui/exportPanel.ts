import type { App } from '../app';
import type { Detail } from '../data/detail';
import { exportBlob, exportName, ExportTooLarge, screenWidth, SIZE_PRESETS, type ExportOptions } from '../export/render';
import { el } from './dom';
import { icon } from './icons';
import { popover } from './popover';
import { tip } from './tooltip';

const DETAILS: [Detail, string, string][] = [
  ['110m', '1:110m', 'The coast as it is on screen: quick, and right for a small picture'],
  ['50m', '1:50m', 'A finer coast, for a picture larger than the screen'],
  ['10m', '1:10m', 'The finest coast, for print. It takes a while'],
];
// The widest picture that can be asked for, in pixels. Browsers stop somewhere short of this, and say so.
const MAX_WIDTH = 20000;
const MIN_WIDTH = 100;

const EXPORT = 'Save the map as it is now';
const NOT_AT_REST = 'The map is moving: it can be exported when it is at rest';
const TOO_LARGE = 'Too large for this browser. Try a smaller size, or SVG.';
const FAILED = 'The export failed. Try a smaller size, or less detail.';

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

/**
 * The Export button on the map, and the panel it opens: a picture (PNG) or a drawing (SVG) of the whole map or of what the window
 * shows, at a size, from a coast as fine as wanted, on the page's colour or on nothing. What is exported is the map as it is at
 * rest, with its layers, colours and drawings, and none of the controls. The button is put in `container`, with the panel beside it.
 */
export function createExportPanel(app: App, container: HTMLElement): HTMLButtonElement {
  const button = el('button', 'map-button');
  button.type = 'button';
  button.setAttribute('aria-label', 'Export');
  button.append(icon('export'));
  tip(button, 'Export the map as a picture or a drawing');

  const panel = el('div', 'export-panel');
  panel.id = 'export-panel';
  panel.setAttribute('aria-label', 'Export');

  const format = choice<ExportOptions['format']>('Format', [['png', 'PNG', 'A picture, in pixels'], ['svg', 'SVG', 'A drawing, sharp at any size, that can be edited']], 'png', () => render());
  const extent = choice<ExportOptions['extent']>('Extent', [['map', 'Whole map'], ['view', 'Current view', 'What the window shows of a map that is zoomed in']], 'map', () => render());
  const background = choice<ExportOptions['background']>('Background', [['screen', 'As on screen'], ['transparent', 'Transparent']], 'screen', () => render());

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
  preset.addEventListener('change', () => render());
  // A width typed in is no preset's.
  width.addEventListener('input', () => (preset.value = 'custom'));

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
  tip(detail, 'How fine the coast and the borders are: Natural Earth at three scales');
  detailRow.append(detail);

  const go = el('button', 'export-go', 'Export');
  go.type = 'button';
  tip(go, EXPORT);
  const notice = el('p', 'export-notice');
  notice.setAttribute('role', 'alert');
  notice.hidden = true;

  panel.append(el('h2', 'panel-heading', 'Export'), format.el, extent.el, sizeRow, detailRow, background.el, go, notice);
  container.append(button);
  popover(button, panel, 'below-right');

  let busy = false;

  /** The width asked for: the preset's, or the one typed, kept within what can be asked. */
  const widthNow = (): number => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(Number(width.value) || MIN_WIDTH)));

  function render(): void {
    const snap = app.snapshot();
    // At the fit the view is the whole map: there is no other extent to choose.
    const zoomed = app.view.zoom > 1;
    extent.input('view').disabled = !zoomed;
    if (!zoomed) extent.value = 'map';
    // A drawing has no pixels: it is as wide as the map on screen, and can be made any size afterwards.
    sizeRow.hidden = format.value === 'svg';
    const chosen = SIZE_PRESETS.find((p) => p.id === preset.value);
    if (chosen && snap) width.value = String(chosen.width === 'screen' ? screenWidth(snap, extent.value, window.devicePixelRatio || 1) : chosen.width);
    const ready = snap !== null && !busy;
    go.setAttribute('aria-disabled', String(!ready));
    go.setAttribute('aria-description', snap === null ? NOT_AT_REST : EXPORT);
    go.classList.toggle('busy', busy);
    go.textContent = busy ? 'Exporting…' : 'Export';
  }

  async function run(): Promise<void> {
    const snap = app.snapshot();
    if (!snap || busy) return;
    const opts: ExportOptions = {
      format: format.value,
      extent: extent.value,
      width: format.value === 'svg' ? screenWidth(snap, extent.value, 1) : widthNow(),
      detail: detail.value as Detail,
      background: background.value,
    };
    busy = true;
    notice.hidden = true;
    render();
    try {
      // The button shows that it is at work before the work, which holds the page, begins.
      await new Promise((done) => setTimeout(done, 30));
      const blob = await exportBlob(snap, opts);
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = exportName(snap, opts);
      link.click();
      // The download has the file by the time this runs.
      setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
    } catch (error) {
      notice.textContent = error instanceof ExportTooLarge ? TOO_LARGE : FAILED;
      notice.hidden = false;
      if (!(error instanceof ExportTooLarge)) console.error(error);
    } finally {
      busy = false;
      render();
    }
  }
  go.addEventListener('click', () => void run());

  app.subscribe(render);
  render();
  return button;
}
