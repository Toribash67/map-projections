/** Longitude and latitude in degrees. */
export type LonLat = [number, number];
/** Centre longitude and latitude, and tilt about the centre, all in degrees. */
export type Orientation = { lon: number; lat: number; tilt: number };
export type Params = Record<string, number>;
/** Raw projection in radians, y north-positive. `lobe` is the id of the lobe to draw the point on, as it is: only interrupted projections use it. */
export type RawFn = (lambda: number, phi: number, lobe?: number) => [number, number];
/** A circle in the projection's frame (degrees) that the map cannot show. */
export type ExcludedCap = { frameCenter: LonLat; radius: number; mode: 'clip' | 'behind' };
/**
 * A rectangle of longitude and latitude (degrees) in the frame that an interrupted projection draws in one piece, by the formula of
 * the lobe with this `id`. A lobe is usually one rectangle; one that wraps the antimeridian is two with the same id, and there is no
 * seam between those.
 */
export type Lobe = { id: number; lonMin: number; lonMax: number; latMin: number; latMax: number };
export type Seam =
  | { kind: 'none' }
  | { kind: 'antimeridian' }
  /** `smoothEquator`: the map runs smoothly across the equator from a lobe to the one beyond it, so nothing there is cut or mirrored. */
  | { kind: 'lobes'; lobes: Lobe[]; smoothEquator: boolean };

export interface ProjectionDef {
  id: string;
  family: string;
  defaultParams: Params;
  defaultOrientation: Orientation;
  tiltEnabled: boolean;
  latEnabled: boolean;
  raw(p: Params): RawFn;
  caps(p: Params): ExcludedCap[];
  seam: Seam;
}

/** What a projection keeps true everywhere: angles, areas, some distances; a balance of all three that keeps none; or nothing in particular. */
export type Preserves = 'conformal' | 'equal-area' | 'equidistant' | 'compromise' | 'none';

export interface Stop {
  id: string;
  name: string;
  family: string;
  /** One sentence on what it keeps and what it gives up, shown as the tip of its name in the list. */
  note: string;
  preserves: Preserves;
  defId: string;
  params: Params;
  tilt?: number;
  ignoreParams?: string[];
}

export interface ProjectionState {
  defId: string;
  params: Params;
  orientation: Orientation;
}

export interface CompiledProjection {
  def: ProjectionDef;
  state: ProjectionState;
  raw: RawFn;
  caps: ExcludedCap[];
  toFrame(p: LonLat): LonLat;
  fromFrame(p: LonLat): LonLat;
}
