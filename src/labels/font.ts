import light from '@fontsource/jost/files/jost-latin-400-normal.woff2?url';
import italic from '@fontsource/jost/files/jost-latin-400-italic.woff2?url';
import medium from '@fontsource/jost/files/jost-latin-500-normal.woff2?url';
import bold from '@fontsource/jost/files/jost-latin-700-normal.woff2?url';
import type { Label, Measure } from './place';
import type { PlateMeasure } from '../plate/plate';

/** The typeface of everything lettered on the map: Jost, an open geometric sans (SIL Open Font License), bundled with the app. */
export const FONT_FAMILY = 'Jost';
// What is used until it has arrived, or if it cannot be fetched.
const FALLBACK = '"Avenir Next", Futura, "Century Gothic", sans-serif';

type Face = { weight: 400 | 500 | 700; style: 'normal' | 'italic'; url: string };
const FACES: Face[] = [
  { weight: 400, style: 'normal', url: light },
  { weight: 400, style: 'italic', url: italic },
  { weight: 500, style: 'normal', url: medium },
  { weight: 700, style: 'normal', url: bold },
];

/** The weight and slope of a kind of label: countries and degrees upright and medium, seas in italic. */
export const faceOf = (kind: Label['kind']): { weight: 400 | 500; style: 'normal' | 'italic' } => (kind === 'sea' ? { weight: 400, style: 'italic' } : { weight: 500, style: 'normal' });

/** A canvas font for a weight and slope at a size in pixels. */
export const fontOf = (weight: number, style: 'normal' | 'italic', size: number): string => `${style === 'italic' ? 'italic ' : ''}${weight} ${size}px ${FONT_FAMILY}, ${FALLBACK}`;
/** The families as an SVG or a stylesheet names them. */
export const FONT_STACK = `${FONT_FAMILY}, ${FALLBACK}`;

let loading: Promise<void> | null = null;
let ready = false;

/** Whether the typeface has arrived. Until it has, lettering is measured and drawn in the fallback, and is fitted again when it comes. */
export const fontReady = (): boolean => ready;

/**
 * Fetches the typeface, once. It resolves whether or not the typeface came: where it cannot be fetched, or there is no page to put
 * it on, the lettering is in the fallback, and the next asking tries again.
 */
export function loadFont(): Promise<void> {
  if (typeof FontFace === 'undefined' || typeof document === 'undefined') return Promise.resolve();
  loading ??= Promise.all(
    FACES.map(async ({ weight, style, url }) => {
      const face = new FontFace(FONT_FAMILY, `url(${url}) format("woff2")`, { weight: String(weight), style });
      document.fonts.add(await face.load());
    }),
  ).then(
    () => void (ready = true),
    () => void (loading = null),
  );
  return loading;
}

/** Measures of text on a canvas of its own, in the typeface as it is now: for names, and for the title box. Each text is measured once. */
export function canvasMeasure(): { label: Measure; plate: PlateMeasure } {
  const ctx = document.createElement('canvas').getContext('2d')!;
  const known = new Map<string, number>();
  // At a large size, so that the widths are fine enough to scale down.
  const AT = 200;
  const width = (text: string, weight: number, style: 'normal' | 'italic'): number => {
    const key = `${ready}:${weight}:${style}:${text}`;
    let w = known.get(key);
    if (w === undefined) {
      ctx.font = fontOf(weight, style, AT);
      w = ctx.measureText(text).width / AT;
      known.set(key, w);
    }
    return w;
  };
  return {
    label: (text, kind) => {
      const { weight, style } = faceOf(kind);
      return width(text, weight, style);
    },
    plate: (text, weight) => width(text, weight, 'normal'),
  };
}

const base64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};

/** The typeface as style rules with the files inside them, for a drawing that has to carry its own. Empty where the files cannot be fetched. */
export async function fontFaceCss(): Promise<string> {
  try {
    const rules = await Promise.all(
      FACES.map(async ({ weight, style, url }) => {
        const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
        return `@font-face{font-family:${FONT_FAMILY};font-weight:${weight};font-style:${style};src:url(data:font/woff2;base64,${base64(bytes)}) format("woff2")}`;
      }),
    );
    return rules.join('');
  } catch {
    return '';
  }
}
