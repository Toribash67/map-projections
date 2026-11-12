# Atlas Layers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rivers, lakes, a depth-shaded sea, fitted country and sea names, degree labels, a title box and a frame, each a setting, shown on screen and exported as shown.

**Architecture:** Rivers, lakes and depth are more geometry layers through the existing cut, morph and draw path, from Natural Earth data reduced by a script and fetched as lazy chunks. Names, degree labels, the title box and the frame are an *overlay*: worked out from the map at rest by pure functions, kept beside the scene, drawn after it on the canvas and written after it in the SVG. The overlay is dropped whenever the map on screen changes and worked out again once it has rested.

**Tech Stack:** TypeScript, Vite, d3-geo, the app's own cut (`buildScene`), Vitest, Playwright. One new runtime package, `@fontsource/jost`, for the typeface files.

**Spec:** `docs/superpowers/specs/2026-11-12-atlas-layers-design.md` (the look: `2026-11-12-atlas-layers-mockup.jpg` beside it).

## Global Constraints

- Every new layer and choice is off by default, kept in preferences (`map-projections:prefs:v1`, read part by part), and exported as shown.
- No fades. Overlay text is not drawn while the map moves and returns at once when it rests.
- The start-up bundle gains no data: each data file and the typeface is its own chunk, fetched when first needed.
- Data size aims: coarse bathymetry under 400 kB, fine under 2 MB, every other file under 1 MB.
- Depth steps: 200, 2000, 4000, 6000 m. Smallest name: 2 to 10 px, default 5.
- Comments and commit messages in the repo's own voice: plain sentences, British spelling, `feat:`/`fix:`/`docs:` and a line that says what the map now does.
- Tests in the manner of the existing ones; `npm test`, `npm run build` and `npm run e2e` pass at the end.

## Review Focus

1. A country cut in two by a seam (Russia on a map centred on 0°): named once, on the larger piece. (Task 5)
2. An empty title and subtitle, and a very long title: the box still lays out, with no empty line and no text outside it. (Task 7)
3. The typeface or a data file fails to load: the map still draws, names fall back to the system's sans-serif, the layer stays off the picture until a later try succeeds. (Tasks 3, 8)
4. A globe: nothing is named on the far side, and no degree label floats inside the disc. (Tasks 5, 6)
5. An export asked for at once after a change: it carries the names, fitted for the exported picture and not the stale ones of the screen. (Task 9)

---

## File structure

| File | Responsibility |
|------|----------------|
| `scripts/natural-earth.mjs` | Fetch and reduce Natural Earth; write `src/data/ne/*.json` |
| `src/data/ne/*.json` | rivers-{110m,50m,10m}, lakes-{110m,50m,10m}, depth-{coarse,fine}, seas |
| `src/data/water.ts` | Lazy loaders for those files, with a synchronous "what is loaded" |
| `src/data/countryShapes.ts` | Each country at 1:110m with its display name |
| `src/data/displayNames.ts` | Natural Earth name to the name that is lettered |
| `src/labels/fit.ts` | Fit one name to one shape (pure) |
| `src/labels/place.ts` | Glyph positions along a curve; collisions (pure) |
| `src/labels/names.ts` | Country and sea names for a map at rest |
| `src/labels/degrees.ts` | Degree labels for a map at rest |
| `src/labels/font.ts` | The typeface: loading, measuring, base64 for SVG |
| `src/plate/plate.ts` | Frame rectangle and title box layout (pure) |
| `src/overlay/overlay.ts` | `Overlay` type, `buildOverlay`, `drawOverlay` (canvas), `overlayToSvg` |
| existing | `layers.ts`, `mapData.ts`, `style.ts`, `palette.ts`, `themes.ts`, `prefs.ts`, `app.ts`, `draw.ts`, `export/*`, `ui/layersPanel.ts`, `style.css`, `screen.ts` |

---

### Task 1: Natural Earth data

**Files:** Create `scripts/natural-earth.mjs`, `src/data/ne/*.json`, `src/data/water.ts`, `tests/water.test.ts`. Modify `package.json` (script `natural-earth`).

**Interfaces — produces:**

