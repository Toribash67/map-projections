import type { App } from '../app';
import type { LonLat, ProjectionState } from '../projections/types';
import { dragTo, screenToLonLat } from '../screen/screen';

type Pair = [number, number];

// A press that moves less than this, in CSS pixels, is a click.
const CLICK_SLOP = 4;

interface Press {
  id: number;
  start: Pair;
  moved: boolean;
  /** Whether the press began on the map, at rest: only then can it be a click or a drag. */
  onMap: boolean;
  /** The point that follows the cursor, or null until one is taken hold of. */
  grabbed: LonLat | null;
  /** The map `grabbed` was taken on or last moved on. A map changed by anything else is taken hold of afresh. */
  heldOn: ProjectionState | null;
}

/**
 * Dragging the map, and clicks on it. The land under the cursor follows the cursor, with tilt
 * held; a cursor off the map keeps the last orientation. While a morph runs nothing moves and
 * nothing is clicked. If the map changes under a drag, as when a morph ends, the drag takes hold
 * of whatever is under the cursor then, so the map does not jump.
 */
export function attachMapPointer(canvas: HTMLCanvasElement, app: App, handlers: { onClick(xy: Pair): void }): void {
  // A touch drag moves the map, not the page.
  canvas.style.touchAction = 'none';
  let press: Press | null = null;

  const at = (e: PointerEvent): Pair => {
    const box = canvas.getBoundingClientRect();
    return [e.clientX - box.left, e.clientY - box.top];
  };
  const lonLatAt = (xy: Pair): LonLat | null => {
    const live = app.live;
    return live ? screenToLonLat(live.compiled, live.screen, xy) : null;
  };
  const takeHold = (p: Press, xy: Pair) => {
    p.grabbed = lonLatAt(xy);
    p.heldOn = p.grabbed ? app.state : null;
  };

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    // A press whose end never came, as when a context menu opens or focus leaves mid-drag, no longer holds the pointer.
    if (press && canvas.hasPointerCapture(press.id)) return;
    canvas.setPointerCapture(e.pointerId);
    const xy = at(e);
    press = { id: e.pointerId, start: xy, moved: false, onMap: false, grabbed: null, heldOn: null };
    takeHold(press, xy);
    press.onMap = press.grabbed !== null;
  });

  canvas.addEventListener('pointermove', (e) => {
    const p = press;
    if (!p || e.pointerId !== p.id || !p.onMap) return;
    const xy = at(e);
    if (!p.moved && Math.hypot(xy[0] - p.start[0], xy[1] - p.start[1]) < CLICK_SLOP) return;
    p.moved = true;
    const live = app.live;
    if (!live) {
      p.heldOn = null;
      return;
    }
    if (p.heldOn !== app.state) return takeHold(p, xy);
    if (!screenToLonLat(live.compiled, live.screen, xy)) return;
    app.setLive({ orientation: dragTo(live.compiled, live.screen, p.grabbed!, xy) });
    p.heldOn = app.state;
  });

  const end = (e: PointerEvent, click: boolean) => {
    const p = press;
    if (!p || e.pointerId !== p.id) return;
    press = null;
    if (click && p.onMap && !p.moved && app.live) handlers.onClick(p.start);
  };
  canvas.addEventListener('pointerup', (e) => end(e, true));
  canvas.addEventListener('pointercancel', (e) => end(e, false));
  canvas.addEventListener('lostpointercapture', (e) => end(e, false));
}
