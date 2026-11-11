import './style.css';
import { App } from './app';
import type { DrawingModel } from './drawing/model';
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
const app = new App(canvas);
const tools = createDrawingToolbar(app, canvas, find('#notice'));
find('#tools').append(tools.el);
find('#actions').append(createTissotToggle(app));
find('#zoom').append(createZoomControl(app));
createLocator(find('#locator'), app);
createSidebar(app, find('#sidebar'));
// For tests.
window.__app = app;
window.__drawing = tools.model;
