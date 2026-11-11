import { COAST, GRATICULE, LAND } from './data/land';
import { capOceanLayer } from './geo/capCells';
import { shapeToGeoJSON, type Shape } from './drawing/model';
import { MorphController } from './morph/controller';
import { buildScene, type Scene } from './morph/scene';
import { canSlide, Slide } from './morph/slide';
import { getDef, stops } from './projections/catalog';
import { compile, stateForStop } from './projections/compile';
import type { CompiledProjection, LonLat, ProjectionState, Stop } from './projections/types';
import { drawScene } from './render/draw';
import { mapStyle } from './render/style';
import { computeScreen, type ScreenTransform, type Viewport } from './screen/screen';
import type { Member } from './tissot/indicatrix';
import { currentScheme, watchScheme } from './theme/scheme';

const OCEAN = { type: 'Sphere' } as unknown as GeoJSON.GeoJsonObject;

/** Whether two states are the same map, number for number. */
const sameState = (a: ProjectionState, b: ProjectionState): boolean => {
  const key = (s: ProjectionState) => JSON.stringify([s.defId, Object.entries(s.params).sort(), s.orientation.lon, s.orientation.lat, s.orientation.tilt]);
  return key(a) === key(b);
};

/**
 * The single store: what the map shows, and the canvas it is drawn on. A morph's scene is cut
 * once when it starts, and its frames only blend. A map at rest or changed live is rebuilt with
 * the cheaper live cut. Frames are requested only while there is something to draw.
 *
 * A change between two maps of one definition is a slide, not a morph: the state itself moves from one to the other, and each
 * frame is the real map of the state in between, rebuilt live. While it runs, `state` is that state in between.
 */
export class App {
  state: ProjectionState;
  viewport: Viewport;
  tissot = false;
  shapes: Shape[] = [];
  /** The projection last chosen from the list, whose defaults the resets return to. */
  selected: Stop;

  private readonly ctx: CanvasRenderingContext2D;
  private readonly now = () => performance.now();
  private readonly controller = new MorphController(this.now);
  private slide: Slide | null = null;
  private readonly listeners: (() => void)[] = [];
  // Replaced, never changed in place: the live cut caches what it prepares by geometry object.
  private drawings: GeoJSON.GeometryCollection = { type: 'GeometryCollection', geometries: [] };
  private scene: Scene = { layers: {}, indicatrices: [] };
  // The map's colours, for the scheme the system is in now.
  private style = mapStyle(currentScheme());
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
    this.selected = stops.find((s) => s.id === 'globe')!;
    this.state = stateForStop(this.selected);
    this.viewport = { width: canvas.clientWidth, height: canvas.clientHeight };
    this.controller.jumpTo(this.memberOf(this.state));
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.watchPixelRatio();
    // The scene holds no colours, so a change of scheme only repaints it.
    watchScheme((scheme) => {
      this.style = mapStyle(scheme);
      this.request();
    });
    this.resize();
  }

  get isMorphing(): boolean {
    return this.controller.isMorphing;
  }

  get isSliding(): boolean {
    return this.slide !== null;
  }

  /** The map at rest or in a slide, with the fit it is drawn with, or null while a morph runs. */
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

  /** Goes to a named projection: by a slide from a map of the same definition, by a morph from any other, or by redirecting the morph under way. */
  select(stop: Stop): void {
    this.selected = stop;
    const conic = (defId: string) => getDef(defId).family === 'conic';
    if (conic(stop.defId) && !conic(this.state.defId)) {
      const { lon, lat } = this.state.orientation;
      this.centreBeforeConic = [lon, lat];
    }
    // What carries over is read from where a slide is going, not from the map in between: a tilt half way to Transverse Mercator's is not one set by hand.
    const from = this.slide?.to ?? this.state;
    const next = stateForStop(stop, from, { centreBeforeConic: this.centreBeforeConic, tiltByHand: this.tiltByHand });
    // A tilt a stop brought, or none, is not one set by hand.
    this.tiltByHand &&= stop.tilt === undefined && next.orientation.tilt !== 0;
    this.goTo(next);
  }

  /** Changes the map with motion, as a reset or a typed value does: a slide if the definition stays, an ordinary morph if not. Ignored while a morph runs. */
  setAnimated(patch: Partial<ProjectionState>): void {
    // Like a live change, it is ignored while a morph runs: only choosing a projection redirects one.
    if (this.controller.tick()) return;
    if (patch.orientation && patch.orientation.tilt !== this.state.orientation.tilt) this.tiltByHand = true;
    this.goTo({ ...this.state, ...patch });
  }

  /** Changes the map at once, with no morph. It takes over a slide where the slide is, and is ignored while a morph runs. */
  setLive(patch: Partial<ProjectionState>): void {
    if (this.controller.tick()) return;
    this.slide = null;
    if (patch.orientation && patch.orientation.tilt !== this.state.orientation.tilt) this.tiltByHand = true;
    this.show({ ...this.state, ...patch });
    this.notify();
  }

  /** Puts a state on screen as the map at rest. */
  private show(state: ProjectionState): void {
    this.state = state;
    this.controller.jumpTo(this.memberOf(state));
    this.invalidate();
  }

  private goTo(next: ProjectionState): void {
    const morphing = this.controller.tick();
    if (!morphing && canSlide(this.state, next)) {
      // The state on screen is the start, which mid-slide is the map in between. Nothing to do where it is the map asked for already.
      this.slide = sameState(this.state, next) ? null : new Slide(this.state, next, this.now());
      if (this.slide) this.request();
      this.notify();
      return;
    }
    // The controller holds the map in between of a slide cut short, so the morph starts from there.
    this.slide = null;
    this.state = next;
    const before = this.controller.target();
    this.controller.morphTo(this.memberOf(next));
    if (this.controller.target() !== before) this.invalidate();
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
    this.drawings = { type: 'GeometryCollection', geometries: this.shapes.map(shapeToGeoJSON) };
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
    const slide = this.slide;
    if (slide) {
      const { state, done } = slide.at(this.now());
      if (done) this.slide = null;
      this.show(state);
    }
    const morphing = this.controller.tick();
    const settled = this.sceneIsMorph && !morphing;
    if (this.stale || settled) {
      const [source, target] = [this.controller.source(), this.controller.target()];
      const layers: Record<string, GeoJSON.GeoJsonObject> = { ocean: OCEAN, land: LAND, graticule: GRATICULE, coast: COAST, drawings: this.drawings };
      // What a map cannot show is only seen in a morph, where it folds over as it moves to its place on the other map: its ocean comes as cells too.
      const cells = target ? capOceanLayer([...source, target]) : null;
      if (cells) layers.capOcean = cells;
      this.scene = buildScene(layers, source, target, this.tissot);
      this.sceneIsMorph = morphing;
      this.stale = false;
    }
    drawScene(this.ctx, this.scene, this.controller.t(), this.style);
    if (morphing || this.slide) this.request();
    if (settled || slide) this.notify();
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
