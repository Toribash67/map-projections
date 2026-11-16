# Map Projections Explorer, the export view: Design

Builds on `2026-11-12-atlas-layers-design.md`. Where the two disagree, this one wins.
Source of the request: the owner, on 2026-11-15: the map lags once layers like the depth of
the sea are on, so exploring and exporting should be two views. "I trust you to figure out
the best approach, and what should go where." So nearly everything below is *(our call)*,
decided by the builder and open to veto. What the owner said is marked *(owner)*.

## Intent

The app does two things that want opposite things. Exploring wants sixty frames a second
while a map is dragged, morphed and reshaped. A picture for the wall wants every river, a
coast at 1:10m and lettering fitted to each country, and is made once. The atlas round put
the second kind of thing into the first kind of view, and the view slowed.

So there are two views. The **map** is for choosing and shaping a projection, and has only
what can move with it. The **export view** opens on the map at rest, holds the projection
fixed *(owner)*, and has everything a picture can have.

## What goes where

**The map** keeps: land, coastline, graticule (its spacing, and under the land), country
borders, political colours, Tissot indicatrices, standard lines, reference circles,
drawings; the theme; and the colours of those things. These all morph, and were never the
trouble.

**The export view** has all of that too, since the picture is made of it, and adds:

- rivers, lakes and sea depth *(owner: "more detailed layers to land and sea")*;
- country names, sea names, degrees, and the smallest name *(owner: "show land labels")*;
- the frame and the title box, with title, subtitle and place *(owner: it "has no business
  being shown before you preview the export")*;
- the colours of rivers, the deep sea and the two kinds of names;
- the file: format, extent, size, detail, background.

The map's own layers and colours, changed in the export view, are changed on the map too:
there is one set of them, not two. What the picture adds is kept between visits on its
own, and what an earlier visit kept with the map's layers is read from there once.

## Behaviour

### 1. Opening and leaving

The Export button on the map opens the view. It can be pressed only when the map is at
rest, as an export always could. The picture takes the map's place and the settings take
the sidebar's, so there is no list of projections and no slider to change the map with.
"Back to the map" at the top, or Escape, returns. While the view is open the map under it
takes no keys and no pointer.

### 2. The picture is the file

What is shown is the very scene and lettering the file is made from, drawn smaller: cut
from the coast of the chosen detail (1:50m unless changed, down to 1:10m *(owner)*), at
the chosen size. Export then only writes it out. Nothing is fitted once for the screen and
again for the file.

The picture lies on a darker ground with its edge showing, so a title box against the edge
can be judged. A transparent background is shown as grey squares.

### 3. Looking closely

The wheel, a pinch, the buttons and the keys +, − and 0 zoom the picture up to 32 times,
and a drag moves it. This enlarges the picture as a print is enlarged, lines and letters
with it, and changes nothing in it: it is for reading lettering that will be a millimetre
tall on an A1 sheet. Where painting is slow, as with the finest coast, the last painting
is moved and enlarged while the pointer is at work and painted sharp when it rests.

### 4. Staying quick

A picture is made in three steps: the scene is cut (seconds, for a fine coast), the names
are fitted (a fraction of a second), the plate is set (no time). Each is kept until
something it depends on changes. So typing a title, moving a name or changing a colour
cuts and fits nothing; and turning on a layer cuts that layer alone. A word on the picture
says when it is being drawn.

### 5. Moving names *(owner: "maybe move them around if some of them look off")*

- A name is dragged to where it should be. It keeps its size and its bend.
- A click chooses a name, shown by a band under it. The arrows move it a pixel (ten with
  Shift); Delete takes it off the picture.
- "Put the names back" returns them all to where they were fitted.
- The side has no line of explanation, as the sidebar has none: the tips of the names'
  boxes say that a name can be moved, and the cursor changes over one.
- A move is a share of the picture's width, so it is the same move at any size, and holds
  when names are fitted again for another size or a smaller smallest name.
- The moves belong to one map and extent. On another map the names are as fitted. They
  are not kept between visits.
- Degrees are lettering like the names and can be moved or taken off the same way.
- A moved name is not checked against the others: where it is put is where it goes.

### 6. The map, lightened

The map no longer fetches the rivers, lakes, depths, seas or typeface, fits no names, and
draws no frame. Its margin is always the plain one.

### 7. Shapes are exact, and lines are as fine as the coast *(owner)*

The owner, looking closely: everything with a line width looked blobby, lakes most of all,
and wanted a fix from the ground up, not a patch. There were two causes.

**Every fill was a little too large.** Each filled layer was also stroked half a pixel wide
in its own colour, to hide the hairline where two pieces meet at a seam. That put a
quarter of a pixel of land outside every coast, which a close look enlarges with the rest.

- Each layer is filled as one shape with no stroke. Pieces that meet at a seam are then one
  shape with no hairline, and the shape is exactly its outline. This is the map as it is
  explored too, at rest and in a morph, and the SVG. In a morph, where pieces fold over
  one another, each is wound the same way so that none cancels another.
- Countries of different colours meet edge to edge, where a little of what is under them
  shows. So all the countries are first filled together in the land's colour. On the map
  this costs a frame its time, and is done only once the map has been still a moment.
- A lake is a polygon in the sea's colour and has no shore line.
- The coast is a line about the true shore. (For a day it was drawn on the land's side
  only; with exact fills there is no reason for that, and it is gone.)

**Lines were as wide for a fine coast as for a coarse one.** A line can show no bend
smaller than itself.

- A picture drawn from the 1:50m coast has lines three quarters as wide as the map's, and
  from the 1:10m coast half as wide. From the map's own coast they are the map's own.
- Rivers grow from source to mouth. Natural Earth gives each stretch a weight; the script
  sorts them into four classes, drawn from about a third of a river's old width to under
  twice it. At 1:110m there are only the great rivers, at the old width.
- The picture has a **Line weight**, from a quarter to three times, which every line of it
  is multiplied by, for taste. It is the picture's alone and kept between visits.

## Non-goals

- Changing the projection, its parameters or its centre from the export view.
- Editing a name's text, size or curve, or adding a name.
- Dragging the title box freely: it has its nine places.
- Keeping moved names between visits or in a link.
- A worker thread for the cut. The page is held while a fine coast is cut, and says so.

## Anti-goals

The earlier designs' still hold. Added:

- A map that moves slower than it did before the atlas layers, with any choice of the
  layers it still has.
- A file that differs from the picture shown, in anything.
- A preference lost by the move: what was chosen for rivers, names and the title box
  before is still chosen.

## Tests

The moves as pure functions; preferences, with the old shape read into the new; and
end-to-end runs of opening and leaving, each switch, the finest coast, dragging and
deleting a name, and both file formats.