```ts
// src/data/water.ts
export type WaterKind = 'rivers' | 'lakes' | 'depth' | 'seas';
export type Sea = { name: string; rank: number; ocean: boolean; geometry: GeoJSON.MultiPolygon };
export interface Water { rivers: GeoJSON.MultiLineString; lakes: GeoJSON.MultiPolygon; lakeEdges: GeoJSON.MultiLineString; depth: GeoJSON.MultiPolygon[]; seas: Sea[] }
export const DEPTHS = [200, 2000, 4000, 6000] as const;
/** Fetched once per kind and level; the same objects every time. Depth is coarse at '110m' and fine at the others; seas are one file at every level. */
export function loadWater<K extends WaterKind>(kind: K, level: Detail): Promise<Water[K]>;
/** What has arrived already, or null. */
export function waterNow<K extends WaterKind>(kind: K, level: Detail): Water[K] | null;
```

`lakeEdges` comes with `lakes` (kind `'lakes'` resolves the polygons; `lakeEdgesOf(lakes)` is a memoised helper exported beside it).

- [ ] **Step 1: the script.** Source: `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/<name>.geojson` for `ne_{110m,50m,10m}_rivers_lake_centerlines`, `ne_{110m,50m,10m}_lakes`, `ne_50m_geography_marine_polys`, `ne_10m_bathymetry_{K_200,I_2000,G_4000,E_6000}`. Downloads go to a cache directory outside `src` (`node_modules/.cache/natural-earth`). For each: keep geometry only (seas keep `name`, `scalerank`, `featurecla === 'ocean'`); simplify rings and lines by Douglas–Peucker in degrees (rivers/lakes 110m 0.02, 50m 0.01, 10m 0.004; depth coarse 0.2, fine 0.04; seas 0.1); drop rings smaller than a tolerance-squared-scaled area (depth coarse 1 sq deg, fine 0.05) and lines of fewer than 2 points; after simplifying, put a point at least every 4° of longitude along any segment (planar in lon/lat), since the app reads a segment as a great arc; wind every polygon as d3 wants (outer ring clockwise in lon/lat with north up, holes the other way), decided by the planar signed area of each ring; round coordinates to 3 decimals (4 at 10m). Write compact JSON.
- [ ] **Step 2: run it**, `npm run natural-earth`, and check sizes against the aims; tighten tolerances until they hold.
- [ ] **Step 3: failing tests** in `tests/water.test.ts`: every file loads; rivers are a MultiLineString, lakes a MultiPolygon; depth has 4 MultiPolygons; `geoArea` of every lake polygon and every depth polygon is under 2π (wound the right way) — for depth, of each polygon on its own; deeper steps have less area than shallower; seas include "INDIAN OCEAN"-like names case-insensitively for the five oceans, each `ocean: true`; file sizes under the aims (read with `fs.statSync`); `loadWater` gives the same object twice; `waterNow` is null before and the object after.
- [ ] **Step 4: implement `water.ts`** with dynamic `import()` of each JSON, cached by `kind:file`, a failed load not kept.
- [ ] **Step 5:** `npx vitest run tests/water.test.ts` passes. Commit: `feat: rivers, lakes, sea depth and sea names from Natural Earth, reduced`.

### Task 2: Colours

**Files:** Modify `src/theme/palette.ts`, `src/theme/themes.ts`, `src/render/style.ts`, `src/render/draw.ts` (`widened`), `tests/palette.test.ts`.

**Interfaces — produces:** `Palette` and `Style` gain `rivers`, `deep`, `labels`, `seaLabels: string`; `Style` gains `depth: readonly string[]` (4, mixed evenly from `ocean` to `deep`: step i is `(i + 1) / 4` of the way), `riversWidth: 0.7`, `lakeEdgeWidth: 0.4`. `ColourKey` gains the four, named `Rivers`, `Deep sea`, `Names`, `Sea names`. `ThemeId` gains `'poster'` (`Poster`): ocean `#dcedf7`, deep `#a2c7df`, land `#f6eec7`, political `['#f3d9a0', '#bcdcb0', '#f2b8b0', '#cfc3e6', '#f6eec7']`, borders `#ffffff`, coast `#6f8da0`, graticule `rgba(127, 163, 187, 0.28)`, rivers `#7fb0cf`, labels `#3a3a3a`, seaLabels `#5b87a6`, paper `#ffffff`, light chrome. `export const mix = (a: string, b: string, t: number): string` in `style.ts` ('#rrggbb' in, '#rrggbb' out).

