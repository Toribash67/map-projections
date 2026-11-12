import { geoCircle, geoDistance, geoGraticule, geoOrthographic, geoPath, type GeoPermissibleObjects, type GeoSphere } from 'd3-geo';
import type { App } from '../app';
import { LAND } from '../data/land';
import { shapeToGeoJSON } from '../drawing/model';
import { compile } from '../projections/compile';
import type { LonLat, ProjectionState } from '../projections/types';
import { centreFor } from '../geo/grab';
import { clampLat, normaliseLon } from '../geo/angles';

// Space left round the globe for its outline, in CSS pixels.
const PAD = 2;
// The area the map covers is tinted in slate, lightly enough for land and sea to show through.
const TINT_ALPHA = 0.32;
const MERIDIAN_STEP = 30;
// Least time between two redraws of the globe. While the map is dragged this halves them; the last change is always drawn.
const REDRAW_GAP = 30;
type Pair = [number, number];

const sphere: GeoSphere = { type: 'Sphere' };
// The data comes typed as plain GeoJSON, which the path takes as it is.
const land = LAND as GeoPermissibleObjects;
const graticule = geoGraticule().step([MERIDIAN_STEP, MERIDIAN_STEP])();

/**
 * A small globe in the corner of the map, for every projection but the globe itself. It is
 * always centred on the map's centre, which its marker holds at the middle, and shows the area
 * the map covers (tinted), the map's own equator and poles, and the drawings in full. It shows
 * the projection a morph is going to, and is redrawn when the state, the drawings or its own size
 * change, not on every morph frame. Dragging turns the globe under the pointer, as if grabbed:
 * the land under the press stays under the pointer, and the map's centre moves with it, tilt
 * held. A press alone moves nothing.
 */
export function createLocator(container: HTMLElement, app: App): void {
  const canvas = document.createElement('canvas');
  // A touch drag moves the centre, not the page.
  canvas.style.touchAction = 'none';
  container.append(canvas);
  const ctx = canvas.getContext('2d')!;
  const projection = geoOrthographic().clipAngle(90);
  const path = geoPath(projection, ctx);
  // Unit globe, for finding the land under a place on it.
  const inverse = geoOrthographic().scale(1).translate([0, 0]);

  // The land taken hold of, the pointer that took it, and the state it was last held under.
  // A state changed by something else mid-drag, as by a slider, a key or a projection chosen from the list, is held afresh
  // at the pointer, so the map does not jump.
  let grab: { id: number; land: LonLat; heldOn: ProjectionState | null } | null = null;
  let frameId = 0;
  let timer = 0;
  let drawnAt = -Infinity;

  const draw = (): void => {
    frameId = 0;
    drawnAt = performance.now();
    const size = container.clientWidth;
    if (container.hidden || !(size > 0)) return;
    const ratio = window.devicePixelRatio || 1;
    const store = Math.round(size * ratio);
    if (canvas.width !== store) canvas.width = canvas.height = store;
    ctx.setTransform(store / size, 0, 0, store / size, 0, 0);
    ctx.clearRect(0, 0, size, size);

    const style = app.style;
    const compiled = compile(app.state);
    // What the map uses: a conic's centre latitude is zero whatever the state says.
    const centre = compiled.fromFrame([0, 0]);
    projection.rotate([-centre[0], -centre[1]]).translate([size / 2, size / 2]).scale(size / 2 - PAD);
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

    // The covered area is the sphere less the excluded caps, which are circles in the projection's frame.
    ctx.beginPath();
    path(sphere);
    for (const cap of compiled.caps) path(geoCircle().center(compiled.fromFrame(cap.frameCenter)).radius(cap.radius)());
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
      // A pole on the far side of the globe is not drawn. A tilted map's lie on the rim, so a hair of slack.
      if (geoDistance(pole, centre) > Math.PI / 2 + 1e-3) continue;
      const [x, y] = projection(pole)!;
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, 2 * Math.PI);
      ctx.fill();
      const [cx, cy] = [size / 2, size / 2];
      const away = Math.hypot(x - cx, y - cy) || 1;
      // The letter sits towards the middle of the globe from its pole, or above a pole at the middle.
      const [ux, uy] = away > 1 ? [(cx - x) / away, (cy - y) / away] : [0, -1];
      ctx.fillText(letter, x + 7 * ux, y + 7 * uy);
    }

    const [mx, my] = [size / 2, size / 2];
    ctx.beginPath();
    ctx.arc(mx, my, 4.5, 0, 2 * Math.PI);
    ctx.fillStyle = style.halo;
    ctx.fill();
    ctx.strokeStyle = style.accent;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(mx, my, 1.5, 0, 2 * Math.PI);
    ctx.fillStyle = style.accent;
    ctx.fill();

    ctx.beginPath();
    path(sphere);
    ctx.strokeStyle = style.coast;
    ctx.lineWidth = 1;
    ctx.stroke();
  };

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

  // The state is the one a morph is going to, so a morph needs no redraw of its own.
  const update = (): void => {
    container.hidden = app.state.defId === 'globe';
    schedule();
  };
  app.subscribe(update);
  new ResizeObserver(schedule).observe(container);

  /** The pointer's place on the globe, as fractions of its radius with north up, or null off the globe. */
  const placeOf = (e: PointerEvent): Pair | null => {
    const box = canvas.getBoundingClientRect();
    const radius = box.width / 2 - PAD;
    const [x, y] = [(e.clientX - box.left - box.width / 2) / radius, -(e.clientY - box.top - box.height / 2) / radius];
    return Math.hypot(x, y) < 1 ? [x, y] : null;
  };
  /** The land under a place on the globe as it is now. */
  const landAt = ([x, y]: Pair): LonLat => {
    const [lon, lat] = compile(app.state).fromFrame([0, 0]);
    return inverse.rotate([-lon, -lat]).invert!([x, -y])! as LonLat;
  };
  const latFree = () => compile(app.state).def.latEnabled;

  canvas.addEventListener('pointerdown', (e) => {
    // A morph ignores changes; and one press holds the globe at a time.
    if (e.button !== 0 || app.isMorphing || grab) return;
    const place = placeOf(e);
    if (!place) return;
    canvas.setPointerCapture(e.pointerId);
    grab = { id: e.pointerId, land: landAt(place), heldOn: app.state };
  });
  canvas.addEventListener('pointermove', (e) => {
    const g = grab;
    if (!g || e.pointerId !== g.id || app.isMorphing) return;
    const place = placeOf(e);
    if (!place) return;
    if (g.heldOn !== app.state) {
      g.land = landAt(place);
      g.heldOn = app.state;
      return;
    }
    const centre = centreFor(g.land, place, compile(app.state).fromFrame([0, 0]), latFree());
    if (!centre) return;
    const o = app.state.orientation;
    // Tilt is held. A conic keeps its centre latitude.
    app.setLive({ orientation: { ...o, lon: normaliseLon(centre[0]), lat: latFree() ? clampLat(centre[1]) : o.lat } });
    g.heldOn = app.state;
  });
  const release = (e: PointerEvent): void => {
    if (grab && e.pointerId === grab.id) grab = null;
  };
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) canvas.addEventListener(type, release);

  update();
}
