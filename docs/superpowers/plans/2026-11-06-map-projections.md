# Map Projections Explorer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A static web app showing one large animated map that morphs between projections, with true Tissot indicatrices, slider-driven projection families, re-centring and tilt, and great-circle drawing tools.

**Architecture:** Geometry is cut once per morph on the sphere, at the seams and coverage caps of every projection involved. Each resulting point gets a source and a destination screen position in typed arrays, so a morph frame is only a linear blend plus a Canvas 2D draw. Live changes (dragging, sliders) rebuild the same structure with no destination. All projection maths are pure modules tested with Vitest; the UI is plain DOM, tested with Playwright.

**Tech Stack:** TypeScript, Vite, Vitest, Playwright, `d3-geo`, `d3-geo-projection`, `d3-geo-polygon`, Canvas 2D.

**Spec:** `docs/superpowers/specs/2026-11-06-map-projections-design.md`

## Global Constraints

- No UI framework. No backend, no network calls at runtime; land data is bundled.
- Non-goals stay out: no split-screen, no export, no saving, no labels, no measuring tools.
- The app opens on the globe.
- Morph duration 1400 ms with cubic ease-in-out, inside the spec's 1 to 2 seconds.
- Point motion is a straight screen-space line from source to destination. Fading is used only for geometry leaving or entering a projection's coverage.
- Lines, polygon edges and circles are stored as latitude and longitude, never as screen coordinates.
- Longitude and latitude are degrees at module boundaries, radians only inside raw projections.
- Vite `base` is `/map-projections/`.

## Review Focus

1. Clicking outside the map, or during a morph: no point is placed and nothing throws.
2. Degenerate drawings: double-clicks that duplicate a point, polygons with fewer than 3 distinct points, and a line between exact antipodes must not produce NaN or a broken shape.
3. Typed values that are blank, non-numeric, or out of range (longitude 999): longitude wraps, latitude and tilt clamp, non-numbers revert.
4. Rapid list clicks, clicking the current projection, and slider or drag input during a morph: no jumps, and no stuck morph.
5. Resizing the window, or a high-DPI screen: the map refits and stays sharp, including mid-morph.

Each has a test in its owning task.

## Design decisions made here

The spec leaves these to the builder.

- **Canvas 2D, not WebGL.** Land is under 5,000 points. Fills use non-zero winding, so they stay correct as seams move, with no triangulation. Task 11 measures this.
- **Painter's order instead of 3D interpolation for the globe.** The globe's far hemisphere is a "behind" piece drawn first, and the near hemisphere's ocean covers it at `t = 0`. As points move, the far side swings out from behind. This gives the peel with no depth buffer.
- **Dragging holds tilt constant.** Newton iteration solves for the centre that puts the grabbed point under the cursor. Tilt therefore stays in the slider's range and the outline does not spin during a drag.
- **Fading pieces.** Geometry outside a projection's coverage is split into its own piece and moves to the coverage edge while fading. Per-vertex alpha is not needed.

## File Structure

```
src/geo/orientation.ts        Orientation, geographic <-> frame rotation
src/geo/cut.ts                cutGeometry: splits geometry at caps and seams
src/projections/types.ts      Shared projection types
src/projections/raws.ts       Custom raws: perspective, cylindrical family, Goode lobes
src/projections/catalog.ts    All ProjectionDefs, named Stops, notes
src/projections/compile.ts    compile(state) -> CompiledProjection, matchStop
src/screen/screen.ts          computeScreen (fit), projectPoint, screenToLonLat, dragTo
src/morph/scene.ts            buildScene, typed arrays
src/morph/controller.ts       MorphController: timing, redirect, member weights
src/tissot/indicatrix.ts      jacobian, indicatrix list
src/drawing/model.ts          Shapes, undo, GeoJSON conversion
src/render/draw.ts            Draws a Scene to a 2D context
src/render/locator.ts         Locator globe
src/ui/*.ts                   sidebar, sliders, projection list, drawing tools
src/app.ts, src/main.ts       Store and wiring
tests/*.test.ts, e2e/*.spec.ts
```

---

### Task 1: Scaffold, orientation and projection catalog

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.ts`, `src/geo/orientation.ts`, `src/projections/types.ts`, `src/projections/raws.ts`, `src/projections/catalog.ts`, `src/projections/compile.ts`
- Test: `tests/orientation.test.ts`, `tests/catalog.test.ts`

**Interfaces:**
- Produces:

```ts
type LonLat = [number, number];                 // degrees
type Orientation = { lon: number; lat: number; tilt: number };
type Params = Record<string, number>;
type RawFn = (lambda: number, phi: number, lobe?: number) => [number, number]; // radians, y north-positive
type ExcludedCap = { frameCenter: LonLat; radius: number; mode: 'clip' | 'behind' }; // degrees
type Lobe = { lonMin: number; lonMax: number; latMin: number; latMax: number; centralLon: number };
type Seam = { kind: 'none' } | { kind: 'antimeridian' } | { kind: 'lobes'; lobes: Lobe[] };

