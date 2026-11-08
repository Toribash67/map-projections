import { PALETTES, type Scheme } from '../theme/palette';

/** Colours, and line widths in CSS pixels. */
export type Style = {
  background: string;
  ocean: string;
  land: string;
  graticule: string;
  coast: string;
  accent: string;
  accentFill: string;
  /** The area a locator covers is tinted, and its marker has a halo. */
  tint: string;
  halo: string;
  /** Text and lines drawn over the map. */
  ink: string;
  seamWidth: number;
  graticuleWidth: number;
  coastWidth: number;
  drawingWidth: number;
  indicatrixWidth: number;
};

// Fills of neighbouring pieces meet at a seam; a stroke this wide in their own colour hides the hairline between them.
const WIDTHS = { seamWidth: 0.5, graticuleWidth: 0.75, coastWidth: 0.6, drawingWidth: 2, indicatrixWidth: 1.25 };

const styles = new Map<Scheme, Style>();

/** A quiet base map, so that drawings and indicatrices stand out in the accent: the palette of a scheme with the map's line widths. The same object each time. */
export function mapStyle(scheme: Scheme): Style {
  let style = styles.get(scheme);
  if (!style) {
    const p = PALETTES[scheme];
    style = { background: p.paper, ocean: p.ocean, land: p.land, graticule: p.graticule, coast: p.coast, accent: p.accent, accentFill: p.accentFill, tint: p.tint, halo: p.halo, ink: p.ink, ...WIDTHS };
    styles.set(scheme, style);
  }
  return style;
}