- [ ] Failing tests: `mix('#000000', '#ffffff', 0.5) === '#808080'`; `styleOf(p).depth` has 4 colours, the last equal to `p.deep`; every theme's palette has the four new colours; in every theme, `labels` on `land` and on each political colour has contrast ≥ 4.5, `seaLabels` on `ocean` ≥ 3; an override of `deep` moves the ramp.
- [ ] Implement; give LIGHT, DARK, ATLAS, BLUEPRINT, PRINT sensible values that pass. Run `npx vitest run tests/palette.test.ts`. Commit: `feat: colours for rivers, depth and names, and a Poster theme`.

### Task 3: Water layers on the map

**Files:** Modify `src/layers/layers.ts`, `src/layers/mapData.ts`, `src/prefs.ts`, `src/app.ts`, `src/export/render.ts`, `tests/layers.test.ts`, `tests/prefs.test.ts`.

**Interfaces — produces:**

```ts
export type LayerId = /* existing */ | 'rivers' | 'lakes' | 'depth' | 'countryNames' | 'seaNames' | 'degrees' | 'frame' | 'titleBox';
export type Corner = 'tl' | 'tr' | 'bl' | 'br';
export interface LayerState { on: Record<LayerId, boolean>; graticuleStep: GraticuleStep; graticuleUnder: boolean; smallestName: number; title: string; subtitle: string; corner: Corner }
// defaults: all new ids false, graticuleUnder false, smallestName 5, title 'The World', subtitle '', corner 'tr'
export const LAYER_NAMES   // the geometry layers only, now with ['rivers','Rivers'], ['lakes','Lakes'], ['depth','Sea depth'] after 'political'
export interface MapData { /* existing */ rivers?: GeoJSON.GeoJsonObject; lakes?: GeoJSON.GeoJsonObject; lakeEdges?: GeoJSON.GeoJsonObject; depth?: GeoJSON.GeoJsonObject[] }
// mapData.ts
export function withWater(data: MapData, level: Detail): MapData;        // the same object while nothing new has arrived
export function loadWaterFor(on: LayerState['on'], level: Detail): Promise<void>; // fetches what the layers that are on need
// app.ts
setLayerOptions(patch: Partial<Omit<LayerState, 'on'>>): void;
```

`sceneLayers`: `depth0..3` after `ocean` when `on.depth` and the data is there; the graticule under the name `graticuleUnder` instead of `graticule` when the flag is set; `rivers`, then `lakes`, then `lakeEdges` after the political colours. `DRAW_ORDER`: `ocean`, `depth0..3` (fill `s.depth[i]`, seam), `graticuleUnder`, `land`, `political*`, `rivers` (stroke `s.rivers`, `s.riversWidth`), `lakes` (fill `s.ocean`, seam), `lakeEdges` (stroke `s.rivers`, `s.lakeEdgeWidth`), then the rest as now.

App: on any change of layers, of zoom past `FINE_FROM`, and at start, `loadWaterFor(on, level)` for each level in use, and on arrival mark stale and request a frame; a failed load is tried again at the next change. Scenes use `withWater(fine ?? COARSE, level)`. Export: `await loadWaterFor(snap.layers.on, opts.detail)` before `sceneLayers`.

- [ ] Failing tests: `sceneLayers` with rivers on and data present has a `rivers` layer, and none while the data is absent; depth gives four layers in order under `land`; `graticuleUnder` moves the graticule's name and `DRAW_ORDER` has it before `land`; `drawScene` on a recording context fills `depth3` in `style.depth[3]`; prefs: new ids and options round-trip, a bad `corner` or a `smallestName` of 50 or `'x'` takes the default, a `title` of 500 characters is cut to 80.
- [ ] Implement. `npx vitest run tests/layers.test.ts tests/prefs.test.ts tests/draw.test.ts`. Then measure in the browser (dev server, `window.__app`): time of the first frame of a morph and of a drag frame with depth on and off at 110m. If depth adds more than half again to either, leave depth out of scenes that are morphs or moving (as `fine` is) and note it in the commit.
- [ ] Commit: `feat: rivers, lakes and a sea shaded by depth, as layers`.

