# Map Projections Explorer, round two: Design

Builds on `2026-11-06-map-projections-design.md`. Where the two disagree, this one wins.
Source of the requests: `docs/ideas.md`. Items marked *(our call)* were decided by the
builder, not by the owner, and are open to veto.

## Intent

Version one proved the core: any projection morphs into any other, with true Tissot
indicatrices and drawings that ride along. Round two makes the motion more honest
(related maps slide through real in-between maps, nothing fades in or out), makes the
app something you can inspect and take output from (zoom, layers, colours, export),
widens the catalogue to interrupted and polyhedral maps, and clears the sidebar of prose.

## Goals

1. Related maps change by sliding their parameters, so every frame is a real map.
2. Resets and typed values move the map with a morph, never a jump.
3. No time-based fading in any transition.
4. Zoom in on any map.
5. Layers (political map, standard parallels and others) and custom colours.
6. Export the current map as PNG or SVG, in detail fit for large prints.
7. The corner globe shows the surface the map is projected onto, from a fixed view.
8. Shapes drawn on a flat map are straight on that map.
9. New projections: double hemisphere, Peirce quincuncial, Cahill butterfly and a few
   more. Orthographic goes; the globe gains a view distance.
10. A sidebar with no descriptive text. Explanations move to tooltips.
11. Fix what a review of the current code turned up (listed at the end).

## Non-goals

- Side-by-side comparison, accounts, a backend, sharing links.
- Place names, rivers, lakes, relief, satellite imagery.
- Editing or selecting individual shapes after they are drawn.
- Projections whose faces are not bounded by meridians and parallels (Dymaxion,
  Waterman). The cutting machinery works on longitude and latitude rectangles; these
  would need a new one.

## Anti-goals

The first design's still hold: nothing jumps, pops or cross-fades; no stray artefacts;
distortion is never drawn wrongly. Added:

- A sidebar that needs scrolling on a 13-inch laptop to reach a control that applies
  to the map on screen.
- An exported file that differs from what the screen shows in anything but resolution.

## Behaviour

### 1. Slides

When the map on screen and the map asked for share a definition (the same raw
projection formula), the change is a **slide**: parameters, centre and tilt are
interpolated, and each frame is rebuilt live as a real map, the path the sliders use.

- Covers: Mercator and Transverse Mercator (tilt), all cylindrical stops (spacing and
  standard parallel), gnomonic and stereographic (viewpoint), Albers at other
  parallels, the globe's view distance, and any change of centre or tilt alone.
- Same 1400 ms cubic ease-in-out as a morph.
- The centre travels along the great circle between old and new, the shorter way.
  Tilt and parameters go linearly. *(our call)*
- Different definitions use the ordinary morph. That includes conformal to equal-area
  conic, and pairs that meet only at a conic limit, such as Albers to Gall-Peters.
  *(our call: one rule, no special cases)*
- A new choice mid-slide starts from the in-between map, which is a real map: a slide
  if the new target shares its definition, an ordinary morph otherwise.
- The corner globe follows a slide frame by frame.

What triggers a slide rather than an instant change:

- Choosing a projection of the same definition from the list.
- Every reset button, and reset all.
- A value typed into a number box. *(our call)*
- A click on the corner globe (section 7).

Dragging a slider or the map stays immediate. Touching a slider or dragging the map
during a slide stops the slide where it is and takes over. During an ordinary morph
such input is still ignored, as now.

The conic "Preserves" switch currently jumps between conformal and equal-area. It
becomes an ordinary morph.

### 2. No fading

Nothing changes opacity over the course of a morph because it is arriving or leaving.
What one map cannot show is already folded onto that map's boundary, where it has no
area, so it is drawn at full strength throughout and simply closes up.

- Fills and lines: the alpha curves go. Lines folded onto a boundary must not leave a
  visible trace along it on the last frames that then vanishes when the morph settles.
- Indicatrices: where one end cannot show an indicatrix, it is drawn with the true
  derivative of the folded map there, which flattens it onto the boundary. Copies
  across a seam travel from their place on one map to their place on the other as
  halves of the same ellipse. No alpha curve.
