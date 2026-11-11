import type { App } from '../app';
import { MAX_ZOOM } from '../screen/view';
import { el } from './dom';
import { icon, type IconName } from './icons';
import { tip } from './tooltip';

// A press of a button or a key zooms by this much.
const STEP = 2;

/** Whether typing is going into this element, which then owns the keys. */
const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable]') !== null;

/** Zoom in, zoom out and fit, as buttons on the map and as the keys +, - and 0. The wheel and the pinch are in mapPointer. */
export function createZoomControl(app: App): HTMLElement {
  const root = el('div', 'zoom-control');
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', 'Zoom');
  const button = (name: IconName, label: string, text: string, shortcut: string, act: () => void) => {
    const b = el('button', 'map-button');
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.append(icon(name));
    tip(b, text, shortcut);
    b.addEventListener('click', act);
    root.append(b);
    return b;
  };
  const zoomIn = () => app.zoomBy(STEP);
  const zoomOut = () => app.zoomBy(1 / STEP);
  // Out by as much as the map can be zoomed, which ends at the fit.
  const fit = () => app.zoomBy(1 / MAX_ZOOM);
  const inButton = button('zoom-in', 'Zoom in', 'Zoom in. The wheel zooms about the cursor', '+', zoomIn);
  const outButton = button('zoom-out', 'Zoom out', 'Zoom out', '−', zoomOut);
  const fitButton = button('fit', 'Fit the map to the window', 'Fit the map to the window. Shift-drag moves a zoomed view', '0', fit);

  window.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
    const act = e.key === '+' || e.key === '=' ? zoomIn : e.key === '-' || e.key === '_' ? zoomOut : e.key === '0' ? fit : null;
    if (!act) return;
    act();
    e.preventDefault();
  });

  const render = () => {
    const { zoom } = app.view;
    inButton.disabled = zoom >= MAX_ZOOM;
    outButton.disabled = fitButton.disabled = zoom <= 1;
  };
  app.subscribe(render);
  render();
  return root;
}
