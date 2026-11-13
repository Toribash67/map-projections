import { DARK, LIGHT, type Palette, type Scheme } from './palette';

/** The looks the map can have. `auto` is the paper look, light or dark with the system; the rest are the same whatever the system says. */
export type ThemeId = 'auto' | 'light' | 'dark' | 'atlas' | 'blueprint' | 'print' | 'poster' | 'parchment' | 'slate' | 'moss';

export const THEME_NAMES: Record<ThemeId, string> = {
  auto: 'Auto',
  light: 'Light',
  dark: 'Dark',
  atlas: 'Atlas',
  blueprint: 'Blueprint',
  print: 'Print',
  poster: 'Poster',
  parchment: 'Parchment',
  slate: 'Slate',
  moss: 'Moss',
};

/** The colours of the map that can be set by hand, over the theme's. */
export type ColourKey = 'ocean' | 'deep' | 'land' | 'coast' | 'rivers' | 'graticule' | 'borders' | 'labels' | 'seaLabels' | 'accent' | 'paper';
export const COLOUR_NAMES: [ColourKey, string][] = [
  ['ocean', 'Sea'],
  ['deep', 'Deep sea'],
  ['land', 'Land'],
  ['coast', 'Coast'],
  ['rivers', 'Rivers'],
  ['graticule', 'Graticule'],
  ['borders', 'Borders'],
  ['labels', 'Names'],
  ['seaLabels', 'Sea names'],
  ['accent', 'Accent'],
  ['paper', 'Background'],
];
export type Overrides = Partial<Record<ColourKey, string>>;

/** A school atlas: a pale blue sea, cream land, and countries in clear pastels, with brown borders. */
const ATLAS: Palette = {
  ...LIGHT,
  ocean: '#cfe4f0',
  land: '#f6efd9',
  coast: '#6f8da0',
  graticule: 'rgba(60, 90, 110, 0.18)',
  borders: '#6b5b4b',
  tint: '#8fa6b4',
  political: ['#f6d98b', '#b9d8a0', '#f4b6a2', '#cdbbe3', '#f3e9c0'],
  rivers: '#5f9cc0',
  deep: '#8fbdd8',
  labels: '#3b3229',
  seaLabels: '#3f7397',
};

/** A blueprint: white lines on deep blue, with a yellow accent. The page round it is dark. */
const BLUEPRINT: Palette = {
  paper: '#0b2238',
  panel: '#0f2b46',
  ink: '#e9f1f8',
  muted: '#a8c0d4',
  line: 'rgba(233, 241, 248, 0.2)',
  accent: '#ffc857',
  accentText: '#ffc857',
  accentWash: 'rgba(255, 200, 87, 0.16)',
  shadow: 'rgba(0, 0, 0, 0.55)',
  ocean: '#123d61',
  land: '#1a5080',
  graticule: 'rgba(233, 241, 248, 0.2)',
  coast: '#e9f1f8',
  accentFill: 'rgba(255, 200, 87, 0.24)',
  indicatrix: 'rgba(255, 200, 87, 0.42)',
  tint: '#8fb3d1',
  halo: 'rgba(11, 34, 56, 0.85)',
  borders: '#dbe8f3',
  standard: '#7ee0c9',
  reference: 'rgba(233, 241, 248, 0.5)',
  political: ['#2166a3', '#2a7a72', '#4a55a0', '#3a7a3f', '#6a4a96'],
  rivers: '#8fc7ee',
  deep: '#0a2740',
  labels: '#ffffff',
  seaLabels: '#a8c8e4',
};

/** For paper: a white sea and page, land a shade off white, black coasts, and one red accent. Its countries are in pale tints, which print as light greys. */
const PRINT: Palette = {
  ...LIGHT,
  paper: '#ffffff',
  panel: '#f6f6f6',
  ink: '#111111',
  muted: '#555555',
  line: 'rgba(0, 0, 0, 0.16)',
  accent: '#c8102e',
  accentText: '#a60d26',
  accentWash: 'rgba(200, 16, 46, 0.1)',
  shadow: 'rgba(0, 0, 0, 0.25)',
  ocean: '#ffffff',
  land: '#efefef',
  graticule: 'rgba(0, 0, 0, 0.22)',
  coast: '#000000',
  accentFill: 'rgba(200, 16, 46, 0.16)',
  indicatrix: 'rgba(200, 16, 46, 0.34)',
  tint: '#9a9a9a',
  halo: 'rgba(255, 255, 255, 0.85)',
  borders: '#000000',
  standard: '#00629b',
  reference: 'rgba(0, 0, 0, 0.5)',
  political: ['#dcdcdc', '#f2dfb0', '#cfe5c4', '#dccbe8', '#f4c9c0'],
  rivers: '#777777',
  deep: '#cfcfcf',
  labels: '#111111',
  seaLabels: '#555555',
};

