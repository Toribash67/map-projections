import type { App } from '../app';
import { stops } from '../projections/catalog';
import { matchStop } from '../projections/compile';
import { el } from './dom';
import { createParameters } from './parameters';
import { createProjectionList } from './projectionList';

/**
 * The sidebar: what chooses the projection and shapes it. A filter and the list of projections, which scrolls, and below it the
 * parameters of the map on screen, which stay in view. Everything else is on the map.
 */
export function createSidebar(app: App, root: HTMLElement): void {
  const title = el('h1', '', 'Map projections');
  const filter = el('input', 'filter');
  filter.id = 'filter';
  filter.type = 'search';
  filter.placeholder = 'Filter projections';
  filter.setAttribute('aria-label', 'Filter projections');
  filter.autocomplete = 'off';
  filter.spellcheck = false;

  const list = createProjectionList(stops, (stop) => app.select(stop));
  filter.addEventListener('input', () => list.filter(filter.value));
  // Escape in the filter clears it, and leaves the key to nothing else.
  filter.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || filter.value === '') return;
    filter.value = '';
    list.filter('');
    e.preventDefault();
    e.stopPropagation();
  });

  root.append(title, filter, list.el, createParameters(app));

  const sync = () => {
    const match = matchStop(app.state);
    // A conic at a limit of its sliders has become another projection, which the heading of the parameters says; the list marks neither.
    list.setCurrent(match && match.defId === app.state.defId ? match : null);
  };
  app.subscribe(sync);
  sync();
}
