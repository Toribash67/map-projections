# Ideas for later

## Morph within a family as a parameter slide

**Done (2026-11).** Two maps of one definition slide between each other; the conic switch between conformal and equal-area is an ordinary morph.

Raised by the owner after trying v1 (2026-11-08). Not planned for v1.

**What happens now.** Every morph blends each point in a straight line from its
old screen position to its new one. Between Mercator and Transverse Mercator,
which differ only by a 90° tilt, the map splits along its seams and stitches
itself back together. That is correct, but unnecessary.

**What it should do.** When the old and new maps are the same projection, or the
same family, and differ only in parameters or orientation, the morph should
slide those values from old to new. Every frame would then be a real map of that
family, as when a slider is dragged. Examples:

- Mercator and Transverse Mercator: tilt slides from 0° to 90°.
- Gnomonic, stereographic and orthographic: the viewpoint slides.
- Mercator, equirectangular and the equal-area cylindricals: the spacing and
  standard parallel slide.
- Albers and Lambert conformal conic: the standard parallels slide (the
  conformal/equal-area switch would still need the ordinary morph).
- Any map whose centre changes: the centre slides along the shorter way round.

**How it might work.**

- Each frame does a live rebuild with interpolated state, the path the sliders
  already use. That path takes about 3–9 ms per frame on the test machine.
- Tissot indicatrices stay exact for free, because every frame is a real map.
- Use the same 1400 ms cubic ease-in-out, so it feels like the other morphs.
- A redirect mid-slide could start an ordinary morph from the current
  in-between state.
- Decide whether pairs reached through the conic limits, such as Albers to
  Gall-Peters, count as one family.

# Some freespittin by Martin. Not detailed ideas, but all of these should be added, unless you deem them to not really work at all.

## Resetting parameters should morph seamlessly as well.

**Done.** Resets, typed values and clicks on the corner globe all slide.
Currently, when resetting parameters, we just jump from one view to the next instantly. This should be a seamless morph, just like any other transition.

## Remove fading in an out from transitions

**Done.** Nothing fades. Lines that fold onto an edge thin away over the last twentieth of a morph, so they leave no trace there.
When transitioning between maps with and without global coverage, the mising terrain being added or removed is faded into/out of existence. This is actually an unecessary complication which makes the transiotions less seamless, since the sections are being squished into, or stretched out of an infinitesimal point/line, so the transistion as a whole is seamless anyway.

## Export current map config as png or svg, for printing.

**Done.** PNG and SVG, whole map or current view, up to A1 at 300 dpi, from Natural Earth at 1:110m, 1:50m or 1:10m.
Not much more of a description necessary. Would be pretty cool. Possibly, we should use a higher-detail vector map as baseline, since these exported maps might be printed to a large format.

## Custom colors for the map, and map layers for a political map (possibly others?)

**Done.** Themes, a colour picker for each colour, and layers for borders, a five-colour political map, reference circles and more. Exports use them.
These settings would be used when exporting the current map view as well.

## This is a cool one: Projection illustration in the preview globe

**Done.** The corner globe has a fixed view (drag to turn it) and draws the cylinder, cone, plane or octahedron about the globe. Pseudocylindrical and compromise maps, Peirce and the double hemispheres are worked out by formula and have no surface to draw.
In the globe preview in the bottom right corner, we could optionally draw an illustrative cylinder/cone/other to indicate the shape that the map is being projected on. This shape would morph to match the current parameters. Also, the view on the preview globe should be fixed, so we can see the cone/cylinder/other move around when we pan on the projection, instead of rotating the preview globe itself as we currently do.

## Remove all descriptions in the sideboard

**Done.** The sidebar is the list and the parameters; everything else is a tip.
All over the sideboard are descriptions of what a projection is, how its parameters work, how to choose a tool, tissot indicatrix explainer, etc. All this is increasing the required vertical height for the sideboard, and is a bit of an AI-slop marker. They can all be removed. Actually informative and necessary explainers can be shown when hoveriing over a specific button or option.

## Optionally show first and second parallel on the map

**Done.** The Standard lines layer, for every map that has parallels of true scale, not only the conics.
In conic projections, have an option to show/hide the parallel lines.

## Draw lines which are straight in current projection, but not on globe.

**Done.** The toolbar has a switch between shapes that follow the map and shapes that follow the globe.
When drawing shapes on a projection which is not a globe, draw them so they appear straight in the current projection. When later switching to a globe or other projection, these "straight" lines will of course no longer be straight, which server to indicate that a line that appears straight in a specific projection, not necessarily is.

## Zoom in/out on map.

**Done.** Wheel, pinch, buttons and keys, up to 32 times; finer coastlines are loaded when zoomed in.
Enable zooming in and out on a map, so you more closely can inspect a specific section of it.

## Projections to add: 

**Done.** Nicolosi globular, stereographic and equal-area double hemispheres, Peirce quincuncial, Cahill butterfly, and also Bonne, Werner, Eckert IV, Natural Earth, Van der Grinten and Miller. **Left out:** Dymaxion and Waterman butterfly. Each needs its own unfolding of a solid with many faces, and the morph needs every face cut and matched; the Cahill butterfly shows the same idea on an octahedron.
All of these can be found on at https://en.wikipedia.org/wiki/List_of_map_projections

- Nicolosi globular, or other double hemisphere projection
- Peirce quincuncial
- Cahill butterfly
- (Other projections from the list you deem interesting)

## Projections to remove

**Done.** Orthographic is gone as a stop; the globe has a view distance in Earth radii, and at its far end it is the orthographic view.
- Orthogonal, as its just a globe projection, or at least appears to be. However, in the globe projection, add a parameter for the view distance, effectively turning the globe projection into a General Perspective projection (https://en.wikipedia.org/wiki/General_Perspective_projection). Don't have the parameter be in kilometers, but rather as a multiplier of the sphere's radius.

- (Other projections from the list you deem uninteresting)
