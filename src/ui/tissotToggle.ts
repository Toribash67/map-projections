import type { App } from '../app';
import { el } from './dom';
import { icon } from './icons';
import { tip } from './tooltip';

/** Whether typing is going into this element, which then owns the keys. */
const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable]') !== null;

/** Turns the Tissot indicatrices on and off, by a button on the map and the key T. It stands in until the layers have a panel of their own. */
export function createTissotToggle(app: App): HTMLButtonElement {
  const button = el('button', 'map-button');
  button.type = 'button';
  button.setAttribute('aria-label', 'Tissot indicatrices');
  button.append(icon('circle'));
  tip(button, "Tissot's indicatrices: what a small circle on the globe becomes at each place on this map", 'T');
  const toggle = () => app.setTissot(!app.tissot);
  button.addEventListener('click', toggle);
  window.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target) || e.key.toUpperCase() !== 'T') return;
    toggle();
    e.preventDefault();
  });
  const render = () => button.setAttribute('aria-pressed', String(app.tissot));
  app.subscribe(render);
  render();
  return button;
}
