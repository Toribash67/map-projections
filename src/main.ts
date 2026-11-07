import './style.css';
import { App } from './app';
import { attachMapPointer } from './ui/mapPointer';
import { createSidebar } from './ui/sidebar';

declare global {
  interface Window {
    __app: App;
  }
}

const canvas = document.querySelector<HTMLCanvasElement>('#map')!;
const app = new App(canvas);
createSidebar(app, document.querySelector<HTMLElement>('#sidebar')!);
// Clicks will place the points of drawn shapes, once there are drawing tools.
attachMapPointer(canvas, app, { onClick: () => {} });
// For tests.
window.__app = app;
