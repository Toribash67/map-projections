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

# Ideas for round three

Added 2026-11-12, after round two shipped. Martin's first, then Claude's suggestions.

## Satellite map, in addition to Natural Earth (Martin)

A satellite picture of the Earth as a base layer, switchable with the drawn Natural Earth map.

Notes on how it might work:

- Everything drawn so far is vector: shapes are cut at the seams and their points move. A picture has to be warped instead, so this is a new kind of layer.
- The usual way is a WebGL layer under the canvas: for each pixel on screen, invert the projection to longitude and latitude and look the colour up in an equirectangular image. `screenToLonLat` already does that inversion on the CPU; it would need a shader version for each projection, or a mesh of textured triangles placed with the existing forward projection, which also morphs for free.
- The triangle mesh fits the morph better: its corners can blend between two maps exactly as the vector pieces do, and it can be cut along the same seams.
- Source: NASA Blue Marble (public domain) at a few sizes, for example 2k for the screen, 8k when zoomed, 21k for export. Each is its own file, fetched when needed, like the finer coastlines.
- Export: PNG is straightforward. SVG would have to embed the warped picture as an image under the vector layers.
- Open questions: which layers stay on over it by default (coast and borders, probably in a lighter colour); whether the themes apply; night lights as a second picture.

## Biomes layer (Martin)

A map of the world's biomes (tundra, taiga, desert, rainforest and so on) as a layer, like the political map: filled areas in a colour each.

Notes on how it might work:

- It is vector, so it fits what is there: one MultiPolygon to a biome, cut and morphed like the political colours, and exported in both formats with no new machinery.
- Source: not in Natural Earth or `world-atlas`. The usual one is WWF's Terrestrial Ecoregions of the World (14 biomes, 867 ecoregions), or its successor RESOLVE Ecoregions 2017 (CC BY 4.0, so it needs a credit line). Köppen climate zones are a close cousin and could be a second layer of the same kind.
- The data is far too detailed as published (tens of megabytes). It would be dissolved to the 14 biomes, simplified to about the 1:110m and 1:50m levels, and stored as TopoJSON in the repo or as its own small package, fetched when the layer is first turned on.
- Each political colour is one cut per morph; 14 biomes are 14, so the frame time in a morph needs measuring. Simplifying harder for the morph and swapping in the finer shapes at rest, as the coastlines do, is the fallback.
- Needs a legend: 14 colours mean nothing without names. A small key on the map, shown while the layer is on, and included in exports.
- Open questions: 14 colours for each theme, distinct from each other and from the sea; whether it replaces the land fill and the political map or can sit under borders; lakes, ice and rock.

## Land cover layer (Martin)

What is actually on the ground: cropland in one colour, the kinds of forest in others, grassland, shrubland, wetland, built-up areas, bare ground, snow and ice. The cousin of the biomes layer, which shows what would grow there by climate; this one shows farmland and cities where they are.

Notes on how it might work:

- Unlike biomes, the data is not vector. It comes from classified satellite pictures, as rasters: ESA WorldCover (10 m, CC BY 4.0), Copernicus Global Land Cover (100 m), MODIS MCD12Q1 (500 m).
- Two ways in. Either reduce it to about a dozen classes at a coarse size and trace it into polygons, which then work like the political map but look blobby and are heavy even simplified. Or treat it as a picture and draw it through the warped-image layer that the satellite map needs, which is sharper and little extra work once that layer exists. The second is the better bet, so this follows the satellite map.
- As a picture it is a small indexed image (a class number to a pixel), coloured by the theme in the shader, so the themes and custom colours still apply.
- Needs the same legend as the biomes layer, and the source's credit line.

## Atlas layers, for a map worth printing

What an atlas plate has that this map does not yet. Suggested by Claude when Martin asked what would look good on a wall.

**Done (2026-11): the first print round and the names.** Rivers, lakes and a sea shaded by depth in four steps are layers. Countries and seas are named, each name fitted and bent along its shape on the map on screen; the names step aside while the map moves and come back fitted when it rests. The graticule can have its degrees written where each line leaves the map, and can lie under the land. A frame and a title box (a title and subtitle of one's own, the projection and its settings filled in) go round the picture. A Poster theme has the look. All of it is in the Layers panel, kept between visits, and exported as PNG and SVG. **Left out:** capitals and mountain ranges; shaded relief (it waits for the picture layer of the satellite map); the indicatrices as an inset; a note on scale. The thematic layers below are still to do.

**A first print round: all vector, all fit what is built.**

- Rivers and lakes. In Natural Earth, and in the 1:50m and 1:10m files already fetched on demand. Makes the land far less bare.
- Ocean depth: bathymetry in stepped blues. Natural Earth has it as polygons at a handful of depths, so it works like the political map, and it fills the large empty areas of sea.
- Graticule labels along the map's edge (30°N, 60°E).
- A title block and legend: the projection's name, centre and standard parallels, a note on scale, the data's credit. With a neat border round the map, and the indicatrices optionally as a small inset.

**The two that do most for the look, and cost most.**

- Shaded relief, with elevation tints (green lowlands through brown to white peaks). Natural Earth publishes relief as pictures, so it goes through the warped-image layer of the satellite map.
- Labels: countries, oceans, capitals, mountain ranges. Placement is the hard part: along features, curved with the map, not on top of each other, and sensible in a morph (or hidden during one).

**Thematic layers, one to a print.**

- Climate zones (Köppen): vector, bold colours, the sibling of biomes.
- Tectonic plates, volcanoes and earthquakes: lines and points. Striking on an interrupted map.
- Ocean currents and prevailing winds, as arrows.
- Population density, or the Earth's lights at night: pictures. Night lights on a dark theme is a poster by itself.
- Ice: glaciers, ice shelves, the extent of sea ice. Vector, in Natural Earth.
- Time zones. Vector, in Natural Earth.
- Great-circle routes or historical voyages, built on the drawing tools.

## Shareable links

Put the projection, parameters, centre, zoom, layers and drawings in the URL, so that a link opens exactly the map that was on screen.

## Side-by-side compare

Two maps of the same centre next to each other, with drawings and indicatrices mirrored.

## Distortion heat map

A layer that shades the map by area inflation or by angular distortion: the continuous version of what the indicatrices sample at points.

## Measure tool

Click two places for the great-circle distance and bearing, beside the length the map's own straight line suggests. On Mercator, the rhumb line next to the great circle.

## True-size country drag

Pick up a country and drag it to another latitude, to watch it grow or shrink, on any projection.

## Place search and labels

Type a city to centre the map on it. Optional labels for a few dozen major cities.

## Oblique presets

Named views that are only an orientation of a map already there, such as the Atlantis (an oblique Mollweide) or a transverse Mollweide.

## More projections

Dymaxion and Waterman butterfly, to complete the polyhedral family; Littrow, Armadillo, Bertin 1953. The first two are the costly ones (see the note under "Projections to add").

## Daylight terminator

A day and night layer for a chosen date and time.

## Left over from round two

- Tips for the controls that have none: the filter box, theme select, colour pickers, graticule spacing, and a few export options.
- "Reset all" on a tilted Transverse Mercator leaves the tilt marked as set by hand, so the next projection can inherit it.
- An empty custom export width silently becomes 100 px.
- Resizing the window in the middle of a morph while zoomed may shift the outgoing map (not confirmed).
- A few helpers are used only by tests (`straightRing`, `mapStyle`, the slider's `setEnabled`).

## Keyboard navigation of the map

Arrow keys to move the centre.

## Offline use

A service worker, so that the site works without a connection, including the larger coastline files once fetched.