interface ProjectionDef {
  id: string; family: string; defaultParams: Params; defaultOrientation: Orientation;
  tiltEnabled: boolean; latEnabled: boolean;
  raw(p: Params): RawFn; caps(p: Params): ExcludedCap[]; seam: Seam;
}
interface Stop { id: string; name: string; family: string; note: string; defId: string; params: Params; tilt?: number; ignoreParams?: string[] }
interface ProjectionState { defId: string; params: Params; orientation: Orientation }
interface CompiledProjection { def: ProjectionDef; state: ProjectionState; raw: RawFn; caps: ExcludedCap[];
  toFrame(p: LonLat): LonLat; fromFrame(p: LonLat): LonLat }

toFrame(o: Orientation, p: LonLat): LonLat            // orientation.ts
fromFrame(o: Orientation, p: LonLat): LonLat
compile(state: ProjectionState): CompiledProjection   // compile.ts
stateForStop(stop: Stop, from?: ProjectionState): ProjectionState
matchStop(state: ProjectionState): Stop | null
```

- [ ] **Step 1: Scaffold.** `npm init`, then install runtime `d3-geo@^3`, `d3-geo-projection@^4`, `d3-geo-polygon@^2`, `topojson-client@^3`, `world-atlas@^2`, and dev `typescript`, `vite`, `vitest`, `@types/d3-geo`, `@types/topojson-client`, `@playwright/test`. Check the versions resolve with `npm ls --depth=0` and use what resolves. A `.d.ts` shim is fine for packages without types. Add scripts `dev`, `build`, `test`, `e2e`.

- [ ] **Step 2: Write the failing tests**

```ts
test('frame round trip', () => { /* for several orientations and points,
  fromFrame(o, toFrame(o, p)) equals p within 1e-9 */ });
test('centre maps to frame origin', () => expectLonLat(toFrame({lon:40,lat:20,tilt:30},[40,20]), [0,0]));
test('every stop compiles to finite positions at 200 random frame points outside its caps', ...);
test('perspective raw hits the three named azimuthals', () => {
  // for c = 0.2, 0.6, 1.2 radians at lambda=0, phi=pi/2-c, centred-pole-free radial check:
  // P=0 -> tan c; P=1 -> 2 tan(c/2); P=Infinity -> sin c
});
test('cylindrical family stops', () => {
  // spacing 2: phi0 0, 30, 45 equal geoCylindricalEqualAreaRaw(phi0) at sample points
  // spacing 0, phi0 0 equals geoMercatorRaw; spacing 1, phi0 0 equals geoEquirectangularRaw
});
test('Goode lobes match d3', () => /* raw with the correct lobe equals geoInterruptedHomolosine scale(1) translate(0,0), y flipped, at 50 points */);
test('matchStop finds every named stop and returns null for spacing 0.5', ...);
test('Mercator stop matches at any phi0; tilt 90 matches Transverse Mercator', ...);
test('conic parallels at 0/0 match Mercator; ±45 equal-area matches Gall-Peters', ...);
```

- [ ] **Step 3: Run tests.** Run: `npx vitest run`. Expected: FAIL, modules not found.

- [ ] **Step 4: Implement `orientation.ts`.** Use `geoRotation([-lon, -lat, tiltGamma])`. The sign of gamma is pinned by the north-up test in Task 2.

- [ ] **Step 5: Implement `raws.ts`.**

```ts
perspectiveRaw(P): r = (P + 1) * sin(c) / (P + cos(c)), r = sin(c) when P is Infinity; x, y from azimuth
cylindricalRaw(phi0, spacing): x = lambda * cos(phi0)
  stops of y: spacing 0: mercator(phi) * cos(phi0); 1: phi; 2: sin(phi) / cos(phi0)
  between stops, interpolate y linearly
