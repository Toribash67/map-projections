import { describe, expect, test } from 'vitest';
import { DEFAULT_LAYERS } from '../src/layers/layers';
import { DEFAULT_PREFS, loadPrefs, PREFS_KEY, savePrefs, type Prefs } from '../src/prefs';

/** A store that holds one value, as the browser's does for a key. */
function store(initial: string | null = null) {
  let value = initial;
  return { getItem: (key: string) => (key === PREFS_KEY ? value : null), setItem: (key: string, v: string) => void (key === PREFS_KEY && (value = v)), read: () => value };
}
const stored = (value: unknown) => store(JSON.stringify(value));

describe('preferences', () => {
  test('with nothing kept, they are the defaults', () => {
    expect(loadPrefs(store())).toEqual(DEFAULT_PREFS);
    expect(DEFAULT_PREFS).toEqual({ theme: 'auto', overrides: {}, layers: DEFAULT_LAYERS, locator: { surface: true, collapsed: false }, drawMode: 'map' });
    expect(PREFS_KEY).toBe('map-projections:prefs:v1');
  });

  test('what is saved is read back the same', () => {
    const prefs: Prefs = {
      theme: 'blueprint',
      overrides: { ocean: '#102030', accent: '#AABBCC' },
      layers: { on: { ...DEFAULT_LAYERS.on, political: true, coast: false, tissot: true, rivers: true, countryNames: true, titleBox: true }, graticuleStep: 30, graticuleUnder: true, smallestName: 3, title: 'Ma carte', subtitle: 'for the hall', corner: 'bl' },
      locator: { surface: false, collapsed: true },
      drawMode: 'globe',
    };
    const s = store();
    savePrefs(prefs, s);
    expect(loadPrefs(s)).toEqual(prefs);
  });

  test('what cannot be read is the defaults, and nothing is thrown', () => {
    for (const bad of ['{not json', '', 'null', '42', '"auto"', '[]']) expect(loadPrefs(store(bad)), bad).toEqual(DEFAULT_PREFS);
    expect(loadPrefs({ getItem: () => { throw new Error('no storage here'); } })).toEqual(DEFAULT_PREFS);
  });

  test('each part that is wrong takes its default, and the rest is kept', () => {
    expect(loadPrefs(stored({ theme: 'neon' }))).toEqual(DEFAULT_PREFS);
    // Nor is a name that every object has a theme.
    for (const theme of ['constructor', 'toString', '__proto__']) expect(loadPrefs(stored({ theme })), theme).toEqual(DEFAULT_PREFS);
    expect(loadPrefs(stored({ theme: 'print', drawMode: 'sideways', locator: { surface: 'yes', collapsed: true } }))).toEqual({ ...DEFAULT_PREFS, theme: 'print', locator: { surface: true, collapsed: true } });
    // A colour has to be six hex digits; a key has to be one of the map's colours.
    expect(loadPrefs(stored({ overrides: { ocean: 'red', land: '#12345', coast: '#abcdef', sky: '#000000', accent: 7 } })).overrides).toEqual({ coast: '#abcdef' });
    // A layer that is not a yes or no, or is missing, is as it is by default; one that is not a layer is dropped.
    const layers = loadPrefs(stored({ layers: { on: { borders: true, land: 'no', clouds: true }, graticuleStep: 20 } })).layers;
    expect(layers).toEqual({ ...DEFAULT_LAYERS, on: { ...DEFAULT_LAYERS.on, borders: true } });
    expect(loadPrefs(stored({ layers: 'all' })).layers).toEqual(DEFAULT_LAYERS);
    expect(loadPrefs(stored({ layers: { on: null, graticuleStep: 15 } })).layers).toEqual({ ...DEFAULT_LAYERS, graticuleStep: 15 });
    // The choices of the names and the plate: one that is not a choice is the default, a size is kept within its limits, and a title is not endless.
    const read = (layers: unknown) => loadPrefs(stored({ layers })).layers;
    expect(read({ corner: 'middle', smallestName: 'x', graticuleUnder: 1, title: 7, subtitle: null })).toEqual(DEFAULT_LAYERS);
    expect(read({ smallestName: 50 }).smallestName).toBe(10);
    expect(read({ smallestName: -3 }).smallestName).toBe(1);
    expect(read({ smallestName: 7.5 }).smallestName).toBe(7.5);
    expect(read({ title: 'x'.repeat(500), subtitle: 'y'.repeat(500) })).toMatchObject({ title: 'x'.repeat(80), subtitle: 'y'.repeat(80) });
    expect(read({ title: '', corner: 'tl' })).toMatchObject({ title: '', corner: 'tl' });
  });

  test('saving where nothing can be kept throws nothing', () => {
    expect(() => savePrefs(DEFAULT_PREFS, { setItem: () => { throw new Error('full'); } })).not.toThrow();
  });

  test('what is read is its own copy: changing it does not change the defaults', () => {
    const prefs = loadPrefs(store());
    prefs.layers.on.land = false;
    prefs.locator.surface = false;
    expect(DEFAULT_PREFS.layers.on.land).toBe(true);
    expect(DEFAULT_PREFS.locator.surface).toBe(true);
  });
});
