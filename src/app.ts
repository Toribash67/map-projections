import { geoCircle } from 'd3-geo';
import { COAST, GRATICULE, LAND } from './data/land';
import { farSideCells } from './geo/farCells';
import type { Shape } from './drawing/model';
import { MorphController } from './morph/controller';
import { buildScene, type Scene } from './morph/scene';
import { getDef, stops } from './projections/catalog';
import { compile, stateForStop } from './projections/compile';
import type { CompiledProjection, LonLat, ProjectionState, Stop } from './projections/types';
import { drawScene, MAP_STYLE } from './render/draw';
import { computeScreen, type ScreenTransform, type Viewport } from './screen/screen';
import type { Member } from './tissot/indicatrix';

const OCEAN = { type: 'Sphere' } as unknown as GeoJSON.GeoJsonObject;
// Side of a far-side ocean cell, in degrees. Smaller cells fold less within themselves, and cost more to cut.
const FAR_CELL = 10;

/**
 * Drawn shapes as one geometry. A polygon's outline is a line of its own, so the fill is never
 * outlined where a seam cuts it.
 */
function drawingsOf(shapes: Shape[]): GeoJSON.GeometryCollection {
  const geometries: GeoJSON.Geometry[] = [];
  for (const shape of shapes) {
    if (shape.kind === 'line') {
      geometries.push({ type: 'LineString', coordinates: shape.points });
      continue;
    }
    const ring = shape.kind === 'circle' ? geoCircle().center(shape.center).radius(shape.radiusDeg)().coordinates[0]! : shape.points;
    geometries.push({ type: 'Polygon', coordinates: [ring] }, { type: 'LineString', coordinates: ring });
  }
  return { type: 'GeometryCollection', geometries };
}

/**
 * The single store: what the map shows, and the canvas it is drawn on. A morph's scene is cut
 * once when it starts, and its frames only blend. A map at rest or changed live is rebuilt with
 * the cheaper live cut. Frames are requested only while there is something to draw.
 */
export class App {
  state: ProjectionState;
  viewport: Viewport;
  tissot = false;
  shapes: Shape[] = [];

