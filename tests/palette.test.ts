import { afterEach, describe, expect, test, vi } from 'vitest';
import indexHtml from '../index.html?raw';
import appSource from '../src/app.ts?raw';
import drawSource from '../src/render/draw.ts?raw';
import locatorSource from '../src/render/locator.ts?raw';
import styleSource from '../src/render/style.ts?raw';
import styleCss from '../src/style.css?raw';
import { mapStyle } from '../src/render/style';
import { DARK, LIGHT, paletteCss, SCHEMES, themeColors, type Palette } from '../src/theme/palette';
import { currentScheme, watchScheme } from '../src/theme/scheme';

// Colours as 'rgb(a)' or '#rrggbb', to [r, g, b, a].
function parse(colour: string): [number, number, number, number] {
  const hex = /^#([0-9a-f]{6})$/i.exec(colour);
  if (hex) return [1, 3, 5].map((i) => parseInt(hex[1]!.slice(i - 1, i + 1), 16)).concat(1) as [number, number, number, number];
  const rgba = /^rgba?\(([^)]+)\)$/.exec(colour);
  if (!rgba) throw new Error(`not a colour: ${colour}`);
  const [r, g, b, a = 1] = rgba[1]!.split(',').map(Number);
  return [r!, g!, b!, a];
}
/** A colour laid over an opaque one. */
function over(colour: string, under: string): [number, number, number] {
  const [r, g, b, a] = parse(colour);
  const base = parse(under);
  return [r, g, b].map((v, i) => v * a + base[i]! * (1 - a)) as [number, number, number];
}
const luminance = ([r, g, b]: number[]) => {
  const lin = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!);
};
/** WCAG contrast ratio of two opaque colours. */
const ratio = (a: number[], b: number[]) => {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high! + 0.05) / (low! + 0.05);
};
const solid = (c: string) => parse(c).slice(0, 3);

// What the colours were before there was a dark mode. Light mode stays exactly as it was.
const LIGHT_BEFORE = {
  paper: '#eceae4', panel: '#f7f5ef', ink: '#2b3a44', muted: '#5d6e78', line: 'rgba(62, 84, 98, 0.18)', accent: '#d9472b', accentWash: 'rgba(217, 71, 43, 0.1)',
  ocean: '#d3dfe5', land: '#f7f5ef', graticule: 'rgba(62, 84, 98, 0.16)', coast: '#97a3a9', accentFill: 'rgba(217, 71, 43, 0.16)', tint: '#97a3a9',
  halo: 'rgba(247, 245, 239, 0.85)', shadow: 'rgba(43, 58, 68, 0.25)',
};

describe('the palette', () => {
  test('light mode has the colours it had before there was a dark mode, and a darker red for text', () => {
    // The indicatrix's own fill came with its losing its outline.
    const { accentText, indicatrix, ...rest } = LIGHT;
    expect(indicatrix).toBe('rgba(217, 71, 43, 0.34)');
    expect(rest).toEqual(LIGHT_BEFORE);
    expect(accentText).not.toBe(LIGHT.accent);
    expect(mapStyle('light')).toMatchObject({ background: '#eceae4', ocean: '#d3dfe5', land: '#f7f5ef', graticule: 'rgba(62, 84, 98, 0.16)', coast: '#97a3a9', accent: '#d9472b', accentFill: 'rgba(217, 71, 43, 0.16)' });
  });

  test('both schemes colour every token, in colours the page and canvas both read', () => {
    expect(Object.keys(DARK).sort()).toEqual(Object.keys(LIGHT).sort());
    for (const scheme of SCHEMES) for (const [token, colour] of Object.entries(scheme === 'light' ? LIGHT : DARK)) expect(() => parse(colour), `${scheme} ${token}`).not.toThrow();
  });

  test('the map style is the palette of its scheme, with the same widths in both', () => {
    for (const [scheme, palette] of [['light', LIGHT], ['dark', DARK]] as const) {
      const style = mapStyle(scheme);
      expect([style.background, style.ocean, style.land, style.graticule, style.coast, style.accent, style.accentFill]).toEqual([palette.paper, palette.ocean, palette.land, palette.graticule, palette.coast, palette.accent, palette.accentFill]);
    }
    const [light, dark] = [mapStyle('light'), mapStyle('dark')];
    expect([light.seamWidth, light.graticuleWidth, light.coastWidth, light.drawingWidth]).toEqual([dark.seamWidth, dark.graticuleWidth, dark.coastWidth, dark.drawingWidth]);
    expect(mapStyle('dark')).toBe(mapStyle('dark'));
  });

  test('the page css has every token of both schemes, and dark under the system setting', () => {
    const css = paletteCss();
    const dark = css.slice(css.indexOf('prefers-color-scheme: dark'));
    expect(css).toContain('color-scheme: light dark');
    for (const [token, colour] of Object.entries(LIGHT)) expect(css.slice(0, css.indexOf('@media')), token).toContain(colour);
    for (const [token, colour] of Object.entries(DARK)) expect(dark, token).toContain(colour);
    expect(css).toContain('--accent-wash:');
  });

  test('a theme-color for each scheme is the page background of that scheme', () => {
    expect(themeColors()).toEqual([{ scheme: 'light', color: LIGHT.paper }, { scheme: 'dark', color: DARK.paper }]);
  });

  // The colours are in the palette and nowhere else, so there are not two lists to drift apart.
  const literal = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/;
  test.each([['src/style.css', styleCss], ['index.html', indexHtml], ['src/render/draw.ts', drawSource], ['src/render/locator.ts', locatorSource], ['src/app.ts', appSource], ['src/render/style.ts', styleSource]])(
    '%s holds no colour of its own',
    (_, source) => {
      const text = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(text).not.toMatch(literal);
    },
  );
});