goodeRaw(lambda, phi, lobe): geoHomolosineRaw(lambda - c, phi), x + c, where c = lobe.centralLon
```

Goode lobes: south `[-180,-100] c -160`, `[-100,-20] c -60`, `[-20,80] c 20`, `[80,180] c 140`; north `[-180,-40] c -100`, `[-40,180] c 30`.

- [ ] **Step 6: Implement `catalog.ts`.** Definitions and caps:

| Def | Seam | Caps (degrees, in frame) | Tilt / lat slider |
|---|---|---|---|
| `globe` (orthographic raw) | none | antipode radius 90, `behind` | off / on |
| `perspective` (`x` in [0,1], `P = x/(1-x)`, x=1 is Infinity) | none | antipode, `clip`, radius `180 - limit`; `m = min(P, 1/P)`; `limit = 68 + 97m` for P<1, `90 + 75m` for P>=1 | off / on |
| `azimuthal-equidistant`, `lambert-azimuthal` | none | antipode 0.1 `clip` | off / on |
| `cylindrical` (`phi0`, `spacing`) | antimeridian | both poles `5*(1-s) + 0.1*s` for s<1, else 0.1 | on / on |
| `conic-conformal`, `conic-equal-area` (`p1`, `p2`) | antimeridian | apex pole 0.1. Far pole: conformal `5 + 55|n|`; equal-area `0.1 + 25|n|`, `n` from d3's conic formula | off / off |
| `robinson`, `winkel3`, `equal-earth`, `mollweide`, `sinusoidal`, `hammer` | antimeridian | both poles 0.1 | on / on |
| `goode` | lobes | both poles 0.1 | on / on |

Conic defaults: centre lon 10, lat 0. Albers parallels 29.5 and 45.5; Lambert conformal 33 and 45. Other defaults: centre 0, 0, tilt 0.

Add stops for all named projections in the spec's table. Notes are one sentence on what each preserves and sacrifices; Equal Earth's mentions the UN's non-binding September 2026 "Correct the Map" resolution. Transverse Mercator is the `cylindrical` Mercator stop with `tilt: 90`. Mercator uses `ignoreParams: ['phi0']`.

- [ ] **Step 7: Implement `compile.ts`.** `stateForStop` applies the spec's carry-over rules:
  - The centre carries over, except into or out of conics. Entering a conic uses its default; the pre-conic centre is restored in Task 7's store.
  - A tilt set by hand carries over, unless the destination has tilt disabled.
  - `stop.tilt` overrides.
  - Leaving Transverse Mercator resets tilt to 0.

  `matchStop` compares params within 0.01 and tilt within 0.01.

- [ ] **Step 8: Run tests.** Run: `npx vitest run`. Expected: PASS.

- [ ] **Step 9: Commit.** `git add -A && git commit -m "feat: scaffold, orientation and projection catalog"`

---

### Task 2: Screen fit, inversion and dragging

**Files:**
- Create: `src/screen/screen.ts`
- Test: `tests/screen.test.ts`

**Interfaces:**
- Consumes: `CompiledProjection`, `compile`.
- Produces:

```ts
type Viewport = { width: number; height: number };
type ScreenTransform = { k: number; tx: number; ty: number; cos: number; sin: number };
computeScreen(c: CompiledProjection, v: Viewport): ScreenTransform
projectPoint(c: CompiledProjection, s: ScreenTransform, p: LonLat, lobe?: number): [number, number]
isCovered(c: CompiledProjection, p: LonLat): boolean
lobeOf(c: CompiledProjection, framePoint: LonLat): number | undefined
screenToLonLat(c: CompiledProjection, s: ScreenTransform, xy: [number, number]): LonLat | null
dragTo(c: CompiledProjection, s: ScreenTransform, grabbed: LonLat, cursor: [number, number]): Orientation
```

- [ ] **Step 1: Write the failing tests**

```ts
test('fit: every covered sample lies inside the viewport, and the map touches one axis', ...);
test('fit is independent of centre lon/lat', ...);
test('north-up: at tilt 30, a small step north of the centre moves straight up on screen', ...);
test('transverse: Mercator tilt 90 at centre (0,0): lon 0 meridian is vertical, x within 1e-6 of centre', ...);
test('inverse round trip for every stop: 200 covered points within 0.5 px', ...);
test('screenToLonLat returns null for a point outside the map, e.g. a corner on the globe', ...);
test('dragTo keeps the grabbed point within 1 px of the cursor after a 30 px move, for every stop with free drag', ...);
test('dragTo on Mercator at tilt 0 and lat 0: a purely horizontal move leaves lat at 0', ...);
test('dragTo on a conic changes lon only', ...);
test('dragTo holds tilt, and at lat near 90 it clamps without NaN', ...);
```

- [ ] **Step 2: Run tests.** Run: `npx vitest run tests/screen.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `computeScreen`.** Sample a 3° frame grid, skipping points in any cap and using every lobe. Rotate by the tilt compensation, take the bounding box, and fit with 16 px padding. Screen y is `ty - k * y`.

