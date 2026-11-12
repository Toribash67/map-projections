import { capOceanLayer } from './geo/capCells';
import { shapeToGeoJSON, type Shape } from './drawing/model';
import { MorphController } from './morph/controller';
import { buildScene, type Scene } from './morph/scene';
import { canSlide, Slide } from './morph/slide';
import { getDef, stops } from './projections/catalog';
import { compile, stateForStop } from './projections/compile';
import type { CompiledProjection, LonLat, ProjectionState, Stop } from './projections/types';
import { drawScene } from './render/draw';
import { styleOf, type Style } from './render/style';
import { bordersOf, politicalOf } from './data/countries';
import { loadDetail } from './data/detail';
import { COARSE, DEFAULT_LAYERS, sceneLayers, type GraticuleStep, type LayerId, type LayerState, type MapData } from './layers/layers';
import { computeScreen, isCovered, projectPoint, screenToLonLat, type ScreenTransform, type Viewport } from './screen/screen';
import { applyView, clampView, FIT, zoomAbout, type View } from './screen/view';
import { indicatrixStep, type Member } from './tissot/indicatrix';
import { currentScheme, watchScheme } from './theme/scheme';
import { applyToPage, chromeScheme, resolvePalette, type ColourKey, type Overrides, type ThemeId } from './theme/themes';

type Pair = [number, number];

