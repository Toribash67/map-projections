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
import type { Snapshot } from './export/render';
import { COARSE, DEFAULT_LAYERS, sceneLayers, type GraticuleStep, type LayerId, type LayerState, type MapData } from './layers/layers';
import { loadMapData, loadWaterFor, withWater } from './layers/mapData';
import { LAND } from './data/land';
import { loadWater, waterNow } from './data/water';
import { canvasMeasure, fontReady, loadFont } from './labels/font';
import { buildOverlay, buildPlateOnly, drawOverlay, lettersWanted, overlayWanted, type Overlay, type OverlayInput, type OverlayMeasure } from './overlay/overlay';
import { paddingFor, pictureRect, type Rect } from './plate/plate';
import { matchStop } from './projections/compile';
import { computeScreen, isCovered, projectPoint, screenToLonLat, type ScreenTransform, type Viewport } from './screen/screen';
import { applyView, clampView, FIT, zoomAbout, type View } from './screen/view';
import { visibleCap } from './screen/visible';
import { indicatrixStep, type Member } from './tissot/indicatrix';
import { currentScheme, watchScheme } from './theme/scheme';
import { applyToPage, chromeScheme, resolvePalette, type ColourKey, type Overrides, type ThemeId } from './theme/themes';

type Pair = [number, number];

