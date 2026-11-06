# Map Projections Explorer: Design

## Intent

A web app for exploring and comparing map projections, and for seeing how each
one distorts the globe in its own way. Understanding comes from watching: pick a
projection, see the world morph into it, and read the distortion from Tissot
indicatrices and from shapes you drew yourself. The central question a user
should be able to answer by playing is "how does a line that is straight on the
globe bend, or not bend, in this projection?"

## Goals

- One large map with a list of projections to choose from, including an actual
  globe. The app opens on the globe.
- Selecting a projection plays a smooth, animated transformation from the
  current one.
- Optional Tissot indicatrices, following the official definition.
- Drawing lines, polygons and circles on the surface. Drawings persist across
  projection changes and take part in every morph.
- Projections grouped by family, where sliders move continuously between related
  projections.
- Moving the projection's centre by dragging or with sliders, with everything
  updating live, plus a tilt control that reaches oblique and transverse aspects.

## Non-goals

- Side-by-side or split-screen comparison. Comparison happens by switching.
- Accounts, a backend, saving to a server, and exporting.
- Labels, place names, satellite imagery, or other base-map detail.
- Measuring tools or GIS features.

## Anti-goals

These would make it a failure even if everything technically works:

- Anything that jumps, pops, or cross-fades through a transition instead of
  visibly moving. The morph is the star of the app.
- Stray artefacts: lines streaking across the map at seams, or geometry shooting
  off to infinity at the edge of a projection.
- Distortion that is drawn incorrectly. Tissot indicatrices and great circles are
  the evidence the app is built on, so they have to be mathematically true.

## Behaviour

### Layout

One big map filling most of the window, with a sidebar holding the projection
list, the sliders, the toggles, and the drawing tools (layout A from the mockups).
Each projection has a short note on what it preserves and what it sacrifices.

### Projections and families

The list is grouped by family. Clicking a family opens it and shows its sliders.
Clicking a named projection plays the usual morph to it.

| Family | Named projections | Sliders |
|---|---|---|
| Globe | Globe | None |
| Azimuthal | Gnomonic, Stereographic, Orthographic | Viewpoint |
| Azimuthal (plain entries) | Azimuthal equidistant, Lambert azimuthal equal-area | None; these are not perspective views |
| Cylindrical | Mercator, Transverse Mercator, Equirectangular, Lambert cylindrical equal-area, Behrmann, Gall-Peters | Standard parallel, vertical spacing, tilt |
| Conic | Albers, Lambert conformal conic | Two standard parallels, conformal or equal-area switch |
| Compromise | Robinson, Winkel Tripel | Tilt |
| Equal-area | Equal Earth, Mollweide, Sinusoidal, Hammer, Goode homolosine | Tilt |

Family sliders:

- **Azimuthal viewpoint.** The point the Earth is projected from, as distance `P`
  from the Earth's centre in Earth radii: 0 is gnomonic, 1 is stereographic, and
  infinity is orthographic, on a non-linear slider. The radial formula is
  `r = (P + 1) sin c / (P + cos c)`, where `c` is the angle from the centre.
  Coverage is `cos c > -min(P, 1/P)`, tightened further by the partial-projection
  rules below.
- **Cylindrical standard parallel.** Moves through Lambert cylindrical equal-area
  (0°), Behrmann (30°) and Gall-Peters (45°) when spacing is at equal-area.
- **Cylindrical vertical spacing.** Moves through Mercator, equirectangular and
  equal-area. In-between positions are valid cylindrical maps with interpolated
  spacing, not established named projections.
- **Conic standard parallels.** Moving both to the equator opens the cone into a
  cylinder: Lambert conformal conic becomes Mercator and Albers becomes cylindrical
  equal-area. Moving both to the pole flattens it into a disc: polar stereographic
  and polar Lambert azimuthal equal-area. This should be made visible.

Slider behaviour:

