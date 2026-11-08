import type { App } from '../app';
import { DrawingModel, type Tool } from '../drawing/model';
import { screenToLonLat } from '../screen/screen';
import { el } from './dom';
import { attachMapPointer } from './mapPointer';

type Pair = [number, number];

const TOOLS: [Exclude<Tool, 'none'>, string][] = [['line', 'Line'], ['polygon', 'Polygon'], ['circle', 'Circle']];
const HINTS: Record<Tool, string> = {
  none: 'Choose a tool, then click the map to place points. Dragging still moves the map.',
  line: 'Click to place points. Finish, Enter or a double-click ends the line, Escape cancels it.',
  polygon: 'Click to place points. Finish, Enter or a double-click closes the polygon, Escape cancels it.',
  circle: 'Click for the centre, then click again for the radius. Escape cancels.',
};
// The second click of a double-click, within this long (ms) and this far (CSS pixels) of the first, places no point of its own.
const DOUBLE_CLICK_MS = 500;
const DOUBLE_CLICK_PX = 6;

/** Whether typing is going into this element, which then owns Enter and Escape. */
const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable]') !== null;

const formatKm = (km: number) => `${km < 100 ? km.toFixed(1) : Math.round(km).toLocaleString('en-US')} km`;

/**
 * The line, polygon and circle tools: their buttons and notice in the sidebar, and what the map
 * does with clicks, the cursor and the keyboard. Clicks reach the model as latitude and
 * longitude, and what it draws is handed to the app as its shapes. Also attaches the map pointer.
 */
export function createDrawingTools(app: App, canvas: HTMLCanvasElement): { el: HTMLElement; model: DrawingModel } {
  const model = new DrawingModel();
  const root = el('section', 'drawing');
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', 'Drawing tools');
  const buttons = TOOLS.map(([tool, label]) => {
    const button = el('button', 'tool', label);
    button.type = 'button';
    button.addEventListener('click', () => model.setTool(model.tool === tool ? 'none' : tool));
    return { tool, button };
  });
  const toolRow = el('div', 'tool-row');
  toolRow.append(...buttons.map((b) => b.button));
  // A phone has no Enter, and a double tap is no surer than two taps: Finish does what Enter does.
  const finish = el('button', 'draw-action', 'Finish');
  const undo = el('button', 'draw-action', 'Undo');
  const clear = el('button', 'draw-action', 'Clear');
  for (const button of [finish, undo, clear]) button.type = 'button';
  finish.title = 'End the line, or close the polygon';
  undo.title = 'Take back the last point, then the last shape';
  clear.title = 'Remove every shape';
  finish.addEventListener('click', () => model.finish());
  undo.addEventListener('click', () => model.undo());
  clear.addEventListener('click', () => model.clear());
  const actionRow = el('div', 'tool-row');
  actionRow.append(finish, undo, clear);
  const hint = el('p', 'hint');
  const notice = el('p', 'draw-notice');
  notice.setAttribute('role', 'status');
  root.append(el('h2', '', 'Draw'), toolRow, actionRow, hint, notice);

  // The circle's radius, by the cursor while it is being chosen.
  const readout = el('div', 'draw-readout');
  readout.hidden = true;
  readout.setAttribute('aria-hidden', 'true');
  document.body.append(readout);

  const lonLatAt = (xy: Pair) => {
    const live = app.live;
    return live ? screenToLonLat(live.compiled, live.screen, xy) : null;
  };
  const at = (e: MouseEvent): Pair => {
    const box = canvas.getBoundingClientRect();
    return [e.clientX - box.left, e.clientY - box.top];
  };

  let lastClick: { xy: Pair; at: number } | null = null;
  attachMapPointer(canvas, app, {
    onClick(xy) {
      const now = performance.now();
      const again = lastClick !== null && now - lastClick.at < DOUBLE_CLICK_MS && Math.hypot(xy[0] - lastClick.xy[0], xy[1] - lastClick.xy[1]) < DOUBLE_CLICK_PX;
      lastClick = { xy, at: now };
      const p = lonLatAt(xy);
      // A double-click comes as two clicks and then the double-click: the point is placed once.
      if (p && !again) model.addPoint(p);
    },
  });

  // After the map pointer, so that a drag has moved the map before the cursor is read from it.
  canvas.addEventListener('pointermove', (e) => {
    if (model.tool === 'none') return;
    model.preview(lonLatAt(at(e)));
    readout.style.left = `${e.clientX + 14}px`;
    readout.style.top = `${e.clientY + 14}px`;
  });
  canvas.addEventListener('pointerleave', () => model.preview(null));
  canvas.addEventListener('dblclick', () => {
    // A circle is finished by its second click.
    if (model.tool === 'line' || model.tool === 'polygon') model.finish();
  });
  window.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
    if (e.key === 'Escape' && model.draft) {
      model.cancel();
      e.preventDefault();
    } else if (e.key === 'Enter' && model.draft && !(e.target instanceof HTMLButtonElement)) {
      model.finish();
      e.preventDefault();
    }
  });

  // The cursor was read from the map that was there. A morph moves it, so the rubber band waits for the next move.
  app.subscribe(() => {
    if (app.isMorphing) model.preview(null);
  });

  function render(): void {
    for (const { tool, button } of buttons) button.setAttribute('aria-pressed', String(model.tool === tool));
    canvas.dataset.tool = model.tool;
    hint.textContent = HINTS[model.tool];
    notice.textContent = model.notice ?? '';
    notice.hidden = model.notice === null;
    const km = model.radiusKm;
    readout.hidden = km === null;
    if (km !== null) readout.textContent = formatKm(km);
    finish.disabled = !model.canFinish;
    undo.disabled = model.shapes.length === 0 && model.draft === null;
    clear.disabled = undo.disabled;
  }
  model.subscribe(() => {
    app.shapes = model.drawn();
    app.invalidateGeometry();
    render();
  });
  render();
  return { el: root, model };
}
