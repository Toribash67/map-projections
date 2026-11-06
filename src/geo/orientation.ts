import { geoRotation } from 'd3-geo';
import type { LonLat, Orientation } from '../projections/types';

// Rotating by (-lon, -lat) puts the centre at the frame origin. The third angle
// spins the frame about the axis through that origin, which is the tilt axis.
function rotation(o: Orientation) {
  return geoRotation([-o.lon, -o.lat, o.tilt]);
}

/** Maps a point on the Earth to the projection's frame, where the map centre is [0, 0]. */
export function toFrame(o: Orientation, p: LonLat): LonLat {
  return rotation(o)(p);
}

/** Inverse of `toFrame`. */
export function fromFrame(o: Orientation, p: LonLat): LonLat {
  return rotation(o).invert(p);
}
