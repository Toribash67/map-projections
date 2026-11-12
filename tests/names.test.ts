import { beforeAll, describe, expect, test } from 'vitest';
import countriesTopology from 'world-atlas/countries-110m.json';
import { COUNTRY_SHAPES } from '../src/data/countryShapes';
import { displayName } from '../src/data/displayNames';
import { LAND } from '../src/data/land';
import { loadWater, type Sea } from '../src/data/water';
import { contains, type Pair } from '../src/labels/fit';
import { buildNames, piecesOf, seaName, type NameOptions } from '../src/labels/names';
import { touches, type Label, type Measure } from '../src/labels/place';
import { screenToLonLat } from '../src/screen/screen';
import { geoContains } from 'd3-geo';
import { member, VIEW } from './sceneSupport';

// Every letter 0.62 of its height wide.
const measure: Measure = (text) => 0.62 * text.length;
const COUNTRIES: NameOptions = { countries: true, seas: false, smallest: 4, scale: 1 };
const named = (labels: Label[]) => labels.map((label) => label.text);
/** The middle of each letter, about: its baseline's start moved half a letter along and up. */
const middles = (label: Label): Pair[] => label.glyphs.map((g) => [g.x + 0.3 * label.size * (Math.cos(g.angle) + Math.sin(g.angle)), g.y + 0.3 * label.size * (Math.sin(g.angle) - Math.cos(g.angle))]);

let seas: Sea[];
beforeAll(async () => {
  seas = await loadWater('seas', '110m');
});

describe('the names that are lettered', () => {
  test('a name that Natural Earth cut short is spelled out, and every country has a shape to be named by', () => {
    const names: string[] = (countriesTopology as any).objects.countries.geometries.map((g: any) => g.properties.name);
    for (const name of names) expect(displayName(name), name).not.toContain('.');
    expect(displayName('United States of America')).toBe('United States');
    expect(displayName('Chad')).toBe('Chad');
    expect(COUNTRY_SHAPES).toHaveLength(names.length);
    expect(COUNTRY_SHAPES.map((c) => c.name)).toContain('DR Congo');
  });

  test('a sea\'s name is in ordinary letters, whatever Natural Earth shouts', () => {
    expect(seaName('INDIAN OCEAN')).toBe('Indian Ocean');
    expect(seaName('Sea of Okhotsk')).toBe('Sea of Okhotsk');
    expect(seaName('SOUTHERN OCEAN')).toBe('Southern Ocean');
  });
});

