# Map projections

An explorer for map projections. Pick a projection from the list and the map morphs into it, so you can see what each one stretches, squeezes and cuts. It is for comparing projections side by side in your head, and for seeing how a straight line on the globe (a great circle, the shortest route) bends or stays straight in each.

Live site: https://toribash67.github.io/map-projections/

## Features

- 31 named projections in eight families: the globe, azimuthal, cylindrical, conic, compromise, equal-area, interrupted and polyhedral (Goode homolosine, Peirce quincuncial, Cahill butterfly), and double hemispheres (Nicolosi globular, stereographic, equal-area). Each says what it preserves, and has a note as a tip.
- Every change of projection is a continuous morph, between any two projections. Between two maps of one kind, such as Mercator and Transverse Mercator, the parameters slide instead, and every frame is a real map. Resets and typed values slide too: nothing jumps.
- The globe is a general perspective view, with the view distance in Earth radii, from close up to infinitely far.
- Centre and tilt, by sliders, number fields, or dragging the map. Zoom by the wheel, a pinch, the buttons or the keys; shift-drag moves a zoomed view.
- Layers: land, coast, graticule (every 10°, 15° or 30°), country borders, a political map in five colours, Tissot indicatrices, the standard parallels of the map on screen, the equator with the tropics and polar circles, and drawings.
- Themes, and every colour of the map can be set by hand. Layers, colours and preferences are remembered between visits.
- Tissot indicatrices: circles of equal size on the globe, drawn as they come out in the map, which shows the local distortion at once.
- Drawing: lines, polygons and circles, either as they are on the globe (great circles and true circles) or straight and round on the map on screen. Draw a straight line on Mercator and watch it bend on any other map.
- The corner globe shows where the map is centred and what it covers, from a fixed view that can be turned by dragging, with the surface the map is projected onto drawn about it: a cylinder, a cone, a plane, an octahedron. A click on it moves the map's centre there.
- An export view, opened from the map at rest: the picture itself, drawn from coastlines at 1:110m, 1:50m or 1:10m, to zoom into and look over. It adds what is too heavy to move with the map: rivers, lakes, the sea shaded by depth, the names of countries and seas fitted to their shapes, degrees on the graticule, a frame and a title box. A name can be dragged to a better place, or taken off.
- The picture can say more of the world: the land coloured by its height, its biomes or its climates, with a legend; ice; time zones and the date line; states and provinces; the tectonic plates, volcanoes and large earthquakes; and capitals, cities, peaks, ranges and deserts by name.
- The picture is saved as PNG or SVG: the whole map or the zoomed view, at screen size, 4K, or A3 or A1 at 300 dpi, on the page's colour or a transparent background.

## Keys

| Key | Does |
| --- | --- |
| `L`, `P`, `C` | The line, polygon and circle tools |
| `Enter`, `Escape` | Finish the shape being drawn, or cancel it |
| `T` | Tissot indicatrices on and off |
| `+`, `-`, `0` | Zoom in, zoom out, fit the map to the window |
| `Escape` | Close a panel, or clear the filter |

## Run it

You need Node 22.12 or later (CI uses Node 24).

```
npm install
npm run dev       # development server with live reload
npm test          # unit tests (Vitest)
npm run e2e       # browser tests (Playwright; starts its own dev server)
npm run build     # type check, then a production build into dist/
```

The first `npm run e2e` may need `npx playwright install chromium`. The build uses relative paths, so `dist/` can be served from any folder, and `npx vite preview` serves it locally.

The Pages workflow in `.github/workflows/pages.yml` runs the unit tests and builds on every push to `main`, then deploys `dist/`.

## Data

The coastlines and countries are Natural Earth, from the `world-atlas` package, which redistributes Natural Earth as TopoJSON. The app starts with the 1:110m files. The 1:50m files are fetched when the map is zoomed in, and the 1:50m or 1:10m files for an export that asks for them; each is its own chunk of the build, so none is downloaded until it is needed. The package is under the ISC licence (see `node_modules/world-atlas/LICENSE`). That file covers the package, not the data in it. Natural Earth says on its own site that its data is in the public domain, with no permission or credit needed.

What a picture for export can show besides is in `src/data/ne` and `src/data/world`, written there by `npm run natural-earth` and `npm run world-data` and fetched only when a layer that needs it is turned on. From Natural Earth: rivers, lakes, the sea's depths and names, ice, time zones, the date line, states and provinces, cities, the named regions of the land and its peaks. The height of the land is NOAA's ETOPO5 (public domain); volcanoes are from NOAA NCEI and earthquakes from the USGS (public domain). Three ask to be named where they are shown, and a picture that shows them says so in its title box or legend: biomes are RESOLVE Ecoregions 2017 (Dinerstein et al., CC BY 4.0); climates are Beck et al. 2018, "Present and future Köppen-Geiger climate classification maps at 1-km resolution" (CC BY 4.0); and the plate boundaries are Peter Bird's PB2002 as published by Hugo Ahlenius, Nordpil (Open Data Commons Attribution).
