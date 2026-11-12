/** 0 up to `from`, 1 from `to`, linear between. */
export const ramp = (v: number, from: number, to: number): number => Math.min(1, Math.max(0, (v - from) / (to - from)));

/** 0 up to 0, 1 from 1, and smooth in between, with no kink at either end. */
export const smooth = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
