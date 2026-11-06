/** Longitude and latitude in degrees. */
export type LonLat = [number, number];
/** Centre longitude and latitude, and tilt about the centre, all in degrees. */
export type Orientation = { lon: number; lat: number; tilt: number };
export type Params = Record<string, number>;
/** Raw projection in radians, y north-positive. `lobe` is only used by interrupted projections. */
export type RawFn = (lambda: number, phi: number, lobe?: number) => [number, number];
/** A circle in the projection's frame (degrees) that the map cannot show. */
export type ExcludedCap = { frameCenter: LonLat; radius: number; mode: 'clip' | 'behind' };
/** A lobe of an interrupted projection. All values are degrees. */
export type Lobe = { lonMin: number; lonMax: number; latMin: number; latMax: number; centralLon: number };
export type Seam = { kind: 'none' } | { kind: 'antimeridian' } | { kind: 'lobes'; lobes: Lobe[] };

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

export interface Stop {
  id: string;
  name: string;
  family: string;
  note: string;
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
