# Map Projections Round Two Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add slides, fade-free morphs, zoom, layers and colours, export, a fixed-view corner globe with projection surfaces, map-straight drawing and new projections to the map projections explorer, behind a rebuilt, text-free interface.

**Architecture:** The geometry core (`src/geo`, `src/screen`, `src/morph/scene.ts`) is kept and extended. `App` stays the single store and gains a slide animation, a view (zoom and pan), layers and a theme. The sidebar is rebuilt around a declarative table of parameter controls, and everything not about choosing a projection moves to floating controls over the map.

**Tech Stack:** TypeScript 7, Vite 8, Canvas 2D, d3-geo, d3-geo-projection, d3-geo-polygon, topojson-client, world-atlas, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-11-ideas-round-two-design.md` (and the first design, `2026-11-06-map-projections-design.md`, which it builds on).

## Global Constraints

- No new runtime dependencies. No UI framework.
- Nothing jumps, pops or cross-fades. A change of the map is a morph, a slide, or a live drag.
- Morph and slide duration 1400 ms, cubic ease-in-out (`DURATION` and `easeInOutCubic` in `src/morph/controller.ts`, to be exported).
- Tissot indicatrices and drawn shapes must be mathematically true on every map and every frame.
- Shapes are stored as longitude and latitude, never screen coordinates.
- Geometry objects handed to the cuts are replaced, never mutated (the live cut caches by object).
- Unit tests: `npx vitest run tests/<file>`; the full suite (`npm test`) takes about two minutes, so run it at the end of each stage, not each task. Browser tests: `npx playwright test e2e/<file>`. Type check: `npx tsc --noEmit`.
- E2E viewport keeps the map at 1000 × 600: with the 260 px sidebar that is `viewport: { width: 1260, height: 600 }` from Task 9 on.
- Comments follow the codebase: full sentences saying why, at the density of the surrounding file.
- Commits: `feat:` / `fix:` / `test:` / `chore:` subject in the style of `git log`, ending with `Co-Authored-By: Claude <noreply@anthropic.com>`. One commit per task. Run `npm test`, `npx tsc --noEmit` and `npm run e2e` green at the end of each stage.

## Review Focus

1. **Input during an animation.** Wheel, drag, slider and list clicks arriving mid-slide and mid-morph must leave `app.state` consistent and throw nothing. Test in Task 3.
2. **Preferences that cannot be read.** Corrupt JSON, an unknown theme id, or `localStorage` throwing must fall back to defaults silently. Test in Task 20.
3. **Resize while zoomed.** A window resize or pixel-ratio change at zoom > 1 must keep the view within its pan limits and the map drawn. Test in Task 8.
4. **A dense map-straight shape on a heavily interrupted map.** A 1000-point path drawn on Mercator must cut without throwing on Peirce, the butterfly and Goode, at rest and in a morph. Test in Task 23.
5. **An export the browser cannot allocate.** A canvas beyond the browser's limit must give a notice, not a blank file or an exception. Test in Task 28.
6. **A pinch with a drawing tool active** must zoom and place no point. Test in Task 8.

## File Structure

New files:

| File | Responsibility |
|---|---|
| `src/morph/slide.ts` | Whether two states can slide; the state between them; a timed slide |
| `src/screen/view.ts` | Zoom and pan as a transform on top of the fit |
| `src/data/detail.ts` | Coastlines and countries at 110m, 50m, 10m, loaded on demand |
| `src/data/countries.ts` | 110m countries, border mesh, a colour index per country |
| `src/layers/layers.ts` | Which layers are on, and the geometry each one draws |
| `src/layers/standardLines.ts` | Standard parallels of the map on screen |
| `src/theme/themes.ts` | Named themes, overrides, and the style they resolve to |
| `src/prefs.ts` | Reading and writing preferences in `localStorage` |
| `src/projections/controls.ts` | The sliders each definition has, as data |
| `src/projections/hemispheres.ts` | Double-hemisphere definitions |
| `src/projections/peirce.ts` | Peirce quincuncial raw projection |
| `src/projections/butterfly.ts` | Cahill butterfly raw projection |
| `src/drawing/straight.ts` | Paths that are straight, or circles that are round, on a map |
| `src/locator/camera.ts` | The corner globe's fixed, orbitable view |
| `src/locator/surface.ts` | Cylinder, cone, plane and octahedron as 3D polylines; hidden-line split |
| `src/export/svg.ts` | A scene at rest as an SVG string |
| `src/export/render.ts` | Building an export scene at a size and detail; PNG and download |
| `src/ui/tooltip.ts`, `popover.ts`, `icons.ts` | Shared UI pieces |
| `src/ui/parameters.ts` | The Parameters block |
| `src/ui/drawingToolbar.ts` | Replaces `drawingTools.ts` |
| `src/ui/zoomControl.ts`, `layersPanel.ts`, `exportPanel.ts` | Floating controls |

Rewritten: `src/ui/sidebar.ts`, `src/ui/projectionList.ts`, `src/render/locator.ts` (moves to `src/locator/locator.ts`), `index.html`, `src/style.css`.
Removed: `src/ui/orientationControls.ts`, `src/ui/drawingTools.ts`.

---

# Stage 1: Motion

### Task 1: States that slide

**Files:** Create `src/morph/slide.ts`, `tests/slide.test.ts`. Modify `src/morph/controller.ts` (export `DURATION`, `easeInOutCubic`).

**Interfaces — Produces:**
```ts
export function canSlide(a: ProjectionState, b: ProjectionState): boolean; // a.defId === b.defId
export function interpolateState(a: ProjectionState, b: ProjectionState, u: number): ProjectionState;
export class Slide {
  constructor(from: ProjectionState, to: ProjectionState, startedAt: number);
  readonly to: ProjectionState;
  /** The eased state at `now`, and whether the slide is over. At the end `state` is `to` itself. */
  at(now: number): { state: ProjectionState; done: boolean };
}
```
`interpolateState`: parameters and tilt linear in `u`. The centre goes along the great circle (`geoInterpolate`) where the definition has `latEnabled`; otherwise longitude goes the shorter way round and latitude is linear. `u <= 0` returns `a`, `u >= 1` returns `b` (the same objects). Longitude is normalised with `normaliseLon`.

- [ ] **Step 1: Failing tests** in `tests/slide.test.ts`:
```ts
const mercator = stateForStop(stopById('mercator'));
const transverse = stateForStop(stopById('transverse-mercator'));
it('slides tilt', () => expect(interpolateState(mercator, transverse, 0.5).orientation.tilt).toBeCloseTo(45));
it('takes the shorter way round', () => {
  const at = (lon: number) => ({ ...mercator, orientation: { lon, lat: 0, tilt: 0 } });
  expect(Math.abs(interpolateState(at(170), at(-170), 0.5).orientation.lon)).toBeCloseTo(180);
});
it('goes over the pole between centres on opposite meridians', () => {
  const at = (lon: number) => ({ defId: 'azimuthal-equidistant', params: {}, orientation: { lon, lat: 80, tilt: 0 } });
  expect(interpolateState(at(0), at(180), 0.5).orientation.lat).toBeCloseTo(90);
});
it('ends on the target itself', () => expect(interpolateState(mercator, transverse, 1)).toBe(transverse));
it('will not slide between definitions', () => expect(canSlide(mercator, stateForStop(stopById('mollweide')))).toBe(false));
it('is eased and timed', () => {
  const slide = new Slide(mercator, transverse, 1000);
  expect(slide.at(1000 + DURATION / 2).state.orientation.tilt).toBeCloseTo(45);
  expect(slide.at(1000 + DURATION / 4).state.orientation.tilt).toBeLessThan(22.5);
  expect(slide.at(1000 + DURATION)).toEqual({ state: transverse, done: true });
});
```
- [ ] **Step 2:** `npx vitest run tests/slide.test.ts` fails (module missing).
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Tests pass. **Step 5:** Commit `feat: states of one definition slide into each other`.

### Task 2: The app slides

**Files:** Modify `src/app.ts`. Create `e2e/slide.spec.ts`.

**Interfaces — Consumes:** Task 1. **Produces** on `App`:
```ts
get isSliding(): boolean;
/** Changes the map with motion: a slide if the definition stays, an ordinary morph if not. */
setAnimated(patch: Partial<ProjectionState>): void;
```
Behaviour:
- `select(stop)` slides when `canSlide(this.state, next)` and no ordinary morph is running; otherwise morphs as now.
- During a slide `this.state` is the in-between state, updated and notified every frame, so controls move with it. `live` returns the in-between map, so drags and clicks work.
- `setLive` during a slide ends the slide and applies the patch to the in-between state. During an ordinary morph it is still ignored.
- `select` or `setAnimated` during a slide: the in-between state is the start. Same definition: a new slide. Other definition: `controller.jumpTo(memberOf(inBetween))` then `morphTo`.
- `setAnimated` with nothing changed does nothing.

- [ ] **Step 1: Failing e2e** in `e2e/slide.spec.ts` (helpers from `e2e/support.ts`; add `pickStop(page, id)` there if absent):
  - *Mercator to Transverse Mercator is a slide:* pick `mercator`, wait for rest, pick `transverse-mercator`, wait 600 ms; `window.__app.isSliding === true`, `isMorphing === false`, `0 < state.orientation.tilt < 90`. After 1600 ms tilt is 90 and `isSliding` false.
  - *Mercator to Mollweide is a morph:* `isMorphing === true`, `isSliding === false`.
  - *A slider takes over a slide:* start the slide, at 400 ms call `__app.setLive({ orientation: { ...__app.state.orientation } })`; `isSliding` is false and tilt stays where it was (strictly between 0 and 90).
  - *Redirect mid-slide:* start the slide, at 400 ms pick `mollweide`; `isMorphing` true; at rest the state is Mollweide's.
  - *(Review Focus 1)* *Input storms throw nothing:* collect `pageerror`; during a slide and during a morph, fire 20 wheel events, a 10-step drag, and three list clicks 50 ms apart; no page errors, and at rest `matchStop` of the state is the last stop clicked.
- [ ] **Step 2:** Run; fails on `isSliding`.
- [ ] **Step 3:** Implement in `App`: a `private slide: Slide | null`; the frame loop advances it via `setLive`'s internals and requests the next frame.
- [ ] **Step 4:** `npx playwright test e2e/slide.spec.ts` passes. **Step 5:** Commit `feat: related maps slide between each other, every frame a real map`.

### Task 3: Resets, typed values and the conic switch move the map

**Files:** Modify `src/ui/slider.ts`, `src/ui/orientationControls.ts`, `src/ui/sidebar.ts`, `tests/slider.test.ts`, `e2e/slide.spec.ts`.

**Interfaces — Produces:** `SliderOptions.onSet?(v: number): void` — called for the reset button and a committed number box; defaults to `onInput`. The range input keeps calling `onInput`.

- [ ] **Step 1: Failing tests.** e2e: *reset all slides* (drag the map, click reset all, at 500 ms `isSliding`); *a typed longitude slides*; *a slider's own reset slides*; *the conic Preserves switch morphs* (`isMorphing` true, never an instant change of `defId` at rest).
- [ ] **Step 2:** Run; fail.
- [ ] **Step 3:** Wire `onSet` to `app.setAnimated` in the orientation controls and the family sliders; the conic radios call `app.setAnimated({ defId })`.
- [ ] **Step 4:** Pass. **Step 5:** Commit `feat: resets, typed values and the conic switch move the map instead of jumping`.

### Task 4: Geometry does not fade

**Files:** Modify `src/morph/scene.ts`, `src/render/draw.ts`, `tests/draw.test.ts`, `tests/scene.test.ts`, `e2e/render.spec.ts`.

**Interfaces — Produces:** `ScenePiece` loses `alphaSrc`, `alphaDst`, `hidden`; gains `leaves?: boolean` (a line that the target cannot show) and `arrives?: boolean` (a line no source can show). `alphaOf` no longer takes pieces.

Rules:
- Every piece that some end shows is drawn at full strength for the whole morph.
- A line with `leaves` is stroked at `width * min(1, (1 - t) / 0.05)`; one with `arrives` at `width * min(1, t / 0.05)`. This is only so that a line folded onto a boundary leaves no trace there on the frames next to rest. Fills need nothing.

- [ ] **Step 1: Failing tests.**
  - `tests/draw.test.ts`: with a recording context, a morph scene globe → gnomonic drawn at `t = 0.5` never sets `globalAlpha` to anything but 1 while filling or stroking pieces.
  - `e2e/render.spec.ts`: *no trace on settling*: morph globe → gnomonic; grab the canvas one frame before the end (`t > 0.999`, via a test hook `__app.debugT()`) and at rest; the count of pixels differing by more than 8/255 is under 0.05 % of the canvas.
- [ ] **Step 2:** Run; fail. Delete or rewrite existing tests that assert the alpha curves.
- [ ] **Step 3:** Implement; remove `hiding` and the piece half of `alphaOf`.
- [ ] **Step 4:** Pass, with `tests/scene.test.ts` and `tests/oceanCover.test.ts` green. **Step 5:** Commit `feat: nothing fades in a morph; what a map cannot show folds onto its edge at full strength`.

### Task 5: Indicatrices do not fade

**Files:** Modify `src/tissot/rest.ts`, `src/tissot/indicatrix.ts`, `src/morph/scene.ts`, `src/render/draw.ts`, `tests/indicatrix.test.ts`, `tests/indicatrixMargin.test.ts`, `tests/scene.test.ts`, `e2e/tissot.spec.ts`, `e2e/tissotBoundary.spec.ts`, `e2e/tissotHarness.ts`.

The model: mid-morph, the map is the weighted blend of its members piece by piece, so the image of a small circle is the circle split along every member's seam that crosses it, each part carried by the blend of what each member does with that side.

**Interfaces — Produces:**
```ts
// rest.ts
export type RestImage = { pos: Pair; mat: Mat2; alpha: number; own: boolean; cuts: Cut[] };
/** What a member does with the indicatrix at `p` in a morph: every side of every seam near it, each a full image with the cuts that bound its side. */
export function morphImages(m: Member, p: LonLat): RestImage[];
/** The derivative of the map with what it cannot show folded onto the cap's edge: rank one, along the edge. */
export function foldedJacobian(m: Member, p: LonLat): Mat2;
// scene.ts
export type SceneIndicatrix = { srcPos: Pair; dstPos: Pair; srcMat: Mat2; dstMat: Mat2; alphaSrc: number; alphaDst: number; behind: boolean; cuts: Cut[] };
```
Rules:
- `morphImages` for a member that shows `p` (or shows it faintly past a large cap's edge, as at rest): the own image, cut along each nearby seam or lobe edge with `cutAt` (for every edge, not only `between` ones), and one image per far side with the complementary cut. Alpha is the rest alpha (`boundaryFade`).
- For a member that cannot show `p` at all: one image at `positionOn(m, p)` with `foldedJacobian`, no cuts, and alpha undefined (it takes the other end's).
- A scene indicatrix is one choice of image per member (sources and target), for every combination whose cuts are not contradictory. Position and matrix are the weighted sums; `cuts` is the union. `alphaSrc` and `alphaDst` are the ends' rest alphas, blended linearly in `t`. 
- An indicatrix is a translucent fill with no outline (owner's request, 2026-11-11). `drawIndicatrices` clips the unit disc by every cut and fills it. The fill is a new palette colour `indicatrix`, the accent at 0.34 alpha (0.4 in the dark palette), stronger than a drawing's fill since no outline carries it; `Style.indicatrixWidth` goes. A flattened indicatrix has no area, so it needs no taper.
- The per-member outline clip (`clip`, `clipKey`, `shownBy` on pieces) goes; the clip to the whole outline stays. A map at rest keeps `restImages` as it is, with `cuts` as an array.
- The soft edge at rest (`boundaryFade`, `FADE_BAND`) is unchanged.

- [ ] **Step 1: Failing tests.**
  - `foldedJacobian` on gnomonic at a point 30° past the cap's edge has rank one: `singularValues(mat)[1] < 1e-6 * singularValues(mat)[0]`.
  - *The blend is the true derivative across a seam:* morph equirectangular (centre 0) → equirectangular (centre 90) at `t = 0.3`, point `[178, 20]`: every scene indicatrix matrix equals a numeric derivative of the blended position of points on its own side of both seams, to 1e-3 relative (extend the existing mid-morph test in `tests/scene.test.ts`).
  - *Halves make a whole:* for that case the cut regions of the scene indicatrices partition the unit disc (sample 500 points; each lies in exactly one).
  - *Ends match rest:* at `t = 0` and `t = 1`, the drawn pixels equal the map at rest (existing harness in `e2e/tissotHarness.ts`, tolerance as there).
  - `tests/draw.test.ts`: drawing a morph's indicatrices at `t = 0.5`, globe → Mercator, sets `globalAlpha` only to values the linear blend of rest alphas gives; no cubic curve.
- [ ] **Step 2:** Run; fail. Rewrite existing fade-curve assertions.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Pass. **Step 5:** Commit `feat: indicatrices flatten onto a map's edge and split along seams instead of fading`.
- [ ] **Step 6 (stage gate):** `npm test`, `npx tsc --noEmit`, `npm run e2e` all green.

