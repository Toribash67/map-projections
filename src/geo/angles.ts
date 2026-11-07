/** Wraps a longitude to [-180, 180). */
export const normaliseLon = (v: number): number => ((((v + 180) % 360) + 360) % 360) - 180;
export const clampLat = (v: number): number => Math.min(90, Math.max(-90, v));
