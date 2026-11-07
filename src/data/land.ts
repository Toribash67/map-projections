import { geoGraticule10 } from 'd3-geo';
import { feature, mesh } from 'topojson-client';
import landTopology from 'world-atlas/land-110m.json';

// Each is one object for the whole session: cut geometry is cached by object.
const topology = landTopology as any;

/** Natural Earth land at 1:110m. */
export const LAND = feature(topology, topology.objects.land) as unknown as GeoJSON.GeoJsonObject;
/** The coastlines, as lines. */
export const COAST = mesh(topology, topology.objects.land) as GeoJSON.GeoJsonObject;
/** Meridians and parallels every 10 degrees. */
export const GRATICULE = geoGraticule10() as GeoJSON.GeoJsonObject;