---

# Stage 2: Layout and zoom

### Task 6: Tooltips, popovers and icons

**Files:** Create `src/ui/tooltip.ts`, `src/ui/popover.ts`, `src/ui/icons.ts`, `e2e/tooltip.spec.ts`. Modify `src/style.css`.

**Interfaces — Produces:**
```ts
/** Describes a control: shown after 350 ms of hover or at once on keyboard focus; hidden on leave, blur, press and Escape. Sets `aria-description`. */
export function tip(target: HTMLElement, text: string, shortcut?: string): void;
/** A panel anchored to a button: toggled by it, closed by Escape, a press outside, or `close()`. Sets `aria-expanded`; returns focus to the button on close. */
export function popover(button: HTMLButtonElement, panel: HTMLElement, side: 'below-left' | 'below-right'): { close(): void; isOpen(): boolean };
/** Inline SVG, 16 px, `currentColor`. */
export function icon(name: 'line' | 'polygon' | 'circle' | 'follow-map' | 'follow-globe' | 'finish' | 'undo' | 'clear' | 'layers' | 'export' | 'zoom-in' | 'zoom-out' | 'fit' | 'surface' | 'collapse' | 'reset'): SVGElement;
```
One `.tooltip` element (`role="tooltip"`) is shared and kept inside the window.

