import { geoCircle, geoGraticule, geoOrthographic, geoPath, type GeoPermissibleObjects, type GeoSphere } from 'd3-geo';
import type { App } from '../app';
import { LAND } from '../data/land';
import { shapeToGeoJSON } from '../drawing/model';
import { clampLat, normaliseLon } from '../geo/angles';
import { toVector, type Vector } from '../geo/densify';
import { compile } from '../projections/compile';
import { el } from '../ui/dom';
import { icon, type IconName } from '../ui/icons';
import { tip } from '../ui/tooltip';
import { DEFAULT_CAMERA, orbit, PAD, pick, toView, type Camera } from './camera';
import { REACH, surfaceFor, visibleRuns, type Surface } from './surface';

// The area the map covers is tinted in slate, lightly enough for land and sea to show through.
const TINT_ALPHA = 0.32;
const MERIDIAN_STEP = 30;
// Least time between two redraws of the globe. While the map is dragged or slides this halves them; the last change is always drawn.
const REDRAW_GAP = 30;
// A press that moves less than this, in CSS pixels, is a click.
const CLICK_SLOP = 4;
// How strongly the parts of a surface behind the globe are drawn, of the parts in front.
const HIDDEN_ALPHA = 0.5;
// A ray is drawn in this many steps, so that the part of it behind the globe can be told from the rest.
const RAY_STEPS = 24;

type Pair = [number, number];

const sphere: GeoSphere = { type: 'Sphere' };
// The data comes typed as plain GeoJSON, which the path takes as it is.
const land = LAND as GeoPermissibleObjects;
const graticule = geoGraticule().step([MERIDIAN_STEP, MERIDIAN_STEP])();

const NO_SURFACE = 'This map is worked out by formula: it is not projected onto a surface that can be drawn';
const SHOW_SURFACE = 'Show the surface the map is projected onto: a cylinder, a cone, a plane';

/** What is kept of the corner globe between visits. */
export type LocatorPrefs = { surface: boolean; collapsed: boolean };

/**
 * A small globe in the corner of the map, for every projection but the globe itself. Its view is fixed: the map's centre, the area
 * the map covers (tinted), the map's own equator and poles, the drawings, and the surface the map is projected onto all move over
 * it as the map is moved, and it does not turn. Dragging it turns it, to look at it from another side, and changes nothing of the
 * map. A click on it moves the map's centre there.
 *
 * The surface is a wireframe set about the globe as the map is: a cylinder, a cone, a plane or an octahedron, with what is behind
 * the globe dashed and where it meets the globe marked. With it shown the globe is drawn smaller, to leave room for it.
 */
