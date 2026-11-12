import { PALETTES, type Palette, type Scheme } from '../theme/palette';

/** Colours, and line widths in CSS pixels. */
export type Style = {
  background: string;
  ocean: string;
  land: string;
  graticule: string;
  coast: string;
  accent: string;
  accentFill: string;
  /** The fill of a Tissot indicatrix, which has no outline. */
  indicatrix: string;
  /** The area a locator covers is tinted, and its marker has a halo. */
  tint: string;
  halo: string;
  /** Text and lines drawn over the map. */
  ink: string;
  borders: string;
  /** The standard lines of a map: a second accent. */
  standard: string;
  reference: string;
  /** The fills of the political map, by colour number. */
  political: readonly string[];
  seamWidth: number;
  graticuleWidth: number;
  coastWidth: number;
  drawingWidth: number;
  bordersWidth: number;
  standardWidth: number;
  referenceWidth: number;
};

// Fills of neighbouring pieces meet at a seam; a stroke this wide in their own colour hides the hairline between them.
const WIDTHS = { seamWidth: 0.5, graticuleWidth: 0.75, coastWidth: 0.6, drawingWidth: 2, bordersWidth: 0.7, standardWidth: 1.6, referenceWidth: 0.9 };

/** The style of the map for a palette: its colours, with the map's line widths. */
export function styleOf(p: Palette): Style {
  return { background: p.paper, ocean: p.ocean, land: p.land, graticule: p.graticule, coast: p.coast, accent: p.accent, accentFill: p.accentFill, indicatrix: p.indicatrix, tint: p.tint, halo: p.halo, ink: p.ink, borders: p.borders, standard: p.standard, reference: p.reference, political: p.political, ...WIDTHS };
}

const styles = new Map<Scheme, Style>();

/** A quiet base map, so that drawings and indicatrices stand out in the accent: the palette of a scheme with the map's line widths. The same object each time. */
export function mapStyle(scheme: Scheme): Style {
  let style = styles.get(scheme);
  if (!style) {
    style = styleOf(PALETTES[scheme]);
    styles.set(scheme, style);
  }
  return style;
}