- An indicatrix is drawn as a translucent ellipse with no outline, as in most
  published figures. *(owner's request)*
- The existing soft edge for indicatrices near a boundary **at rest** stays. It depends
  on position, not time, and stops ellipses popping while the map is dragged.

### 3. Zoom

- Mouse wheel and trackpad pinch zoom about the cursor. Two-finger pinch on touch.
  Buttons on the map: zoom in, zoom out, fit. Keys `+`, `-`, `0`.
- Range: fit (1×) to 32×. Line widths stay constant on screen.
- **Dragging keeps its meaning at every zoom: it moves the map's centre.** Panning the
  zoomed view without changing the projection is Shift-drag, middle-button drag, or a
  two-finger drag on touch. The view cannot be panned off the map. *(our call; see
  "Decisions for the owner")*
- Switching projection while zoomed keeps the place at the middle of the window in the
  middle, if the new map shows it; otherwise the view returns to fit.
- Indicatrices get smaller and more closely spaced as zoom rises, so there are always
  several in view. *(our call)*
- When zoomed past about 3× and at rest, the map redraws with 1:50m coastlines.
  Dragging and morphs use 1:110m. *(our call)*

### 4. Layers and colours

A Layers panel, opened from a button on the map. Each layer has a toggle:

| Layer | Default | Notes |
|---|---|---|
| Land | on | |
| Coastline | on | |
| Graticule | on | Step of 10°, 15° or 30° |
| Country borders | off | Natural Earth, from `world-atlas` countries |
| Political colours | off | Each country filled; neighbours never share a colour |
| Tissot indicatrices | off | Also on key `T` |
| Standard lines | off | Section 5 |
| Reference circles | off | Equator, tropics, polar circles *(our call to include)* |
| Drawings | on | |

All layers take part in morphs and slides like everything else.

Colours:

- Themes: Auto (the current paper look, following the system's light or dark), Light,
  Dark, Atlas (classic pastel political), Blueprint, and Print (white, black and one
  accent, for paper). *(our call on the set)*
- Each main colour can be overridden with a picker: sea, land, coast, graticule,
  borders, accent, background. Reset returns to the theme.
- Layer and colour choices are remembered in the browser between visits.

### 5. Standard lines

One layer that shows where the map's scale is true: the two standard parallels of a
conic, and the pair at plus and minus the standard parallel of a cylindrical map. Drawn
in a second accent colour, they follow the sliders live and tilt with the map. The
toggle is unavailable where the projection has none. *(our call to cover cylindricals
as well as conics)*

### 6. Export

An Export button on the map opens a small panel:

- Format: PNG or SVG.
- Extent: the whole map, or the current zoomed view.
- Size: for PNG, width in pixels with presets (screen, 4K, A3 and A1 at 300 dpi). SVG
  is resolution-free.
- Detail: 1:110m, 1:50m (default) or 1:10m coastlines and borders, loaded on demand so
  the app's start-up size is unchanged.
- Background: as on screen, or transparent.

The file shows exactly the layers and colours on screen: no corner globe, no controls.
SVG output is real vector paths grouped by layer, so it can be edited in Illustrator
or Inkscape. Export is unavailable while a morph runs.

### 7. The corner globe

- The globe no longer turns with the map. Its view is fixed, and the map's centre
  marker, coverage and projection surface move over it.
- Dragging the corner globe orbits its camera, so the far side can be seen.
  Double-click restores the default view. A click on the globe moves the map's centre
  there, with a slide. *(our call: this replaces "drag the corner globe to move the
  centre")*
- A toggle shows the **projection surface**, drawn as a wireframe with the parts
  behind the Earth dashed:
  - Cylindrical: a cylinder, touching at the equator or cutting through at the
    standard parallels, tilting with the tilt slider.
  - Conic: a cone through the two standard parallels. It opens into a cylinder and
    flattens into a disc at the slider limits.
  - Azimuthal: a plane touching at the centre. Perspective maps also show the point
    the rays come from and a few rays.
  - Globe: nothing; the corner globe stays hidden on the globe, as now.
  - Cahill butterfly: an octahedron.
  - Everything else (pseudocylindrical, compromise, Peirce, double hemisphere): no
    surface, since none exists. The toggle is unavailable. The map's own equator and
    central meridian are drawn, as now.
- Larger than today (about 180 px), and collapsible.

### 8. Drawing straight on the map

A switch in the drawing toolbar: **shapes follow the map** or **shapes follow the
globe**. *(our call to keep both; the idea asked only for the first)*

- Follow the map (default on every flat map): a line or polygon edge is straight on
  the map it is drawn on. A circle is a circle on that map. Switch projection and they
  bend.
- Follow the globe (the only choice on the globe): today's behaviour. Edges are
  great-circle arcs and circles are true circles with a radius in kilometres.
- Either way a finished shape is stored as points on the Earth, so it morphs and
  exports like any other.
- An edge whose straight path would leave the map, as across a gap in an interrupted
  map, is refused with a notice. *(our call)*
- A polygon that would cross itself is refused, as now.

### 9. Projections

Added:

| Family | Projection | Notes |
|---|---|---|
| Double hemisphere (new) | Nicolosi globular | Two circles |
| | Stereographic hemispheres | *(our call)* |
| | Equal-area hemispheres | Lambert azimuthal, twice *(our call)* |
| Polyhedral and interrupted (new) | Peirce quincuncial | Conformal square, tiles the plane |
| | Cahill butterfly | Gnomonic octants; great circles are straight within each wing |
| | Goode homolosine | Moved here from Equal-area |
| Compromise | Natural Earth, Van der Grinten, Miller | *(our call)* |
| Equal-area | Eckert IV | *(our call)* |
| Equal-area | Bonne | With a slider from sinusoidal to the heart-shaped Werner *(our call)* |

Removed:

- **Orthographic** as a named azimuthal. The far end of the viewpoint slider still
  reaches it, and the list then highlights Globe, the way a conic limit highlights
  Mercator. *(our call)*
- Nothing else. *(our call: every remaining stop either is widely used or marks a
  slider position)*

Changed:

- **Globe** gains a **view distance** slider: the eye's distance from the Earth's
  centre in Earth radii, from 1.1× to infinity on a non-linear scale, with ticks at 2×,
  6.6× (geostationary) and ∞. Default ∞, which is today's globe. Closer in, less than a
  hemisphere is visible, as in a photograph from orbit.

Tissot indicatrices must be true on the new maps too, including across the folds of
the butterfly, where a small circle becomes two half-ellipses meeting at the crease.

### 10. Layout

The sidebar holds only what chooses and shapes the projection. Everything else moves
onto the map as small floating controls. *(our call throughout)*

- **Sidebar** (260 px):
  - A filter box, then the projection list by family. Each name carries a small tag
    for what it preserves (conformal, equal-area, equidistant, compromise) and its
    note as a tooltip.
  - Below the list, a **Parameters** block for the map on screen: only the sliders
    that apply to it (family parameters, centre, tilt), each with a number box and
    reset, and one reset all. Controls that do not apply are absent, not greyed out
    with an explanation.
  - The block's heading names the map: a stop's name, "Custom", or the limit a conic
    has reached.
- **On the map:**
  - Top left: drawing tools as icon buttons (line, polygon, circle, follow map or
    globe, finish, undo, clear).
  - Top right: Layers, Export.
  - Bottom left: zoom in, zoom out, fit.
  - Bottom right: the corner globe.
- **Removed text:** the projection note panel, the family and orientation hints, the
  Tissot explainer, the drawing hints, and the "at its limits the cone becomes" block.
  The notice for a refused point stays: it is feedback, not description.
- **Tooltips:** every control has one, shown on hover and keyboard focus, with its
  shortcut where it has one. They are the app's own, not the browser's slow `title`.
- **Shortcuts:** `L`, `P`, `C` tools; `T` Tissot; `+`, `-`, `0` zoom; Enter, Escape as now.
- **Narrow screens:** as now, map above and controls below; the floating controls stay
  on the map.

## How it gets made

Unchanged: TypeScript, Vite, Canvas 2D, no UI framework, `d3-geo`, `d3-geo-projection`,
`d3-geo-polygon`, `world-atlas`. No new runtime dependencies are expected. *(our call)*

Notes for the builder, from reading the code:

- A slide is `setLive` with an interpolated state each frame. `App` needs a second
  animation alongside `MorphController`; "same definition" is `defId` equality.
- Zoom is a view transform folded into `ScreenTransform` (`k`, `tx`, `ty`), so
  inversion, dragging and Tissot need no changes of their own.
- New interrupted maps reuse the `lobes` seam. A lobe needs an identity of its own
  rather than its central longitude, because the butterfly's north and south octants
  share one. The Tissot seam code (`tissot/rest.ts`) handles meridian edges only and
  must learn edges along the equator for the butterfly's creases.
- Peirce can be built on `geoGuyouRaw`. Each southern lobe is the northern formula
  reflected in its edge of the inner square, which also gives the continuation past a
  seam that the indicatrix copies need.
- The globe's `behind` cap grows past 90° as the eye comes closer; far-side points
  still land inside the limb, so the peel works as before.
- Export wants `drawScene` to write to something other than a canvas context: a small
  path sink with a canvas and an SVG implementation.
- The e2e suite assumes a 300 px sidebar and reads many class names. Budget for
  updating it with the layout.

## Order of work

Seven stages. The app works and is committed at the end of each.

1. Motion: slides, morphing resets, no fading, the conic switch.
2. Layout: sidebar, floating controls, tooltips, text removed, zoom.
3. Projections: lobe identity, globe distance, the new maps, orthographic out.
4. Layers and colours, standard lines, political map.
5. Drawing that follows the map.
6. Corner globe: fixed view and projection surface.
7. Export.

## Left to the builder

- Tooltip mechanics, icon drawing, exact placement and sizes.
- The political colour palette for each theme.
- How indicatrix size and spacing step with zoom.
- Default centre for Peirce and the butterfly, chosen so the continents sit well.
- Whether the projection surface also morphs between families (cylinder to cone to
  plane is continuous) or switches when an ordinary morph starts.
- Whether to show small outline thumbnails beside projection names.

## Success criteria

- Mercator to Transverse Mercator shows a whole, untorn map on every frame.
- Every reset and typed value produces motion; no control makes the map jump.
- A frame-by-frame capture of globe to gnomonic and back shows no element whose
  opacity changes.
- Every pair of projections, including the new ones, morphs without streaks or jumps.
- Tests: indicatrices are circular on Peirce (away from its four singular points) and
  on stereographic hemispheres, and of constant area on equal-area hemispheres, Eckert
  IV and Bonne.
- A line drawn in "follow the map" is straight to within half a pixel on the map it
  was drawn on, and visibly curved on the globe.
- An SVG export opens in a browser and matches a screenshot of the map; a PNG at A1
  size completes on a typical laptop.
- With political colours and Tissot on, morphs and dragging still hold about 60 frames
  a second.
- On a 1280 × 720 window, every control that applies to the current map is reachable
  without scrolling the sidebar past the projection list.

## Findings from reading the current code

No fault was found in the geometry core (cutting, fitting, inversion, Tissot); it is
careful and well tested (305 unit tests pass, type check clean). What did turn up:

1. The conic "Preserves" switch changes the map instantly. Fixed by section 1.
2. While a morph runs, sliders, typed values and drags are silently dropped, and the
   control snaps back. Eased by section 1 for slides.
3. Resets jump. Fixed by section 1.
4. `build/app` is 32 commits ahead of `main` and has never been pushed. The whole app
   exists only on this machine, and the live site the README links to cannot be
   showing it. Not a code fault, but the largest risk in the repository.
5. No wheel, pinch or second-finger handling on the map. Covered by section 3.
6. The theme can only follow the system. Covered by section 4.
7. Small duplications to fold together while passing: `wrapLon` and `normaliseLon`;
   `smooth`, `ramp`, `dot` and `cross` defined in several files.
8. Tooltips today are browser `title` attributes, which do not appear on touch or
   keyboard focus. Covered by section 10.

## Decisions for the owner

These are the calls most worth a second look before work starts:

1. **Drag while zoomed** moves the map's centre, as at fit; panning is Shift-drag or
   two fingers. The alternative is that drag pans whenever zoomed in.
2. **The corner globe** stops being a handle for the map's centre by dragging. Drag
   orbits it; click sets the centre.
3. **Drawing** keeps great-circle shapes available behind a switch, and applies
   "follow the map" to circles as well as lines.
4. **The catalogue**: the extra additions listed in section 9, and nothing removed but
   orthographic.