- [ ] **Step 1: Failing e2e** on a scratch button added by the test: hover 400 ms shows the text and shortcut; Tab focus shows at once; Escape hides; the tooltip's box lies inside the viewport when the button is at a window edge. Popover: click opens, Escape closes and refocuses the button, outside press closes.
- [ ] **Steps 2–4:** fail, implement, pass. **Step 5:** Commit `feat: tooltips, popovers and icons of the app's own`.

### Task 7: View transform

**Files:** Create `src/screen/view.ts`, `tests/view.test.ts`.

**Interfaces — Produces:**
```ts
export type View = { zoom: number; panX: number; panY: number }; // pan in CSS pixels
export const FIT: View; // { zoom: 1, panX: 0, panY: 0 }
export const MAX_ZOOM = 32;
/** The fit, zoomed about the middle of the viewport and then moved by the pan. */
export function applyView(fit: ScreenTransform, view: View, v: Viewport): ScreenTransform;
/** Zooms by `factor`, keeping the screen point `at` where it is. Zoom is held to [1, MAX_ZOOM] and the pan to its limits. */
export function zoomAbout(view: View, v: Viewport, at: [number, number], factor: number): View;
export function panBy(view: View, v: Viewport, dx: number, dy: number): View;
/** |panX| <= (zoom - 1) * width / 2, and the same for y: the zoomed window-sized frame always covers the window. */
export function clampView(view: View, v: Viewport): View;
```

- [ ] **Step 1: Failing tests:** `zoomAbout` keeps a point fixed (project a point with `applyView` before and after; equal to 1e-9); zoom clamps at 1 and 32; at zoom 1 the pan is 0; `panBy` clamps; `applyView(fit, FIT, v)` equals `fit`.
- [ ] **Steps 2–4.** **Step 5:** Commit `feat: zoom and pan as a view over the fit`.

### Task 8: Zoom in the app

**Files:** Modify `src/app.ts`, `src/ui/mapPointer.ts`, `src/tissot/indicatrix.ts`, `src/morph/scene.ts`, `src/render/draw.ts`, `src/tissot/rest.ts`. Create `src/data/detail.ts`, `src/ui/zoomControl.ts`, `e2e/zoom.spec.ts`.