### Task 4: Fitting a name to a shape

**Files:** Create `src/labels/fit.ts`, `tests/labelFit.test.ts`.

**Interfaces — produces:**

```ts
export type Pair = [number, number];
export type FitOptions = { thin: number; fill: number; minGap: number; maxGap: number; spread: number; maxSize: number };
export const COUNTRY_FIT: FitOptions = { thin: 0.5, fill: 0.42, minGap: 0.12, maxGap: 1.1, spread: 0.72, maxSize: 30 };
export const SEA_FIT: FitOptions = { thin: 0.45, fill: 0.2, minGap: 0.3, maxGap: 2.2, spread: 0.6, maxSize: 26 };
/** `rings`: one polygon on screen, outer ring and holes. `advance`: the text's width at size 1 with no extra spacing. `count`: its letters. */
export type Fit = { size: number; gap: number; curve: Pair[]; length: number };
export function fitLabel(rings: Pair[][], advance: number, count: number, opts: FitOptions): Fit | null;
/** The same name smaller on the same curve: for a collision. */
export function shrink(fit: Fit, advance: number, count: number, by: number, opts: FitOptions): Fit;
export function polygonArea(rings: Pair[][]): number;
export function contains(rings: Pair[][], p: Pair): boolean;
export function clipToRect(rings: Pair[][], rect: { x: number; y: number; width: number; height: number }): Pair[][];
```

The method is the sketch's (`fitAt` and `fit` in the spec's prose): 18 directions, 28 slices, crossings of every ring paired off, the longest run of slices at least `thin` of the thickest, a least-squares parabola through the run's middles with its bend limited to 0.35 of the half-run, inset 0.84, size the lesser of `fill` × the least room across and length / (advance + (count − 1) × minGap), capped at `maxSize`; score size × (1 − 0.22 |sin θ|). The curve runs left to right; steeper than 80° it runs upward. After fitting, the centre line and its two offsets at ±size/2 are sampled; if any sample is outside the polygon the size is cut by 0.85 and tried again, down to 0.4 of the first size, then null.

- [ ] Failing tests: a 200 × 40 rectangle gives a level curve through y = 20 ± 1 with size between 12 and 17; the same rectangle turned 90° gives a curve that runs upward (y falls along it); a banana (an arc band) gives a curve that bends the same way and every sample of the lettering's band inside the shape; an L shape puts the name in the longer arm; a ring with a hole in the middle does not letter across the hole; a 3 × 3 square gives a size under 2; `clipToRect` of a shape half outside keeps only the inside half's area; `shrink` keeps the curve's middle and gives a smaller size.
- [ ] Implement; `npx vitest run tests/labelFit.test.ts`. Commit: `feat: a name fitted along the middle of a shape`.

### Task 5: Names for a map

**Files:** Create `src/labels/place.ts`, `src/labels/names.ts`, `src/data/countryShapes.ts`, `src/data/displayNames.ts`, `tests/labelPlace.test.ts`, `tests/names.test.ts`.

**Interfaces — produces:**

```ts
// place.ts
export type Glyph = { ch: string; x: number; y: number; angle: number };            // start of the letter on its baseline; angle in radians, clockwise on screen
export type Label = { kind: 'country' | 'sea' | 'degree'; text: string; size: number; glyphs: Glyph[]; discs: [number, number, number][] }; // x, y, r: what it covers
export type Measure = (text: string, kind: Label['kind']) => number;                // width at size 1
export function setAlong(text: string, kind: Label['kind'], fit: Fit, measure: Measure): Label;   // letters centred on the curve's middle, baseline 0.36 × size below the centre line
export function setLevel(text: string, kind: Label['kind'], centre: Pair, size: number, measure: Measure): Label;
export function touches(a: Label, others: Label[]): boolean;
// names.ts
export type NameOptions = { countries: boolean; seas: boolean; smallest: number; scale: number };  // scale: the picture's size over the screen's (1 on screen)
export function buildNames(member: Member, viewport: Viewport, opts: NameOptions, measure: Measure, seas: Sea[] | null, land: GeoJSON.GeoJsonObject): Label[];
// countryShapes.ts
export const COUNTRY_SHAPES: { name: string; geometry: GeoJSON.Geometry }[];        // 1:110m, display names, uppercase is applied when lettering
```

