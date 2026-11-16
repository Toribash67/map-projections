# Map Projections Explorer, layers of the world: Design

Builds on `2026-11-15-export-view-design.md`. Where the two disagree, this one wins.
Source of the request: the owner, on 2026-11-15 and 16: "Can we add more layers to the land
areas? Height (colour bands depending on it?) or terrain type etc?", then time zones, then
"all except the ones you marked not now" of the builder's list, then a colour for the title
box. What the owner chose is marked *(owner)*; the rest is *(our call)*.

## Intent

The export view made heavy layers cheap: a picture is made once and need not keep up with
a drag. So the picture can say more about the world than its coast and its countries.

## What was added *(owner: all twelve)*

All of it belongs to the picture, in the export view, and none of it to the map as it is
explored. All of it is vector, exported as PNG and SVG, and kept between visits.

**What the land is coloured by**, one at a time, in place of the political colours:

- **Height**: six steps, at 200, 500, 1000, 2000, 3000 and 4500 m, mixed evenly from the
  Land colour to a new **High land** colour, as the sea's depths are.
- **Biomes**: the fourteen of the ecoregions' map.
- **Climates**: Köppen's, as thirteen kinds (Af, Am, Aw, BW, BS, Cs, Cw, Cf, Ds, Dw, Df,
  ET, EF). Beck's thirty classes also say how hot the summer is; a legend of thirty would
  fill the picture *(our call)*.

They are a single choice, **Land colours**, because each is a colour for all the land
*(owner agreed)*. None keeps to the app's coast where it comes from, so each is drawn
within the land the app has: its edge at the shore is the coast's own.

**Layers**: ice (glaciers, ice caps, and the ice shelves at the finer scales), in a new
**Ice** colour; time zones (every other hour as a wash over land and sea, the zones of a
half or quarter hour stronger, the borders between zones, and the hours from UTC written
along 58°S, where no land is in the way); the date line; states and provinces; and the
boundaries of the tectonic plates.

**Marks**: volcanoes as triangles and earthquakes of magnitude 7 and more since 1900 as
rings, the larger for their magnitude, both in the accent colour of the plates.

**Names**: capitals, cities and peaks, each a mark where it is and its name beside it;
and the ranges, deserts and plains, fitted like the seas.

- Places are taken the most important first, for as long as there is room: a name is set
  to the right of its mark, or failing that to the left, above or below, and left out
  with its mark if it touches other lettering on every side.
- A place's lettering has a size by its rank. The **Smallest name** setting, which
  decided how many countries were named, decides this too: the smaller it is, the more
  cities.
- The regions give way to the countries and the seas, which are named first.
- A city's name can be dragged like any other. Its mark stays on the city.

**The legend** *(our call: fourteen colours mean nothing without names)*: a box like the
title box, with a part for what colours the land, one for the depths of the sea, and one
for the marks and lines. It is on by default and is there only when the picture has
something to explain. It has its own nine places, and moves beside the title box where
the two would overlap. Names and marks under either box are left out.

**The title box's colour** *(owner)*: a colour of its own among the picture's colours,
for the title box and the legend. Until it is set it is the page's.

## Whose the data is

| What | From | Terms |
| --- | --- | --- |
| Ice, time zones, date line, provinces, cities, regions, peaks | Natural Earth | public domain |
| Height | NOAA ETOPO5, five minutes of arc | public domain |
| Biomes | RESOLVE Ecoregions 2017 (Dinerstein et al.) | CC BY 4.0 |
| Climates | Beck et al. 2018, Köppen-Geiger at 5 arc-minutes | CC BY 4.0 |
| Plates | P. Bird's PB2002, as published by H. Ahlenius (Nordpil) | ODC Attribution |
| Volcanoes | NOAA NCEI | public domain |
| Earthquakes | USGS | public domain |

Three of these ask to be named. A picture that shows their data says so: in the last
line of the title box; or, with no title box, at the foot of the legend; or, with
neither, in a line at the foot of the picture. Natural Earth alone is said as before.

Height, climates and biomes are not drawings at source but grids (the biomes are painted
onto one by the script). Each is traced into polygons where the value crosses over.
Classes are first spread a little way out to sea, so that they reach the app's coast
wherever it is.

Two scripts make the files, which are committed: `npm run natural-earth` and
`npm run world-data`. Each file is a chunk of its own, fetched when its layer is first
turned on. None is over 2 MB.

## Non-goals

- Any of this on the map as it is explored.
- Land cover, night lights, population, shaded relief: pictures, not drawings.
- Ocean currents and winds: no clean public source.
- Names for the plates, the volcanoes or the earthquakes.
- A legend entry for the time zones, whose hours are written on the picture.
- Themes of their own for the biomes and climates: their colours are the same in every
  theme, as a rainforest is green whatever the page looks like.

## Anti-goals

- A picture that shows CC BY data and does not say whose it is.
- A coloured land that spills into the sea, or stops short of the coast.
- A first load, or a map as it is explored, heavier for any of this.
