import type { App } from '../app';
import { PictureMaker, pictureBlob, type Picture } from '../export/picture';
import { exportName, ExportTooLarge, lineScaleOf, pictureOf } from '../export/render';
import { isEdited, labelAt, NO_EDITS, withMove, withRemoved, type LabelEdits } from '../labels/move';
import type { Label } from '../labels/place';
import type { PrintLayers } from '../layers/layers';
import { drawOverlay } from '../overlay/overlay';
import { drawScene } from '../render/draw';
import { clampView, FIT, MAX_ZOOM, panBy, zoomAbout, type View } from '../screen/view';
import { el, isTyping } from './dom';
import { createExportSide } from './exportSide';
import { icon, type IconName } from './icons';
import { tip } from './tooltip';

type Pair = [number, number];

const EXPORT = 'Export the map as a picture or a drawing, with rivers, names and a title if wanted';
const NOT_AT_REST = 'The map is moving: it can be exported when it is at rest';
const TOO_LARGE = 'Too large for this browser. Try a smaller size, or SVG.';
const FAILED = 'The picture could not be made. Try a smaller size, or less detail.';

// The room (CSS pixels) left round the picture where it is fitted to the window.
const MARGIN = 28;
// A press that moves less than this, in CSS pixels, is a click.
const CLICK_SLOP = 4;
// How much a turn of the wheel zooms, per pixel of it, as on the map: a pinch on a trackpad, which comes as a wheel with the control key, in finer steps.
const WHEEL_RATE = 0.0015;
const PINCH_RATE = 0.01;
const ZOOM_STEP = 2;
// How long (ms) the picture waits for more of a change that comes in a run, as from a slider, before it is made again.
const SOON = 120;
// Where painting the scene takes longer than this (ms), a picture that is being moved is shown from the last painting of it, enlarged
// and moved as it is, and painted afresh when it has been left alone this long (ms).
const PAINT_BUDGET = 40;
const SHARP_AFTER = 140;
// The squares (CSS pixels) that stand for nothing, behind a picture with no background.
const CHECK = 8;

export interface ExportView {
  readonly isOpen: boolean;
  /** Whether the picture shown is the one asked for: nothing is being made, or waiting to be. */
  readonly settled: boolean;
  /** The picture as it was last made, or null before there is one. */
  readonly picture: Picture | null;
  open(): void;
  close(): void;
}

/**
 * The Export button on the map, and the view it opens: the picture that will be exported, in place of the map, with everything that
 * can be chosen about it beside it, in place of the sidebar.
 *
 * The map as it is explored is drawn many times a second, and has only what can be: its own few layers. A picture is made once.
 * So what is slow or only worth having in a picture is here: the finer coast, the rivers, the lakes and the depths of the sea, the
 * names, the degrees, the frame and the title box. The projection cannot be changed here, as everything is fitted to it; the way
 * back to the map is at the top, and Escape.
 *
 * The picture is the very one a file is made from, drawn smaller: it can be zoomed and moved to look at it closely, which enlarges
 * its lines and letters as a print would be enlarged, and changes nothing in it. A name can be dragged to another place, or chosen
 * with a click and taken off with Delete; the arrows move the one that is chosen a little.
 *
 * `els` are the page's parts: the whole app, the side the controls go in, the stage's cover the picture goes in, and where the
 * button goes. `kept` is what was remembered of print's layers, and `keep` is called with them when they change.
 */
