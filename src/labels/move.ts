import type { Label } from './place';

/**
 * What has been done by hand to the lettering of a picture: names moved from where they were fitted, and names taken off. A move is
 * in shares of the picture's width, so that it is the same move in a picture of any size. Replaced, never changed in place.
 */
export type LabelEdits = { moved: Record<string, [number, number]>; removed: string[] };
export const NO_EDITS: LabelEdits = { moved: {}, removed: [] };

export const isEdited = (edits: LabelEdits): boolean => edits.removed.length > 0 || Object.keys(edits.moved).length > 0;

/**
 * What each label is known by, from one fitting to the next: its kind and its text, and which of those that say the same it is,
 * as the degrees of a parallel are written at both its ends.
 */
export function labelKeys(labels: Label[]): string[] {
  const seen = new Map<string, number>();
  return labels.map(({ kind, text }) => {
    const name = `${kind}:${text}`;
    const nth = seen.get(name) ?? 0;
    seen.set(name, nth + 1);
    return nth === 0 ? name : `${name}#${nth}`;
  });
}

/** A label moved as it is, by so many pixels. */
export function shifted(label: Label, dx: number, dy: number): Label {
  if (dx === 0 && dy === 0) return label;
  // The mark of a place stays at the place, and so does the circle that covers it: the last, where there is a mark.
  const fixed = label.mark ? label.discs.length - 1 : -1;
  return { ...label, glyphs: label.glyphs.map((glyph) => ({ ...glyph, x: glyph.x + dx, y: glyph.y + dy })), discs: label.discs.map(([x, y, r], i) => (i === fixed ? [x, y, r] : [x + dx, y + dy, r])) };
}

/**
 * The lettering as it was fitted, with what has been done to it by hand, in a picture `width` pixels wide: with each, the key it is
 * known by. A label that has not been touched is the same object.
 */
export function editLabels(labels: Label[], edits: LabelEdits, width: number): { label: Label; key: string }[] {
  const keys = labelKeys(labels);
  const out: { label: Label; key: string }[] = [];
  labels.forEach((label, i) => {
    const key = keys[i]!;
    if (edits.removed.includes(key)) return;
    const move = edits.moved[key];
    out.push({ label: move ? shifted(label, move[0] * width, move[1] * width) : label, key });
  });
  return out;
}

/** With one label moved to so far from where it was fitted, or put back there by a move of nothing. */
export function withMove(edits: LabelEdits, key: string, move: [number, number]): LabelEdits {
  const { [key]: _, ...rest } = edits.moved;
  return { ...edits, moved: move[0] === 0 && move[1] === 0 ? rest : { ...rest, [key]: move } };
}

/** With one label taken off. */
export const withRemoved = (edits: LabelEdits, key: string): LabelEdits => (edits.removed.includes(key) ? edits : { ...edits, removed: [...edits.removed, key] });

/**
 * Which label is at a point, or within `reach` of it, or -1: the one with the smallest lettering of those that are, as a small name
 * that lies by a large one is the harder to take hold of.
 */
export function labelAt(labels: Label[], x: number, y: number, reach = 0): number {
  let best = -1;
  labels.forEach((label, i) => {
    if (best >= 0 && labels[best]!.size <= label.size) return;
    if (label.discs.some(([cx, cy, r]) => (cx - x) ** 2 + (cy - y) ** 2 <= (r + reach) ** 2)) best = i;
  });
  return best;
}
