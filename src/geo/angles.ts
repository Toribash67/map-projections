/** Wraps a longitude to [-180, 180). */
export const normaliseLon = (v: number): number => ((((v + 180) % 360) + 360) % 360) - 180;
export const clampLat = (v: number): number => Math.min(90, Math.max(-90, v));

export const formatDegrees = (v: number): string => `${Math.round(v * 100) / 100}\u00b0`;
/** Typed text for an angle: a number, with or without the degree sign. */
export function parseDegrees(raw: string): number | null {
  const text = raw.replace('\u00b0', '').trim();
  return text === '' || !Number.isFinite(Number(text)) ? null : Number(text);
}