- Sliders update the map live, with no morph.
- Sliders snap at named stops. The list highlights a name when its parameters are
  reached, and shows "Custom" otherwise. Limits reached from the conic sliders
  highlight the matching name with an indication that it was reached from the
  conic family. *(Our call on exact presentation.)*

Equal Earth's note should mention the UN General Assembly's September 2026
"Correct the Map" resolution, which encouraged its use. *(Builder's call on
wording; the resolution is non-binding and does not ban Mercator.)*

### The morph

- Every point on Earth glides in a straight line from its screen position in the
  old projection to its screen position in the new one, over roughly 1 to 2
  seconds. Coastlines, graticule, Tissot indicatrices and drawings all move
  together.
- Globe to flat: the globe peels open from a seam on its far side and flattens,
  bringing the hidden hemisphere into view. Flat to globe is the same motion in
  reverse. Interpolating points in 3D, with the flat map at depth zero and an
  orthographic view, is the suggested way to get this.
- Seams stay clean during the morph: a cut opens as a clean split, including the
  interruptions of Goode homolosine, which spread apart as the map forms.
- Switching projections mid-morph redirects smoothly from wherever things are.
  *(Our call.)*

### Partial projections

Some projections cannot show the whole Earth, or cannot do so sensibly. This
covers gnomonic, orthographic, Mercator (no poles), and the conics.

- The map stops at a clean boundary. Gnomonic is cut off at a circle about 65 to
  70° from its centre, since a full hemisphere stretches to infinity. Other
  limits are the builder's to set, for sensible-looking maps.
- During a morph, anything that will not fit fades out as it approaches the edge
  and fades back in on the way to a projection that can show it. This is the one
  deliberate use of fading, and nothing flies off the screen.
- A small locator globe sits in a corner. It shades the area the current map
  covers, marks the centre, shows the map's own equator and poles, and always shows
  drawings in full. It is shown for every projection except the globe itself.
  *(Our call.)*
- Drawings are clipped at the boundary but never lost. Moving the centre brings
  the missing parts back.

### Centre and tilt

An orientation has three values: centre longitude, centre latitude, and tilt. The
tilt axis runs through the Earth's centre and the map's centre point, so the centre
longitude and latitude choose where the tilt is applied. No second tilt control is
needed.

- **Controls.** Centre longitude, centre latitude and tilt each have a slider, an
  editable number, and their own reset. A reset-all button restores the projection's
  defaults.
- **Dragging the map.** The land under the cursor follows the cursor, at any tilt.
  On a tilted map this means a drag can change all of the centre's coordinates.
- **Sliders, typed values, and the locator's centre marker.** These change the centre
  while holding tilt. Changing longitude therefore moves the tilt axis and swings the
  map's pole around.
- **Tilt.** The slider runs from 0° to 90°, snapping at both ends. At 0° with the
  centre on the equator, a world map is in its normal aspect. 90° is the transverse
  aspect. Dragging north or south on a world map moves the centre off the equator,
  which also gives an oblique aspect.
- **Screen orientation.** A tilted map stays north-up at its centre, so the map's
  outline rotates on screen as the slider moves, and is rescaled to fit the window.
  At 90° this gives true transverse Mercator, with the central meridian vertical.
  *(Our call.)*
- **Where tilt is disabled.** The globe, the azimuthals (a tilt is only a spin of the
  page), and the conics. *(Our call.)*

State when switching projections *(our call)*:

- The centre carries over when switching. Conics use their own default centre and do
  not take on the previous one. Leaving a conic restores the centre from before it.
  Conics can still be dragged sideways.
- A tilt set by hand carries over. The 90° from choosing Transverse Mercator does not.
  Choosing Mercator from Transverse Mercator returns tilt to 0°.
- Moving the slider to 90° on Mercator highlights Transverse Mercator, and moving it
  away highlights Mercator again.
- Each projection has a default centre that reset returns to.

### Tissot indicatrices

The toggle shows Tissot's indicatrices by the official definition: the image of an
infinitesimal circle at a point, enlarged for visibility. They are not projected
finite circles.