`buildNames`: cut every shape with `buildScene({ [i]: geometry }, [member], null, false)`; of the closed pieces not `behind`, clip each to the viewport and take the largest by area; fit with `COUNTRY_FIT` or `SEA_FIT` (sizes and `smallest` × `scale`, `maxSize` × `scale` × the view's zoom, where zoom = `member.screen.k` over the fit's — pass it in `opts.scale` already multiplied for the cap, and keep `smallest` at `opts.smallest × scale` only); all candidates sorted by size, largest first; a candidate that `touches` one placed is shrunk by 0.8 up to twice, then dropped; one under the smallest size is dropped; a sea name with any of 7 points along it on land (`geoContains(land, screenToLonLat(...))`) is dropped. Countries are lettered in capitals, seas as written. Oceans before seas of the same size.

`displayNames.ts`: spell out every abbreviated name in world-atlas's 110m list (`Dem. Rep. Congo` → `DR Congo`, `United States of America` → `United States`, `Central African Rep.` → `Central African Republic`, `Bosnia and Herz.` → `Bosnia & Herzegovina`, and the rest: every name with a full stop in it has an entry, held by a test).

- [ ] Failing tests (measure = 0.62 × length): `setAlong` puts the first letter left of the last and the middle of the text at the curve's middle; two labels on the same curve touch, two 100 px apart do not; on Mercator at 1000 × 600: Russia, Canada, Brazil, Australia, China are named, no two labels touch, every glyph of a country's name lies inside that country's piece (via `contains` on the cut piece), no name's letters run right to left; "UNITED STATES" is at least 8 px tall; with `smallest` 2 there are more names than with 8; centred on 180° (Russia whole) and on 0° (Russia cut): one "RUSSIA" each time; on the globe no name has a glyph outside the disc; with seas: "Pacific" and "Atlantic" names exist and none of their 7 points is on land; every 110m name with a "." has a display name.
- [ ] Implement; `npx vitest run tests/labelPlace.test.ts tests/names.test.ts`. Commit: `feat: country and sea names, fitted, and none touching`.

### Task 6: Degree labels

**Files:** Create `src/labels/degrees.ts`, `tests/degrees.test.ts`.

**Interfaces — produces:** `export function buildDegrees(member: Member, picture: { x: number; y: number; width: number; height: number }, step: GraticuleStep, scale: number, measure: Measure, taken: Label[]): Label[]` and `export const degreeText = (value: number, axis: 'lat' | 'lon'): string` (`'30°N'`, `'60°W'`, `'0°'`, `'180°'`).

