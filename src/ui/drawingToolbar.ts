import type { App } from '../app';
import { DrawingModel, type Tool } from '../drawing/model';
import { screenToLonLat } from '../screen/screen';
import { el } from './dom';
import { icon, type IconName } from './icons';
import { attachMapPointer } from './mapPointer';
import { tip } from './tooltip';

type Pair = [number, number];

const TOOLS: { tool: Exclude<Tool, 'none'>; label: string; key: string; text: string }[] = [
  { tool: 'line', label: 'Line', key: 'L', text: 'Draw a line: click to place points, then Finish, Enter or a double-click. Escape cancels' },
  { tool: 'polygon', label: 'Polygon', key: 'P', text: 'Draw a polygon: click to place corners, then Finish, Enter or a double-click. Escape cancels' },
  { tool: 'circle', label: 'Circle', key: 'C', text: 'Draw a circle: click for the centre, then again for the radius. Escape cancels' },
];
// The second click of a double-click, within this long (ms) and this far (CSS pixels) of the first, places no point of its own.
const DOUBLE_CLICK_MS = 500;
const DOUBLE_CLICK_PX = 6;

/** Whether typing is going into this element, which then owns the keys. */
const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable]') !== null;

const formatKm = (km: number) => `${km < 100 ? km.toFixed(1) : Math.round(km).toLocaleString('en-US')} km`;

/**
 * The line, polygon and circle tools: their buttons on the map, and what the map does with clicks, the cursor and the keyboard. Clicks
 * reach the model as latitude and longitude, and what it draws is handed to the app as its shapes. Why a point was refused is said in
 * `notice`. Also attaches the map pointer.
 */
export function createDrawingToolbar(app: App, canvas: HTMLCanvasElement, notice: HTMLElement): { el: HTMLElement; model: DrawingModel } {
  const model = new DrawingModel();
  const root = el('div', 'toolbar');
  root.setAttribute('role', 'toolbar');
  root.setAttribute('aria-label', 'Drawing tools');

  const button = (name: IconName, label: string, text: string, shortcut: string | undefined, className: string, act: () => void) => {
    const b = el('button', `map-button ${className}`);
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.append(icon(name));
    tip(b, text, shortcut);
    b.addEventListener('click', act);
    root.append(b);
    return b;
  };
  const choose = (tool: Exclude<Tool, 'none'>) => model.setTool(model.tool === tool ? 'none' : tool);
  const buttons = TOOLS.map(({ tool, label, key, text }) => {
    const b = button(tool, label, text, key, 'tool', () => choose(tool));
    b.dataset.tool = tool;
    return { tool, button: b };
  });
  root.append(el('span', 'toolbar-gap'));
  // A phone has no Enter, and a double tap is no surer than two taps: Finish does what Enter does.
  const finish = button('finish', 'Finish', 'End the line, or close the polygon', 'Enter', 'draw-action', () => model.finish());
  const undo = button('undo', 'Undo', 'Take back the last point, then the last shape', undefined, 'draw-action', () => model.undo());
  const clear = button('clear', 'Clear', 'Remove every shape', undefined, 'draw-action', () => model.clear());

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
    const chosen = TOOLS.find(({ key }) => key === e.key.toUpperCase());
    if (e.key === 'Escape' && model.draft) {
      model.cancel();
      e.preventDefault();
    } else if (e.key === 'Enter' && model.draft && !(e.target instanceof HTMLButtonElement)) {
      model.finish();
      e.preventDefault();
    } else if (chosen) {
      choose(chosen.tool);
      e.preventDefault();
    }
  });

  // The cursor was read from the map that was there. A morph moves it, so the rubber band waits for the next move.
  app.subscribe(() => {
    if (app.isMorphing) model.preview(null);
  });

  function render(): void {
    for (const { tool, button: b } of buttons) b.setAttribute('aria-pressed', String(model.tool === tool));
    canvas.dataset.tool = model.tool;
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