- [ ] **Step 4: Implement `screenToLonLat`.** Pick the best seed from a cached 5° frame grid, per lobe. Run up to 8 Newton steps with central differences (`h = 1e-4` radians). Accept if the residual is under 0.5 px and the point is covered.

- [ ] **Step 5: Implement `dragTo`.** Up to 3 Newton steps on `(lon, lat)`, or lon only when `latEnabled` is false, with numeric derivatives of `projectPoint(grabbed)` with respect to the centre. Clamp lat to ±90, wrap lon to ±180, hold tilt. If lat is at ±90, keep the previous lon.

- [ ] **Step 6: Run tests.** Run: `npx vitest run tests/screen.test.ts`. Expected: PASS.

- [ ] **Step 7: Commit.** `git add -A && git commit -m "feat: screen fitting, inversion and drag solving"`

---

### Task 3: Cutting geometry at seams and caps

**Files:**
- Create: `src/geo/cut.ts`
- Test: `tests/cut.test.ts`

**Interfaces:**
- Consumes: `CompiledProjection`.
- Produces:

```ts
type Piece = {
  closed: boolean;                 // polygon ring vs line
  coords: LonLat[][];              // geographic, densified to at most 2° per segment
  inside: boolean[];               // per member: outside its clip caps?
  behind: boolean[];               // per member: inside a 'behind' cap?
  lobes: (number | undefined)[];   // per member
};
cutGeometry(geom: GeoJSON.GeoJsonObject, members: CompiledProjection[]): Piece[]
```

- [ ] **Step 1: Write the failing tests**

```ts
// signed area of a ring: a = geoArea(ring); a > 2*PI ? a - 4*PI : a
test('land area is preserved at 3.62789 sr ±1e-3 for one member, each stop, default orientation', ...);
test('land area is preserved through 2 members with different orientations', ...);
test('land area is preserved for Goode with a rotated cylindrical member', ...);
test('no segment exceeds 2°', ...);
test('points on a seam stay on their own side after re-entering the frame', () => {
  // every point of every piece, for a Mercator member: |frame lon| < 180,
  // and consecutive points in one ring never differ by more than 180° of frame lon
});
test('a line crossing the antimeridian comes out as 2 line pieces', ...);
test('identical seams are cut once: same output length with [a] and [a, a]', ...);
test('gnomonic: inside and outside pieces partition land area', ...);
test('Sphere produces at least one closed piece for each stop', ...);
```

- [ ] **Step 2: Run tests.** Run: `npx vitest run tests/cut.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `cutGeometry`.** Process members in order; each step maps pieces to pieces.

```
For each member m:
  rotate to frame, degrees to radians (geoStream emits degrees; clip streams expect radians)
  for each cap: split with geoClipCircle
      clip the kept side around the cap's antipode with radius 180 - r, and the cap side with radius r,
      each wrapped in a rotation that puts the clip centre at the frame's (0,0)
  seam:
      antimeridian: geoClipAntimeridian, then pull |lambda| == PI in by 1e-6 radians,
          so numeric rotation cannot flip the point to the other side
      lobes: geoClipPolygon on each lobe (edges pulled in by 1e-6°); set the piece's lobe for m
  rotate back to geographic
Skip a member's seam step if an earlier member has the same seam and orientation.
Densify at the end: great-circle interpolation (geoInterpolate) to at most 2° per segment.
```

`geoClipPolygon` expects polygons in degrees and a radians stream. The throwaway spike confirmed that this chain partitions land area exactly.

- [ ] **Step 4: Run tests.** Run: `npx vitest run tests/cut.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat: cut geometry at projection seams and caps"`

---

### Task 4: True Tissot indicatrices

**Files:**
- Create: `src/tissot/indicatrix.ts`
- Test: `tests/indicatrix.test.ts`

**Interfaces:**
- Consumes: `projectPoint`, `isCovered`, `lobeOf`.
- Produces:

```ts
type Mat2 = [number, number, number, number];
type Member = { compiled: CompiledProjection; screen: ScreenTransform; weight: number };
const INDICATRIX_RADIUS: number;                         // 5° in radians
jacobian(c: CompiledProjection, s: ScreenTransform, p: LonLat): Mat2 | null   // px per radian of true distance
indicatrixCentres(): LonLat[]                            // every 30° from -60 to 60, plus both poles
blendIndicatrix(members: Member[], p: LonLat): { pos: [number, number]; mat: Mat2 } | null
```

- [ ] **Step 1: Write the failing tests**