// How long (ms) a zoom from a button or a key takes.
const ZOOM_TIME = 150;
// Zoomed in this far and left alone this long (ms), the map is drawn again with finer coastlines. They are too many to cut on every frame of a drag.
const FINE_FROM = 3;
const FINE_AFTER = 250;

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
  /** How the fitted map is looked at: zoomed and panned. */
  view: View = FIT;
  /** Which layers the map shows. Replaced when it changes, never changed in place. */
  layers: LayerState = DEFAULT_LAYERS;
  /** The look of the map and the page, and the colours set by hand over it. */
  theme: ThemeId = 'auto';
  overrides: Overrides = {};
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
  // The map's colours: the theme's, for the scheme the system is in now, with those set by hand.
  private colours = styleOf(resolvePalette('auto', {}, currentScheme()));
  private stale = true;
  private sceneIsMorph = false;
  private frameId = 0;
  // The last fit, by everything it depends on. Moving the centre does not change it.
  private fitKey = '';
  private fit: ScreenTransform | null = null;
  // The fit under the view, kept so that a map that has not changed keeps the very same screen.
  private viewed: { fit: ScreenTransform; view: View; screen: ScreenTransform } | null = null;
  private zoomTween: { from: View; at: Pair; factor: number; startedAt: number } | null = null;
  // The finer coastlines, once fetched, and whether the scene on screen is drawn with them.
  private fine: MapData | null = null;
  private useFine = false;
  private fineTimer = 0;
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
    watchScheme(() => this.restyle());
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

  /**
   * Looks at the map another way, at once. Ignored while a morph runs, whose scene is cut for the views it began with. A slide keeps
   * going under the new view.
   */
  setView(view: View): void {
    if (this.controller.tick()) return;
    this.zoomTween = null;
    this.applyView(view);
  }

  /** Zooms by a factor about a place on the map, the middle if none is given, over a moment: for a button or a key, which have no cursor to follow. */
  zoomBy(factor: number, at: Pair = [this.viewport.width / 2, this.viewport.height / 2]): void {
    if (this.controller.tick()) return;
    // From where a zoom under way is going, so that two presses in a row are two steps.
    const from = this.zoomTween ? zoomAbout(this.zoomTween.from, this.viewport, this.zoomTween.at, this.zoomTween.factor) : this.view;
    this.applyView(from);
    this.zoomTween = { from, at, factor, startedAt: this.now() };
    this.request();
  }

  private applyView(next: View): void {
    const view = clampView(next, this.viewport);
    if (view.zoom === this.view.zoom && view.panX === this.view.panX && view.panY === this.view.panY) return;
    this.view = view;
    this.controller.resize((m) => ({ ...m, screen: this.screenFor(m.compiled) }));
    this.invalidate();
    this.notify();
  }

  /**
   * The view for a map about to be morphed to: the same zoom, with the place now in the middle of the window still in the middle, so
   * that what was being looked at stays in sight. The fit, if the new map cannot show that place, or there is no map at rest to read it from.
   */
  private viewOnto(next: ProjectionState): View {
    if (this.view.zoom === 1) return FIT;
    const live = this.live;
    const [cx, cy] = [this.viewport.width / 2, this.viewport.height / 2];
    const focus = live ? screenToLonLat(live.compiled, live.screen, [cx, cy]) : null;
    const compiled = compile(next);
    if (!focus || !isCovered(compiled, focus)) return live ? FIT : this.view;
    const [x, y] = projectPoint(compiled, this.fitFor(compiled), focus);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return FIT;
    const { zoom } = this.view;
    return clampView({ zoom, panX: -zoom * (x - cx), panY: -zoom * (y - cy) }, this.viewport);
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
    this.zoomTween = null;
    // The maps on screen keep the view they have; the one arrived at has its own.
    this.view = this.viewOnto(next);
    this.state = next;
    const before = this.controller.target();
    this.controller.morphTo(this.memberOf(next));
    if (this.controller.target() !== before) this.invalidate();
    this.notify();
  }

  /** The colours and line widths the map is drawn with now. */
  get style(): Style {
    return this.colours;
  }

  setTheme(theme: ThemeId): void {
    if (theme === this.theme) return;
    this.theme = theme;
    this.restyle();
  }

  /** Sets one of the map's colours by hand, as '#rrggbb', over the theme's; null takes it off again. */
  setOverride(key: ColourKey, colour: string | null): void {
    if ((this.overrides[key] ?? null) === colour) return;
    const { [key]: _, ...rest } = this.overrides;
    this.overrides = colour === null ? rest : { ...rest, [key]: colour };
    this.restyle();
  }

  /** Works out the colours afresh, repaints the map with them, and puts them on the page round it. The scene holds no colours, so it is not cut again. */
  private restyle(): void {
    const system = currentScheme();
    const palette = resolvePalette(this.theme, this.overrides, system);
    this.colours = styleOf(palette);
    // The paper look with nothing set by hand is what the page has of its own, and follows the system by itself.
    const own = this.theme === 'auto' && Object.keys(this.overrides).length === 0;
    applyToPage(document.documentElement, own ? null : palette, chromeScheme(this.theme, system));
    this.request();
    this.notify();
  }

  /** Whether the Tissot indicatrices are shown: one of the layers. */
  get tissot(): boolean {
    return this.layers.on.tissot;
  }

  setTissot(on: boolean): void {
    this.setLayer('tissot', on);
  }

  /** Shows or hides a layer. */
  setLayer(id: LayerId, on: boolean): void {
    if (on === this.layers.on[id]) return;
    this.layers = { ...this.layers, on: { ...this.layers.on, [id]: on } };
    this.invalidate();
    this.notify();
  }

  setGraticuleStep(step: GraticuleStep): void {
    if (step === this.layers.graticuleStep) return;
    this.layers = { ...this.layers, graticuleStep: step };
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
  private fitFor(c: CompiledProjection): ScreenTransform {
    const tilt = c.def.tiltEnabled ? c.state.orientation.tilt : 0;
    const key = JSON.stringify([c.def.id, { ...c.def.defaultParams, ...c.state.params }, tilt, this.viewport]);
    if (key !== this.fitKey || !this.fit) {
      this.fit = computeScreen(c, this.viewport);
      this.fitKey = key;
    }
    return this.fit;
  }

  /** Where a map is drawn: its fit, under the view. */
  private screenFor(c: CompiledProjection): ScreenTransform {
    const fit = this.fitFor(c);
    if (this.viewed?.fit !== fit || this.viewed.view !== this.view) this.viewed = { fit, view: this.view, screen: applyView(fit, this.view, this.viewport) };
    return this.viewed.screen;
  }

  private invalidate(): void {
    this.stale = true;
    // Whatever has changed, the next frame is drawn with the coarse coastlines, and the finer ones wait for the map to be left alone.
    this.useFine = false;
    window.clearTimeout(this.fineTimer);
    this.fineTimer = this.view.zoom >= FINE_FROM ? window.setTimeout(() => void this.refine(), FINE_AFTER) : 0;
    this.request();
  }

  /** Draws the map at rest again with the finer coastlines, unless it has changed, or begun to, while they were fetched. */
  private async refine(): Promise<void> {
    const timer = this.fineTimer;
    if (!this.fine) {
      const { land, coast, topology } = await loadDetail('50m');
      // The countries are worked out only if a layer of them is ever looked at this closely.
      let countries: Pick<MapData, 'borders' | 'political'> | null = null;
      const fromTopology = () => (countries ??= { borders: bordersOf(topology), political: politicalOf(topology) });
      this.fine = {
        land,
        coast,
        get borders() {
          return fromTopology().borders;
        },
        get political() {
          return fromTopology().political;
        },
      };
    }
    if (timer !== this.fineTimer || this.controller.tick() || this.slide || this.zoomTween) return;
    this.useFine = true;
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
    const zooming = this.zoomTween;
    if (zooming) {
      const u = Math.min(1, (this.now() - zooming.startedAt) / ZOOM_TIME);
      if (u >= 1) this.zoomTween = null;
      // Eased out, and even in the zoom's own terms: each moment multiplies by the same.
      this.applyView(zoomAbout(zooming.from, this.viewport, zooming.at, zooming.factor ** (1 - (1 - u) ** 2)));
    }
    const morphing = this.controller.tick();
    const settled = this.sceneIsMorph && !morphing;
    if (this.stale || settled) {
      const [source, target] = [this.controller.source(), this.controller.target()];
      const maps = (target ? [...source, target] : source).map((m) => m.compiled);
      const layers = sceneLayers(this.layers, maps, this.drawings, this.useFine && this.fine && !target ? this.fine : COARSE);
      // What a map cannot show is only seen in a morph, where it folds over as it moves to its place on the other map: its ocean comes as cells too.
      const cells = target ? capOceanLayer([...source, target]) : null;
      if (cells) layers.capOcean = cells;
      // Zoomed in, the indicatrices are closer together and smaller, and only those in or near the window are worked out.
      this.scene = buildScene(layers, source, target, this.tissot && { step: indicatrixStep(this.view.zoom), viewport: this.viewport });
      this.sceneIsMorph = morphing;
      this.stale = false;
    }
    drawScene(this.ctx, this.scene, this.controller.t(), this.colours);
    if (morphing || this.slide || this.zoomTween) this.request();
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
      // A view at its limit in the old window may be past it in the new one.
      this.view = clampView(this.view, this.viewport);
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
