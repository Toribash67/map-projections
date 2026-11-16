import { geoArea } from 'd3-geo';

/**
 * Polygons without the slivers among them. At the finest scale of Natural Earth a few islets are squeezed to slivers with no
 * inside, and a sliver may as well wind the wrong way, which makes it the whole world but itself: filled, it covers the map. No
 * land and no country is half the world, so a piece that large is such a sliver and is left out.
 */
export const withoutSlivers = (polygons: GeoJSON.Position[][][]): GeoJSON.Position[][][] => polygons.filter((polygon) => geoArea({ type: 'Polygon', coordinates: polygon }) < 2 * Math.PI);