```ts
const axes = (m: Mat2) => /* singular values */;
test.each(['mercator','stereographic','lambert-conic'])('%s is conformal: axis ratio 1 ±1e-3, default and oblique', ...);
test.each(['mollweide','equal-earth','sinusoidal','hammer','albers','lambert-azimuthal','goode','gall-peters'])(
  '%s is equal-area: product of axes is constant ±1e-3 across covered centres, default and oblique', ...);
test('Mercator scale: axis at 60° latitude is twice the axis at the equator', ...);
test('mid-morph matrix equals a numeric derivative of the interpolated map', () => {
  // members Mercator 0.3, Mollweide 0.7: blendIndicatrix(...).mat vs central difference of
  // 0.3*pos_a + 0.7*pos_b at (20, 35), within 1e-3 relative
});
test('a point inside a clip cap, or on the globe far side, gives null', ...);
test('poles exist on azimuthal maps and are skipped on Mollweide', ...);
test('seam: on Mercator at lon 179.99, no huge stretch from straddling the cut', ...);
```

- [ ] **Step 2: Run tests.** Run: `npx vitest run tests/indicatrix.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `jacobian`.** Build two orthonormal tangent vectors at `p`: east and north, or any basis at a pole. Step along great circles by `h = 1e-4` radians in both directions, project, and central-difference. If one side jumps, meaning its distance exceeds 10 times the other's, use the other side only. Fix Goode to the centre's lobe. Return null for non-finite values or a point not covered.

- [ ] **Step 4: Implement `blendIndicatrix`** as the weighted sum of positions and matrices. Skip a null member by treating its alpha as absent; if any member is null the morph fades it, as described in Task 5. If all are null, return null.

- [ ] **Step 5: Run tests.** Run: `npx vitest run tests/indicatrix.test.ts`. Expected: PASS.

- [ ] **Step 6: Commit.** `git add -A && git commit -m "feat: true Tissot indicatrices from the local derivative"`

---

### Task 5: Scene and morph controller

**Files:**
- Create: `src/morph/scene.ts`, `src/morph/controller.ts`
- Test: `tests/scene.test.ts`, `tests/controller.test.ts`

**Interfaces:**
- Consumes: `cutGeometry`, `projectPoint`, `Member`, `blendIndicatrix`.
- Produces:

```ts
type ScenePiece = { closed: boolean; src: Float32Array; dst: Float32Array; ringStarts: Uint32Array;
                    alphaSrc: number; alphaDst: number; behind: boolean };
type SceneIndicatrix = { srcPos: [number,number]; dstPos: [number,number]; srcMat: Mat2; dstMat: Mat2; alphaSrc: number; alphaDst: number };
type Scene = { layers: Record<string, ScenePiece[]>; indicatrices: SceneIndicatrix[] };
buildScene(layers: Record<string, GeoJSON.GeoJsonObject>, source: Member[], target: Member | null, withTissot: boolean): Scene

class MorphController {
  constructor(now: () => number);
  readonly isMorphing: boolean;
  source(): Member[]; target(): Member | null; t(): number;     // t is eased
  jumpTo(m: Member): void;                                      // live update, no morph
  morphTo(m: Member): void;                                     // begin or redirect
  tick(): boolean;                                              // true while a frame is needed
  resize(fn: (m: Member) => Member): void;
}
```

- [ ] **Step 1: Write the failing tests**

```ts
test('at t=0 src equals projectPoint under the source; at t=1 dst under the target', ...);
test('points outside a clip cap move to the cap edge, and alpha goes to 0', () => {
  // Mollweide to gnomonic: outside piece has alphaSrc 1, alphaDst 0,
  // dst positions at distance limit from the frame centre
});
test('globe far side: behind true, alpha 1, src position is orthographic', ...);
test('no NaN in any array for any pair of stops (all ordered pairs)', ...);
test('no streak: no segment in dst longer than 25% of the viewport diagonal, except Mercator poles', ...);
test('controller: t follows cubic ease-in-out over 1400 ms and tick returns false at the end', ...);
test('redirect: positions just after morphTo during a morph equal positions just before, within 1 px', ...);
test('redirect: at most 4 source members, weights sum to 1', ...);
test('morphTo the current state is a no-op: no morph starts', ...);
test('ten morphTo calls in 100 ms settle exactly on the last target', ...);
test('resize mid-morph keeps t and refits both ends', ...);
```

- [ ] **Step 2: Run tests.** Run: `npx vitest run tests/scene.test.ts tests/controller.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `buildScene`.**
  - Call `cutGeometry` with source members plus the target.
  - A piece's source position is the weighted sum over source members. For a member with `inside` false, use the point moved radially from the cap centre to the cap's edge.
  - `alphaSrc` is the weight-sum of members where the piece is inside or behind. `alphaDst` is 1 or 0 by the same test on the target.
  - `behind` is true if any member has it behind. With no target, drop behind pieces, since they would be covered anyway.
  - Indicatrix alpha follows the same rule, using `blendIndicatrix` per end.

