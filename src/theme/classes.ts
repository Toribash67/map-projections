/**
 * The colours of the classes of land that have a name each and a legend to say it: the biomes and the climates. They are the same
 * in every theme, as a rainforest is green and a desert sand whatever the page looks like, and are kept quiet enough to letter on.
 * This file imports nothing.
 */

/** The fourteen biomes of the ecoregions' map, in its own order: see `World.biomes`. */
export const BIOME_COLOURS: readonly string[] = [
  '#5fa46b', // Tropical and subtropical moist broadleaf forests
  '#b9c77a', // Tropical and subtropical dry broadleaf forests
  '#86b38f', // Tropical and subtropical coniferous forests
  '#8fc47e', // Temperate broadleaf and mixed forests
  '#5d9684', // Temperate conifer forests
  '#7fa9a3', // Boreal forests, or taiga
  '#e3cf7e', // Tropical and subtropical grasslands, savannas and shrublands
  '#eee0a3', // Temperate grasslands, savannas and shrublands
  '#a9d3d6', // Flooded grasslands and savannas
  '#c9b796', // Montane grasslands and shrublands
  '#c5d5d8', // Tundra
  '#e0a987', // Mediterranean forests, woodlands and scrub
  '#f1d9b5', // Deserts and xeric shrublands
  '#c78fb0', // Mangroves
];

/** The thirteen kinds of climate, in Köppen's order: see `World.climate`. */
export const CLIMATE_COLOURS: readonly string[] = [
  '#4f8fc9', // Af, tropical rainforest
  '#74acd8', // Am, tropical monsoon
  '#a3cbe4', // Aw, tropical savanna
  '#e89a8a', // BW, desert
  '#f0cf8a', // BS, steppe
  '#e8e08a', // Cs, temperate with a dry summer
  '#a9d6a0', // Cw, temperate with a dry winter
  '#86c47c', // Cf, temperate with no dry season
  '#cf9fd0', // Ds, continental with a dry summer
  '#a8aee0', // Dw, continental with a dry winter
  '#8fd0cf', // Df, continental with no dry season
  '#c4c7c9', // ET, tundra
  '#eef2f4', // EF, ice cap
];

/** What each biome is called in a legend: the ecoregions' own names are too long for one. In the order of `BIOME_COLOURS`. */
export const BIOME_NAMES: readonly string[] = [
  'Tropical moist forest',
  'Tropical dry forest',
  'Tropical conifer forest',
  'Temperate broadleaf forest',
  'Temperate conifer forest',
  'Taiga',
  'Tropical grassland and savanna',
  'Temperate grassland',
  'Flooded grassland',
  'Montane grassland',
  'Tundra',
  'Mediterranean scrub',
  'Desert and dry scrub',
  'Mangrove',
];

/** What each kind of climate is called in a legend, after Köppen's letters for it. In the order of `CLIMATE_COLOURS`. */
export const CLIMATE_NAMES: readonly string[] = [
  'Af  Tropical rainforest',
  'Am  Tropical monsoon',
  'Aw  Tropical savanna',
  'BW  Desert',
  'BS  Steppe',
  'Cs  Temperate, dry summer',
  'Cw  Temperate, dry winter',
  'Cf  Temperate, no dry season',
  'Ds  Continental, dry summer',
  'Dw  Continental, dry winter',
  'Df  Continental, no dry season',
  'ET  Tundra',
  'EF  Ice cap',
];

/** A colour as '#rrggbb', see-through: `alpha` of it. */
export const faint = (colour: string, alpha: number): string => `rgba(${[1, 3, 5].map((i) => parseInt(colour.slice(i, i + 2), 16)).join(', ')}, ${alpha})`;
