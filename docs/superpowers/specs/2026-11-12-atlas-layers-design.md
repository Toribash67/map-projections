# Map Projections Explorer, atlas layers: Design

Builds on `2026-11-11-ideas-round-two-design.md`. Where the two disagree, this one wins.
Source of the request: "Atlas layers, for a map worth printing" in `docs/ideas.md`, and a
conversation with the owner on 2026-11-12. Items marked *(our call)* were decided by the
builder, not by the owner, and are open to veto. The owner left before the design was
written and asked for the work to go ahead, so there are more of those than usual.

The look to aim for is `2026-11-12-atlas-layers-mockup.jpg`, beside this file: a sketch
made from the real data, which the owner saw and approved ("they both look great").

## Intent

Printed maps in odd projections are hard to find. The owner wants to choose a projection
they like, style it until it would look good on a wall, and export it. Round two made the
export; this round makes the map worth exporting.

The reference is a modern political map of Europe in 1444: flat pastel countries, names
in spaced capitals fitted and bent along each country, a pale sea, thin rivers, a plain
title box inside a thin black frame. Clean vector, no relief, no texture.

## Goals

1. Rivers, as a layer.
2. Lakes, as a layer.
3. The sea shaded by depth in flat steps, as a layer.
4. Country names, fitted to each country's shape on the map on screen.
5. Sea and ocean names, in the same manner.
6. Degree labels where the graticule leaves the map.
7. A title box with a title and subtitle the owner types, and the rest filled in.
8. A frame round the picture.
9. Every one of these is a setting: a switch each, with its colours and the few choices
   listed below, kept between visits, and exported exactly as shown.

## Non-goals

- Cities, capitals, mountain ranges, or any name that is not a country or a sea.
- Relief, satellite pictures, land cover: anything that is a picture and not vector.
- The thematic layers (climate zones, plates, ice, time zones, currents). A later round.
- Names that ride along while the map moves. The owner said they may step aside.
- Moving or editing a single name by hand.
- A legend for the political colours (they mean nothing), or an inset of indicatrices.
- Names in languages other than English.

## Anti-goals

The earlier designs' still hold (no stray artefacts; an export differs from the screen in
nothing but resolution). Added:

- A name that lies across another name, or runs out of its country into the next.
- A name upside down.
- A sea name lying on land.
- A large country with a tiny name, or with none, when a smaller neighbour has one.
- A first load that is heavier because of data for layers that are off.
- A map that drags or morphs noticeably worse with the new layers off than it does now.

## Behaviour

### 1. Rivers and lakes

Two layers, off by default, from Natural Earth's rivers and lake centrelines and its
lakes, at the same three scales as the coast.

- Rivers are lines in a new colour, **Rivers**. Lakes are filled with the **Sea** colour
  and edged with a hairline in the Rivers colour *(our call)*.
- Lakes are drawn over the land and the political colours, under borders and coast.
- They are geometry like any other layer: cut at the seams, morphed, folded onto an
  edge without fading, drawn finer when zoomed in, and exported at the chosen detail.

### 2. Sea depth

A layer, off by default: the sea in flat steps, darker with depth. From Natural Earth's
bathymetry, which is published only at 1:10m and is far too heavy as it comes.

- Four steps, at 200 m, 2000 m, 4000 m and 6000 m, over the plain sea *(our call:
  the sketch had these four)*.
- A new colour, **Deep sea**. The steps are mixed evenly from Sea to Deep sea, so one
  picker sets the whole ramp and every theme has a ramp of its own.
- The data is reduced by a script to a coarse and a fine version (see Data).
- In a morph it is cut with everything else. If that makes the start of a morph or a
  drag plainly slower, the builder may leave it out while the map moves and bring it
  back at rest, as the fine coast does. Measure first.

### 3. Names

Two layers, off by default: **Country names** and **Sea names**.

**How a name is fitted.** For the map at rest, each country's shape on screen is found
(cut at the seams like everything else), and the name is set along the middle of its
largest piece:

- Try the piece at a spread of directions. At each, slice it across, take the middle
  and the thickness of each slice, keep the longest run of slices thick enough to
  letter, and fit a gentle curve through their middles. The letters are as tall as the
  thinnest slice of the run allows and as wide as the curve's length allows; the
  direction that gives the tallest letters wins, with a lean towards level lettering.
- The letters are then spaced out to fill most of the curve, up to a limit, as on the
  reference map.
- The bend of the curve is limited, so a name is an arc and never a hook.
- A name reads left to right. One that runs steeper than about 80 degrees reads upward.
- Countries are capitals in a medium weight; seas are in italic with wider spacing, in
  their own colour. Sizes have a ceiling, so Russia does not shout.

This is what the sketch did, and it worked on the first try. The rules it lacked:

- **No collisions.** Names are placed largest first. A name that would touch one already
  placed is tried smaller, and dropped if it still touches.
- **Stay inside.** A country's name lies within its own piece. A sea's name lies on
  water: one that would cross land is moved, shrunk or dropped.
- **Long names.** "United States of America" came out tiny in a large country. A name
  may be set on two lines, or take a shorter form from a table of display names
  ("United States", "DR Congo"), whichever the builder finds gives the better lettering.
  The abbreviations that Natural Earth's names carry ("Dem. Rep. Congo", "Bosnia and
  Herz.") are spelled out or replaced by the same table.
- **The largest piece only.** A country cut in two by a seam is named once, on its
  larger piece *(our call)*.
- **Seas.** Oceans and the larger seas, from Natural Earth's marine areas, most
  important first; the smaller ones appear as zooming in makes room.