  private readonly ctx: CanvasRenderingContext2D;
  private readonly controller = new MorphController(() => performance.now());
  private readonly listeners: (() => void)[] = [];
  // Replaced, never changed in place: the live cut caches what it prepares by geometry object.
  private drawings: GeoJSON.GeometryCollection = drawingsOf([]);
  private scene: Scene = { layers: {}, indicatrices: [] };
  private stale = true;
  private sceneIsMorph = false;
  private frameId = 0;
  // The last fit, by everything it depends on. Moving the centre does not change it.
  private fitKey = '';
  private fit: ScreenTransform | null = null;
  // What choosing a projection needs to know that the state does not say. See stateForStop.
  private centreBeforeConic: LonLat | undefined;
  private tiltByHand = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.state = stateForStop(stops.find((s) => s.id === 'globe')!);
    this.viewport = { width: canvas.clientWidth, height: canvas.clientHeight };
    this.controller.jumpTo(this.memberOf(this.state));
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.watchPixelRatio();
    this.resize();
  }

  get isMorphing(): boolean {
    return this.controller.isMorphing;
  }

  /** The map at rest, with the fit it is drawn with, or null while a morph runs. */
  get live(): { compiled: CompiledProjection; screen: ScreenTransform } | null {
    if (this.controller.tick()) return null;
    const { compiled, screen } = this.controller.source()[0]!;
    return { compiled, screen };
  }

  /** Calls `fn` whenever the state, the viewport or the drawings change, and when a morph ends. Returns how to stop. */
  subscribe(fn: () => void): () => void {
    this.listeners.push(fn);
    return () => {
      const i = this.listeners.indexOf(fn);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  /** Morphs to a named projection, or redirects the morph under way. */
  select(stop: Stop): void {
    const conic = (defId: string) => getDef(defId).family === 'conic';
    if (conic(stop.defId) && !conic(this.state.defId)) {
      const { lon, lat } = this.state.orientation;
      this.centreBeforeConic = [lon, lat];
    }
    this.state = stateForStop(stop, this.state, { centreBeforeConic: this.centreBeforeConic, tiltByHand: this.tiltByHand });
    // A tilt a stop brought, or none, is not one set by hand.
    this.tiltByHand &&= stop.tilt === undefined && this.state.orientation.tilt !== 0;
    const before = this.controller.target();
    this.controller.morphTo(this.memberOf(this.state));
    if (this.controller.target() !== before) this.invalidate();
    this.notify();
  }

  /** Changes the map at once, with no morph. Ignored while a morph runs. */
  setLive(patch: Partial<ProjectionState>): void {
    if (this.controller.tick()) return;
    if (patch.orientation && patch.orientation.tilt !== this.state.orientation.tilt) this.tiltByHand = true;
    this.state = { ...this.state, ...patch };
    this.controller.jumpTo(this.memberOf(this.state));
    this.invalidate();
    this.notify();
  }

  setTissot(on: boolean): void {
    if (on === this.tissot) return;
    this.tissot = on;
    this.invalidate();
    this.notify();
  }

  /** Call after replacing `shapes`. */
  invalidateGeometry(): void {
    this.drawings = drawingsOf(this.shapes);
    this.invalidate();
    this.notify();
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }

  private memberOf(state: ProjectionState): Member {
    const compiled = compile(state);
    return { compiled, screen: this.screenFor(compiled), weight: 1 };
  }

  /** The fit depends on the projection's shape and the viewport, never on its centre longitude and latitude. */
  private screenFor(c: CompiledProjection): ScreenTransform {
    const tilt = c.def.tiltEnabled ? c.state.orientation.tilt : 0;
    const key = JSON.stringify([c.def.id, { ...c.def.defaultParams, ...c.state.params }, tilt, this.viewport]);
    if (key !== this.fitKey || !this.fit) {
      this.fit = computeScreen(c, this.viewport);
      this.fitKey = key;
    }
    return this.fit;
  }

  private invalidate(): void {
    this.stale = true;
    this.request();
  }

  private request(): void {
    if (!this.frameId) this.frameId = requestAnimationFrame(this.frame);
  }

  private readonly frame = (): void => {
    this.frameId = 0;
    const morphing = this.controller.tick();
    const settled = this.sceneIsMorph && !morphing;
    if (this.stale || settled) {
      const [source, target] = [this.controller.source(), this.controller.target()];
      const layers: Record<string, GeoJSON.GeoJsonObject> = { ocean: OCEAN, land: LAND, graticule: GRATICULE, coast: COAST, drawings: this.drawings };
      // A globe's far side shows only in a morph, where it folds over: its ocean comes as cells too.
      const globes = target ? [...source, target].filter((m) => m.compiled.caps.some((cap) => cap.mode === 'behind')) : [];
      if (globes.length > 0) {
        layers.farOcean = { type: 'GeometryCollection', geometries: globes.flatMap((m) => farSideCells(m.compiled, FAR_CELL).geometries) } as GeoJSON.GeometryCollection;
      }
      this.scene = buildScene(layers, source, target, this.tissot);
      this.sceneIsMorph = morphing;
      this.stale = false;
    }
    drawScene(this.ctx, this.scene, this.controller.t(), MAP_STYLE);
    if (morphing) this.request();
    if (settled) this.notify();
  };

  /** Sizes the canvas store by the pixel ratio and refits every map on screen to a new viewport, then draws at once, as resizing clears the canvas. */
  private resize(): void {
    const { clientWidth: width, clientHeight: height } = this.canvas;
    if (!(width > 0 && height > 0)) return;
    const ratio = window.devicePixelRatio || 1;
    const [storeWidth, storeHeight] = [Math.round(width * ratio), Math.round(height * ratio)];
    const sized = this.canvas.width !== storeWidth || this.canvas.height !== storeHeight;
    if (sized) [this.canvas.width, this.canvas.height] = [storeWidth, storeHeight];
    this.ctx.setTransform(storeWidth / width, 0, 0, storeHeight / height, 0, 0);
    if (width !== this.viewport.width || height !== this.viewport.height) {
      this.viewport = { width, height };
      this.controller.resize((m) => ({ ...m, screen: this.screenFor(m.compiled) }));
      this.stale = true;
      this.notify();
    }
    if (!sized && !this.stale) return;
    cancelAnimationFrame(this.frameId);
    this.frame();
  }

  /** A change of pixel ratio alone, as on moving to another screen, resizes nothing on the page. */
  private watchPixelRatio(): void {
    matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`).addEventListener(
      'change',
      () => {
        this.resize();
        this.watchPixelRatio();
      },
      { once: true },
    );
  }
}