export function createExportView(
  app: App,
  els: { app: HTMLElement; side: HTMLElement; preview: HTMLElement; actions: HTMLElement },
  kept: PrintLayers,
  keep: (print: PrintLayers) => void,
): ExportView {
  const button = el('button', 'map-button');
  button.type = 'button';
  button.setAttribute('aria-label', 'Export');
  button.append(icon('export'));
  tip(button, EXPORT);
  els.actions.append(button);

  const canvas = el('canvas', 'preview-canvas');
  canvas.setAttribute('aria-label', 'The picture to export');
  canvas.tabIndex = 0;
  canvas.style.touchAction = 'none';
  const ctx = canvas.getContext('2d')!;
  // The scene as it was last painted, which a change to the lettering alone is drawn over.
  const base = document.createElement('canvas');
  const baseCtx = base.getContext('2d')!;
  const status = el('p', 'preview-status', 'Drawing…');
  status.setAttribute('role', 'status');
  status.hidden = true;
  const zoomControl = el('div', 'zoom-control');
  zoomControl.setAttribute('role', 'group');
  zoomControl.setAttribute('aria-label', 'Zoom');
  els.preview.append(canvas, status, zoomControl);

  let open = false;
  let print = kept;
  let picture: Picture | null = null;
  const maker = new PictureMaker();
  // What has been done to the names by hand, and the map and extent it was done to: on another, they are as they are fitted.
  let edits: LabelEdits = NO_EDITS;
  let editsFor = '';
  let chosen: string | null = null;
  // How the picture is looked at, over its fit to the window.
  let view: View = FIT;
  let saving = false;

  const side = createExportSide(app, {
    get print() {
      return print;
    },
    setPrintLayer(id, on) {
      if (print.on[id] === on) return;
      setPrint({ ...print, on: { ...print.on, [id]: on } }, 0);
    },
    setPrint(patch) {
      // A title is set at once, with nothing fitted again; a slider comes in a run.
      setPrint({ ...print, ...patch }, 'smallestName' in patch ? SOON : 0);
    },
    get namesEdited() {
      return isEdited(edits);
    },
    resetNames() {
      edits = NO_EDITS;
      chosen = null;
      reedit();
    },
    changed: () => refresh(),
    save: () => void save(),
    close: () => close(),
  });
  els.side.append(side.el);

  function setPrint(next: PrintLayers, wait: number): void {
    print = next;
    keep(print);
    refresh(wait);
  }

  // Making the picture. One is made at a time; a change that comes meanwhile has it made again when that one is done.
  let wanted = false;
  let making: Promise<void> | null = null;
  let timer = 0;

  /** Has the picture made again, now or after `wait` ms, and shows the controls as they are. Resolves when the picture is the one asked for. */
  function refresh(wait = 0): Promise<void> {
    side.render(saving);
    if (!open) return Promise.resolve();
    window.clearTimeout(timer);
    timer = 0;
    if (wait > 0 && !making) {
      return new Promise((done) => (timer = window.setTimeout(() => ((timer = 0), void refresh().then(done)), wait)));
    }
    wanted = true;
    making ??= (async () => {
      try {
        while (wanted && open) {
          wanted = false;
          await make();
        }
      } finally {
        making = null;
        status.hidden = true;
        side.render(saving);
      }
    })();
    return making;
  }

  async function make(): Promise<void> {
    const map = app.snapshot();
    // The map does not move while it is covered; if it does all the same, the picture waits for it.
    if (!map) return;
    const snap = pictureOf(map, print);
    const opts = side.choices(snap);
    const of = JSON.stringify([snap.state, opts.extent, opts.extent === 'view' ? snap.view : null]);
    if (of !== editsFor) [edits, editsFor, chosen] = [NO_EDITS, of, null];
    const before = picture?.exported.size;
    if (!maker.has(snap, opts)) {
      // The words are on the page before the work, which holds the page, begins.
      status.hidden = false;
      await new Promise((done) => setTimeout(done, 30));
    }
    try {
      picture = await maker.make(snap, opts, edits);
      side.notice(null);
    } catch (error) {
      side.notice(FAILED);
      console.error(error);
      return;
    }
    // A picture of another shape is looked at afresh.
    const { size } = picture.exported;
    if (!before || Math.abs(before.width / before.height - size.width / size.height) > 1e-3) view = FIT;
    paint();
  }

  /** The lettering after a move by hand, with nothing made again. */
  function reedit(): void {
    picture = maker.withEdits(edits) ?? picture;
    side.render(saving);
    paint(false);
  }

  async function save(): Promise<void> {
    if (saving || !open) return;
    saving = true;
    side.notice(null);
    side.render(saving);
    try {
      // The picture as it is asked for now, where a change is still on its way.
      await refresh();
      // The button shows that it is at work before the work, which holds the page, begins.
      await new Promise((done) => setTimeout(done, 30));
      if (!picture) throw new Error('No picture');
      const blob = await pictureBlob(picture);
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = exportName(picture.snap, picture.opts);
      link.click();
      // The download has the file by the time this runs.
      setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
    } catch (error) {
      side.notice(error instanceof ExportTooLarge ? TOO_LARGE : FAILED);
      if (!(error instanceof ExportTooLarge)) console.error(error);
    } finally {
      saving = false;
      side.render(saving);
    }
  }

  // Painting. The picture's own pixels are put on the window's by `s`, `tx` and `ty`, in CSS pixels.
  type Placing = { s: number; tx: number; ty: number };
  const windowSize = () => ({ width: canvas.clientWidth, height: canvas.clientHeight });
  function placing(): Placing | null {
    if (!picture) return null;
    const { width, height } = windowSize();
    const { size } = picture.exported;
    const fit = Math.min((width - 2 * MARGIN) / size.width, (height - 2 * MARGIN) / size.height);
    if (!(fit > 0)) return null;
    const s = fit * view.zoom;
    return { s, tx: width / 2 - (s * size.width) / 2 + view.panX, ty: height / 2 - (s * size.height) / 2 + view.panY };
  }
  /** A place in the window as a place in the picture. */
  const inPicture = ([x, y]: Pair, { s, tx, ty }: Placing): Pair => [(x - tx) / s, (y - ty) / s];

  // The placing and the picture the scene was last painted for, and how long that took.
  let painted: { placing: Placing; picture: Picture; style: unknown; background: string; weight: number } | null = null;
  let paintCost = 0;
  let sharpTimer = 0;

  /** Onto the picture's own pixels, and within its edge. */
  function onPicture(to: CanvasRenderingContext2D, { s, tx, ty }: Placing, ratio: number): void {
    const { size } = picture!.exported;
    to.setTransform(ratio * s, 0, 0, ratio * s, ratio * tx, ratio * ty);
    to.beginPath();
    to.rect(0, 0, size.width, size.height);
    to.clip();
  }

  /** Paints the scene: the sheet, in the page's colour or as squares where the picture has no background, and the map on it. */
  function paintScene(at: Placing, ratio: number): void {
    const { exported, snap, opts } = picture!;
    const { size } = exported;
    const lineScale = lineScaleOf(snap, opts, exported);
    const to = baseCtx;
    to.setTransform(1, 0, 0, 1, 0, 0);
    to.clearRect(0, 0, base.width, base.height);
    to.setTransform(ratio * at.s, 0, 0, ratio * at.s, ratio * at.tx, ratio * at.ty);
    to.save();
    to.shadowColor = 'rgba(0, 0, 0, 0.28)';
    to.shadowBlur = 14 * ratio;
    to.shadowOffsetY = 2 * ratio;
    to.fillStyle = opts.background === 'transparent' ? '#ffffff' : snap.style.background;
    to.fillRect(0, 0, size.width, size.height);
    to.restore();
    to.save();
    onPicture(to, at, ratio);
    if (opts.background === 'transparent') {
      to.fillStyle = '#d9d9d9';
      const side = CHECK / at.s;
      for (let row = 0; row * side < size.height; row++) for (let col = row % 2; col * side < size.width; col += 2) to.fillRect(col * side, row * side, side, side);
    }
    drawScene(to, exported.scene, 0, snap.style, { lineScale, over: true });
    to.restore();
  }

  /**
   * Paints the picture as it is looked at. The scene is painted afresh where it or its placing has changed, unless `sharp` is false
   * and it is slow to paint: then the last painting of it is shown where it now belongs, and it is painted afresh when the picture
   * has been left alone a moment. The lettering is always drawn afresh, over it.
   */
  function paint(sharp = true): void {
    const at = placing();
    const { width, height } = windowSize();
    if (!at || !picture || !(width > 0 && height > 0)) return;
    const ratio = window.devicePixelRatio || 1;
    const [storeWidth, storeHeight] = [Math.round(width * ratio), Math.round(height * ratio)];
    let sized = false;
    for (const each of [canvas, base]) {
      if (each.width === storeWidth && each.height === storeHeight) continue;
      [each.width, each.height] = [storeWidth, storeHeight];
      sized = true;
    }
    if (sized) painted = null;
    const { snap, opts, exported } = picture;
    const same = painted !== null && painted.picture.exported === exported && painted.style === snap.style && painted.background === opts.background && painted.weight === snap.layers.lineWeight;
    const still = same && painted!.placing.s === at.s && painted!.placing.tx === at.tx && painted!.placing.ty === at.ty;
    window.clearTimeout(sharpTimer);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!still && same && !sharp && paintCost > PAINT_BUDGET) {
      const was = painted!.placing;
      const by = at.s / was.s;
      ctx.setTransform(by, 0, 0, by, ratio * (at.tx - by * was.tx), ratio * (at.ty - by * was.ty));
      ctx.drawImage(base, 0, 0);
      sharpTimer = window.setTimeout(paint, SHARP_AFTER);
    } else {
      if (!still) {
        const began = performance.now();
        paintScene(at, ratio);
        paintCost = performance.now() - began;
        painted = { placing: at, picture, style: snap.style, background: opts.background, weight: snap.layers.lineWeight };
      }
      ctx.drawImage(base, 0, 0);
    }
    if (!picture.overlay) return;
    ctx.save();
    onPicture(ctx, at, ratio);
    const marked = picture.overlay.labels.find((label) => picture!.keyOf.get(label) === chosen);
    if (marked) {
      // A band along the name that is chosen, under its letters.
      ctx.strokeStyle = snap.style.accentFill;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 2 * marked.discs[0]![2] + 6 / at.s;
      ctx.beginPath();
      marked.discs.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      // A name of one letter is a line of no length, which round ends make a dot of.
      if (marked.discs.length === 1) ctx.lineTo(marked.discs[0]![0], marked.discs[0]![1]);
      ctx.stroke();
    }
    drawOverlay(ctx, picture.overlay, snap.style);
    ctx.restore();
  }

  function setView(next: View, sharp = false): void {
    const clamped = clampView(next, windowSize());
    if (clamped.zoom === view.zoom && clamped.panX === view.panX && clamped.panY === view.panY) return;
    view = clamped;
    renderZoom();
    paint(sharp);
  }

  const zoomButton = (name: IconName, label: string, text: string, shortcut: string, act: () => void) => {
    const b = el('button', 'map-button');
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.append(icon(name));
    tip(b, text, shortcut);
    b.addEventListener('click', act);
    zoomControl.append(b);
    return b;
  };
  const middle = (): Pair => [windowSize().width / 2, windowSize().height / 2];
  const zoomIn = () => setView(zoomAbout(view, windowSize(), middle(), ZOOM_STEP), true);
  const zoomOut = () => setView(zoomAbout(view, windowSize(), middle(), 1 / ZOOM_STEP), true);
  const fit = () => setView(FIT, true);
  const inButton = zoomButton('zoom-in', 'Zoom in', 'Look closer at the picture. The wheel zooms about the cursor', '+', zoomIn);
  const outButton = zoomButton('zoom-out', 'Zoom out', 'Zoom out', '−', zoomOut);
  const fitButton = zoomButton('fit', 'Fit the picture to the window', 'Fit the picture to the window', '0', fit);
  function renderZoom(): void {
    inButton.disabled = view.zoom >= MAX_ZOOM;
    outButton.disabled = fitButton.disabled = view.zoom <= 1;
  }

  // The pointer: a drag that begins on a name moves the name, and any other moves the picture; a click chooses a name, or none.
  const at = (e: PointerEvent | WheelEvent): Pair => {
    const box = canvas.getBoundingClientRect();
    return [e.clientX - box.left, e.clientY - box.top];
  };
  /** The label at a place in the window, or null. A finger is less exact than a cursor. */
  function labelUnder(xy: Pair, touch = false): { label: Label; key: string } | null {
    const where = placing();
    if (!where || !picture?.overlay) return null;
    const [x, y] = inPicture(xy, where);
    const { size } = picture.exported;
    if (x < 0 || y < 0 || x > size.width || y > size.height) return null;
    const { labels } = picture.overlay;
    const i = labelAt(labels, x, y, (touch ? 10 : 2) / where.s);
    return i < 0 ? null : { label: labels[i]!, key: picture.keyOf.get(labels[i]!)! };
  }
  /** Moves a name by so many pixels of the window, from where it is now. */
  function moveName(key: string, from: Pair, dx: number, dy: number): void {
    const where = placing();
    if (!where || !picture) return;
    const width = picture.exported.size.width;
    edits = withMove(edits, key, [from[0] + dx / where.s / width, from[1] + dy / where.s / width]);
    reedit();
  }

  let press: { id: number; start: Pair; last: Pair; moved: boolean; name: { key: string; from: Pair } | null } | null = null;
  const touches = new Map<number, Pair>();
  let pinch: { middle: Pair; apart: number } | null = null;
  const pinchNow = () => {
    const [a, b] = [...touches.values()] as [Pair, Pair];
    return { middle: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as Pair, apart: Math.hypot(a[0] - b[0], a[1] - b[1]) };
  };

  canvas.addEventListener('pointerdown', (e) => {
    const xy = at(e);
    if (e.pointerType === 'touch') {
      touches.set(e.pointerId, xy);
      if (touches.size === 2) {
        // Two fingers zoom and move the picture, and take hold of no name.
        press = null;
        pinch = pinchNow();
        return;
      }
    } else if (e.button !== 0 && e.button !== 1) return;
    canvas.setPointerCapture(e.pointerId);
    const under = e.button === 0 ? labelUnder(xy, e.pointerType === 'touch') : null;
    press = { id: e.pointerId, start: xy, last: xy, moved: false, name: under && { key: under.key, from: edits.moved[under.key] ?? [0, 0] } };
  });
  canvas.addEventListener('pointermove', (e) => {
    const xy = at(e);
    if (touches.has(e.pointerId)) touches.set(e.pointerId, xy);
    if (pinch && touches.size === 2) {
      const now = pinchNow();
      const zoomed = zoomAbout(view, windowSize(), pinch.middle, now.apart / Math.max(1, pinch.apart));
      setView(panBy(zoomed, windowSize(), now.middle[0] - pinch.middle[0], now.middle[1] - pinch.middle[1]));
      pinch = now;
      return;
    }
    if (!press || press.id !== e.pointerId) {
      canvas.style.cursor = labelUnder(xy) ? 'move' : '';
      return;
    }
    if (!press.moved && Math.hypot(xy[0] - press.start[0], xy[1] - press.start[1]) < CLICK_SLOP) return;
    press.moved = true;
    if (press.name) {
      chosen = press.name.key;
      moveName(press.name.key, press.name.from, xy[0] - press.start[0], xy[1] - press.start[1]);
    } else setView(panBy(view, windowSize(), xy[0] - press.last[0], xy[1] - press.last[1]));
    press.last = xy;
  });
  const release = (e: PointerEvent) => {
    touches.delete(e.pointerId);
    if (touches.size < 2) pinch = null;
    if (!press || press.id !== e.pointerId) return;
    const { moved, name } = press;
    press = null;
    if (moved || e.type === 'pointercancel') return;
    // A click chooses the name it is on, or none.
    const next = name?.key ?? null;
    if (next === chosen) return;
    chosen = next;
    paint(false);
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener(
    'wheel',
    (e) => {
      // The page does not scroll or zoom under the picture.
      e.preventDefault();
      const pixels = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      setView(zoomAbout(view, windowSize(), at(e), Math.exp(-pixels * (e.ctrlKey ? PINCH_RATE : WHEEL_RATE))));
    },
    { passive: false },
  );

  // The keys, while the view is open. They are taken before the map's own, which is under the picture and is not to hear them.
  window.addEventListener(
    'keydown',
    (e) => {
      if (!open || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      const arrow = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, Pair>)[e.key];
      let taken = true;
      if (e.key === 'Escape') {
        if (chosen !== null) {
          chosen = null;
          paint(false);
        } else close();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && chosen !== null) {
        edits = withRemoved(edits, chosen);
        chosen = null;
        reedit();
      } else if (arrow && chosen !== null && document.activeElement === canvas) {
        // A pixel of the window at a time, or ten with Shift.
        const by = e.shiftKey ? 10 : 1;
        moveName(chosen, edits.moved[chosen] ?? [0, 0], arrow[0] * by, arrow[1] * by);
      } else if (e.key === '+' || e.key === '=') zoomIn();
      else if (e.key === '-' || e.key === '_') zoomOut();
      else if (e.key === '0') fit();
      else taken = false;
      if (taken) e.preventDefault();
      e.stopPropagation();
    },
    true,
  );

  new ResizeObserver(() => {
    if (!open) return;
    view = clampView(view, windowSize());
    paint();
  }).observe(canvas);
  // The picture has the map's own layers and colours, which can be changed from here.
  app.subscribe(() => {
    if (open) void refresh();
    renderButton();
  });

  /** The parts of the page that are the map's, which are out of reach and out of mind while the picture is over them. */
  const mapParts = () => [...els.app.querySelectorAll<HTMLElement>('#sidebar, #stage > :not(#preview)')];

  function setOpen(next: boolean): void {
    if (next === open) return;
    open = next;
    els.app.classList.toggle('exporting', open);
    els.side.hidden = els.preview.hidden = !open;
    for (const part of mapParts()) part.inert = open;
    window.clearTimeout(timer);
    window.clearTimeout(sharpTimer);
    timer = 0;
  }

  function openView(): void {
    if (open || app.snapshot() === null) return;
    setOpen(true);
    view = FIT;
    chosen = null;
    renderZoom();
    // The picture last made is shown at once if it is of this map still, and then made as it is asked for now.
    if (picture?.snap.state !== app.state) {
      picture = null;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    paint();
    void refresh();
    canvas.focus({ preventScroll: true });
  }

  function close(): void {
    if (!open) return;
    setOpen(false);
    button.focus({ preventScroll: true });
  }

  button.addEventListener('click', openView);
  function renderButton(): void {
    const ready = app.snapshot() !== null;
    button.setAttribute('aria-disabled', String(!ready));
    button.setAttribute('aria-description', ready ? EXPORT : NOT_AT_REST);
  }
  renderButton();
  side.render(saving);

  return {
    get isOpen() {
      return open;
    },
    get settled() {
      return open && making === null && timer === 0 && picture !== null;
    },
    get picture() {
      return picture;
    },
    open: openView,
    close,
  };
}
