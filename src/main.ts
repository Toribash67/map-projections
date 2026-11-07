import { App } from './app';

declare global {
  interface Window {
    __app: App;
  }
}

const app = new App(document.querySelector<HTMLCanvasElement>('#map')!);
// For tests.
window.__app = app;
