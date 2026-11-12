import type { App } from '../app';
import { DrawingModel, type Mode, type Tool, type Tracer } from '../drawing/model';
import { circlePath, straightPath } from '../drawing/straight';
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
 *
 * On a flat map shapes follow the map, straight and round on it, or the globe, as great circles: `mode` is which to begin with, and
 * `onMode` is told when it is changed. On the globe they can only follow the globe.
 */
export function createDrawingToolbar(app: App, canvas: HTMLCanvasElement, notice: HTMLElement, mode: Mode = 'map', onMode: (mode: Mode) => void = () => {}): { el: HTMLElement; model: DrawingModel } {
  const model = new DrawingModel();
  // What is wanted on a flat map. The model follows the globe whenever the map is the globe.
  let wanted = mode;
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
  const follow = el('button', 'map-button');
  follow.type = 'button';
  follow.addEventListener('click', () => {
    wanted = wanted === 'map' ? 'globe' : 'map';
    onMode(wanted);
    follow_();
  });
  root.append(follow);
  tip(follow, '');
  root.append(el('span', 'toolbar-gap'));
  // A phone has no Enter, and a double tap is no surer than two taps: Finish does what Enter does.
  const finish = button('finish', 'Finish', 'End the line, or close the polygon', 'Enter', 'draw-action', () => model.finish(tracer()));
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
  /** How to trace on the map that is on screen now, or nothing while a morph runs, when there is no one map to trace on. */
  const tracer = (): Tracer | undefined => {
    const live = app.live;
    if (!live) return undefined;
    return { line: (a, b) => straightPath(live.compiled, live.screen, a, b), circle: (centre, edge) => circlePath(live.compiled, live.screen, centre, edge) };
  };
  /** Puts the model on the map or the globe, as wanted and as the map allows, and shows which on the button. */
  function follow_(): void {
    const onGlobe = app.state.defId === 'globe';
    const now: Mode = onGlobe ? 'globe' : wanted;
    model.setMode(now);
    follow.disabled = onGlobe;
    follow.dataset.mode = now;
    follow.setAttribute('aria-label', now === 'map' ? 'Shapes follow the map' : 'Shapes follow the globe');
    follow.setAttribute(
      'aria-description',
      onGlobe ? 'On the globe, shapes follow the globe: straight lines are great circles' : now === 'map' ? 'Shapes are straight and round on this map. Press for shapes that follow the globe' : 'Shapes follow the globe: lines are great circles, and circles are true circles. Press for shapes that are straight on this map',
    );
    follow.replaceChildren(icon(now === 'map' ? 'follow-map' : 'follow-globe'));
  }

  let lastClick: { xy: Pair; at: number } | null = null;
  attachMapPointer(canvas, app, {
    onClick(xy) {
      const now = performance.now();
      const again = lastClick !== null && now - lastClick.at < DOUBLE_CLICK_MS && Math.hypot(xy[0] - lastClick.xy[0], xy[1] - lastClick.xy[1]) < DOUBLE_CLICK_PX;
      lastClick = { xy, at: now };
      const p = lonLatAt(xy);
      // A double-click comes as two clicks and then the double-click: the point is placed once.
      if (p && !again) model.addPoint(p, tracer());
    },
  });

  // After the map pointer, so that a drag has moved the map before the cursor is read from it.
  canvas.addEventListener('pointermove', (e) => {
    if (model.tool === 'none') return;
    model.preview(lonLatAt(at(e)), tracer());
    readout.style.left = `${e.clientX + 14}px`;
    readout.style.top = `${e.clientY + 14}px`;
  });
  canvas.addEventListener('pointerleave', () => model.preview(null));
  canvas.addEventListener('dblclick', () => {
    // A circle is finished by its second click.
    if (model.tool === 'line' || model.tool === 'polygon') model.finish(tracer());
  });
  window.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
    const chosen = TOOLS.find(({ key }) => key === e.key.toUpperCase());
    if (e.key === 'Escape' && model.draft) {
      model.cancel();
      e.preventDefault();
    } else if (e.key === 'Enter' && model.draft && !(e.target instanceof HTMLButtonElement)) {
      model.finish(tracer());
      e.preventDefault();
    } else if (chosen) {
      choose(chosen.tool);
      e.preventDefault();
    }
  });

  // The cursor was read from the map that was there. A morph moves it, so the rubber band waits for the next move.
  app.subscribe(() => {
    if (app.isMorphing) model.preview(null);
    // The globe has only one way to draw, and a flat map has the way that was wanted back.
    if ((app.state.defId === 'globe') !== follow.disabled) follow_();
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
  follow_();
  render();
  return { el: root, model };
}
