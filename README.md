# Map projections

An explorer for map projections. Pick a projection from the list and the map morphs into it, so you can see what each one stretches, squeezes and cuts. It is for comparing projections side by side in your head, and for seeing how a straight line on the globe (a great circle, the shortest route) bends or stays straight in each.

Live site: https://toribash67.github.io/map-projections/

## Features

- 21 named projections in six families (globe, azimuthal, cylindrical, conic, compromise, equal-area), each with a short note on what it keeps and what it gives up. Family sliders move between the named ones, and the map follows.
- Every change of projection is a continuous morph, between any two projections.
- Centre and tilt, by sliders, number fields, dragging the map, or dragging the small locator globe.
- Tissot indicatrices: circles of equal size on the globe, drawn as they come out in the map, which shows the local distortion at once.
- Drawing: lines, polygons and circles on the globe, joined by great-circle arcs. Draw one and watch it bend through the morph, or stay straight in gnomonic, where every great circle is a straight line.

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

The coastlines are Natural Earth land at 1:110m, from the `world-atlas` package, which redistributes Natural Earth as TopoJSON. The package is under the ISC licence (see `node_modules/world-atlas/LICENSE`). That file covers the package, not the data in it. Natural Earth says on its own site that its data is in the public domain, with no permission or credit needed.