export function createLocator(container: HTMLElement, app: App, prefs: LocatorPrefs, save: (prefs: LocatorPrefs) => void): void {
  const state = { ...prefs };
  const face = el('div', 'locator-face');
  const canvas = document.createElement('canvas');
  // A touch drag turns the globe, not the page.
  canvas.style.touchAction = 'none';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'The Earth, with the area the map covers, its centre, its own equator and poles, and the surface it is projected onto');
  face.append(canvas);
  const buttons = el('div', 'locator-buttons');
  const button = (name: IconName, label: string, text: string, act: () => void) => {
    const b = el('button', 'map-button');
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.append(icon(name));
    tip(b, text);
    b.addEventListener('click', act);
    buttons.append(b);
    return b;
  };
  const keep = () => {
    save({ ...state });
    update();
  };
  const surfaceButton = button('surface', 'Projection surface', SHOW_SURFACE, () => {
    // Where there is no surface the button is not disabled outright, as a disabled button would show no tip to say why.
    if (surfaceButton.getAttribute('aria-disabled') === 'true') return;
    state.surface = !state.surface;
    keep();
  });
  const resetButton = button('reset', 'Reset the view of the corner globe', 'Look at the corner globe from where it was', () => {
    camera = DEFAULT_CAMERA;
    update();
  });
  const collapseButton = button('collapse', 'Corner globe', 'Fold the corner globe away, or bring it back', () => {
    state.collapsed = !state.collapsed;
    keep();
  });
  container.append(buttons, face);

  const ctx = canvas.getContext('2d')!;
  const projection = geoOrthographic().clipAngle(90);
  const path = geoPath(projection, ctx);
  let camera: Camera = DEFAULT_CAMERA;
  let frameId = 0;
  let timer = 0;
  let drawnAt = -Infinity;

  /** The surface to draw now, if it is wanted and the map has one. */
  const shownSurface = (): Surface | null => (state.surface ? surfaceFor(compile(app.state)) : null);
  /** The globe's radius on the page, for a face of a size: all of the face, or with room left for a surface about it. */
  const radiusFor = (size: number, withSurface: boolean) => (size / 2 - PAD) / (withSurface ? REACH : 1);

  const draw = (): void => {
    frameId = 0;
    drawnAt = performance.now();
    const size = face.clientWidth;
    if (container.hidden || state.collapsed || !(size > 0)) return;
    const ratio = window.devicePixelRatio || 1;
    const store = Math.round(size * ratio);
    if (canvas.width !== store) canvas.width = canvas.height = store;
    ctx.setTransform(store / size, 0, 0, store / size, 0, 0);
    ctx.clearRect(0, 0, size, size);

    const style = app.style;
    const compiled = compile(app.state);
    const surface = shownSurface();
    const radius = radiusFor(size, surface !== null);
    const middle = size / 2;
    projection.rotate([-camera.lon, -camera.lat]).translate([middle, middle]).scale(radius);
    /** A place on the globe's face, in radii from its middle with y up, on the page. */
    const onFace = (x: number, y: number): Pair => [middle + radius * x, middle - radius * y];
    /** A point of space about the Earth, on the page. */
    const onPage = (v: Vector): Pair => {
      const [x, y] = toView(camera, v);
      return onFace(x, y);
    };
    const isNear = (v: Vector) => toView(camera, v)[2] >= 0;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    ctx.beginPath();
    path(sphere);
    ctx.fillStyle = style.ocean;
    ctx.fill();
    ctx.beginPath();
    path(graticule);
    ctx.strokeStyle = style.graticule;
    ctx.lineWidth = style.graticuleWidth;
    ctx.stroke();
    // The coast is the outline of the land, so one path does for both.
    ctx.beginPath();
    path(land);
    ctx.fillStyle = style.land;
    ctx.fill();
    ctx.strokeStyle = style.coast;
    ctx.lineWidth = style.coastWidth;
    ctx.stroke();

    // The covered area is the sphere less the excluded caps, which are circles in the projection's frame. A speck left out at a
    // pole that the map shows is not a hole in it.
    ctx.beginPath();
    path(sphere);
    for (const cap of compiled.caps) if (!cap.regular) path(geoCircle().center(compiled.fromFrame(cap.frameCenter)).radius(cap.radius)());
    ctx.globalAlpha = TINT_ALPHA;
    ctx.fillStyle = style.tint;
    ctx.fill('evenodd');
    ctx.globalAlpha = 1;

    // The map's own equator, and where its poles are: on a transverse map the equator is a meridian.
    const [north, south] = [compiled.fromFrame([0, 90]), compiled.fromFrame([0, -90])];
    ctx.beginPath();
    path(geoCircle().center(north).radius(90)());
    ctx.strokeStyle = style.ink;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 2]);
    ctx.stroke();
    ctx.setLineDash([]);

    // A polygon or circle comes as a fill and an outline of its own.
    const parts = app.shapes.flatMap((s) => {
      const g = shapeToGeoJSON(s);
      return g.type === 'GeometryCollection' ? g.geometries : [g];
    });
    ctx.fillStyle = style.accentFill;
    ctx.strokeStyle = style.accent;
    ctx.lineWidth = 1.5;
    for (const g of parts) {
      ctx.beginPath();
      path(g);
      if (g.type === 'Polygon') ctx.fill();
      else ctx.stroke();
    }

    ctx.font = '600 9px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = style.ink;
    for (const [pole, letter] of [[north, 'N'], [south, 'S']] as const) {
      // A pole on the far side of the globe is not drawn.
      if (!isNear(toVector(pole))) continue;
      const [x, y] = onPage(toVector(pole));
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, 2 * Math.PI);
      ctx.fill();
      const away = Math.hypot(x - middle, y - middle) || 1;
      // The letter sits towards the middle of the globe from its pole, or above a pole at the middle.
      const [ux, uy] = away > 1 ? [(middle - x) / away, (middle - y) / away] : [0, -1];
      ctx.fillText(letter, x + 7 * ux, y + 7 * uy);
    }

    ctx.beginPath();
    path(sphere);
    ctx.strokeStyle = style.coast;
    ctx.lineWidth = 1;
    ctx.stroke();

    if (surface) drawSurface(surface, onFace, style);

    // The map's centre: a ringed dot on the near side, and an empty ring where it is on the far side, seen through the globe.
    const centre = toVector(compiled.fromFrame([0, 0]));
    const [mx, my] = onPage(centre);
    ctx.beginPath();
    ctx.arc(mx, my, 4.5, 0, 2 * Math.PI);
    if (isNear(centre)) {
      ctx.fillStyle = style.halo;
      ctx.fill();
    }
    ctx.strokeStyle = style.accent;
    ctx.lineWidth = isNear(centre) ? 2 : 1.25;
    if (!isNear(centre)) ctx.setLineDash([2, 2]);
    ctx.stroke();
    ctx.setLineDash([]);
    if (isNear(centre)) {
      ctx.beginPath();
      ctx.arc(mx, my, 1.5, 0, 2 * Math.PI);
      ctx.fillStyle = style.accent;
      ctx.fill();
    }
  };

  /** Strokes a line of space, solid where it is in front of the globe and dashed and fainter where the globe hides it. */
  function strokeLine(line: Vector[], onFace: (x: number, y: number) => Pair): void {
    for (const run of visibleRuns(line.map((v) => toView(camera, v)))) {
      ctx.globalAlpha = run.hidden ? HIDDEN_ALPHA : 1;
      ctx.setLineDash(run.hidden ? [2, 3] : []);
      ctx.beginPath();
      run.points.forEach(([x, y], i) => {
        const [px, py] = onFace(x, y);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
  }

  function drawSurface(surface: Surface, onFace: (x: number, y: number) => Pair, style: App['style']): void {
    ctx.strokeStyle = style.ink;
    ctx.lineWidth = 1;
    for (const line of surface.lines) strokeLine(line, onFace);
    // Where the surface meets the globe, which is where the map's scale is true.
    ctx.strokeStyle = style.standard;
    ctx.lineWidth = 1.75;
    for (const line of surface.touch) strokeLine(line, onFace);
    ctx.strokeStyle = style.accent;
    ctx.lineWidth = 1;
    for (const [from, to] of surface.rays ?? []) strokeLine(Array.from({ length: RAY_STEPS + 1 }, (_, i) => [0, 1, 2].map((k) => from[k]! + ((to[k]! - from[k]!) * i) / RAY_STEPS) as Vector), onFace);
    if (!surface.eye) return;
    // The point the rays come from, fainter where the globe is in front of it.
    const eye = toView(camera, surface.eye);
    ctx.globalAlpha = visibleRuns([eye])[0]!.hidden ? HIDDEN_ALPHA : 1;
    ctx.beginPath();
    ctx.arc(...onFace(eye[0], eye[1]), 3, 0, 2 * Math.PI);
    ctx.fillStyle = style.accent;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  const schedule = (): void => {
    if (frameId || timer) return;
    const wait = drawnAt + REDRAW_GAP - performance.now();
    if (wait <= 0) frameId = requestAnimationFrame(draw);
    else
      timer = window.setTimeout(() => {
        timer = 0;
        frameId = requestAnimationFrame(draw);
      }, wait);
  };

  /** Shows the corner globe as it is wanted and as the map allows, and draws it. */
  function update(): void {
    container.hidden = app.state.defId === 'globe';
    container.classList.toggle('collapsed', state.collapsed);
    face.hidden = state.collapsed;
    const has = surfaceFor(compile(app.state)) !== null;
    surfaceButton.hidden = resetButton.hidden = state.collapsed;
    surfaceButton.setAttribute('aria-disabled', String(!has));
    surfaceButton.setAttribute('aria-pressed', String(state.surface && has));
    surfaceButton.setAttribute('aria-description', has ? SHOW_SURFACE : NO_SURFACE);
    resetButton.hidden ||= camera === DEFAULT_CAMERA;
    collapseButton.setAttribute('aria-expanded', String(!state.collapsed));
    schedule();
  }
  // The state is the map on screen, which a slide moves frame by frame; a morph's is the one it is going to.
  app.subscribe(update);
  new ResizeObserver(schedule).observe(face);

  /** The pointer's place on the globe's face, in radii from its middle with y up. */
  const placeOf = (e: PointerEvent): Pair => {
    const box = canvas.getBoundingClientRect();
    const radius = radiusFor(box.width, shownSurface() !== null);
    return [(e.clientX - box.left - box.width / 2) / radius, -(e.clientY - box.top - box.height / 2) / radius];
  };

  let press: { id: number; start: Pair; last: Pair; moved: boolean } | null = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || press) return;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {}
    press = { id: e.pointerId, start: [e.clientX, e.clientY], last: [e.clientX, e.clientY], moved: false };
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = press;
    if (!p || e.pointerId !== p.id) return;
    if (!p.moved && Math.hypot(e.clientX - p.start[0], e.clientY - p.start[1]) < CLICK_SLOP) return;
    p.moved = true;
    const radius = radiusFor(canvas.getBoundingClientRect().width, shownSurface() !== null);
    camera = orbit(camera, e.clientX - p.last[0], e.clientY - p.last[1], radius);
    p.last = [e.clientX, e.clientY];
    update();
  });
  const release = (e: PointerEvent, click: boolean): void => {
    const p = press;
    if (!p || e.pointerId !== p.id) return;
    press = null;
    if (!click || p.moved) return;
    // A click moves the map's centre to the place clicked, with the tilt held. A conic keeps its centre latitude.
    const place = pick(camera, ...placeOf(e));
    if (!place) return;
    const o = app.state.orientation;
    const latFree = compile(app.state).def.latEnabled;
    app.setAnimated({ orientation: { ...o, lon: normaliseLon(place[0]), lat: latFree ? clampLat(place[1]) : o.lat } });
  };
  canvas.addEventListener('pointerup', (e) => release(e, true));
  canvas.addEventListener('pointercancel', (e) => release(e, false));
  canvas.addEventListener('lostpointercapture', (e) => release(e, false));

  update();
}