- [ ] **Step 4: Implement `MorphController`.** `morphTo` during a morph captures current weights: `(1-t)·sources + t·target`, drops weights under 0.01, keeps the largest 4, renormalises, and restarts at `t = 0`.

- [ ] **Step 5: Run tests.** Expected: PASS.

- [ ] **Step 6: Commit.** `git add -A && git commit -m "feat: morph scene and controller"`

---

### Task 6: Canvas rendering and the opening globe

**Files:**
- Create: `src/render/draw.ts`, `src/app.ts`, `src/data/land.ts`
- Modify: `src/main.ts`, `index.html`
- Test: `e2e/render.spec.ts`, `playwright.config.ts`

**Interfaces:**
- Consumes: `buildScene`, `MorphController`, `compile`, `computeScreen`.
- Produces:

```ts
drawScene(ctx: CanvasRenderingContext2D, scene: Scene, t: number, style: Style): void
class App {                                     // the single store
  state: ProjectionState; viewport: Viewport; tissot: boolean; shapes: Shape[];
  subscribe(fn: () => void): void;
  select(stop: Stop): void;                     // morph
  setLive(patch: Partial<ProjectionState>): void; // no morph, ignored while morphing
  setTissot(on: boolean): void;
  invalidateGeometry(): void;
}
```

`window.__app = app` is exposed for tests.

- [ ] **Step 1: Write the failing test**

```ts
test('opens on the globe with no console errors', async ({page}) => {
  // goto '/', wait for canvas, read pixels: centre is land or ocean colour, corners are background;
  // expect app.state.defId === 'globe'
});
test('canvas backing store matches devicePixelRatio 2', ...);
test('resizing the window refits the map, including mid-morph', async ({page}) => {
  // setViewportSize during a morph, wait: the map's bounding box fits the new canvas
});
```

- [ ] **Step 2: Run.** Run: `npx playwright install chromium && npm run e2e`. Expected: FAIL.

- [ ] **Step 3: Implement `land.ts`.** Import `world-atlas/land-110m.json`. Export `LAND` (feature), `COAST` (mesh), `GRATICULE` (10°).

- [ ] **Step 4: Implement `drawScene`.** For the behind group, then the front group:

  1. Ocean fill.
  2. Land fill, with a 0.5 px same-colour stroke to hide hairlines at seams.
  3. Graticule.
  4. Coast.
  5. Drawings.
  6. Front group only: indicatrices.

  A piece with `alpha = (1-t)·alphaSrc + t·alphaDst` at 0 is skipped. Blend positions into a reused path. Draw an indicatrix with `ctx.setTransform` from `(1-t)·srcMat + t·dstMat` scaled by `INDICATRIX_RADIUS`, then `arc`, then reset. Style is restrained, with drawn shapes and indicatrices in a strong accent colour.

- [ ] **Step 5: Implement `App`.** Geometry layers are `ocean`, `land`, `graticule`, `coast`, `drawings`. Rebuild the scene when state or shapes change, or on morph start. Morph frames only blend. Run `requestAnimationFrame` only while something is pending. Use `ResizeObserver`, and size the canvas by `devicePixelRatio`.

- [ ] **Step 6: Run.** Run: `npm run e2e`. Expected: PASS. Take a screenshot and look at it.

- [ ] **Step 7: Commit.** `git add -A && git commit -m "feat: render the opening globe to canvas"`

---

### Task 7: Projection list and family sliders

**Files:**
- Create: `src/ui/sidebar.ts`, `src/ui/slider.ts`, `src/ui/projectionList.ts`, `src/style.css`
- Modify: `src/app.ts`, `index.html`
- Test: `tests/slider.test.ts`, `e2e/projections.spec.ts`

**Interfaces:**
- Consumes: `App`, `Stop`, `matchStop`.
- Produces:

```ts
createSlider(opts: { label: string; min: number; max: number; step: number; value: number; stops?: number[];
  snap?: number; parse?: (raw: string) => number | null; format?: (v: number) => string;
  defaultValue: number; onInput(v: number): void }): { el: HTMLElement; set(v: number): void; setEnabled(on: boolean): void };
snapValue(v: number, stops: number[], tolerance: number): number
normaliseLon(v: number): number; clampLat(v: number): number; clampTilt(v: number): number
```

- [ ] **Step 1: Write the failing tests**

