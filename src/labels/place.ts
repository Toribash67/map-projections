import { along, textLength, type Fit, type Pair } from './fit';

/** A letter where it stands: the left end of its baseline, and how it is turned (radians, clockwise on screen). */
export type Glyph = { ch: string; x: number; y: number; angle: number };
/**
 * Lettering as it is drawn: a country's name or a sea's along its curve, or a graticule line's degrees set level. Each letter has its
 * place, so the canvas and an exported drawing set it the same. `discs` are circles (x, y, radius) that cover it, by which two
 * names are found to touch.
 */
export type Label = { kind: 'country' | 'sea' | 'degree'; text: string; size: number; glyphs: Glyph[]; discs: [number, number, number][] };
/** The width of some text at a letter height of one, in the typeface of its kind. */
export type Measure = (text: string, kind: Label['kind']) => number;

// How far below the middle line of the lettering its baseline is, in letter heights: capitals stand about the middle.
const BASELINE = 0.36;
// The radius of the circles that cover a name, in letter heights, and how far apart they are along it.
const COVER = 0.6;
const COVER_STEP = 0.5;

/** The width of a name with no space added between its letters: each letter's own width, as that is how it is set. */
export const advanceOf = (text: string, kind: Label['kind'], measure: Measure): number => [...text].reduce((sum, ch) => sum + measure(ch, kind), 0);

/** Lettering from where its letters go: `at` gives the middle line's place and direction a distance along from the lettering's start. */
function set(text: string, kind: Label['kind'], size: number, gap: number, measure: Measure, at: (distance: number) => { p: Pair; angle: number }): Label {
  const glyphs: Glyph[] = [];
  let distance = 0;
  for (const ch of text) {
    const width = measure(ch, kind) * size;
    if (ch !== ' ') {
      // Turned about its own middle, so a letter on a bend sits squarely on it.
      const { p, angle } = at(distance + width / 2);
      const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
      glyphs.push({ ch, x: p[0] - (width / 2) * cos - BASELINE * size * sin, y: p[1] - (width / 2) * sin + BASELINE * size * cos, angle });
    }
    distance += width + gap * size;
  }
  const length = distance - gap * size;
  const discs: Label['discs'] = [];
  const count = Math.max(1, Math.ceil(length / (COVER_STEP * size)));
  for (let i = 0; i <= count; i++) {
    const { p } = at((i / count) * length);
    discs.push([p[0], p[1], COVER * size]);
  }
  return { kind, text, size, glyphs, discs };
}

/** A name set along the curve it was fitted to, about the curve's middle. */
export function setAlong(text: string, kind: Label['kind'], fit: Fit, measure: Measure): Label {
  const start = (fit.length - textLength(fit, advanceOf(text, kind, measure), [...text].length)) / 2;
  return set(text, kind, fit.size, fit.gap, measure, (distance) => along(fit.curve, start + distance));
}

/** Text set level about a point, with no space added between its letters. */
export function setLevel(text: string, kind: Label['kind'], centre: Pair, size: number, measure: Measure): Label {
  const start = centre[0] - (advanceOf(text, kind, measure) * size) / 2;
  return set(text, kind, size, 0, measure, (distance) => ({ p: [start + distance, centre[1]], angle: 0 }));
}

/** Whether a name lies on or against any of some others. */
export function touches(label: Label, others: Label[]): boolean {
  for (const other of others) {
    for (const [ax, ay, ar] of label.discs) {
      for (const [bx, by, br] of other.discs) {
        if ((ax - bx) ** 2 + (ay - by) ** 2 < (ar + br) ** 2) return true;
      }
    }
  }
  return false;
}
