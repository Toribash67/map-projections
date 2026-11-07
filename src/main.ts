import './style.css';
import { App } from './app';
import type { DrawingModel } from './drawing/model';
import { createDrawingTools } from './ui/drawingTools';
import { createSidebar } from './ui/sidebar';

declare global {
  interface Window {
    __app: App;
    __drawing: DrawingModel;
  }
}

const canvas = document.querySelector<HTMLCanvasElement>('#map')!;
const app = new App(canvas);
const tools = createDrawingTools(app, canvas);
createSidebar(app, document.querySelector<HTMLElement>('#sidebar')!, tools.el);
// For tests.
window.__app = app;
window.__drawing = tools.model;