**Interfaces — Consumes:** Task 7. **Produces:**
```ts
// App
view: View;
setView(view: View): void;              // at once; ignored during an ordinary morph
zoomBy(factor: number, at?: Pair): void; // buttons and keys: a 150 ms tween about `at`, default the middle
// indicatrix.ts
export function indicatrixStep(zoom: number): 30 | 15 | 10 | 5; // < 2, < 4, < 8, else
export function indicatrixCentres(step?: number): LonLat[];
// Scene gains `indicatrixRadius: number` (radians): step / 6, so 5° at 30°. draw.ts and rest.ts read it instead of INDICATRIX_RADIUS.
// detail.ts
export type Detail = '110m' | '50m' | '10m';
export function loadDetail(level: Detail): Promise<{ land: GeoJSON.GeoJsonObject; coast: GeoJSON.GeoJsonObject; countries: GeoJSON.FeatureCollection; topology: unknown }>; // dynamic import, cached
// zoomControl.ts
export function createZoomControl(app: App): HTMLElement; // +, −, fit; tips with shortcuts
```
Behaviour:
- `screenFor` applies the view after the fit; the fit cache key includes the view.
- Wheel: `factor = exp(-deltaY * (ctrlKey ? 0.01 : 0.0015))` about the cursor; `preventDefault`.
- Shift-drag and middle-button drag pan. Two pointers pinch and pan; a second pointer cancels any click or map drag of the first.
- Keys `+`/`=`, `-`, `0` (not while typing).
- `select` while zoomed: the place at the middle of the window stays in the middle if the target covers it (set the target member's view so); otherwise the target's view is `FIT`. A slide keeps the view as it is.
- At rest for 250 ms with zoom ≥ 3: rebuild the scene with 50m land and coast. Any change returns to 110m first.

- [ ] **Step 1: Failing e2e** in `e2e/zoom.spec.ts`:
  - wheel over a point: `__app.view.zoom > 1` and the land under the cursor (`screenToLonLat`) is unchanged to 0.01°;
  - a plain drag while zoomed changes `state.orientation`, not `view.panX`; a Shift-drag does the reverse;
  - the pan cannot exceed its limit (drag far; `|panX| <= (zoom - 1) * 500`);
  - `0` returns to `FIT`;
  - switching Mercator → Mollweide at zoom 4 over Europe keeps `[10, 50]` within 2 px of the middle at rest; switching to gnomonic centred on the antipode returns to fit;
  - *(Review Focus 3)* at zoom 8 panned to a limit, `page.setViewportSize` smaller: the view is within its new limits, the canvas is not blank, no page error;
  - *(Review Focus 6)* with the line tool active, a two-finger pinch (dispatch two `pointerdown`/`pointermove`/`pointerup` of `pointerType: 'touch'`) changes the zoom and leaves `__drawing.draft` null;
  - with Tissot on, the number of indicatrices in the scene at zoom 8 exceeds that at zoom 1, and their radius is smaller.
- [ ] **Steps 2–4.** **Step 5:** Commit `feat: zoom by wheel, pinch, buttons and keys`.

### Task 9: The new layout

**Files:** Rewrite `index.html`, `src/style.css`, `src/ui/sidebar.ts`, `src/ui/projectionList.ts`, `src/main.ts`. Create `src/projections/controls.ts`, `src/ui/parameters.ts`, `src/ui/drawingToolbar.ts`. Delete `src/ui/orientationControls.ts`, `src/ui/drawingTools.ts`. Modify `src/projections/types.ts`, `src/projections/catalog.ts`, `playwright.config.ts`, `e2e/support.ts` and every e2e spec that names a removed class.

**Interfaces — Produces:**
```ts
// types.ts
export type Preserves = 'conformal' | 'equal-area' | 'equidistant' | 'compromise' | 'none';
// Stop gains `preserves: Preserves`. `note` stays and becomes the tooltip.
// controls.ts
export interface ParamControl { key: string; label: string; tip: string; min: number; max: number; step: number; stops?: number[]; snap?: number; format?(v: number): string; parse?(raw: string): number | null; valueText?(v: number): string }
export function controlsFor(defId: string): ParamControl[]; // the viewpoint, the two cylindrical sliders, the two conic parallels, moved from sidebar.ts
export function nameOf(state: ProjectionState): string; // the stop's name; 'Custom'; or '<name> (cone limit)' when reached from a conic
// parameters.ts
export function createParameters(app: App): HTMLElement;
// drawingToolbar.ts
export function createDrawingToolbar(app: App, canvas: HTMLCanvasElement): { el: HTMLElement; model: DrawingModel };
```
DOM (ids are the contract for e2e and CSS):
```html
<div id="app">
  <aside id="sidebar"> <input id="filter" type="search"> <div class="projection-list"></div> <section id="parameters"></section> </aside>
  <main id="stage">
    <canvas id="map"></canvas>
    <div id="tools" class="floating top-left"></div>
    <div id="actions" class="floating top-right"></div>
    <div id="zoom" class="floating bottom-left"></div>
    <div id="locator"></div>
    <p id="notice" role="status"></p>
  </main>
</div>
```
Rules:
- Sidebar 260 px. The list scrolls; `#parameters` is pinned at the bottom of the sidebar and never scrolls out.
- A list row: the name, a tag for `preserves` (text, not colour alone), `tip(button, stop.note)`. The filter matches name and tag, case-insensitive; a family with no match is hidden. All families are open; there is no accordion.
- `#parameters`: heading `nameOf(state)`; a slider for each `controlsFor(defId)`; the conic conformal / equal-area switch on conic definitions; longitude always; latitude where `latEnabled`; tilt where `tiltEnabled`; reset all. A control that does not apply is not in the DOM.
- No `.hint`, `.note`, `.limits`, Tissot note or drawing hint anywhere. The refused-point notice shows in `#notice`.
- Drawing toolbar: icon buttons with tips and shortcuts `L`, `P`, `C`; finish, undo, clear. Tissot gets a temporary icon button in `#actions` (key `T`) until the Layers panel (Task 21).
- Narrow screens (max-width 720 px): map above, sidebar below, floating controls stay on the map.
- `playwright.config.ts`: `viewport: { width: 1260, height: 600 }`.

- [ ] **Step 1: Failing e2e** in a new `e2e/layout.spec.ts`:
  - no element with class `hint` or `note` exists; `#sidebar` text contains none of: "Choose a tool", "Each ellipse", "At its limits";
  - on Mollweide, `#parameters` holds exactly Longitude, Latitude, Tilt; on Albers: First parallel, Second parallel, the Preserves switch, Longitude; on the globe: Longitude, Latitude (the view distance arrives in Task 12);
  - typing "equal" in `#filter` leaves only stops tagged equal-area or named so;
  - hovering a stop shows its note in the tooltip;
  - at 1280 × 720, `#parameters` is fully within the viewport for every stop;
  - keys `L`, `P`, `C`, `T` toggle their tools; not while the filter has focus;
  - the map's canvas is 1000 × 600 CSS pixels at the configured viewport.
- [ ] **Step 2:** Run; fail.
- [ ] **Step 3:** Implement. Update `e2e/support.ts` helpers and the selectors in the other specs; behaviour assertions in them stay as they are.
- [ ] **Step 4:** `npm run e2e` green. **Step 5:** Commit `feat: a sidebar for choosing and shaping the projection, with everything else on the map`.
- [ ] **Step 6 (stage gate):** full suites and type check green.

---

# Stage 3: Projections

### Task 10: A lobe has an identity

**Files:** Modify `src/projections/types.ts`, `raws.ts`, `catalog.ts`, `src/screen/screen.ts`, `src/geo/cut.ts`, `src/geo/frontCut.ts`, `src/tissot/rest.ts`, `src/morph/scene.ts`, tests that name `centralLon`.

**Interfaces — Produces:**
```ts
export type Lobe = { id: number; lonMin: number; lonMax: number; latMin: number; latMax: number };
export type Seam = { kind: 'none' } | { kind: 'antimeridian' } | { kind: 'lobes'; lobes: Lobe[]; /** The map is smooth across the equator, so nothing there is cut or mirrored. */ smoothEquator: boolean };
/** `lobe` is the lobe's id, passed as it is. */
export type RawFn = (lambda: number, phi: number, lobe?: number) => [number, number];
```
Goode's ids are its central longitudes in degrees; `goodeRaw` converts to radians itself; `smoothEquator: true`. Two rectangles may share an id (one lobe that wraps the antimeridian). `edgesOf` skips an edge whose neighbour has the lobe's own id.

- [ ] **Step 1:** Pure refactor: change the types, follow the compiler. Add one test to `tests/catalog.test.ts`: two rectangles sharing an id give no mirrored copy across their shared edge (`restImages` length 1 for a point 2° from it, with a synthetic two-rectangle definition).
- [ ] **Step 2:** `npx vitest run` green (all files; behaviour is unchanged for Goode). **Step 3:** Commit `refactor: a lobe is known by an id of its own`.

### Task 11: Indicatrices across any lobe edge

**Files:** Modify `src/tissot/rest.ts`, `tests/indicatrix.test.ts`.

Edges become great-circle arcs in the frame: a meridian side of a lobe, or its side along the equator when the seam is not `smoothEquator` and another lobe lies across it.

**Interfaces — Produces** (internal to `rest.ts`): `Edge = { normal: Vector; from: LonLat; to: LonLat; lobe: number; shift: number; between: boolean }`, with `distanceTo` and `cutAt` working from `normal`.

- [ ] **Step 1: Failing test** with a synthetic two-lobe definition split at the equator, each half an equirectangular map with a different vertical scale (a crease): at `[10, 2]`, `restImages` returns two images whose cuts are complementary (`a.cuts[0] = -b.cuts[0]` componentwise) and whose matrices are the two halves' own.
- [ ] **Steps 2–4.** Goode's tests stay green. **Step 5:** Commit `feat: an indicatrix on a crease or cut along the equator is drawn as its two halves`.

### Task 12: The globe's view distance; orthographic goes

**Files:** Modify `src/projections/raws.ts`, `catalog.ts`, `compile.ts`, `controls.ts`, `tests/catalog.test.ts`, `e2e/projections.spec.ts`.

**Interfaces — Produces:**
```ts
/** The globe seen from `D` Earth radii from its centre; Infinity is orthographic. Scale 1 at the centre. */
export function nearPerspectiveRaw(D: number): RawFn; // k = (D - 1) / (D - cos c)
```
- Globe: `defaultParams: { d: 0 }`, where the slider axis is `d = 1 / D`, from 0 (∞) to `1 / 1.1`. Its cap is `cap(ANTIPODE, 180 - acos(d) in degrees, 'behind')`.
- Control: label "View distance", stops at `0`, `1 / 6.6`, `0.5`; format `∞` or `${D}×` to two significant figures; parse accepts `inf`, `∞`, a number of radii with or without `×`; tip "The eye's distance from the Earth's centre, in Earth radii".
- The `orthographic` stop is removed. `matchStop` on `perspective` with `x >= 1 - 0.001` returns the globe stop (generalise `conicLimit` into a limit lookup; `nameOf` says "Globe (slider limit)").

- [ ] **Step 1: Failing tests:** `nearPerspectiveRaw(Infinity)` equals `geoOrthographicRaw` at 100 random points; at `D = 2` the limb is at `c = 60°` and every point with `c > 60°` projects inside the limb's radius; the globe at `d = 0.5` shows `[59, 0]` and not `[61, 0]` (`isCovered` and a 'behind' check); `stops` has no `orthographic`; `matchStop({ defId: 'perspective', params: { x: 1 } })` is the globe. e2e: dragging the globe at `d = 0.5` keeps the land under the cursor; globe (`d = 0.5`) → Mollweide morphs with no page error and no streak (the existing streak check).
- [ ] **Steps 2–4.** **Step 5:** Commit `feat: the globe has a view distance, and takes orthographic's place`.

### Task 13: Plain additions and the Bonne slider

**Files:** Modify `src/projections/catalog.ts`, `controls.ts`, `d3-geo-projection.d.ts`, `tests/catalog.test.ts`.

Stops (id, name, family, definition, preserves):
- `natural-earth`, Natural Earth, compromise, `geoNaturalEarth1Raw` (d3-geo), compromise
- `van-der-grinten`, Van der Grinten, compromise, `geoVanDerGrintenRaw`, compromise
- `miller`, Miller, cylindrical, `geoMillerRaw`, compromise (the cylindrical sliders do not apply)
- `eckert4`, Eckert IV, equal-area, `geoEckert4Raw`, equal-area
- definition `bonne`, `defaultParams: { phi1: 45 }`, `raw: (p) => geoBonneRaw(p.phi1 * rad)`; stops `sinusoidal` (`phi1: 0`, replacing the plain definition), `bonne` (45), `werner` (90); control "Standard parallel" 0–90, stops `[0, 45, 90]`, snap 1.5.

Each new stop gets a one-sentence `note` in the voice of the existing ones (what it keeps, what it gives up).

- [ ] **Step 1: Failing tests** (extend the per-stop loops in `tests/catalog.test.ts`): every stop projects 500 random covered points to finite values; Eckert IV and Bonne at 0, 45 and 90 have constant areal scale (determinant of `jacobian` over the grid within 0.5 % of its median, away from caps); Bonne at 0 equals `geoSinusoidalRaw`.
- [ ] **Steps 2–4.** **Step 5:** Commit `feat: Natural Earth, Van der Grinten, Miller, Eckert IV, and Bonne from sinusoidal to Werner`.

### Task 14: Double hemispheres

**Files:** Create `src/projections/hemispheres.ts`, `tests/hemispheres.test.ts`. Modify `catalog.ts`.

**Interfaces — Produces:**
```ts
/** Two hemispheres side by side, each drawn by `hemisphere` about its own middle, touching at the frame's origin. */
export function hemispheresDef(id: string, hemisphere: RawFn): ProjectionDef;
```
Lobes `{ id: -90, lon -180..0 }` and `{ id: 90, lon 0..180 }`, full latitude, `smoothEquator: true`. `raw(λ, φ, lobe) = hemisphere(λ - lobe°, φ) + [sign(lobe) * R, 0]` with `R = hemisphere(π/2, 0)[0]`. Caps `bothPoles(0.1)`. Default orientation `{ lon: -20, lat: 0, tilt: 0 }` (the Old and New World split). Family `hemispheres`, named "Double hemisphere".

Stops: `nicolosi` (Nicolosi globular, `geoNicolosiRaw`, compromise), `stereographic-hemispheres` (`geoStereographicRaw`, conformal), `equal-area-hemispheres` (`geoAzimuthalEqualAreaRaw`, equal-area).

- [ ] **Step 1: Failing tests:** frame points `[±90, 0]` land at `[±R, 0]`; the two discs touch only at the origin (outline bounding box is `4R × 2R`); stereographic hemispheres are conformal and the equal-area ones equal-area on the indicatrix grid; a point 2° from the frame's prime meridian has a mirrored indicatrix copy.
- [ ] **Steps 2–4.** **Step 5:** Commit `feat: double-hemisphere maps: Nicolosi globular, stereographic and equal-area`.

### Task 15: Peirce quincuncial

**Files:** Create `src/projections/peirce.ts`, `tests/peirce.test.ts`. Modify `catalog.ts`, `types.ts`, `src/screen/screen.ts`.

**Interfaces — Produces:**
```ts
export const peirceRaw: RawFn;
export const peirceLobes: Lobe[];
// ProjectionDef gains `turn?: number`: a turn of the screen (degrees) on top of the tilt compensation.
```
Construction:
- The frame's north pole is the middle of the map. Lobes: north `{ id: 0, lon -180..180, lat 0..90 }`; south quadrants `{ id: 1, -135..-45 }`, `{ id: 2, -45..45 }`, `{ id: 3, 45..135 }`, and `{ id: 4 }` as two rectangles `135..180` and `-180..-135`; all `lat -90..0`. `smoothEquator: true`.
- `north(λ, φ)`: `geoGuyouRaw` of the point turned so the pole sits at Guyou's centre, then turned 45°, as `d3-geo-projection/src/quincuncial/index.js` does for its front hemisphere; aligned so that the four singular points are at frame longitudes ±45 and ±135 on the equator.
- A southern lobe centred on longitude `λc`: `north(λ, -φ)` reflected in the line through `M = north(λc, 0)` at right angles to `M`. The north lobe at `φ < 0` uses the reflection for the quadrant that holds `λ`. This is the continuation that derivatives and mirrored copies need.
- Caps: `[cap(SOUTH_POLE, 0.1)]` only. `turn: 45`, so the outer square is upright. `tiltEnabled` and `latEnabled` true.
- `compensation` in `screen.ts` adds `def.turn`.
- Stop `peirce`, "Peirce quincuncial", family `polyhedral` (named "Interrupted and polyhedral"), conformal. Goode moves to this family.

- [ ] **Step 1: Failing tests:**
  - the images of frame `[±45, 0]` and `[±135, 0]` are the corners of a square centred on the origin; those of `[0, 0]`, `[±90, 0]`, `[180, 0]` are its edge midpoints;
  - continuity across the equator: `|raw(λ, 1e-6, 0) - raw(λ, -1e-6, k)| < 1e-5` for λ in each quadrant `k`;
  - conformal: the axis ratio of `jacobian` is within 1e-3 of 1 at 200 random points at least 3° from the four singular points, in every lobe;
  - the fitted outline is a square with upright sides (bounding box aspect 1 ± 1e-3; the south pole's four images are its corners);
  - `screenToLonLat(projectPoint(p)) ≈ p` for 200 random points;
  - `cutGeometry(LAND, [peirce])` and `cutFront(LAND, peirce)` conserve area to the tolerances in `tests/cut.test.ts`.
- [ ] **Steps 2–4.** **Step 5:** Commit `feat: Peirce quincuncial`.

### Task 16: Cahill butterfly

**Files:** Create `src/projections/butterfly.ts`, `tests/butterfly.test.ts`. Modify `catalog.ts`.

**Interfaces — Produces:** `export const butterflyRaw: RawFn; export const butterflyLobes: Lobe[];`

Construction:
- Eight octants. North ids 1–4 for longitudes `-180..-90`, `-90..0`, `0..90`, `90..180`, `lat 0..90`; south ids 5–8 the same longitudes, `lat -90..0`. `smoothEquator: false`.
- Each face is the gnomonic projection about its own centre (the octant's middle longitude, latitude ±asin(1/√3)), giving an equilateral triangle, then placed rigidly: the four north faces fan about the north pole's image, 60° each, 240° in all, symmetric about the downward vertical; each south face is its north face's mirror image in their shared equator edge.
- Caps `bothPoles(0.1)`. Stop `butterfly`, "Cahill butterfly", family `polyhedral`, preserves `none`. Default centre chosen so no continent but Antarctica is cut (start from `lon: -20` and adjust by eye).

- [ ] **Step 1: Failing tests:**
  - the north pole has one image under all four north formulas; a point on the equator has one image under its north and south formulas; a point on meridian -90, 0 or 90 north of the equator has one image under both neighbours (the joined creases), and one on ±180 has two (the gap);
  - three points of a great circle inside one octant are collinear on screen to 1e-9;
  - the faces do not overlap: 2000 random points give 2000 images no two of which coincide within 1e-6 unless the points do;
  - an indicatrix at `[30, 1]` is two half-ellipses with complementary cuts (Task 11);
  - cuts conserve area, as for Peirce; round trip through `screenToLonLat`.
- [ ] **Steps 2–4.** **Step 5:** Commit `feat: Cahill butterfly`.

### Task 17: Every pair still morphs

**Files:** Modify `e2e/projections.spec.ts`, `tests/scene.test.ts`.

- [ ] **Step 1:** Extend the pairwise morph checks (no streak, no page error, area conserved in `cutGeometry` for the pair) to every new stop against: globe, gnomonic, Mercator, Albers, Mollweide, Goode, Peirce, butterfly, Nicolosi.
- [ ] **Step 2:** Run. Where a cut fails its area check, fix in `src/geo/cut.ts` the way earlier fixes did (an `ATTEMPTS` entry or a pull), with a regression test in `tests/cut.test.ts` naming the pair.
- [ ] **Step 3:** Measure a morph's scene build for butterfly ↔ Peirce in the browser; if over 400 ms, note it in the commit and cut the eight lobes of one map in a single pass where they share edges.
- [ ] **Step 4:** Commit `test: every pair of projections morphs, the new ones included`.
- [ ] **Step 5 (stage gate):** full suites and type check green.

---

# Stage 4: Layers and colours

### Task 18: Layer model and data

**Files:** Create `src/layers/layers.ts`, `src/layers/standardLines.ts`, `src/data/countries.ts`, `tests/layers.test.ts`. Modify `src/app.ts`, `src/render/draw.ts`, `src/render/style.ts`.

**Interfaces — Produces:**
```ts
export type LayerId = 'land' | 'coast' | 'graticule' | 'borders' | 'political' | 'tissot' | 'standard' | 'reference' | 'drawings';
export interface LayerState { on: Record<LayerId, boolean>; graticuleStep: 10 | 15 | 30 }
export const DEFAULT_LAYERS: LayerState; // land, coast, graticule, drawings on
/** The scene layers to cut, by name, in no particular order. Objects are stable between calls unless their content changed. */
export function sceneLayers(state: LayerState, members: CompiledProjection[], drawings: GeoJSON.GeometryCollection, data?: DetailData): Record<string, GeoJSON.GeoJsonObject>;
/** What is drawn, bottom to top; canvas and SVG both follow it. */
export const DRAW_ORDER: { layer: string; fill?: StyleKey; stroke?: StyleKey; width?: WidthKey }[];
// standardLines.ts
/** The parallels of true scale, as lines on the Earth, or null where the map has none. The same object for the same map. */
export function standardLines(c: CompiledProjection): GeoJSON.MultiLineString | null;
export function hasStandardLines(defId: string): boolean; // conic and cylindrical definitions
// countries.ts
export const BORDERS: GeoJSON.MultiLineString;       // interior borders only
export const POLITICAL: GeoJSON.GeometryCollection[]; // five collections, one per colour; neighbours never share one
export function colourIndex(topology: unknown): number[]; // greedy over topojson `neighbors`, at most 5 colours
// App
layers: LayerState; setLayer(id: LayerId, on: boolean): void; setGraticuleStep(step: 10 | 15 | 30): void;
// `app.tissot` and `setTissot` become views of `layers.on.tissot`.
```
Rules:
- Scene layer names: `ocean`, `land`, `political0`…`political4`, `graticule`, `reference`, `borders`, `coast`, `standard`, `drawings`, `capOcean`. With political on, `land` is not drawn.
- Standard lines: a conic's two parallels; a cylindrical map's ±`phi0` (one line at 0); in the map's own frame, so they tilt with it. In an ordinary morph the sources' lines are marked `leaves` and the target's `arrives` (Task 4), tapering over the whole morph (`1 - t` and `t`), since they describe one map only.
- Reference circles: the equator, ±23.44°, ±66.56°.
- `drawGroup` loops over `DRAW_ORDER` instead of naming layers.

- [ ] **Step 1: Failing tests:** `colourIndex` on the 110m topology uses at most 5 colours and no two neighbours share one; `standardLines` for Albers lies at frame latitudes 29.5 and 45.5 (all points, to 1e-6) and is the same object on a second call with an equal state; null for Mollweide; with political on, `sceneLayers` has `political0..4` and `DRAW_ORDER` skips `land`; `BORDERS` has no segment of a coastline (its total length is under the coast's).
- [ ] **Steps 2–4.** e2e: with borders and political on, dragging Mercator holds a frame time under 20 ms median over 60 frames (the existing quality check's method in `e2e/quality.spec.ts`). **Step 5:** Commit `feat: layers: borders, political colours, standard lines and reference circles`.

### Task 19: Themes

**Files:** Create `src/theme/themes.ts`. Modify `src/theme/palette.ts`, `src/render/style.ts`, `src/app.ts`, `vite.config.ts`, `tests/palette.test.ts`.

**Interfaces — Produces:**
```ts
// Palette gains: borders, standard, reference, political: [string, string, string, string, string]
export type ThemeId = 'auto' | 'light' | 'dark' | 'atlas' | 'blueprint' | 'print';
export type ColourKey = 'ocean' | 'land' | 'coast' | 'graticule' | 'borders' | 'accent' | 'paper';
export type Overrides = Partial<Record<ColourKey, string>>;
export const THEME_NAMES: Record<ThemeId, string>;
/** The palette a theme gives under a system scheme, with overrides laid over it. `accentFill` follows an overridden accent. */
export function resolvePalette(theme: ThemeId, overrides: Overrides, system: Scheme): Palette;
/** Whether the page's own chrome is light or dark under a theme. */
export function chromeScheme(theme: ThemeId, system: Scheme): Scheme;
// App
theme: ThemeId; overrides: Overrides; setTheme(id: ThemeId): void; setOverride(key: ColourKey, colour: string | null): void;
```
`auto` is today's `LIGHT`/`DARK` by system scheme; `light` and `dark` pin them. Atlas: pale blue sea, pastel political colours, light chrome. Blueprint: deep blue sea, white lines, dark chrome. Print: white paper and sea, black coast, mid-grey graticule, one red accent, light chrome. The chrome follows `chromeScheme` through a `data-scheme` attribute on `<html>` that the palette CSS honours over the media query.

- [ ] **Step 1: Failing tests** (extend `tests/palette.test.ts`): for every theme and scheme, accent on land and on sea ≥ 3:1, coast on sea ≥ 1.5:1, the five political colours pairwise distinguishable (ΔE over 10) and each ≥ 3:1 against `borders`; `resolvePalette` with an overridden accent gives an `accentFill` of the same hue; an override of `null` restores the theme's colour.
- [ ] **Steps 2–4.** **Step 5:** Commit `feat: themes and colour overrides`.

### Task 20: Preferences

**Files:** Create `src/prefs.ts`, `tests/prefs.test.ts`. Modify `src/app.ts`, `src/main.ts`.

**Interfaces — Produces:**
```ts
export interface Prefs { theme: ThemeId; overrides: Overrides; layers: LayerState; locator: { surface: boolean; collapsed: boolean }; drawMode: 'map' | 'globe' }
export const DEFAULT_PREFS: Prefs;
export function loadPrefs(storage?: Pick<Storage, 'getItem'>): Prefs; // key 'map-projections:prefs:v1'
export function savePrefs(prefs: Prefs, storage?: Pick<Storage, 'setItem'>): void;
```
`loadPrefs` validates field by field: anything missing, of the wrong type, or not a known id takes its default. Colours must match `/^#[0-9a-f]{6}$/i`.

- [ ] **Step 1: Failing tests** *(Review Focus 2)*: corrupt JSON → `DEFAULT_PREFS`; `{ theme: 'neon' }` → theme `auto`, the rest default; a storage whose `getItem` throws → defaults; a storage whose `setItem` throws → `savePrefs` does not throw; a round trip returns what was saved; an override of `'red'` is dropped.
- [ ] **Steps 2–4.** **Step 5:** Commit `feat: layers, colours and preferences are remembered`.

### Task 21: The Layers panel

**Files:** Create `src/ui/layersPanel.ts`, `e2e/layers.spec.ts`. Modify `src/main.ts`, `src/style.css`.

**Interfaces:** `export function createLayersPanel(app: App): HTMLButtonElement` — the button, with its popover attached. Replaces the temporary Tissot button from Task 9; key `T` still toggles Tissot.

Contents, top to bottom: a checkbox per layer in the spec's order, each with a tip; the graticule step (10°, 15°, 30°) beside Graticule; Standard lines disabled where `hasStandardLines` is false; a theme select; a colour input per `ColourKey` with a reset beside each that appears only when overridden; "Reset colours".

- [ ] **Step 1: Failing e2e:** toggling Country borders adds stroked pixels in the borders colour inside Africa; Political colours gives at least four distinct fill colours on land; Standard lines on Albers draws two arcs that move when a parallel's slider moves and is disabled on Mollweide; choosing Blueprint changes the sea colour on the canvas and the sidebar's background; overriding the sea colour to `#ff0000` paints the sea red, survives a reload, and its reset restores the theme's; a morph with every layer on throws nothing.
- [ ] **Steps 2–4.** **Step 5:** Commit `feat: a Layers panel for layers, themes and colours`.
- [ ] **Step 6 (stage gate):** full suites and type check green.

---

# Stage 5: Drawing that follows the map

### Task 22: Straight on the map

**Files:** Create `src/drawing/straight.ts`, `tests/straight.test.ts`.

**Interfaces — Produces:**
```ts
/** The path on the Earth that is a straight line on this map from `a` to `b`, dense enough that drawn on the map it strays under 0.25 px; null if the line leaves the map. Ends are `a` and `b` exactly. */
export function straightPath(c: CompiledProjection, s: ScreenTransform, a: LonLat, b: LonLat): LonLat[] | null;
/** The ring on the Earth that is a circle on this map, centred on `centre` and through `edge`, wound so that its inside on the map is its inside on the Earth; null if it leaves the map. */
export function circlePath(c: CompiledProjection, s: ScreenTransform, centre: LonLat, edge: LonLat): LonLat[] | null;
/** A closed ring of map-straight edges through `vertices`, wound as `circlePath` winds; null if an edge leaves the map. */
export function straightRing(c: CompiledProjection, s: ScreenTransform, vertices: LonLat[]): LonLat[] | null;
```
Sampling: start with 32 even steps along the screen segment, invert each with `screenToLonLat`; halve any step whose neighbours are over 1° apart on the Earth or whose great-arc midpoint lands over 0.25 px off the line; stop at 2048 points. Winding: a ring clockwise on screen (y down) is clockwise on the Earth seen from outside, which is how d3 marks the inside.

- [ ] **Step 1: Failing tests:**
  - on Mercator, `[0, 0]` → `[60, 50]`: every point satisfies `mercatorY(lat) / lon = mercatorY(50) / 60` to 1e-4 (a rhumb line);
  - on gnomonic: all points are coplanar with the Earth's centre to 1e-6 (a great circle);
  - on Mollweide: every point projects within 0.25 px of the screen segment, and so does the midpoint of each consecutive pair;
  - on Goode, a line from the North Atlantic to the North Pacific across a gap returns null;
  - `circlePath` on Mercator at zoom 1: every point projects to the same distance from the centre's image, within 0.25 px; `geoArea` of the ring as a polygon is under 2π for a small circle (wound round its inside);
  - a line whose ends are 0.001° apart returns two points.
- [ ] **Steps 2–4.** **Step 5:** Commit `feat: paths that are straight, and circles that are round, on the map they are drawn on`.

### Task 23: The drawing model follows the map

**Files:** Modify `src/drawing/model.ts`, `src/ui/drawingToolbar.ts`, `tests/drawing.test.ts`, `e2e/drawing.spec.ts`, `e2e/touchDrawing.spec.ts`.

**Interfaces — Produces:**
```ts
export type Shape =
  | { kind: 'line' | 'polygon'; points: LonLat[] }                       // great-circle edges
  | { kind: 'circle'; center: LonLat; radiusDeg: number }
  | { kind: 'path'; points: LonLat[]; closed: boolean };                 // dense, as drawn on a map
export type Mode = 'map' | 'globe';
/** How to trace on the map on screen; supplied by the toolbar with each click and cursor move. */
export interface Tracer { line(a: LonLat, b: LonLat): LonLat[] | null; ring(vertices: LonLat[]): LonLat[] | null; circle(centre: LonLat, edge: LonLat): LonLat[] | null }
// DrawingModel
mode: Mode; setMode(mode: Mode): void;                   // a draft in progress is dropped
addPoint(p: LonLat, tracer?: Tracer): void;              // tracer is required in map mode
preview(p: LonLat | null, tracer?: Tracer): void;
```
Rules:
- In map mode a draft keeps its vertices and one traced segment per edge; undo removes a vertex and its segment. Segments already placed are not retraced if the map moves mid-draft.
- A refused edge sets the notice `'A straight line there would leave the map.'` and adds nothing. A circle that leaves the map: `'A circle that size would leave the map.'`
- A polygon is checked with `isSimple` on its dense points when a vertex is added and when it is finished, not on every cursor move.
- A map-mode circle shows no kilometre readout.
- `shapeToGeoJSON` for a `path`: a `LineString`, or the fill and outline pair as for a polygon, with the ring as stored (it is already wound).
- The toolbar's mode button toggles `follow-map` / `follow-globe`, with tips "Shapes are straight on this map" and "Shapes are straight on the globe: great circles". On the globe definition the mode is `globe` and the button is disabled. The choice is saved in prefs.

- [ ] **Step 1: Failing tests.** Unit, with a fake tracer: a refused edge leaves the draft unchanged and sets the notice; undo in map mode removes one segment; finishing a three-vertex map polygon stores `{ kind: 'path', closed: true }`; switching mode drops the draft; globe mode behaves as every existing test says. e2e: a line drawn on Mercator between two clicks has every drawn pixel within 1 px of the straight segment between them, and after morphing to the globe is visibly curved (a pixel of it lies over 5 px from the chord); the same line drawn in globe mode is curved on Mercator; on the globe the mode button is disabled.
  - *(Review Focus 4)* a 1000-point `path` made by `straightPath` on Mercator from `[-170, 60]` to `[170, -60]`: `cutFront` and `cutGeometry` with Peirce, the butterfly and Goode each return without throwing and conserve the line's length to 1 % (`tests/drawing.test.ts`).
- [ ] **Steps 2–4.** **Step 5:** Commit `feat: shapes follow the map they are drawn on, or the globe`.
- [ ] **Step 6 (stage gate):** full suites and type check green.

---

# Stage 6: The corner globe

### Task 24: Camera and surfaces

**Files:** Create `src/locator/camera.ts`, `src/locator/surface.ts`, `tests/surface.test.ts`.

**Interfaces — Produces:**
```ts
// camera.ts
export type Camera = { lon: number; lat: number }; // the point of the Earth facing the viewer
export const DEFAULT_CAMERA: Camera;               // { lon: 10, lat: 25 }
/** Earth coordinates to view coordinates: x right, y up, z towards the viewer. */
export function toView(camera: Camera, v: Vector): Vector;
export function orbit(camera: Camera, dxPx: number, dyPx: number, radiusPx: number): Camera; // latitude held to ±85
/** The point of the Earth under a place on the globe's face (x, y in radii), or null off it. */
export function pick(camera: Camera, x: number, y: number): LonLat | null;
// surface.ts
export type Surface = { kind: 'cylinder' | 'cone' | 'plane' | 'octahedron'; lines: Vector[][]; touch: Vector[][]; eye?: Vector; rays?: [Vector, Vector][] };
/** The surface this map is projected onto, in Earth coordinates with the Earth's radius 1, or null where there is none. */
export function surfaceFor(c: CompiledProjection): Surface | null;
/** A polyline in view coordinates split into runs in front of and behind the unit sphere. */
export function visibleRuns(line: Vector[]): { points: [number, number][]; hidden: boolean }[];
```
Surfaces (all in the map's own frame, carried to the Earth with `c.fromFrame`, so they follow centre and tilt):
- Cylindrical definitions: axis the frame's pole; radius `cos(phi0)`; from height -1.3 to 1.3; two rims and 12 generators. `touch`: the standard parallels.
- Conic definitions: the straight line through the two standard parallels' points in a meridian plane (the tangent where they coincide), spun about the axis; kept to heights within ±1.5 and radii within 2.2, ending at the apex when it is nearer. `touch`: the two parallels. This gives a cylinder at cone constant 0 and a flat disc as it nears 1 with no special case.
- Azimuthal definitions: a square of half-side 1.15 touching at the centre, with a 3 × 3 grid. For `perspective`: `eye` at `-P` times the centre's vector (the centre itself at P = 0; none at infinity) and three `rays` from the eye through points 30° from the centre to the plane; at infinity the rays are parallel.
- Butterfly: the octahedron with vertices at distance √3 along the frame's axes; 12 edges.
- Anything else, and the globe: null.

A point is hidden when `x² + y² < 1` and `z < sqrt(1 - x² - y²)`.

- [ ] **Step 1: Failing tests:** Mercator at tilt 0 has its axis along `[0, 0, 1]` and rims of radius 1; at tilt 90 the axis lies in the equatorial plane; Behrmann's radius is `cos 30°`; a cone with both parallels at 30° has every generator at distance 1 from the origin (tangent) and touches at latitude 30°; with parallels 29.5 and 45.5 every generator passes through both parallels' points; with both parallels at 0 all generators are parallel to the axis; `surfaceFor` is null for Mollweide and the globe; `visibleRuns` of a straight line through `[-2, 0, -2]` → `[2, 0, -2]` is visible, hidden, visible; `pick(camera, 0, 0)` is the camera's own point; `toView(DEFAULT_CAMERA, toVector([10, 25]))` is `[0, 0, 1]`.
- [ ] **Steps 2–4.** **Step 5:** Commit `feat: projection surfaces and a fixed camera for the corner globe`.

### Task 25: The corner globe rebuilt

**Files:** Create `src/locator/locator.ts` (from `src/render/locator.ts`, which is deleted). Modify `src/main.ts`, `src/style.css`, `index.html`. Rewrite `e2e/locator.spec.ts`. Delete `src/geo/grab.ts` and `tests/grab.test.ts` if nothing else uses them.

**Interfaces:** `export function createLocator(container: HTMLElement, app: App, prefs: Prefs['locator'], save: (p: Prefs['locator']) => void): void`.

Rules:
- 180 px (120 px on narrow screens). Hidden on the globe definition.
- The Earth is drawn from the camera, not from the map's centre. Drawn in order: sea, graticule, land, coverage tint, the map's equator (dashed) and poles, drawings, the centre marker, then the surface: hidden runs dashed at half strength, visible runs solid, `touch` lines in the standard-line colour, the eye as a dot, rays thin.
- A centre on the far side shows as a hollow marker at its place.
- Drag orbits the camera. Double-click restores `DEFAULT_CAMERA`. A press and release within 4 px sets the map's centre to the picked point with `app.setAnimated` (latitude only where the definition has `latEnabled`).
- Two small buttons at the globe's corner, with tips: show or hide the surface (disabled, with a tip saying so, where `surfaceFor` is null) and collapse. Both saved in prefs.
- Redrawn on every state change, slides included, with the existing 30 ms throttle.

- [ ] **Step 1: Failing e2e:**
  - dragging the map changes `state.orientation` and leaves the land pixels of the corner globe unchanged (compare a patch away from the marker);
  - dragging the corner globe changes its pixels and not `state`; double-click restores them;
  - a click on the corner globe starts a slide (`isSliding`) that ends with the centre within 1° of the picked point;
  - on Albers with the surface on, moving the first parallel's slider changes the corner globe's pixels; on Mollweide the surface button is disabled;
  - the surface and collapsed choices survive a reload.
- [ ] **Steps 2–4.** **Step 5:** Commit `feat: the corner globe keeps a fixed view and shows the surface the map is projected onto`.
- [ ] **Step 6 (stage gate):** full suites and type check green.

---

# Stage 7: Export

### Task 26: A scene as SVG

**Files:** Create `src/export/svg.ts`, `tests/svg.test.ts`.

**Interfaces — Produces:**
```ts
/** A scene at rest as a standalone SVG document, one group per layer in `DRAW_ORDER`, coordinates to two decimals. `background` null leaves it transparent. */
export function sceneToSvg(scene: Scene, style: Style, size: Viewport, opts: { background: string | null; lineScale: number }): string;
```
Each layer is `<g id="<layer>">` holding one `<path>` per run of pieces (`fill-rule="nonzero"`, seam strokes as on canvas). Indicatrices are a `<g id="tissot" clip-path="url(#outline)">` of `<circle r="1" transform="matrix(…)" vector-effect="non-scaling-stroke">`, each inside a `<clipPath>` of its half-planes when it has cuts. Colours with alpha are written as `fill` plus `fill-opacity`.

- [ ] **Step 1: Failing tests:** for a Mollweide scene at rest with drawings and Tissot: the string parses as XML (`DOMParser` under `// @vitest-environment happy-dom`, or a regex check that tags balance if no DOM is available without a new dependency); group ids appear in `DRAW_ORDER`; the number of subpaths in `#land` equals the scene's land rings; no number has more than two decimals; `background: null` emits no background rect; the viewBox is `0 0 width height`.
- [ ] **Steps 2–4.** **Step 5:** Commit `feat: a map at rest as SVG`.

### Task 27: Building an export

**Files:** Create `src/export/render.ts`, `tests/exportRender.test.ts`. Modify `src/render/draw.ts`, `src/app.ts`.

**Interfaces — Produces:**
```ts
export interface ExportOptions { format: 'png' | 'svg'; extent: 'map' | 'view'; width: number; detail: Detail; background: 'screen' | 'transparent' }
export const SIZE_PRESETS: { id: string; label: string; width: number | 'screen' }[]; // Screen, 4K (3840), A3 at 300 dpi (4961), A1 at 300 dpi (9933)
/** What the app shows now, as everything an export needs, taken at one moment. */
export interface Snapshot { state: ProjectionState; layers: LayerState; style: Style; drawings: GeoJSON.GeometryCollection; view: View; viewport: Viewport; zoom: number }
// App: snapshot(): Snapshot | null — null while a morph or slide runs
/** The scene, size and line scale for an export. Extent 'map' is the whole map with 16 px (scaled) of margin; 'view' is the window's own framing. */
export function exportScene(snap: Snapshot, opts: ExportOptions): Promise<{ scene: Scene; size: Viewport; lineScale: number }>;
export function exportBlob(snap: Snapshot, opts: ExportOptions): Promise<Blob>; // rejects with ExportTooLarge when the canvas cannot be made
export class ExportTooLarge extends Error {}
export function exportName(snap: Snapshot, opts: ExportOptions): string; // 'map-<stop id | custom>-<width>.<ext>'
```
Rules:
- `lineScale = size.width / snap.viewport.width` for extent `view`, and the same ratio of fitted map widths for extent `map`, so line weights look as on screen. `drawScene` takes it as a parameter (default 1) and multiplies every width; `Style` widths stay in CSS pixels.
- `drawScene` with a transparent background clears instead of filling.
- PNG: a canvas of `size`, `drawScene`, `toBlob`. A null context, a null blob, or a canvas that reads back empty on a probe pixel inside the map rejects with `ExportTooLarge`.
- Detail other than 110m loads through `loadDetail` and replaces land, coast, borders and political geometry for the export only.

- [ ] **Step 1: Failing tests:** extent `map` at width 2000 for Mollweide gives a height of `2000 / aspect` of the fitted map to 1 px, and the map's bounding box sits 16 × lineScale from each side; extent `view` at twice the viewport's width has every piece's coordinates exactly twice the on-screen scene's; `exportName` for Mercator PNG at 3840 is `map-mercator-3840.png` and for an unmatched state `map-custom-…`; `snapshot()` is null mid-morph (e2e).
  - *(Review Focus 5)* with `HTMLCanvasElement.prototype.getContext` stubbed to return null, `exportBlob` rejects with `ExportTooLarge`.
- [ ] **Steps 2–4.** **Step 5:** Commit `feat: export scenes at any size and detail`.

### Task 28: The Export panel

**Files:** Create `src/ui/exportPanel.ts`, `e2e/export.spec.ts`. Modify `src/main.ts`, `src/style.css`.

**Interfaces:** `export function createExportPanel(app: App): HTMLButtonElement`.

Contents: format (PNG, SVG); extent (Whole map, Current view; the second disabled at zoom 1); size preset and a width box (hidden for SVG); detail (1:110m, 1:50m default, 1:10m); background (As on screen, Transparent); an Export button that shows a busy state while it works. The button is disabled, with a tip saying why, while `app.snapshot()` is null. `ExportTooLarge` shows in the panel: "Too large for this browser. Try a smaller size, or SVG."

- [ ] **Step 1: Failing e2e** (Playwright `page.waitForEvent('download')`):
  - a PNG at Screen size downloads as `map-mollweide-<w>.png`, decodes to the expected width, and matches a screenshot of the map area with the floating controls excluded (mean absolute difference under 3/255 at 110m detail);
  - an SVG download, loaded in an `<img>` and drawn to a canvas, matches the same screenshot to under 4/255;
  - with borders, political colours, Tissot and a drawing on, both formats contain them (pixel checks at known places) and neither contains the corner globe;
  - Transparent gives alpha 0 at a corner pixel;
  - the 50m PNG at 4K completes within 20 s;
  - *(Review Focus 5)* with `getContext` stubbed to null in the page, the panel shows the too-large notice and no download starts.
- [ ] **Steps 2–4.** **Step 5:** Commit `feat: export the map as PNG or SVG`.

### Task 29: Tidy and document

**Files:** Modify `src/geo/angles.ts`, `src/screen/screen.ts`, `src/tissot/pastCap.ts`, `src/tissot/rest.ts`, `src/projections/catalog.ts`, `src/morph/scene.ts`, `src/drawing/arcs.ts`, `README.md`, `docs/ideas.md`.

- [ ] **Step 1:** Fold the duplicates into one place each: `wrapLon` → `normaliseLon`; `smooth`, `ramp` → `src/geo/angles.ts` (renamed `src/geo/numbers.ts` if that reads better); `dot`, `cross` → `src/geo/densify.ts` beside `Vector`.
- [ ] **Step 2:** README: features, the projection count and families, shortcuts, export, data (countries and the 50m and 10m files from `world-atlas`).
- [ ] **Step 3:** `docs/ideas.md`: mark each idea done, with a line for anything left out (Dymaxion and Waterman) and why.
- [ ] **Step 4:** `npm test`, `npx tsc --noEmit`, `npm run e2e`, `npm run build` all green. Check each of the spec's success criteria by hand in the browser and note the result of each in the commit message.
- [ ] **Step 5:** Commit `chore: fold duplicated helpers together and bring the README up to date`.
