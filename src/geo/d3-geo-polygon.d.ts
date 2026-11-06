// d3-geo-polygon ships no types. Only the clip this app uses is declared.
declare module 'd3-geo-polygon' {
  import type { GeoStream } from 'd3-geo';
  /** Takes a polygon in degrees; the returned clip takes and emits radians. */
  export function geoClipPolygon(polygon: GeoJSON.Polygon): (sink: GeoStream) => GeoStream;
}
