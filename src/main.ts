import './style.css';
import { App } from './app';
import { createSidebar } from './ui/sidebar';

declare global {
  interface Window {
    __app: App;
  }
}

const app = new App(document.querySelector<HTMLCanvasElement>('#map')!);
createSidebar(app, document.querySelector<HTMLElement>('#sidebar')!);
// For tests.
window.__app = app;