describe('the light palette\'s accent as text', () => {
  test('a notice in the accent meets WCAG AA for body text (4.5:1) on the sidebar and the page, where the accent itself is 3.9', () => {
    expect(ratio(solid(LIGHT.accentText), solid(LIGHT.panel))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(solid(LIGHT.accentText), solid(LIGHT.paper))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(solid(LIGHT.accent), solid(LIGHT.panel))).toBeLessThan(4.5);
  });
});

test('the accent as text is only text: the notices use it, and nothing else does', () => {
  const uses = (token: string) => [...styleCss.matchAll(new RegExp(`([^{}]+)\\{[^}]*var\\(--${token}\\)`, 'g'))].map((m) => m[1]!.trim());
  expect(uses('accent-text').sort()).toEqual(['.draw-notice', '.limits-reached']);
  expect(uses('accent')).not.toContain('.draw-notice');
  expect(uses('accent')).not.toContain('.limits-reached');
});

describe('the dark palette is legible', () => {
  const p: Palette = DARK;
  const page = solid(p.panel);

  test('sidebar text meets WCAG AA for body text (4.5:1): ink, muted and hint text, and the accent used as text', () => {
    expect(ratio(solid(p.ink), page)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(solid(p.muted), page)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(solid(p.accentText), page)).toBeGreaterThanOrEqual(4.5);
    // The number boxes sit on the page's own background.
    expect(ratio(solid(p.ink), solid(p.paper))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(solid(p.muted), solid(p.paper))).toBeGreaterThanOrEqual(4.5);
  });

  test('the selected item is still ink on its wash, and its accent bar and the focus outline are seen (3:1)', () => {
    const wash = over(p.accentWash, p.panel);
    expect(ratio(solid(p.ink), wash)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(solid(p.accent), page)).toBeGreaterThanOrEqual(3);
    expect(ratio(solid(p.accent), wash)).toBeGreaterThanOrEqual(3);
  });

  test('a disabled control at 45% opacity is still told from the page (the ink at 45% is dimmer than muted, brighter than the panel)', () => {
    const faded = over(`rgba(${solid(p.ink).join(',')}, 0.45)`, p.panel);
    expect(ratio(faded, page)).toBeGreaterThanOrEqual(2);
    expect(ratio(faded, page)).toBeLessThan(ratio(solid(p.muted), page));
  });

  test('on the map, the sea is darker than the land, both a step from the surround, and the accent is seen on both (3:1)', () => {
    const [sea, land, back] = [solid(p.ocean), solid(p.land), solid(p.paper)];
    expect(luminance(sea)).toBeLessThan(luminance(land));
    expect(luminance(sea)).toBeLessThan(0.05);
    // Land and sea told apart at a glance, by lightness and a little warmth: the land is less blue than the sea.
    expect(ratio(land, sea)).toBeGreaterThanOrEqual(1.5);
    const warmth = ([r, , b]: number[]) => r! - b!;
    expect(warmth(land)).toBeGreaterThan(warmth(sea));
    expect(ratio(sea, back)).toBeGreaterThanOrEqual(1.1);
    expect(ratio(solid(p.accent), land)).toBeGreaterThanOrEqual(3);
    expect(ratio(solid(p.accent), sea)).toBeGreaterThanOrEqual(3);
    // The accent fill of a drawing over the land and sea does not hide them.
    expect(ratio(solid(p.accent), over(p.accentFill, p.land))).toBeGreaterThanOrEqual(2.5);
  });

  test('the coast and the graticule are muted but legible: the coast at least as clear as in light mode, and not harsher than the land is bright', () => {
    const [coast, land, sea] = [solid(p.coast), solid(p.land), solid(p.ocean)];
    expect(ratio(coast, land)).toBeGreaterThanOrEqual(2);
    expect(ratio(coast, sea)).toBeGreaterThanOrEqual(2);
    expect(ratio(coast, land)).toBeLessThan(5);
    const lines = over(p.graticule, p.ocean);
    expect(ratio(lines, sea)).toBeGreaterThanOrEqual(1.1);
    expect(ratio(lines, sea)).toBeLessThan(ratio(coast, sea));
  });

  test('the locator\'s tint is seen over the sea, and its text and marker are legible on it', () => {
    const tinted = over(`rgba(${solid(p.tint).join(',')}, 0.32)`, p.ocean);
    expect(ratio(tinted, solid(p.ocean))).toBeGreaterThanOrEqual(1.25);
    expect(ratio(solid(p.ink), tinted)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(solid(p.accent), tinted)).toBeGreaterThanOrEqual(3);
  });
});

describe('following the system', () => {
  afterEach(() => vi.unstubAllGlobals());

  test('light where there is no matchMedia, dark when the system prefers it', () => {
    expect(currentScheme()).toBe('light');
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('dark'), addEventListener: () => {} }));
    expect(currentScheme()).toBe('dark');
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {} }));
    expect(currentScheme()).toBe('light');
  });

  test('a change of the setting is reported with the new scheme', () => {
    let listener: ((e: { matches: boolean }) => void) | undefined;
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: (_: string, fn: typeof listener) => void (listener = fn) }));
    const seen: string[] = [];
    watchScheme((scheme) => seen.push(scheme));
    listener!({ matches: true });
    listener!({ matches: false });
    expect(seen).toEqual(['dark', 'light']);
  });
});