```ts
test('snapValue snaps inside the tolerance and not outside', ...);
test('normaliseLon(999) === -81, clampLat(100) === 90, clampTilt(-5) === 0', ...);
// e2e
test('clicking a family opens it and shows only its sliders', ...);
test('clicking Mollweide morphs: state changes at once, canvas settles after 1400 ms', ...);
test('moving the spacing slider to 0 highlights Mercator; 0.5 shows Custom', ...);
test('moving the viewpoint slider through gnomonic, stereographic and orthographic highlights each', ...);
test('moving Albers parallels to 45/-45 highlights Gall-Peters with the conic indication', ...);
test('slider reaching a stop gives the same map as selecting it, by comparing positions', ...);
test('rapid clicks across 5 projections settle on the last with no console errors', ...);
test('slider input during a morph is ignored, and the morph completes', ...);
test('conic round trip restores the centre: set lon 50, go to Albers and back, lon is 50', ...);
```

- [ ] **Step 2: Run.** Run: `npx vitest run tests/slider.test.ts && npm run e2e`. Expected: FAIL.

- [ ] **Step 3: Implement the sidebar, list and sliders.**
  - Family sliders are shown as in the spec's table.
  - The list highlights `matchStop(state)`; with none, the family shows "Custom".
  - The viewpoint slider's axis is `x`.
  - The conic stops list includes Mercator, Gall-Peters, polar stereographic and polar Lambert azimuthal equal-area as "reached from conic" indications. Parallels clamp to ±89.9.
  - Add the Tissot toggle and its one-sentence note.
  - Each projection's note is shown under the list.

- [ ] **Step 4: Add pre-conic centre memory to `App.select`.** Add it to `App`, per the state rules in the spec.

- [ ] **Step 5: Run.** Expected: PASS.

- [ ] **Step 6: Commit.** `git add -A && git commit -m "feat: projection list and family sliders"`

---

### Task 8: Centre and tilt controls, map dragging

**Files:**
- Create: `src/ui/orientationControls.ts`, `src/ui/mapPointer.ts`
- Modify: `src/ui/sidebar.ts`, `src/app.ts`
- Test: `e2e/orientation.spec.ts`

**Interfaces:**
- Consumes: `createSlider`, `dragTo`, `screenToLonLat`, `App.setLive`.
- Produces: `attachMapPointer(canvas, app, { onClick(xy): void })`. A press that moves less than 4 px is a click. `onClick` is called only when no morph is running.

- [ ] **Step 1: Write the failing tests**

```ts
test('longitude, latitude and tilt sliders and number fields stay in sync', ...);
test('typing 999 in longitude gives -81; blank or "abc" reverts; 100 in latitude gives 90', ...);
test('each reset restores its default; reset-all restores all three', ...);
test('tilt snaps at 0 and 90 and is disabled on globe, azimuthals and conics', ...);
test('latitude is disabled on conics', ...);
test('dragging keeps the grabbed point under the cursor within 2 px on globe, Mercator and tilted Mollweide', ...);
test('tilt slider to 90 on Mercator highlights Transverse Mercator; moving away highlights Mercator', ...);
test('selecting Mercator from Transverse Mercator returns tilt to 0', ...);
test('dragging during a morph does nothing, and the morph completes', ...);
test('gnomonic: a drawn line stays straight while the centre is dragged', () => {
  // via app: add a line, drag, sample positions: max deviation from a straight chord under 0.5 px
});
```

- [ ] **Step 2: Run.** Run: `npm run e2e -- orientation`. Expected: FAIL.

- [ ] **Step 3: Implement.** Slider, field and reset for each value. The reset-all button. Pointer handling with pointer capture and `dragTo`. A cursor outside the map keeps the last solved orientation.

- [ ] **Step 4: Run.** Expected: PASS.

- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat: centre and tilt controls and map dragging"`

---

### Task 9: Drawing tools

**Files:**
- Create: `src/drawing/model.ts`, `src/ui/drawingTools.ts`
- Modify: `src/app.ts`, `src/ui/sidebar.ts`
- Test: `tests/drawing.test.ts`, `e2e/drawing.spec.ts`

**Interfaces:**
- Consumes: `attachMapPointer`, `screenToLonLat`, `App.invalidateGeometry`.
- Produces:

```ts
type Shape = { kind: 'line' | 'polygon'; points: LonLat[] } | { kind: 'circle'; center: LonLat; radiusDeg: number };
class DrawingModel {
  tool: 'none' | 'line' | 'polygon' | 'circle';
  shapes: Shape[]; draft: Shape | null;
  addPoint(p: LonLat): void; preview(p: LonLat | null): void;
  finish(): void; cancel(): void; undo(): void; clear(): void;
}
shapeToGeoJSON(s: Shape): GeoJSON.GeoJsonObject
radiusKm(deg: number): number    // 6371 km sphere
```

