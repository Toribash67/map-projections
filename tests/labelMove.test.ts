import { describe, expect, test } from 'vitest';
import { editLabels, isEdited, labelAt, labelKeys, NO_EDITS, shifted, withMove, withRemoved } from '../src/labels/move';
import type { Label } from '../src/labels/place';

const label = (text: string, x: number, y: number, size = 10, kind: Label['kind'] = 'country'): Label => ({
  kind,
  text,
  size,
  glyphs: [...text].map((ch, i) => ({ ch, x: x + i * size, y, angle: 0 })),
  discs: [...text].map((_, i) => [x + i * size, y, 0.6 * size]),
});

describe('lettering moved by hand', () => {
  const labels = [label('CHAD', 100, 100), label('30°N', 0, 50, 8, 'degree'), label('MALI', 60, 110, 4), label('30°N', 990, 50, 8, 'degree')];

  test('a label is known by its kind and text, and by which it is of those that say the same', () => {
    expect(labelKeys(labels)).toEqual(['country:CHAD', 'degree:30°N', 'country:MALI', 'degree:30°N#1']);
  });

  test('a move is a share of the picture, so it is the same move in a picture of any size', () => {
    const edits = withMove(NO_EDITS, 'country:CHAD', [0.01, -0.02]);
    for (const width of [1000, 4000]) {
      const [chad, north] = editLabels(labels, edits, width);
      expect(chad!.key).toBe('country:CHAD');
      expect(chad!.label.glyphs[0]).toMatchObject({ x: 100 + 0.01 * width, y: 100 - 0.02 * width });
      expect(chad!.label.discs[1]).toEqual([110 + 0.01 * width, 100 - 0.02 * width, 6]);
      // One that has not been touched is the same object, and the fitted lettering is not changed.
      expect(north!.label).toBe(labels[1]);
    }
    expect(labels[0]!.glyphs[0]!.x).toBe(100);
    expect(shifted(labels[0]!, 0, 0)).toBe(labels[0]);
  });

  test('a label taken off is gone, the others keep their keys, and a move of nothing is no edit', () => {
    const edits = withRemoved(withRemoved(NO_EDITS, 'degree:30°N'), 'degree:30°N');
    expect(edits.removed).toEqual(['degree:30°N']);
    expect(editLabels(labels, edits, 1000).map(({ key }) => key)).toEqual(['country:CHAD', 'country:MALI', 'degree:30°N#1']);
    expect(isEdited(NO_EDITS)).toBe(false);
    expect(isEdited(edits)).toBe(true);
    const moved = withMove(NO_EDITS, 'country:MALI', [0.1, 0]);
    expect(isEdited(moved)).toBe(true);
    expect(isEdited(withMove(moved, 'country:MALI', [0, 0]))).toBe(false);
    // Nothing is changed in place.
    expect(NO_EDITS).toEqual({ moved: {}, removed: [] });
  });

  test('the label at a point is the one with the smallest lettering there, and none where there is none', () => {
    expect(labelAt(labels, 102, 101)).toBe(0);
    // Mali's small name lies against Chad's large one: where both are, it is the small one that is taken hold of.
    const close = [label('CHAD', 100, 100), label('MALI', 101, 101, 4)];
    expect(labelAt(close, 102, 101)).toBe(1);
    expect(labelAt(labels, 500, 500)).toBe(-1);
    // A finger reaches a little farther than a cursor.
    expect(labelAt(labels, 100, 110)).toBe(-1);
    expect(labelAt(labels, 100, 110, 5)).toBe(0);
  });
});
