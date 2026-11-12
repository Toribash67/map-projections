import './style.css';
import { App } from './app';
import type { DrawingModel } from './drawing/model';
import { loadPrefs, savePrefs, type Prefs } from './prefs';
import { createLocator } from './render/locator';
import { createDrawingToolbar } from './ui/drawingToolbar';
import { createSidebar } from './ui/sidebar';
import { createTissotToggle } from './ui/tissotToggle';
import { createZoomControl } from './ui/zoomControl';

declare global {
  interface Window {
    __app: App;
    __drawing: DrawingModel;
  }
}

const find = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;

const canvas = find<HTMLCanvasElement>('#map');
// What was remembered from the last visit, and kept up as it changes.
const prefs: Prefs = loadPrefs();
const app = new App(canvas, prefs);
app.subscribe(() => {
  // The app replaces these when they change, so the same objects mean nothing to keep.
  if (app.theme === prefs.theme && app.overrides === prefs.overrides && app.layers === prefs.layers) return;
  Object.assign(prefs, { theme: app.theme, overrides: app.overrides, layers: app.layers });
  savePrefs(prefs);
});
const tools = createDrawingToolbar(app, canvas, find('#notice'));
find('#tools').append(tools.el);
find('#actions').append(createTissotToggle(app));
find('#zoom').append(createZoomControl(app));
createLocator(find('#locator'), app);
createSidebar(app, find('#sidebar'));
// For tests.
window.__app = app;
window.__drawing = tools.model;