- At each point, the projection's local derivative (Jacobian) is taken with respect
  to true distance on the sphere. The ellipse is that matrix applied to a unit circle,
  multiplied by one constant display factor shared by all indicatrices, so their sizes
  stay proportional to each other. The constant should be chosen so that an undistorted
  point has a radius equivalent to about 5° at the map's scale. *(Our call.)*
- Indicatrices are spaced about every 30°, and include the poles where they are
  finite. Points where the derivative is singular or that lie outside the map are not
  shown, following the partial-projection rules.
- The derivative must not straddle a seam or boundary. Use a one-sided or analytic
  derivative near those. Numeric derivatives are fine where accurate.
- **During a morph**, an indicatrix uses the blended matrix
  `J(t) = (1 - t) J_old + t J_new`. Since points move as
  `P(t) = (1 - t) P_old + t P_new`, this is the exact derivative of the in-between map,
  so the ellipses stay true at every moment. This assumes screen positions are
  interpolated linearly; eased time is fine, as it only changes `t`.
- A note in the app explains in a sentence what the ellipses are, and that the circle
  tool draws real circles, which can differ. *(Our call.)*

### Drawing

- Three tools: line, polygon and circle. Clicks place points, on any projection,
  including the globe.
- **Lines and polygons.** A double-click or Enter finishes the shape; Escape cancels
  it. *(Our call.)* Every edge is a great-circle arc. Shapes are stored as latitude
  and longitude, never as screen coordinates.
- **Circles.** A real circle on the globe of fixed radius, projected like any other
  shape, so it can come out egg-shaped. The first click sets the centre, moving the
  cursor previews the radius with a readout in kilometres, and the second click sets
  it. *(Our call.)* Stored as a centre and an angular radius.
- When an edge crosses a map's boundary or seam, it breaks there and continues on the
  opposite side.
- Polygons and circles have a translucent fill. A shape that encloses a pole or
  crosses a seam must still fill the correct side.
- The user can undo the last point or shape and clear all. Selecting and editing
  individual points is out of scope. *(Our call.)*
- Dragging on the map while a drawing tool is active still moves the centre; a click
  without movement places a point. *(Our call.)*
- Drawings live only in memory for the session. *(Our call, following from no saving.)*

### Base map

Land and graticule, in a restrained look where drawn shapes and indicatrices stand
out. Natural Earth land at a coarse resolution (110m), bundled with the app so it works
without network calls.

## How it gets made

Our calls, offered to and not challenged by the project owner:

- TypeScript, built with Vite. No UI framework.
- `d3-geo` and `d3-geo-projection` for the projection mathematics. The continuous
  families that D3 does not provide (azimuthal viewpoint, cylindrical spacing) are
  written as custom raw projections.
- A new public GitHub repository, `map-projections`, under the owner's account
  (`Toribash67`), hosted as a static site on GitHub Pages and deployed by GitHub Actions.

## Left to the builder

- Rendering technology: Canvas 2D was proposed, but WebGL is fine if that is what it
  takes to meet the performance target and the anti-goals. The land fill during a morph
  is the hard case, since polygon fills must stay correct across moving seams.
- How geometry is resampled and cut at the seams of both the source and the destination
  projection.
- Morph easing and exact duration, and the visual design generally.
- Narrow-screen layout. Desktop is the priority, though it should stay usable on a phone.

## Success criteria

- Morphs and dragging hold around 60 frames per second on a typical laptop with
  indicatrices and a few drawings on.
- Every pair of projections morphs without streaks or jumps, including to and from Goode
  homolosine, gnomonic, and the conics.
- A line drawn anywhere stays exactly straight in gnomonic while the centre is dragged.
- In automated tests, indicatrices are circular (axis ratio 1, to numerical tolerance) in
  conformal projections and have constant area in equal-area projections.
- In an automated test, a mid-morph indicatrix matches a numeric derivative of the
  interpolated map at the same point.
- Reaching a named stop by slider produces the same map as selecting that name, including
  the conic limits.