// How long (ms) a zoom from a button or a key takes.
const ZOOM_TIME = 150;
// Zoomed in this far, the map is drawn with finer coastlines. They are too many to cut whole on every frame of a drag, so only what is in the window is cut.
const FINE_FROM = 3;
// Where even that takes longer than this (ms), as where the window shows most of a map that is slow to work out, a map that is moving
// has the coarse coastlines, and the finer ones come when it has been left alone this long (ms).
const FINE_BUDGET = 40;
const FINE_AFTER = 250;
const REST_SHARE = 0.6;
const WATER_LAYERS = ['rivers', 'lakes', 'depth'] as const;
// How long (ms) the map has to have been still before its names and degrees are fitted to it.
const LETTER_AFTER = 140;

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
  // The finer coastlines, once fetched, and whether they have been asked for.
  private fine: MapData | null = null;
  private fineAsked = false;
  // The rivers, lakes and depths being fetched now, by scale and layers, so that none is asked for twice at once.
  private readonly waterAsked = new Set<string>();
  private fontAsked = false;
  private seasAsked = false;
  // How long a frame with them last took, about, the layers it was timed with, and whether the map has been left alone since it last changed.
  private fineCost = 0;
  private fineTimed: LayerState | null = null;
  private rested = false;
  private restTimer = 0;
  // What is over the map, and the map it was worked out for. See `paintOverlay`.
  private over: { key: string; overlay: Overlay } | null = null;
  private overShown = false;
  private overTimer = 0;
  private measure: OverlayMeasure | null = null;
  // The picture the frame was last drawn round, and the one it had when the morph under way began: in a morph it goes from one to the other.
  private picture: Rect | null = null;
  private pictureFrom: Rect | null = null;
  // What choosing a projection needs to know that the state does not say. See stateForStop.
  private centreBeforeConic: LonLat | undefined;
  private tiltByHand = false;

  /** `kept` is what was remembered from the last visit of how the map looks and what it shows. */
  constructor(
    private readonly canvas: HTMLCanvasElement,
    kept: { theme?: ThemeId; overrides?: Overrides; layers?: LayerState } = {},
  ) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.theme = kept.theme ?? this.theme;
    this.overrides = kept.overrides ?? this.overrides;
    this.layers = kept.layers ?? this.layers;
    this.selected = stops.find((s) => s.id === 'globe')!;
    this.state = stateForStop(this.selected);
    this.viewport = { width: canvas.clientWidth, height: canvas.clientHeight };
    this.controller.jumpTo(this.memberOf(this.state));
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.watchPixelRatio();
    // The scene holds no colours, so a change of scheme only repaints it.
    watchScheme(() => this.restyle());
    // The colours of what was remembered, on the map and the page, before the first frame.
    this.restyle();
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

  /** What the map shows now, as everything an export needs, or null while a morph, a slide or a zoom is under way: only a map at rest is exported. */
  snapshot(): Snapshot | null {
    if (this.controller.tick() || this.slide || this.zoomTween) return null;
    return { state: this.state, named: this.named(), layers: this.layers, style: this.colours, drawings: this.drawings, view: this.view, viewport: this.viewport };
  }

  /** The projection the map is called by: the one chosen from the list while the map is still a setting of it, or the one it has become. */
  private named(): { name: string; params: ProjectionState['params'] } {
    return this.selected.defId === this.state.defId ? this.selected : (matchStop(this.state) ?? { name: 'Custom', params: {} });
  }

  /** What is written and drawn over the map now: its names, degrees, frame and title box. Null while the lettering is off the map, as it is while the map moves. */
  get overlay(): Overlay | null {
    return this.overShown && !this.controller.tick() && !this.slide && !this.zoomTween ? this.over!.overlay : null;
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
    const next = { ...this.state, ...patch };
    // During a slide the state is the map in between, and a control changes one number of it. The rest of what the slide was going
    // to is kept: whatever the change leaves as it is on screen goes on to where it was going.
    const going = this.slide?.to;
    if (going && going.defId === next.defId) {
      const kept = <T extends Record<string, number>>(now: T, wanted: T, target: T): T =>
        Object.fromEntries(Object.keys({ ...target, ...wanted }).map((key) => [key, wanted[key] === now[key] ? (target[key] ?? wanted[key]) : wanted[key]])) as T;
      next.params = kept(this.state.params, next.params, going.params);
      next.orientation = kept(this.state.orientation, next.orientation, going.orientation);
    }
    this.goTo(next);
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
    // At the fit, or as far in as the map goes, there is nowhere to zoom to.
    if (zoomAbout(from, this.viewport, at, factor).zoom === from.zoom) {
      this.zoomTween = null;
      return;
    }
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
    // The frame changes the margin, and with it where every map on screen is drawn.
    if (id === 'frame') this.controller.resize((m) => ({ ...m, screen: this.screenFor(m.compiled) }));
    this.invalidate();
    this.notify();
  }

  setGraticuleStep(step: GraticuleStep): void {
    this.setLayerOptions({ graticuleStep: step });
  }

  /** Changes the choices that go with the layers: the graticule's, the smallest name, and what the title box says and where it sits. */
  setLayerOptions(patch: Partial<Omit<LayerState, 'on'>>): void {
    const keys = Object.keys(patch) as (keyof typeof patch)[];
    if (keys.every((key) => patch[key] === this.layers[key])) return;
    this.layers = { ...this.layers, ...patch };
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
    // A picture with a frame has more margin round the map.
    const padding = paddingFor(this.layers);
    const key = JSON.stringify([c.def.id, { ...c.def.defaultParams, ...c.state.params }, tilt, this.viewport, padding]);
    if (key !== this.fitKey || !this.fit) {
      this.fit = computeScreen(c, this.viewport, padding);
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
    if (this.view.zoom >= FINE_FROM && !this.fine && !this.fineAsked) void this.fetchFine();
    this.fetchWater();
    this.rested = false;
    window.clearTimeout(this.restTimer);
    this.restTimer = this.fine && this.view.zoom >= FINE_FROM && this.fineCost > FINE_BUDGET ? window.setTimeout(this.rest, FINE_AFTER) : 0;
    this.request();
  }

  /** The map has been left alone: if it was too slow to have the finer coastlines while it moved, it is drawn with them now. */
  private readonly rest = (): void => {
    if (this.controller.tick() || this.slide || this.zoomTween) return;
    this.rested = true;
    this.stale = true;
    this.request();
  };

  /** Fetches the finer coastlines, the first time the map is looked at closely, and draws the map again with them. */
  private async fetchFine(): Promise<void> {
    this.fineAsked = true;
    try {
      this.fine = await loadMapData('50m');
    } catch {
      // The finer coast could not be fetched: the map stays as it is, and it is asked for again the next time.
      this.fineAsked = false;
      return;
    }
    this.fetchWater();
    this.stale = true;
    this.request();
  }

  /**
   * Fetches the rivers, lakes and depths that the layers that are on need, at the scales the map is drawn at, and draws the map again
   * when they come. Until then the map is drawn without them. One that could not be fetched is asked for again at the next change.
   */
  private fetchWater(): void {
    const levels = this.fine && this.view.zoom >= FINE_FROM ? (['110m', '50m'] as const) : (['110m'] as const);
    for (const level of levels) {
      const key = `${level}:${WATER_LAYERS.filter((id) => this.layers.on[id]).join()}`;
      if (this.waterAsked.has(key)) continue;
      const coming = loadWaterFor(this.layers.on, level);
      if (!coming) continue;
      this.waterAsked.add(key);
      coming
        .then(() => {
          this.stale = true;
          this.request();
        })
        .catch(() => {})
        .finally(() => this.waterAsked.delete(key));
    }
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
    // When a frame with the finer coastlines began to be built, if this is one.
    let began: number | null = null;
    if (this.stale || settled) {
      const [source, target] = [this.controller.source(), this.controller.target()];
      const maps = (target ? [...source, target] : source).map((m) => m.compiled);
      // A map looked at closely has the finer coastlines, whether it is still or moving, so they do not come and go. A morph is cut
      // whole and at once, which they are too many for: it has the coarse ones.
      const fine = !target && this.view.zoom >= FINE_FROM && (this.fineCost <= FINE_BUDGET || this.rested) ? this.fine : null;
      if (fine) began = performance.now();
      const layers = sceneLayers(this.layers, maps, this.drawings, fine ? withWater(fine, '50m') : withWater(COARSE, '110m'));
      // What a map cannot show is only seen in a morph, where it folds over as it moves to its place on the other map: its ocean comes as cells too.
      const cells = target ? capOceanLayer([...source, target]) : null;
      if (cells) layers.capOcean = cells;
      // Zoomed in, the indicatrices are closer together and smaller, and only those in or near the window are worked out.
      this.scene = buildScene(layers, source, target, this.tissot && { step: indicatrixStep(this.view.zoom), viewport: this.viewport }, fine ? visibleCap(source[0]!.compiled, source[0]!.screen, this.viewport) : null);
      this.sceneIsMorph = morphing;
      this.stale = false;
    }
    drawScene(this.ctx, this.scene, this.controller.t(), this.colours);
    this.paintOverlay(morphing || this.slide !== null || this.zoomTween !== null);
    if (began !== null) {
      // The first frame with a layer is not timed, as it has the layer to make ready. A quick frame is believed at once, and a slow one a quarter, as one frame can be slow by chance.
      // A frame after a rest takes nearly twice as long as the same frame in a run of them, and it is a run that is asked about.
      const took = (performance.now() - began) * (this.rested ? REST_SHARE : 1);
      if (this.fineTimed === this.layers) this.fineCost += took < this.fineCost ? took - this.fineCost : (took - this.fineCost) / 4;
      this.fineTimed = this.layers;
    }
    if (morphing || this.slide || this.zoomTween) this.request();
    if (settled || slide) this.notify();
  };

  /**
   * Draws what is over the map. The frame and the title box are drawn on every frame. The names and the degrees are fitted to a
   * map at rest, which takes a moment: they are drawn only while the map is the very one they were fitted to. When it is not, as
   * while it moves, they are left off, and they are fitted afresh once it has been still for a moment. Nothing fades.
   */
  private paintOverlay(moving: boolean): void {
    window.clearTimeout(this.overTimer);
    this.overShown = false;
    if (!overlayWanted(this.layers)) {
      this.over = null;
      this.picture = this.pictureFrom = null;
      return;
    }
    this.fetchLettering();
    this.measure ??= canvasMeasure();
    const input = this.overlayInput(moving);
    const key = moving ? null : this.overlayKey(input);
    if (key !== null && this.over?.key !== key && !lettersWanted(this.layers)) this.over = { key, overlay: buildPlateOnly(input, this.measure) };
    if (key !== null && this.over?.key === key) {
      this.overShown = true;
      drawOverlay(this.ctx, this.over.overlay, this.colours);
      return;
    }
    drawOverlay(this.ctx, buildPlateOnly(input, this.measure), this.colours);
    if (key === null) return;
    this.overTimer = window.setTimeout(() => {
      if (this.controller.tick() || this.slide || this.zoomTween || !this.measure) return;
      const now = this.overlayInput(false);
      this.over = { key: this.overlayKey(now), overlay: buildOverlay(now, this.measure, waterNow('seas', '110m'), LAND) };
      this.request();
      this.notify();
    }, LETTER_AFTER);
  }

  /** The map on screen as what is over it is worked out from. In a morph the picture, which the frame is drawn round, goes from the one the morph began with to the one it ends with. */
  private overlayInput(moving: boolean): OverlayInput {
    const member = this.controller.target() ?? this.controller.source()[0]!;
    const padding = paddingFor(this.layers);
    let picture = pictureRect(member.compiled, this.viewport, this.view, padding);
    if (this.controller.tick()) {
      const from = (this.pictureFrom ??= this.picture ?? picture);
      const t = this.controller.t();
      const mix = (a: number, b: number) => a + t * (b - a);
      picture = { x: mix(from.x, picture.x), y: mix(from.y, picture.y), width: mix(from.width, picture.width), height: mix(from.height, picture.height) };
    } else this.pictureFrom = null;
    if (!moving || !this.controller.tick()) this.picture = picture;
    return { member, state: this.state, named: this.named(), layers: this.layers, picture, scale: 1 };
  }

  /** Everything the overlay of a map at rest depends on: the map and where it is drawn, what is shown over it, and whether the typeface and the seas have come. */
  private overlayKey({ member, state, named, layers, picture }: OverlayInput): string {
    const { on } = layers;
    const { k, tx, ty } = member.screen;
    return JSON.stringify([
      state, named.name, k, tx, ty, picture,
      [on.countryNames, on.seaNames, on.degrees, on.graticule, on.frame, on.titleBox], layers.graticuleStep, layers.smallestName, layers.title, layers.subtitle, layers.corner,
      fontReady(), on.seaNames && waterNow('seas', '110m') !== null,
    ]);
  }

  /** Fetches the typeface, and the seas if they are to be named, the first time either is wanted, and draws the map again when they come. */
  private fetchLettering(): void {
    const again = () => this.request();
    if (!this.fontAsked) {
      this.fontAsked = true;
      void loadFont().then(() => {
        // If it did not come, it is asked for again the next time something is over the map.
        if (!fontReady()) this.fontAsked = false;
        else again();
      });
    }
    if (this.layers.on.seaNames && !this.seasAsked) {
      this.seasAsked = true;
      loadWater('seas', '110m').then(again, () => void (this.seasAsked = false));
    }
  }

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
