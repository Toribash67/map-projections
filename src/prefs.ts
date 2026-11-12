import { DEFAULT_LAYERS, type GraticuleStep, type LayerId, type LayerState } from './layers/layers';
import { COLOUR_NAMES, THEME_NAMES, type ColourKey, type Overrides, type ThemeId } from './theme/themes';

/** What is remembered between visits: how the map looks and what it shows, not which map it is. */
export interface Prefs {
  theme: ThemeId;
  overrides: Overrides;
  layers: LayerState;
  /** The corner globe: whether it shows the surface the map is projected onto, and whether it is folded away. */
  locator: { surface: boolean; collapsed: boolean };
  /** Whether shapes drawn on a flat map follow the map or the globe. */
  drawMode: 'map' | 'globe';
}

export const DEFAULT_PREFS: Prefs = {
  theme: 'auto',
  overrides: {},
  layers: DEFAULT_LAYERS,
  locator: { surface: true, collapsed: false },
  drawMode: 'map',
};

/** Where they are kept. The number is the shape of what is kept: a change of shape that old values cannot be read into takes a new one. */
export const PREFS_KEY = 'map-projections:prefs:v1';

const COLOUR = /^#[0-9a-f]{6}$/i;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const flag = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

function readOverrides(v: unknown): Overrides {
  const out: Overrides = {};
  if (!isRecord(v)) return out;
  for (const [key] of COLOUR_NAMES) {
    const colour = v[key];
    if (typeof colour === 'string' && COLOUR.test(colour)) out[key as ColourKey] = colour;
  }
  return out;
}

function readLayers(v: unknown): LayerState {
  const kept = isRecord(v) ? v : {};
  const on = isRecord(kept.on) ? kept.on : {};
  const ids = Object.keys(DEFAULT_LAYERS.on) as LayerId[];
  return {
    on: Object.fromEntries(ids.map((id) => [id, flag(on[id], DEFAULT_LAYERS.on[id])])) as Record<LayerId, boolean>,
    graticuleStep: ([10, 15, 30] as unknown[]).includes(kept.graticuleStep) ? (kept.graticuleStep as GraticuleStep) : DEFAULT_LAYERS.graticuleStep,
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
    theme: typeof v.theme === 'string' && v.theme in THEME_NAMES ? (v.theme as ThemeId) : DEFAULT_PREFS.theme,
    overrides: readOverrides(v.overrides),
    layers: readLayers(v.layers),
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
