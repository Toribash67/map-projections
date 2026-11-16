import { CORNERS, COVERS, DEFAULT_MAP_LAYERS, DEFAULT_PRINT, LINE_WEIGHT, SMALLEST_NAME, TITLE_LENGTH, type Corner, type Cover, type GraticuleStep, type MapLayers, type PrintLayers } from './layers/layers';
import { COLOUR_NAMES, THEME_NAMES, type ColourKey, type Overrides, type ThemeId } from './theme/themes';

/** What is remembered between visits: how the map looks and what it shows, not which map it is. */
export interface Prefs {
  theme: ThemeId;
  overrides: Overrides;
  /** The layers of the map as it is explored, and what a picture for export has over them. */
  layers: MapLayers;
  print: PrintLayers;
  /** The corner globe: whether it shows the surface the map is projected onto, and whether it is folded away. */
  locator: { surface: boolean; collapsed: boolean };
  /** Whether shapes drawn on a flat map follow the map or the globe. */
  drawMode: 'map' | 'globe';
}

export const DEFAULT_PREFS: Prefs = {
  theme: 'auto',
  overrides: {},
  layers: DEFAULT_MAP_LAYERS,
  print: DEFAULT_PRINT,
  locator: { surface: true, collapsed: false },
  drawMode: 'map',
};

/** Where they are kept. The number is the shape of what is kept: a change of shape that old values cannot be read into takes a new one. */
export const PREFS_KEY = 'map-projections:prefs:v1';

const COLOUR = /^#[0-9a-f]{6}$/i;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const flag = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
/** A title as it was typed, no longer than a title may be. */
const text = (v: unknown, fallback: string): string => (typeof v === 'string' ? v.slice(0, TITLE_LENGTH) : fallback);

/** A number that was kept, within its limits. */
const within = (v: unknown, limits: { min: number; max: number }, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(limits.max, Math.max(limits.min, v)) : fallback);

const corner = (v: unknown, fallback: Corner): Corner => ((CORNERS as readonly unknown[]).includes(v) ? (v as Corner) : fallback);

function readOverrides(v: unknown): Overrides {
  const out: Overrides = {};
  if (!isRecord(v)) return out;
  for (const [key] of COLOUR_NAMES) {
    const colour = v[key];
    if (typeof colour === 'string' && COLOUR.test(colour)) out[key as ColourKey] = colour;
  }
  return out;
}

/** The flags that were kept of those there are, each as it is by default where it was not kept. */
const readOn = <K extends string>(v: unknown, defaults: Record<K, boolean>): Record<K, boolean> => {
  const on = isRecord(v) ? v : {};
  return Object.fromEntries((Object.keys(defaults) as K[]).map((id) => [id, flag(on[id], defaults[id])])) as Record<K, boolean>;
};

function readLayers(v: unknown): MapLayers {
  const kept = isRecord(v) ? v : {};
  return {
    on: readOn(kept.on, DEFAULT_MAP_LAYERS.on),
    graticuleStep: ([10, 15, 30] as unknown[]).includes(kept.graticuleStep) ? (kept.graticuleStep as GraticuleStep) : DEFAULT_MAP_LAYERS.graticuleStep,
    graticuleUnder: flag(kept.graticuleUnder, DEFAULT_MAP_LAYERS.graticuleUnder),
  };
}

function readPrint(v: unknown): PrintLayers {
  const kept = isRecord(v) ? v : {};
  return {
    on: readOn(kept.on, DEFAULT_PRINT.on),
    cover: (COVERS as readonly unknown[]).includes(kept.cover) ? (kept.cover as Cover) : DEFAULT_PRINT.cover,
    lineWeight: within(kept.lineWeight, LINE_WEIGHT, DEFAULT_PRINT.lineWeight),
    smallestName: within(kept.smallestName, SMALLEST_NAME, DEFAULT_PRINT.smallestName),
    title: text(kept.title, DEFAULT_PRINT.title),
    subtitle: text(kept.subtitle, DEFAULT_PRINT.subtitle),
    corner: corner(kept.corner, DEFAULT_PRINT.corner),
    legendCorner: corner(kept.legendCorner, DEFAULT_PRINT.legendCorner),
  };
}

/** The browser's own store, or none where there is none or it may not be used, as in some private windows. */
function browserStore(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * The preferences that were kept, or the defaults. Whatever was kept is read part by part: a part that is missing, of the wrong
 * kind, or not a value the app knows takes its default, and the rest stands. Nothing here throws, whatever is in the store.
 */
export function loadPrefs(storage: Pick<Storage, 'getItem'> | null = browserStore()): Prefs {
  let kept: unknown = null;
  try {
    kept = JSON.parse(storage?.getItem(PREFS_KEY) ?? 'null');
  } catch {
    // Not there, not JSON, or not allowed: the defaults.
  }
  const v = isRecord(kept) ? kept : {};
  const locator = isRecord(v.locator) ? v.locator : {};
  return {
    theme: typeof v.theme === 'string' && Object.hasOwn(THEME_NAMES, v.theme) ? (v.theme as ThemeId) : DEFAULT_PREFS.theme,
    overrides: readOverrides(v.overrides),
    layers: readLayers(v.layers),
    // Before the picture had layers of its own they were kept with the map's, and are read from there.
    print: readPrint(v.print ?? v.layers),
    locator: { surface: flag(locator.surface, DEFAULT_PREFS.locator.surface), collapsed: flag(locator.collapsed, DEFAULT_PREFS.locator.collapsed) },
    drawMode: v.drawMode === 'map' || v.drawMode === 'globe' ? v.drawMode : DEFAULT_PREFS.drawMode,
  };
}

/** Keeps the preferences, if there is anywhere to keep them. */
export function savePrefs(prefs: Prefs, storage: Pick<Storage, 'setItem'> | null = browserStore()): void {
  try {
    storage?.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Full, or not allowed: they last for this visit only.
  }
}