Each parallel (all the way round) and each meridian (to the last parallel short of the pole, the ninetieths to the pole, as the graticule) is walked in half-degree steps; a point counts as shown when `isCovered` and inside the picture; an *end* is where shown turns to not shown, or two shown neighbours are farther apart on screen than 12 px + 6 × the median step (a seam). An end where the line stops for its own reasons (a meridian's last parallel) is no end. The label is level text of 9 px × `scale`, centred 8 px × `scale` past the end along the line's direction there if that lies wholly in the picture and not on the map (`screenToLonLat` null or not covered at its centre), else the same distance before the end. Kept in order of roundness (0, multiples of 90, 30, 15, 10), each only if it touches no label already kept and none in `taken`.

- [ ] Failing tests: `degreeText` cases; equirectangular at 1000 × 600, step 30: a "60°N" left and right of the map, "0°" at the equator's ends, "90°E" above and below, none inside the map's rectangle; on the globe every label's centre is outside the disc; orthographic-like polar view of a conic or azimuthal: labels do not touch each other; zoomed in (screen scaled 4× about the centre) labels lie inside the picture within 20 px of its edge.
- [ ] Implement; run. Commit: `feat: degrees written where the graticule leaves the map`.

### Task 7: Frame and title box

**Files:** Create `src/plate/plate.ts`, `tests/plate.test.ts`. Modify `src/screen/screen.ts` (`computeScreen(c, v, padding = PADDING)`, `mapSize(c, v, padding = PADDING)`), `src/app.ts` (fit key and padding), `src/export/render.ts`.

**Interfaces — produces:**

```ts
export const FRAME_MARGIN = 24;                       // more margin round the map when the frame is on
export const paddingFor = (layers: LayerState): number => PADDING + (layers.on.frame ? FRAME_MARGIN : 0);
export type Rect = { x: number; y: number; width: number; height: number };
/** The picture on screen: the fitted map and its margin at the fit, the window when zoomed in. */
export function pictureRect(compiled: CompiledProjection, viewport: Viewport, view: View, padding: number): Rect;
export type PlateLine = { text: string; size: number; weight: 400 | 500 | 700; gap: number; x: number; y: number };  // centred at x, baseline y; gap in px between letters
export type Plate = { frame: Rect | null; frameWidth: number; box: (Rect & { lines: PlateLine[]; rule: { x1: number; x2: number; y: number } | null }) | null };
export function settingsLine(state: ProjectionState): string;      // 'Centre 10°E 45°N · Standard parallel 45°'
export function buildPlate(state: ProjectionState, name: string, layers: LayerState, picture: Rect, measure: (text: string, weight: number) => number): Plate;
```

Sizes in units of `u = picture.width / 1000`: frame 6u inside the picture's edge, 1.6u thick; box 14u inside the frame, padding 16u × 14u, at least 180u wide and no wider than 0.45 of the picture; title capitals 26u weight 700 gap 4u, shrunk to fit the widest box; subtitle capitals 9u gap 2.2u; a hairline rule; projection name capitals + " PROJECTION" 9.5u gap 2.2u; settings 8u; "Made with Natural Earth" 7.5u. Empty title or subtitle: that line is left out. `settingsLine`: the centre as longitude then latitude (`formatDegrees`-style with E/W, N/S, latitude left out where the definition has `latEnabled` false), the tilt if not 0 and `tiltEnabled`, then each control of `controlsFor(defId)` whose value differs from the definition's default, as `label value` using the control's `format`.

- [ ] Failing tests: frame rectangle inside the picture by 6u; box in each of the four corners lies inside the frame; an empty subtitle gives one line fewer and a shorter box; a 200-letter title still lies inside the box, which is no wider than 0.45 of the picture; `settingsLine` for Bonne at its defaults and with φ₁ = 30; `pictureRect` at the fit is the map's size plus twice the padding, centred, and the viewport when zoomed; `computeScreen` with padding 40 leaves 40 px round the map.
- [ ] Implement; the app's fit uses `paddingFor(this.layers)` (in the fit's key), the export's too. Run `npx vitest run tests/plate.test.ts tests/screen.test.ts tests/exportRender.test.ts`. Commit: `feat: a frame and a title box, laid out`.

### Task 8: The overlay on screen

**Files:** Create `src/labels/font.ts`, `src/overlay/overlay.ts`, `tests/overlay.test.ts`. Modify `src/app.ts`, `package.json` (`@fontsource/jost`).

**Interfaces — produces:**

```ts
// font.ts
export const FONT_FAMILY = 'Jost';
export const fontOf = (kind: Label['kind'] | 'title', size: number, weight?: number): string;   // a canvas font string, with a sans-serif fallback
export function loadFont(): Promise<void>;            // resolves either way: on failure the fallback is used
export function canvasMeasure(): { label: Measure; plate: (text: string, weight: number) => number };
export function fontFaceCss(): Promise<string>;       // @font-face rules with the files as base64, for an SVG
// overlay.ts
export type Overlay = { labels: Label[]; plate: Plate };
export type OverlayInput = { member: Member; state: ProjectionState; name: string; layers: LayerState; viewport: Viewport; picture: Rect; scale: number; zoom: number };
export function overlayWanted(layers: LayerState): boolean;      // any of the five overlay switches on
export function buildOverlay(input: OverlayInput, measure: ReturnType<typeof canvasMeasure>, seas: Sea[] | null): Overlay;
export function drawOverlay(ctx: CanvasRenderingContext2D, overlay: Overlay, style: Style, moving: boolean): void;  // moving: plate only
```

