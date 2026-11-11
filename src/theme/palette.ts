/**
 * Every colour of the app, once, for light and for dark. The page reads them as CSS custom properties (`paletteCss`, put in the
 * page's head by the build, so there is no flash of the wrong one) and the canvas as a style (`mapStyle` in render/style.ts), so
 * neither has a list of its own. This file imports nothing, as the build config reads it too.
 */
export type Palette = {
  // The page: the map's surround and the number boxes, the sidebar, its text, a hairline, and the one accent, with a deeper shade of it
  // for text, such as a refused point's notice, where small letters need more contrast than a line or a fill.
  paper: string;
  panel: string;
  ink: string;
  muted: string;
  line: string;
  accent: string;
  accentText: string;
  accentWash: string;
  shadow: string;
  // The map: sea, land, the graticule, the coast, a drawing's fill, and the locator's tint of the area the map covers and halo of its marker.
  ocean: string;
  land: string;
  graticule: string;
  coast: string;
  accentFill: string;
  // A Tissot indicatrix: the accent, stronger than a drawing's fill, as it has no outline to carry it.
  indicatrix: string;
  tint: string;
  halo: string;
};
export type Scheme = 'light' | 'dark';

/** Paper, slate and one red accent, as the app has always been. The accent as text is darker, 5.5:1 on the sidebar where the accent is 3.9. */
export const LIGHT: Palette = {
  paper: '#eceae4',
  panel: '#f7f5ef',
  ink: '#2b3a44',
  muted: '#5d6e78',
  line: 'rgba(62, 84, 98, 0.18)',
  accent: '#d9472b',
  accentText: '#b23a20',
  accentWash: 'rgba(217, 71, 43, 0.1)',
  shadow: 'rgba(43, 58, 68, 0.25)',
  ocean: '#d3dfe5',
  land: '#f7f5ef',
  graticule: 'rgba(62, 84, 98, 0.16)',
  coast: '#97a3a9',
  accentFill: 'rgba(217, 71, 43, 0.16)',
  indicatrix: 'rgba(217, 71, 43, 0.34)',
  tint: '#97a3a9',
  halo: 'rgba(247, 245, 239, 0.85)',
};

/**
 * The same, by night: a dark blue sea and land well lighter and a little warmer, a grey with less blue in it, so the two are told apart
 * at a glance (1.6:1) and the map stays the brightest thing on the page; the coast and the graticule in slate, quiet but seen; and a
 * lighter red for the accent, which stays clear on both land and sea (contrast 3.6 and 5.8, of 3 needed), and as text on the sidebar
 * (5.9, of 4.5 for body text). The ratios are held by tests/palette.test.ts.
 */
export const DARK: Palette = {
  paper: '#12171b',
  panel: '#1b2127',
  ink: '#e4e9ec',
  muted: '#9fb0ba',
  line: 'rgba(160, 185, 200, 0.2)',
  accent: '#ff7052',
  accentText: '#ff7052',
  accentWash: 'rgba(255, 112, 82, 0.16)',
  shadow: 'rgba(0, 0, 0, 0.55)',
  ocean: '#152430',
  land: '#3c4542',
  graticule: 'rgba(150, 180, 200, 0.14)',
  coast: '#62798a',
  accentFill: 'rgba(255, 112, 82, 0.24)',
  indicatrix: 'rgba(255, 112, 82, 0.4)',
  tint: '#7f98a8',
  halo: 'rgba(18, 23, 27, 0.85)',
};

export const SCHEMES: readonly Scheme[] = ['light', 'dark'];
export const PALETTES: Record<Scheme, Palette> = { light: LIGHT, dark: DARK };

const propertyOf = (token: string) => `--${token.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
const declarations = (palette: Palette) => Object.entries(palette).map(([token, colour]) => `${propertyOf(token)}: ${colour};`).join(' ');

/**
 * The custom properties of the page: light by default, dark under the system's setting. `color-scheme` makes the browser's own controls,
 * scrollbars and canvas default follow it.
 */
export function paletteCss(): string {
  return `:root { color-scheme: light dark; ${declarations(LIGHT)} }\n@media (prefers-color-scheme: dark) { :root { ${declarations(DARK)} } }`;
}

/** The browser chrome's colour for each scheme: the page's background. */
export const themeColors = (): { scheme: Scheme; color: string }[] => SCHEMES.map((scheme) => ({ scheme, color: PALETTES[scheme].paper }));