describe('country names on a map', () => {
  const mercator = member('mercator');
  const labels = buildNames(mercator, VIEW, COUNTRIES, measure, null, LAND);

  test('the large countries are named, in capitals, and no two names touch', () => {
    for (const name of ['RUSSIA', 'CANADA', 'BRAZIL', 'AUSTRALIA', 'CHINA', 'UNITED STATES', 'INDIA']) expect(named(labels), name).toContain(name);
    expect(labels.every((label) => label.kind === 'country')).toBe(true);
    labels.forEach((label, i) => expect(touches(label, labels.slice(i + 1)), label.text).toBe(false));
    expect(labels.length).toBeGreaterThan(10);
  });

  test('every letter of a name lies in its own country', () => {
    for (const label of labels) {
      const shape = COUNTRY_SHAPES.find((c) => c.name.toUpperCase() === label.text)!;
      const pieces = piecesOf(mercator, shape.geometry);
      for (const p of middles(label)) expect(pieces.some((rings) => contains(rings, p)), `${label.text} at ${p}`).toBe(true);
    }
  });

  test('a name reads left to right, or upward: never backwards and never upside down', () => {
    for (const label of labels) {
      const [first, last] = [label.glyphs[0]!, label.glyphs.at(-1)!];
      const upright = Math.abs(Math.cos(first.angle)) < Math.cos((80 * Math.PI) / 180);
      if (upright) expect(first.y, label.text).toBeGreaterThan(last.y);
      else expect(first.x, label.text).toBeLessThan(last.x);
      for (const g of label.glyphs) expect(Math.cos(g.angle), label.text).toBeGreaterThan(-0.2);
    }
  });

  test('a large country has large letters, and none is under the smallest or over the ceiling', () => {
    const size = (name: string) => labels.find((label) => label.text === name)!.size;
    expect(size('RUSSIA')).toBeGreaterThan(14);
    expect(size('UNITED STATES')).toBeGreaterThan(6);
    expect(size('BRAZIL')).toBeGreaterThan(size('IRAN'));
    for (const label of labels) {
      expect(label.size, label.text).toBeGreaterThanOrEqual(4);
      expect(label.size, label.text).toBeLessThanOrEqual(30);
    }
  });

  test('the smaller a name may be, the more countries are named', () => {
    const count = (smallest: number) => buildNames(mercator, VIEW, { ...COUNTRIES, smallest }, measure, null, LAND).length;
    expect(count(2)).toBeGreaterThan(2 * count(4));
    expect(count(4)).toBeGreaterThan(count(10));
  });

  test('a country cut in two by the edge of the map is named once, on its larger part', () => {
    // Centred on Greenwich, the far east of Russia is across the map from the rest; centred on the date line, the United States are cut.
    for (const lon of [0, 180, 90]) {
      const m = member('mercator', { lon });
      const names = named(buildNames(m, VIEW, COUNTRIES, measure, null, LAND));
      expect(names.filter((name) => name === 'RUSSIA'), `${lon}`).toHaveLength(1);
      expect(new Set(names).size, `${lon}`).toBe(names.length);
    }
    const russia = labels.find((label) => label.text === 'RUSSIA')!;
    // On the larger part, which is the one in the east of the map.
    expect(russia.glyphs[0]!.x).toBeGreaterThan(VIEW.width / 2);
  });

  test('on a globe nothing is named on the far side, and no letter is off the disc', () => {
    const globe = member('globe', { lon: 20, lat: 10 });
    const names = buildNames(globe, VIEW, COUNTRIES, measure, null, LAND);
    expect(named(names)).toContain('ALGERIA');
    for (const far of ['AUSTRALIA', 'UNITED STATES', 'MEXICO']) expect(named(names)).not.toContain(far);
    for (const label of names) for (const p of middles(label)) expect(screenToLonLat(globe.compiled, globe.screen, p), label.text).not.toBeNull();
  });

  test('in a picture twice the size, the names are twice the size and the same names', () => {
    const twice = { ...mercator, screen: { ...mercator.screen, k: mercator.screen.k * 2, tx: mercator.screen.tx * 2, ty: mercator.screen.ty * 2 } };
    const large = buildNames(twice, { width: 2 * VIEW.width, height: 2 * VIEW.height }, { ...COUNTRIES, scale: 2 }, measure, null, LAND);
    expect(named(large)).toEqual(named(labels));
    large.forEach((label, i) => expect(label.size, label.text).toBeCloseTo(2 * labels[i]!.size, 3));
  });

  test('zoomed in on Europe, its countries are named within the window', () => {
    // Four times as large about the middle of the window, then moved so that Europe is in it.
    const s = mercator.screen;
    const zoomed = { ...mercator, screen: { ...s, k: s.k * 4, tx: 500 + 4 * (s.tx - 500) - 150, ty: 300 + 4 * (s.ty - 300) + 520 } };
    const names = buildNames(zoomed, VIEW, COUNTRIES, measure, null, LAND);
    for (const name of ['FRANCE', 'GERMANY', 'POLAND', 'SPAIN']) expect(named(names), name).toContain(name);
    for (const label of names) {
      for (const [x, y] of middles(label)) {
        expect(x, label.text).toBeGreaterThan(-1);
        expect(x, label.text).toBeLessThan(VIEW.width + 1);
        expect(y, label.text).toBeGreaterThan(-1);
        expect(y, label.text).toBeLessThan(VIEW.height + 1);
      }
    }
  });
});

describe('sea names on a map', () => {
  const mollweide = member('mollweide');

  test('the oceans are named, in their own kind, on water, and touch no country\'s name', () => {
    const labels = buildNames(mollweide, VIEW, { countries: true, seas: true, smallest: 5, scale: 1 }, measure, seas, LAND);
    const ofSeas = labels.filter((label) => label.kind === 'sea');
    for (const ocean of ['Indian Ocean', 'South Pacific Ocean', 'North Atlantic Ocean', 'South Atlantic Ocean']) expect(named(ofSeas), ocean).toContain(ocean);
    labels.forEach((label, i) => expect(touches(label, labels.slice(i + 1)), label.text).toBe(false));
    for (const label of ofSeas) {
      for (const p of middles(label)) {
        const place = screenToLonLat(mollweide.compiled, mollweide.screen, p);
        expect(place, label.text).not.toBeNull();
        expect(geoContains(LAND as any, place!), `${label.text} at ${place}`).toBe(false);
      }
    }
  });

  test('with the seas not yet fetched, or not asked for, there are none; with the countries off there are only seas', () => {
    expect(buildNames(mollweide, VIEW, { countries: false, seas: true, smallest: 5, scale: 1 }, measure, null, LAND)).toEqual([]);
    expect(buildNames(mollweide, VIEW, { countries: true, seas: false, smallest: 5, scale: 1 }, measure, seas, LAND).some((label) => label.kind === 'sea')).toBe(false);
    const only = buildNames(mollweide, VIEW, { countries: false, seas: true, smallest: 5, scale: 1 }, measure, seas, LAND);
    expect(only.length).toBeGreaterThan(5);
    expect(only.every((label) => label.kind === 'sea')).toBe(true);
  });
});
