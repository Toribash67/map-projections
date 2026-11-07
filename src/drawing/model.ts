import type { LonLat } from '../projections/types';

/** A shape drawn on the Earth: points in degrees, or a circle's centre and angular radius in degrees. */
export type Shape = { kind: 'line' | 'polygon'; points: LonLat[] } | { kind: 'circle'; center: LonLat; radiusDeg: number };