/**
 * A wall map: a pale blue sea that deepens, countries in soft pastels with white between them, grey lettering, on white paper. Its
 * borders are white, and so are not seen against a country as the other themes' are: with the political colours on, two neighbours
 * are never the same colour, and the white line is what parts them.
 */
const POSTER: Palette = {
  ...LIGHT,
  paper: '#ffffff',
  ocean: '#dcedf7',
  land: '#f6eec7',
  coast: '#6f8da0',
  graticule: 'rgba(127, 163, 187, 0.28)',
  borders: '#ffffff',
  tint: '#8fa6b4',
  political: ['#f3d9a0', '#bcdcb0', '#f2b8b0', '#cfc3e6', '#f6eec7'],
  rivers: '#7fb0cf',
  deep: '#a2c7df',
  labels: '#3a3a3a',
  seaLabels: '#5b87a6',
};

/**
 * The three below are of middle tones: neither a bright page nor a dark one. The sea and the land are some way down from white, the
 * page round them is a shade of the same, and what is drawn or written on them is dark, as it must be to be read on a middle tone.
 */

/** An old chart: a grey-green sea and tan land on buff paper, sepia ink, and countries in ochre, sage, terracotta and mauve. */
const PARCHMENT: Palette = {
  paper: '#d6c9ab',
  panel: '#e4d9bf',
  ink: '#33291d',
  muted: '#5c4e3c',
  line: 'rgba(70, 50, 30, 0.22)',
  accent: '#9c2f1c',
  accentText: '#8a2a19',
  accentWash: 'rgba(156, 47, 28, 0.12)',
  shadow: 'rgba(50, 35, 20, 0.3)',
  ocean: '#a8bcb4',
  land: '#dccba3',
  graticule: 'rgba(70, 50, 30, 0.2)',
  coast: '#6b6a58',
  accentFill: 'rgba(156, 47, 28, 0.18)',
  indicatrix: 'rgba(156, 47, 28, 0.36)',
  tint: '#8a8266',
  halo: 'rgba(228, 217, 191, 0.85)',
  borders: '#5a4632',
  standard: '#1f5f6b',
  reference: 'rgba(51, 41, 29, 0.5)',
  political: ['#d9b877', '#b5bf8f', '#d49f84', '#c2aeb9', '#e3d6b0'],
  rivers: '#5f8c93',
  deep: '#7fa09c',
  labels: '#2e241a',
  seaLabels: '#35555a',
};

/** Cool and grey: a slate-blue sea and stone land on a grey page, with countries in muted sand, sage, clay and lavender. */
const SLATE: Palette = {
  paper: '#c3cad0',
  panel: '#d3d9dd',
  ink: '#24313a',
  muted: '#4a5a66',
  line: 'rgba(36, 49, 58, 0.2)',
  accent: '#8f2414',
  accentText: '#8f2414',
  accentWash: 'rgba(143, 36, 20, 0.12)',
  shadow: 'rgba(36, 49, 58, 0.3)',
  ocean: '#8ea3b5',
  land: '#c9cdc2',
  graticule: 'rgba(36, 49, 58, 0.2)',
  coast: '#4f6475',
  accentFill: 'rgba(143, 36, 20, 0.18)',
  indicatrix: 'rgba(143, 36, 20, 0.36)',
  tint: '#7d8f9c',
  halo: 'rgba(211, 217, 221, 0.85)',
  borders: '#33414c',
  standard: '#0f4f5c',
  reference: 'rgba(36, 49, 58, 0.5)',
  political: ['#c9b98a', '#9db59a', '#c99a8c', '#aa9fc4', '#d6d2c0'],
  rivers: '#55728a',
  deep: '#607a90',
  labels: '#1c262d',
  seaLabels: '#1f4258',
};