- [ ] **Step 1: Write the failing tests**

```ts
test('consecutive points closer than 0.01° are merged, so a double-click adds one point', ...);
test('finish on a line with 1 distinct point discards it; polygon with 2 discards it', ...);
test('line between exact antipodes produces finite coordinates after cutting', () => {
  // [0,0]-[180,0] must not produce NaN in cutGeometry output; it takes the arc d3 interpolation gives,
  // or is nudged by 1e-6°
});
test('polygon that winds the long way is reversed, so geoArea <= 2*PI', ...);
test('polygon enclosing the pole keeps area below a hemisphere and covers the pole', ...);
test('circle GeoJSON has the correct area: 2*PI*(1-cos r)', ...);
test('circle with radius above 90° is not flipped', ...);
test('undo removes the last point, then the last shape; clear removes all', ...);
test('radiusKm(1) is about 111.2', ...);
// e2e
test('Enter and double-click finish, Escape cancels', ...);
test('a click outside the map places no point', ...);
test('a click during a morph places no point', ...);
test('a shape drawn on the globe appears on Mercator and survives a morph', ...);
test('drag with a tool active moves the map and adds no point', ...);
test('circle tool shows a km readout while previewing', ...);
test('a line crossing the antimeridian is broken at the seam: no segment wider than half the map', ...);
```

- [ ] **Step 2: Run.** Expected: FAIL.

- [ ] **Step 3: Implement the model and tools.** Draft shapes are drawn in the `drawings` layer, with a rubber band to the cursor. Rebuilding the `drawings` pieces per pointer move must not re-cut land: cache the other layers' pieces in `buildScene`.

- [ ] **Step 4: Run.** Expected: PASS.

- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat: line, polygon and circle drawing tools"`

---

### Task 10: Locator globe

**Files:**
- Create: `src/render/locator.ts`
- Modify: `src/app.ts`, `index.html`, `src/style.css`
- Test: `e2e/locator.spec.ts`

**Interfaces:**
- Consumes: `App`, `CompiledProjection`, `shapeToGeoJSON`.
- Produces: `createLocator(container: HTMLElement, app: App): void`

- [ ] **Step 1: Write the failing tests**

```ts
test('hidden on the globe, visible on other projections', ...);
test('dragging the centre marker changes centre, holds tilt, and moves the map', ...);
test('it shades excluded caps on gnomonic and shades nothing visible on Mollweide', ...);
test('it draws a shape in full on gnomonic even when the main map clips it', ...);
```

- [ ] **Step 2: Run.** Expected: FAIL.

- [ ] **Step 3: Implement.** A small canvas with `geoOrthographic` and `geoPath`, centred on the map's centre. It shows land, shaded caps (`geoCircle` in frame coordinates, converted with `fromFrame`), the frame's equator and poles, drawings and a centre marker. During a morph it shows the target's coverage.

- [ ] **Step 4: Run.** Expected: PASS.

- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat: locator globe"`

---

### Task 11: Full verification and publishing

**Files:**
- Create: `e2e/quality.spec.ts`, `README.md`, `.github/workflows/pages.yml`
- Modify: `vite.config.ts`

- [ ] **Step 1: Write the tests**

```ts
test('every ordered pair of stops morphs with no console error or NaN', ...);
test('performance: a Mercator to Mollweide morph with Tissot and 3 shapes averages under 20 ms per frame', ...);
test('performance: dragging on the same scene averages under 20 ms per frame', ...);
```

- [ ] **Step 2: Run everything.** Run: `npm test && npm run e2e && npm run build`. Expected: all pass. Report measured frame times. If they miss the 60 fps target on a real browser (run Playwright headed once), stop and report it rather than loosening the threshold. WebGL is the fallback the spec allows, and that is a decision to raise.

- [ ] **Step 3: Check by eye.** Run the app, and capture morph frames for globe to Mercator, Mercator to Goode, Goode to gnomonic, and gnomonic to Albers. Look for streaks, jumps and bad fills, and fix what you find.

- [ ] **Step 4: Add the Pages workflow and README.** Workflow: on push to `main`, `npm ci && npm run build`, upload `dist`, deploy with `actions/deploy-pages`. README: what the app is, how to run it, and a link to the site.

- [ ] **Step 5: Commit.** `git add -A && git commit -m "chore: quality checks, README and Pages deployment"`

- [ ] **Step 6: Publish.** This needs the GitHub repo `Toribash67/map-projections`, which the owner has to create or authorise first. Push `main`, enable Pages with GitHub Actions as its source, confirm that the workflow passes, and load the live URL.
