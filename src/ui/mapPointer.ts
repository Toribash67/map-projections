import type { App } from '../app';
import type { LonLat, ProjectionState } from '../projections/types';
import { dragTo, screenToLonLat } from '../screen/screen';
import { panBy, zoomAbout } from '../screen/view';

type Pair = [number, number];

// A press that moves less than this, in CSS pixels, is a click.
const CLICK_SLOP = 4;
// How much a turn of the wheel zooms, per pixel of it: a pinch on a trackpad, which comes as a wheel with the control key, in finer steps.
const WHEEL_RATE = 0.0015;
const PINCH_RATE = 0.01;

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
  /** A press with Shift or the middle button moves the view over the map, not the map's centre: where the pointer last was. */
  panFrom: Pair | null;
}

/**
 * Dragging the map, zooming it, and clicks on it. The land under the cursor follows the cursor, with tilt
 * held; a cursor off the map keeps the last orientation. While a morph runs nothing moves and
 * nothing is clicked. If the map changes under a drag, as when a morph ends, the drag takes hold
 * of whatever is under the cursor then, so the map does not jump.
 *
 * The wheel zooms about the cursor. A drag means the same at every zoom: it moves the centre of the map. To move the zoomed view
 * over the map instead, the drag is made with Shift held or with the middle button. Two fingers pinch to zoom and move the view
 * together, and place no point and move no centre.
 */
export function attachMapPointer(canvas: HTMLCanvasElement, app: App, handlers: { onClick(xy: Pair): void }): void {
  // A touch drag moves the map, not the page.
  canvas.style.touchAction = 'none';
  let press: Press | null = null;
  // The fingers on the map, by pointer, and the two of a pinch as they last were.
  const touches = new Map<number, Pair>();
  let pinch: { ids: [number, number]; middle: Pair; apart: number } | null = null;
  const pinchOf = (ids: [number, number]) => {
    const [a, b] = [touches.get(ids[0])!, touches.get(ids[1])!];
    return { ids, middle: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as Pair, apart: Math.hypot(a[0] - b[0], a[1] - b[1]) };
  };

  const at = (e: MouseEvent): Pair => {
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
    if (e.pointerType === 'touch') {
      // The first finger down is the only one down. A finger whose lifting never arrived, as when a menu opened over the map, is forgotten here.
      if (e.isPrimary) {
        touches.clear();
        pinch = null;
      }
      touches.set(e.pointerId, at(e));
      if (touches.size === 2) {
        // A second finger makes it a pinch: whatever the first had begun, a click or a drag, is dropped.
        press = null;
        pinch = pinchOf([...touches.keys()] as [number, number]);
        return;
      }
      if (touches.size > 2) return;
    }
    const middle = e.button === 1;
    if (e.button !== 0 && !middle) return;
    // A press whose end never came, as when a context menu opens or focus leaves mid-drag, no longer holds the pointer.
    if (press && canvas.hasPointerCapture(press.id)) return;
    // A made-up pointer, as a test's, cannot be captured.
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {}
    const xy = at(e);
    press = { id: e.pointerId, start: xy, moved: false, onMap: false, grabbed: null, heldOn: null, panFrom: middle || e.shiftKey ? xy : null };
    if (press.panFrom) {
      // The middle button would otherwise start the browser's own scrolling.
      e.preventDefault();
      return;
    }
    takeHold(press, xy);
    press.onMap = press.grabbed !== null;
  });

  canvas.addEventListener('pointermove', (e) => {
    if (touches.has(e.pointerId)) touches.set(e.pointerId, at(e));
    if (pinch) {
      if (!pinch.ids.includes(e.pointerId)) return;
      const next = pinchOf(pinch.ids);
      // The view grows as the fingers part, about the place between them, and goes with them. In that order: at the fit there is no room to move the view until it has grown.
      const grown = zoomAbout(app.view, app.viewport, pinch.middle, pinch.apart > 0 ? next.apart / pinch.apart : 1);
      app.setView(panBy(grown, app.viewport, next.middle[0] - pinch.middle[0], next.middle[1] - pinch.middle[1]));
      pinch = next;
      return;
    }
    const p = press;
    if (p?.panFrom && e.pointerId === p.id) {
      const xy = at(e);
      p.moved = true;
      app.setView(panBy(app.view, app.viewport, xy[0] - p.panFrom[0], xy[1] - p.panFrom[1]));
      p.panFrom = xy;
      return;
    }
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
    touches.delete(e.pointerId);
    // A pinch is over when either finger lifts. The one still down does not go on to drag the map.
    if (pinch?.ids.includes(e.pointerId)) pinch = null;
    const p = press;
    if (!p || e.pointerId !== p.id) return;
    press = null;
    if (click && p.onMap && !p.moved && app.live) handlers.onClick(p.start);
  };
  canvas.addEventListener('pointerup', (e) => end(e, true));
  canvas.addEventListener('pointercancel', (e) => end(e, false));
  canvas.addEventListener('lostpointercapture', (e) => end(e, false));

  canvas.addEventListener(
    'wheel',
    (e) => {
      // The page does not scroll or zoom under the map.
      e.preventDefault();
      const pixels = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      app.setView(zoomAbout(app.view, app.viewport, at(e), Math.exp(-pixels * (e.ctrlKey ? PINCH_RATE : WHEEL_RATE))));
    },
    { passive: false },
  );
}