/** Green and earthy: a soft teal sea and olive land on a lichen page, with countries in straw, leaf, clay and heather. */
const MOSS: Palette = {
  paper: '#c9cdb8',
  panel: '#d9dcc9',
  ink: '#283024',
  muted: '#4d5a45',
  line: 'rgba(40, 48, 36, 0.2)',
  accent: '#8a2f12',
  accentText: '#8a2f12',
  accentWash: 'rgba(138, 47, 18, 0.12)',
  shadow: 'rgba(40, 48, 36, 0.3)',
  ocean: '#93b3b5',
  land: '#c2c79d',
  graticule: 'rgba(40, 48, 36, 0.2)',
  coast: '#4f6b63',
  accentFill: 'rgba(138, 47, 18, 0.18)',
  indicatrix: 'rgba(138, 47, 18, 0.36)',
  tint: '#7f9388',
  halo: 'rgba(217, 220, 201, 0.85)',
  borders: '#3a4030',
  standard: '#254a7a',
  reference: 'rgba(40, 48, 36, 0.5)',
  political: ['#d2bf7c', '#a3bd8a', '#cf9f7a', '#b3a7c0', '#dcd7ae'],
  rivers: '#4f8590',
  deep: '#62898e',
  labels: '#222a1e',
  seaLabels: '#254f55',
};

const FIXED: Record<Exclude<ThemeId, 'auto'>, { palette: Palette; chrome: Scheme }> = {
  light: { palette: LIGHT, chrome: 'light' },
  dark: { palette: DARK, chrome: 'dark' },
  atlas: { palette: ATLAS, chrome: 'light' },
  blueprint: { palette: BLUEPRINT, chrome: 'dark' },
  print: { palette: PRINT, chrome: 'light' },
  poster: { palette: POSTER, chrome: 'light' },
  parchment: { palette: PARCHMENT, chrome: 'light' },
  slate: { palette: SLATE, chrome: 'light' },
  moss: { palette: MOSS, chrome: 'light' },
};

/** Whether the page round the map is light or dark under a theme: the system's choice for `auto`, the theme's own otherwise. */
export const chromeScheme = (theme: ThemeId, system: Scheme): Scheme => (theme === 'auto' ? system : FIXED[theme].chrome);

/** A colour as its red, green and blue, from '#rrggbb'. */
const channels = (hex: string): string => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ');
/** The opacity of an 'rgba(...)' colour, as it is written. */
const alphaOf = (rgba: string): string => rgba.slice(rgba.lastIndexOf(',') + 1, rgba.lastIndexOf(')')).trim();

/**
 * The palette a theme gives, with any colours set by hand laid over it. An accent set by hand carries the colours made from the
 * accent with it, at the strengths the theme has them: the fill of a drawing and of an indicatrix, the wash of a chosen item, and the
 * accent as text.
 */
export function resolvePalette(theme: ThemeId, overrides: Overrides, system: Scheme): Palette {
  const base = theme === 'auto' ? (system === 'dark' ? DARK : LIGHT) : FIXED[theme].palette;
  const set = Object.fromEntries(Object.entries(overrides).filter(([, colour]) => typeof colour === 'string')) as Overrides;
  if (Object.keys(set).length === 0) return base;
  const palette: Palette = { ...base, ...set };
  if (set.accent) {
    const rgb = channels(set.accent);
    palette.accentText = set.accent;
    palette.accentFill = `rgba(${rgb}, ${alphaOf(base.accentFill)})`;
    palette.indicatrix = `rgba(${rgb}, ${alphaOf(base.indicatrix)})`;
    palette.accentWash = `rgba(${rgb}, ${alphaOf(base.accentWash)})`;
  }
  return palette;
}

const propertyOf = (token: string) => `--${token.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

/**
 * Puts a theme on the page round the map. The page reads its colours as custom properties, which the build writes for the paper
 * look, light and dark by the system's setting. Any other palette is written over them on the root element, and the browser's own
 * controls are told whether it is light or dark. With `palette` null the page is the build's again, and follows the system.
 */
export function applyToPage(root: HTMLElement, palette: Palette | null, chrome: Scheme): void {
  const tokens = Object.entries(palette ?? LIGHT).flatMap(([token, colour]) =>
    typeof colour === 'string' ? [[propertyOf(token), colour] as const] : (colour as readonly string[]).map((c, i) => [`${propertyOf(token)}-${i}`, c] as const),
  );
  for (const [property, colour] of tokens) {
    if (palette) root.style.setProperty(property, colour);
    else root.style.removeProperty(property);
  }
  root.style.colorScheme = palette ? chrome : '';
}
