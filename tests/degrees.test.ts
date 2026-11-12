import { describe, expect, test } from 'vitest';
import { buildDegrees, degreeText } from '../src/labels/degrees';
import { setLevel, touches, type Label, type Measure } from '../src/labels/place';
import { isShown, mapSize, screenToLonLat } from '../src/screen/screen';
import { member, VIEW } from './sceneSupport';

const measure: Measure = (text) => 0.6 * text.length;
const PICTURE = { x: 0, y: 0, ...VIEW };
/** The middle of a label, from what it covers. */
const middle = (label: Label): [number, number] => {
  const xs = label.discs.map((d) => d[0]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, label.discs[0]![1]];
};
const at = (labels: Label[], text: string) => labels.filter((label) => label.text === text).map(middle);

describe('the degrees of a line', () => {
  test('are written with the side of the Earth they are on', () => {
    expect(degreeText(30, 'lat')).toBe('30°N');
    expect(degreeText(-45, 'lat')).toBe('45°S');
    expect(degreeText(0, 'lat')).toBe('0°');
    expect(degreeText(60, 'lon')).toBe('60°E');
    expect(degreeText(-120, 'lon')).toBe('120°W');
    expect(degreeText(0, 'lon')).toBe('0°');
    expect(degreeText(180, 'lon')).toBe('180°');
    expect(degreeText(-180, 'lon')).toBe('180°');
  });
});

describe('degrees on a map', () => {
  test('on a map with straight sides: parallels at the left and right, meridians above and below, none touching', () => {
    const m = member('equirectangular');
    const { width, height } = mapSize(m.compiled, VIEW);
    const [left, right, top, bottom] = [(VIEW.width - width) / 2, (VIEW.width + width) / 2, (VIEW.height - height) / 2, (VIEW.height + height) / 2];
    const labels = buildDegrees(m, PICTURE, 30, 1, measure, []);
    expect(labels.every((label) => label.kind === 'degree' && label.size === 9)).toBe(true);
    labels.forEach((label, i) => expect(touches(label, labels.slice(i + 1)), label.text).toBe(false));
    // A parallel has its degrees at both ends, at its own height: just outside the map where the margin has room for them, as it has
    // for the equator's, and just inside where it has not.
    for (const [text, lat] of [['60°N', 60], ['30°S', -30], ['0°', 0]] as const) {
      const y = top + ((90 - lat) / 180) * height;
      const ends = at(labels, text).filter((p) => Math.abs(p[1] - y) < 2);
      expect(ends.some(([x]) => Math.abs(x - left) < 30), `${text} on the left`).toBe(true);
      expect(ends.some(([x]) => Math.abs(x - right) < 30), `${text} on the right`).toBe(true);
      expect(ends.some(([x]) => x < left) && text !== '0°', `${text} outside`).toBe(false);
    }
    // A meridian has them above and below the map, outside it.
    for (const [text, lon] of [['90°E', 90], ['60°W', -60], ['150°E', 150]] as const) {
      const x = left + ((lon + 180) / 360) * width;
      const ends = at(labels, text).filter((p) => Math.abs(p[0] - x) < 2);
      expect(ends.some(([, y]) => y < top && y > top - 25), `${text} above`).toBe(true);
      expect(ends.some(([, y]) => y > bottom && y < bottom + 25), `${text} below`).toBe(true);
    }
  });

  test('a finer graticule has more of them, and a larger picture has larger ones', () => {
    const m = member('equirectangular');
    expect(buildDegrees(m, PICTURE, 10, 1, measure, []).length).toBeGreaterThan(buildDegrees(m, PICTURE, 30, 1, measure, []).length);
    const twice = { ...m, screen: { ...m.screen, k: m.screen.k * 2, tx: m.screen.tx * 2, ty: m.screen.ty * 2 } };
    const large = buildDegrees(twice, { x: 0, y: 0, width: 2 * VIEW.width, height: 2 * VIEW.height }, 30, 2, measure, []);
    expect(large.every((label) => label.size === 18)).toBe(true);
    expect(large.map((label) => label.text).sort()).toEqual(buildDegrees(m, PICTURE, 30, 1, measure, []).map((label) => label.text).sort());
  });

  test('on a globe they stand round the disc and never on it', () => {
    const globe = member('globe', { lon: 10, lat: 20 });
    const labels = buildDegrees(globe, PICTURE, 30, 1, measure, []);
    expect(labels.length).toBeGreaterThan(6);
    for (const label of labels) {
      const place = screenToLonLat(globe.compiled, globe.screen, middle(label));
      expect(place === null || !isShown(globe.compiled, place), label.text).toBe(true);
    }
  });

  test('where the meridians meet at a pole they do not pile up, and the rounder numbers are the ones kept', () => {
    for (const id of ['sinusoidal', 'bonne', 'mollweide', 'goode']) {
      const m = member(id);
      const labels = buildDegrees(m, PICTURE, 10, 1, measure, []);
      labels.forEach((label, i) => expect(touches(label, labels.slice(i + 1)), `${id} ${label.text}`).toBe(false));
      expect(labels.length, id).toBeGreaterThan(8);
      for (const label of labels) for (const [x, y] of label.discs) expect(x > -1 && x < VIEW.width + 1 && y > -1 && y < VIEW.height + 1, `${id} ${label.text}`).toBe(true);
    }
  });

  test('a pole in the middle of a map, where the lines stop but the map goes on, has none', () => {
    for (const id of ['peirce', 'butterfly', 'azimuthal-equidistant']) {
      const m = member(id);
      const labels = buildDegrees(m, PICTURE, 30, 1, measure, []);
      const [cx, cy] = [VIEW.width / 2, VIEW.height / 2];
      for (const label of labels) expect(Math.hypot(middle(label)[0] - cx, middle(label)[1] - cy), `${id} ${label.text}`).toBeGreaterThan(60);
    }
  });

  test('they keep clear of names already on the map', () => {
    const m = member('equirectangular');
    const free = buildDegrees(m, PICTURE, 30, 1, measure, []);
    const first = free[0]!;
    const name = setLevel('ATLANTIS', 'country', middle(first), 12, measure);
    const crowded = buildDegrees(m, PICTURE, 30, 1, measure, [name]);
    for (const label of crowded) expect(touches(label, [name]), label.text).toBe(false);
    expect(crowded.length).toBeLessThan(free.length);
  });

  test('zoomed in, they stand just inside the edge of the picture, where each line leaves it', () => {
    const m = member('equirectangular');
    const s = m.screen;
    const zoomed = { ...m, screen: { ...s, k: s.k * 4, tx: 500 + 4 * (s.tx - 500), ty: 300 + 4 * (s.ty - 300) } };
    const labels = buildDegrees(zoomed, PICTURE, 10, 1, measure, []);
    expect(labels.length).toBeGreaterThan(8);
    for (const label of labels) {
      const [x, y] = middle(label);
      expect(x > 0 && x < VIEW.width && y > 0 && y < VIEW.height, label.text).toBe(true);
      expect(Math.min(x, VIEW.width - x, y, VIEW.height - y), label.text).toBeLessThan(30);
    }
  });
});
