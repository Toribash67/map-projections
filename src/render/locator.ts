import { geoCircle, geoDistance, geoGraticule, geoOrthographic, geoPath, type GeoPermissibleObjects, type GeoSphere } from 'd3-geo';
import type { App } from '../app';
import { LAND } from '../data/land';
import { shapeToGeoJSON } from '../drawing/model';
import { compile } from '../projections/compile';
import type { LonLat } from '../projections/types';
import { clampLat, normaliseLon } from '../ui/slider';
import { MAP_STYLE } from './draw';

// Space left round the globe for its outline, in CSS pixels.
const PAD = 2;
// What the map cannot show, in the slate of the graticule but darker, so that it reads over land and sea alike.
const SHADE = 'rgba(43, 58, 68, 0.38)';
const INK = '#2b3a44';
const MERIDIAN_STEP = 30;
const rad = Math.PI / 180;

const sphere: GeoSphere = { type: 'Sphere' };
// The data comes typed as plain GeoJSON, which the path takes as it is.
const land = LAND as GeoPermissibleObjects;
const graticule = geoGraticule().step([MERIDIAN_STEP, MERIDIAN_STEP])();

/**
 * A small globe in the corner of the map, for every projection but the globe itself. It is
 * centred on the map's centre and shows what the map leaves out (shaded), the map's own equator
 * and poles, and the drawings in full. It shows the projection a morph is going to, and is
 * redrawn when the state, the drawings or its own size change, not on every morph frame.
 * Pressing or dragging on it moves the map's centre there, with tilt held; while it is held
 * the globe keeps its view, so that the marker can travel over it.
 */
export function createLocator(container: HTMLElement, app: App): void {
  const canvas = document.createElement('canvas');
  // A touch drag moves the centre, not the page.
  canvas.style.touchAction = 'none';
  container.append(canvas);
  const ctx = canvas.getContext('2d')!;
  const projection = geoOrthographic().clipAngle(90);
  const path = geoPath(projection, ctx);

  // The centre the globe is turned to while it is held, or null.
  let held: LonLat | null = null;
  let pointerId = -1;
  let frameId = 0;

  const draw = (): void => {
    frameId = 0;
    const size = container.clientWidth;
    if (container.hidden || !(size > 0)) return;
    const ratio = window.devicePixelRatio || 1;
    const store = Math.round(size * ratio);
    if (canvas.width !== store) canvas.width = canvas.height = store;
    ctx.setTransform(store / size, 0, 0, store / size, 0, 0);
    ctx.clearRect(0, 0, size, size);

    const compiled = compile(app.state);
    // What the map uses: a conic's centre latitude is zero whatever the state says.
    const centre = compiled.fromFrame([0, 0]);
    const view = held ?? centre;
    projection.rotate([-view[0], -view[1]]).translate([size / 2, size / 2]).scale(size / 2 - PAD);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    ctx.beginPath();
    path(sphere);
    ctx.fillStyle = MAP_STYLE.ocean;
    ctx.fill();
    ctx.beginPath();
    path(graticule);
    ctx.strokeStyle = MAP_STYLE.graticule;
    ctx.lineWidth = MAP_STYLE.graticuleWidth;
    ctx.stroke();
    // The coast is the outline of the land, so one path does for both.
    ctx.beginPath();
    path(land);
    ctx.fillStyle = MAP_STYLE.land;
    ctx.fill();
    ctx.strokeStyle = MAP_STYLE.coast;
    ctx.lineWidth = MAP_STYLE.coastWidth;
    ctx.stroke();

    // Excluded caps are circles in the projection's frame.
    ctx.fillStyle = SHADE;
    for (const cap of compiled.caps) {
      ctx.beginPath();
      path(geoCircle().center(compiled.fromFrame(cap.frameCenter)).radius(cap.radius)());
      ctx.fill();
    }

    // The map's own equator, and where its poles are: on a transverse map the equator is a meridian.
    const [north, south] = [compiled.fromFrame([0, 90]), compiled.fromFrame([0, -90])];
    ctx.beginPath();
    path(geoCircle().center(north).radius(90)());
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 2]);
    ctx.stroke();
    ctx.setLineDash([]);

    // A polygon or circle comes as a fill and an outline of its own.
    const parts = app.shapes.flatMap((s) => {
      const g = shapeToGeoJSON(s);
      return g.type === 'GeometryCollection' ? g.geometries : [g];
    });
    ctx.fillStyle = MAP_STYLE.accentFill;
    ctx.strokeStyle = MAP_STYLE.accent;
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
    ctx.fillStyle = INK;
    for (const [pole, letter] of [[north, 'N'], [south, 'S']] as const) {
      // A pole on the far side of the globe is not drawn. A tilted map's lie on the rim, so a hair of slack.
      if (geoDistance(pole, view) > Math.PI / 2 + 1e-3) continue;
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

    // The centre. Held, the marker is where the map's centre now is on the globe as it was when taken hold of.
    const [mx, my] = projection(centre)!;
    ctx.beginPath();
    ctx.arc(mx, my, 4.5, 0, 2 * Math.PI);
    ctx.fillStyle = 'rgba(247, 245, 239, 0.85)';
    ctx.fill();
    ctx.strokeStyle = MAP_STYLE.accent;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(mx, my, 1.5, 0, 2 * Math.PI);
    ctx.fillStyle = MAP_STYLE.accent;
    ctx.fill();

    ctx.beginPath();
    path(sphere);
    ctx.strokeStyle = MAP_STYLE.coast;
    ctx.lineWidth = 1;
    ctx.stroke();
  };

  const schedule = (): void => {
    if (!frameId) frameId = requestAnimationFrame(draw);
  };

  // The state is the one a morph is going to, so a morph needs no redraw of its own.
  const update = (): void => {
    container.hidden = app.state.defId === 'globe';
    schedule();
  };
  app.subscribe(update);
  new ResizeObserver(schedule).observe(container);

  /** The longitude and latitude under the pointer on the globe as it is now, or the nearest on its rim. */
  const lonLatAt = (e: PointerEvent): LonLat => {
    const box = canvas.getBoundingClientRect();
    const [x, y] = [e.clientX - box.left - box.width / 2, e.clientY - box.top - box.height / 2];
    const reach = Math.hypot(x, y);
    const limit = projection.scale() * 0.999;
    const k = reach > limit ? limit / reach : 1;
    const p = projection.invert!([box.width / 2 + x * k, box.height / 2 + y * k]);
    return [normaliseLon(p![0]), clampLat(p![1])];
  };
  const moveTo = (e: PointerEvent): void => {
    const [lon, lat] = lonLatAt(e);
    const o = app.state.orientation;
    // A conic keeps its centre latitude, and tilt is held.
    app.setLive({ orientation: { ...o, lon, lat: compile(app.state).def.latEnabled ? lat : o.lat } });
  };

  canvas.addEventListener('pointerdown', (e) => {
    // A morph ignores changes; and one press holds the globe at a time.
    if (e.button !== 0 || app.isMorphing || held) return;
    held = compile(app.state).fromFrame([0, 0]);
    pointerId = e.pointerId;
    canvas.setPointerCapture(e.pointerId);
    moveTo(e);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (held && e.pointerId === pointerId && !app.isMorphing) moveTo(e);
  });
  const release = (e: PointerEvent): void => {
    if (!held || e.pointerId !== pointerId) return;
    held = null;
    schedule();
  };
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) canvas.addEventListener(type, release);

  update();
}
