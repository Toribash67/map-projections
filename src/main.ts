import './style.css';
import { App } from './app';
import type { DrawingModel } from './drawing/model';
import { createLocator } from './render/locator';
import { createDrawingTools } from './ui/drawingTools';
import { createSidebar } from './ui/sidebar';
import { createZoomControl } from './ui/zoomControl';

declare global {
  interface Window {
    __app: App;
    __drawing: DrawingModel;
  }
}

const canvas = document.querySelector<HTMLCanvasElement>('#map')!;
const app = new App(canvas);
const tools = createDrawingTools(app, canvas);
createLocator(document.querySelector<HTMLElement>('#locator')!, app);
createSidebar(app, document.querySelector<HTMLElement>('#sidebar')!, tools.el);
document.querySelector<HTMLElement>('#zoom')!.append(createZoomControl(app));
// For tests.
window.__app = app;
window.__drawing = tools.model;
