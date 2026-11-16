import type { App } from '../app';
import { PRINT_COLOURS } from '../theme/themes';
import { el, isTyping } from './dom';
import { icon } from './icons';
import { createColourControls, createMapLayerControls } from './layerControls';
import { popover } from './popover';
import { tip } from './tooltip';

/**
 * The Layers button on the map, and the panel it opens: a box for each layer of the map as it is explored, how fine the graticule
 * is, the theme, and the map's colours, each of which can be set by hand over the theme's and reset to it. What only a picture for
 * export has, the finer layers, the names and the title box, is chosen where the picture is made: see `createExportView`. The key
 * T turns the indicatrices on and off. The button is put in `container`, with the panel beside it.
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

  const layers = createMapLayerControls(app);
  const colours = createColourControls(app, (key) => !PRINT_COLOURS.includes(key));
  panel.append(el('h2', 'panel-heading', 'Layers'), layers.el, el('h2', 'panel-heading', 'Colours'), colours.el);
  container.append(button);
  popover(button, panel, 'below-right');

  window.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target) || e.key.toUpperCase() !== 'T') return;
    app.setTissot(!app.tissot);
    e.preventDefault();
  });

  const render = () => {
    layers.render();
    colours.render();
  };
  app.subscribe(render);
  render();
  return button;
}