- Nothing is named on the far side of a globe.

**Smallest name.** A setting, in screen pixels at the fit, from 1 to 10, default 4
*(our call)*. A name that cannot be at least that tall is left out. This is what decides
how many small countries are named. Since an export is the screen enlarged, lettering of
4 pixels on screen is about 2.5 mm on an A1 print, and 2 pixels is about 1 mm: on a wall
map the owner may want names on screen too small to read there. Zooming in enlarges the
names with the map, so more of them pass the limit and appear.

**While the map moves.** Names are not drawn during a morph, a slide, a drag, or a zoom.
They return, fitted afresh, when the map has been at rest for a moment. They go and come
at once, with no fade, as nothing in this app fades.

**The typeface** *(our call)*. The sketch used Avenir Next, which is the Mac's and cannot
be shipped. The app bundles Jost, an open geometric sans close to it (SIL Open Font
License), in the weights needed, fetched only when a name or the title box is first
shown.

### 4. Degree labels

A choice under the graticule, off by default: **Degrees**. Where a line of the graticule
leaves the picture, its value is written in small letters: "30°N", "60°E", "0°".

- On a whole map, that is where the line meets the map's outline, and the label sits
  just outside it. On a map zoomed in, it is where the line meets the edge of the
  window, and the label sits just inside.
- Where labels would crowd, as meridians do at a pole, the rounder numbers win (0, then
  multiples of 90, 30, 10) and the rest are left out.
- They follow the graticule's spacing, need the graticule on, and step aside with the
  names while the map moves.

### 5. Title box and frame

Two switches, off by default: **Frame** and **Title box**.

- The frame is a thin line just inside the edge of the picture: of the map and its
  margin at the fit, of the window when zoomed in. That is the rectangle an export has.
- The title box sits in a corner of the frame, which the owner chooses (default top
  right). It holds, from the top:
  - a title, typed by the owner (default "The World"), large and bold;
  - a subtitle, typed by the owner (default empty, and then left out);
  - the projection's name, as the list has it, and "projection";
  - its settings in one line: the centre, and each parameter that is not at its default;
  - "Made with Natural Earth".
- The box is a plain rectangle in the page's colour with a hairline border, sized to its
  text. Its lettering scales with the picture, so an export has the box the screen has.
- It does not avoid the map; choosing the corner is how the owner keeps it off the land.
- On screen the app's own buttons and the corner globe may lie over the frame and the
  box. The export has none of them.
- The frame and the box stay while the map moves. The lines about the projection change
  when the map comes to rest.

### 6. Graticule over the sea only

A choice under the graticule, off by default *(our call: the sketch drew it so, and it
is much of why the land looks clean)*: the graticule is drawn under the land instead of
over it.

### 7. A theme for the look

A new theme, **Poster** *(our call)*: the sketch's colours. A pale blue sea and a deeper
blue for depth, five soft pastels, white borders, grey lettering, white paper. The
existing themes each gain colours for the new things, so that every theme works with
every layer.

New colours that can be set by hand, with the old ones: **Rivers**, **Deep sea**,
**Names**, **Sea names**. The frame, the title and the degree labels use the page's ink.

### 8. Settings

All of it lives in the Layers panel, which grows three groups: the layers (with rivers,
lakes and sea depth among them), **Names** (countries, seas, smallest name), and
**Plate** (frame, title box, title, subtitle, corner). Degrees and "over the sea only"
sit with the graticule's spacing.

- Everything is remembered between visits, read part by part with defaults as now.
- The panel must still fit a 13-inch laptop: groups that fold, or a panel that scrolls
  within the window, at the builder's choice.
- Every new control has a tip.

### 9. Export

PNG and SVG both carry all of it, at the chosen detail, and match the screen.

- In SVG, names are text, one element to a name with each letter at its place, in
  groups by layer, so they can be edited. The
  typeface is embedded in the file *(our call)*. A program that ignores embedded fonts
  and lacks Jost shows another typeface in the same places; PNG is always exact.
- An export waits for the names to be fitted. The picture of the whole map uses the
  names of the fit; the picture of the current view uses the view's.

## Data

Natural Earth is public domain. None of the new data is in `world-atlas`.

- A script, in the manner of `scripts/political-colours.mjs`, fetches Natural Earth's
  rivers, lakes, marine areas and bathymetry, reduces them, and writes them into the
  repo. The files are committed; the app never fetches from Natural Earth itself.
- Rivers and lakes at 1:110m, 1:50m and 1:10m, as the coast is. Bathymetry reduced to
  two versions: a coarse one for the screen and for morphs, and a fine one for zoomed
  views and exports at 1:50m and 1:10m. Marine areas at one scale, for names only.
- Natural Earth's polygons wind the other way from what d3 and this app expect; the
  script turns them round.
- Each file is a chunk of its own, fetched when its layer is first turned on.
- Sizes to aim for *(our call)*: the coarse bathymetry under 400 kB, the fine under
  2 MB, everything else under 1 MB each. The start-up bundle does not grow by data.

## Left to the builder

- How countries are cut one by one for fitting, and how that is kept off the frame that
  draws the map.
- How letters are drawn along a curve on the canvas, which has no text on a path.
- The exact numbers of the fitting: directions tried, slices, limits on bend and spacing.
- How the panel is laid out, and the wording of tips.
- Which tool reduces the data, and any development dependency it needs.
- Tests, in the manner of the existing ones: the fitting and the collision rules as pure
  functions, preferences, both exports, and end-to-end runs of the switches.

## When it is done

`docs/ideas.md` is updated: the first print round and the names are marked done, with a
line on what was built and what was left out.