App: an overlay kept with the key it was built for (compiled state, screen, viewport, the layer state's overlay parts, whether font and seas have arrived). In `frame`, after `drawScene`: if a morph, slide or zoom is under way or the key is not the kept one, draw the plate only (built cheaply each time it is needed, from `selected.name`) and, if at rest, set a timer of 140 ms that builds the overlay and requests a frame; else draw it whole. `loadFont()` and `loadWater('seas', '110m')` are started when first wanted. `get overlay(): Overlay | null` for tests (null while hidden).

- [ ] Failing tests (a recording canvas context, as `tests/draw.test.ts` has): `drawOverlay` draws each glyph with `fillText` at its place and angle, countries in `style.labels`, seas in `style.seaLabels`; with `moving` no label is drawn but the frame is stroked and the title filled; `buildOverlay` with everything off gives no labels and a plate of nulls; with degrees on and names off gives only degree labels.
- [ ] Implement; `npx vitest run tests/overlay.test.ts`; then in the browser turn everything on, look at five projections (Bonne, Mercator, globe, Peirce, Cahill butterfly) and screenshot each; fix what looks wrong against the anti-goals. Time `buildOverlay`: if it takes over 150 ms at the fit, cache the cut pieces or lower the directions tried.
- [ ] Commit: `feat: names, degrees, a title and a frame on the map at rest`.

### Task 9: Export

**Files:** Modify `src/export/render.ts`, `src/export/svg.ts`, `src/app.ts` (`Snapshot.name`), `tests/exportRender.test.ts`, `tests/svg.test.ts`.

**Interfaces:** `exportScene` also returns `overlay: Overlay` built for the exported picture (`scale = lineScale`, picture = the whole export). `overlayToSvg(overlay, style, fontCss: string): string[]` in `overlay.ts`: groups `names`, `sea-names`, `degrees`, `plate`; one `<text>` to a label with `x`, `y` and `rotate` lists (degrees) and `font-size`; the plate as `<rect>`s and centred `<text>`s with `letter-spacing`; a `<style>` with the font. `sceneToSvg(..., extra: string[] = [])` writes them before `</svg>`. PNG: `drawOverlay` after `drawScene`, after `await loadFont()`.

- [ ] Failing tests: an SVG export with country names on contains `<g id="names">` and a `<text` whose content is `BRAZIL`; with the title box, a text `THE WORLD`; with everything off the SVG is byte for byte what it was (existing tests); `exportScene` for width 4000 gives labels about `4000 / frame width` times the size of the screen's.
- [ ] Implement; run both test files. Commit: `feat: names, title and frame in the exported picture and drawing`.

### Task 10: The panel

**Files:** Modify `src/ui/layersPanel.ts`, `src/style.css`, `e2e/layers.spec.ts` (or a new `e2e/atlas.spec.ts`).

Groups, in order: **Layers** (the geometry layers; under Graticule its spacing, then two boxes "Degrees" and "Under the land"), **Names** ("Country names", "Sea names", "Smallest name" as a range 2–10 with its value), **Plate** ("Frame", "Title box", Title and Subtitle text boxes of at most 80 characters, Corner as a select: Top left, Top right, Bottom left, Bottom right), **Colours** (as now, with the four new pickers). The panel's height is at most the window's less its top offset and 16 px, and scrolls within. Every control has a tip. Title, subtitle, corner and smallest name are disabled while what they belong to is off.

- [ ] e2e, failing first: turning on Rivers draws river-coloured pixels on Mercator (count pixels of `style.rivers` > 50 after the data arrives); Country names: `__app.overlay.labels` includes `BRAZIL` after rest, is null during a morph, and returns after; typing a title shows in `__app.overlay.plate.box.lines[0].text` in capitals; a reload keeps the switches and the title; the panel's bottom is within the window at 1260 × 600; an SVG export with names on contains `BRAZIL`.
- [ ] Implement; `npm run e2e`. Commit: `feat: settings for the atlas layers, the names and the plate`.

### Task 11: Finish

- [ ] `npm test && npm run build && npm run e2e`; check the build's entry chunk has not grown by more than 40 kB over `main`'s (code only) and that each data file is a chunk of its own.
- [ ] Screenshots of the Poster theme with everything on, on Bonne and two more, compared by eye with the mockup; fix what falls short.
- [ ] `docs/ideas.md`: mark the first print round and the names done, with what was built and what was left out. Commit: `docs: the atlas layers are in`.
