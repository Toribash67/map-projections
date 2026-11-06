// d3-geo-projection ships no types. Only the raw functions this app uses are declared.
declare module 'd3-geo-projection' {
  type Raw = (lambda: number, phi: number) => [number, number];
  export const geoRobinsonRaw: Raw;
  export const geoWinkel3Raw: Raw;
  export const geoMollweideRaw: Raw;
  export const geoSinusoidalRaw: Raw;
  export const geoHomolosineRaw: Raw;
  export function geoHammerRaw(a: number, b?: number): Raw;
  export function geoCylindricalEqualAreaRaw(phi0: number): Raw;
  // Used by tests only, as an oracle for the Goode lobes.
  export function geoInterruptedHomolosine(): {
    scale(k: number): any;
    translate(t: [number, number]): any;
    (p: [number, number]): [number, number] | null;
  };
}
